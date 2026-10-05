import { createLogger } from '../../services/logger.js';
const moduleLog = createLogger('设置');
import settingsStorage from '../../services/settings.js';
import ttsSettingsMethods from './tts.js';
import tunMethods from './tun.js';
import cacheMethods from './cache.js';
import updateMethods from './update.js';
import loggingMethods from './logging.js';
import initAiSettings from './ai.js';
import initAnswerLearning from './answer-learning.js';
import FileUI from './files.js';
class SettingsUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
    this._clearBtnLongPressTimer = null;
    this._clearBtnClosingState = false;
    this._clearBtnMouseDown = false;
    this._clearBtnPressStartTime = 0;
    this._clearBtnLongPressTriggered = false;
    this._resetCertBtnLongPressTimer = null;
    this._resetCertBtnClosingState = false;
    this._resetCertBtnMouseDown = false;
    this._resetCertBtnPressStartTime = 0;
    this._resetCertBtnLongPressTriggered = false;
  }

  init() {
    initAiSettings(this.logManager);
    initAnswerLearning();
    this.files = new FileUI(this.state, this.logManager);
    this.files.initFileUI();
    this.initCacheSettings();
    this.initUpdateSettings();
    this.initLoggingSettings();
    this.initRulesSettings();
    this.initAnalyticsSettings();
    this.initThemeSettings();
    this.initTunSettings();
    this.initTtsSettings();
  }

  // 初始化规则设置
  initRulesSettings() {
    const autoStart = document.getElementById('autoStartProxy');
    if (autoStart) {
      autoStart.checked = settingsStorage.getItem('auto-start-proxy') !== 'false';
      autoStart.addEventListener('change', () => settingsStorage.setItem('auto-start-proxy', String(autoStart.checked)));
    }
    try {
      const compatibilityProtectionCheckbox = document.getElementById('compatibilityProtection');
      if (compatibilityProtectionCheckbox) {
        const protectionEnabled = settingsStorage.getItem('compatibility-protection-enabled') !== 'false';
        compatibilityProtectionCheckbox.checked = protectionEnabled;

        compatibilityProtectionCheckbox.addEventListener('change', () => {
          const newValue = compatibilityProtectionCheckbox.checked;
          settingsStorage.setItem('compatibility-protection-enabled', newValue.toString());
          this.logManager.addInfoLog(`规则集兼容性保护已${newValue ? '启用' : '禁用'}`, "设置");
        });
      }
    } catch (error) {
      moduleLog.error('初始化规则设置失败:', error);
    }
  }

  // 初始化数据分析设置
  async initAnalyticsSettings() {
    try {
      const analyticsCheckbox = document.getElementById('analyticsEnabled');
      if (analyticsCheckbox) {
        // 从主进程获取当前状态
        const isEnabled = await window.electronAPI.getAnalyticsEnabled();
        analyticsCheckbox.checked = isEnabled;

        analyticsCheckbox.addEventListener('change', async () => {
          const enabled = analyticsCheckbox.checked;
          try {
            await window.electronAPI.setAnalyticsEnabled(enabled);
            this.logManager.addInfoLog(`使用统计数据收集已${enabled ? '启用' : '禁用'}`, "设置");
          } catch (error) {
            this.logManager.addErrorLog(`设置数据分析开关失败: ${error.message}`, "设置");
            analyticsCheckbox.checked = !enabled;
          }
        });
      }
    } catch (error) {
      moduleLog.error('初始化数据分析设置失败:', error);
    }
  }

  // 初始化颜色模式设置
  initThemeSettings() {
    const select = document.getElementById('themeSelect');
    if (!select) return;

    // 从 localStorage 读取当前偏好
    const stored = settingsStorage.getItem('a366-theme');
    select.value = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';

    select.addEventListener('change', () => {
      const value = select.value;
      // 通过全局 themeUI 实例切换主题（同步按钮和 DOM）
      if (window.app && window.app.themeUI) {
        window.app.themeUI.setTheme(value);
      } else {
        // 降级：直接操作
        settingsStorage.setItem('a366-theme', value);
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        const effective = (value === 'system') ? (mql.matches ? 'dark' : 'light') : value;
        document.documentElement.setAttribute('data-theme', effective);
      }
    });
  }

  handleResetCertificate() {
    const resultDiv = document.getElementById('trafficLog');

    const confirmHtml = `
      <div class="log-item log-item--warning">
        <i class="bi bi-exclamation-triangle"></i>
        <span style="color:var(--color-danger);">确定要清理Auto366代理证书吗？此操作将重新导入 Auto366 的代理证书，不可撤销。</span>
        <div class="log-item__actions">
          <button class="btn--sm btn--cancel" id="cancelResetCertBtn">取消</button>
          <button class="btn--sm btn--danger" id="confirmResetCertBtn" style="position:relative;overflow:hidden">
            <span>清理并重启</span>
            <div class="btn__progress-bar"></div>
          </button>
        </div>
      </div>
    `;

    resultDiv.insertAdjacentHTML('beforeend', confirmHtml);
    resultDiv.scrollTop = resultDiv.scrollHeight;

    setTimeout(() => this._initConfirmResetCertBtn(), 0);
  }

  _initConfirmResetCertBtn() {
    const btn = document.getElementById('confirmResetCertBtn');
    if (!btn) return;

    const cancelBtn = document.getElementById('cancelResetCertBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        cancelBtn.parentElement.parentElement.remove();
      });
    }

    btn.addEventListener('mousedown', (e) => this._onResetCertBtnMouseDown(e));
    btn.addEventListener('mouseup', (e) => this._onResetCertBtnMouseUp(e));
    btn.addEventListener('mouseleave', () => this._onResetCertBtnMouseLeave());
    btn.addEventListener('animationend', (e) => {
      if (e.target.classList.contains('btn__progress-bar') && e.target.classList.contains('is-active')) {
        this._onResetCertProgressComplete();
      }
    });
  }

  _onResetCertBtnMouseDown(e) {
    if (e.button !== 0) return;
    const btn = document.getElementById('confirmResetCertBtn');
    if (!btn) return;
    if (btn.classList.contains('btn__state-closing')) return;

    this._resetCertBtnMouseDown = true;
    this._resetCertBtnPressStartTime = Date.now();
    this._resetCertBtnLongPressTriggered = false;

    this._resetCertBtnLongPressTimer = setTimeout(() => {
      this._resetCertBtnLongPressTriggered = true;
      this._enterResetCertOnlyState();
    }, 300);
  }

  _onResetCertBtnMouseUp(e) {
    const btn = document.getElementById('confirmResetCertBtn');
    if (!btn) return;

    this._clearResetCertLongPressTimer();

    if (this._resetCertBtnLongPressTriggered || this._resetCertBtnClosingState) {
      this._resetCertBtnMouseDown = false;
      return;
    }

    if (this._resetCertBtnMouseDown) {
      const pressDuration = Date.now() - this._resetCertBtnPressStartTime;
      if (pressDuration >= 300) {
        this._enterResetCertOnlyState();
      } else {
        this._handleResetCertAndRestart();
      }
    }

    this._resetCertBtnMouseDown = false;
  }

  _onResetCertBtnMouseLeave() {
    this._clearResetCertLongPressTimer();

    if (this._resetCertBtnClosingState) {
      this._cancelResetCertOnlyState();
    }

    this._resetCertBtnMouseDown = false;
  }

  _clearResetCertLongPressTimer() {
    if (this._resetCertBtnLongPressTimer) {
      clearTimeout(this._resetCertBtnLongPressTimer);
      this._resetCertBtnLongPressTimer = null;
    }
  }

  _enterResetCertOnlyState() {
    const btn = document.getElementById('confirmResetCertBtn');
    if (!btn) return;

    this._resetCertBtnClosingState = true;
    btn.classList.add('btn__state-closing');
    btn.querySelector('span').textContent = '仅清理证书';

    const bar = btn.querySelector('.btn__progress-bar');
    if (bar) {
      bar.classList.add('is-active');
    }
  }

  _cancelResetCertOnlyState() {
    const btn = document.getElementById('confirmResetCertBtn');
    if (!btn) return;

    this._resetCertBtnClosingState = false;

    const bar = btn.querySelector('.btn__progress-bar');
    if (bar) {
      bar.classList.remove('is-active');
      void bar.offsetWidth;
    }

    btn.classList.remove('btn__state-closing');
    btn.querySelector('span').textContent = '清理并重启';
  }

  async _onResetCertProgressComplete() {
    const btn = document.getElementById('confirmResetCertBtn');
    if (!btn) return;

    this._resetCertBtnClosingState = false;

    const bar = btn.querySelector('.btn__progress-bar');
    if (bar) {
      bar.classList.remove('is-active');
    }

    btn.classList.add('btn__state-done');

    await this._performResetCertificate();
  }

  async _handleResetCertAndRestart() {
    await this._performResetCertificate();
    this.logManager.addInfoLog('正在重启 Auto366...', "设置");
    window.electronAPI.restartApp();
  }

  async _performResetCertificate() {
    const dialog = document.querySelector('.log-item--warning');
    if (dialog) dialog.remove();

    this.logManager.addInfoLog('正在重置代理证书...', "设置");

    const result = await window.electronAPI.resetCertificate();
    if (result && result.success) {
      if (result.deleted > 0) {
        this.logManager.addSuccessLog(`已清理 ${result.deleted} 个旧证书`, "设置");
      } else {
        this.logManager.addInfoLog('未发现需要清理的旧证书', "设置");
      }
      this.logManager.addSuccessLog('代理证书已重新导入', "设置");
    } else {
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach(err => this.logManager.addErrorLog(err, "设置"));
      } else {
        this.logManager.addErrorLog('证书重置失败', "设置");
      }
    }
  }

  // 处理一键打开天学网
  async handleOpenUp366() {
    this.logManager.addInfoLog('正在打开天学网...', "设置");
    const result = await window.electronAPI.openUp366();
    if (result && result.success) {
      this.logManager.addSuccessLog(`天学网已启动`, "设置");
    } else {
      this.logManager.addErrorLog(`打开天学网失败: ${result?.error || '未找到天学网安装路径，请确认已安装天学网'}`, "设置");
    }
  }
}

// Submodules share this feature's instance; existing method contracts stay unchanged.
Object.assign(SettingsUI.prototype, ttsSettingsMethods, tunMethods, cacheMethods, updateMethods, loggingMethods);
export default SettingsUI;
