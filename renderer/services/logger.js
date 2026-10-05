const pending = [];
const nativeConsole = globalThis.console;
let timer = null, sending = false, dropped = 0;

export function prefix(moduleName, message) {
  const name = String(moduleName || '界面').replace(/[\[\]\r\n\x00-\x1f]/g, '').slice(0, 40);
  const text = String(message ?? '');
  return text.startsWith(`[${name}]`) ? text : `[${name}] ${text}`;
}
function serialize(args) {
  const seen = new WeakSet();
  return args.map(value => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, (key, val) => {
        if (/^(?:authorization|cookie|password|secret|token|api[-_]?key)$/i.test(key)) return '[已隐藏]';
        if (val && typeof val === 'object') { if (seen.has(val)) return '[Circular]'; seen.add(val); }
        return val;
      });
    } catch { return String(value); }
  }).join(' ').slice(0, 12000);
}
async function flush() {
  timer = null;
  if (sending || !pending.length) return;
  sending = true;
  const batch = pending.splice(0, 50);
  try { await window.electronAPI.call('logging', 'write', batch); }
  catch (error) { nativeConsole.warn(prefix('日志', '日志转发失败：' + error.message)); }
  finally {
    sending = false;
    if (dropped) { pending.push({ module: '日志', level: 'warn', message: `界面日志过快，已丢弃 ${dropped} 条` }); dropped = 0; }
    if (pending.length) timer = setTimeout(flush, 60);
  }
}
export function record(moduleName, level, message) {
  const text = prefix(moduleName, message);
  if (pending.length >= 200) { dropped++; return text; }
  pending.push({ module: moduleName, level, message: text.slice(0, 12000) });
  if (!timer && !sending) timer = setTimeout(flush, 60);
  return text;
}
export function createLogger(moduleName) {
  const logger = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'success']) {
    logger[level] = (...args) => {
      const text = record(moduleName, level, serialize(args));
      (nativeConsole[level] || nativeConsole.info).call(nativeConsole, text);
    };
  }
  logger.log = logger.info;
  return logger;
}
