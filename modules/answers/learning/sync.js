const https = require('https');
const crypto = require('crypto');
const { validate } = require('./policy');
const { digest } = require('./request');
const service = require('../../../resources/answer-policy-service.json');

function request(route, body) {
  if (!service.endpoint) throw new Error('尚未配置规则共享服务；本地生成、验证和使用不受影响');
  const url = new URL(service.endpoint.replace(/\/$/, '') + route);
  if (url.protocol !== 'https:') throw new Error('规则共享服务必须使用 HTTPS');
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(url, { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 1048576) req.destroy(new Error('共享响应过大')); else chunks.push(c); });
      res.on('error', reject);
      res.on('end', () => {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300) throw new Error('共享服务返回 HTTP ' + res.statusCode);
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('规则共享请求超时')), 10000);
    req.once('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(data);
  });
}
function verify(envelope, fingerprint, previous = null, keys = service.keys) {
  if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || Buffer.byteLength(envelope.payload) > 900000 || envelope.signature.length > 128) throw new Error('共享签名格式无效');
  const key = keys.find(k => k.id === envelope.keyId);
  if (!key || !crypto.verify(null, Buffer.from(envelope.payload), key.publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('共享规则签名验证失败');
  const manifest = JSON.parse(envelope.payload);
  if (!manifest || Object.keys(manifest).some(key => !['version', 'host', 'fingerprint', 'sequence', 'expiresAt', 'policies', 'revoked'].includes(key))) throw new Error('共享清单包含未知字段');
  if (![1, 2].includes(manifest.version) || (manifest.version === 1 ? manifest.fingerprint : manifest.host) !== fingerprint || !Number.isSafeInteger(manifest.sequence) || manifest.sequence < 0 || !Number.isFinite(manifest.expiresAt) || manifest.expiresAt <= Date.now() || manifest.expiresAt > Date.now() + 7 * 86400000 || !Array.isArray(manifest.policies) || manifest.policies.length > 50 || !Array.isArray(manifest.revoked) || manifest.revoked.length > 500) throw new Error('共享清单无效或已过期');
  const hash = digest(envelope.payload);
  if (previous && (manifest.sequence < previous.sequence || manifest.sequence === previous.sequence && hash !== previous.hash)) throw new Error('拒绝回滚或替换已发布的版本');
  const ids = new Set();
  if (manifest.revoked.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) || new Set(manifest.revoked).size !== manifest.revoked.length) throw new Error('撤销清单格式无效');
  for (const policy of manifest.policies) {
    if (!policy || Object.keys(policy).some(key => !['id', 'pair'].includes(key)) || ids.has(policy.id) || manifest.revoked.includes(policy.id)) throw new Error('共享规则重复、已撤销或包含未知字段');
    validate(policy.pair);
    if (policy.id !== digest(policy.pair) || (manifest.version === 1 ? policy.pair.version !== 1 || policy.pair.request.fingerprint !== fingerprint : policy.pair.version !== 2 || policy.pair.request.host !== fingerprint)) throw new Error('共享规则内容与请求范围不一致');
    ids.add(policy.id);
  }
  return { manifest, checkpoint: { sequence: manifest.sequence, hash } };
}
module.exports = {
  configured: () => !!service.endpoint && service.keys.length > 0,
  verify,
  download: host => request('/v2/answer-policies?host=' + encodeURIComponent(host)),
  // Only declarative rules go to the server, never captured responses or claimed approval flags.
  submit: pair => { validate(pair); return request('/v' + pair.version + '/answer-policies/candidates', { id: digest(pair), pair }); }
};
