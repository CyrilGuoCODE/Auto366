let cachePath = ''

class Global {
  constructor() {
    console.log('Global构造函数开始执行');
    try {
      this.initSettingsBtn();
      console.log('initSettingsBtn执行成功');
    } catch (error) {
      console.error('initSettingsBtn执行失败:', error);
    }
  }

  initSettingsBtn() {
    window.electronAPI.setCachePath(localStorage.getItem('cache-path') || 'D:\\Up366StudentFiles')
    cachePath = localStorage.getItem('cache-path') || 'D:\\Up366StudentFiles'

    // 监听目录选择事件
    window.electronAPI.chooseDirectory((event, path) => {
      if (path) {
        localStorage.setItem('cache-path', path);
        cachePath = path;
        window.electronAPI.setCachePath(path);

        // 更新设置页面的输入框
        const cachePathInput = document.getElementById('cachePathInput');
        if (cachePathInput) {
          cachePathInput.value = path;
        }
      }
    });
  }
}

class UniversalAnswerFeature {
  constructor() {
    console.log('UniversalAnswerFeature构造函数开始执行');
    this.isProxyRunning = false;
    this.sortMode = 'file';
    this.lastAnswersData = null;
    this.currentView = 'answers';
    this.requestDataMap = new Map(); // 存储完整的请求数据
    this.selectedLogItem = null; // 当前选中的日志项
    this.currentEditingRule = null; // 当前编辑的规则

    // 社区规则集相关属性
    this.communityRulesets = [];
    this.currentPage = 0;
    this.pageSize = 20;
    this.hasMorePages = false;
    this.isLoadingRulesets = false;
    this.currentRulesetDetail = null;

    try {
      this.initEventListeners();
      console.log('initEventListeners执行成功');
    } catch (error) {
      console.error('initEventListeners执行失败:', error);
    }

    try {
      this.initIpcListeners();
      console.log('initIpcListeners执行成功');
    } catch (error) {
      console.error('initIpcListeners执行失败:', error);
    }

    try {
      this.initImportAnswer();
      console.log('initImportAnswer执行成功');
    } catch (error) {
      console.error('initImportAnswer执行失败:', error);
    }

    try {
      this.initSidebar();
      console.log('initSidebar执行成功');
    } catch (error) {
      console.error('initSidebar执行失败:', error);
    }

    try {
      this.initResizer();
      console.log('initResizer执行成功');
    } catch (error) {
      console.error('initResizer执行失败:', error);
    }

    try {
      this.initCommunityRulesets();
      console.log('initCommunityRulesets执行成功');
    } catch (error) {
      console.error('initCommunityRulesets执行失败:', error);
    }

    // 自动启动代理
    setTimeout(() => {
      this.startProxy();
    }, 1000);
  }

  initEventListeners() {
    document.getElementById('toggleProxyBtn').addEventListener('click', () => {
      this.toggleProxy();
    });

    // 检查按钮是否存在再添加事件监听器
    const browseFileBtn = document.getElementById('browseFileBtn');
    if (browseFileBtn) {
      browseFileBtn.addEventListener('click', () => {
        this.appendImplant();
      });
    }

    document.getElementById('deleteTempBtn').addEventListener('click', () => {
      this.handleDeleteTemp();
    });

    document.getElementById('deleteFileTempBtn').addEventListener('click', () => {
      this.handleDeleteFileTemp();
    });

    document.getElementById('sortMode').addEventListener('change', (e) => {
      this.sortMode = e.target.value;
      const container = document.getElementById('answersContainer');
      if (container.innerHTML && !container.innerHTML.includes('暂无答案数据')) {
        const answersData = this.lastAnswersData;
        if (answersData) {
          this.displayAnswers(answersData);
        }
      }
    });

    document.getElementById('clearAnswersBtn').addEventListener('click', () => {
      this.clearAnswers();
    });

    document.getElementById('shareAnswerBtn').addEventListener('click', () => {
      this.shareAnswers();
    });

    // 导出答案按钮
    document.getElementById('exportAnswerBtn').addEventListener('click', () => {
      this.exportAnswers();
    });

    // 答案获取开关
    const answerCaptureToggle = document.getElementById('answerCaptureEnabled');
    if (answerCaptureToggle) {
      // 从主进程加载当前设置
      this.initAnswerCaptureToggle(answerCaptureToggle);
    }

    // 清空日志按钮
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    if (clearLogsBtn) {
      clearLogsBtn.addEventListener('click', () => {
        this.clearLogs();
      });
    }

    // 关闭详情按钮
    const closeDetailsBtn = document.getElementById('closeDetailsBtn');
    if (closeDetailsBtn) {
      closeDetailsBtn.addEventListener('click', () => {
        this.hideRequestDetails();
      });
    }

    // 更新通知按钮
    const updateNotificationBtn = document.getElementById('update-notification-btn');
    if (updateNotificationBtn) {
      updateNotificationBtn.addEventListener('click', () => {
        this.handleUpdateNotification();
      });
    }

    // 规则管理相关事件监听器
    this.initRuleEventListeners();
  }

