import { createLogger } from '../../services/logger.js';
const moduleLog = createLogger('更新');
import settingsStorage from '../../services/settings.js';

export default {
initUpdateSettings() {
    try {
      const autoCheckUpdatesCheckbox = document.getElementById('autoCheckUpdates');
      if (autoCheckUpdatesCheckbox) {
        const autoCheckUpdates = settingsStorage.getItem('auto-check-updates') !== 'false';
        autoCheckUpdatesCheckbox.checked = autoCheckUpdates;

        autoCheckUpdatesCheckbox.addEventListener('change', () => {
          const newValue = autoCheckUpdatesCheckbox.checked;
          settingsStorage.setItem('auto-check-updates', newValue.toString());
          this.logManager.addInfoLog(`自动检查更新已${newValue ? '启用' : '禁用'}`, "更新");
        });
      }
    } catch (error) {
      moduleLog.error('初始化更新设置失败:', error);
    }
  },

async handleUpdateNotification() {
    const updateBtns = [document.getElementById('update-notification-btn'), document.getElementById('update-notification-btn-simple')].filter(Boolean);
    this.logManager.addInfoLog('正在检查更新...', "更新");

    if (window.electronAPI && window.electronAPI.checkForUpdates) {
      window.electronAPI.checkForUpdates().then(async (result) => {
        if (result.hasUpdate) {
          this.logManager.addSuccessLog(`发现新版本 ${result.version}`, "更新");
          await this.showUpdatePanel(result);
          updateBtns.forEach((updateBtn) => {
            updateBtn.classList.add('has-update');
            updateBtn.title = `发现新版本 ${result.version}`;
          });
        } else if (result.isDev) {
          this.logManager.addInfoLog('开发环境不支持自动更新', "更新");
          updateBtns.forEach((updateBtn) => {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '开发环境';
          });
        } else if (result.error) {
          this.logManager.addErrorLog('检查更新失败: ' + result.error, "更新");
          updateBtns.forEach((updateBtn) => {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '检查更新失败';
          });
        } else {
          this.logManager.addInfoLog(result.message || '当前已是最新版本', "更新");
          updateBtns.forEach((updateBtn) => {
            updateBtn.classList.remove('has-update');
            updateBtn.title = '当前已是最新版本';
          });
        }
      }).catch(error => {
        this.logManager.addErrorLog('检查更新失败: ' + error.message, "更新");
        updateBtns.forEach((updateBtn) => {
          updateBtn.classList.remove('has-update');
          updateBtn.title = '检查更新失败';
        });
      });
    } else {
      this.logManager.addInfoLog('请访问官网下载最新版本', "更新");
      if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal('https://366.cyril.qzz.io');
      }
    }
  },

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
      moduleLog.error('获取应用版本失败:', error);
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
  },

startUpdateDownload(version) {
    const updatePanel = document.getElementById('update-panel');
    if (updatePanel) {
      updatePanel.remove();
    }

    this.logManager.addInfoLog(`开始下载版本 ${version}...`, "更新");

    if (window.electronAPI && window.electronAPI.updateConfirm) {
      window.electronAPI.updateConfirm();
    }
  },

handleUpdateProgress(progressData) {
    if (!progressData || typeof progressData !== 'object') {
      moduleLog.warn('handleUpdateProgress: progressData is undefined or invalid');
      return;
    }

    const { percent = 0, bytesPerSecond = 0, total = 0, transferred = 0 } = progressData;

    const roundedPercent = Math.floor(percent / 5) * 5;

    if (!this.state.lastProgressPercent || this.state.lastProgressPercent !== roundedPercent) {
      this.state.lastProgressPercent = roundedPercent;

      const speedMB = (bytesPerSecond / 1024 / 1024).toFixed(2);
      const totalMB = (total / 1024 / 1024).toFixed(2);
      const transferredMB = (transferred / 1024 / 1024).toFixed(2);

      this.logManager.addInfoLog(`更新下载进度: ${roundedPercent}% (${transferredMB}MB/${totalMB}MB) - 速度: ${speedMB}MB/s`, "更新");
    }
  },

handleUpdateAvailable(updateInfo) {
    this.logManager.addSuccessLog(`发现新版本 ${updateInfo.version}`, "更新");

    this.showUpdatePanel(updateInfo);

    const updateBtns = [document.getElementById('update-notification-btn'), document.getElementById('update-notification-btn-simple')].filter(Boolean);
    updateBtns.forEach((updateBtn) => {
      updateBtn.classList.add('has-update');
      updateBtn.title = `发现新版本 ${updateInfo.version}`;
    });
  },

handleUpdateDownloaded(data) {
    this.logManager.addSuccessLog('更新下载完成，准备安装...', "更新");

    this.showUpdateInstallDialog();
  },

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
  },

installUpdate() {
    const installDialog = document.getElementById('update-install-dialog');
    if (installDialog) {
      installDialog.remove();
    }

    this.logManager.addInfoLog('正在安装更新...', "更新");

    if (window.electronAPI && window.electronAPI.updateInstall) {
      window.electronAPI.updateInstall();
    }
  }
};
