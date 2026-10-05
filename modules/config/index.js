const fs = require('fs');
const path = require('path');
const os = require('os');
// 对业务保留旧 get/set 键，磁盘按模块存原生对象，避免再次修改全部调用方。
const fields = {
  'proxy-port': ['proxy', 'port', 'number'], 'bucket-port': ['proxy', 'bucketPort', 'number'],
  'cache-path': ['files', 'cachePath'],
  'ai-api-key': ['ai', 'apiKey'], 'ai-base-url': ['ai', 'baseUrl'], 'ai-model': ['ai', 'model'],
  'ai-preset': ['ai', 'preset'], 'ai-custom-config': ['ai', 'custom', 'object'],
  'glm-api-key': ['tts', 'glmApiKey'], 'tts-config': ['tts', 'config', 'object'],
  'tun-processes': ['tun', 'processes', 'array'],
};
const simple = new Set(['auto-start-proxy', 'keep-cache-files', 'auto-check-updates', 'compatibility-protection-enabled', 'tun-autostart', 'a366_speed_factor', 'log-recording-enabled']);
const keys = new Set([...Object.keys(fields), ...simple]);
const runtime = Object.create(null);
let data, readError, needsMigration = false;
const root = path.join(os.homedir(), '.Auto366');
const file = path.join(root, 'settings.json');
function assign(target, key, value) {
  const [group, field, type] = fields[key];
  target[group] ||= {};
  if (value === null) { delete target[group][field]; return; }
  let parsed = value;
  if (type === 'number') { parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) throw new Error('无效端口'); }
  if (type === 'object' || type === 'array') {
    parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) !== (type === 'array')) throw new Error('无效模块配置');
  }
  target[group][field] = parsed;
}
function read() {
  if (data) return data;
  data = { version: 2 };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('配置必须是对象');
    if (saved.version === 2) {
      for (const group of new Set(Object.values(fields).map(field => field[0]))) {
        if (saved[group] !== undefined && (!saved[group] || typeof saved[group] !== 'object' || Array.isArray(saved[group]))) throw new Error('模块配置损坏');
      }
      data = saved;
    } else {
      if (saved.version !== undefined) throw new Error('不支持的配置版本');
      data._legacyMigrated = !!saved._legacyMigrated;
      for (const key of keys) if (Object.hasOwn(saved, key)) {
        if (simple.has(key)) { data._localPreferences ||= {}; data._localPreferences[key] = saved[key]; }
        else assign(data, key, saved[key]);
      }
      needsMigration = true;
    }
  } catch (error) { if (error.code !== 'ENOENT') { readError = error; data = { version: 2 }; } }
  return data;
}
function save(next) {
  if (readError) throw new Error('原配置读取失败，已保留原文件，不能覆盖：' + readError.message);
  fs.mkdirSync(root, { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(file + '.bak')) fs.copyFileSync(file, file + '.bak', fs.constants.COPYFILE_EXCL);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  data = next; needsMigration = false;
}
function get(key, fallback = null) {
  const current = read();
  if (simple.has(key)) return Object.hasOwn(runtime, key) ? runtime[key] : current._localPreferences?.[key] ?? fallback;
  if (!fields[key]) return fallback;
  const [group, field, type] = fields[key], value = current[group]?.[field];
  if (value === undefined) return fallback;
  return type === 'object' || type === 'array' ? JSON.stringify(value) : String(value);
}
function set(key, value) {
  if (!keys.has(key) || (value !== null && (typeof value !== 'string' || value.length > 65536))) throw new Error('无效配置');
  read();
  if (!readError && get(key) === value) return value;
  if (simple.has(key)) runtime[key] = value;
  else {
    const next = JSON.parse(JSON.stringify(read()));
    assign(next, key, value); save(next);
  }
  const { BrowserWindow } = require('electron');
  for (const window of BrowserWindow?.getAllWindows?.() || []) {
    try { if (!window.isDestroyed()) window.webContents.send('config:changed', { key, value }); } catch {}
  }
  return value;
}
function snapshot() { return Object.fromEntries([...keys].map(key => [key, get(key)]).filter(([, value]) => value !== null)); }
function register(onMigrated = () => {}) {
  const ipc = require('../register').forModule('config');
  let initialized = false;
  ipc.handle('config:migrate', (_e, old = {}) => {
    if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error('无效旧配置');
    const next = JSON.parse(JSON.stringify(read()));
    for (const key of simple) if (Object.hasOwn(next._localPreferences || {}, key)) runtime[key] = next._localPreferences[key];
    for (const key of keys) if (typeof old[key] === 'string' && old[key].length <= 65536) {
      if (simple.has(key)) runtime[key] = next._localPreferences?.[key] ?? old[key];
      else if (!next._legacyMigrated && get(key) === null) assign(next, key, old[key]);
    }
    next._legacyMigrated = true;
    if (needsMigration || readError || JSON.stringify(next) !== JSON.stringify(read())) save(next);
    if (!initialized) { initialized = true; onMigrated(); }
    return snapshot();
  });
  // 只有 renderer 成功写回简单偏好后，才删除旧 JSON 内的迁移暂存。
  ipc.handle('config:preferences-migrated', () => {
    if (!read()._localPreferences) return;
    const next = { ...read() }; delete next._localPreferences; save(next);
  });
  ipc.handle('config:set', (_e, key, value) => set(key, value));
  ipc.handle('config:get', () => snapshot());
}
module.exports = { get, set, register, root, paths: { app: path.resolve(__dirname, '../..'), data: root, resources: path.join(root, 'resources') } };
