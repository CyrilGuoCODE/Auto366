// 导入所有模块
import StateManager from './state.js';
import EventManager from './events.js';
import LogManager from './logs-ui.js';
import ProxyUI from './proxy-ui.js';
import AnswersUI from './answers-ui.js';
import RulesUI from './rules-ui.js';
import CommunityUI from './community-ui.js';
import SettingsUI from './settings-ui.js';

class Auto366App {
  constructor() {
    // 初始化状态管理
    this.state = new StateManager();
    
    // 初始化日志管理器
    this.logManager = new LogManager(this.state);
    
    // 初始化各个UI模块
    this.eventManager = new EventManager(this.state);
    this.proxyUI = new ProxyUI(this.state, this.logManager);
    this.answersUI = new AnswersUI(this.state, this.logManager);
    this.rulesUI = new RulesUI(this.state, this.logManager);
    this.communityUI = new CommunityUI(this.state, this.logManager);
    this.settingsUI = new SettingsUI(this.state, this.logManager);
  }

  // 初始化应用
  async init() {
    try {
      // 暴露方法到全局（必须在最前面，因为HTML中的onclick依赖这些方法）
      this.exposeMethods();
      
      // 初始化全局设置（缓存路径等）
      this.initGlobalSettings();
      
      // 初始化事件监听器
      this.eventManager.initEventListeners();
      
      // 初始化代理控制
      this.proxyUI.initProxyControl();
      
      // 初始化答案UI
      this.answersUI.initAnswersUI();
      
      // 初始化规则事件监听器
      this.rulesUI.initRuleEventListeners();
      
      // 初始化社区规则集
      this.communityUI.initCommunityRulesets();
      
      // 初始化缓存设置
      this.settingsUI.initCacheSettings();
      
      // 初始化更新设置
      this.settingsUI.initUpdateSettings();
      
      // 初始化IPC监听器
      this.initIpcListeners();
      
      // 初始化UI模式
      await this.initUIMode();
      
      // 尝试加载规则
      try {
        await this.rulesUI.loadRules();
      } catch (error) {
        console.error('加载规则失败:', error);
      }
      
      // 尝试加载社区规则集
      try {
        await this.communityUI.loadCommunityRulesets();
      } catch (error) {
        console.error('加载社区规则集失败:', error);
      }
      
      // 显示赞赏弹窗
      this.showDonationModal();
      
      // 自动启动代理
      setTimeout(() => {
        this.proxyUI.startProxy();
      }, 1000);
      
    } catch (error) {
      console.error('应用初始化失败:', error);
      this.logManager.addErrorLog('应用初始化失败: ' + error.message);
    }
  }

  // 初始化全局设置
  initGlobalSettings() {
    const cachePath = localStorage.getItem('cache-path') || 'D:\\Up366StudentFiles';
    if (window.electronAPI && window.electronAPI.setCachePath) {
      window.electronAPI.setCachePath(cachePath);
    }

    // 监听目录选择事件
    if (window.electronAPI && window.electronAPI.chooseDirectory) {
      window.electronAPI.chooseDirectory((event, path) => {
        if (path) {
          localStorage.setItem('cache-path', path);
          if (window.electronAPI.setCachePath) {
            window.electronAPI.setCachePath(path);
          }

          // 更新设置页面的输入框
          const cachePathInput = document.getElementById('cachePathInput');
          if (cachePathInput) {
            cachePathInput.value = path;
          }
        }
      });
    }
  }

  // 初始化UI模式
  async initUIMode() {
    try {
      if (window.electronAPI && window.electronAPI.getUiMode) {
        const uiMode = await window.electronAPI.getUiMode();
        document.documentElement.setAttribute('data-ui', uiMode);
        
        if (uiMode === 'simple') {
          document.documentElement.setAttribute('data-simple-page', 'menu');
          await this.communityUI.renderSimpleHomeRulesets();
        }
      }
    } catch (error) {
      console.error('初始化UI模式失败:', error);
    }
  }

  // 初始化IPC监听器
  initIpcListeners() {
    // 监听代理状态
    window.electronAPI.onProxyStatus((event, data) => {
      this.proxyUI.updateProxyStatus(data);
    });

    // 监听流量日志
    window.electronAPI.onTrafficLog((event, data) => {
      this.logManager.addTrafficLog(data);
    });

    // 监听响应捕获
    window.electronAPI.onResponseCaptured((event, data) => {
      this.logManager.addTrafficLog(data);
    });

    // 监听响应错误
    window.electronAPI.onResponseError((event, data) => {
      this.logManager.addErrorLog(`响应错误: ${data.error} - ${data.url}`);
    });

    // 监听重要请求
    window.electronAPI.onImportantRequest((event, data) => {
      this.logManager.addImportantLog(data);
    });

    // 监听下载发现
    window.electronAPI.onDownloadFound((event, data) => {
      this.logManager.addSuccessLog(`发现下载链接: ${data.url}`);
    });

    // 监听处理错误
    window.electronAPI.onProcessError((event, data) => {
      this.logManager.addErrorLog(data.error);
    });

    // 监听答案提取
    window.electronAPI.onAnswersExtracted((event, data) => {
      this.answersUI.displayAnswers(data);

      // 输出答案文件位置
      if (data.file) {
        this.logManager.addSuccessLog(`答案文件已保存到: ${data.file}`);
      }
    });

    // 监听捕获状态
    window.electronAPI.onCaptureStatus((event, data) => {
      this.proxyUI.updateCaptureStatus(data);
    });

    // 监听代理错误
    window.electronAPI.onProxyError((event, data) => {
      this.logManager.addErrorLog(data.message);
      // 如果代理出错，重置按钮状态
      const toggleBtn = document.getElementById('toggleProxyBtn');
      const captureBtn = document.getElementById('startCaptureBtn');

      if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.innerHTML = '<i class="bi bi-play-circle"></i><span>启动代理</span>';
        toggleBtn.className = 'primary-btn';
      }
      if (captureBtn) {
        captureBtn.disabled = true;
      }

      this.state.isProxyRunning = false;
      this.proxyUI.updateProxyStatus({ running: false, message: '代理服务器出错' });
    });

