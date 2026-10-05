const moduleLog = require('../logging/index').create('更新');
const { app } = require('electron');
const ipcMain = require('../register').forModule('update');
const { autoUpdater } = require('electron-updater');

class UpdateManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.updateInfo = null;

    this.setupAutoUpdater();
    this.registerIpcHandlers();
  }

  setupAutoUpdater() {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'cyrilguocode',
      repo: 'Auto366'
    });

    autoUpdater.autoDownload = false;

    autoUpdater.on('update-available', (info) => {
      this.updateInfo = info;
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
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
        this.mainWindow.webContents.send('update-available', {
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: releaseNotes
        });
      }
    });

    autoUpdater.on('download-progress', (progressObj) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-download-progress', {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total,
          bytesPerSecond: progressObj.bytesPerSecond
        });
      }
    });

    autoUpdater.on('update-downloaded', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-downloaded');
      }
    });

    autoUpdater.on('error', (error) => {
      moduleLog.error('更新检查失败:', error);
    });

    autoUpdater.on('update-not-available', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-not-available', {});
      }
    });
  }

  registerIpcHandlers() {
    ipcMain.on('update-confirm', async () => {
      if (this.updateInfo) {
        try { await autoUpdater.downloadUpdate(); }
        catch (error) { moduleLog.error('下载更新失败：', error); }
      }
    });

    ipcMain.on('update-install', () => {
      autoUpdater.quitAndInstall(false, true);
    });

    ipcMain.handle('check-for-updates', () => {
      if (!app.isPackaged) return { hasUpdate: false, isDev: true, message: '开发环境不支持自动更新' };
      if (this.checking) return this.checking;
      this.checking = new Promise(resolve => {
        let settled = false;
        const finish = result => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          autoUpdater.removeListener('update-available', available);
          autoUpdater.removeListener('update-not-available', unavailable);
          autoUpdater.removeListener('error', failed);
          resolve(result);
        };
        const available = info => finish({ hasUpdate: true, version: info.version, releaseNotes: info.releaseNotes, releaseDate: info.releaseDate });
        const unavailable = () => finish({ hasUpdate: false, message: '当前已是最新版本' });
        const failed = error => finish({ hasUpdate: false, error: error.message });
        const timer = setTimeout(() => finish({ hasUpdate: false, message: '检查更新超时' }), 20000);
        autoUpdater.once('update-available', available);
        autoUpdater.once('update-not-available', unavailable);
        autoUpdater.once('error', failed);
        Promise.resolve().then(() => autoUpdater.checkForUpdates()).catch(failed);
      }).finally(() => { this.checking = null; });
      return this.checking;
    });
  }

  checkForUpdatesOnStartup() {
    if (app.isPackaged) {
      setTimeout(() => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          Promise.resolve(require('../config/index').get('auto-check-updates') !== 'false').then(autoCheckEnabled => {
            if (autoCheckEnabled) {
              moduleLog.log('应用启动，开始检查更新...');
              autoUpdater.checkForUpdates().catch(error => {
                moduleLog.error('启动时检查更新失败:', error);
              });
            } else {
              moduleLog.log('自动检查更新已禁用');
            }
          }).catch(error => {
            moduleLog.error('获取自动检查更新设置失败:', error);
            moduleLog.log('获取设置失败，默认检查更新...');
            autoUpdater.checkForUpdates().catch(error => {
              moduleLog.error('默认检查更新失败:', error);
            });
          });
        }
      }, 1000);
    }
  }
}

module.exports = UpdateManager;