  initRuleEventListeners() {
    // 添加规则集按钮
    const addRuleGroupBtn = document.getElementById('addRuleGroupBtn');
    if (addRuleGroupBtn) {
      addRuleGroupBtn.addEventListener('click', () => {
        this.showRuleGroupModal();
      });
    }

    // 规则集模态框事件
    const closeRuleGroupModal = document.getElementById('closeRuleGroupModal');
    if (closeRuleGroupModal) {
      closeRuleGroupModal.addEventListener('click', () => {
        this.hideRuleGroupModal();
      });
    }

    const cancelRuleGroupBtn = document.getElementById('cancelRuleGroupBtn');
    if (cancelRuleGroupBtn) {
      cancelRuleGroupBtn.addEventListener('click', () => {
        this.hideRuleGroupModal();
      });
    }

    const ruleGroupForm = document.getElementById('ruleGroupForm');
    if (ruleGroupForm) {
      ruleGroupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveRuleGroup();
      });
    }

    const ruleGroupModal = document.getElementById('ruleGroupModal');
    if (ruleGroupModal) {
      ruleGroupModal.addEventListener('click', (e) => {
        if (e.target === ruleGroupModal) {
          this.hideRuleGroupModal();
        }
      });
    }

    // 关闭规则模态框按钮
    const closeRuleModal = document.getElementById('closeRuleModal');
    if (closeRuleModal) {
      closeRuleModal.addEventListener('click', () => {
        this.hideRuleModal();
      });
    }

    // 取消按钮
    const cancelRuleBtn = document.getElementById('cancelRuleBtn');
    if (cancelRuleBtn) {
      cancelRuleBtn.addEventListener('click', () => {
        this.hideRuleModal();
      });
    }

    // 规则类型选择
    const ruleType = document.getElementById('ruleType');
    if (ruleType) {
      ruleType.addEventListener('change', (e) => {
        this.showRuleFields(e.target.value);
      });
    }

    // 浏览ZIP文件按钮
    const browseZipBtn = document.getElementById('browseZipBtn');
    if (browseZipBtn) {
      browseZipBtn.addEventListener('click', () => {
        this.browseZipFile();
      });
    }

    // 规则表单提交
    const ruleForm = document.getElementById('ruleForm');
    if (ruleForm) {
      ruleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveRule();
      });
    }

    // 模态框背景点击关闭
    const ruleModal = document.getElementById('ruleModal');
    if (ruleModal) {
      ruleModal.addEventListener('click', (e) => {
        if (e.target === ruleModal) {
          this.hideRuleModal();
        }
      });
    }
  }

  initSidebar() {
    // 侧边栏菜单项点击事件
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        this.switchView(view);
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

    // 加载代理端口设置
    this.initProxyPortSettings();

    // 初始化缓存设置
    this.initCacheSettings();

    // 初始化更新设置
    this.initUpdateSettings();

    // 端口修改按钮事件
    const changePortBtn = document.getElementById('changePortBtn');
    if (changePortBtn) {
      changePortBtn.addEventListener('click', () => {
        this.showPortChangeDialog();
      });
    } else {
      console.error('未找到端口修改按钮元素');
    }
  }

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

  switchView(viewName) {
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

    // 如果切换到规则管理视图，加载规则列表
    if (viewName === 'rules') {
      this.loadRules();
    }

    // 如果切换到社区规则集视图，加载规则集列表
    if (viewName === 'community') {
      this.loadCommunityRulesets();
    }
  }

  initIpcListeners() {
    // 监听代理状态
    window.electronAPI.onProxyStatus((event, data) => {
      this.updateProxyStatus(data);
    });

    // 监听证书状态
    window.electronAPI.onCertificateStatus((event, data) => {
      this.updateCertificateStatus(data);
    });

    // 监听流量日志
    window.electronAPI.onTrafficLog((event, data) => {
      this.addTrafficLog(data);
    });

    // 监听响应捕获
    window.electronAPI.onResponseCaptured((event, data) => {
      this.addTrafficLog(data);
    });

    // 监听响应错误
    window.electronAPI.onResponseError((event, data) => {
      this.addErrorLog(`响应错误: ${data.error} - ${data.url}`);
    });

    // 监听重要请求
    window.electronAPI.onImportantRequest((event, data) => {
      this.addImportantLog(data);
    });

    // 监听下载发现
    window.electronAPI.onDownloadFound((event, data) => {
      this.addSuccessLog(`发现下载链接: ${data.url}`);
    });

    // 监听处理状态
    window.electronAPI.onProcessStatus((event, data) => {
      this.updateProcessStatus(data);
    });

    // 监听处理错误
    window.electronAPI.onProcessError((event, data) => {
      this.addErrorLog(data.error);
    });

    // 监听答案提取
    window.electronAPI.onAnswersExtracted((event, data) => {
      this.displayAnswers(data);

      // 输出答案文件位置
      if (data.file) {
        this.addSuccessLog(`答案文件已保存到: ${data.file}`);
      }
    });

    // 监听捕获状态
    window.electronAPI.onCaptureStatus((event, data) => {
      this.updateCaptureStatus(data);
    });

    // 监听代理错误
    window.electronAPI.onProxyError((event, data) => {
      this.addErrorLog(data.message);
      // 如果代理出错，重置按钮状态
      const toggleBtn = document.getElementById('toggleProxyBtn');
      const captureBtn = document.getElementById('startCaptureBtn');

      if (stopBtn) {
        stopBtn.disabled = true;
      }
      if (captureBtn) {
        captureBtn.disabled = true;
      }

      this.isProxyRunning = false;
      this.updateProxyStatus({ running: false, message: '代理服务器出错' });
    });

    // 监听文件结构
    window.electronAPI.onFileStructure((event, data) => {
      this.displayFileStructure(data);
    });

    // 监听文件处理结果
    window.electronAPI.onFilesProcessed((event, data) => {
      this.displayProcessedFiles(data);
    });

    // 监听规则触发日志
    window.electronAPI.onRuleLog((event, data) => {
      this.addRuleLog(data);
    });

    // 监听更新下载进度
    if (window.electronAPI.onUpdateDownloadProgress) {
      window.electronAPI.onUpdateDownloadProgress((data) => {
        this.handleUpdateProgress(data);
      });
    }

    // 监听更新下载完成
    if (window.electronAPI.onUpdateDownloaded) {
      window.electronAPI.onUpdateDownloaded((data) => {
        this.handleUpdateDownloaded(data);
      });
    }

    if (window.electronAPI.onUpdateAvailable) {
      window.electronAPI.onUpdateAvailable((data) => {
        this.handleUpdateAvailable(data);
      });
    }

    window.electronAPI.chooseImplantZip(async (filePath) => {
      if (!filePath) {
        this.addErrorLog('未选择文件');
        return;
      }
      const zipImplantInput = document.getElementById('zipImplant');
      if (zipImplantInput) {
        zipImplantInput.value = filePath;
      }
    });
  }

  async toggleProxy() {
    if (this.isProxyRunning) {
      await this.stopProxy();
    } else {
      this.startProxy();
    }
  }

  startProxy() {
    const toggleBtn = document.getElementById('toggleProxyBtn');

    // 更新按钮状态
    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.innerHTML = '<i class="bi bi-hourglass-split"></i><span>启动中...</span>';
    }

    window.electronAPI.startAnswerProxy();
    this.addInfoLog('正在启动代理服务器...');

    // 设置超时检查，如果代理没有启动，显示错误信息
    setTimeout(() => {
      if (!this.isProxyRunning) {
        this.addErrorLog('代理服务器启动超时，请检查网络或端口占用');
        if (toggleBtn) {
          toggleBtn.disabled = false;
          toggleBtn.innerHTML = '<i class="bi bi-play-circle"></i><span>启动代理</span>';
          toggleBtn.className = 'primary-btn';
        }
      }
    }, 10000); // 10秒超时
  }

  stopProxy() {
    return new Promise((resolve) => {
      const toggleBtn = document.getElementById('toggleProxyBtn');

      // 更新按钮状态，防止重复点击
      if (toggleBtn) {
        toggleBtn.disabled = true;
        toggleBtn.innerHTML = '<i class="bi bi-hourglass-split"></i><span>停止中...</span>';
      }

      window.electronAPI.stopAnswerProxy();
      this.addInfoLog('正在停止代理服务器...');

      // 设置停止开始时间
      const stopStartTime = Date.now();
      let timeoutId = null;
      let resolved = false;

      // 监听代理状态变化
      const checkStopped = () => {
        if (resolved) return;

        if (!this.isProxyRunning) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          this.addSuccessLog('代理服务器已成功停止');
          resolve();
          return;
        }

        // 检查是否超过最大等待时间
        const elapsed = Date.now() - stopStartTime;
        if (elapsed < 8000) { // 8秒内继续检查
          setTimeout(checkStopped, 200); // 每200ms检查一次
        }
      };

      // 开始检查
      checkStopped();

      // 设置超时处理
      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;

        if (this.isProxyRunning) {
          this.addErrorLog('代理服务器停止超时，请尝试手动关闭进程或重启应用');

          // 强制更新状态为停止
          this.isProxyRunning = false;
          this.updateProxyStatus({
            running: false,
            message: '代理服务器停止超时'
          });
        } else {
          this.addInfoLog('代理服务器已停止');
        }

        resolve(); // 即使超时也要resolve，避免阻塞后续操作
      }, 8000); // 8秒超时
    });
  }

  updateProxyStatus(data) {
    const statusElement = document.getElementById('proxyStatus');
    const toggleBtn = document.getElementById('toggleProxyBtn');

    if (data.running) {
      this.isProxyRunning = true;
      const host = data.host || '127.0.0.1';
      const port = data.port || '5291';
      statusElement.textContent = `已开启在 ${host}:${port}`;
      statusElement.className = 'status-value running';

      if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.innerHTML = '<i class="bi bi-stop-circle"></i><span>停止代理</span>';
        toggleBtn.className = 'danger-btn';
      }

      this.addInfoLog(`代理服务器已启动，监听地址: ${host}:${port}`);
    } else {
      this.isProxyRunning = false;
      statusElement.textContent = '已停止';
      statusElement.className = 'status-value stopped';

      if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.innerHTML = '<i class="bi bi-play-circle"></i><span>启动代理</span>';
        toggleBtn.className = 'primary-btn';
      }

      this.addInfoLog('代理服务器已停止');
    }
  }

  // 初始化答案获取开关
  async initAnswerCaptureToggle(toggleElement) {
    try {
      // 从主进程获取当前状态
      const isEnabled = await window.electronAPI.getAnswerCaptureEnabled();
      toggleElement.checked = isEnabled;

      // 监听开关变化
      toggleElement.addEventListener('change', async () => {
        const enabled = toggleElement.checked;

        try {
          await window.electronAPI.setAnswerCaptureEnabled(enabled);

          if (enabled) {
            this.addSuccessLog('答案获取已启用');
          } else {
            this.addInfoLog('答案获取已禁用');
          }
        } catch (error) {
          this.addErrorLog(`设置答案获取开关失败: ${error.message}`);
          // 恢复开关状态
          toggleElement.checked = !enabled;
        }
      });
    } catch (error) {
      console.error('初始化答案获取开关失败:', error);
      // 默认启用
      toggleElement.checked = true;
    }
  }

  // 初始化代理端口设置
  async initProxyPortSettings() {
    try {
      // 初始化代理端口
      const currentProxyPort = await window.electronAPI.getProxyPort();

      // 保存端口到localStorage，供其他脚本使用
      localStorage.setItem('proxy-port', currentProxyPort.toString());

      const proxyPortInput = document.getElementById('proxyPortInput');
      if (proxyPortInput) {
        proxyPortInput.value = currentProxyPort;

        // 监听代理端口输入变化
        proxyPortInput.addEventListener('change', async () => {
          const newPort = parseInt(proxyPortInput.value);
          if (newPort >= 1024 && newPort <= 65535) {
            await this.changeProxyPort(newPort);
          } else {
            this.addErrorLog('端口号必须在1024-65535之间');
            proxyPortInput.value = currentProxyPort;
          }
        });
      }

      // 初始化答案服务器端口
      const currentBucketPort = await window.electronAPI.getBucketPort();

      // 保存答案服务器端口到localStorage，供其他脚本使用
      localStorage.setItem('bucket-port', currentBucketPort.toString());

      const bucketPortInput = document.getElementById('bucketPortInput');
      if (bucketPortInput) {
        bucketPortInput.value = currentBucketPort;

        // 监听答案服务器端口输入变化
        bucketPortInput.addEventListener('change', async () => {
          const newPort = parseInt(bucketPortInput.value);
          if (newPort >= 1024 && newPort <= 65535) {
            await this.changeBucketPort(newPort);
          } else {
            this.addErrorLog('端口号必须在1024-65535之间');
            bucketPortInput.value = currentBucketPort;
          }
        });
      }
    } catch (error) {
      console.error('初始化代理端口设置失败:', error);
    }
  }

  // 初始化缓存设置
  initCacheSettings() {
    try {
      const keepCacheCheckbox = document.getElementById('keepCacheFiles');
      if (keepCacheCheckbox) {
        // 加载当前设置
        const keepCache = localStorage.getItem('keep-cache-files') === 'true';
        keepCacheCheckbox.checked = keepCache;

        // 监听设置变化
        keepCacheCheckbox.addEventListener('change', () => {
          const newValue = keepCacheCheckbox.checked;
          localStorage.setItem('keep-cache-files', newValue.toString());

          if (newValue) {
            this.addSuccessLog('已启用缓存文件保留，答案提取的临时文件将不会被自动删除');
          } else {
            this.addInfoLog('已禁用缓存文件保留，答案提取的临时文件将被自动删除');
          }
        });
      }
    } catch (error) {
      console.error('初始化缓存设置失败:', error);
    }
  }

  initUpdateSettings() {
    try {
      const autoCheckUpdatesCheckbox = document.getElementById('autoCheckUpdates');
      if (autoCheckUpdatesCheckbox) {
        const autoCheckUpdates = localStorage.getItem('auto-check-updates') !== 'false';
        autoCheckUpdatesCheckbox.checked = autoCheckUpdates;

        autoCheckUpdatesCheckbox.addEventListener('change', () => {
          const newValue = autoCheckUpdatesCheckbox.checked;
          localStorage.setItem('auto-check-updates', newValue.toString());
          this.addInfoLog(`自动检查更新已${newValue ? '启用' : '禁用'}`);
        });
      }
    } catch (error) {
      console.error('初始化更新设置失败:', error);
    }
  }

  // 显示端口修改对话框
  showPortChangeDialog() {
    const currentPort = document.getElementById('proxyPortInput')?.value || '5291';

    // 创建自定义对话框
    this.createPortChangeModal(currentPort);
  }

  // 创建端口修改模态对话框
  createPortChangeModal(currentPort) {
    // 移除已存在的对话框
    const existingModal = document.getElementById('portChangeModal');
    if (existingModal) {
      existingModal.remove();
    }

    // 创建模态对话框HTML
    const modalHTML = `
      <div id="portChangeModal" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>修改代理端口</h3>
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="newPortInput">新端口号 (1024-65535):</label>
              <input type="number" id="newPortInput" class="form-input" 
                     value="${currentPort}" min="1024" max="65535" 
                     placeholder="请输入端口号">
            </div>
          </div>
          <div class="modal-footer">
            <button class="secondary-btn" onclick="this.closest('.modal-overlay').remove()">
              取消
            </button>
            <button class="primary-btn" id="confirmPortChange">
              确定
            </button>
          </div>
        </div>
      </div>
    `;

    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // 绑定确定按钮事件
    const confirmBtn = document.getElementById('confirmPortChange');
    const newPortInput = document.getElementById('newPortInput');

    confirmBtn.addEventListener('click', () => {
      const newPort = parseInt(newPortInput.value);
      if (newPort >= 1024 && newPort <= 65535) {
        this.changeProxyPort(newPort);
        document.getElementById('portChangeModal').remove();
      } else {
        this.addErrorLog('端口号必须在1024-65535之间');
        newPortInput.focus();
      }
    });

    // 绑定回车键事件
    newPortInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      }
    });

    // 自动聚焦并选中输入框内容
    setTimeout(() => {
      newPortInput.focus();
      newPortInput.select();
    }, 100);
  }

  // 修改代理端口
  async changeProxyPort(port) {
    try {
      const result = await window.electronAPI.setProxyPort(port);
      if (result.success) {
        // 保存端口到localStorage，供其他脚本使用
        localStorage.setItem('proxy-port', port.toString());

        // 更新设置页面的输入框
        const proxyPortInput = document.getElementById('proxyPortInput');
        if (proxyPortInput) {
          proxyPortInput.value = port;
        }

        this.addSuccessLog(`代理端口已修改为: ${port}`);

        // 如果代理正在运行，重启代理服务器
        if (this.isProxyRunning) {
          this.addInfoLog('正在重启代理服务器...');
          try {
            await this.stopProxy();
            // 等待一小段时间确保完全停止
            await new Promise(resolve => setTimeout(resolve, 500));
            this.startProxy();
          } catch (error) {
            this.addErrorLog(`重启代理服务器失败: ${error.message}`);
            // 如果停止失败，仍然尝试启动
            this.addInfoLog('尝试强制启动代理服务器...');
            this.startProxy();
          }
        }
      } else {
        this.addErrorLog(`修改端口失败: ${result.error}`);
      }
    } catch (error) {
      this.addErrorLog(`修改端口失败: ${error.message}`);
    }
  }

  // 修改答案服务器端口
  async changeBucketPort(port) {
    try {
      const result = await window.electronAPI.setBucketPort(port);
      if (result.success) {
        // 保存端口到localStorage，供其他脚本使用
        localStorage.setItem('bucket-port', port.toString());

        // 更新设置页面的输入框
        const bucketPortInput = document.getElementById('bucketPortInput');
        if (bucketPortInput) {
          bucketPortInput.value = port;
        }

        this.addSuccessLog(`答案服务器端口已修改为: ${port}`);

        // 如果代理正在运行，重启代理服务器以应用新的答案服务器端口
        if (this.isProxyRunning) {
          this.addInfoLog('正在重启代理服务器以应用新的答案服务器端口...');
          try {
            await this.stopProxy();
            // 等待一小段时间确保完全停止
            await new Promise(resolve => setTimeout(resolve, 500));
            this.startProxy();
          } catch (error) {
            this.addErrorLog(`重启代理服务器失败: ${error.message}`);
            // 如果停止失败，仍然尝试启动
            this.addInfoLog('尝试强制启动代理服务器...');
            this.startProxy();
          }
        }
      } else {
        this.addErrorLog(`修改答案服务器端口失败: ${result.error}`);
      }
    } catch (error) {
      this.addErrorLog(`修改答案服务器端口失败: ${error.message}`);
    }
  }

  updateCertificateStatus(data) {
    const statusElement = document.getElementById('certificateStatus');

    if (data.status === 'importing') {
      statusElement.textContent = '导入中';
      statusElement.className = 'status-value processing';
      this.addInfoLog(data.message);
    } else if (data.status === 'success') {
      statusElement.textContent = '已导入';
      statusElement.className = 'status-value success';
      this.addSuccessLog(data.message);
    } else if (data.status === 'error') {
      statusElement.textContent = '导入失败';
      statusElement.className = 'status-value error';
      this.addErrorLog(data.message);
    } else if (data.status === 'exists') {
      statusElement.textContent = '已存在';
      statusElement.className = 'status-value success';
      this.addSuccessLog(data.message);
    } else if (data.status === 'not_found') {
      statusElement.textContent = '未找到';
      statusElement.className = 'status-value error';
      this.addErrorLog(data.message);
    }
  }

  updateCaptureStatus(data) {
    const statusElement = document.getElementById('captureStatus');
    const startBtn = document.getElementById('startCaptureBtn');
    const stopBtn = document.getElementById('stopCaptureBtn');

    if (data.capturing) {
      statusElement.textContent = '监听中';
      statusElement.className = 'status-value running';
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      this.addSuccessLog('网络监听已启动');
    } else {
      statusElement.textContent = '未开始';
      statusElement.className = 'status-value stopped';
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      this.addInfoLog('网络监听已停止');
    }
  }

  updateProcessStatus(data) {
    const statusElement = document.getElementById('processStatus');

    if (data.status === 'processing') {
      statusElement.textContent = '处理中';
      statusElement.className = 'status-value processing';
      this.addInfoLog(data.message);
    } else if (data.status === 'completed') {
      statusElement.textContent = '已完成';
      statusElement.className = 'status-value success';
      this.addSuccessLog(data.message);
    } else if (data.status === 'error') {
      statusElement.textContent = '处理失败';
      statusElement.className = 'status-value error';
      this.addErrorLog(data.message);
    } else if (data.status === 'idle') {
      statusElement.textContent = '等待中';
      statusElement.className = 'status-value stopped';
      this.addInfoLog(data.message);
    }
  }

  addTrafficLog(data) {
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    const method = data.method || 'GET';
    const status = data.statusCode || data.status || '';
    const url = this.formatUrl(data.url);
    const size = data.bodySize ? this.formatFileSize(data.bodySize) : '';

    // 生成唯一ID
    const requestId = data.uuid || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 存储完整的请求数据
    this.requestDataMap.set(requestId, data);

    let logText = `${method} ${url}`;
    if (status) logText += ` - ${status}`;
    if (size) logText += ` (${size})`;

    let logType = 'normal';
    let iconClass = 'bi-globe';

    if (data.important) {
      logType = 'important';
      iconClass = 'bi-star-fill';
    } else if (status >= 400) {
      logType = 'error';
      iconClass = 'bi-x-circle';
    } else if (status >= 200 && status < 300) {
      logType = 'success';
      iconClass = 'bi-check-circle';
    }

    this.addLogItem(logText, logType, iconClass, requestId, timestamp);
  }

  // 格式化请求/响应体
  formatBody(body, fullDisplay = false) {
    if (!body) return '';

    try {
      if (typeof body === 'string') {
        // 尝试解析JSON
        try {
          const parsed = JSON.parse(body);
          const jsonStr = JSON.stringify(parsed, null, 2);
          return fullDisplay ? jsonStr : jsonStr.substring(0, 200) + (jsonStr.length > 200 ? '...' : '');
        } catch (e) {
          // 不是JSON，直接返回字符串
          return fullDisplay ? body : body.substring(0, 200) + (body.length > 200 ? '...' : '');
        }
      } else if (typeof body === 'object') {
        const jsonStr = JSON.stringify(body, null, 2);
        return fullDisplay ? jsonStr : jsonStr.substring(0, 200) + (jsonStr.length > 200 ? '...' : '');
      }
    } catch (e) {
      // 如果不是JSON，直接返回字符串的前200个字符
      const str = body.toString();
      return fullDisplay ? str : str.substring(0, 200) + (str.length > 200 ? '...' : '');
    }

    const str = body.toString();
    return fullDisplay ? str : str.substring(0, 200) + (str.length > 200 ? '...' : '');
  }

  // 格式化URL，确保显示完整URL
  formatUrl(url) {
    if (!url) return '';

    // 如果URL太长，显示域名和路径的关键部分
    if (url.length > 80) {
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const path = urlObj.pathname;
        const query = urlObj.search;

        if (path.length > 40) {
          const pathParts = path.split('/');
          const fileName = pathParts[pathParts.length - 1];
          return `${domain}/.../${fileName}${query}`;
        }

        return `${domain}${path}${query}`;
      } catch (e) {
        return url.substring(0, 80) + '...';
      }
    }

    return url;
  }

  // 格式化文件大小
  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
  }

  addImportantLog(data) {
    const logText = `[重要] ${data.url} - 包含关键数据`;
    this.addLogItem(logText, 'important', 'bi-star-fill', null, null);
  }

  addSuccessLog(message) {
    this.addLogItem(`${message}`, 'success', 'bi-check-circle', null, null);
  }

  addErrorLog(message) {
    this.addLogItem(`${message}`, 'error', 'bi-x-circle', null, null);
  }

  addInfoLog(message) {
    this.addLogItem(`${message}`, 'normal', 'bi-info-circle', null, null);
  }

  addRuleLog(data) {
    const iconClass = data.type === 'success' ? 'bi-gear-fill' : 'bi-exclamation-triangle-fill';
    const logType = data.type === 'success' ? 'rule-success' : 'rule-error';

    let message = data.message;
    if (data.details) {
      message += ` (${data.details})`;
    }

    this.addLogItem(message, logType, iconClass, null, null);
  }

  addLogItem(text, type, iconClass = 'bi-circle', requestId = null, timestamp = null) {
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;

    const logItem = document.createElement('div');
    const displayTimestamp = timestamp || new Date().toLocaleTimeString();

    if (requestId) {
      // 这是一个可点击的请求日志项
      logItem.className = `log-item ${type} clickable`;
      logItem.dataset.requestId = requestId;

      logItem.innerHTML = `
        <div class="log-time">${displayTimestamp}</div>
        <i class="${iconClass}"></i>
        <span class="log-text">${text}</span>
      `;

      // 添加点击事件
      logItem.addEventListener('click', () => {
        this.showRequestDetails(requestId);

        // 更新选中状态
        if (this.selectedLogItem) {
          this.selectedLogItem.classList.remove('selected');
        }
        logItem.classList.add('selected');
        this.selectedLogItem = logItem;
      });
    } else {
      // 这是一个普通的日志项（状态信息等）
      logItem.className = `log-item ${type}`;
      logItem.innerHTML = `
        <div class="log-time">${displayTimestamp}</div>
        <i class="${iconClass}"></i>
        <span class="log-text">${text}</span>
      `;
    }

    // 如果是第一个日志项且显示"等待网络请求..."，则替换它
    const firstItem = trafficLog.querySelector('.log-item');
    if (firstItem && firstItem.textContent.includes('等待网络请求')) {
      trafficLog.removeChild(firstItem);
    }

    trafficLog.appendChild(logItem);

    // 限制日志数量，保持最新的100条
    const logItems = trafficLog.querySelectorAll('.log-item');
    if (logItems.length > 100) {
      const removedItem = logItems[0];
      // 如果删除的是请求项，也要清理对应的数据
      if (removedItem.dataset.requestId) {
        this.requestDataMap.delete(removedItem.dataset.requestId);
      }
      trafficLog.removeChild(removedItem);
    }

    // 自动滚动到底部
    trafficLog.scrollTop = trafficLog.scrollHeight;

    // 更新请求计数
    this.updateRequestCount();
  }

  // 更新请求计数
  updateRequestCount() {
    const trafficLog = document.getElementById('trafficLog');
    const requestCountElement = document.getElementById('requestCount');

    if (trafficLog && requestCountElement) {
      const logItems = trafficLog.querySelectorAll('.log-item');
      let requestCount = 0;

      logItems.forEach(item => {
        if (!item.textContent.includes('等待网络请求')) {
          requestCount++;
        }
      });

      requestCountElement.textContent = requestCount;
    }
  }

  displayFileStructure(data) {
    this.addInfoLog(`文件结构分析完成，解压目录: ${data.extractDir}`);

    if (data.structure && data.structure.length > 0) {
      const structureText = this.formatFileStructure(data.structure);
      this.addLogItem(`文件结构:\n${structureText}`, 'detail', 'bi-folder', null, null);
    }
  }

  async downloadResponse(uuid) {
    let res = await window.electronAPI.downloadFile(uuid)
    if (res === 1) {
      this.addSuccessLog('文件下载成功');
    } else {
      this.addErrorLog('文件下载失败');
    }
  }

  displayProcessedFiles(data) {
    this.addInfoLog(`文件处理完成，共处理 ${data.processedFiles.length} 个文件，提取到 ${data.totalAnswers} 个答案`);

    if (data.processedFiles && data.processedFiles.length > 0) {
      data.processedFiles.forEach(file => {
        const fileName = file.file || file.name || '未知文件';
        const answerCount = file.answerCount || file.answers || 0;
        this.addLogItem(`处理文件: ${fileName} - 提取 ${answerCount} 个答案`, 'success', 'bi-file-check', null, null);
      });
    }

    // 输出答案文件位置
    if (data.file) {
      this.addSuccessLog(`答案文件已保存到: ${data.file}`);
    }
  }

  formatFileStructure(structure, depth = 0) {
    const indent = '  '.repeat(depth);
    let result = '';

    structure.forEach(item => {
      if (item.type === 'directory') {
        result += `${indent}📁 ${item.name}\n`;
        if (item.children) {
          result += this.formatFileStructure(item.children, depth + 1);
        }
      } else {
        result += `${indent}📄 ${item.name}\n`;
      }
    });

    return result;
  }

  displayAnswers(data) {
    const container = document.getElementById('answersContainer');
    if (!container) return;

    this.lastAnswersData = data;

    if (!data || !data.answers || data.answers.length === 0) {
      container.innerHTML = `
        <div class="no-answers">
          <i class="bi bi-inbox"></i>
          <p>暂无答案数据</p>
        </div>
      `;
      return;
    }

    // 根据排序模式组织数据
    let organizedData = {};

    if (this.sortMode === 'file') {
      // 按文件分组
      data.answers.forEach(answer => {
        const fileName = answer.file || '未知文件';
        if (!organizedData[fileName]) {
          organizedData[fileName] = [];
        }
        organizedData[fileName].push(answer);
      });
    } else {
      // 按题型分组
      data.answers.forEach(answer => {
        const pattern = answer.pattern || '未知题型';
        if (!organizedData[pattern]) {
          organizedData[pattern] = [];
        }
        organizedData[pattern].push(answer);
      });
    }

    // 生成HTML
    let html = '';
    Object.keys(organizedData).forEach(groupName => {
      const answers = organizedData[groupName];
      html += `
        <div class="answer-group">
          <div class="group-header">
            <h4>${groupName}</h4>
            <span class="answer-count">${answers.length} 个答案</span>
          </div>
          <div class="answers-list">
      `;

      answers.forEach((answer, index) => {
        const answerId = `answer_${Date.now()}_${index}`;
        const answerText = answer.answer || '无答案';

        // 优先使用questionText字段，如果没有则使用question字段
        let questionText = answer.questionText || answer.question || '无题目';

        // 如果question字段包含"第X题"格式，尝试从content字段提取真正的题目
        if (questionText.match(/^第\d+题/) && answer.content) {
          const contentMatch = answer.content.match(/题目:\s*(.+?)(?:\n|$)/);
          if (contentMatch) {
            questionText = contentMatch[1].trim();
          }
        }

        // 安全地转义HTML和JavaScript字符
        const safeAnswerText = answerText.replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeQuestionText = questionText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        html += `
          <div class="answer-item">
            <div class="answer-header">
              <span class="answer-index">#${index + 1}</span>
              <span class="answer-type">${answer.pattern || '未知题型'}</span>
              <button class="copy-answer-btn" onclick="universalAnswerFeature.copyAnswerByIndex(${index}, '${groupName}', this)" title="复制答案">
                <i class="bi bi-copy"></i>
              </button>
            </div>
            <div class="answer-content">
              <div class="question">${safeQuestionText}</div>
              <div class="answer clickable-answer" onclick="universalAnswerFeature.copyAnswerByIndex(${index}, '${groupName}', this)" title="点击复制答案">${safeAnswerText}</div>
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    this.addSuccessLog(`显示答案完成，共 ${data.answers.length} 个答案`);
  }

  // 通过索引复制答案功能
  copyAnswerByIndex(answerIndex, groupName, element) {
    try {
      if (!this.lastAnswersData || !this.lastAnswersData.answers) {
        this.showCopyToast('没有可复制的答案数据', 'error');
        return;
      }

      // 根据排序模式找到对应的答案
      let targetAnswer = null;

      if (this.sortMode === 'file') {
        const groupAnswers = this.lastAnswersData.answers.filter(answer =>
          (answer.file || '未知文件') === groupName
        );
        targetAnswer = groupAnswers[answerIndex];
      } else {
        const groupAnswers = this.lastAnswersData.answers.filter(answer =>
          (answer.pattern || '未知题型') === groupName
        );
        targetAnswer = groupAnswers[answerIndex];
      }

      if (!targetAnswer) {
        this.showCopyToast('找不到对应的答案', 'error');
        return;
      }

      const answerText = targetAnswer.answer || '无答案';
      this.copyAnswer(answerText, element);

    } catch (error) {
      console.error('复制答案失败:', error);
      this.showCopyToast('复制失败', 'error');
    }
  }

  // 复制答案功能
  copyAnswer(answerText, element) {
    try {
      // 使用现代的 Clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(answerText).then(() => {
          this.showCopyToast('答案已复制到剪贴板', 'success');
          this.animateCopyButton(element);
        }).catch(err => {
          console.error('复制失败:', err);
          this.fallbackCopyText(answerText, element);
        });
      } else {
        // 降级方案
        this.fallbackCopyText(answerText, element);
      }
    } catch (error) {
      console.error('复制答案失败:', error);
      this.showCopyToast('复制失败', 'error');
    }
  }

  // 降级复制方案
  fallbackCopyText(text, element) {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        this.showCopyToast('答案已复制到剪贴板', 'success');
        this.animateCopyButton(element);
      } else {
        this.showCopyToast('复制失败', 'error');
      }
    } catch (err) {
      console.error('降级复制失败:', err);
      this.showCopyToast('复制失败', 'error');
    }
  }

  // 显示复制提示
  showCopyToast(message, type = 'success') {
    // 移除现有的提示
    const existingToast = document.querySelector('.copy-toast');
    if (existingToast) {
      existingToast.remove();
    }

    // 创建新的提示
    const toast = document.createElement('div');
    toast.className = `copy-toast ${type}`;
    toast.innerHTML = `
      <i class="bi bi-${type === 'success' ? 'check-circle' : 'x-circle'}"></i>
      <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // 显示动画
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    // 自动隐藏
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 2000);
  }

  // 复制按钮动画
  animateCopyButton(element) {
    if (element && element.classList) {
      element.classList.add('copied');
      setTimeout(() => {
        element.classList.remove('copied');
      }, 1000);
    }
  }

  handleDeleteTemp() {
    const resultDiv = document.getElementById('trafficLog');

    const confirmHtml = `
      <div class="log-item warning">
        <i class="bi bi-exclamation-triangle"></i>
        <span>确定要清理Auto366临时文件吗？此操作不可撤销。</span>
        <div class="cache-buttons">
          <button onclick="this.parentElement.remove()" class="btn-small btn-cancel">取消</button>
          <button onclick="universalAnswerFeature.confirmDeleteTemp()" class="btn-small btn-danger">确认清理</button>
        </div>
      </div>
    `;

    resultDiv.insertAdjacentHTML('beforeend', confirmHtml);
    resultDiv.scrollTop = resultDiv.scrollHeight;
  }

  confirmDeleteTemp() {
    // 移除确认对话框
    const confirmDialog = document.querySelector('.log-item.warning');
    if (confirmDialog) {
      confirmDialog.remove();
    }

    // 显示清理进度
    this.addInfoLog('正在清理Auto366缓存...');

    window.electronAPI.clearCache().then(result => {
      if (result && result.success) {
        this.addSuccessLog(`Auto366缓存清理成功 - 已清理 ${result.filesDeleted} 个文件，${result.dirsDeleted} 个目录`);
      } else if (result && !result.success) {
        this.addErrorLog(`Auto366缓存清理失败: ${result.error || '未知错误'}`);
      } else {
        this.addSuccessLog('Auto366缓存清理完成');
      }
    }).catch(error => {
      this.addErrorLog(`Auto366缓存清理失败: ${error.message || error}`);
    });
  }

  handleDeleteFileTemp() {
    const resultDiv = document.getElementById('trafficLog');

    const confirmHtml = `
      <div class="log-item warning">
        <i class="bi bi-exclamation-triangle"></i>
        <span>确定要清理天学网文件缓存吗？此操作将删除flipbooks和homework目录，不可撤销。</span>
        <div class="cache-buttons">
          <button onclick="this.parentElement.remove()" class="btn-small btn-cancel">取消</button>
          <button onclick="universalAnswerFeature.confirmDeleteFileTemp()" class="btn-small btn-danger">确认清理</button>
        </div>
      </div>
    `;

    resultDiv.insertAdjacentHTML('beforeend', confirmHtml);
    resultDiv.scrollTop = resultDiv.scrollHeight;
  }

  confirmDeleteFileTemp() {
    // 移除确认对话框
    const confirmDialog = document.querySelector('.log-item.warning');
    if (confirmDialog) {
      confirmDialog.remove();
    }

    // 显示清理进度
    this.addInfoLog('正在清理天学网缓存...');

    const result = window.electronAPI.removeCacheFile();
    if (result && result.success) {
      this.addSuccessLog(`天学网缓存清理成功 - 已清理 ${result.filesDeleted} 个文件，${result.dirsDeleted} 个目录`);
    } else if (result && !result.success) {
      this.addErrorLog(`天学网缓存清理失败: ${result.error || '未知错误'}`);
    } else if (result) {
      this.addSuccessLog('天学网缓存清理完成');
    } else {
      this.addErrorLog('天学网缓存清理失败');
    }
  }

  async handleUpdateNotification() {
    // 检查更新功能
    const updateBtn = document.getElementById('update-notification-btn');
    this.addInfoLog('正在检查更新...');

    if (window.electronAPI && window.electronAPI.checkForUpdates) {
      window.electronAPI.checkForUpdates().then(async (result) => {
        if (result.hasUpdate) {
          this.addSuccessLog(`发现新版本 ${result.version}`);
          await this.showUpdatePanel(result);
          if (updateBtn) {
            updateBtn.classList.add('has-update');
            updateBtn.title = `发现新版本 ${result.version}`;
          }
        } else if (result.isDev) {
          this.addInfoLog('开发环境不支持自动更新');
          if (updateBtn) {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '开发环境';
          }
        } else if (result.error) {
          this.addErrorLog('检查更新失败: ' + result.error);
          if (updateBtn) {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '检查更新失败';
          }
        } else {
          this.addInfoLog(result.message || '当前已是最新版本');
          if (updateBtn) {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '当前已是最新版本';
          }
        }
      }).catch(error => {
        this.addErrorLog('检查更新失败: ' + error.message);
        if (updateBtn) {
          updateBtn.classList.remove('has-update');
          updateBtn.title = '检查更新失败';
        }
      });
    } else {
      this.addInfoLog('请访问官网下载最新版本');
      if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal('https://366.cyril.qzz.io');
      }
    }
  }

  async showUpdatePanel(updateInfo) {
    const existingPanel = document.getElementById('update-panel');
    if (existingPanel) {
      existingPanel.remove();
    }

    let currentVersion = '未知';
    try {
      if (window.electronAPI && window.electronAPI.getAppVersion) {
        currentVersion = await window.electronAPI.getAppVersion();
      }
    } catch (error) {
      console.error('获取应用版本失败:', error);
    }

    const updatePanel = document.createElement('div');
    updatePanel.id = 'update-panel';
    updatePanel.className = 'update-panel';

    updatePanel.innerHTML = `
      <div class="update-panel-overlay"></div>
      <div class="update-panel-content">
        <div class="update-panel-header">
          <h3>发现新版本</h3>
          <button class="update-panel-close" onclick="this.closest('.update-panel').remove()">×</button>
        </div>
        <div class="update-panel-body">
          <div class="update-version-info">
            <div class="current-version">
              <span class="version-label">当前版本:</span>
              <span class="version-number">${currentVersion}</span>
            </div>
            <div class="new-version">
              <span class="version-label">最新版本:</span>
              <span class="version-number highlight">${updateInfo.version}</span>
            </div>
          </div>
          <div class="update-changelog">
            <h4>更新内容:</h4>
            <div class="changelog-content">
              ${updateInfo.releaseNotes || '• 性能优化和错误修复<br>• 改进用户体验<br>• 新增功能和特性'}
            </div>
          </div>
        </div>
        <div class="update-panel-footer">
          <button class="update-btn-cancel" onclick="this.closest('.update-panel').remove()">
            稍后提醒
          </button>
          <button class="update-btn-download" onclick="universalAnswerFeature.startUpdateDownload('${updateInfo.version}')">
            立即更新
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(updatePanel);
  }

  startUpdateDownload(version) {
    const updatePanel = document.getElementById('update-panel');
    if (updatePanel) {
      updatePanel.remove();
    }

    this.addInfoLog(`开始下载版本 ${version}...`);

    if (window.electronAPI && window.electronAPI.updateConfirm) {
      window.electronAPI.updateConfirm();
    }
  }

  handleUpdateProgress(progressData) {
    if (!progressData || typeof progressData !== 'object') {
      console.warn('handleUpdateProgress: progressData is undefined or invalid');
      return;
    }

    const { percent = 0, bytesPerSecond = 0, total = 0, transferred = 0 } = progressData;

    const roundedPercent = Math.floor(percent / 5) * 5;

    if (!this.lastProgressPercent || this.lastProgressPercent !== roundedPercent) {
      this.lastProgressPercent = roundedPercent;

      const speedMB = (bytesPerSecond / 1024 / 1024).toFixed(2);
      const totalMB = (total / 1024 / 1024).toFixed(2);
      const transferredMB = (transferred / 1024 / 1024).toFixed(2);

      this.addInfoLog(`更新下载进度: ${roundedPercent}% (${transferredMB}MB/${totalMB}MB) - 速度: ${speedMB}MB/s`);
    }
  }

  handleUpdateAvailable(updateInfo) {
    this.addSuccessLog(`发现新版本 ${updateInfo.version}`);

    this.showUpdatePanel(updateInfo);

    const updateBtn = document.getElementById('update-notification-btn');
    if (updateBtn) {
      updateBtn.classList.add('has-update');
      updateBtn.title = `发现新版本 ${updateInfo.version}`;
    }
  }

  handleUpdateDownloaded(data) {
    this.addSuccessLog('更新下载完成，准备安装...');

    this.showUpdateInstallDialog();
  }

  showUpdateInstallDialog() {
    const existingDialog = document.getElementById('update-install-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    const installDialog = document.createElement('div');
    installDialog.id = 'update-install-dialog';
    installDialog.className = 'update-panel';

    installDialog.innerHTML = `
      <div class="update-panel-overlay"></div>
      <div class="update-panel-content">
        <div class="update-panel-header">
          <h3>更新已下载完成</h3>
        </div>
        <div class="update-panel-body">
          <div class="update-install-message">
            <p>新版本已下载完成，是否立即重启应用进行安装？</p>
            <p class="install-warning">安装过程中应用将会关闭，请确保已保存所有工作。</p>
          </div>
        </div>
        <div class="update-panel-footer">
          <button class="update-btn-cancel" onclick="this.closest('.update-panel').remove()">
            稍后安装
          </button>
          <button class="update-btn-download" onclick="universalAnswerFeature.installUpdate()">
            立即安装
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(installDialog);
  }

  installUpdate() {
    const installDialog = document.getElementById('update-install-dialog');
    if (installDialog) {
      installDialog.remove();
    }

    this.addInfoLog('正在安装更新...');

    if (window.electronAPI && window.electronAPI.updateInstall) {
      window.electronAPI.updateInstall();
    }
  }

  // 规则集管理方法
  showRuleGroupModal(ruleGroup = null) {
    const modal = document.getElementById('ruleGroupModal');
    const title = document.getElementById('ruleGroupModalTitle');
    const form = document.getElementById('ruleGroupForm');

    if (ruleGroup) {
      // 编辑模式
      title.textContent = '编辑规则集';
      this.currentEditingRuleGroup = ruleGroup;
      this.populateRuleGroupForm(ruleGroup);
    } else {
      // 添加模式
      title.textContent = '添加规则集';
      this.currentEditingRuleGroup = null;
      form.reset();
    }

    modal.style.display = 'flex';
  }

  hideRuleGroupModal() {
    const modal = document.getElementById('ruleGroupModal');
    modal.style.display = 'none';
    this.currentEditingRuleGroup = null;
  }

  populateRuleGroupForm(ruleGroup) {
    document.getElementById('ruleGroupName').value = ruleGroup.name || '';
    document.getElementById('ruleGroupDescription').value = ruleGroup.description || '';
    document.getElementById('ruleGroupAuthor').value = ruleGroup.author || '';
    document.getElementById('ruleGroupEnabled').checked = ruleGroup.enabled !== false;
  }

  async saveRuleGroup() {
    const ruleGroup = {
      id: this.currentEditingRuleGroup?.id || null,
      name: document.getElementById('ruleGroupName').value.trim(),
      description: document.getElementById('ruleGroupDescription').value.trim(),
      author: document.getElementById('ruleGroupAuthor').value.trim(),
      enabled: document.getElementById('ruleGroupEnabled').checked,
      isGroup: true,
      rules: this.currentEditingRuleGroup?.rules || []
    };

    // 验证必填字段
    if (!ruleGroup.name) {
      this.addErrorLog('请输入规则集名称');
      return;
    }

    try {
      // 调用后端API保存规则集
      const result = await window.electronAPI.saveRule(ruleGroup);

      if (result && result.success) {
        this.addSuccessLog(this.currentEditingRuleGroup ? '规则集更新成功' : '规则集添加成功');
        this.hideRuleGroupModal();
        this.loadRules();
      } else {
        this.addErrorLog('保存规则集失败: ' + (result ? result.error : '未知错误'));
      }
    } catch (error) {
      console.error('保存规则集失败:', error);
      this.addErrorLog('保存规则集失败: ' + error.message);
    }
  }

  // 规则管理相关方法
  showRuleModal(rule = null, groupId = null) {
    const modal = document.getElementById('ruleModal');
    const title = document.getElementById('ruleModalTitle');
    const form = document.getElementById('ruleForm');

    if (rule) {
      // 编辑模式
      title.textContent = '编辑规则';
      this.currentEditingRule = rule;
      this.currentRuleGroupId = rule.groupId || groupId;
      this.populateRuleForm(rule);
    } else {
      // 添加模式
      title.textContent = '添加规则';
      this.currentEditingRule = null;
      this.currentRuleGroupId = groupId;
      form.reset();
      this.showRuleFields('');
    }

    modal.style.display = 'flex';
  }

  hideRuleModal() {
    const modal = document.getElementById('ruleModal');
    modal.style.display = 'none';
    this.currentEditingRule = null;
  }

  showRuleFields(ruleType) {
    // 隐藏所有规则字段
    const allFields = document.querySelectorAll('.rule-fields');
    allFields.forEach(field => {
      field.style.display = 'none';
    });

    // 显示对应的字段
    if (ruleType) {
      const targetFields = document.getElementById(`${ruleType.replace('-', '')}Fields`);
      if (targetFields) {
        targetFields.style.display = 'block';
      }
    }
  }

  populateRuleForm(rule) {
    document.getElementById('ruleName').value = rule.name || '';
    document.getElementById('ruleType').value = rule.type || '';
    document.getElementById('ruleDescription').value = rule.description || '';
    document.getElementById('ruleEnabled').checked = rule.enabled !== false;

    // 显示对应的字段
    this.showRuleFields(rule.type);

    // 根据规则类型填充特定字段
    if (rule.type === 'content-change') {
      document.getElementById('urlPattern').value = rule.urlPattern || '';
      document.getElementById('changeType').value = rule.changeType || 'request-body';
      document.getElementById('originalContent').value = rule.originalContent || '';
      document.getElementById('newContent').value = rule.newContent || '';
    } else if (rule.type === 'zip-implant') {
      document.getElementById('urlFileinfo').value = rule.urlFileinfo || '';
      document.getElementById('urlZip').value = rule.urlZip || '';
      document.getElementById('zipImplant').value = rule.zipImplant || '';
    } else if (rule.type === 'answer-upload') {
      document.getElementById('urlUpload').value = rule.urlUpload || '';
      document.getElementById('uploadType').value = rule.uploadType || 'original';
      document.getElementById('serverLocate').value = rule.serverLocate || '';
    }
  }

  async saveRule() {
    const form = document.getElementById('ruleForm');

    // 基本信息
    const rule = {
      id: this.currentEditingRule?.id || null,
      name: document.getElementById('ruleName').value.trim(),
      type: document.getElementById('ruleType').value,
      description: document.getElementById('ruleDescription').value.trim(),
      enabled: document.getElementById('ruleEnabled').checked,
      groupId: this.currentRuleGroupId || null
    };

    // 验证基本字段
    if (!rule.name) {
      this.addErrorLog('请输入规则名称');
      return;
    }

    if (!rule.type) {
      this.addErrorLog('请选择规则类型');
      return;
    }

    // 根据规则类型添加特定字段
    if (rule.type === 'content-change') {
      rule.urlPattern = document.getElementById('urlPattern').value.trim();
      rule.changeType = document.getElementById('changeType').value;
      rule.originalContent = document.getElementById('originalContent').value.trim();
      rule.newContent = document.getElementById('newContent').value.trim();
      rule.action = 'modify';
      rule.modifyRules = [
        {
          find: rule.originalContent,
          replace: rule.newContent
        }
      ];

      if (!rule.urlPattern) {
        this.addErrorLog('请输入URL匹配模式');
        return;
      }
    } else if (rule.type === 'zip-implant') {
      rule.urlFileinfo = document.getElementById('urlFileinfo').value.trim();
      rule.urlZip = document.getElementById('urlZip').value.trim();
      rule.zipImplant = document.getElementById('zipImplant').value.trim();

      if (!rule.urlZip) {
        this.addErrorLog('请输入ZIP文件URL匹配');
        return;
      }

      if (!rule.zipImplant) {
        this.addErrorLog('请选择注入ZIP文件');
        return;
      }
    } else if (rule.type === 'answer-upload') {
      rule.urlUpload = document.getElementById('urlUpload').value.trim();
      rule.uploadType = document.getElementById('uploadType').value;
      rule.serverLocate = document.getElementById('serverLocate').value.trim();

      if (!rule.urlUpload) {
        this.addErrorLog('请输入上传URL匹配');
        return;
      }
    }

    try {
      // 调用后端API保存规则
      const result = await window.electronAPI.saveRule(rule);

      if (result && result.success) {
        this.addSuccessLog(this.currentEditingRule ? '规则更新成功' : '规则添加成功');
        this.hideRuleModal();
        this.loadRules();
      } else {
        this.addErrorLog('保存规则失败: ' + (result ? result.error : '未知错误'));
      }
    } catch (error) {
      console.error('保存规则失败:', error);
      this.addErrorLog('保存规则失败: ' + error.message);
    }
  }

  async loadRules() {
    try {
      const rules = await window.electronAPI.getRules();
      this.displayRules(rules);
    } catch (error) {
      this.addErrorLog(`加载规则失败: ${error.message}`);
      this.displayRules([]);
    }
  }

  displayRules(rules) {
    const rulesContent = document.querySelector('#rules-view .rules-content');

    if (!rules || rules.length === 0) {
      rulesContent.innerHTML = `
        <div class="no-rules">
          <i class="bi bi-collection"></i>
          <p>暂无规则集配置</p>
          <p class="text-muted">点击上方按钮添加新规则集</p>
        </div>
      `;
      return;
    }

    // 分离规则集和独立规则
    const ruleGroups = rules.filter(rule => rule.isGroup);
    const independentRules = rules.filter(rule => !rule.isGroup && !rule.groupId);

    let html = '<div class="rules-list">';

    // 显示规则集
    ruleGroups.forEach(group => {
      const groupRules = rules.filter(rule => rule.groupId === group.id);
      const statusClass = group.enabled ? 'enabled' : 'disabled';

      html += `
        <div class="rule-group" data-group-id="${group.id}">
          <div class="rule-group-header">
            <div class="rule-group-info">
              <div class="rule-group-name">
                <i class="bi bi-collection"></i>
                ${group.name || '未命名规则集'}
                <label class="rule-toggle">
                  <input type="checkbox" ${group.enabled ? 'checked' : ''} 
                         onchange="universalAnswerFeature.toggleRule('${group.id}', this.checked)">
                  <span class="rule-toggle-slider"></span>
                </label>
                <span class="rule-count">(${groupRules.length} 个规则)</span>
              </div>
              ${group.description ? `<div class="rule-group-description">${group.description}</div>` : ''}
              ${group.author ? `<div class="rule-group-author">作者: ${group.author}</div>` : ''}
            </div>
            <div class="rule-group-actions">
              <button class="rule-btn add-rule-btn" onclick="universalAnswerFeature.showRuleModal(null, '${group.id}')" title="添加规则">
                <i class="bi bi-plus"></i>
              </button>
              <button class="rule-btn edit-btn" onclick="universalAnswerFeature.editRuleGroup('${group.id}')" title="编辑规则集">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="rule-btn delete-btn" onclick="universalAnswerFeature.deleteRule('${group.id}')" title="删除规则集">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
          <div class="rule-group-content">
            ${this.generateGroupRulesHtml(groupRules, group.enabled)}
          </div>
        </div>
      `;
    });

    // 显示独立规则
    if (independentRules.length > 0) {
      html += `
        <div class="rule-group independent-rules">
          <div class="rule-group-header">
            <div class="rule-group-info">
              <div class="rule-group-name">
                <i class="bi bi-list-ul"></i>
                独立规则
                <span class="rule-count">(${independentRules.length} 个规则)</span>
              </div>
            </div>
          </div>
          <div class="rule-group-content">
            ${this.generateGroupRulesHtml(independentRules, true)}
          </div>
        </div>
      `;
    }

    html += '</div>';
    rulesContent.innerHTML = html;
  }

  generateGroupRulesHtml(rules, parentGroupEnabled = true) {
    if (!rules || rules.length === 0) {
      return `
        <div class="no-group-rules">
          <i class="bi bi-info-circle"></i>
          <span>暂无规则</span>
        </div>
      `;
    }

    let html = '';
    rules.forEach(rule => {
      // 规则的有效状态：规则本身启用 且 父规则集启用（如果有的话）
      const isEffective = rule.enabled && parentGroupEnabled;
      const statusClass = isEffective ? 'enabled' : 'disabled';
      const typeClass = rule.type ? rule.type.replace('-', '') : '';

      // 如果父规则集被禁用，子规则的开关应该显示为禁用状态
      const isDisabledByParent = !parentGroupEnabled;

      html += `
        <div class="rule-item ${statusClass}" data-rule-id="${rule.id}">
          <div class="rule-header">
            <div class="rule-info">
              <div class="rule-name">
                ${rule.name || '未命名规则'}
                <label class="rule-toggle ${isDisabledByParent ? 'disabled-by-parent' : ''}">
                  <input type="checkbox" ${rule.enabled ? 'checked' : ''} 
                         ${isDisabledByParent ? 'disabled' : ''}
                         onchange="universalAnswerFeature.toggleRule('${rule.id}', this.checked)"
                         title="${isDisabledByParent ? '规则集已禁用，无法单独启用此规则' : ''}">
                  <span class="rule-toggle-slider"></span>
                </label>
              </div>
              ${rule.description ? `<div class="rule-description">${rule.description}</div>` : ''}
            </div>
            <div class="rule-actions">
              <button class="rule-btn edit-btn" onclick="universalAnswerFeature.editRule('${rule.id}')" title="编辑">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="rule-btn delete-btn" onclick="universalAnswerFeature.deleteRule('${rule.id}')" title="删除">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
          <div class="rule-config">
            ${this.formatRuleConfig(rule)}
          </div>
        </div>
      `;
    });

    return html;
  }

  async editRuleGroup(groupId) {
    try {
      const rules = await window.electronAPI.getRules();
      const group = rules.find(r => r.id === groupId && r.isGroup);
      if (group) {
        this.showRuleGroupModal(group);
      } else {
        this.addErrorLog('规则集不存在');
      }
    } catch (error) {
      console.error('获取规则集失败:', error);
      this.addErrorLog('获取规则集失败: ' + error.message);
    }
  }

  getRuleTypeText(type) {
    const typeMap = {
      'content-change': '内容修改',
      'zip-implant': 'ZIP注入',
      'answer-upload': '答案上传'
    };
    return typeMap[type] || type || '未知类型';
  }

  formatRuleConfig(rule) {
    let html = '<div class="config-items">';

    if (rule.type === 'content-change') {
      html += `
        <div class="config-item">
          <span class="config-label">URL匹配:</span>
          <span class="config-value">${rule.urlPattern || '未设置'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">修改类型:</span>
          <span class="config-value">${this.getChangeTypeLabel(rule.changeType)}</span>
        </div>
        <div class="config-item">
          <span class="config-label">原始内容:</span>
          <span class="config-value">${rule.originalContent || '未设置'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">新内容:</span>
          <span class="config-value">${rule.newContent || '未设置'}</span>
        </div>
      `;
    } else if (rule.type === 'zip-implant') {
      html += `
        <div class="config-item">
          <span class="config-label">文件信息URL匹配:</span>
          <span class="config-value">${rule.urlFileinfo || '未设置（匹配所有fileinfo请求）'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">ZIP URL匹配:</span>
          <span class="config-value">${rule.urlZip || '未设置'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">注入文件:</span>
          <span class="config-value">${rule.zipImplant || '未设置'}</span>
        </div>
      `;
    } else if (rule.type === 'answer-upload') {
      html += `
        <div class="config-item">
          <span class="config-label">上传URL匹配:</span>
          <span class="config-value">${rule.urlUpload || '未设置'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">上传类型:</span>
          <span class="config-value">${rule.uploadType === 'original' ? '原始数据' : '提取的答案'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">服务器位置:</span>
          <span class="config-value">${rule.serverLocate || '未设置'}</span>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  getChangeTypeLabel(changeType) {
    const labels = {
      'request-body': '请求体',
      'response-body': '响应体',
      'request-headers': '请求头',
      'response-headers': '响应头'
    };
    return labels[changeType] || changeType || '未设置';
  }

  async editRule(ruleId) {
    try {
      const rules = await window.electronAPI.getRules();
      const rule = rules.find(r => r.id === ruleId);
      if (rule) {
        this.showRuleModal(rule);
      } else {
        this.addErrorLog('规则不存在');
      }
    } catch (error) {
      this.addErrorLog(`加载规则失败: ${error.message}`);
    }
  }

  async deleteRule(ruleId) {
    if (!confirm('确定要删除这个规则吗？此操作不可撤销。')) {
      return;
    }

    try {
      const result = await window.electronAPI.deleteRule(ruleId);
      if (result.success) {
        this.addSuccessLog('规则删除成功');
        this.loadRules(); // 重新加载规则列表
      } else {
        this.addErrorLog(`规则删除失败: ${result.error}`);
      }
    } catch (error) {
      this.addErrorLog(`规则删除失败: ${error.message}`);
    }
  }

  async toggleRule(ruleId, enabled) {
    try {
      const result = await window.electronAPI.toggleRule(ruleId, enabled);
      if (result.success) {
        this.addSuccessLog(`规则已${enabled ? '启用' : '禁用'}`);

        // 检查是否是规则集，如果是规则集则重新加载整个列表以更新子规则状态
        const rules = await window.electronAPI.getRules();
        const toggledRule = rules.find(r => r.id === ruleId);

        if (toggledRule && toggledRule.isGroup) {
          // 如果是规则集，重新加载整个规则列表
          this.loadRules();
        } else {
          // 如果是普通规则，只更新状态显示
          this.updateRuleStatus(ruleId, enabled);
        }
      } else {
        this.addErrorLog(`规则状态更新失败: ${result.error}`);
        // 恢复开关状态
        const checkbox = document.querySelector(`input[onchange*="${ruleId}"]`);
        if (checkbox) {
          checkbox.checked = !enabled;
        }
      }
    } catch (error) {
      this.addErrorLog(`规则状态更新失败: ${error.message}`);
      // 恢复开关状态
      const checkbox = document.querySelector(`input[onchange*="${ruleId}"]`);
      if (checkbox) {
        checkbox.checked = !enabled;
      }
    }
  }

  updateRuleStatus(ruleId, enabled) {
    const ruleItem = document.querySelector(`input[onchange*="${ruleId}"]`)?.closest('.rule-item');
    if (ruleItem) {
      const statusSpan = ruleItem.querySelector('.rule-status');
      if (statusSpan) {
        statusSpan.textContent = enabled ? '已启用' : '已禁用';
        statusSpan.className = `rule-status ${enabled ? 'enabled' : 'disabled'}`;
      }
      ruleItem.className = `rule-item ${enabled ? 'enabled' : 'disabled'}`;
    }
  }

  browseZipFile() {
    window.electronAPI.openImplantZipChoosing();
  }

  // 显示请求详情
  showRequestDetails(requestId) {
    const requestData = this.requestDataMap.get(requestId);
    if (!requestData) return;

    const detailsPanel = document.getElementById('requestDetails');
    const detailsResizer = document.getElementById('detailsResizer');
    const detailsContent = document.getElementById('detailsContent');

    // 显示详情面板
    detailsPanel.style.display = 'flex';
    detailsResizer.style.display = 'block';

    // 从localStorage恢复保存的宽度比例
    const savedMonitorFlex = localStorage.getItem('trafficMonitorFlex') || '1';
    const savedDetailsFlex = localStorage.getItem('requestDetailsFlex') || '1';

    const trafficMonitor = document.getElementById('trafficMonitor');
    trafficMonitor.style.flex = savedMonitorFlex;
    detailsPanel.style.flex = savedDetailsFlex;

    // 生成详情内容
    let html = '';

    // 基本信息
    html += `
      <div class="detail-section">
        <h5>基本信息</h5>
        <div class="detail-item">
          <span class="detail-label">方法:</span>
          <span class="detail-value">${requestData.method || 'GET'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">URL:</span>
          <span class="detail-value">${requestData.url || ''}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">状态码:</span>
          <span class="detail-value">${requestData.statusCode || requestData.status || '未知'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">时间:</span>
          <span class="detail-value">${new Date(requestData.timestamp).toLocaleString()}</span>
        </div>
        ${requestData.bodySize ? `
        <div class="detail-item">
          <span class="detail-label">大小:</span>
          <span class="detail-value">${this.formatFileSize(requestData.bodySize)}</span>
        </div>
        ` : ''}
      </div>
    `;

    // 请求头
    if (requestData.requestHeaders) {
      html += `
        <div class="detail-section">
          <h5>请求头</h5>
          <div class="detail-json">${this.formatHeaders(requestData.requestHeaders)}</div>
        </div>
      `;
    }

    // 请求体
    if (requestData.requestBody) {
      html += `
        <div class="detail-section">
          <h5>请求体</h5>
          <div class="detail-json">${this.formatBody(requestData.requestBody, true)}</div>
        </div>
      `;
    }

    // 响应头
    if (requestData.responseHeaders) {
      html += `
        <div class="detail-section">
          <h5>响应头</h5>
          <div class="detail-json">${this.formatHeaders(requestData.responseHeaders)}</div>
        </div>
      `;
    }

    // 响应体
    if (requestData.responseBody) {
      html += `
        <div class="detail-section">
          <h5>响应体</h5>
          <div class="detail-json">${this.formatBody(requestData.responseBody, true)}</div>
        </div>
      `;
    }

    // 下载按钮（如果有UUID）
    if (requestData.uuid) {
      html += `
        <div class="detail-section">
          <h5>操作</h5>
          <button class="download-response-btn" onclick="universalAnswerFeature.downloadResponse('${requestData.uuid}')">
            <i class="bi bi-download"></i>
            <span>下载响应文件</span>
          </button>
        </div>
      `;
    }

    detailsContent.innerHTML = html;
  }

  // 隐藏请求详情
  hideRequestDetails() {
    const detailsPanel = document.getElementById('requestDetails');
    const detailsResizer = document.getElementById('detailsResizer');

    detailsPanel.style.display = 'none';
    detailsResizer.style.display = 'none';

    // 重置流量监控器的flex
    const trafficMonitor = document.getElementById('trafficMonitor');
    trafficMonitor.style.flex = '1';

    // 清除选中状态
    if (this.selectedLogItem) {
      this.selectedLogItem.classList.remove('selected');
      this.selectedLogItem = null;
    }
  }

  // 格式化请求头/响应头
  formatHeaders(headers) {
    if (!headers) return '';

    if (typeof headers === 'object') {
      return JSON.stringify(headers, null, 2);
    }

    return headers.toString();
  }

  // 清空日志
  clearLogs() {
    const trafficLog = document.getElementById('trafficLog');
    if (trafficLog) {
      trafficLog.innerHTML = `
        <div class="log-item">
          <i class="bi bi-hourglass-split"></i>
          <span>等待网络请求...</span>
        </div>
      `;
    }

    // 清空请求数据映射
    this.requestDataMap.clear();

    // 隐藏详情面板
    this.hideRequestDetails();

    // 重置请求计数
    this.updateRequestCount();

    this.addInfoLog('日志已清空');
  }

  // 清空答案
  clearAnswers() {
    if (!confirm('确定要清空所有答案数据吗？此操作不可撤销。')) {
      return;
    }

    const container = document.getElementById('answersContainer');
    if (container) {
      container.innerHTML = `
        <div class="no-answers">
          <i class="bi bi-inbox"></i>
          <p>暂无答案数据</p>
        </div>
      `;
    }

    this.lastAnswersData = null;
    this.addSuccessLog('答案数据已清空');
  }

  // 分享答案到服务器
  async shareAnswers() {
    if (!this.lastAnswersData || !this.lastAnswersData.answers || this.lastAnswersData.answers.length === 0) {
      this.addErrorLog('没有可分享的答案数据');
      return;
    }

    try {
      this.addInfoLog('正在上传答案到服务器...');

      // 使用现有的答案文件路径
      let filePath = this.lastAnswersData.file;

      if (!filePath) {
        this.addErrorLog('没有找到答案文件，请先提取答案');
        return;
      }

      // 上传到服务器
      const result = await window.electronAPI.shareAnswerFile(filePath);

      if (result && result.success) {
        const downloadUrl = result.downloadUrl;
        const viewerUrl = `https://366.cyril.qzz.io/answer-viewer?url=${encodeURIComponent(downloadUrl)}`;
        const sortParam = this.sortMode === 'pattern' ? '&sort=pattern' : '';
        const finalViewerUrl = viewerUrl + sortParam;

        this.addSuccessLog(`答案已分享成功！查看地址: ${finalViewerUrl}`);

        // 显示分享结果小窗口
        this.showShareResultModal(downloadUrl);

        // 复制查看地址到剪贴板
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(finalViewerUrl);
          this.addInfoLog('查看地址已复制到剪贴板');
        }
      } else {
        this.addErrorLog(`分享失败: ${result?.error || '未知错误'}`);
      }

    } catch (error) {
      this.addErrorLog(`分享失败: ${error.message}`);
    }
  }

  // 导出答案文件
  exportAnswers() {
    if (!this.lastAnswersData || !this.lastAnswersData.answers || this.lastAnswersData.answers.length === 0) {
      this.addErrorLog('没有可导出的答案数据');
      return;
    }

    try {
      // 生成导出数据
      const exportData = {
        timestamp: new Date().toISOString(),
        totalAnswers: this.lastAnswersData.answers.length,
        answers: this.lastAnswersData.answers,
        version: '1.0',
        exportedBy: 'UniversalAnswerTool'
      };

      // 创建下载链接
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      // 创建下载链接
      const link = document.createElement('a');
      link.href = url;
      link.download = `answers_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 清理URL对象
      URL.revokeObjectURL(url);

      this.addSuccessLog(`答案文件已导出: ${link.download}`);

    } catch (error) {
      this.addErrorLog(`导出失败: ${error.message}`);
    }
  }

  // 显示分享结果模态框
  showShareResultModal(downloadUrl) {
    // 生成查看器地址
    const mainUrl = `https://366.cyril.qzz.io/answer-viewer?url=${encodeURIComponent(downloadUrl)}`;
    const backupUrl = `https://a366.netlify.app/answer-viewer?url=${encodeURIComponent(downloadUrl)}`;

    // 根据当前排序模式添加sort参数
    const sortParam = this.sortMode === 'pattern' ? '&sort=pattern' : '';
    const mainUrlWithSort = mainUrl + sortParam;
    const backupUrlWithSort = backupUrl + sortParam;

    // 创建模态框HTML
    const modalHtml = `
      <div class="share-result-modal" id="shareResultModal">
        <div class="modal-content">
          <div class="modal-header">
            <h4><i class="bi bi-check-circle text-success"></i> 分享成功</h4>
            <button class="close-btn" onclick="universalAnswerFeature.hideShareResultModal()">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="modal-body">
            <p class="share-info">答案已成功上传到服务器，您可以通过以下地址在线查看：</p>
            <div class="url-section">
              <label><i class="bi bi-link-45deg"></i> 主地址：</label>
              <div class="url-input-group">
                <input type="text" value="${mainUrlWithSort}" readonly class="url-input" id="mainUrl">
                <button class="copy-url-btn" onclick="universalAnswerFeature.copyUrl('mainUrl')" title="复制主地址">
                  <i class="bi bi-copy"></i>
                </button>
                <button class="open-url-btn" onclick="window.open('${mainUrlWithSort}', '_blank')" title="打开主地址">
                  <i class="bi bi-box-arrow-up-right"></i>
                </button>
              </div>
            </div>
            <div class="url-section">
              <label><i class="bi bi-link-45deg"></i> 备用地址：</label>
              <div class="url-input-group">
                <input type="text" value="${backupUrlWithSort}" readonly class="url-input" id="backupUrl">
                <button class="copy-url-btn" onclick="universalAnswerFeature.copyUrl('backupUrl')" title="复制备用地址">
                  <i class="bi bi-copy"></i>
                </button>
                <button class="open-url-btn" onclick="window.open('${backupUrlWithSort}', '_blank')" title="打开备用地址">
                  <i class="bi bi-box-arrow-up-right"></i>
                </button>
              </div>
            </div>
            <div class="sort-info">
              <p><i class="bi bi-funnel"></i> 当前排序方式：${this.sortMode === 'pattern' ? '按题型排序' : '按文件排序'}</p>
            </div>
            <div class="share-tips">
              <p><i class="bi bi-info-circle"></i> 提示：如果主地址无法访问，请尝试使用备用地址。点击 <i class="bi bi-box-arrow-up-right"></i> 按钮可直接在浏览器中打开</p>
            </div>
            <div class="modal-footer">
              <button class="primary-btn" onclick="universalAnswerFeature.copyUrl('mainUrl')">
                <i class="bi bi-copy"></i>
                复制主地址
              </button>
              <button class="open-btn" onclick="window.open('${mainUrlWithSort}', '_blank')">
                <i class="bi bi-box-arrow-up-right"></i>
                打开查看
              </button>
              <button class="secondary-btn" onclick="universalAnswerFeature.hideShareResultModal()">
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 显示模态框
    const modal = document.getElementById('shareResultModal');
    modal.style.display = 'flex';

    // 添加点击背景关闭功能
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.hideShareResultModal();
      }
    });
  }

  // 隐藏分享结果模态框
  hideShareResultModal() {
    const modal = document.getElementById('shareResultModal');
    if (modal) {
      modal.remove();
    }
  }

  // 复制URL
  async copyUrl(inputId) {
    const input = document.getElementById(inputId);
    if (input) {
      try {
        await navigator.clipboard.writeText(input.value);
        this.showCopyToast('地址已复制到剪贴板', 'success');
      } catch (error) {
        // 降级方案
        input.select();
        document.execCommand('copy');
        this.showCopyToast('地址已复制到剪贴板', 'success');
      }
    }
  }

  initImportAnswer() {
    const importInput = document.getElementById('importAnswer');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this.importAnswerFile(file);
        }
      });
    }
  }

  importAnswerFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.answers && Array.isArray(data.answers)) {
          this.displayAnswers(data);
          this.addSuccessLog(`成功导入 ${data.answers.length} 个答案`);
        } else {
          this.addErrorLog('导入文件格式不正确');
        }
      } catch (error) {
        this.addErrorLog('导入文件解析失败: ' + error.message);
      }
    };
    reader.readAsText(file);
  }

  // ==================== 社区规则集相关方法 ====================

  initCommunityRulesets() {
    // 初始化社区规则集相关事件监听器
    const searchInput = document.getElementById('rulesetSearchInput');
    const searchBtn = document.getElementById('searchRulesetsBtn');
    const refreshBtn = document.getElementById('refreshRulesetsBtn');
    const uploadBtn = document.getElementById('uploadRulesetBtn');
    const sortBySelect = document.getElementById('sortBySelect');
    const sortOrderSelect = document.getElementById('sortOrderSelect');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    if (searchInput) {
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.searchRulesets();
        }
      });
    }

    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        this.searchRulesets();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.refreshRulesets();
      });
    }

    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        this.showUploadRulesetModal();
      });
    }

    if (sortBySelect) {
      sortBySelect.addEventListener('change', () => {
        this.searchRulesets();
      });
    }

    if (sortOrderSelect) {
      sortOrderSelect.addEventListener('change', () => {
        this.searchRulesets();
      });
    }

    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        this.previousPage();
      });
    }

    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        this.nextPage();
      });
    }

    // 规则集详情模态框事件
    const closeDetailModal = document.getElementById('closeRulesetDetailModal');
    const cancelDetailBtn = document.getElementById('cancelRulesetDetailBtn');
    const installBtn = document.getElementById('installRulesetBtn');

    if (closeDetailModal) {
      closeDetailModal.addEventListener('click', () => {
        this.hideRulesetDetailModal();
      });
    }

    if (cancelDetailBtn) {
      cancelDetailBtn.addEventListener('click', () => {
        this.hideRulesetDetailModal();
      });
    }

    if (installBtn) {
      installBtn.addEventListener('click', () => {
        this.installCurrentRuleset();
      });
    }

    // 上传规则集模态框事件
    const closeUploadModal = document.getElementById('closeUploadRulesetModal');
    const cancelUploadBtn = document.getElementById('cancelUploadRulesetBtn');
    const uploadForm = document.getElementById('uploadRulesetForm');
    const rulesetSelect = document.getElementById('uploadRulesetSelect');

    if (closeUploadModal) {
      closeUploadModal.addEventListener('click', () => {
        this.hideUploadRulesetModal();
      });
    }

    if (cancelUploadBtn) {
      cancelUploadBtn.addEventListener('click', () => {
        this.hideUploadRulesetModal();
      });
    }

    if (uploadForm) {
      uploadForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitUploadRuleset();
      });
    }

    if (rulesetSelect) {
      rulesetSelect.addEventListener('change', () => {
        this.onRulesetSelectChange();
      });
    }

    // 模态框背景点击关闭
    const detailModal = document.getElementById('rulesetDetailModal');
    if (detailModal) {
      detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) {
          this.hideRulesetDetailModal();
        }
      });
    }

    const uploadModal = document.getElementById('uploadRulesetModal');
    if (uploadModal) {
      uploadModal.addEventListener('click', (e) => {
        if (e.target === uploadModal) {
          this.hideUploadRulesetModal();
        }
      });
    }
  }

  async loadCommunityRulesets(reset = true) {
    if (this.isLoadingRulesets) return;

    if (reset) {
      this.currentPage = 0;
      this.communityRulesets = [];
    }

    this.isLoadingRulesets = true;
    this.showLoadingState();

    try {
      const searchTerm = document.getElementById('rulesetSearchInput')?.value || '';
      const sortBy = document.getElementById('sortBySelect')?.value || 'created_at';
      const sortOrder = document.getElementById('sortOrderSelect')?.value || 'desc';

      const params = new URLSearchParams({
        search: searchTerm,
        status: 'approved',
        sortBy: sortBy,
        sortOrder: sortOrder,
        limit: this.pageSize.toString(),
        offset: (this.currentPage * this.pageSize).toString()
      });

      const response = await fetch(`https://366.cyril.qzz.io/api/rulesets?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        if (reset) {
          this.communityRulesets = data.data;
        } else {
          this.communityRulesets.push(...data.data);
        }

        // 检查已安装状态
        await this.checkInstalledStatus();

        this.hasMorePages = data.pagination.hasMore;
        this.displayRulesets();
        this.updatePaginationControls();
      } else {
        throw new Error(data.message || '获取规则集列表失败');
      }
    } catch (error) {
      console.error('加载社区规则集失败:', error);
      this.showErrorState(error.message);
    } finally {
      this.isLoadingRulesets = false;
    }
  }

  displayRulesets() {
    const container = document.getElementById('rulesetsContainer');
    if (!container) return;

    if (this.communityRulesets.length === 0) {
      container.innerHTML = `
        <div class="no-rulesets">
          <i class="bi bi-collection"></i>
          <p>未找到规则集</p>
          <p class="text-muted">尝试调整搜索条件或刷新列表</p>
        </div>
      `;
      return;
    }

    const html = this.communityRulesets.map(ruleset => this.createRulesetItemHTML(ruleset)).join('');
    container.innerHTML = html;
  }

  async checkInstalledStatus() {
    try {
      // 获取本地所有规则集
      const localRules = await window.electronAPI.getRules();
      const localRuleGroups = localRules.filter(rule => rule.isGroup);

      // 为每个社区规则集检查是否已安装
      this.communityRulesets.forEach(ruleset => {
        // 通过多种方式匹配判断是否已安装
        const isInstalled = localRuleGroups.some(localGroup => {
          // 方式1: 通过社区规则集ID匹配（最准确）
          if (localGroup.communityRulesetId === ruleset.id) {
            return true;
          }

          // 方式2: 通过名称和作者匹配
          if (localGroup.name === ruleset.name && localGroup.author === ruleset.author) {
            return true;
          }

          // 方式3: 通过名称匹配（兼容旧数据）
          if (localGroup.name === ruleset.name) {
            return true;
          }

          return false;
        });

        ruleset.isInstalled = isInstalled;
      });
    } catch (error) {
      console.error('检查安装状态失败:', error);
    }
  }

  createRulesetItemHTML(ruleset) {
    const downloadCount = ruleset.download_count || 0;
    const createdDate = new Date(ruleset.created_at).toLocaleDateString('zh-CN');
    const hasInjection = ruleset.has_injection_package;
    const isInstalled = ruleset.isInstalled;

    return `
      <div class="ruleset-item ${isInstalled ? 'installed' : ''}" onclick="universalAnswerFeature.showRulesetDetail('${ruleset.id}')">
        <div class="ruleset-header">
          <div class="ruleset-info">
            <div class="ruleset-name">
              ${this.escapeHtml(ruleset.name)}
              ${isInstalled ? '<span class="installed-badge"><i class="bi bi-check-circle"></i> 已安装</span>' : ''}
            </div>
            <div class="ruleset-author">作者: ${this.escapeHtml(ruleset.author)}</div>
            <div class="ruleset-description">${this.escapeHtml(ruleset.description || '暂无描述')}</div>
            <div class="ruleset-meta">
              <div class="ruleset-downloads">
                <i class="bi bi-download"></i>
                <span>${downloadCount} 次下载</span>
              </div>
              <div class="ruleset-date">${createdDate}</div>
            </div>
            <div class="ruleset-tags">
              ${hasInjection ? '<span class="ruleset-tag has-injection">包含注入文件</span>' : ''}
              <span class="ruleset-tag">已审核</span>
            </div>
          </div>
          <div class="ruleset-actions" onclick="event.stopPropagation()">
            <button class="view-details-btn" onclick="universalAnswerFeature.showRulesetDetail('${ruleset.id}')">
              <i class="bi bi-eye"></i>
              <span>查看详情</span>
            </button>
            <button class="install-btn ${isInstalled ? 'installed' : ''}" 
                    onclick="universalAnswerFeature.installRuleset('${ruleset.id}')"
                    ${isInstalled ? 'disabled' : ''}>
              <i class="bi bi-${isInstalled ? 'check-circle' : 'download'}"></i>
              <span>${isInstalled ? '已安装' : '安装'}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async showRulesetDetail(rulesetId) {
    try {
      const response = await fetch(`https://366.cyril.qzz.io/api/rulesets/${rulesetId}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        this.currentRulesetDetail = data.data;
        this.displayRulesetDetail(data.data);
        this.showRulesetDetailModal();
      } else {
        throw new Error(data.message || '获取规则集详情失败');
      }
    } catch (error) {
      console.error('获取规则集详情失败:', error);
      this.addErrorLog('获取规则集详情失败: ' + error.message);
    }
  }

  displayRulesetDetail(ruleset) {
    const content = document.getElementById('rulesetDetailContent');
    if (!content) return;

    const downloadCount = ruleset.download_count || 0;
    const createdDate = new Date(ruleset.created_at).toLocaleDateString('zh-CN');
    const totalSize = this.formatFileSize(ruleset.file_info?.totalSize || 0);
    const fileCount = ruleset.file_info?.totalFiles || 0;

    let filesHTML = '';
    if (ruleset.file_info?.files) {
      filesHTML = ruleset.file_info.files.map(file => `
        <div class="file-item">
          <div class="file-info">
            <i class="file-icon bi ${this.getFileIcon(file.type)}"></i>
            <span class="file-name">${this.escapeHtml(file.name)}</span>
          </div>
          <span class="file-size">${this.formatFileSize(file.size)}</span>
        </div>
      `).join('');
    }

    content.innerHTML = `
      <div class="detail-header">
        <div class="detail-title">${this.escapeHtml(ruleset.name)}</div>
        <div class="detail-author">作者: ${this.escapeHtml(ruleset.author)}</div>
        <div class="detail-description">${this.escapeHtml(ruleset.description || '暂无描述')}</div>
        <div class="detail-stats">
          <div class="detail-stat">
            <i class="bi bi-download"></i>
            <span>${downloadCount} 次下载</span>
          </div>
          <div class="detail-stat">
            <i class="bi bi-calendar"></i>
            <span>${createdDate}</span>
          </div>
          <div class="detail-stat">
            <i class="bi bi-files"></i>
            <span>${fileCount} 个文件</span>
          </div>
          <div class="detail-stat">
            <i class="bi bi-hdd"></i>
            <span>${totalSize}</span>
          </div>
        </div>
      </div>
      ${filesHTML ? `
        <div class="detail-files">
          <h4>包含文件</h4>
          <div class="file-list">
            ${filesHTML}
          </div>
        </div>
      ` : ''}
    `;
  }

  async installRuleset(rulesetId) {
    const ruleset = this.communityRulesets.find(r => r.id === rulesetId) || this.currentRulesetDetail;
    if (!ruleset) {
      this.addErrorLog('未找到规则集信息');
      return;
    }

    // 如果已安装，不允许重复安装
    if (ruleset.isInstalled) {
      this.addInfoLog(`规则集 "${ruleset.name}" 已经安装`);
      return;
    }

    try {
      this.addInfoLog(`开始安装规则集: ${ruleset.name}`);

      // 下载规则文件
      const jsonUrl = ruleset.file_urls.find(url => url.includes('.json'));
      if (!jsonUrl) {
        throw new Error('未找到规则文件');
      }

      const response = await fetch(jsonUrl);
      if (!response.ok) {
        throw new Error(`下载规则文件失败: HTTP ${response.status}`);
      }

      let rulesData = await response.json();

      // 如果有注入文件，先下载并处理路径
      if (ruleset.has_injection_package) {
        const zipUrl = ruleset.file_urls.find(url => url.includes('.zip'));
        if (zipUrl) {
          try {
            const localZipPath = await this.downloadAndSaveInjectionPackage(zipUrl, ruleset.name);

            // 更新规则数据中的ZIP路径
            let rulesToUpdate = [];
            if (Array.isArray(rulesData)) {
              // 纯JSON格式：直接是规则数组
              rulesToUpdate = rulesData;
            } else if (rulesData.rules) {
              // 包含rules的对象格式
              rulesToUpdate = rulesData.rules;
            }

            // 替换ZIP路径
            rulesToUpdate.forEach(rule => {
              if (rule.type === 'zip-implant' && rule.zipImplant) {
                rule.zipImplant = localZipPath;
              }
            });
          } catch (error) {
            console.error('下载注入包失败:', error);
            this.addErrorLog(`注入包下载失败: ${error.message}`);
            // 继续安装规则，但不包含注入包
          }
        }
      }

      // 为规则集添加社区标识
      if (rulesData.group) {
        rulesData.group.communityRulesetId = ruleset.id;
      } else if (Array.isArray(rulesData)) {
        // 如果是纯JSON数组格式，创建一个规则集包装它
        rulesData = {
          group: {
            id: this.generateUUID(),
            name: ruleset.name,
            author: ruleset.author,
            description: ruleset.description,
            enabled: true,
            isGroup: true,
            communityRulesetId: ruleset.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          rules: rulesData
        };
      } else if (!rulesData.group && rulesData.rules) {
        // 如果有rules但没有group，创建group
        rulesData.group = {
          id: this.generateUUID(),
          name: ruleset.name,
          author: ruleset.author,
          description: ruleset.description,
          enabled: true,
          isGroup: true,
          communityRulesetId: ruleset.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      // 导入规则到本地
      const result = await window.electronAPI.importResponseRulesFromData(rulesData);

      if (result.success) {
        this.addSuccessLog(`规则集 "${ruleset.name}" 安装成功，共导入 ${result.count} 条规则`);

        // 更新已安装状态
        ruleset.isInstalled = true;

        // 刷新显示
        this.displayRulesets();

        // 关闭详情模态框
        this.hideRulesetDetailModal();

        // 如果当前在规则管理页面，刷新规则列表
        if (this.currentView === 'rules') {
          this.loadRules();
        }
      } else {
        throw new Error(result.error || '导入规则失败');
      }
    } catch (error) {
      console.error('安装规则集失败:', error);
      this.addErrorLog(`安装规则集失败: ${error.message}`);
    }
  }

  async downloadAndSaveInjectionPackage(zipUrl, rulesetName) {
    this.addInfoLog(`正在下载注入包...`);

    const response = await fetch(zipUrl);
    if (!response.ok) {
      throw new Error(`下载注入包失败: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // 计算新文件的MD5
    const newFileMD5 = await this.calculateMD5(arrayBuffer);

    let originalFileName;
    try {
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition && contentDisposition.includes('filename=')) {
        originalFileName = contentDisposition.split('filename=')[1].replace(/"/g, '').trim();
      } else {
        const urlPath = new URL(zipUrl).pathname;
        originalFileName = urlPath.split('/').pop() || 'download.zip';
      }

      if (!originalFileName.toLowerCase().endsWith('.zip')) {
        originalFileName += '.zip';
      }
    } catch (error) {
      console.error('提取原始文件名失败，使用默认名称:', error);
      originalFileName = `${safeRulesetName}.zip`;
    }

    const fileName = originalFileName;

    const result = await window.electronAPI.downloadAndSaveInjectionPackageWithMD5(
      arrayBuffer,
      fileName,
      rulesetName,
      newFileMD5
    );

    if (result.success) {
      if (result.skipped) {
        this.addInfoLog(`注入包已存在且内容相同，跳过下载: ${result.finalFileName}`);
      } else if (result.renamed) {
        this.addInfoLog(`检测到重名文件但内容不同，已重命名保存: ${result.finalFileName}`);
      } else {
        this.addSuccessLog(`注入包下载完成: ${result.finalFileName}`);
      }
      return result.localPath; // 返回本地保存路径
    } else {
      throw new Error(result.error || '保存注入包失败');
    }
  }

  // 计算文件的MD5哈希值
  async calculateMD5(arrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  searchRulesets() {
    this.currentPage = 0;
    this.loadCommunityRulesets(true);
  }

  refreshRulesets() {
    this.currentPage = 0;
    this.loadCommunityRulesets(true);
  }

  previousPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.loadCommunityRulesets(true);
    }
  }

  nextPage() {
    if (this.hasMorePages) {
      this.currentPage++;
      this.loadCommunityRulesets(true);
    }
  }

  updatePaginationControls() {
    const paginationControls = document.getElementById('paginationControls');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');

    if (paginationControls) {
      paginationControls.style.display = this.communityRulesets.length > 0 ? 'flex' : 'none';
    }

    if (prevBtn) {
      prevBtn.disabled = this.currentPage === 0;
    }

    if (nextBtn) {
      nextBtn.disabled = !this.hasMorePages;
    }

    if (pageInfo) {
      pageInfo.textContent = `第 ${this.currentPage + 1} 页`;
    }
  }

  showLoadingState() {
    const container = document.getElementById('rulesetsContainer');
    if (container) {
      container.innerHTML = `
        <div class="loading-state">
          <i class="bi bi-hourglass-split"></i>
          <p>正在加载规则集...</p>
        </div>
      `;
    }
  }

  showErrorState(message) {
    const container = document.getElementById('rulesetsContainer');
    if (container) {
      container.innerHTML = `
        <div class="error-state">
          <i class="bi bi-exclamation-triangle"></i>
          <p>加载失败</p>
          <p class="text-muted">${this.escapeHtml(message)}</p>
          <button class="retry-btn" onclick="universalAnswerFeature.refreshRulesets()">
            <i class="bi bi-arrow-clockwise"></i>
            <span>重试</span>
          </button>
        </div>
      `;
    }
  }

  showRulesetDetailModal() {
    const modal = document.getElementById('rulesetDetailModal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  hideRulesetDetailModal() {
    const modal = document.getElementById('rulesetDetailModal');
    if (modal) {
      modal.style.display = 'none';
    }
    this.currentRulesetDetail = null;
  }

  installCurrentRuleset() {
    if (this.currentRulesetDetail) {
      this.installRuleset(this.currentRulesetDetail.id);
    }
  }

  async showUploadRulesetModal() {
    try {
      // 加载本地规则集列表
      const rules = await window.electronAPI.getRules();
      const ruleGroups = rules.filter(rule => rule.isGroup);

      const select = document.getElementById('uploadRulesetSelect');
      if (select) {
        select.innerHTML = '<option value="">请选择要上传的规则集</option>';
        ruleGroups.forEach(group => {
          const option = document.createElement('option');
          option.value = group.id;
          option.textContent = `${group.name} (${group.author || '未知作者'})`;
          select.appendChild(option);
        });
      }

      // 显示模态框
      const modal = document.getElementById('uploadRulesetModal');
      if (modal) {
        modal.style.display = 'flex';
      }
    } catch (error) {
      console.error('加载规则集列表失败:', error);
      this.addErrorLog('加载规则集列表失败: ' + error.message);
    }
  }

  hideUploadRulesetModal() {
    const modal = document.getElementById('uploadRulesetModal');
    if (modal) {
      modal.style.display = 'none';
    }

    // 重置表单
    const form = document.getElementById('uploadRulesetForm');
    if (form) {
      form.reset();
    }

    // 隐藏进度条
    const progress = document.getElementById('uploadProgress');
    if (progress) {
      progress.style.display = 'none';
    }
  }

  async onRulesetSelectChange() {
    const select = document.getElementById('uploadRulesetSelect');
    const nameInput = document.getElementById('uploadRulesetName');
    const descInput = document.getElementById('uploadRulesetDescription');
    const authorInput = document.getElementById('uploadRulesetAuthor');
    const includeInjectionCheckbox = document.getElementById('uploadIncludeInjection');

    if (!select.value) {
      nameInput.value = '';
      descInput.value = '';
      authorInput.value = '';
      includeInjectionCheckbox.checked = false;
      return;
    }

    try {
      // 获取选中的规则集详情
      const rules = await window.electronAPI.getRules();
      const selectedGroup = rules.find(rule => rule.id === select.value);
      const groupRules = rules.filter(rule => rule.groupId === select.value);

      if (selectedGroup) {
        nameInput.value = selectedGroup.name || '';
        descInput.value = selectedGroup.description || '';
        authorInput.value = selectedGroup.author || '';

        // 检查是否包含ZIP注入规则
        const hasZipRules = groupRules.some(rule => rule.type === 'zip-implant');
        includeInjectionCheckbox.checked = hasZipRules;
      }
    } catch (error) {
      console.error('获取规则集详情失败:', error);
    }
  }

  async submitUploadRuleset() {
    const form = document.getElementById('uploadRulesetForm');
    const submitBtn = document.getElementById('submitUploadRulesetBtn');
    const progress = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('uploadProgressFill');
    const progressText = document.getElementById('uploadProgressText');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const rulesetId = document.getElementById('uploadRulesetSelect').value;
    const name = document.getElementById('uploadRulesetName').value;
    const description = document.getElementById('uploadRulesetDescription').value;
    const author = document.getElementById('uploadRulesetAuthor').value;
    const includeInjection = document.getElementById('uploadIncludeInjection').checked;

    try {
      // 禁用提交按钮并显示进度条
      submitBtn.disabled = true;
      progress.style.display = 'block';
      progressText.textContent = '准备上传...';
      progressFill.style.width = '0%';

      // 获取规则集数据
      const rules = await window.electronAPI.getRules();
      const selectedGroup = rules.find(rule => rule.id === rulesetId);
      const groupRules = rules.filter(rule => rule.groupId === rulesetId);

      if (!selectedGroup || groupRules.length === 0) {
        throw new Error('未找到规则集或规则集为空');
      }

      progressText.textContent = '正在上传规则集...';
      progressFill.style.width = '30%';

      // 调用上传API
      const result = await window.electronAPI.uploadRules(
        name,
        description,
        author,
        groupRules, // 直接传递规则数组
        (progress) => {
          progressFill.style.width = `${30 + progress * 0.7}%`;
          progressText.textContent = `上传中... ${Math.round(progress)}%`;
        }
      );

      if (result.status === 200 || result.status === 201) {
        progressFill.style.width = '100%';
        progressText.textContent = '上传成功！';

        this.addSuccessLog(`规则集 "${name}" 上传成功，等待审核`);

        setTimeout(() => {
          this.hideUploadRulesetModal();
        }, 2000);
      } else {
        throw new Error(result.data?.message || `上传失败 (HTTP ${result.status})`);
      }
    } catch (error) {
      console.error('上传规则集失败:', error);
      this.addErrorLog('上传规则集失败: ' + error.message);

      progressText.textContent = '上传失败';
      progressFill.style.width = '0%';
    } finally {
      submitBtn.disabled = false;
    }
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  getFileIcon(mimeType) {
    if (mimeType.includes('json')) return 'bi-file-code';
    if (mimeType.includes('zip')) return 'bi-file-zip';
    if (mimeType.includes('text')) return 'bi-file-text';
    return 'bi-file';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
  }
}

// 全局实例
let global;
let universalAnswerFeature;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM内容加载完成，开始初始化');
  try {
    global = new Global();
    console.log('Global实例创建成功');
  } catch (error) {
    console.error('Global实例创建失败:', error);
  }

  try {
    universalAnswerFeature = new UniversalAnswerFeature();
    console.log('UniversalAnswerFeature实例创建成功');
  } catch (error) {
    console.error('UniversalAnswerFeature实例创建失败:', error);
  }
});