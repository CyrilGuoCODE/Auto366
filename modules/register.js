const path = require('path');
const { fileURLToPath } = require('url');

// Module-owned registrations also remain available through their legacy channels.
const methods = new Map();
let installed = false;
function trustedSender(event) {
  const frame = event && event.senderFrame;
  if (!frame || !frame.url || !frame.url.startsWith('file:')) return false;
  try {
    const file = path.resolve(fileURLToPath(frame.url));
    const root = path.resolve(__dirname, '..');
    return [path.join(root, 'index.html'), path.join(root, 'modules', 'injection', 'window', 'index.html')].includes(file);
  } catch { return false; }
}
function checked(fn) {
  return (event, ...args) => {
    if (!trustedSender(event)) throw new Error('不允许的调用来源');
    return fn(event, ...args);
  };
}
function install() {
  if (installed) return;
  const { ipcMain } = require('electron');
  ipcMain.handle('auto366:call', checked((event, moduleName, method, args = []) => {
    if (typeof moduleName !== 'string' || typeof method !== 'string' || !Array.isArray(args) || args.length > 16) throw new Error('无效接口参数');
    const fn = methods.get(`${moduleName}:${method}`);
    if (!fn) throw new Error('接口未注册');
    return fn(event, ...args);
  }));
  installed = true;
}
function forModule(name, { legacy = true } = {}) {
  return {
    handle(channel, handler) {
      install();
      const key = `${name}:${channel}`;
      if (methods.has(key)) throw new Error(`重复接口: ${key}`);
      methods.set(key, handler);
      if (legacy) require('electron').ipcMain.handle(channel, checked(handler));
    },
    on(channel, handler) {
      install();
      const key = `${name}:${channel}`;
      if (!methods.has(key)) methods.set(key, handler);
      if (legacy) require('electron').ipcMain.on(channel, checked(handler));
    },
    removeHandler(channel) {
      methods.delete(`${name}:${channel}`);
      if (legacy) require('electron').ipcMain.removeHandler(channel);
    }
  };
}
module.exports = { forModule, trustedSender };
