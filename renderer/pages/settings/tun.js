import { createLogger } from '../../services/logger.js';
const moduleLog = createLogger('TUN');
import settingsStorage from '../../services/settings.js';

export default {
async initTunSettings() {
    try {
      const tunToggle = document.getElementById('tunModeEnabled');
      const addProcessBtn = document.getElementById('addTunProcessBtn');
      const processList = document.getElementById('tunProcessList');

      if (!tunToggle || !addProcessBtn || !processList) {
        return;
      }

      // 加载本地进程列表（默认 up366.exe 启用）
      this._tunProcesses = this._loadTunProcesses();

      // 从主进程同步当前状态
      try {
        const status = await window.electronAPI.getTunStatus();
        tunToggle.checked = !!status.running;
        if (Array.isArray(status.selectedProcesses) && status.selectedProcesses.length > 0) {
          // 用主进程返回的列表覆盖本地（主进程为权威来源）
          this._tunProcesses = this._mergeTunProcesses(this._tunProcesses, status.selectedProcesses);
        }
      } catch (e) {
        // 主进程不可用时使用本地默认值
      }

      this._renderTunProcessList();
      this._updateTunStatusText();

      // 监听开关变化
      tunToggle.addEventListener('change', async () => {
        const enabled = tunToggle.checked;
        try {
          tunToggle.disabled = true;
          const result = enabled
            ? await window.electronAPI.startTun()
            : await window.electronAPI.stopTun();
          if (!result.success) {
            this.logManager.addErrorLog(`TUN ${enabled ? '启动' : '停止'}失败: ${result.message}`, "TUN");
            tunToggle.checked = !enabled;
          } else {
            this.logManager.addSuccessLog(result.message, "TUN");
            // 通知控制栏按钮同步状态
            document.dispatchEvent(new CustomEvent('tun-state-changed', { detail: { running: enabled } }));
          }
        } catch (error) {
          this.logManager.addErrorLog(`TUN 操作失败: ${error.message}`, "TUN");
          tunToggle.checked = !enabled;
        } finally {
          tunToggle.disabled = false;
          this._updateTunStatusText();
        }
      });

      // 监听添加进程按钮
      addProcessBtn.addEventListener('click', () => this._showAddTunProcessDialog());

      // 监听主进程状态变化
      if (window.electronAPI.onTunStatus) {
        window.electronAPI.onTunStatus((event, data) => {
          this._handleTunStatusChange(data);
        });
      }

      // 监听控制栏触发的 TUN 状态变化，同步复选框
      document.addEventListener('tun-state-changed', (e) => {
        const running = e.detail.running;
        if (tunToggle.checked !== running) {
          tunToggle.checked = running;
          this._updateTunStatusText();
        }
      });

      // 监听 TUN 依赖下载进度（资源缺失时自动触发）
      this._tunDownloadAnchor = tunToggle.closest('.setting-item');
      if (window.electronAPI.onA366DownloadProgress && !this._tunDlListener) {
        this._tunDlListener = (data) => {
          if (!data || data.group !== 'tun') return;
          this._showTunDownloadHint(data);
        };
        window.electronAPI.onA366DownloadProgress(this._tunDlListener);
      }
    } catch (error) {
      moduleLog.error('初始化 TUN 设置失败:', error);
    }
  },

_showTunDownloadHint(data) {
    let el = document.getElementById('tunDownloadHint');
    if (!el) {
      const anchor = this._tunDownloadAnchor;
      if (!anchor || !anchor.parentElement) return;
      el = document.createElement('div');
      el.id = 'tunDownloadHint';
      el.className = 'setting-item a366-dl';
      el.innerHTML =
        '<div class="a366-dl__track"><div id="tunDownloadFill" class="a366-dl__fill"></div></div>' +
        '<span class="a366-dl__status" id="tunDownloadStatus"></span>';
      anchor.parentElement.insertBefore(el, anchor.nextSibling);
    }
    const fill = el.querySelector('#tunDownloadFill');
    const s = el.querySelector('#tunDownloadStatus');
    if (!fill || !s) return;
    if (data.stage === 'download') {
      fill.style.width = (data.percent || 0) + '%';
      s.textContent = `${data.percent || 0}%${data.source === 'github' ? '·备用' : ''}`;
    } else if (data.stage === 'extract') {
      s.textContent = '解包中...';
    } else if (data.stage === 'done') {
      fill.style.width = '100%';
      s.textContent = '下载完成';
      setTimeout(() => { if (el && el.parentNode) el.parentNode.removeChild(el); }, 1500);
    }
  },

_loadTunProcesses() {
    try {
      const raw = settingsStorage.getItem('tun-processes');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((p) => p && p.name);
        }
      }
    } catch (e) {}
    // 默认进程列表
    return [{ name: 'up366.exe', enabled: true }];
  },

