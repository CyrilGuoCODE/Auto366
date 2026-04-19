const { app, ipcMain, protocol, shell, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const WindowManager = require('./modules/window');
const ProxyServer = require('./modules/proxy');
const CertificateManager = require('./modules/cert');
const RulesManager = require('./modules/rules');

const SUPABASE_URL = 'https://myenzpblosjnrtvicdor.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15ZW56cGJsb3NqbnJ0dmljZG9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NjAxMzAsImV4cCI6MjA4MzUzNjEzMH0.XkwQ72RmH8l1_krYc_IdPXsFk5pwL5JXQ3mDZ-ax3mU';
const SUPABASE_BUCKET = 'auto366-share';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let mainWindow;
let updateInfo = null;
let proxyServer;
let windowManager;
let rulesManager;

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

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'cyrilguocode',
  repo: 'Auto366'
});

autoUpdater.autoDownload = false;

autoUpdater.on('update-available', (info) => {
  updateInfo = info;
  if (mainWindow && !mainWindow.isDestroyed()) {
    let releaseNotes = '新版本已发布，请更新以获得最新功能。';
    if (info.releaseNotes) {
      if (typeof info.releaseNotes === 'string') {
        releaseNotes = info.releaseNotes;
      } else if (info.releaseNotes.body) {
        releaseNotes = info.releaseNotes.body;
      } else if (Array.isArray(info.releaseNotes)) {
        releaseNotes = info.releaseNotes.join('\n');
      }
    }
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: releaseNotes
    });
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-download-progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
      bytesPerSecond: progressObj.bytesPerSecond
    });
  }
});

autoUpdater.on('update-downloaded', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded');
  }
});

autoUpdater.on('error', (error) => {
  console.error('更新检查失败:', error);
});

autoUpdater.on('update-not-available', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-not-available', {});
  }
});

ipcMain.on('update-confirm', async () => {
  if (updateInfo) {
    await autoUpdater.downloadUpdate();
  }
});

ipcMain.on('update-install', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { hasUpdate: false, isDev: true, message: '开发环境不支持自动更新' };
  }

  try {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ hasUpdate: false, message: '检查更新超时' });
      }, 20000);

      const onUpdateAvailable = (info) => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        autoUpdater.removeListener('error', onError);
        resolve({
          hasUpdate: true,
          version: info.version,
          releaseNotes: info.releaseNotes,
          releaseDate: info.releaseDate
        });
      };

      const onUpdateNotAvailable = () => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('error', onError);
        resolve({ hasUpdate: false, message: '当前已是最新版本' });
      };

      const onError = (error) => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        resolve({ hasUpdate: false, error: error.message });
      };

      autoUpdater.once('update-available', onUpdateAvailable);
      autoUpdater.once('update-not-available', onUpdateNotAvailable);
      autoUpdater.once('error', onError);

      autoUpdater.checkForUpdates().catch(error => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        autoUpdater.removeListener('error', onError);
        resolve({ hasUpdate: false, error: error.message });
      });
    });
  } catch (error) {
    console.error('检查更新失败:', error);
    return { hasUpdate: false, error: error.message };
  }
});

ipcMain.on('open-directory-choosing', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled) mainWindow.webContents.send('choose-directory', result.filePaths[0]);
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

async function loadBuiltinRulesets() {
  try {
    const rulesetsDir = path.join(__dirname, 'rulesets');
    if (!fs.existsSync(rulesetsDir)) {
      console.log('内置规则集目录不存在');
      return;
    }

    const folders = fs.readdirSync(rulesetsDir).filter(item => {
      const itemPath = path.join(rulesetsDir, item);
      return fs.statSync(itemPath).isDirectory();
    });

    for (const folderName of folders) {
      const folderPath = path.join(rulesetsDir, folderName);
      const rulesetJsonPath = path.join(folderPath, 'ruleset.json');
      const rulesJsonPath = path.join(folderPath, `${folderName}.json`);

      if (!fs.existsSync(rulesetJsonPath) || !fs.existsSync(rulesJsonPath)) {
        console.log(`跳过不完整的规则集: ${folderName}`);
        continue;
      }

      try {
        const rulesetInfo = JSON.parse(fs.readFileSync(rulesetJsonPath, 'utf-8'));
        let rulesData = JSON.parse(fs.readFileSync(rulesJsonPath, 'utf-8'));

        rulesData = rulesData.map(rule => {
          if (rule.type === 'zip-implant' && rule.zipImplant && !rule.zipImplant.startsWith('http')) {
            const zipPath = path.join(folderPath, rule.zipImplant);
            if (fs.existsSync(zipPath)) {
              rule.zipImplant = zipPath;
            }
          }
          return rule;
        });

        const groupId = uuidv4();
        const rulesetGroup = {
          id: groupId,
          name: rulesetInfo.name,
          description: rulesetInfo.description,
          isGroup: true,
          isBuiltin: true,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        const rules = rulesData.map(rule => ({
          ...rule,
          groupId: groupId,
          isBuiltin: true,
          createdAt: rule.createdAt || new Date().toISOString(),
          updatedAt: rule.updatedAt || new Date().toISOString()
        }));

        const existingRules = proxyServer.getResponseRules();
        const existingBuiltinGroup = existingRules.find(rule =>
          rule.isGroup && rule.isBuiltin && rule.name === rulesetInfo.name
        );

        if (existingBuiltinGroup) {
          console.log(`内置规则集已存在，跳过: ${rulesetInfo.name}`);
          continue;
        }

        proxyServer.responseRules = [...proxyServer.responseRules, rulesetGroup, ...rules];

        console.log(`成功导入内置规则集: ${rulesetInfo.name} (${rules.length} 个规则)`);
      } catch (error) {
        console.error(`导入规则集 ${folderName} 失败:`, error);
      }
    }

    proxyServer.saveResponseRules();
    console.log('内置规则集导入完成');
  } catch (error) {
    console.error('导入内置规则集失败:', error);
  }
}

app.whenReady().then(async () => {
  windowManager = new WindowManager();
  mainWindow = windowManager.createWindow();
  
  const certManager = new CertificateManager();
  proxyServer = new ProxyServer(certManager);
  rulesManager = new RulesManager();
  
  windowManager.registerIpcHandlers();
  proxyServer.registerIpcHandlers(dialog, mainWindow, supabase, SUPABASE_BUCKET, uuidv4, fs, path, os, require);
  rulesManager.registerIpcHandlers();

  await loadBuiltinRulesets();

  if (app.isPackaged) {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`
          localStorage.getItem('auto-check-updates') !== 'false'
        `).then(autoCheckEnabled => {
          if (autoCheckEnabled) {
            console.log('应用启动，开始检查更新...');
            autoUpdater.checkForUpdates().catch(error => {
              console.error('启动时检查更新失败:', error);
            });
          } else {
            console.log('自动检查更新已禁用');
          }
        }).catch(error => {
          console.error('获取自动检查更新设置失败:', error);
          console.log('获取设置失败，默认检查更新...');
          autoUpdater.checkForUpdates().catch(error => {
            console.error('默认检查更新失败:', error);
          });
        });
      }
    }, 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = windowManager.createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
