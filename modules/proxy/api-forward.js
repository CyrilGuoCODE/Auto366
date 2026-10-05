const moduleLog = require('../logging').create('代理');
const http = require('http');
const https = require('https');
const url = require('url');

module.exports = {
async forwardApiRequest(rawBody, res) {
    const send = (status, obj) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(obj));
    };
    try {
      const data = JSON.parse(rawBody || '{}');
      const target = String(data.url || '');
      if (!/^https?:\/\//i.test(target)) return send(400, { success: false, error: '无效URL' });

      const method = String(data.method || 'GET').toUpperCase();
      const headers = (data.headers && typeof data.headers === 'object') ? data.headers : {};
      const h = {};
      Object.keys(headers).forEach(k => { h[k] = String(headers[k]); });
      // 页面传入的 cookie 未在 header 中时补上，用于登录态透传
      if (data.cookie && !h['Cookie']) h['Cookie'] = String(data.cookie);

      const u = url.parse(target);
      const lib = u.protocol === 'https:' ? https : http;
      // 诊断日志：转发请求显示在 Auto366 日志面板，便于排查登录态/接口返回
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'info',
        message: `[转发] ${method} ${target}`,
        url: target,
        details: `body: ${String(data.body || '').slice(0, 120)}`
      }));
      const req = lib.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.path,
        method: method,
        headers: h,
        timeout: 30000
      }, r => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => {
          const buf = Buffer.concat(chunks);
          const ctype = String(r.headers['content-type'] || '');
          let bodyOut = buf.toString('utf-8');
          if (/^application\/json/i.test(ctype)) {
            try { bodyOut = JSON.parse(bodyOut); } catch (e) { /* 保留原文 */ }
          }
          // 转发结果诊断（状态码 + 接口 code/msg）
          let diag = `HTTP ${r.statusCode}`;
          if (bodyOut && typeof bodyOut === 'object') {
            if (typeof bodyOut.code !== 'undefined') diag += `, code=${bodyOut.code} msg=${String(bodyOut.msg || '')}`;
            else if (bodyOut.result && typeof bodyOut.result.code !== 'undefined') {
              diag += `, result.code=${bodyOut.result.code} msg=${String(bodyOut.result.msg || '')}`;
            }
          }
          this.safeIpcSend('rule-log', moduleLog.event({
            type: 'info',
            message: `[转发结果] ${method} ${target} → ${diag}`,
            url: target,
            details: `body: ${String(bodyOut).slice(0, 200)}`
          }));
          send(200, { status: r.statusCode, headers: r.headers, body: bodyOut });
        });
      });
      req.on('error', e => send(500, { success: false, error: String(e && e.message || e) }));
      req.on('timeout', () => { req.destroy(new Error('forward timeout')); });
      if (data.body) req.write(String(data.body));
      req.end();
    } catch (e) {
      send(500, { success: false, error: String(e && e.message || e) });
    }
  }
};
