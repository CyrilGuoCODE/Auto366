export default function createModuleClient(name) {
  return {
    call: (method, ...args) => window.electronAPI.call(name, method, ...args),
    on: (event, callback) => window.electronAPI.on(`${name}:${event}`, callback)
  };
}
