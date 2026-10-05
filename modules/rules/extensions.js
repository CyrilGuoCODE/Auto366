const fs = require('fs-extra');
const path = require('path');
const ipcMain = require('../register').forModule('extensions');

module.exports = function register({ appPath }) {
ipcMain.handle('download-rule-file', async (event, url) => {
      try {
        const https = require('https');
        const path = require('path');
        const fileDir = path.join(appPath, 'file');
        fs.ensureDirSync(fileDir);
        const dest = path.join(fileDir, url.split('/').pop());

        return await new Promise((resolve) => {
          const file = fs.createWriteStream(dest);
          https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(dest); });
          }).on('error', (err) => { fs.unlink(dest, () => {}); resolve(null); });
        });
      } catch (error) {
        return null;
      }
    });
};
