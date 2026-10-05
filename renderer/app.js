import { createLogger } from './services/logger.js';
const moduleLog = createLogger('界面');
import { initializeSettings } from './services/settings.js';
import settingsStorage from './services/settings.js';
// 导入所有模块
import StateManager from './state.js';
import EventManager from './shell/events.js';
import LogManager from './panels/logs/index.js';
import ProxyUI from './panels/proxy/index.js';
import AnswersUI from './pages/answers/index.js';
import RulesUI from './pages/rules/index.js';
import ExtensionRulesUI from './pages/extensions/index.js';
import SettingsUI from './pages/settings/index.js';
import TutorialManager from './dialogs/tutorial.js';
import AgreementUI from './dialogs/agreement.js';
import SpeedUI from './pages/speed/index.js';
import ThemeUI from './shell/theme.js';
import TtsApprovalUI from './dialogs/approval.js';

class Auto366App {
  constructor() {
    this.state = new StateManager();
    this.logManager = new LogManager(this.state);
    this.eventManager = new EventManager(this.state);
    this.proxyUI = new ProxyUI(this.state, this.logManager);
    this.answersUI = new AnswersUI(this.state, this.logManager);
    this.rulesUI = new RulesUI(this.state, this.logManager);
    this.extensionRulesUI = new ExtensionRulesUI(this.state, this.logManager);
    this.settingsUI = new SettingsUI(this.state, this.logManager);
    this.tutorialUI = new TutorialManager(this.state, this.logManager);
    this.agreementUI = new AgreementUI();
    this.speedUI = new SpeedUI();
    this.themeUI = new ThemeUI();
    this.ttsApprovalUI = new TtsApprovalUI(this.logManager);
  }

