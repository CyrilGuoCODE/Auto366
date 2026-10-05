const { createHash } = require('crypto');

const PRIVATE = /token|cookie|authorization|password|secret|session|signature|(?:^|_)(?:user|student|account|phone|email|name|uid|sid|timestamp|nonce)(?:$|_)/i;
const DISCRIMINATOR = /^(?:type|qtype|questiontype|tasktype|category|action|mode|version|format)$/i;
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function shape(value, depth = 0) {
  if (depth > 8) return 'nested';
  if (value === null) return 'null';
  if (Array.isArray(value)) return { array: [...new Set(value.slice(0, 32).map(v => canonical(shape(v, depth + 1))))].sort() };
  if (typeof value !== 'object') return typeof value;
  return Object.fromEntries(Object.keys(value).sort().filter(k => !PRIVATE.test(k)).slice(0, 100).map(k => [k, shape(value[k], depth + 1)]));
}
// 仅用于读取旧版 v1 策略；新规则不再计算或比较请求指纹。
function fingerprint(sample) {
  const url = new URL(sample.url);
  const contentType = String(sample.requestContentType || '').split(';')[0].toLowerCase().trim();
  let body = sample.requestBody || '';
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch {
      if (contentType === 'application/x-www-form-urlencoded') {
        const params = new URLSearchParams(body);
        body = Object.fromEntries([...new Set(params.keys())].sort().map(k => [k, params.getAll(k).sort()]));
      }
    }
  }
  const query = [...url.searchParams].filter(([k]) => !PRIVATE.test(k)).map(([k, v]) => [k, DISCRIMINATOR.test(k) ? v : '*']).sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const types = [];
  function visit(value, parts = []) {
    if (!value || typeof value !== 'object' || parts.length > 8) return;
    for (const k of Object.keys(value).slice(0, 100)) {
      if (PRIVATE.test(k)) continue;
      const item = value[k];
      if (DISCRIMINATOR.test(k) && (['string', 'number', 'boolean'].includes(typeof item) || Array.isArray(item) && item.every(v => typeof v === 'string'))) types.push([parts.concat(k).join('.'), item]);
      else visit(item, parts.concat(Array.isArray(value) ? '*' : k));
    }
  }
  visit(body);
  const gate = { version: 1, host: url.host.toLowerCase(), method: String(sample.method || 'GET').toUpperCase(), path: url.pathname, contentType, query, bodyShape: shape(body), types: types.sort((a, b) => canonical(a).localeCompare(canonical(b))) };
  return { gate, id: digest(gate), text: canonical(gate) };
}
// 不包含请求头；可用于自动生成的样本需经过脱敏。
function redact(value, depth = 0) {
  if (depth > 12) return '[nested]';
  if (typeof value === 'string') return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').replace(/\b1[3-9]\d{9}\b/g, '[phone]');
  if (Array.isArray(value)) return value.slice(0, 300).map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, PRIVATE.test(k) ? '[redacted]' : redact(v, depth + 1)]));
  return value;
}
function redactResponse(text) {
  try { return JSON.stringify(redact(JSON.parse(text))); }
  catch { return redact(text).replace(/((?:token|cookie|authorization|password|session|secret)\s*[:=]\s*)[^\s<>&,;]+/gi, '$1[redacted]'); }
}
function requestText(sample) {
  const url = new URL(sample.url);
  url.username = ''; url.password = ''; url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (PRIVATE.test(key)) url.searchParams.delete(key);
  }
  const method = String(sample.method || 'GET').toUpperCase();
  let body = String(sample.requestBody || '');
  if (/application\/x-www-form-urlencoded/i.test(sample.requestContentType || '')) {
    const params = new URLSearchParams(body);
    for (const key of [...params.keys()]) if (PRIVATE.test(key)) params.delete(key);
    body = params.toString();
  } else body = redactResponse(body);
  return method + ' ' + redactResponse(url.href) + '\n' + body;
}
module.exports = { canonical, digest, fingerprint, redactResponse, requestText };
