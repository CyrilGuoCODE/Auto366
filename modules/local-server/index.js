const http = require('http');
const moduleLog = require('../logging').create('本地服务');
const { json } = require('./io');

class LocalServer {
  constructor({ proxy, ai, tts, output, appPath }) {
    const proxyHttp = require('../proxy/http')(proxy);
    const aiHttp = require('../ai/http')(ai);
    const fileHttp = require('../file/http')({ appPath });
    const ttsHttp = require('../tts/http')(tts);
    const answersHttp = require('../answers/http')({ output, appPath });
    // The only path table. Reserved endpoints precede dynamic TTS and answer paths.
    // Resolve dynamic paths per request; editing/enabling rules needs no restart.
    const fixed = (pathname, methods, handler) => ({
      match: ctx => ctx.pathname === pathname && (!methods || methods.includes(ctx.method)) && {}, handler,
    });
    const ttsRoute = (suffix, methods, handler, outputFile = false) => ({
      match: ctx => {
        if (methods && !methods.includes(ctx.method)) return false;
        for (const basePath of (ctx.ttsBasePaths ||= tts._getTtsBasePaths())) {
          if (!outputFile && ctx.pathname === basePath + suffix) return { basePath };
          if (outputFile && ctx.pathname.startsWith(basePath + suffix)) {
            const match = /^(\d+)\.(wav|mp3)$/.exec(ctx.pathname.slice((basePath + suffix).length));
            if (match) return { basePath, index: Number(match[1]) };
          }
        }
        return false;
      }, handler,
    });
    this.routes = [
      fixed('/a366-forward', ['POST'], proxyHttp.forward),
      fixed('/pk-time', ['GET', 'POST'], proxyHttp.pkTime),
      fixed('/listen-time', ['GET', 'POST'], proxyHttp.listenTime),
      fixed('/fill-time', ['GET', 'POST'], proxyHttp.fillTime),
      fixed('/listen-time-preset', ['GET'], proxyHttp.listenPreset),
      fixed('/ai-api-key', null, aiHttp.config),
      fixed('/ai-ask', ['POST'], aiHttp.ask),
      fixed('/save-log', ['POST'], fileHttp.log),
      fixed('/save-collected-data', ['POST'], fileHttp.collected),
      ttsRoute('/output/', null, ttsHttp.output, true),
      ttsRoute('/setting', ['GET', 'POST'], ttsHttp.setting),
      ttsRoute('/status', null, ttsHttp.status),
      ttsRoute('/list', null, ttsHttp.manifest),
      fixed('/', null, answersHttp.home),
      fixed('/listening-answer', null, answersHttp.latest),
      fixed('/speaking-answer', null, answersHttp.latest),
      { match: ctx => output.has(ctx.pathname) && {}, handler: answersHttp.published },
    ];
    this.server = null;
  }

  async handle(req, res) {
    try {
      const ctx = { pathname: new URL(req.url, 'http://127.0.0.1').pathname, method: req.method };
      for (const route of this.routes) {
        const params = route.match(ctx);
        if (params) { await route.handler(req, res, { ...ctx, ...params }); return; }
      }
      json(res, { error: 'not found' }, 404);
    } catch (error) {
      moduleLog.error('处理本地请求失败:', error);
      if (!res.headersSent) json(res, { success: false, error: error.message }, error.statusCode || 500);
      else if (!res.writableEnded) res.destroy(error);
    }
  }

  async start(port) {
    if (this.server) return;
    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;
    server.requestTimeout = 30000;
    server.on('error', error => moduleLog.error('本地服务监听失败:', error));
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      moduleLog.log('本地服务器已启动: http://127.0.0.1:' + server.address().port + '/');
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    const server = this.server;
    this.server = null;
    if (server) { server.close(); server.closeAllConnections?.(); }
  }
}
module.exports = LocalServer;
