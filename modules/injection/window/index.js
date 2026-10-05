const moduleLog = require('../../logging').create('注入窗口');
const { BrowserWindow } = require('electron');
const path = require('path');

module.exports = {
showProgressWindow() {
    try {
      if (this.progressWindow && !this.progressWindow.isDestroyed()) {
        this.progressWindow.show();
        return;
      }

      this._progressWindowReady = false;
      this.progressWindow = new BrowserWindow({
        width: 400,
        height: 160,
        frame: false,
        resizable: false,
        movable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
          preload: path.join(__dirname, '..', '..', '..', 'build', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      // 加载独立的进度窗口HTML文件（替代内联data URL方式）
      const htmlPath = path.join(__dirname, 'index.html');
      this.progressWindow.loadFile(htmlPath).catch(error => {
        moduleLog.error('进度窗口页面加载失败：', error);
      });

      // 窗口加载完成后标记就绪，避免在DOM未就绪时发送IPC消息导致消息丢失
      this.progressWindow.webContents.on('did-finish-load', () => {
        this._progressWindowReady = true;
      });

      this.progressWindow.on('closed', () => {
        this.progressWindow = null;
        this._progressWindowReady = false;
      });
    } catch (error) {
      moduleLog.error('创建进度窗口失败:', error);
    }
  },

sendProgress(step, message, percent) {
    try {
      // 通过IPC发送进度更新到渲染进程（替代executeJavaScript方式，更安全可靠）
      if (this.progressWindow && !this.progressWindow.isDestroyed() && this._progressWindowReady) {
        this.progressWindow.webContents.send('progress-update', {
          message: message,
          percent: percent || 0
        });
      }
      this.safeIpcSend('rule-log', moduleLog.event({
        type: step === 'error' ? 'error' : (step === 'done' ? 'success' : 'info'),
        message: `[动态注入] ${message} (${percent || 0}%)`
      }));
    } catch (error) {}
  },

closeProgressWindow() {
    try {
      if (this.progressWindow && !this.progressWindow.isDestroyed()) {
        this.progressWindow.close();
        this.progressWindow = null;
      }
    } catch (error) {}
  }
};
