const { spawn } = require('child_process');
const { ipcMain, app } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { URL } = require('url');

// ---- GeoIP/GeoSite 数据库 ----
const GEO_MIRRORS = [
  'https://gh-proxy.org/',
  'https://cdn.gh-proxy.org/',
  'https://axisnow.gh-proxy.org/',
  'https://ghproxy.net/',
];
// 源仓库：MetaCubeX/meta-rules-dat（mihomo 官方 geox 数据库，release 固定 latest 标签）
const GEO_RELEASE_URL = 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/';
// 最小必要 GeoIP 数据库
const GEO_DATA_MIN = [
  { file: 'geoip.metadb', minSize: 1024 * 1024 },
];
// 其余数据库：当前暂不下载（TUN 启动后在后台补齐的机制保留，需要时在此列表加入即可）。
const GEO_DATA_EXTRA = [];

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

# GeoIP/GeoSite 数据库：关闭自动更新，由 Auto366 启动时从国内加速镜像预置
geo-auto-update: false
geox-url:
  geoip: "https://gh-proxy.org/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat"
  geosite: "https://gh-proxy.org/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"
  mmdb: "https://gh-proxy.org/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb"

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

  // 从 GitHub 加速镜像下载单个 Geo 数据库文件（支持重定向，写临时文件后原子替换）
  // onProgress(received, total) 回调用于上报下载进度
  _downloadGeoFile(file, dest, mirror, onProgress) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + '.tmp';
      try { fs.removeSync(tmp); } catch (e) { /* 忽略 */ }

      const downloadFrom = (url) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Auto366' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            downloadFrom(new URL(res.headers.location, url).toString());
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const total = parseInt(res.headers['content-length'], 10) || 0;
          let received = 0;
          const fd = fs.openSync(tmp, 'w');
          res.on('data', (c) => {
            fs.writeSync(fd, c, 0, c.length);
            received += c.length;
            if (onProgress) onProgress(received, total);
          });
          res.on('end', () => {
            try { fs.closeSync(fd); } catch (e) { /* 忽略 */ }
            try {
              // 校验非空/非错误页
              if (fs.statSync(tmp).size < 1024) {
                fs.removeSync(tmp);
                reject(new Error('文件过小，疑似错误响应'));
                return;
              }
              fs.renameSync(tmp, dest);
              resolve();
            } catch (e) { reject(e); }
          });
          res.on('error', (e) => {
            try { fs.closeSync(fd); } catch (x) { /* 忽略 */ }
            try { fs.removeSync(tmp); } catch (x) { /* 忽略 */ }
            reject(e);
          });
        });
        req.on('error', reject);
      };

      downloadFrom(mirror + GEO_RELEASE_URL + file);
    });
  }

  // 批量确保 Geo 数据库就绪：缺失（或文件过小）时从国内加速镜像下载到配置目录
  // failOnMissing=true 时任一文件失败即返回失败（用于启动前必须就绪的最小库）；
  // 否则失败仅告警不中断。下载开始/进度/完成均输出到日志面板
  async _ensureGeoDataFiles(files, failOnMissing) {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
    const missing = [];
    for (const item of files) {
      const dest = path.join(this.configDir, item.file);
      if (fs.existsSync(dest) && fs.statSync(dest).size >= item.minSize) continue;

      this.safeIpcSend('rule-log', { type: 'info', message: `[TUN] 开始下载 Geo 数据库: ${item.file}` });

      let ok = false;
      let lastErr = null;
      let lastPct = -1;
      for (const mirror of GEO_MIRRORS) {
        try {
          await this._downloadGeoFile(item.file, dest, mirror, (received, total) => {
            const pct = total ? Math.min(100, Math.round((received / total) * 100)) : -1;
            if (pct >= 0 && pct - lastPct >= 2) {
              lastPct = pct;
              this.safeIpcSend('rule-log', {
                type: 'info',
                message: `[TUN] 下载 ${item.file}: ${pct}%`,
                details: total
                  ? `${(received / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB`
                  : `${(received / 1024 / 1024).toFixed(1)} MB`,
              });
            }
          });
          this.safeIpcSend('rule-log', {
            type: 'success',
            message: `[TUN] Geo 数据库下载完成: ${item.file}`,
            details: `来源: ${mirror}`,
          });
          console.log(`[TUN] 已从镜像下载 Geo 数据库: ${item.file} (${mirror})`);
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
          console.warn(`[TUN] 镜像 ${mirror} 下载 ${item.file} 失败: ${e.message}`);
          this.safeIpcSend('rule-log', {
            type: 'error',
            message: `[TUN] 镜像下载失败 ${item.file}`,
            details: `${mirror}: ${e.message}`,
          });
        }
      }
      if (!ok) {
        if (failOnMissing) {
          missing.push(item.file);
        } else {
          console.warn(`[TUN] 数据库 ${item.file} 下载失败（不影响本次运行，下次启动自动重试）: ${lastErr ? lastErr.message : ''}`);
        }
      }
    }
    if (missing.length) {
      return { success: false, message: 'Geo 数据库下载失败（国内加速镜像均不可达）: ' + missing.join(', ') };
    }
    return { success: true };
  }

  // 启动前只确保最小必要库（geoip.metadb），保证尽快进入 TUN 运行状态
  async _ensureGeoDataMin() {
    return this._ensureGeoDataFiles(GEO_DATA_MIN, true);
  }

  // 启动成功后后台补齐其余数据库
  _ensureGeoDataExtra() {
    this._ensureGeoDataFiles(GEO_DATA_EXTRA, false)
      .then((r) => {
        if (!r.success) {
          console.warn('[TUN] 后台补齐其余 Geo 数据库未完全成功，下次启动将自动重试');
        }
      })
      .catch(() => { /* 忽略后台异常 */ });
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
      // 检查 mihomo 可执行文件；缺失时若有下载器则自动下载（进度会通过日志面板展示）
      if (!fs.existsSync(this.mihomoPath)) {
        if (this.resourceDownloader) {
          this.safeIpcSend('rule-log', { type: 'info', message: '[TUN] 检测到 TUN核心资源 缺失，开始下载 TUN 资源...' });
          const r = await this.resourceDownloader.ensure('tun');
          if (!r.ready || !fs.existsSync(this.mihomoPath)) {
            this.safeIpcSend('rule-log', {
              type: 'error',
              message: '[TUN] TUN 资源下载失败',
              details: r.message || '未知错误',
            });
            return { success: false, message: 'TUN 资源未就绪：' + (r.message || '下载失败') };
          }
          this.safeIpcSend('rule-log', { type: 'success', message: '[TUN] TUN 资源(mihomo/wintun)下载完成' });
        } else {
          return { success: false, message: 'mihomo 可执行文件不存在: ' + this.mihomoPath };
        }
      }

      // 检查 wintun.dll
      if (!fs.existsSync(this.wintunPath)) {
        this.safeIpcSend('rule-log', { type: 'error', message: '[TUN] wintun.dll 缺失', details: this.wintunPath });
        return { success: false, message: 'wintun.dll 不存在: ' + this.wintunPath };
      }

      // 确保配置目录存在
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }

      // 写入配置文件
      const config = this._generateConfig();
      fs.writeFileSync(this.configPath, config, 'utf-8');

      // 预置最小必要 GeoIP 数据库（geoip.metadb），避免 mihomo 启动时从 GitHub 下载失败
      const geo = await this._ensureGeoDataMin();
      if (!geo.success) {
        this.safeIpcSend('rule-log', { type: 'error', message: '[TUN] GeoIP 数据库就绪失败', details: geo.message });
        return { success: false, message: geo.message };
      }

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
      // 启动成功后后台补齐其余数据库
      this._ensureGeoDataExtra();
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
