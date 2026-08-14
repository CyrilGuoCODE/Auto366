const { spawn } = require('child_process');
const { ipcMain, app } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const { generateTunConfig } = require('./tun-config');

// TUN 强制软包模式：通过 mihomo 创建虚拟网卡，将指定进程的流量
// 强制重定向到 Auto366 的 HTTP 代理（127.0.0.1:proxyPort）。
// 这样无需在天学网客户端中手动设置代理即可完成抓包。
class TunManager {
  constructor(proxyServer, resourceDownloader) {
    this.proxyServer = proxyServer;
    this.resourceDownloader = resourceDownloader || null;
    this.mainWindow = null;
    this.mihomoProcess = null;
    this.isRunning = false;
    this.isStarting = false;
    this.lifecycleGeneration = 0;

    // 配置目录：~/.Auto366/tun/
    this.configDir = path.join(app.getPath('home'), '.Auto366', 'tun');
    this.configPath = path.join(this.configDir, 'config.yaml');

    // mihomo 与 wintun.dll 资源路径（优先用户数据目录，开发时兜底 appPath/resources）
    this.mihomoPath = this._resolveResourcePath('mihomo-windows-amd64-compatible.exe');
    this.wintunPath = this._resolveResourcePath('wintun.dll');

    // 选中的进程列表（PROCESS-NAME 规则匹配）
    this.selectedProcesses = ['up366.exe'];
  }

  // 解析资源路径：优先用户数据目录（下载/迁移后的位置），开发时兜底 appPath/resources
  _resolveResourcePath(filename) {
    const userPath = path.join(app.getPath('home'), '.Auto366', 'resources', 'tun', filename);
    if (!app.isPackaged) {
      const devPath = path.join(app.getAppPath(), 'resources', 'tun', filename);
      if (fs.existsSync(devPath) && !fs.existsSync(userPath)) {
        return devPath; // 开发兜底
      }
    }
    return userPath;
  }

  // 生成 mihomo 配置文件内容
  _generateConfig() {
    const proxyPort = this.proxyServer ? this.proxyServer.getProxyPort() : 5291;
    return generateTunConfig(proxyPort, this.selectedProcesses);
  }

  // 启动 TUN（启动 mihomo 进程）
  async start() {
    if (this.isRunning) {
      return { success: false, message: 'TUN 模式已在运行中' };
    }
    if (this.isStarting) {
      return { success: false, message: 'TUN 模式正在启动中' };
    }

    // 检查 Auto366 代理是否已启动
    if (!this.proxyServer || !this.proxyServer.isRunning) {
      return { success: false, message: '请先启动 Auto366 代理服务器' };
    }

    const generation = ++this.lifecycleGeneration;
    this.isStarting = true;

    try {
      // 检查 mihomo 可执行文件；缺失时若有下载器则自动下载
      if (!fs.existsSync(this.mihomoPath)) {
        if (this.resourceDownloader) {
          const r = await this.resourceDownloader.ensure('tun');
          if (!r.ready || !fs.existsSync(this.mihomoPath)) {
            return { success: false, message: 'TUN 资源未就绪：' + (r.message || '下载失败') };
          }
        } else {
          return { success: false, message: 'mihomo 可执行文件不存在: ' + this.mihomoPath };
        }
      }

      if (generation !== this.lifecycleGeneration || !this.proxyServer.isRunning) {
        return { success: false, cancelled: true, message: 'TUN 代理增强启动已取消' };
      }

      // 检查 wintun.dll
      if (!fs.existsSync(this.wintunPath)) {
        return { success: false, message: 'wintun.dll 不存在: ' + this.wintunPath };
      }

      // 确保配置目录存在
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }

      // 写入配置文件
      const config = this._generateConfig();
      fs.writeFileSync(this.configPath, config, 'utf-8');

      // 启动 mihomo，工作目录设为 wintun.dll 所在目录
      // 确保 mihomo 能加载 wintun.dll
      const workDir = path.dirname(this.wintunPath);
      this.mihomoProcess = spawn(this.mihomoPath, ['-f', this.configPath, '-d', this.configDir], {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.mihomoProcess.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          console.log('[TUN:mihomo]', text);
        }
      });

