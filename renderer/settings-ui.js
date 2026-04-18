class SettingsUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
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

  // 处理清理临时文件
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

  // 确认清理临时文件
  confirmDeleteTemp() {
    // 移除确认对话框
    const confirmDialog = document.querySelector('.log-item.warning');
    if (confirmDialog) {
      confirmDialog.remove();
    }

    // 显示清理进度
    this.logManager.addInfoLog('正在清理Auto366缓存...');

    window.electronAPI.clearCache().then(result => {
      if (result && result.success) {
        this.logManager.addSuccessLog(`Auto366缓存清理成功 - 已清理 ${result.filesDeleted} 个文件，${result.dirsDeleted} 个目录`);
      } else if (result && !result.success) {
        this.logManager.addErrorLog(`Auto366缓存清理失败: ${result.error || '未知错误'}`);
      } else {
        this.logManager.addSuccessLog('Auto366缓存清理完成');
      }
    }).catch(error => {
      this.logManager.addErrorLog(`Auto366缓存清理失败: ${error.message || error}`);
    });
  }

  // 处理清理天学网文件缓存
  handleDeleteFileTemp() {
    const resultDiv = document.getElementById('trafficLog');

    const confirmHtml = `
      <div class="log-item warning">
        <i class="bi bi-exclamation-triangle"></i>
        <span>确定要清理天学网文件缓存吗？此操作将删除天学网缓存目录，不可撤销。</span>
        <div class="cache-buttons">
          <button onclick="this.parentElement.remove()" class="btn-small btn-cancel">取消</button>
          <button onclick="universalAnswerFeature.confirmDeleteFileTemp()" class="btn-small btn-danger">确认清理</button>
        </div>
      </div>
    `;

    resultDiv.insertAdjacentHTML('beforeend', confirmHtml);
    resultDiv.scrollTop = resultDiv.scrollHeight;
  }

  // 确认清理天学网文件缓存
  confirmDeleteFileTemp() {
    // 移除确认对话框
    const confirmDialog = document.querySelector('.log-item.warning');
    if (confirmDialog) {
      confirmDialog.remove();
    }

    // 显示清理进度
    this.logManager.addInfoLog('正在清理天学网缓存...');

    const result = window.electronAPI.removeCacheFile();
    if (result && result.success) {
      this.logManager.addSuccessLog(`天学网缓存清理成功 - 已清理 ${result.filesDeleted} 个文件，${result.dirsDeleted} 个目录`);
    } else if (result && !result.success) {
      this.logManager.addErrorLog(`天学网缓存清理失败: ${result.error || '未知错误'}`);
    } else if (result) {
      this.logManager.addSuccessLog('天学网缓存清理完成');
    } else {
      this.logManager.addErrorLog('天学网缓存清理失败');
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
