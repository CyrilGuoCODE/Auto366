const { app, ipcMain, protocol } = require('electron');
const path = require('path');

// 导入模块
const WindowManager = require('./modules/window');
const ProxyServer = require('./modules/proxy');
const CertificateManager = require('./modules/cert');
const RulesManager = require('./modules/rules');
const RulesLoader = require('./modules/rules-loader');
const AnswerExtractor = require('./modules/answer');
const UpdateManager = require('./modules/update');
const FileManager = require('./modules/file');

class Auto366App {
  constructor() {
    this.windowManager = null;
    this.certManager = null;
    this.proxyServer = null;
    this.rulesManager = null;
    this.rulesLoader = null;
    this.answerExtractor = null;
    this.updateManager = null;
    this.fileManager = null;

    this.init();
  }

  // 初始化应用
  init() {
    // 应用事件
    app.whenReady().then(() => {
      // 注册协议
      this.registerProtocol();
      // 初始化所有模块
      this.windowManager = new WindowManager();
      this.certManager = new CertificateManager();
      this.proxyServer = new ProxyServer(this.certManager);
      this.rulesManager = new RulesManager();
      this.rulesLoader = new RulesLoader();
      this.answerExtractor = new AnswerExtractor();
      this.updateManager = new UpdateManager();
      this.fileManager = new FileManager();

      this.createWindow();
      this.initIpcListeners();
      this.checkForUpdates();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (!this.windowManager || this.windowManager.mainWindow === null) {
        // 重新初始化模块
        this.windowManager = new WindowManager();
        this.certManager = new CertificateManager();
        this.proxyServer = new ProxyServer(this.certManager);
        this.rulesManager = new RulesManager();
        this.rulesLoader = new RulesLoader();
        this.answerExtractor = new AnswerExtractor();
        this.updateManager = new UpdateManager();
        this.fileManager = new FileManager();
        
        this.createWindow();
        this.initIpcListeners();
      }
    });
  }

  // 注册协议
  registerProtocol() {
    protocol.registerFileProtocol('auto366', (request, callback) => {
      const url = request.url.replace('auto366://', '');
      const filePath = path.join(__dirname, url);
      callback({ path: filePath });
    });
  }

  // 创建窗口
  createWindow() {
    this.windowManager.createWindow();
    // 打开开发者工具
    if (this.windowManager.mainWindow) {
      this.windowManager.mainWindow.webContents.openDevTools();
    }
  }

  // 初始化IPC监听器
  initIpcListeners() {
    // 窗口控制
    ipcMain.handle('toggle-always-on-top', () => this.windowManager.toggleAlwaysOnTop());
    ipcMain.handle('get-always-on-top', () => this.windowManager.getAlwaysOnTop());
    ipcMain.handle('window-is-maximized', () => this.windowManager.windowIsMaximized());
    ipcMain.handle('window-toggle-maximize', () => this.windowManager.windowToggleMaximize());
    ipcMain.handle('window-minimize', () => this.windowManager.windowMinimize());
    ipcMain.handle('window-close', () => this.windowManager.windowClose());
    ipcMain.handle('get-app-version', () => this.windowManager.getAppVersion());

    // 代理控制
    ipcMain.handle('start-answer-proxy', () => this.startProxy());
    ipcMain.handle('stop-answer-proxy', () => this.stopProxy());
    ipcMain.handle('get-proxy-port', () => this.proxyServer.getProxyPort());
    ipcMain.handle('set-proxy-port', (_, port) => this.proxyServer.setProxyPort(port));
    ipcMain.handle('get-bucket-port', () => this.proxyServer.getBucketPort());
    ipcMain.handle('set-bucket-port', (_, port) => this.proxyServer.setBucketPort(port));
    ipcMain.handle('get-answer-capture-enabled', () => this.proxyServer.getAnswerCaptureEnabled());
    ipcMain.handle('set-answer-capture-enabled', (_, enabled) => this.proxyServer.setAnswerCaptureEnabled(enabled));

    // 规则管理
    ipcMain.handle('get-rules', () => this.rulesManager.getRules());
    ipcMain.handle('save-rule', (_, rule) => this.rulesManager.saveRule(rule));
    ipcMain.handle('delete-rule', (_, ruleId) => this.rulesManager.deleteRule(ruleId));
    ipcMain.handle('toggle-rule', (_, ruleId, enabled) => this.rulesManager.toggleRule(ruleId, enabled));
    ipcMain.handle('reset-rule-triggers', (_, ruleId) => this.rulesManager.resetRuleTriggers(ruleId));
    ipcMain.handle('save-response-rules', (_, rules) => {
      this.rulesManager.rules = rules;
      return this.rulesManager.saveRules();
    });

    // 文件操作
    ipcMain.handle('open-directory-choosing', () => this.fileManager.openDirectoryDialog());
    ipcMain.handle('open-implant-zip-choosing', () => this.fileManager.openFileDialog({
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    }));
    ipcMain.handle('download-file', (_, uuid) => this.downloadFile(uuid));
    ipcMain.handle('clear-cache', () => this.fileManager.clearCache());
    ipcMain.handle('remove-cache-file', () => this.removeCacheFile());
    ipcMain.handle('share-answer-file', (_, filePath) => this.shareAnswerFile(filePath));
    ipcMain.handle('save-injection-package', (_, data) => this.saveInjectionPackage(data));

    // UI模式
    ipcMain.handle('get-ui-mode', () => this.getUIMode());
    ipcMain.handle('switch-ui-mode', (_, mode) => this.switchUIMode(mode));

    // 更新管理
    ipcMain.handle('check-for-updates', () => this.updateManager.checkForUpdates());
    ipcMain.handle('update-confirm', () => this.confirmUpdate());
    ipcMain.handle('update-install', () => this.installUpdate());

    // 代理服务器事件
    this.proxyServer.on('trafficLog', (data) => {
      this.windowManager.sendToRenderer('traffic-log', data);
    });

    // 更新事件
    this.updateManager.on('downloadProgress', (progress) => {
      this.windowManager.sendToRenderer('update-download-progress', progress);
    });
  }

