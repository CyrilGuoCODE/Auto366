class SettingsUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
    this._clearBtnLongPressTimer = null;
    this._clearBtnClosingState = false;
    this._clearBtnMouseDown = false;
    this._clearBtnPressStartTime = 0;
    this._clearBtnLongPressTriggered = false;
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
            this.logManager.addSuccessLog('已启用缓存文件保留，答案提取的临时文件将不会被自动删除');
          } else {
            this.logManager.addInfoLog('已禁用缓存文件保留，答案提取的临时文件将被自动删除');
          }
        });
      }

      // 初始化缓存路径输入框
      const cachePathInput = document.getElementById('cachePathInput');
      if (cachePathInput) {
        const cachePath = localStorage.getItem('cache-path') || '';
        cachePathInput.value = cachePath;
        if (!cachePath) {
          cachePathInput.placeholder = '请通过自动查找或手动浏览设置缓存路径';
        }
        
        // 保存缓存路径变化
        cachePathInput.addEventListener('change', () => {
          const newPath = cachePathInput.value.trim();
          if (newPath) {
            localStorage.setItem('cache-path', newPath);
            if (window.electronAPI && window.electronAPI.setCachePath) {
              window.electronAPI.setCachePath(newPath);
            }
            this.logManager.addSuccessLog(`缓存路径已更新为: ${newPath}`);
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
              localStorage.setItem('cache-path', dirPath);
              if (window.electronAPI.setCachePath) {
                window.electronAPI.setCachePath(dirPath);
              }
              // 更新输入框
              const cachePathInput = document.getElementById('cachePathInput');
              if (cachePathInput) {
                cachePathInput.value = dirPath;
              }
              this.logManager.addSuccessLog(`缓存路径已更新为: ${dirPath}`);
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
              localStorage.setItem('cache-path', result.path);
              if (window.electronAPI.setCachePath) {
                window.electronAPI.setCachePath(result.path);
              }
              if (cachePathInput) {
                cachePathInput.value = result.path;
              }
              this.logManager.addSuccessLog(`自动寻找缓存目录成功，路径为：${result.path}`);
            } else {
              if (result.count === 0) {
                this.logManager.addErrorLog('自动寻找缓存目录失败，未找到 Up366StudentFiles 文件夹');
              } else {
                this.logManager.addErrorLog(`自动寻找缓存目录失败，找到 ${result.count} 个 Up366StudentFiles 文件夹`);
              }
            }
          } catch (error) {
            this.logManager.addErrorLog(`自动寻找缓存目录失败: ${error.message}`);
          } finally {
            autoFindCacheBtn.disabled = false;
          }
        });
      }
    } catch (error) {
      console.error('初始化缓存设置失败:', error);
    }
  }

  // 初始化更新设置
  initUpdateSettings() {
    try {
      const autoCheckUpdatesCheckbox = document.getElementById('autoCheckUpdates');
      if (autoCheckUpdatesCheckbox) {
        const autoCheckUpdates = localStorage.getItem('auto-check-updates') !== 'false';
        autoCheckUpdatesCheckbox.checked = autoCheckUpdates;

        autoCheckUpdatesCheckbox.addEventListener('change', () => {
          const newValue = autoCheckUpdatesCheckbox.checked;
          localStorage.setItem('auto-check-updates', newValue.toString());
          this.logManager.addInfoLog(`自动检查更新已${newValue ? '启用' : '禁用'}`);
        });
      }
    } catch (error) {
      console.error('初始化更新设置失败:', error);
    }
  }

  // 初始化规则设置
  initRulesSettings() {
    try {
      const compatibilityProtectionCheckbox = document.getElementById('compatibilityProtection');
      if (compatibilityProtectionCheckbox) {
        const protectionEnabled = localStorage.getItem('compatibility-protection-enabled') !== 'false';
        compatibilityProtectionCheckbox.checked = protectionEnabled;

        compatibilityProtectionCheckbox.addEventListener('change', () => {
          const newValue = compatibilityProtectionCheckbox.checked;
          localStorage.setItem('compatibility-protection-enabled', newValue.toString());
          this.logManager.addInfoLog(`规则集兼容性保护已${newValue ? '启用' : '禁用'}`);
        });
      }
    } catch (error) {
      console.error('初始化规则设置失败:', error);
    }
  }

  // 处理清理缓存
  handleClearCache() {
    const resultDiv = document.getElementById('trafficLog');

    const confirmHtml = `
      <div class="log-item log-item--warning">
        <i class="bi bi-exclamation-triangle"></i>
        <span>确定要清理所有缓存吗？此操作将清理 Auto366 临时文件和天学网缓存，不可撤销。</span>
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
  }

  // 确认清理缓存（保留供外部直接调用）
  async confirmClearCache() {
    const confirmDialog = document.querySelector('.log-item--warning');
    if (confirmDialog) confirmDialog.remove();
    await this._performClearCache();
  }

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
  }

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
  }

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
  }

  _onClearBtnMouseLeave() {
    this._clearLongPressTimer();

    if (this._clearBtnClosingState) {
      this._cancelClearOnlyState();
    }

    this._clearBtnMouseDown = false;
  }

  _clearLongPressTimer() {
    if (this._clearBtnLongPressTimer) {
      clearTimeout(this._clearBtnLongPressTimer);
      this._clearBtnLongPressTimer = null;
    }
  }

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
  }

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
  }

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
  }

  async _handleClearAndRestart() {
    await this._performClearCache();

    this.logManager.addInfoLog('正在重启天学网...');
    const killResult = await window.electronAPI.killUp366();
    if (killResult && killResult.success) {
      this.logManager.addSuccessLog('天学网已强制关闭，正在重新启动...');
    } else {
      this.logManager.addInfoLog('正在重新启动天学网...');
    }
    const openResult = await window.electronAPI.openUp366();
    if (openResult && openResult.success) {
      this.logManager.addSuccessLog('天学网已重新启动');
    } else {
      this.logManager.addErrorLog(`打开天学网失败: ${openResult?.error || '未找到天学网安装路径'}`);
    }
  }

  async _performClearCache() {
    const dialog = document.querySelector('.log-item--warning');
    if (dialog) dialog.remove();

    this.logManager.addInfoLog('正在清理缓存...');

    const result = await window.electronAPI.clearCache();
    if (result && result.success) {
      result.messages.forEach(msg => {
        this.logManager.addSuccessLog(msg);
      });
      this.logManager.addSuccessLog(`总计已清理 ${result.filesDeleted} 个文件，${result.dirsDeleted} 个目录`);
    } else if (result && !result.success) {
      this.logManager.addErrorLog(`缓存清理失败: ${result.error || '未知错误'}`);
    } else {
      this.logManager.addErrorLog('缓存清理失败');
    }
  }

  // 处理一键打开天学网
  async handleOpenUp366() {
    this.logManager.addInfoLog('正在打开天学网...');
    const result = await window.electronAPI.openUp366();
    if (result && result.success) {
      this.logManager.addSuccessLog(`天学网已启动`);
    } else {
      this.logManager.addErrorLog(`打开天学网失败: ${result?.error || '未找到天学网安装路径，请确认已安装天学网'}`);
    }
  }

  // 处理更新通知
  async handleUpdateNotification() {
    const updateBtns = [document.getElementById('update-notification-btn'), document.getElementById('update-notification-btn-simple')].filter(Boolean);
    this.logManager.addInfoLog('正在检查更新...');

    if (window.electronAPI && window.electronAPI.checkForUpdates) {
      window.electronAPI.checkForUpdates().then(async (result) => {
        if (result.hasUpdate) {
          this.logManager.addSuccessLog(`发现新版本 ${result.version}`);
          await this.showUpdatePanel(result);
          updateBtns.forEach((updateBtn) => {
            updateBtn.classList.add('has-update');
            updateBtn.title = `发现新版本 ${result.version}`;
          });
        } else if (result.isDev) {
          this.logManager.addInfoLog('开发环境不支持自动更新');
          updateBtns.forEach((updateBtn) => {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '开发环境';
          });
        } else if (result.error) {
          this.logManager.addErrorLog('检查更新失败: ' + result.error);
          updateBtns.forEach((updateBtn) => {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '检查更新失败';
          });
        } else {
          this.logManager.addInfoLog(result.message || '当前已是最新版本');
          updateBtns.forEach((updateBtn) => {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '当前已是最新版本';
          });
        }
      }).catch(error => {
        this.logManager.addErrorLog('检查更新失败: ' + error.message);
        updateBtns.forEach((updateBtn) => {
          updateBtn.classList.remove('has-update');
          updateBtn.title = '检查更新失败';
        });
      });
    } else {
      this.logManager.addInfoLog('请访问官网下载最新版本');
      if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal('https://366.cyril.qzz.io');
      }
    }
  }

  // 显示更新面板
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
    updatePanel.className = 'modal modal--update';

    updatePanel.innerHTML = `
      <div class="modal__overlay"></div>
      <div class="modal__content">
        <div class="modal__header">
          <h3>发现新版本</h3>
          <button class="btn--close" onclick="this.closest('.modal--update').remove()">×</button>
        </div>
        <div class="modal__body">
          <div class="modal__version-info">
            <div class="modal__current-version">
              <span class="modal__version-label">当前版本:</span>
              <span class="modal__version-number">${currentVersion}</span>
            </div>
            <div class="modal__new-version">
              <span class="modal__version-label">最新版本:</span>
              <span class="modal__version-number is-highlight">${updateInfo.version}</span>
            </div>
          </div>
          <div class="modal__changelog">
            <h4>更新内容:</h4>
            <div class="modal__changelog-content">
              ${updateInfo.releaseNotes || '• 性能优化和错误修复<br>• 改进用户体验<br>• 新增功能和特性'}
            </div>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn--cancel" onclick="this.closest('.modal--update').remove()">
            稍后提醒
          </button>
          <button class="btn--primary" onclick="universalAnswerFeature.startUpdateDownload('${updateInfo.version}')">
            立即更新
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(updatePanel);
  }

  // 开始更新下载
  startUpdateDownload(version) {
    const updatePanel = document.getElementById('update-panel');
    if (updatePanel) {
      updatePanel.remove();
    }

    this.logManager.addInfoLog(`开始下载版本 ${version}...`);

    if (window.electronAPI && window.electronAPI.updateConfirm) {
      window.electronAPI.updateConfirm();
    }
  }

  // 处理更新进度
  handleUpdateProgress(progressData) {
    if (!progressData || typeof progressData !== 'object') {
      console.warn('handleUpdateProgress: progressData is undefined or invalid');
      return;
    }

    const { percent = 0, bytesPerSecond = 0, total = 0, transferred = 0 } = progressData;

    const roundedPercent = Math.floor(percent / 5) * 5;

    if (!this.state.lastProgressPercent || this.state.lastProgressPercent !== roundedPercent) {
      this.state.lastProgressPercent = roundedPercent;

      const speedMB = (bytesPerSecond / 1024 / 1024).toFixed(2);
      const totalMB = (total / 1024 / 1024).toFixed(2);
      const transferredMB = (transferred / 1024 / 1024).toFixed(2);

      this.logManager.addInfoLog(`更新下载进度: ${roundedPercent}% (${transferredMB}MB/${totalMB}MB) - 速度: ${speedMB}MB/s`);
    }
  }

  // 处理更新可用
  handleUpdateAvailable(updateInfo) {
    this.logManager.addSuccessLog(`发现新版本 ${updateInfo.version}`);

    this.showUpdatePanel(updateInfo);

    const updateBtns = [document.getElementById('update-notification-btn'), document.getElementById('update-notification-btn-simple')].filter(Boolean);
    updateBtns.forEach((updateBtn) => {
      updateBtn.classList.add('has-update');
      updateBtn.title = `发现新版本 ${updateInfo.version}`;
    });
  }

  // 处理更新下载完成
  handleUpdateDownloaded(data) {
    this.logManager.addSuccessLog('更新下载完成，准备安装...');

    this.showUpdateInstallDialog();
  }

  // 显示更新安装对话框
  showUpdateInstallDialog() {
    const existingDialog = document.getElementById('update-install-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    const installDialog = document.createElement('div');
    installDialog.id = 'update-install-dialog';
    installDialog.className = 'modal modal--update';

    installDialog.innerHTML = `
      <div class="modal__overlay"></div>
      <div class="modal__content">
        <div class="modal__header">
          <h3>更新已下载完成</h3>
        </div>
        <div class="modal__body">
          <div class="modal__install-message">
            <p>新版本已下载完成，是否立即重启应用进行安装？</p>
            <p class="modal__warning">安装过程中应用将会关闭，请确保已保存所有工作。</p>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn--cancel" onclick="this.closest('.modal--update').remove()">
            稍后安装
          </button>
          <button class="btn--primary" onclick="universalAnswerFeature.installUpdate()">
            立即安装
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(installDialog);
  }

  // 安装更新
  installUpdate() {
    const installDialog = document.getElementById('update-install-dialog');
    if (installDialog) {
      installDialog.remove();
    }

    this.logManager.addInfoLog('正在安装更新...');

    if (window.electronAPI && window.electronAPI.updateInstall) {
      window.electronAPI.updateInstall();
    }
  }
}

export default SettingsUI;
