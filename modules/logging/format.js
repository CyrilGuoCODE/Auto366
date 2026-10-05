const { formatWithOptions } = require('util');

const SECRET = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|api[-_]?key)$/i;
const ALIASES = { TtsManager: 'TTS', SpeedManager: '进程加速', ProcessMonitor: '进程监控', ResourceDownloader: '资源', 'TUN:mihomo': 'TUN', 'AI 答案获取': 'AI答案' };
function moduleName(name) { return String(name || '应用').replace(/[\[\]\r\n\x00-\x1f]/g, '').slice(0, 40) || '应用'; }
function scrub(value, seen = new WeakSet(), depth = 0) {
  if (value instanceof Error) return value.stack || value.message;
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth > 4) return '[Object]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 30).map(v => scrub(v, seen, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, val]) => [key, SECRET.test(key) ? '[已隐藏]' : scrub(val, seen, depth + 1)]));
}
function cleanText(text) {
  return String(text)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/(\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, '$1[已隐藏]')
    .replace(/((?:["']?)(?:api[-_]?key|access_token|refresh_token|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1[已隐藏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏]');
}
function message(args) {
  let text;
  try { text = formatWithOptions({ colors: false, depth: 4, maxArrayLength: 30, maxStringLength: 4096, breakLength: Infinity }, ...args.map(arg => scrub(arg))); }
  catch { text = '无法序列化日志内容'; }
  return cleanText(text).slice(0, 12000);
}
function stripPrefix(name, text) {
  const match = text.match(/^\[([^\]\r\n]+)\]\s*/);
  return match && (match[1] === name || ALIASES[match[1]] === name) ? text.slice(match[0].length) : text;
}
function entry(name, level, args) {
  name = moduleName(name);
  const text = stripPrefix(name, message(args));
  return { module: name, level, timestamp: new Date().toISOString(), text, message: `[${name}] ${text}` };
}
function lines(record) {
  const prefix = `[${record.module}] ${record.timestamp} [${record.level.toUpperCase()}] `;
  return record.text.replace(/\r\n?/g, '\n').split('\n').map(line => prefix + line).join('\n') + '\n';
}
module.exports = { entry, lines, cleanText, moduleName };
