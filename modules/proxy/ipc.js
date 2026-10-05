const moduleLog = require('../logging').create('代理');
const ipcMain = require('../register').forModule('proxy');

module.exports = function register(mainWindow) {
ipcMain.handle('clear-traffic-cache', () => { this.trafficCache.clear(); return { success: true }; });
ipcMain.on('start-answer-proxy', async () => {
      try {
        const result = await this.start(mainWindow);
        if (result.running) this.analyticsManager?.capture('proxy_started');
      } catch (error) {
        moduleLog.error('启动代理服务器失败：', error);
        this.safeIpcSend('proxy-status', { running: false, error: error.message });
      }
    });

ipcMain.on('stop-answer-proxy', async () => {
      try {
        const result = await this.stop();
        if (result.success) this.analyticsManager?.capture('proxy_stopped');
      } catch (error) {
        moduleLog.error('停止代理服务器失败:', error);
      }
    });

ipcMain.handle('set-proxy-port', async (event, port) => {
      try {
        this.setProxyPort(port);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

ipcMain.handle('get-proxy-port', () => {
      return this.getProxyPort();
    });

ipcMain.handle('set-bucket-port', async (event, port) => {
      try {
        this.setBucketPort(port);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

ipcMain.handle('get-bucket-port', () => {
      return this.getBucketPort();
    });

ipcMain.handle('set-answer-capture-enabled', (event, enabled) => {
      this.setAnswerCaptureEnabled(enabled);
      return { success: true };
    });

ipcMain.handle('get-answer-capture-enabled', () => {
      return this.getAnswerCaptureEnabled();
    });
};
