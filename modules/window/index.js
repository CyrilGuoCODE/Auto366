const moduleLog = require('../logging').create('窗口');
const { app, BrowserWindow, screen } = require('electron');
const ipcMain = require('../register').forModule('window');
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
      show: false,
      icon: path.join(__dirname, '../../icon.png'),
      frame: false,
      webPreferences: {
        preload: path.join(__dirname, '../../build/preload.js'),
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

    const window = this.mainWindow;
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show();
    });
    window.loadFile(path.join(__dirname, '../../index.html')).catch(error => {
      moduleLog.error('主窗口页面加载失败：', error);
      if (!window.isDestroyed()) window.show();
    });

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
        moduleLog.error('写入 ui-mode 失败:', err);
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

    ipcMain.handle('get-app-version', () => {
      return app.getVersion();
    });
  }

  // 将 HTML 内容导出为 PDF 缓冲区
  async exportHtmlToPdf(htmlContent) {
    let hiddenWindow = null;
    try {
      hiddenWindow = new BrowserWindow({
        show: false,
        width: 1200,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`;
      await hiddenWindow.loadURL(dataUrl);

      // 等待页面加载并渲染完成
      await new Promise((resolve) => setTimeout(resolve, 800));

      const pdfBuffer = await hiddenWindow.webContents.printToPDF({
        marginsType: 1,
        printBackground: true,
        printSelectionOnly: false,
        landscape: false
      });

      return { success: true, pdfBuffer };
    } catch (error) {
      moduleLog.error('生成 PDF 失败:', error);
      return { success: false, error: error.message };
    } finally {
      if (hiddenWindow && !hiddenWindow.isDestroyed()) {
        hiddenWindow.destroy();
      }
    }
  }
}

module.exports = WindowManager;
