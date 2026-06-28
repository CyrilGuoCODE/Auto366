const { app, ipcMain, dialog, BrowserWindow, shell } = require('electron');
const { createClient } = require('@supabase/supabase-js');

const WindowManager = require('./modules/window');
const ProxyServer = require('./modules/proxy');
const CertificateManager = require('./modules/cert');
const RulesManager = require('./modules/rules');
const FileManager = require('./modules/file');
const UpdateManager = require('./modules/update');
const RulesLoader = require('./modules/rules-loader');
const ProcessMonitor = require('./modules/process-monitor');
const AnalyticsManager = require('./modules/analytics');
const AgreementManager = require('./modules/agreement');
const TunManager = require('./modules/tun');

const SUPABASE_URL = 'https://myenzpblosjnrtvicdor.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15ZW56cGJsb3NqbnJ0dmljZG9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NjAxMzAsImV4cCI6MjA4MzUzNjEzMH0.XkwQ72RmH8l1_krYc_IdPXsFk5pwL5JXQ3mDZ-ax3mU';
const SUPABASE_BUCKET = 'auto366-share';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let mainWindow;
let proxyServer;
let windowManager;
let rulesManager;
let fileManager;
let updateManager;
let rulesLoader;
let processMonitor;
let analyticsManager;
let agreementManager;
let tunManager;

process.on('uncaughtException', (error) => {
  if (error.code === 'ECONNRESET') {
    console.log('网络连接被重置，这可能是因为远程服务器主动关闭了连接');
    return;
  }
  console.error(error);
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason.code === 'ECONNRESET') {
    console.log('网络连接被重置，这可能是因为远程服务器主动关闭了连接');
    return;
  }
  console.error(reason);
});

ipcMain.handle('open-directory-choosing', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.on('open-file-choosing', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
      { name: 'Videos', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv'] },
      { name: 'Archives', extensions: ['zip', 'rar', '7z', 'tar', 'gz'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf'] },
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'XML Files', extensions: ['xml'] },
      { name: 'HTML Files', extensions: ['html', 'htm'] }
    ]
  });
  if (!result.canceled) mainWindow.webContents.send('choose-file', result.filePaths[0]);
});

ipcMain.on('open-implant-zip-choosing', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Zip Files', extensions: ['zip'] }
    ]
  });
  if (!result.canceled) mainWindow.webContents.send('choose-implant-zip', result.filePaths[0]);
});

app.whenReady().then(async () => {
  // 初始化数据分析
  analyticsManager = new AnalyticsManager();
  analyticsManager.init();
  analyticsManager.registerIpcHandlers();
  analyticsManager.capture('app_launched');

  windowManager = new WindowManager();
  mainWindow = windowManager.createWindow();

  updateManager = new UpdateManager(mainWindow);
  updateManager.checkForUpdatesOnStartup();

  const certManager = new CertificateManager();
  rulesManager = new RulesManager();
  proxyServer = new ProxyServer(certManager, rulesManager, analyticsManager);
  fileManager = new FileManager(app.getAppPath());
  rulesLoader = new RulesLoader(app.getAppPath());
  processMonitor = new ProcessMonitor();
  agreementManager = new AgreementManager();
  agreementManager.init();
  tunManager = new TunManager(proxyServer);

  windowManager.registerIpcHandlers();
  rulesManager.registerIpcHandlers();
  proxyServer.registerIpcHandlers(dialog, mainWindow, supabase, SUPABASE_BUCKET, rulesManager);
  fileManager.registerIpcHandlers(mainWindow, windowManager);
  processMonitor.registerIpcHandlers(mainWindow);
  tunManager.registerIpcHandlers(mainWindow);

  // 注册代理启动/停止的分析追踪
  ipcMain.on('start-answer-proxy', () => {
    analyticsManager.capture('proxy_started');
  });
  ipcMain.on('stop-answer-proxy', () => {
    analyticsManager.capture('proxy_stopped');
  });

  ipcMain.handle('reset-certificate', async () => {
    try {
      return await certManager.resetCertificate();
    } catch (error) {
      return { success: false, deleted: 0, imported: false, errors: [error.message] };
    }
  });

  ipcMain.handle('restart-app', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('open-url', (event, url) => {
    shell.openExternal(url);
  });

  await rulesLoader.loadBuiltinRulesets(rulesManager);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = windowManager.createWindow();
    }
  });
});

app.on('before-quit', async () => {
  if (tunManager) {
    tunManager.stop();
  }
  if (analyticsManager) {
    analyticsManager.capture('app_closed');
    await analyticsManager.shutdown();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
