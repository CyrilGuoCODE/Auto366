/*
 * SpeedManager —— 进程加速管理器 (主进程侧)
 * ------------------------------------------------------------
 * 职责:
 *   - 常驻管理 injector32.exe 子进程(纯 C 注入器, 复用 OpenSpeedy 的 speedpatch32.dll;
 *     up366 是 32 位, 只能 32 位注入; 注入器默认只注入 renderer 进程)
 *   - 接收「进程加速」页面经 IPC 推来的倍率(set-speed / reset-speed)
 *   - 通过 stdin 把 "speed <factor>" / "reset" 命令喂给注入器
 *   - 注入器内部自行枚举 up366.exe 全部进程并注入, 无需主进程传 pid
 *
 * 与既有架构一致处:
 *   - 每功能一个 Manager 类, registerIpcHandlers 挂 ipcMain 句柄(同 process-monitor)
 *   - 复用 rule-log IPC 通道向监听日志输出(与 proxy.safeIpcSend 同风格)
 *   - 另推 speed-status 事件给进程加速页面
 *   - 生命周期挂在 main.js: app ready 时 init, before-quit 时 stop
 *
 * 依赖文件(随 Auto366 分发, 放在 resources/openspeedy/):
 *   - injector32.exe     本仓库 openspeedy/injector.c 编译产物(默认只注入 renderer)
 *   - speedpatch32.dll   取自 OpenSpeedy(导出 SP_SetSpeed/SP_Enable)
 *
 * 关键前置:
 *   - Auto366 必须以管理员权限运行(注入需要), 注入器继承该权限
 *   - injector32.exe 与 speedpatch32.dll 必须在同一目录
 *   - 该目录路径不能含中文(LoadLibraryW 的 ASCII 回退在中文路径下会失败)
 */

const { spawn } = require('child_process');
const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');

class SpeedManager {
  constructor() {
    this.mainWindow = null;
    this.child = null;
    this.ready = false;
    this.starting = false;

    // 当前期望状态(面板推来的)
    this.enabled = false;
    this.factor = null; // null = 未设置

    // 网络保护: 关键请求在飞期间把倍率瞬时压回 1×(引用计数, 可并发)
    this._netHolds = 0;
    this._netActive = false;  // 是否已向注入器发过 hold(用于配对 resume)
    this._netSafetyTimer = null;
    this._lastDesired = null; // 去重, 避免重复下发相同 speed/reset

    // 注入器文件所在目录
    this.baseDir = null;
    this.injectorPath = null;
    this.dllPath = null;
  }

  // 由 main.js 在 app ready 后调用
  init(appPath, mainWindow) {
    this.mainWindow = mainWindow;
    // 开发模式用 appPath/resources, 打包后用 process.resourcesPath/openspeedy
    if (app && app.isPackaged) {
      this.baseDir = path.join(process.resourcesPath, 'openspeedy');
    } else {
      this.baseDir = path.join(appPath, 'resources', 'openspeedy');
    }
    // 天学网 up366.exe 是 32 位进程, 必须用 32 位注入器 + 32 位 DLL(不能跨位注入)
    this.injectorPath = path.join(this.baseDir, 'injector32.exe');
    this.dllPath = path.join(this.baseDir, 'speedpatch32.dll');

    // 若资源目录含非 ASCII(例如中文 Windows 用户名下的安装路径),
    // 复制到固定 ASCII 目录再运行, 规避个别环境按路径加载 DLL 失败。
    if (/[^\x00-\x7F]/.test(this.baseDir)) {
      this._stageToAsciiDir();
    }
  }

