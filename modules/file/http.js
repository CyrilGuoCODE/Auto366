const fs = require('fs-extra');
const path = require('path');
const { readBody, json } = require('../local-server/io');

module.exports = function createHandlers({ appPath }) {
  const timestamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  async function save(res, content, filename) {
    if (typeof content !== 'string') throw new Error('content 必须是字符串');
    // Export endpoints accept filenames, never paths outside temp.
    if (typeof filename !== 'string' || !filename || filename === '.' || filename === '..' || /[\\/:\x00-\x1f]/.test(filename)) {
      throw new Error('无效文件名');
    }
    const directory = path.join(appPath, 'temp');
    await fs.ensureDir(directory);
    const filePath = path.join(directory, filename);
    await fs.writeFile(filePath, content, 'utf8');
    json(res, { success: true, path: filePath });
  }
  return {
    async log(req, res) {
      const { content, name } = JSON.parse(await readBody(req));
      const tag = String(name || 'auto-pk').replace(/[^\w.-]/g, '').slice(0, 40) || 'auto-pk';
      await save(res, content, tag + '-logs-' + timestamp() + '.txt');
    },
    async collected(req, res) {
      const { content, filename } = JSON.parse(await readBody(req));
      await save(res, content, filename || 'collected-data-' + timestamp() + '.json');
    },
  };
};
