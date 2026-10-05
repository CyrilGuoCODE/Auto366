const ipcMain = require('../register').forModule('ai');

module.exports = function register() {
ipcMain.handle('set-ai-api-key', async (event, key) => {
      try {
        this.setAiApiKey(key);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

ipcMain.handle('get-ai-api-key', () => {
      return this.getAiApiKey();
    });

ipcMain.handle('set-ai-config', async (event, cfg) => {
      try {
        this.setAiConfig(cfg);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

ipcMain.handle('get-ai-config', () => {
      return this.getAiConfig();
    });

ipcMain.handle('test-ai-connection', async () => {
      try {
        return await this.testAiConnection();
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

};