  // 把注入器与 DLL 复制到保证是 ASCII 的目录(C:\ProgramData\Auto366\openspeedy)
  _stageToAsciiDir() {
    try {
      const root = process.env.ProgramData || 'C:\\ProgramData';
      const dest = path.join(root, 'Auto366', 'openspeedy');
      fs.mkdirSync(dest, { recursive: true });
      const files = ['injector32.exe', 'speedpatch32.dll'];
      for (const name of files) {
        const src = path.join(this.baseDir, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, name));
      }
      this.baseDir = dest;
      this.injectorPath = path.join(dest, 'injector32.exe');
      this.dllPath = path.join(dest, 'speedpatch32.dll');
      this._log('资源目录含非 ASCII 字符, 已复制注入器到 ' + dest + ' 运行', 'info');
    } catch (e) {
      this._log('复制注入器到 ASCII 目录失败: ' + e.message, 'warning');
    }
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  _log(message, type = 'info') {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('rule-log', {
          type,
          message: '[进程加速] ' + message,
          timestamp: new Date().toISOString()
        });
        // 同时推 speed-status 事件给进程加速页面
        this.mainWindow.webContents.send('speed-status', {
          type,
          message,
          enabled: this.enabled,
          factor: this.factor,
          ready: this.ready
        });
      }
    } catch (e) { /* 忽略 */ }
    console.log('[SpeedManager]', message);
  }

  // 环境自检: 平台 / 文件是否存在 / 路径是否含中文
  _preflight() {
    if (process.platform !== 'win32') {
      this._log('仅 Windows 支持进程加速', 'warning');
      return false;
    }
    if (!fs.existsSync(this.injectorPath)) {
      this._log('缺少 injector32.exe: ' + this.injectorPath, 'error');
      return false;
    }
    if (!fs.existsSync(this.dllPath)) {
      this._log('缺少 speedpatch32.dll: ' + this.dllPath, 'error');
      return false;
    }
    // 含中文路径会导致 LoadLibrary ASCII 回退失败
    if (/[^\x00-\x7F]/.test(this.baseDir)) {
      this._log('警告: 注入器所在路径含非 ASCII 字符, 可能导致注入失败: ' + this.baseDir, 'warning');
    }
    return true;
  }

  // 启动(或复用)注入器子进程
  _ensureChild() {
    if (this.child && !this.child.killed && this.ready) return true;
    if (this.starting) return false;
    if (!this._preflight()) return false;

    this.starting = true;
    try {
      this.child = spawn(this.injectorPath, [], {
        cwd: this.baseDir,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      this.starting = false;
      this._log('启动注入器失败: ' + e.message, 'error');
      return false;
    }

    this.child.stdout.setEncoding('utf8');
    let buf = '';
    this.child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '').trim();
        buf = buf.slice(idx + 1);
        if (line) this._handleLine(line);
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (d) => {
      const s = String(d).trim();
      if (s) this._log('注入器stderr: ' + s, 'warning');
    });

    this.child.on('exit', (code) => {
      this._log('注入器已退出 (code=' + code + ')', code === 0 ? 'info' : 'warning');
      this.child = null;
      this.ready = false;
      this.starting = false;
      this._lastDesired = null;
      this._netHolds = 0;
      this._netActive = false;
      clearTimeout(this._netSafetyTimer);
      this._netSafetyTimer = null;
    });

    this.child.on('error', (err) => {
      this._log('注入器进程错误: ' + err.message, 'error');
      this.child = null;
      this.ready = false;
      this.starting = false;
      this._lastDesired = null;
      this._netHolds = 0;
      this._netActive = false;
      clearTimeout(this._netSafetyTimer);
      this._netSafetyTimer = null;
    });

    return true;
  }

  // 解析注入器 stdout 反馈
  _handleLine(line) {
    if (line === 'READY') {
      this.ready = true;
      this.starting = false;
      this._log('注入器就绪', 'success');
      // 就绪后若已有期望倍率, 立即下发
      this._applyDesired();
      return;
    }
    if (line.startsWith('OK inject ')) {
      this._log('已注入进程 ' + line.slice(10), 'success');
      return;
    }
    if (line.startsWith('SKIP inject ')) {
      // 辅助/受保护进程注入失败属正常, 降级为提示级别不打扰用户
      const parts = line.split(' ');
      this._log('跳过进程 ' + parts[2] + ' (注入失败码 ' + parts[3] + ', 通常为非音频辅助进程, 可忽略)', 'info');
      return;
    }
    if (line.startsWith('OK speed ')) {
      const parts = line.split(' ');
      this._log('倍率已生效: ' + parseFloat(parts[2]) + '× (覆盖 ' + parts[3] + ' 个进程)', 'success');
      return;
    }
    if (line.startsWith('OK injected ')) {
      this._log(line.replace('OK injected', '本轮新注入').replace('total', ', 累计'), 'info');
      return;
    }
    if (line.startsWith('DIAG ')) {
      this._log('诊断: ' + line.slice(5), 'warning');
      return;
    }
    if (line.startsWith('OK export ')) {
      this._log('已识别加速函数: ' + line.slice(10), 'success');
      return;
    }
    if (line.startsWith('OK rewatch ')) {
      // 后台重注入, 静默(避免刷屏)
      return;
    }
    if (line.startsWith('WARN ')) {
      this._log('提示: ' + line.slice(5), 'warning');
      return;
    }
    if (line.startsWith('EXPORTS ')) {
      this._log('⚠ DLL 导出表(请把下面的名字发给开发者): ' + line, 'warning');
      return;
    }
    if (line.startsWith('  EXPORT[')) {
      this._log('  ' + line.trim(), 'warning');
      return;
    }
    if (line.startsWith('OK reset')) {
      this._log('倍率已恢复 1.0×', 'info');
      return;
    }
    if (line.startsWith('STATUS ')) {
      this._log('状态: ' + line.slice(7), 'info');
      return;
    }
    if (line.startsWith('ERR ')) {
      this._log('注入器错误: ' + line.slice(4), 'error');
      return;
    }
    // 其余(pong 等)静默
  }

  _send(cmd) {
    if (!this.child || this.child.killed || !this.child.stdin.writable) return false;
    try {
      this.child.stdin.write(cmd + '\n');
      return true;
    } catch (e) {
      this._log('写入注入器失败: ' + e.message, 'error');
      return false;
    }
  }

  // 根据当前期望状态(enabled/factor/网络保护)下发命令。
  // 网络保护激活(_netHolds>0)时一律 reset(1×); 去重避免频繁 hold/release 刷屏。
  _applyDesired() {
    if (!this.ready) return;
    const cmd = (this.enabled && this.factor && this.factor > 0)
      ? ('speed ' + this.factor)
      : 'reset';
    if (cmd === this._lastDesired) return;
    this._lastDesired = cmd;
    this._send(cmd);
  }

  // 网络保护: 关键请求开始 → 发轻量 hold 压回 1×(引用计数, 仅加速中且就绪才发)
  netHold() {
    this._netHolds++;
    if (this._netHolds === 1 && this.enabled && this.ready) {
      this._netActive = true;
      this._send('hold');
      // 兜底: 万一某请求漏配对 release, 20s 后强制 resume, 防止卡在 1×
      clearTimeout(this._netSafetyTimer);
      this._netSafetyTimer = setTimeout(() => {
        if (this._netHolds > 0) {
          this._log('网络保护超时(20s), 强制恢复加速', 'warning');
          this._netHolds = 0;
          if (this._netActive) { this._netActive = false; this._send('resume'); }
        }
      }, 20000);
    }
  }

  // 网络保护: 关键请求结束/出错 → 发 resume 恢复目标倍率(引用计数归零且发过 hold 才恢复)
  netRelease() {
    if (this._netHolds <= 0) return;
    this._netHolds--;
    if (this._netHolds === 0 && this._netActive) {
      this._netActive = false;
      clearTimeout(this._netSafetyTimer);
      this._netSafetyTimer = null;
      this._send('resume');
    }
  }

  /*
   * 面板 -> IPC 调用入口。
   * payload: { enabled: bool, factor: number|null }
   * 返回 { success, error? } 供 invoke 端使用。
   */
  update(payload) {
    this.enabled = payload && payload.enabled === true;
    let f = payload ? payload.factor : null;
    if (f === null || f === undefined || f === '' || !(Number(f) > 0)) f = null;
    this.factor = f === null ? null : Number(f);

    if (this.enabled && this.factor) {
      // 需要加速: 确保注入器在跑, 就绪后会自动 _applyDesired
      if (!this._preflight()) {
        return { success: false, error: '环境自检未通过(缺少注入器/DLL 或路径含中文)' };
      }
      const up = this._ensureChild();
      if (up && this.ready) this._applyDesired();
      // 若正在启动, READY 回调里会补发
      return { success: true };
    } else {
      // 关闭加速: 恢复 1.0(不杀进程, 便于下次快速再开)。经 _applyDesired 统一去重下发。
      this._applyDesired();
      return { success: true };
    }
  }

  registerIpcHandlers(mainWindow) {
    this.mainWindow = mainWindow;

    // 设倍率(开始/调整加速)
    ipcMain.handle('set-speed', async (event, factor) => {
      return this.update({ enabled: true, factor });
    });

    // 恢复正常(停止加速)
    ipcMain.handle('reset-speed', async () => {
      return this.update({ enabled: false, factor: null });
    });

    // 查询当前状态
    ipcMain.handle('get-speed-status', async () => {
      return { enabled: this.enabled, factor: this.factor, ready: this.ready };
    });
  }

  // 退出清理: 恢复速度并结束注入器
  stop() {
    try {
      if (this.child && !this.child.killed) {
        if (this.child.stdin.writable) {
          this.child.stdin.write('reset\n');
          this.child.stdin.write('exit\n');
        }
        // 给注入器一点时间恢复速度并自我退出
        setTimeout(() => {
          if (this.child && !this.child.killed) {
            try { this.child.kill(); } catch (e) {}
          }
        }, 800);
      }
    } catch (e) { /* 忽略 */ }
  }
}

module.exports = SpeedManager;
