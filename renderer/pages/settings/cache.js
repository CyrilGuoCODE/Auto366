import { createLogger } from '../../services/logger.js';
const moduleLog = createLogger('缓存');
import settingsStorage from '../../services/settings.js';

export default {
initCacheSettings() {
    try {
      const keepCacheCheckbox = document.getElementById('keepCacheFiles');
      if (keepCacheCheckbox) {
        // 加载当前设置
        const keepCache = settingsStorage.getItem('keep-cache-files') === 'true';
        keepCacheCheckbox.checked = keepCache;

        // 监听设置变化
        keepCacheCheckbox.addEventListener('change', () => {
          const newValue = keepCacheCheckbox.checked;
          settingsStorage.setItem('keep-cache-files', newValue.toString());

          if (newValue) {
            this.logManager.addSuccessLog('已启用缓存文件保留，答案提取的临时文件将不会被自动删除', "缓存");
          } else {
            this.logManager.addInfoLog('已禁用缓存文件保留，答案提取的临时文件将被自动删除', "缓存");
          }
        });
      }

      // 初始化缓存路径输入框
      const cachePathInput = document.getElementById('cachePathInput');
      if (cachePathInput) {
        const cachePath = settingsStorage.getItem('cache-path') || '';
        cachePathInput.value = cachePath;
        if (!cachePath) {
          cachePathInput.placeholder = '请通过自动查找或手动浏览设置缓存路径';
        }
        
        // 保存缓存路径变化
        cachePathInput.addEventListener('change', () => {
          const newPath = cachePathInput.value.trim();
          if (newPath) {
            settingsStorage.setItem('cache-path', newPath);
            if (window.electronAPI && window.electronAPI.setCachePath) {
              window.electronAPI.setCachePath(newPath);
            }
            this.logManager.addSuccessLog(`缓存路径已更新为: ${newPath}`, "缓存");
          }
        });
      }

      // 初始化浏览按钮
      const browseCacheBtn = document.getElementById('browseCacheBtn');
      if (browseCacheBtn) {
        browseCacheBtn.addEventListener('click', async () => {
          if (window.electronAPI && window.electronAPI.chooseDirectory) {
            const dirPath = await window.electronAPI.chooseDirectory();
            if (dirPath) {
              settingsStorage.setItem('cache-path', dirPath);
              if (window.electronAPI.setCachePath) {
                window.electronAPI.setCachePath(dirPath);
              }
              // 更新输入框
              const cachePathInput = document.getElementById('cachePathInput');
              if (cachePathInput) {
                cachePathInput.value = dirPath;
              }
              this.logManager.addSuccessLog(`缓存路径已更新为: ${dirPath}`, "缓存");
            }
          }
        });
      }

      const autoFindCacheBtn = document.getElementById('autoFindCacheBtn');
      if (autoFindCacheBtn) {
        autoFindCacheBtn.addEventListener('click', async () => {
          try {
            autoFindCacheBtn.disabled = true;
            const result = await window.electronAPI.autoFindCacheDir();
            const cachePathInput = document.getElementById('cachePathInput');
            if (result.success) {
              settingsStorage.setItem('cache-path', result.path);
              if (window.electronAPI.setCachePath) {
                window.electronAPI.setCachePath(result.path);
              }
              if (cachePathInput) {
                cachePathInput.value = result.path;
              }
              this.logManager.addSuccessLog(`自动寻找缓存目录成功，路径为：${result.path}`, "缓存");
            } else {
              if (result.count === 0) {
                this.logManager.addErrorLog('自动寻找缓存目录失败，未找到 Up366StudentFiles 文件夹', "缓存");
              } else {
                this.logManager.addErrorLog(`自动寻找缓存目录失败，找到 ${result.count} 个 Up366StudentFiles 文件夹`, "缓存");
              }
            }
          } catch (error) {
            this.logManager.addErrorLog(`自动寻找缓存目录失败: ${error.message}`, "缓存");
          } finally {
            autoFindCacheBtn.disabled = false;
          }
        });
      }
    } catch (error) {
      moduleLog.error('初始化缓存设置失败:', error);
    }
  },

handleClearCache() {
    const resultDiv = document.getElementById('trafficLog');

    const confirmHtml = `
      <div class="log-item log-item--warning">
        <i class="bi bi-exclamation-triangle"></i>
        <span style="color:var(--color-danger);">确定要清理所有缓存吗？此操作将清理 Auto366 临时文件和天学网缓存，不可撤销。</span>
        <div class="log-item__actions">
          <button class="btn--sm btn--cancel" id="cancelClearCacheBtn">取消</button>
          <button class="btn--sm btn--danger" id="confirmClearCacheBtn" style="position:relative;overflow:hidden">
            <span>清理并重启</span>
            <div class="btn__progress-bar"></div>
          </button>
        </div>
      </div>
    `;

    resultDiv.insertAdjacentHTML('beforeend', confirmHtml);
    resultDiv.scrollTop = resultDiv.scrollHeight;

    setTimeout(() => this._initConfirmClearCacheBtn(), 0);
  },

async confirmClearCache() {
    const confirmDialog = document.querySelector('.log-item--warning');
    if (confirmDialog) confirmDialog.remove();
    await this._performClearCache();
  },

_initConfirmClearCacheBtn() {
    const btn = document.getElementById('confirmClearCacheBtn');
    if (!btn) return;

    const cancelBtn = document.getElementById('cancelClearCacheBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        cancelBtn.parentElement.parentElement.remove();
      });
    }

    btn.addEventListener('mousedown', (e) => this._onClearBtnMouseDown(e));
    btn.addEventListener('mouseup', (e) => this._onClearBtnMouseUp(e));
    btn.addEventListener('mouseleave', () => this._onClearBtnMouseLeave());
    btn.addEventListener('animationend', (e) => {
      if (e.target.classList.contains('btn__progress-bar') && e.target.classList.contains('is-active')) {
        this._onClearProgressComplete();
      }
    });
  },

