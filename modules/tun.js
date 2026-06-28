const { spawn } = require('child_process');
const { ipcMain, app } = require('electron');
const fs = require('fs-extra');
const path = require('path');

// TUN 强制软包模式：通过 mihomo 创建虚拟网卡，将指定进程的流量
// 强制重定向到 Auto366 的 HTTP 代理（127.0.0.1:proxyPort）。
// 这样无需在天学网客户端中手动设置代理即可完成抓包。
class TunManager {
  constructor(proxyServer) {
    this.proxyServer = proxyServer;
    this.mainWindow = null;
    this.mihomoProcess = null;
    this.isRunning = false;

    // 配置目录：~/.Auto366/tun/
    this.configDir = path.join(app.getPath('home'), '.Auto366', 'tun');
    this.configPath = path.join(this.configDir, 'config.yaml');

    // mihomo 与 wintun.dll 资源路径（开发/打包路径不同）
    this.mihomoPath = this._resolveResourcePath('mihomo-windows-amd64-compatible.exe');
    this.wintunPath = this._resolveResourcePath('wintun.dll');

    // 选中的进程列表（PROCESS-NAME 规则匹配）
    this.selectedProcesses = ['up366.exe'];
  }

  // 解析资源路径（开发模式使用 appPath，打包后使用 process.resourcesPath）
  _resolveResourcePath(filename) {
    const isDev = !app.isPackaged;
    if (isDev) {
      return path.join(app.getAppPath(), 'resources', 'tun', filename);
    }
    return path.join(process.resourcesPath, 'tun', filename);
  }

  // 生成 mihomo 配置文件内容
  _generateConfig() {
    const proxyPort = this.proxyServer ? this.proxyServer.getProxyPort() : 5291;

    // 生成进程匹配规则
    const processRules = this.selectedProcesses
      .filter((p) => p && p.trim())
      .map((p) => `  - PROCESS-NAME,${p.trim()},Auto366Proxy`)
      .join('\n');

    return `# Auto366 TUN 强制软包模式配置 (自动生成，请勿手动修改)
mixed-port: 7890
allow-lan: false
mode: rule
log-level: warning
ipv6: false
find-process-mode: always
tcp-concurrent: true

tun:
  enable: true
  stack: gvisor
  dns-hijack:
    - any:53
  auto-route: true
  auto-detect-interface: true

# 流量嗅探：从 TLS SNI / HTTP Host 还原真实域名
# 关键：确保 HTTPS 流量转发到 Auto366 代理时使用域名而非 IP
sniffer:
  enable: true
  force-dns-mapping: true
  parse-pure-ip: true
  sniff:
    HTTP:
      ports: [80, 8080-8880]
      override-destination: true
    TLS:
      ports: [443, 8443]
      override-destination: true

dns:
  enable: true
  ipv6: false
  # fake-ip 模式：mihomo 返回虚假 IP，建立 IP↔域名映射
  # 确保 mihomo 转发 HTTPS 时一定知道目标域名
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - "localhost.ptlogin2.qq.com"
    - "+.msftconnecttest.com"
    - "+.msftncsi.com"
  default-nameserver:
    - 223.5.5.5
    - 114.114.114.114
  nameserver:
    - 223.5.5.5
    - 114.114.114.114
  fallback:
    - 8.8.8.8
    - 1.1.1.1

proxies:
  - name: Auto366Proxy
    type: http
    server: 127.0.0.1
    port: ${proxyPort}

proxy-groups:
  - name: Auto366Group
    type: select
    proxies:
      - Auto366Proxy

rules:
${processRules || '  - MATCH,DIRECT'}
  - MATCH,DIRECT
`;
  }

  // 启动 TUN（启动 mihomo 进程）
  async start() {
    if (this.isRunning) {
      return { success: false, message: 'TUN 模式已在运行中' };
    }

    // 检查 Auto366 代理是否已启动
    if (!this.proxyServer || !this.proxyServer.isRunning) {
      return { success: false, message: '请先启动 Auto366 代理服务器' };
    }

    try {
      // 检查 mihomo 可执行文件
      if (!fs.existsSync(this.mihomoPath)) {
        return { success: false, message: 'mihomo 可执行文件不存在: ' + this.mihomoPath };
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
      // 不发送 tun-status 事件，由 IPC 返回值统一提示（避免重复日志）
      return { success: true, message: 'TUN 强制软包模式已启动' };
    } catch (error) {
      this.isRunning = false;
      // 不发送 tun-status 事件，由 IPC 返回值统一提示（避免重复日志）
      return { success: false, message: error.message };
    }
  }

  // 停止 TUN（终止 mihomo 进程）
  stop() {
    if (!this.isRunning || !this.mihomoProcess) {
      this.isRunning = false;
      return { success: true, message: 'TUN 模式未在运行' };
    }

    try {
      this.mihomoProcess.kill();
      this.isRunning = false;
      this.mihomoProcess = null;
      // 不发送 tun-status 事件，由 IPC 返回值统一提示（避免重复日志）
      // close 事件处理器检查 isRunning=false，不会重复通知
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
