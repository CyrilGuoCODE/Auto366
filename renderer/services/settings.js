import { createLogger } from './logger.js';
const moduleLog = createLogger('设置');
const complex = new Set(['cache-path','proxy-port','bucket-port','ai-api-key','ai-base-url','ai-model','ai-preset','ai-custom-config','glm-api-key','tts-config','tun-processes']);
const simple = new Set(['auto-start-proxy','keep-cache-files','auto-check-updates','compatibility-protection-enabled','tun-autostart','a366_speed_factor','log-recording-enabled']);
const keys = new Set([...complex, ...simple]);
const cache = new Map();
function receive(key, value) {
  if (complex.has(key)) {
    if (value === null) cache.delete(key); else cache.set(key, value);
    localStorage.removeItem(key);
  } else if (simple.has(key)) {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  }
}
export async function initializeSettings() {
  const old = Object.fromEntries([...keys].map(key => [key, localStorage.getItem(key)]));
  try {
    const saved = await window.electronAPI.call('config', 'config:migrate', old);
    for (const key of keys) receive(key, saved[key] ?? null);
    await window.electronAPI.call('config', 'config:preferences-migrated');
  } catch (error) {
    // 迁移失败保留旧存储，避免损坏或只读磁盘导致配置丢失。
    for (const key of complex) if (!cache.has(key) && old[key] !== null) cache.set(key, old[key]);
    moduleLog.warn('配置迁移未完成，继续使用已有本地设置', error);
  }
  window.electronAPI.on('config:changed', ({ key, value }) => receive(key, value));
}
export default {
  getItem: key => complex.has(key) ? cache.get(key) ?? null : localStorage.getItem(key),
  setItem(key, value) {
    value = String(value);
    if (!complex.has(key)) {
      localStorage.setItem(key, value);
      if (simple.has(key)) window.electronAPI.call('config', 'config:set', key, value).catch(moduleLog.error);
      return;
    }
    const previous = cache.get(key); cache.set(key, value);
    window.electronAPI.call('config', 'config:set', key, value).catch(error => {
      if (cache.get(key) === value) { if (previous === undefined) cache.delete(key); else cache.set(key, previous); }
      moduleLog.error('配置保存失败', error);
    });
  },
  removeItem(key) {
    if (complex.has(key)) cache.delete(key); else localStorage.removeItem(key);
    if (keys.has(key)) window.electronAPI.call('config', 'config:set', key, null).catch(moduleLog.error);
  }
};
