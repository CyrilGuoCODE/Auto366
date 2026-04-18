class StateManager {
  constructor() {
    this.currentView = 'proxy';
    this.isProxyRunning = false;
    this.isCapturing = false;
    this.requestDataMap = new Map();
    this.lastAnswersData = null;
    this.sortMode = 'file'; // 'file' 或 'pattern'
    this.simpleViewHistory = ['answers'];
    this.lastProgressPercent = 0;
    this.currentEditingRuleGroup = null;
    this.currentEditingRule = null;
    this.currentRuleGroupId = null;
    this.selectedLogItem = null;
    this.communityRulesets = [];
    this.currentRulesetDetail = null;
    this.currentPage = 0;
    this.pageSize = 10;
    this.hasMorePages = false;
    this.isLoadingRulesets = false;
  }

  // 切换视图
  switchView(viewName, pushSimpleHistory = true) {
    const ui = document.documentElement.getAttribute('data-ui');
    // 更新菜单项状态
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('data-view') === viewName) {
        item.classList.add('active');
      }
    });

    // 更新左侧视图面板（右侧日志始终显示）
    const viewPanels = document.querySelectorAll('.left-content .view-panel');
    viewPanels.forEach(panel => {
      panel.classList.remove('active');
    });

    const targetPanel = document.getElementById(`${viewName}-view`);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }

    this.currentView = viewName;
    if (ui === 'simple' && pushSimpleHistory) {
      const last = this.simpleViewHistory[this.simpleViewHistory.length - 1];
      if (last !== viewName) {
        this.simpleViewHistory.push(viewName);
      }
    }

    // 同步简单模式控制面板状态
    this.syncSimpleControlPanelActive(viewName);
  }

  // 同步简单模式控制面板状态
  syncSimpleControlPanelActive(viewName) {
    const ids = ['simple-open-answers', 'simple-open-rules', 'simple-open-settings'];
    const ui = document.documentElement.getAttribute('data-ui');
    const page = document.documentElement.getAttribute('data-simple-page');
    ids.forEach((id) => {
      document.getElementById(id)?.classList.remove('simple-cp-active');
    });
    if (ui !== 'simple' || page !== 'app') {
      return;
    }
    let activeId = null;
    if (viewName === 'answers') {
      activeId = 'simple-open-answers';
    } else if (viewName === 'rules' || viewName === 'community') {
      activeId = 'simple-open-rules';
    } else if (viewName === 'settings') {
      activeId = 'simple-open-settings';
    }
    if (activeId) {
      document.getElementById(activeId)?.classList.add('simple-cp-active');
    }
  }

  // 设置简单模式页面
  setSimplePage(page) {
    if (page === 'menu') {
      document.documentElement.setAttribute('data-simple-page', 'menu');
      this.simpleViewHistory = ['answers'];
    } else if (page === 'app') {
      document.documentElement.setAttribute('data-simple-page', 'app');
      if (!this.simpleViewHistory.length) {
        this.simpleViewHistory = ['answers'];
      }
    }
    this.syncSimpleControlPanelActive(this.currentView);
  }

  // 简单模式返回
  goSimpleBack() {
    const ui = document.documentElement.getAttribute('data-ui');
    if (ui !== 'simple') return;
    if (this.simpleViewHistory.length > 1) {
      this.simpleViewHistory.pop();
      const prev = this.simpleViewHistory[this.simpleViewHistory.length - 1];
      this.switchView(prev, false);
      return;
    }
    this.setSimplePage('menu');
  }

  // 设置排序模式
  setSortMode(mode) {
    this.sortMode = mode;
  }

  // 记录答案数据
  setLastAnswersData(data) {
    this.lastAnswersData = data;
  }

  // 清空请求数据
  clearRequestData() {
    this.requestDataMap.clear();
  }
}

export default StateManager;
