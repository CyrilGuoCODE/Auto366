import { createLogger } from '../services/logger.js';
const moduleLog = createLogger('窗口');
export default {
async initWindowTitlebar() {
    if (!window.electronAPI) return;
    const pinBtn = document.getElementById('toggle-always-on-top-btn');
    const applyPin = (enabled) => {
      if (!pinBtn) return;
      const icon = pinBtn.querySelector('i');
      pinBtn.classList.toggle('is-active', !!enabled);
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
      moduleLog.error('获取应用版本失败:', error);
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
};
