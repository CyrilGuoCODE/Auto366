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
      
      // 绑定更新按钮点击事件
      this.bindUpdateButtons();
      
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
  }

  // 绑定更新按钮点击事件
  bindUpdateButtons() {
    const updateBtns = document.querySelectorAll('#update-notification-btn, #update-notification-btn-simple');
    updateBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.settingsUI.handleUpdateNotification();
      });
    });
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
          <div class="donation-modal-header">
            <h3>支持 Auto366 开发</h3>
            <button class="donation-modal-close" id="donation-modal-close-btn">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="donation-modal-body">
            <div class="appreciation-wrapper">
              <div class="appreciation-section">
                <div class="appreciation-icon" title="如果这个工具对您有帮助，欢迎赞赏支持">
                  <svg viewBox="0 0 1024 1024" class="heart-icon">
                    <path d="M512 896c-12.8 0-25.6-4.8-35.2-14.4L89.6 494.4c-76.8-76.8-76.8-201.6 0-278.4 38.4-38.4 89.6-57.6 140.8-57.6s102.4 19.2 140.8 57.6L512 356.8l140.8-140.8c38.4-38.4 89.6-57.6 140.8-57.6s102.4 19.2 140.8 57.6c76.8 76.8 76.8 201.6 0 278.4L547.2 881.6c-9.6 9.6-22.4 14.4-35.2 14.4z" />
                  </svg>
                  <span class="appreciation-text">赞赏</span>
                  <div class="appreciation-popup">
                    <div class="appreciation-content">
                      <div class="appreciation-qr-container">
                        <img src="resources/Cyril_prize.jpg" alt="Cyril赞赏码" class="appreciation-qr">
                        <img src="resources/Cyp_prize.jpg" alt="CYP赞赏码" class="appreciation-qr">
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="appreciation-section">
                <div class="appreciation-icon" title="加入QQ群，获取更多帮助与支持">
                  <svg class="heart-icon heart-icon--qq" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                    <path d="M29.11 26.278c-0.72 0.087-2.804-3.296-2.804-3.296 0 1.959-1.009 4.515-3.191 6.362 1.052 0.325 3.428 1.198 2.863 2.151-0.457 0.772-7.844 0.493-9.977 0.252-2.133 0.24-9.52 0.519-9.977-0.252-0.565-0.953 1.807-1.826 2.861-2.151-2.182-1.846-3.191-4.403-3.191-6.362 0 0-2.083 3.384-2.804 3.296-0.335-0.041-0.776-1.853 0.584-6.231 0.641-2.064 1.375-3.78 2.509-6.611-0.191-7.306 2.828-13.435 10.016-13.435 7.109 0.001 10.197 6.008 10.017 13.435 1.132 2.826 1.869 4.553 2.509 6.611 1.361 4.379 0.92 6.191 0.584 6.231z" />
                  </svg>
                  <span class="appreciation-text">QQ群</span>
                  <div class="appreciation-popup">
                    <div class="appreciation-content">
                      <div class="appreciation-qr-container">
                        <img src="resources/qq.jpg" alt="QQ群二维码" class="appreciation-qr">
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="donation-messages">
              <p class="donation-message">你已经启动 Auto366 ${newCount} 次了，不考虑赞助一下吗？</p>
              <p class="donation-message">如果工具对你有用，随时欢迎赞赏支持或加入QQ群交流哦~</p>
            </div>
            <div class="donation-modal-footer">
              <button class="donation-btn-later" id="donation-modal-later-btn">稍后再说</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // 添加关闭事件监听
      const closeBtn = document.getElementById('donation-modal-close-btn');
      const laterBtn = document.getElementById('donation-modal-later-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          const el = document.getElementById('donation-modal');
          if (el) el.remove();
        });
      }
      if (laterBtn) {
        laterBtn.addEventListener('click', () => {
          const el = document.getElementById('donation-modal');
          if (el) el.remove();
        });
      }
    }
  }

  // 全局关闭赞赏弹窗函数（用于HTML中的onclick）
  closeDonationModal() {
    const el = document.getElementById('donation-modal');
    if (el) el.remove();
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
