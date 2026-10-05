const fs = require('fs-extra');
const path = require('path');
const { json } = require('../local-server/io');

module.exports = function createHandlers({ output, appPath }) {
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return {
    home(_req, res) {
      const paths = output.paths();
      const links = paths.length ? '<ul>' + paths.map(p => '<li><a href="' + escapeHtml('/' + p.replace(/^\/+/, '')) + '">' + escapeHtml(p) + '</a></li>').join('') + '</ul>'
        : '<p>暂无已上传的答案路径</p>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Auto366 Local Bucket Server</title></head><body><h1>Auto366 Local Bucket Server</h1><p>本地答案服务器运行中...</p><h2>已上传的答案路径:</h2>' + links + '</body></html>');
    },
    async latest(_req, res) {
      const directory = path.join(appPath, 'answers');
      const files = await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const latest = files.filter(f => f.startsWith('answers_') && f.endsWith('.json')).sort().pop();
      if (!latest) return json(res, { error: '答案尚未提取，请先启动代理捕获', code: 'ANSWER_NOT_FOUND' }, 404);
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(directory, latest), 'utf8'));
        json(res, parsed.answers || parsed);
      } catch (error) {
        json(res, { error: '答案文件解析失败', detail: error.message }, 500);
      }
    },
    published(_req, res, { pathname }) {
      const data = output.get(pathname);
      if (data !== undefined && typeof data === 'object' && !Buffer.isBuffer(data)) return json(res, data);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    },
  };
};
