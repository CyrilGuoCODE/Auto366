const { app, ipcMain } = require('electron');
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
      console.error('更新检查失败:', error);
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
  }

  checkForUpdatesOnStartup() {
    if (app.isPackaged) {
      setTimeout(() => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.executeJavaScript(`
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
  }
}

module.exports = UpdateManager;
