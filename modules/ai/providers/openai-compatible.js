const http = require('http');
const https = require('https');

module.exports = async function ask(config, prompt, options = {}) {
  if (!config.baseUrl?.trim()) throw new Error('未配置 API 地址');
  const endpoint = new URL(config.baseUrl.trim());
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('无效 AI 接口地址');
  const timeout = Number.isFinite(Number(options.timeout)) && Number(options.timeout) > 0
    ? Math.min(Number(options.timeout), 120000) : 30000;
  const body = JSON.stringify({ model: config.model || undefined,
    messages: [{ role: 'user', content: prompt }], max_tokens: options.maxTokens || 2500, stream: false });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  // Anonymous services must not receive a fake key or a retained key from another preset.
  if (config.key?.trim()) headers.Authorization = 'Bearer ' + config.key.trim();
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const req = (endpoint.protocol === 'https:' ? https : http).request(endpoint, { method: 'POST', headers }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 131072) req.destroy(new Error('AI 响应过大'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('AI 响应中断')));
      res.on('end', () => {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300) throw new Error('AI 接口返回 HTTP ' + res.statusCode);
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const text = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text;
          if (typeof text !== 'string' || !text.trim()) throw new Error('AI 返回内容为空');
          resolve({ text, ms: Date.now() - started });
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('AI 请求超时')), timeout);
    req.once('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(body);
  });
};
