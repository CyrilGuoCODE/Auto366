import navigationMethods from './navigation.js';
import layoutMethods from './layout.js';
import titlebarMethods from './titlebar.js';

class EventManager {
  constructor(state) {
    this.state = state;
  }

  // 初始化事件监听器
  initEventListeners() {
    this.initSidebar();
    this.initResizer();
    this.initSwitchToSimple();
    this.initSimpleModeChrome();
    this.initWindowTitlebar();
    this.initImportAnswer();
    this.initLogButtons();
  }

  // 初始化日志相关按钮
  initLogButtons() {
    const closeDetailsBtn = document.getElementById('closeDetailsBtn');
    if (closeDetailsBtn) {
      closeDetailsBtn.addEventListener('click', () => {
        if (window.app && window.app.logManager) {
          window.app.logManager.hideRequestDetails();
        }
      });
    }

    const clearLogsBtn = document.getElementById('clearLogsBtn');
    if (clearLogsBtn) {
      clearLogsBtn.addEventListener('click', () => {
        if (window.app && window.app.logManager) {
          window.app.logManager.clearLogs();
        }
      });
    }

    const detailsContent = document.getElementById('detailsContent');
    if (detailsContent) {
      detailsContent.addEventListener('click', (e) => {
        const downloadBtn = e.target.closest('.btn--download');
        if (downloadBtn) {
          const uuid = downloadBtn.dataset.downloadUuid;
          if (uuid && window.app) {
            window.app.downloadResponse(uuid);
          }
        }
      });
    }
  }

  // 初始化侧边栏

  // 初始化分割器

  // 初始化详情面板拖动功能

  // 初始化切换到简单模式

  // 初始化简单模式切换

  // 初始化窗口标题栏

  // 初始化导入答案
  initImportAnswer() {
    const importInput = document.getElementById('importAnswer');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && window.app && window.app.answersUI) {
          window.app.answersUI.importAnswerFile(file);
          e.target.value = '';
        }
      });
    }
  }
}

// Submodules share this feature's instance; existing method contracts stay unchanged.
Object.assign(EventManager.prototype, navigationMethods, layoutMethods, titlebarMethods);
export default EventManager;
