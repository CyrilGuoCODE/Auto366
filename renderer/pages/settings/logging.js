import createModuleClient from '../../services/module-client.js';
import { createLogger } from '../../services/logger.js';
const logger = createLogger('日志');

export default {
  async initLoggingSettings() {
    const toggle = document.getElementById('logRecordingEnabled');
    const open = document.getElementById('openLogDirectory');
    const status = document.getElementById('logRecordingStatus');
    if (!toggle || !open || !status) return;
    const client = createModuleClient('logging');
    const display = state => {
      toggle.checked = state.enabled;
      status.textContent = state.error ? `记录已暂停：${state.error}` : `${state.enabled ? '正在记录' : '未开启记录'} · ${state.file} · 每次启动一个文件，按启动时间命名；保留最近 ${state.files} 次，每次最多 ${state.maxBytes / 1024 / 1024} MB，达到上限暂停记录`;
    };
    try { display(await client.call('status')); }
    catch (error) { status.textContent = '读取日志设置失败：' + error.message; logger.error(error); }
    client.on('status', display);
    toggle.addEventListener('change', async () => {
      const wanted = toggle.checked;
      toggle.disabled = true;
      try { display(await client.call('enabled', wanted)); }
      catch (error) { toggle.checked = !wanted; status.textContent = '保存日志设置失败：' + error.message; logger.error(error); }
      finally { toggle.disabled = false; }
    });
    open.addEventListener('click', async () => {
      try { await client.call('open-directory'); }
      catch (error) { status.textContent = '打开日志目录失败：' + error.message; logger.error(error); }
    });
  }
};