    // 监听文件结构
    window.electronAPI.onFileStructure((event, data) => {
      this.logManager.displayFileStructure(data);
    });

    // 监听文件处理结果
    window.electronAPI.onFilesProcessed((event, data) => {
      this.logManager.displayProcessedFiles(data);
    });

    // 监听规则触发日志
    window.electronAPI.onRuleLog((event, data) => {
      this.logManager.addRuleLog(data);
    });

    // 监听更新下载进度
    if (window.electronAPI.onUpdateDownloadProgress) {
      window.electronAPI.onUpdateDownloadProgress((data) => {
        this.settingsUI.handleUpdateProgress(data);
      });
    }

    // 监听更新下载完成
    if (window.electronAPI.onUpdateDownloaded) {
      window.electronAPI.onUpdateDownloaded((data) => {
        this.settingsUI.handleUpdateDownloaded(data);
      });
    }

    if (window.electronAPI.onUpdateAvailable) {
      window.electronAPI.onUpdateAvailable((data) => {
        this.settingsUI.handleUpdateAvailable(data);
      });
    }

    window.electronAPI.chooseImplantZip(async (filePath) => {
      if (!filePath) {
        this.logManager.addErrorLog('未选择文件');
        return;
      }
      const zipImplantInput = document.getElementById('zipImplant');
      if (zipImplantInput) {
        zipImplantInput.value = filePath;
      }
    });
  }

  // 下载响应文件
  async downloadResponse(uuid) {
    let res = await window.electronAPI.downloadFile(uuid);
    if (res === 1) {
      this.logManager.addSuccessLog('文件下载成功');
    } else {
      this.logManager.addErrorLog('文件下载失败');
    }
  }

  // 显示赞赏弹窗
  showDonationModal() {
    const launchCount = localStorage.getItem('launchCount') || 0;
    const newCount = parseInt(launchCount) + 1;
    localStorage.setItem('launchCount', newCount.toString());

    // 每5次启动显示一次
    if (newCount % 5 === 0) {
      const modal = document.createElement('div');
      modal.id = 'donation-modal';
      modal.className = 'donation-modal';

      modal.innerHTML = `
        <div class="donation-modal-content">
          <div class="donation-header">
            <h3>支持 Auto366 开发</h3>
            <button class="donation-close" onclick="closeDonationModal()">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="donation-body">
            <div class="donation-qr">
              <img src="./resources/Cyril_prize.jpg" alt="赞赏码" class="donation-qr-code">
              <p class="donation-label">Cyril</p>
            </div>
            <div class="donation-qr">
              <img src="./resources/Cyp_prize.jpg" alt="赞赏码" class="donation-qr-code">
              <p class="donation-label">Cyp</p>
            </div>
            <div class="donation-qr">
              <img src="./resources/qq.jpg" alt="QQ群" class="donation-qr-code">
              <p class="donation-label">QQ群</p>
            </div>
          </div>
          <p class="donation-message">你已经启动 Auto366 ${newCount} 次了，不考虑赞助一下吗？</p>
          <p class="donation-message">如果工具对你有用，随时欢迎赞赏支持或加入QQ群交流哦~</p>
        </div>
        <div class="donation-modal-footer">
          <button class="donation-btn-later" onclick="closeDonationModal()">稍后再说</button>
        </div>
      `;

      document.body.appendChild(modal);
    }
  }

  // 暴露所有方法到全局
  exposeMethods() {
    // 代理控制方法
    window.universalAnswerFeature = {
      // 状态管理
      switchView: (view, pushSimpleHistory) => this.state.switchView(view, pushSimpleHistory),
      setSimplePage: (page) => this.state.setSimplePage(page),
      goSimpleBack: () => this.state.goSimpleBack(),
      
      // 代理控制
      toggleProxy: () => this.proxyUI.toggleProxy(),
      showPortChangeDialog: () => this.proxyUI.showPortChangeDialog(),
      
      // 答案管理
      displayAnswers: (data) => this.answersUI.displayAnswers(data),
      copyAnswerByIndex: (index, groupName, element) => this.answersUI.copyAnswerByIndex(index, groupName, element),
      toggleAnswerExpansion: (button) => this.answersUI.toggleAnswerExpansion(button),
      copyAnswer: (answerText, element) => this.answersUI.copyAnswer(answerText, element),
      clearAnswers: () => this.answersUI.clearAnswers(),
      shareAnswers: () => this.answersUI.shareAnswers(),
      exportAnswers: () => this.answersUI.exportAnswers(),
      hideShareResultModal: () => this.answersUI.hideShareResultModal(),
      copyUrl: (inputId) => this.answersUI.copyUrl(inputId),
      importAnswerFile: (file) => this.answersUI.importAnswerFile(file),
      
      // 规则管理
      showRuleGroupModal: (ruleGroup) => this.rulesUI.showRuleGroupModal(ruleGroup),
      hideRuleGroupModal: () => this.rulesUI.hideRuleGroupModal(),
      saveRuleGroup: () => this.rulesUI.saveRuleGroup(),
      showRuleModal: (rule, groupId) => this.rulesUI.showRuleModal(rule, groupId),
      hideRuleModal: () => this.rulesUI.hideRuleModal(),
      saveRule: () => this.rulesUI.saveRule(),
      loadRules: () => this.rulesUI.loadRules(),
      editRuleGroup: (groupId) => this.rulesUI.editRuleGroup(groupId),
      editRule: (ruleId) => this.rulesUI.editRule(ruleId),
      deleteRule: (ruleId) => this.rulesUI.deleteRule(ruleId),
      resetRuleTriggers: (ruleId) => this.rulesUI.resetRuleTriggers(ruleId),
      toggleRule: (ruleId, enabled) => this.rulesUI.toggleRule(ruleId, enabled),
      browseZipFile: () => this.rulesUI.browseZipFile(),
      enterSimpleRuleset: (groupId) => this.rulesUI.enterSimpleRuleset(groupId),
      deleteSimpleRuleset: (groupId) => this.rulesUI.deleteSimpleRuleset(groupId),
      
      // 社区规则集
      loadCommunityRulesets: (reset) => this.communityUI.loadCommunityRulesets(reset),
      searchRulesets: () => this.communityUI.searchRulesets(),
      refreshRulesets: () => this.communityUI.refreshRulesets(),
      previousPage: () => this.communityUI.previousPage(),
      nextPage: () => this.communityUI.nextPage(),
      showRulesetDetail: (rulesetId) => this.communityUI.showRulesetDetail(rulesetId),
      hideRulesetDetailModal: () => this.communityUI.hideRulesetDetailModal(),
      installRuleset: (rulesetId) => this.communityUI.installRuleset(rulesetId),
      
      // 日志管理
      addTrafficLog: (data) => this.logManager.addTrafficLog(data),
      addSuccessLog: (message) => this.logManager.addSuccessLog(message),
      addErrorLog: (message) => this.logManager.addErrorLog(message),
      addInfoLog: (message) => this.logManager.addInfoLog(message),
      clearLogs: () => this.logManager.clearLogs(),
      
      // 设置管理
      handleDeleteTemp: () => this.settingsUI.handleDeleteTemp(),
      confirmDeleteTemp: () => this.settingsUI.confirmDeleteTemp(),
      handleDeleteFileTemp: () => this.settingsUI.handleDeleteFileTemp(),
      confirmDeleteFileTemp: () => this.settingsUI.confirmDeleteFileTemp(),
      handleUpdateNotification: () => this.settingsUI.handleUpdateNotification(),
      startUpdateDownload: (version) => this.settingsUI.startUpdateDownload(version),
      installUpdate: () => this.settingsUI.installUpdate(),
      
      // 其他
      downloadResponse: (uuid) => this.downloadResponse(uuid),
    };
  }
}

// 关闭赞赏弹窗
window.closeDonationModal = function() {
  const modal = document.getElementById('donation-modal');
  if (modal) {
    modal.remove();
  }
};

// 初始化应用
window.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM 加载完成，开始初始化应用...');
  try {
    const app = new Auto366App();
    console.log('Auto366App 实例创建成功');
    app.exposeMethods();
    console.log('方法暴露成功');
    await app.init();
    console.log('应用初始化完成');
  } catch (error) {
    console.error('应用初始化失败:', error);
    console.error('错误堆栈:', error.stack);
    // 在页面上显示错误信息
    const errorElement = document.createElement('div');
    errorElement.style.cssText = `
      position: fixed;
      top: 50px;
      left: 0;
      right: 0;
      background: #fee2e2;
      color: #b91c1c;
      padding: 16px;
      border-bottom: 2px solid #b91c1c;
      z-index: 999999;
      font-family: monospace;
      white-space: pre-wrap;
      overflow: auto;
      max-height: 300px;
    `;
    errorElement.innerHTML = `
      <h3>应用初始化失败</h3>
      <p>错误信息: ${error.message}</p>
      <p>错误堆栈:</p>
      <pre>${error.stack}</pre>
    `;
    document.body.appendChild(errorElement);
  }
});