_onClearBtnMouseDown(e) {
    if (e.button !== 0) return;
    const btn = document.getElementById('confirmClearCacheBtn');
    if (!btn) return;
    if (btn.classList.contains('btn__state-closing')) return;

    this._clearBtnMouseDown = true;
    this._clearBtnPressStartTime = Date.now();
    this._clearBtnLongPressTriggered = false;

    this._clearBtnLongPressTimer = setTimeout(() => {
      this._clearBtnLongPressTriggered = true;
      this._enterClearOnlyState();
    }, 300);
  },

_onClearBtnMouseUp(e) {
    const btn = document.getElementById('confirmClearCacheBtn');
    if (!btn) return;

    this._clearLongPressTimer();

    if (this._clearBtnLongPressTriggered || this._clearBtnClosingState) {
      this._clearBtnMouseDown = false;
      return;
    }

    if (this._clearBtnMouseDown) {
      const pressDuration = Date.now() - this._clearBtnPressStartTime;
      if (pressDuration >= 300) {
        this._enterClearOnlyState();
      } else {
        this._handleClearAndRestart();
      }
    }

    this._clearBtnMouseDown = false;
  },

_onClearBtnMouseLeave() {
    this._clearLongPressTimer();

    if (this._clearBtnClosingState) {
      this._cancelClearOnlyState();
    }

    this._clearBtnMouseDown = false;
  },

_clearLongPressTimer() {
    if (this._clearBtnLongPressTimer) {
      clearTimeout(this._clearBtnLongPressTimer);
      this._clearBtnLongPressTimer = null;
    }
  },

_enterClearOnlyState() {
    const btn = document.getElementById('confirmClearCacheBtn');
    if (!btn) return;

    this._clearBtnClosingState = true;
    btn.classList.add('btn__state-closing');
    btn.querySelector('span').textContent = '仅执行清理';

    const bar = btn.querySelector('.btn__progress-bar');
    if (bar) {
      bar.classList.add('is-active');
    }
  },

_cancelClearOnlyState() {
    const btn = document.getElementById('confirmClearCacheBtn');
    if (!btn) return;

    this._clearBtnClosingState = false;

    const bar = btn.querySelector('.btn__progress-bar');
    if (bar) {
      bar.classList.remove('is-active');
      void bar.offsetWidth;
    }

    btn.classList.remove('btn__state-closing');
    btn.querySelector('span').textContent = '清理并重启';
  },

async _onClearProgressComplete() {
    const btn = document.getElementById('confirmClearCacheBtn');
    if (!btn) return;

    this._clearBtnClosingState = false;

    const bar = btn.querySelector('.btn__progress-bar');
    if (bar) {
      bar.classList.remove('is-active');
    }

    btn.classList.add('btn__state-done');

    await this._performClearCache();
  },

async _handleClearAndRestart() {
    await this._performClearCache();

    this.logManager.addInfoLog('正在重启天学网...', "缓存");
    const killResult = await window.electronAPI.killUp366();
    if (killResult && killResult.success) {
      this.logManager.addSuccessLog('天学网已强制关闭，正在重新启动...', "缓存");
    } else {
      this.logManager.addInfoLog('正在重新启动天学网...', "缓存");
    }
    const openResult = await window.electronAPI.openUp366();
    if (openResult && openResult.success) {
      this.logManager.addSuccessLog('天学网已重新启动', "缓存");
    } else {
      this.logManager.addErrorLog(`打开天学网失败: ${openResult?.error || '未找到天学网安装路径'}`, "缓存");
    }
  },

async _performClearCache() {
    const dialog = document.querySelector('.log-item--warning');
    if (dialog) dialog.remove();

    this.logManager.addInfoLog('正在清理缓存...', "缓存");

    const result = await window.electronAPI.clearCache();
    if (result && result.success) {
      result.messages.forEach(msg => {
        this.logManager.addSuccessLog(msg, "缓存");
      });
      this.logManager.addSuccessLog(`总计已清理 ${result.filesDeleted} 个文件，${result.dirsDeleted} 个目录`, "缓存");
    } else if (result && !result.success) {
      this.logManager.addErrorLog(`缓存清理失败: ${result.error || '未知错误'}`, "缓存");
    } else {
      this.logManager.addErrorLog('缓存清理失败', "缓存");
    }
  }
};
