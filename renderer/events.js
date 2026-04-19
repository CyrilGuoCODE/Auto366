import StateManager from './state.js';

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
        const downloadBtn = e.target.closest('.download-response-btn');
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
  initSidebar() {
    // 侧边栏菜单项点击事件
    const menuItems = document.querySelectorAll('.menu-item');
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
      const savedPath = localStorage.getItem('cache-path') || 'D:\\Up366StudentFiles';
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
  }

  // 初始化分割器
  initResizer() {
    const resizer = document.getElementById('resizer');
    const leftContent = document.getElementById('leftContent');
    const rightLogs = document.getElementById('rightLogs');
    const contentArea = document.querySelector('.content-area');

    let isResizing = false;
    let startX = 0;
    let startLeftWidth = 0;
    let startRightWidth = 0;

    // 从localStorage加载保存的宽度比例
    const savedLeftFlex = localStorage.getItem('leftContentFlex') || '2';
    const savedRightFlex = localStorage.getItem('rightLogsFlex') || '1';

    leftContent.style.flex = savedLeftFlex;
    rightLogs.style.flex = savedRightFlex;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;

      const leftRect = leftContent.getBoundingClientRect();
      const rightRect = rightLogs.getBoundingClientRect();

      startLeftWidth = leftRect.width;
      startRightWidth = rightRect.width;

      resizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const contentAreaRect = contentArea.getBoundingClientRect();
      const totalWidth = contentAreaRect.width - 4; // 减去分隔条宽度

      const newLeftWidth = Math.max(300, Math.min(startLeftWidth + deltaX, totalWidth - 250));
      const newRightWidth = totalWidth - newLeftWidth;

      // 计算flex比例
      const leftFlex = newLeftWidth / totalWidth * 3; // 乘以3是为了得到合适的flex值
      const rightFlex = newRightWidth / totalWidth * 3;

      leftContent.style.flex = leftFlex.toString();
      rightLogs.style.flex = rightFlex.toString();
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // 保存当前的flex值到localStorage
        localStorage.setItem('leftContentFlex', leftContent.style.flex);
        localStorage.setItem('rightLogsFlex', rightLogs.style.flex);
      }
    });

    // 防止拖拽时选中文本
    resizer.addEventListener('selectstart', (e) => {
      e.preventDefault();
    });

    // 初始化详情面板拖动功能
    this.initDetailsResizer();
  }

  // 初始化详情面板拖动功能
  initDetailsResizer() {
    const detailsResizer = document.getElementById('detailsResizer');
    const trafficMonitor = document.getElementById('trafficMonitor');
    const requestDetails = document.getElementById('requestDetails');
    const logsContainer = document.querySelector('.logs-container');

    let isDetailsResizing = false;
    let startX = 0;
    let startMonitorWidth = 0;
    let startDetailsWidth = 0;

    if (!detailsResizer || !trafficMonitor || !requestDetails) return;

    detailsResizer.addEventListener('mousedown', (e) => {
      isDetailsResizing = true;
      startX = e.clientX;

      const monitorRect = trafficMonitor.getBoundingClientRect();
      const detailsRect = requestDetails.getBoundingClientRect();

      startMonitorWidth = monitorRect.width;
      startDetailsWidth = detailsRect.width;

      detailsResizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDetailsResizing) return;

      const deltaX = e.clientX - startX;
      const containerRect = logsContainer.getBoundingClientRect();
      const totalWidth = containerRect.width - 4; // 减去分隔条宽度

      // 限制详情面板最大宽度为容器的50%，最小宽度为300px
      const maxDetailsWidth = totalWidth * 0.5;
      const minDetailsWidth = 300;
      const minMonitorWidth = 200;

      let newMonitorWidth = startMonitorWidth + deltaX;
      let newDetailsWidth = totalWidth - newMonitorWidth;

      // 确保详情面板不超过最大宽度
      if (newDetailsWidth > maxDetailsWidth) {
        newDetailsWidth = maxDetailsWidth;
        newMonitorWidth = totalWidth - newDetailsWidth;
      }

      // 确保详情面板不小于最小宽度
      if (newDetailsWidth < minDetailsWidth) {
        newDetailsWidth = minDetailsWidth;
        newMonitorWidth = totalWidth - newDetailsWidth;
      }

      // 确保监听器面板不小于最小宽度
      if (newMonitorWidth < minMonitorWidth) {
        newMonitorWidth = minMonitorWidth;
        newDetailsWidth = totalWidth - newMonitorWidth;
      }

      // 计算flex比例
      const monitorFlex = newMonitorWidth / totalWidth * 2;
      const detailsFlex = newDetailsWidth / totalWidth * 2;

      trafficMonitor.style.flex = monitorFlex.toString();
      requestDetails.style.flex = detailsFlex.toString();
    });

    document.addEventListener('mouseup', () => {
      if (isDetailsResizing) {
        isDetailsResizing = false;
        detailsResizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // 保存当前的flex值到localStorage
        localStorage.setItem('trafficMonitorFlex', trafficMonitor.style.flex);
        localStorage.setItem('requestDetailsFlex', requestDetails.style.flex);
      }
    });

    // 防止拖拽时选中文本
    detailsResizer.addEventListener('selectstart', (e) => {
      e.preventDefault();
    });
  }

  // 初始化切换到简单模式
  initSwitchToSimple() {
    const btn = document.getElementById('settings-switch-to-simple');
    if (btn && window.electronAPI && window.electronAPI.switchUiMode) {
      btn.addEventListener('click', async () => {
        await window.electronAPI.switchUiMode('simple');
        document.documentElement.setAttribute('data-ui', 'simple');
        document.documentElement.setAttribute('data-simple-page', 'menu');
        // 由 community-ui 模块处理
      });
    }
  }

  // 初始化简单模式切换
  initSimpleModeChrome() {
    const pro = document.getElementById('settings-switch-to-professional');
    if (pro && window.electronAPI && window.electronAPI.switchUiMode) {
      pro.addEventListener('click', async () => {
        await window.electronAPI.switchUiMode('professional');
        document.documentElement.setAttribute('data-ui', 'professional');
        document.documentElement.removeAttribute('data-simple-page');
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
    const openCommunityFromRules = document.getElementById('simple-open-community-from-rules');
    if (openCommunityFromRules) {
      openCommunityFromRules.addEventListener('click', () => {
        this.state.setSimplePage('app');
        this.state.switchView('community');
      });
    }
  }

  // 初始化窗口标题栏
  async initWindowTitlebar() {
    if (!window.electronAPI) return;
    const pinBtn = document.getElementById('toggle-always-on-top-btn');
    const applyPin = (enabled) => {
      if (!pinBtn) return;
      const icon = pinBtn.querySelector('i');
      pinBtn.classList.toggle('active', !!enabled);
      if (icon) {
        icon.className = enabled ? 'bi bi-pin-angle-fill' : 'bi bi-pin-angle';
      }
      pinBtn.title = enabled ? '窗口已置顶，点击取消' : '窗口置顶';
    };
    try {
      applyPin(await window.electronAPI.getAlwaysOnTop());
    } catch (_) {}

    // 获取并显示应用版本号
    try {
      const version = await window.electronAPI.getAppVersion();
      const versionElement = document.getElementById('titlebar-version');
      if (versionElement && version) {
        versionElement.textContent = `(v${version})`;
      }
    } catch (error) {
      console.error('获取应用版本失败:', error);
    }

    if (pinBtn) {
      pinBtn.addEventListener('click', async () => {
        try {
          const result = await window.electronAPI.toggleAlwaysOnTop();
          if (result && result.success) {
            applyPin(result.isAlwaysOnTop);
          }
        } catch (_) {}
      });
    }
    const maxBtn = document.getElementById('titlebar-maximize-btn');
    const applyMaxIcon = async () => {
      if (!maxBtn || !window.electronAPI.windowIsMaximized) return;
      try {
        const maximized = await window.electronAPI.windowIsMaximized();
        const icon = maxBtn.querySelector('i');
        if (icon) {
          icon.className = maximized ? 'bi bi-fullscreen-exit' : 'bi bi-fullscreen';
        }
        maxBtn.title = maximized ? '还原' : '最大化';
      } catch (_) {}
    };
    await applyMaxIcon();
    if (window.electronAPI.onWindowMaximized) {
      window.electronAPI.onWindowMaximized(() => {
        applyMaxIcon();
      });
    }
    const drag = document.getElementById('titlebar-drag-region');
    if (drag) {
      drag.addEventListener('dblclick', async () => {
        try {
          if (window.electronAPI.windowToggleMaximize) {
            await window.electronAPI.windowToggleMaximize();
            await applyMaxIcon();
          }
        } catch (_) {}
      });
    }
    document.getElementById('titlebar-minimize-btn')?.addEventListener('click', () => {
      window.electronAPI.windowMinimize?.();
    });
    maxBtn?.addEventListener('click', async () => {
      try {
        await window.electronAPI.windowToggleMaximize?.();
        await applyMaxIcon();
      } catch (_) {}
    });
    document.getElementById('titlebar-close-btn')?.addEventListener('click', () => {
      window.electronAPI.windowClose?.();
    });
  }

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

export default EventManager;