  // 启动代理
  async startProxy() {
    try {
      // 启动代理服务器
      const result = await this.proxyServer.start(this.windowManager.mainWindow);
      this.windowManager.sendToRenderer('proxy-status', result);
      return result;
    } catch (error) {
      console.error('启动代理失败:', error);
      this.windowManager.sendToRenderer('proxy-error', { message: error.message });
      return { running: false, error: error.message };
    }
  }

  // 停止代理
  async stopProxy() {
    try {
      const result = await this.proxyServer.stop();
      this.windowManager.sendToRenderer('proxy-status', { running: false });
      return result;
    } catch (error) {
      console.error('停止代理失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 下载文件
  async downloadFile(uuid) {
    try {
      // 这里需要实现具体的下载逻辑
      return 1; // 成功
    } catch (error) {
      console.error('下载文件失败:', error);
      return 0; // 失败
    }
  }

  // 移除缓存文件
  removeCacheFile() {
    try {
      // 这里需要实现具体的缓存清理逻辑
      return { success: true, filesDeleted: 0, dirsDeleted: 0 };
    } catch (error) {
      console.error('清理缓存文件失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 分享答案文件
  async shareAnswerFile(filePath) {
    try {
      // 这里需要实现具体的分享逻辑
      return { success: true, downloadUrl: 'https://example.com/download' };
    } catch (error) {
      console.error('分享答案文件失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 保存注入包
  async saveInjectionPackage(data) {
    try {
      // 这里需要实现具体的保存逻辑
      return { path: 'path/to/injection.zip' };
    } catch (error) {
      console.error('保存注入包失败:', error);
      return { error: error.message };
    }
  }

  // 获取UI模式
  getUIMode() {
    // 从本地存储或配置文件中获取UI模式
    return 'professional'; // 默认专业模式
  }

  // 切换UI模式
  switchUIMode(mode) {
    // 保存UI模式到本地存储或配置文件
    return { success: true };
  }

  // 检查更新
  async checkForUpdates() {
    try {
      const result = await this.updateManager.checkForUpdates();
      if (result.hasUpdate) {
        this.windowManager.sendToRenderer('update-available', result);
      }
    } catch (error) {
      console.error('检查更新失败:', error);
    }
  }

  // 确认更新
  confirmUpdate() {
    // 这里需要实现具体的更新确认逻辑
    this.updateManager.checkForUpdatesManually();
  }

  // 安装更新
  installUpdate() {
    // 这里需要实现具体的更新安装逻辑
  }
}

// 启动应用
new Auto366App();
