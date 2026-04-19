const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.uiModePath = path.join(app.getPath('userData'), 'ui-mode');
  }

  readUiMode() {
    try {
      const v = fs.readFileSync(this.uiModePath, 'utf8').trim();
      if (v === 'simple' || v === 'professional') return v;
    } catch (e) {}
    return 'professional';
  }

  createWindow() {
    const mode = this.readUiMode();
    const winW = mode === 'simple' ? 875 : 1400;
    const winH = mode === 'simple' ? 1010 : 900;

    this.mainWindow = new BrowserWindow({
      width: winW,
      height: winH,
      icon: path.join(__dirname, '../icon.png'),
      frame: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        enableRemoteModule: false,
        nodeIntegration: true,
      }
    });

    this.mainWindow.setMenu(null);

    this.mainWindow.on('maximize', () => {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('window-maximized', true);
      }
    });
    this.mainWindow.on('unmaximize', () => {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('window-maximized', false);
      }
    });

    this.mainWindow.loadFile('index.html');

    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.key === 'F12') {
        this.mainWindow.webContents.openDevTools({ mode: 'detach' });
        event.preventDefault();
      }
    });

    return this.mainWindow;
  }

  registerIpcHandlers() {
    ipcMain.handle('get-ui-mode', () => this.readUiMode());

    ipcMain.handle('switch-ui-mode', async (e, mode) => {
      if (mode !== 'simple' && mode !== 'professional') return { ok: false };
      try {
        fs.writeFileSync(this.uiModePath, mode, 'utf8');
      } catch (err) {
        console.error('写入 ui-mode 失败:', err);
        return { ok: false };
      }
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (mode === 'simple') {
          this.mainWindow.setSize(875, 1010);
        } else {
          this.mainWindow.setSize(1400, 900);
        }
        this.mainWindow.center();
      }
      return { ok: true };
    });

    ipcMain.handle('toggle-always-on-top', () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        return { success: false, isAlwaysOnTop: false };
      }
      const next = !this.mainWindow.isAlwaysOnTop();
      this.mainWindow.setAlwaysOnTop(next);
      return { success: true, isAlwaysOnTop: next };
    });

    ipcMain.handle('get-always-on-top', () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        return false;
      }
      return this.mainWindow.isAlwaysOnTop();
    });

    ipcMain.on('window-minimize', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.minimize();
    });

    ipcMain.on('window-close', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.close();
    });

    ipcMain.handle('window-toggle-maximize', () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return { maximized: false };
      if (this.mainWindow.isMaximized()) {
        this.mainWindow.unmaximize();
        return { maximized: false };
      }
      this.mainWindow.maximize();
      return { maximized: true };
    });

    ipcMain.handle('window-is-maximized', () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;
      return this.mainWindow.isMaximized();
    });

    ipcMain.handle('get-scale-factor', () => {
      try {
        return Math.round(screen.getPrimaryDisplay().scaleFactor * 100);
      } catch (e) {
        return 100;
      }
    });

    ipcMain.on('set-global-scale', () => {});

    ipcMain.handle('get-action-types', (e, ruleType) => {
      if (ruleType === 'request') {
        return [
          { value: 'replace', label: '替换请求体', description: '' },
          { value: 'modify', label: '修改请求体', description: '' },
          { value: 'redirect', label: '重定向URL', description: '' }
        ];
      }
      if (ruleType === 'response-headers') {
        return [
          { value: 'modify', label: '修改响应头', description: '' },
          { value: 'remove', label: '删除响应头', description: '' }
        ];
      }
      return [
        { value: 'replace', label: '替换响应体', description: '' },
        { value: 'modify', label: '修改响应体', description: '' },
        { value: 'inject', label: '注入内容', description: '' }
      ];
    });

    ipcMain.handle('get-app-version', () => {
      return app.getVersion();
    });
  }

  getMainWindow() {
    return this.mainWindow;
  }
}

module.exports = WindowManager;
