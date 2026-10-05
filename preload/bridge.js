function createBridge(ipc) {
  return {
    call(moduleName, method, ...args) {
      return ipc.invoke('auto366:call', moduleName, method, args);
    },
    on(channel, callback) {
      // Only application notifications; never expose Electron event objects.
      if (typeof channel !== 'string' || !/^[a-z][a-z0-9:-]{0,95}$/.test(channel) || typeof callback !== 'function') throw new Error('无效事件订阅');
      const listener = (_event, data) => callback(data);
      ipc.on(channel, listener);
      return () => ipc.removeListener(channel, listener);
    }
  };
}
function legacyBridge(ipc) {
  return {
    invoke: (...args) => ipc.invoke(...args),
    send: (...args) => ipc.send(...args),
    on(channel, callback) {
      const listener = (_event, ...args) => callback(null, ...args);
      ipc.on(channel, listener);
      return () => ipc.removeListener(channel, listener);
    }
  };
}
module.exports = { createBridge, legacyBridge };
