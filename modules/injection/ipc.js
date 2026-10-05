const moduleLog = require('../logging').create('注入');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');
const registry = require('../register');
const ipcMain = registry.forModule('injection');

module.exports = function register({ directory } = {}) {
  const targetDir = path.resolve(directory || path.join(app.isPackaged ? path.dirname(process.execPath) : process.cwd(), 'file'));
  const chooseZip = async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Zip Files', extensions: ['zip'] }] });
    if (!result.canceled) this.safeIpcSend('choose-implant-zip', result.filePaths[0]);
  };
  ipcMain.on('open-implant-zip-choosing', chooseZip);
  registry.forModule('app', { legacy: false }).on('open-implant-zip-choosing', chooseZip);

  // 所有保存入口复用同一份文件名、ZIP 头和冲突检查；不信任远端传来的摘要。
  const save = async (data, fileName, keepExisting = false) => {
    try {
      if (typeof fileName !== 'string' || !fileName || /[<>:"/\\|?*\x00-\x1f]/.test(fileName)
        || /[. ]$/.test(fileName) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(fileName)
        || path.extname(fileName).toLowerCase() !== '.zip') throw new Error('无效注入包文件名');
      const buffer = Buffer.from(data);
      if (buffer.length < 4 || ![0x04034b50, 0x06054b50].includes(buffer.readUInt32LE(0))) throw new Error('文件不是 ZIP 注入包');
      await fs.ensureDir(targetDir);
      const target = path.resolve(targetDir, fileName);
      if (path.dirname(target) !== targetDir) throw new Error('注入包路径越界');
      let finalPath = target;
      if (keepExisting && await fs.pathExists(target)) {
        const digest = value => crypto.createHash('sha256').update(value).digest('hex');
        if (digest(await fs.readFile(target)) === digest(buffer)) return { success: true, skipped: true, path: target, localPath: target, finalFileName: fileName };
        finalPath = path.join(targetDir, `${path.parse(fileName).name}_${crypto.randomUUID()}.zip`);
      }
      const temporary = path.join(targetDir, `.injection-${crypto.randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, buffer, { flag: 'wx' });
        await fs.rename(temporary, finalPath);
      } finally { await fs.remove(temporary); }
      const finalFileName = path.basename(finalPath);
      return { success: true, path: finalPath, localPath: finalPath, originalFileName: fileName, finalFileName, renamed: finalFileName !== fileName };
    } catch (error) {
      moduleLog.error('保存注入包失败：', error);
      return { success: false, error: error.message };
    }
  };
  ipcMain.handle('save-injection-package', (_event, data) => save(data?.buffer, data?.fileName, true));
  ipcMain.handle('download-and-save-injection-package', (_event, buffer, fileName) => save(buffer, fileName));
  // 保留历史 with-md5 通道，但实际比较本地计算的 SHA256。
  ipcMain.handle('download-and-save-injection-package-with-md5', (_event, buffer, fileName) => save(buffer, fileName, true));
  ipcMain.handle('import-implant-zip', async (_event, sourcePath) => {
    try { return await save(await fs.readFile(sourcePath), path.basename(sourcePath), true); }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('download-and-import-injection-package', (_event, buffer, name = 'injection') =>
    save(buffer, `${String(name).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')}.zip`, true));
};