  // 初始化应用
  async init() {
    try {
      await initializeSettings();
      // 暴露方法到全局（必须在最前面，因为HTML中的onclick依赖这些方法）
      this.exposeMethods();

      // 初始化颜色模式切换（尽早, 保证按钮联动与系统跟随）
      this.themeUI.init();

      // 初始化进程加速页面
      this.speedUI.init();

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

      // 初始化扩展规则集
      this.extensionRulesUI.initExtensionRulesets();

      // 设置页自行装配 AI、缓存、资源、TTS 等设置。
      this.settingsUI.init();

      // 初始化 TTS 预清洗审批弹窗
      this.ttsApprovalUI.init();

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
        moduleLog.error('加载规则失败:', error);
      }

      // 尝试加载扩展规则集
      try {
        await this.extensionRulesUI.loadExtensionRulesets();
      } catch (error) {
        moduleLog.error('加载扩展规则集失败:', error);
      }

      // 显示赞赏弹窗
      if (settingsStorage.getItem('tutorial-completed') === 'true') this.showDonationModal();

      // 自动启动天学网进程监控
      if (window.electronAPI.startProcessMonitor) {
        window.electronAPI.startProcessMonitor();
      }

      // 初始化协议检查（必须在教程之前，协议未同意则不能使用）
      this.agreementUI.initEventListeners();
      await this.agreementUI.checkAndShow();
      this.tutorialUI.init();
      const autoStart = () => {
        if (settingsStorage.getItem('tutorial-completed') === 'true' && settingsStorage.getItem('auto-start-proxy') !== 'false') this.proxyUI.startProxy();
      };
      if (!document.getElementById('agreement-overlay')?.classList.contains('is-visible')) autoStart();
      else document.addEventListener('agreement-accepted', autoStart, { once: true });

      this.logManager.addInfoLog('提示：新版天学网必须使用增强模式。遇到异常先清缓存并重启；仍报兼容或连接错误时，回退旧版天学网、还原天学网设置，再启动代理并使用增强模式', "界面");

      // 追踪应用启动完成
      this.captureEvent('app_initialized');

    } catch (error) {
      moduleLog.error('应用初始化失败:', error);
      this.logManager.addErrorLog('应用初始化失败: ' + error.message, "界面");
    }
  }

  // 初始化全局设置
  initGlobalSettings() {
    const cachePath = settingsStorage.getItem('cache-path') || 'D:\\Up366StudentFiles';
    if (window.electronAPI && window.electronAPI.setCachePath) {
      window.electronAPI.setCachePath(cachePath);
    }
  }

  // 发送分析事件
  captureEvent(eventName, properties = {}) {
    if (window.electronAPI && window.electronAPI.captureEvent) {
      window.electronAPI.captureEvent(eventName, properties);
    }
  }

  // 绑定更新按钮点击事件
  bindUpdateButtons() {
    const checkUpdateBtn = document.getElementById('check-update-btn');
    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', () => {
        this.settingsUI.handleUpdateNotification();
      });
    }

    const simpleUpdateBtn = document.getElementById('update-notification-btn-simple');
    if (simpleUpdateBtn) {
      simpleUpdateBtn.addEventListener('click', () => {
        this.settingsUI.handleUpdateNotification();
      });
    }

    const resetCertBtn = document.getElementById('resetCertificateBtn');
    if (resetCertBtn) {
      resetCertBtn.addEventListener('click', () => {
        this.settingsUI.handleResetCertificate();
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
          await this.rulesUI.renderSimpleHomeRulesets();
        }
      }
    } catch (error) {
      moduleLog.error('初始化UI模式失败:', error);
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
      this.logManager.addErrorLog(`响应错误: ${data.error} - ${data.url}`, "界面");
    });

    // 监听重要请求
    window.electronAPI.onImportantRequest((event, data) => {
      this.logManager.addImportantLog(data);
    });

    // 监听下载发现
    window.electronAPI.onDownloadFound((event, data) => {
      this.logManager.addSuccessLog(`发现下载链接: ${data.url}`, "界面");
    });

    // 监听处理错误
    window.electronAPI.onProcessError((event, data) => {
      this.logManager.addErrorLog(data.error, "界面");
    });

    // 监听答案提取
    window.electronAPI.onAnswersExtracted((event, data) => {
      this.answersUI.displayAnswers(data);

      // 输出答案文件位置
      if (data.file) {
        this.logManager.addSuccessLog(`答案文件已保存到: ${data.file}`, "界面");
      }
    });

    // 监听捕获状态
    window.electronAPI.onCaptureStatus((event, data) => {
      this.proxyUI.updateCaptureStatus(data);
    });

    // 监听代理错误
    window.electronAPI.onProxyError((event, data) => {
      this.logManager.addErrorLog(data.message, "界面");
      // 如果代理出错，重置按钮状态
      const toggleBtn = document.getElementById('toggleProxyBtn');
      const captureBtn = document.getElementById('startCaptureBtn');

      if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.innerHTML = '<i class="bi bi-play-circle"></i><span>启动代理</span>';
        toggleBtn.className = 'btn--primary';
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

    // 监听进程监控事件
    window.electronAPI.onProcessMonitorEvent((event, data) => {
      if (data.type === 'count-updated') {
        if (this.proxyUI && this.proxyUI.updateUp366BtnState) {
          this.proxyUI.updateUp366BtnState({ currentState: data.isRunning });
        }
      } else if (data.type === 'state-changed') {
        if (this.proxyUI && this.proxyUI.updateUp366BtnState) {
          this.proxyUI.updateUp366BtnState(data);
        }
      }
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
        this.logManager.addErrorLog('未选择文件', "界面");
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
      this.logManager.addSuccessLog('文件下载成功', "界面");
    } else {
      this.logManager.addErrorLog('文件下载失败', "界面");
    }
  }

  // 显示赞赏弹窗
  showDonationModal() {
    const launchCount = settingsStorage.getItem('launchCount') || 0;
    const newCount = parseInt(launchCount) + 1;
    settingsStorage.setItem('launchCount', newCount.toString());

    // 每5次启动显示一次
    if (newCount % 5 === 0) {
      const modal = document.createElement('div');
      modal.id = 'donation-modal';
      modal.className = 'modal modal--donation';

      modal.innerHTML = `
        <div class="modal__content">
          <div class="modal__header">
            <h3>支持 Auto366 开发</h3>
            <button class="btn--close" id="donation-modal-close-btn">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="modal__body">
            <div class="appreciation">
              <div class="appreciation__section">
                <div class="appreciation__icon" title="如果这个工具对您有帮助，欢迎赞赏支持">
                  <svg viewBox="0 0 1024 1024" class="appreciation__icon--heart">
                    <path d="M512 896c-12.8 0-25.6-4.8-35.2-14.4L89.6 494.4c-76.8-76.8-76.8-201.6 0-278.4 38.4-38.4 89.6-57.6 140.8-57.6s102.4 19.2 140.8 57.6L512 356.8l140.8-140.8c38.4-38.4 89.6-57.6 140.8-57.6s102.4 19.2 140.8 57.6c76.8 76.8 76.8 201.6 0 278.4L547.2 881.6c-9.6 9.6-22.4 14.4-35.2 14.4z" />
                  </svg>
                  <span class="appreciation__text">赞赏</span>
                  <div class="appreciation__popup">
                    <div class="appreciation__content">
                      <div class="appreciation__qr-group">
                        <img src="resources/Cyril_prize.jpg" alt="Cyril赞赏码" class="appreciation__qr">
                        <img src="resources/Cyp_prize.jpg" alt="CYP赞赏码" class="appreciation__qr">
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="appreciation__section">
                <div class="appreciation__icon" title="加入QQ群，获取更多帮助与支持">
                  <svg class="appreciation__icon--heart appreciation__icon--qq" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                    <path d="M29.11 26.278c-0.72 0.087-2.804-3.296-2.804-3.296 0 1.959-1.009 4.515-3.191 6.362 1.052 0.325 3.428 1.198 2.863 2.151-0.457 0.772-7.844 0.493-9.977 0.252-2.133 0.24-9.52 0.519-9.977-0.252-0.565-0.953 1.807-1.826 2.861-2.151-2.182-1.846-3.191-4.403-3.191-6.362 0 0-2.083 3.384-2.804 3.296-0.335-0.041-0.776-1.853 0.584-6.231 0.641-2.064 1.375-3.78 2.509-6.611-0.191-7.306 2.828-13.435 10.016-13.435 7.109 0.001 10.197 6.008 10.017 13.435 1.132 2.826 1.869 4.553 2.509 6.611 1.361 4.379 0.92 6.191 0.584 6.231z" />
                  </svg>
                  <span class="appreciation__text">QQ群</span>
                  <div class="appreciation__popup">
                    <div class="appreciation__content">
                      <div class="appreciation__qr-group">
                        <img src="resources/qq.jpg" alt="QQ群二维码" class="appreciation__qr">
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal__messages">
              <p class="modal__message">你已经启动 Auto366 ${newCount} 次了，不考虑赞助一下吗？</p>
              <p class="modal__message">如果工具对你有用，随时欢迎赞赏支持或加入QQ群交流哦~</p>
            </div>
            <div class="modal__footer">
              <button class="btn--ghost" id="donation-modal-later-btn">稍后再说</button>
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
      exportAnswersJson: () => this.answersUI.exportAnswersJson(),
      exportAnswersPdf: () => this.answersUI.exportAnswersPdf(),
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
      editRule: (ruleId, rulesetId) => this.rulesUI.editRule(ruleId, rulesetId),
      deleteRule: (ruleId, rulesetId) => this.rulesUI.deleteRule(ruleId, rulesetId),
      resetRuleTriggers: (ruleId, rulesetId) => this.rulesUI.resetRuleTriggers(ruleId, rulesetId),
      toggleRule: (ruleId, enabled, rulesetId) => this.rulesUI.toggleRule(ruleId, enabled, rulesetId),
      browseZipFile: () => this.rulesUI.browseZipFile(),
      enterSimpleRuleset: (groupId) => this.rulesUI.enterSimpleRuleset(groupId),
      deleteSimpleRuleset: (groupId) => this.rulesUI.deleteSimpleRuleset(groupId),
      
      // 扩展规则集
      loadExtensionRulesets: (reset) => this.extensionRulesUI.loadExtensionRulesets(reset),
      searchRulesets: () => this.extensionRulesUI.searchRulesets(),
      refreshRulesets: () => this.extensionRulesUI.refreshRulesets(),
      previousPage: () => this.extensionRulesUI.previousPage(),
      nextPage: () => this.extensionRulesUI.nextPage(),
      showRulesetDetail: (rulesetId) => this.extensionRulesUI.showRulesetDetail(rulesetId),
      hideRulesetDetailModal: () => this.extensionRulesUI.hideRulesetDetailModal(),
      installRuleset: (rulesetId) => this.extensionRulesUI.installRuleset(rulesetId),
      
      // 日志管理
      addTrafficLog: (data) => this.logManager.addTrafficLog(data),
      addSuccessLog: (message) => this.logManager.addSuccessLog(message, "界面"),
      addErrorLog: (message) => this.logManager.addErrorLog(message, "界面"),
      addInfoLog: (message) => this.logManager.addInfoLog(message, "界面"),
      clearLogs: () => this.logManager.clearLogs(),
      
      // 设置管理
      handleClearCache: () => this.settingsUI.handleClearCache(),
      confirmClearCache: () => this.settingsUI.confirmClearCache(),
      handleResetCertificate: () => this.settingsUI.handleResetCertificate(),
      handleOpenUp366: () => this.settingsUI.handleOpenUp366(),
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
  moduleLog.log('DOM 加载完成，开始初始化应用...');
  try {
    const app = new Auto366App();
    window.app = app;
    moduleLog.log('Auto366App 实例创建成功');
    app.exposeMethods();
    moduleLog.log('方法暴露成功');
    await app.init();
    moduleLog.log('应用初始化完成');
  } catch (error) {
    moduleLog.error('应用初始化失败:', error);
    moduleLog.error('错误堆栈:', error.stack);
    // 在页面上显示错误信息
    const errorElement = document.createElement('div');
    errorElement.style.cssText = `
      position: fixed;
      top: 50px;
      left: 0;
      right: 0;
      background: var(--color-error-bg);
      color: var(--color-error-text);
      padding: 16px;
      border-bottom: 2px solid var(--color-error);
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