_saveTunProcesses() {
    try {
      settingsStorage.setItem('tun-processes', JSON.stringify(this._tunProcesses));
    } catch (e) {}
  },

_mergeTunProcesses(localList, enabledNames) {
    const merged = localList.map((p) => ({
      name: p.name,
      enabled: enabledNames.includes(p.name)
    }));
    for (const name of enabledNames) {
      if (!merged.find((p) => p.name === name)) {
        merged.push({ name, enabled: true });
      }
    }
    return merged;
  },

_renderTunProcessList() {
    const processList = document.getElementById('tunProcessList');
    if (!processList) return;

    processList.innerHTML = '';
    for (const proc of this._tunProcesses) {
      const item = document.createElement('div');
      item.className = 'tun-process-item';

      const label = document.createElement('label');
      label.className = 'tun-process-item__label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!proc.enabled;
      checkbox.addEventListener('change', () => {
        proc.enabled = checkbox.checked;
        this._saveTunProcesses();
        this._syncTunProcessesToMain();
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tun-process-item__name';
      nameSpan.textContent = proc.name;

      label.appendChild(checkbox);
      label.appendChild(nameSpan);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tun-process-item__remove';
      removeBtn.title = '移除';
      removeBtn.innerHTML = '<i class="bi bi-x"></i>';
      removeBtn.addEventListener('click', () => {
        this._tunProcesses = this._tunProcesses.filter((p) => p.name !== proc.name);
        this._saveTunProcesses();
        this._renderTunProcessList();
        this._syncTunProcessesToMain();
      });

      item.appendChild(label);
      item.appendChild(removeBtn);
      processList.appendChild(item);
    }
  },

_showAddTunProcessDialog() {
    const existing = document.getElementById('tunAddProcessModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tunAddProcessModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal__content">
        <div class="modal__header">
          <h3>添加进程</h3>
          <button class="btn--close" id="tunAddProcessCloseBtn">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label for="tunProcessNameInput">进程名称（如 up366.exe）</label>
            <input type="text" id="tunProcessNameInput" class="form-input" placeholder="输入进程名称">
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn--ghost" id="tunAddProcessCancelBtn">取消</button>
          <button class="btn--primary" id="tunAddProcessConfirmBtn">添加</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById('tunAddProcessCloseBtn').addEventListener('click', close);
    document.getElementById('tunAddProcessCancelBtn').addEventListener('click', close);

    const input = document.getElementById('tunProcessNameInput');
    const confirm = () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      if (this._tunProcesses.find((p) => p.name.toLowerCase() === name.toLowerCase())) {
        this.logManager.addErrorLog(`进程 "${name}" 已存在`, "TUN");
        return;
      }
      this._tunProcesses.push({ name, enabled: true });
      this._saveTunProcesses();
      this._renderTunProcessList();
      this._syncTunProcessesToMain();
      close();
    };
    document.getElementById('tunAddProcessConfirmBtn').addEventListener('click', confirm);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') confirm();
    });

    setTimeout(() => {
      input.focus();
    }, 100);
  },

async _syncTunProcessesToMain() {
    try {
      const enabledNames = this._tunProcesses.filter((p) => p.enabled).map((p) => p.name);
      await window.electronAPI.setTunProcesses(enabledNames);
    } catch (e) {
      // 主进程不可用时忽略
    }
  },

_updateTunStatusText() {
    const statusEl = document.getElementById('tunStatusText');
    if (!statusEl) return;
    const toggle = document.getElementById('tunModeEnabled');
    const running = toggle && toggle.checked;
    if (running) {
      const enabledNames = this._tunProcesses.filter((p) => p.enabled).map((p) => p.name);
      statusEl.textContent = `运行中，已重定向进程: ${enabledNames.join(', ') || '无'}`;
      statusEl.className = 'tun-processes__status tun-processes__status--running';
    } else {
      statusEl.textContent = '未启用';
      statusEl.className = 'tun-processes__status tun-processes__status--stopped';
    }
  },

_handleTunStatusChange(data) {
    const toggle = document.getElementById('tunModeEnabled');
    if (!toggle) return;

    let running = null;
    if (data.type === 'started') {
      toggle.checked = true;
      running = true;
      this.logManager.addSuccessLog(data.message || 'TUN 强制软包模式已启动', "TUN");
    } else if (data.type === 'stopped') {
      toggle.checked = false;
      running = false;
      this.logManager.addInfoLog(data.message || 'TUN 强制软包模式已停止', "TUN");
    } else if (data.type === 'error') {
      this.logManager.addErrorLog(data.message || 'TUN 错误', "TUN");
      if (data.running === false) {
        toggle.checked = false;
        running = false;
      }
    }
    this._updateTunStatusText();
    // 通知控制栏按钮同步状态（仅在主进程主动通知的意外状态变化时）
    if (running !== null) {
      document.dispatchEvent(new CustomEvent('tun-state-changed', { detail: { running } }));
    }
  }
};
