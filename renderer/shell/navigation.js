import settingsStorage from '../services/settings.js';

export default {
initSidebar() {
    // 侧边栏菜单项点击事件(仅限带 data-view 的导航项; 颜色模式切换项无 data-view,
    // 由 theme-ui.js 单独处理, 不参与视图切换)
    const menuItems = document.querySelectorAll('.sidebar__item[data-view]');
    menuItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        this.state.switchView(view);
      });
    });

    // 设置页面的事件监听器
    const browseCacheBtn = document.getElementById('browseCacheBtn');
    if (browseCacheBtn) {
      browseCacheBtn.addEventListener('click', () => {
        window.electronAPI.openDirectoryChoosing();
      });
    }

    // 加载缓存路径设置
    const cachePathInput = document.getElementById('cachePathInput');
    if (cachePathInput) {
      const savedPath = settingsStorage.getItem('cache-path') || 'D:\\Up366StudentFiles';
      cachePathInput.value = savedPath;
    }

    // 端口修改按钮事件
    const changePortBtn = document.getElementById('changePortBtn');
    if (changePortBtn) {
      changePortBtn.addEventListener('click', () => {
        if (window.app && window.app.state) {
          window.app.state.switchView('settings');
        }
      });
    }
  },

initSwitchToSimple() {
    const btn = document.getElementById('settings-switch-to-simple');
    if (btn && window.electronAPI && window.electronAPI.switchUiMode) {
      btn.addEventListener('click', async () => {
        await window.electronAPI.switchUiMode('simple');
        document.documentElement.setAttribute('data-ui', 'simple');
        document.documentElement.setAttribute('data-simple-page', 'menu');
        if (window.electronAPI.captureEvent) {
          window.electronAPI.captureEvent('ui_mode_switched', { mode: 'simple' });
        }
        if (window.app && window.app.rulesUI) {
          await window.app.rulesUI.renderSimpleHomeRulesets();
        }
        if (window.app && window.app.rulesUI) {
          await window.app.rulesUI.loadRules();
        }
      });
    }
  },

initSimpleModeChrome() {
    const pro = document.getElementById('settings-switch-to-professional');
    if (pro && window.electronAPI && window.electronAPI.switchUiMode) {
      pro.addEventListener('click', async () => {
        await window.electronAPI.switchUiMode('professional');
        document.documentElement.setAttribute('data-ui', 'professional');
        document.documentElement.removeAttribute('data-simple-page');
        if (window.electronAPI.captureEvent) {
          window.electronAPI.captureEvent('ui_mode_switched', { mode: 'professional' });
        }
        if (window.app && window.app.rulesUI) {
          await window.app.rulesUI.loadRules();
        }
        this.state.syncSimpleControlPanelActive(this.state.currentView);
      });
    }
    const back = document.getElementById('simple-back-home');
    if (back) {
      back.addEventListener('click', () => {
        this.state.setSimplePage('menu');
      });
    }
    const openAnswers = document.getElementById('simple-open-answers');
    if (openAnswers) {
      openAnswers.addEventListener('click', () => {
        this.state.setSimplePage('app');
        this.state.switchView('answers');
      });
    }
    const openSet = document.getElementById('simple-open-settings');
    if (openSet) {
      openSet.addEventListener('click', () => {
        this.state.setSimplePage('app');
        this.state.switchView('settings');
      });
    }
    const openRules = document.getElementById('simple-open-rules');
    if (openRules) {
      openRules.addEventListener('click', () => {
        this.state.setSimplePage('app');
        this.state.switchView('rules');
      });
    }
    const openSpeed = document.getElementById('simple-open-speed');
    if (openSpeed) {
      openSpeed.addEventListener('click', () => {
        this.state.setSimplePage('app');
        this.state.switchView('speed');
      });
    }
    const openExtensionsFromRules = document.getElementById('simple-open-extensions-from-rules');
    if (openExtensionsFromRules) {
      openExtensionsFromRules.addEventListener('click', () => {
        this.state.setSimplePage('app');
        this.state.switchView('extensions');
      });
    }
  }
};