      this.mihomoProcess.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          console.error('[TUN:mihomo]', text);
        }
      });

      this.mihomoProcess.on('close', (code) => {
        console.log(`[TUN] mihomo 进程退出，退出码: ${code}`);
        if (this.isRunning) {
          this.isRunning = false;
          this.mihomoProcess = null;
          this.safeIpcSend('tun-status', {
            type: 'stopped',
            message: `TUN 进程已退出 (退出码: ${code})`,
            running: false
          });
        }
      });

      this.mihomoProcess.on('error', (err) => {
        console.error('[TUN] mihomo 进程错误:', err.message);
        // 仅在 TUN 运行中时通知（避免与 start() 返回值重复）
        if (this.isRunning) {
          this.isRunning = false;
          this.mihomoProcess = null;
          this.safeIpcSend('tun-status', {
            type: 'error',
            message: 'TUN 进程异常: ' + err.message,
            running: false
          });
        }
      });

      this.isRunning = true;
      this.safeIpcSend('tun-status', {
        type: 'started',
        message: 'TUN 强制软包模式已启动',
        running: true
      });
      return { success: true, message: 'TUN 强制软包模式已启动' };
    } catch (error) {
      this.isRunning = false;
      // 不发送 tun-status 事件，由 IPC 返回值统一提示（避免重复日志）
      return { success: false, message: error.message };
    } finally {
      this.isStarting = false;
    }
  }

  // 停止 TUN（终止 mihomo 进程）
  stop() {
    this.lifecycleGeneration += 1;
    if (this.isStarting && this.resourceDownloader) {
      this.resourceDownloader.abort('tun');
    }

    if (!this.isRunning || !this.mihomoProcess) {
      this.isRunning = false;
      return {
        success: true,
        cancelled: this.isStarting,
        message: this.isStarting ? 'TUN 代理增强启动已取消' : 'TUN 模式未在运行'
      };
    }

    try {
      this.mihomoProcess.kill();
      this.isRunning = false;
      this.mihomoProcess = null;
      this.safeIpcSend('tun-status', {
        type: 'stopped',
        message: 'TUN 强制软包模式已停止',
        running: false
      });
      // close 事件处理器检查 isRunning=false，不会重复通知。
      return { success: true, message: 'TUN 强制软包模式已停止' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // 设置选中的进程列表
  setSelectedProcesses(processes) {
    this.selectedProcesses = Array.isArray(processes)
      ? processes.filter((p) => p && p.trim())
      : [];
  }

  getSelectedProcesses() {
    return [...this.selectedProcesses];
  }

  getStatus() {
    return {
      running: this.isRunning,
      starting: this.isStarting,
      selectedProcesses: this.getSelectedProcesses()
    };
  }

  // 安全的IPC发送函数
  safeIpcSend(channel, data) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data);
      }
    } catch (error) {
      console.error('[TUN] 发送IPC消息失败:', error.message);
    }
  }

  registerIpcHandlers(mainWindow) {
    this.mainWindow = mainWindow;

    ipcMain.handle('start-tun', async () => {
      return this.start();
    });

    ipcMain.handle('stop-tun', async () => {
      return this.stop();
    });

    ipcMain.handle('get-tun-status', async () => {
      return this.getStatus();
    });

    ipcMain.handle('set-tun-processes', async (event, processes) => {
      this.setSelectedProcesses(processes);
      // 如果TUN正在运行，重启以应用新的配置
      if (this.isRunning) {
        this.stop();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return this.start();
      }
      return { success: true };
    });

    ipcMain.handle('get-tun-processes', async () => {
      return this.getSelectedProcesses();
    });
  }
}

module.exports = TunManager;
