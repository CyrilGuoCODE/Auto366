const path = require('path');
const format = require('./format');
const LogWriter = require('./writer');
let writer = null;
let notifyStatus = () => {};

function write(record) {
  const text = format.lines(record);
  if (record.level !== 'debug') {
    const stream = ['error', 'warn'].includes(record.level) ? process.stderr : process.stdout;
    try { if (!stream.destroyed) stream.write(text, 'utf8'); } catch { /* closing console */ }
  }
  writer?.append(text);
  return record;
}
function create(name) {
  const log = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'success']) log[level] = (...args) => write(format.entry(name, level, args));
  log.log = log.info;
  log.event = data => {
    if (data?._logged === true) return data;
    const level = ({ warning: 'warn', error: 'error', success: 'success' })[data?.type] || 'info';
    const record = format.entry(name, level, [data?.message || '']);
    write(data?.details ? { ...record, text: record.text + ' ' + format.entry(name, level, [data.details]).text } : record);
    return { ...data, module: record.module, message: record.message, timestamp: record.timestamp, _logged: true };
  };
  return log;
}
function initialize() {
  if (writer) return;
  require('../app/process-text').ensureConsoleUtf8();
  const config = require('../config');
  writer = new LogWriter(path.join(config.root, 'logs'), {
    onError: error => {
      write(format.entry('日志', 'error', ['日志文件写入失败，已暂停记录：', error.message]));
      notifyStatus();
    }
  });
  writer.enabled = config.get('log-recording-enabled') === 'true';
}
function status() {
  return { enabled: writer.enabled, directory: writer.directory, file: writer.file, startedAt: writer.startedAt, maxBytes: writer.maxBytes, files: writer.files, dropped: writer.dropped, error: writer.error };
}
function register() {
  initialize();
  notifyStatus = () => {
    const { BrowserWindow } = require('electron');
    for (const window of BrowserWindow.getAllWindows()) {
      try { if (!window.isDestroyed()) window.webContents.send('logging:status', status()); }
      catch { /* A window may be closing while a disk error is reported. */ }
    }
  };
  const ipc = require('../register').forModule('logging', { legacy: false });
  ipc.handle('status', status);
  ipc.handle('enabled', async (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('日志开关参数无效');
    const previous = writer.enabled;
    await writer.setEnabled(enabled);
    try { require('../config').set('log-recording-enabled', String(enabled)); }
    catch (error) { await writer.setEnabled(previous); throw error; }
    create('日志').info(enabled ? '已开启本地日志记录' : '已关闭本地日志记录');
    notifyStatus();
    return status();
  });
  ipc.handle('open-directory', async () => {
    await require('fs/promises').mkdir(writer.directory, { recursive: true });
    const error = await require('electron').shell.openPath(writer.directory);
    if (error) throw new Error(error);
  });
  ipc.handle('write', (_event, entries) => {
    if (!Array.isArray(entries) || entries.length > 50) throw new Error('日志批次过大');
    for (const item of entries) {
      if (!item || typeof item.module !== 'string' || item.module.length > 40 || typeof item.message !== 'string' || item.message.length > 12000 || !['info', 'warn', 'error', 'debug', 'success'].includes(item.level)) throw new Error('日志格式无效');
    }
    for (const item of entries) write(format.entry(item.module, item.level, [item.message]));
  });
}
async function close() { if (writer) { writer.enabled = false; await writer.flush(); } }
function restorePreferences() { if (writer) writer.enabled = require('../config').get('log-recording-enabled') === 'true'; }
module.exports = { create, initialize, register, status, close, restorePreferences, LogWriter };
