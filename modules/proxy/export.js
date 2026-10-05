const moduleLog = require('../logging').create('代理');
const fs = require('fs-extra');

const ipcMain = require('../register').forModule('proxy');

module.exports = function register(dialog) {
ipcMain.handle('download-file', async (event, uuid) => {
      let traffic = this.getTrafficByUuid(uuid);
      if (!traffic) return 0;

      const capture = traffic.captureBody?.retain();
      try {
      let contentType = traffic.contentType;
      if (!contentType && traffic.responseHeaders) {
        contentType = traffic.responseHeaders['content-type'];
      }

      let extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.txt`;
      let filters = [
        { name: 'All Files', extensions: ['*'] }
      ];
      let detectedType = null;
      if (contentType) {
        if (contentType.includes('json')) {
          detectedType = 'json';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.json`;
          filters.unshift({ name: 'JSON Files', extensions: ['json'] });
        } else if (contentType.includes('html')) {
          detectedType = 'html';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.html`;
          filters.unshift({ name: 'HTML Files', extensions: ['html'] });
        } else if (contentType.includes('xml')) {
          detectedType = 'xml';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.xml`;
          filters.unshift({ name: 'XML Files', extensions: ['xml'] });
        } else if (contentType.includes('javascript')) {
          detectedType = 'js';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.js`;
          filters.unshift({ name: 'JavaScript Files', extensions: ['js'] });
        } else if (contentType.includes('css')) {
          detectedType = 'css';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.css`;
          filters.unshift({ name: 'CSS Files', extensions: ['css'] });
        } else if (contentType.includes('image')) {
          detectedType = 'image';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.png`;
          filters.unshift({ name: 'Image Files', extensions: ['png'] });
        } else if (contentType.includes('octet-stream')) {
          detectedType = 'octet';
          extension = traffic.responseBody;
        }
      }

      if (!detectedType && traffic.responseBody) {
        try {
          JSON.parse(traffic.responseBody);
          detectedType = 'json';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.json`;
          filters.unshift({ name: 'JSON Files', extensions: ['json'] });
        } catch (e) {}
      }

      const result = await dialog.showSaveDialog({ defaultPath: extension, filters });
      if (result.canceled) return -1;
      try {
        if (capture?.file) {
          await fs.copyFile(capture.file, result.filePath);
        } else if (detectedType === 'json') {
          let jsonContent = traffic.responseBody || (traffic.originalResponse ? traffic.originalResponse.toString('utf-8') : '');
          try {
            jsonContent = JSON.stringify(JSON.parse(jsonContent), null, 2);
          } catch (e) {}
          await fs.writeFile(result.filePath, jsonContent, 'utf-8');
        } else {
          // Keep the selected response alive while the save dialog is open, even if history rolls over.
          if (!traffic.originalResponse) throw new Error('响应数据已不可用');
          await fs.writeFile(result.filePath, traffic.originalResponse);
        }
        return 1;
      } catch (error) {
        moduleLog.error('下载文件失败:', error);
        return 0;
      }
      } finally { await capture?.release(); }
    });

};
