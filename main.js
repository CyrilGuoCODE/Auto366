const moduleLog = require('./modules/logging').create('应用');
const logging = require('./modules/logging');
logging.initialize();
const { app, dialog, BrowserWindow, shell } = require('electron');
const ipcMain = require('./modules/register').forModule('app');

const WindowManager = require('./modules/window/index');
const ProxyServer = require('./modules/proxy/index');
const AiManager = require('./modules/ai');
const CertificateManager = require('./modules/proxy/cert');
const RulesManager = require('./modules/rules/index');
const FileManager = require('./modules/file/index');
const UpdateManager = require('./modules/app/update');
const RulesLoader = require('./modules/rules/loader');
const ProcessMonitor = require('./modules/app/monitor');
const AnalyticsManager = require('./modules/app/analytics');
const AgreementManager = require('./modules/app/agreement');
const TunManager = require('./modules/proxy/tun');
const SpeedManager = require('./modules/speed');
const TtsManager = require('./modules/tts/index');
const ResourceDownloader = require('./modules/resources/index');

let mainWindow;
let proxyServer;
let aiManager;
let updateManager;
let processMonitor;
let analyticsManager;
let tunManager;
let speedManager;
let ttsManager;
let resourceDownloader;

process.on('uncaughtException', (error) => {
  if (error.code === 'ECONNRESET') {
    moduleLog.log('网络连接被重置，这可能是因为远程服务器主动关闭了连接');
    return;
  }
  moduleLog.error(error);
});

process.on('unhandledRejection', (reason) => {
  if (reason?.code === 'ECONNRESET') {
    moduleLog.log('网络连接被重置，这可能是因为远程服务器主动关闭了连接');
    return;
  }
  moduleLog.error(reason);
});

app.whenReady().then(async () => {
  logging.register();
  require('./modules/config').register(() => {
    logging.restorePreferences();
    proxyServer?.loadConfig();
    aiManager?.loadConfig();
    ttsManager?._loadConfig();
    updateManager?.checkForUpdatesOnStartup();
  });
  // 初始化数据分析
  analyticsManager = new AnalyticsManager();
  analyticsManager.init();
  analyticsManager.registerIpcHandlers();
  analyticsManager.capture('app_launched');

  const windowManager = new WindowManager();
  mainWindow = windowManager.createWindow();

  updateManager = new UpdateManager(mainWindow);

  const certManager = new CertificateManager();
  const rulesManager = new RulesManager();
  ttsManager = new TtsManager();
  aiManager = new AiManager();
  proxyServer = new ProxyServer(certManager, rulesManager, analyticsManager, ttsManager);
  proxyServer.answerLearning = new (require('./modules/answers/learning'))({
    getAiConfig: () => aiManager.getAiConfig(),
    notify: (channel, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
    }
  });
  proxyServer.answerLearning.register();
  const fileManager = new FileManager(process.cwd());
  const rulesLoader = new RulesLoader(app.getAppPath());
  processMonitor = new ProcessMonitor();
  const agreementManager = new AgreementManager();
  agreementManager.init();
  resourceDownloader = new ResourceDownloader();
  resourceDownloader.init();  // 创建目录 + 迁移旧版 TTS/TUN 资源
  tunManager = new TunManager(proxyServer, resourceDownloader);
  speedManager = new SpeedManager();
  speedManager.init(app.getAppPath(), mainWindow);
  proxyServer.speedManager = speedManager;  // 代理在关键请求期间对加速做"网络保护"
  ttsManager.init(app.getAppPath(), mainWindow, rulesManager);
  ttsManager.setResourceDownloader(resourceDownloader);

  proxyServer.localServer = new (require('./modules/local-server'))({
    proxy: proxyServer, ai: aiManager, tts: ttsManager,
    output: proxyServer.answerOutput, appPath: process.cwd(),
  });

  windowManager.registerIpcHandlers();
  rulesManager.registerIpcHandlers();
  proxyServer.registerIpcHandlers(dialog, mainWindow);
  require('./modules/injection/ipc').call(proxyServer.injection);
  aiManager.registerIpcHandlers();
  require('./modules/answers/sharing')();
  require('./modules/rules/extensions')({ appPath: process.cwd() });
  fileManager.registerIpcHandlers(mainWindow);
  require('./modules/answers/export')({ files: fileManager, windowManager });
  processMonitor.registerIpcHandlers(mainWindow);
  tunManager.registerIpcHandlers(mainWindow);
  speedManager.registerIpcHandlers(mainWindow);
  ttsManager.registerIpcHandlers(mainWindow);
  resourceDownloader.registerIpcHandlers(mainWindow);

  certManager.registerIpcHandlers();

  ipcMain.handle('restart-app', async () => {
    app.relaunch();
    app.quit();
  });

  ipcMain.handle('open-url', (event, url) => shell.openExternal(url));

  await rulesLoader.loadBuiltinRulesets(rulesManager);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = windowManager.createWindow();
    }
  });
}).catch(error => {
  moduleLog.error('应用启动失败：', error);
  dialog.showErrorBox('Auto366 启动失败', error.stack || String(error));
  app.quit();
});

let cleanupStarted = false;
let cleanupFinished = false;
app.on('before-quit', async event => {
  if (cleanupFinished) return;
  event.preventDefault();
  if (cleanupStarted) return;
  cleanupStarted = true;
  try {
    proxyServer?.answerLearning?.dispose();
    for (const manager of [resourceDownloader, processMonitor, tunManager, proxyServer, speedManager, ttsManager]) {
      try { if (manager) await manager.stop(); }
      catch (error) { moduleLog.error('停止后台模块失败：', error); }
    }
    await proxyServer?.trafficCache.dispose();
    if (analyticsManager) {
      analyticsManager.capture('app_closed');
      // Analytics must not hold the application open indefinitely during shutdown.
      let timer;
      try {
        await Promise.race([analyticsManager.shutdown(), new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
      } finally { clearTimeout(timer); }
    }
  } catch (error) {
    moduleLog.error('退出清理失败：', error);
  } finally {
    try { await logging.close(); }
    catch (error) { moduleLog.error('关闭日志失败：', error); }
    finally { cleanupFinished = true; app.quit(); }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
