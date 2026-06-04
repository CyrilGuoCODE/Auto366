const { PostHog } = require('posthog-node');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const POSTHOG_API_KEY = 'phc_BgCkk9orqQzYkMEz6zsxKnZT5VFwqTjcGumXZLiaazuk';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

const CONFIG_DIR = path.join(require('os').homedir(), '.Auto366');
const CONFIG_FILE = path.join(CONFIG_DIR, 'analytics.json');

class AnalyticsManager {
  constructor() {
    this.client = null;
    this.enabled = true;
    this.distinctId = null;
  }

  init() {
    this._loadConfig();

    if (!this.enabled) {
      console.log('[Analytics] 数据分析已禁用，跳过初始化');
      return;
    }

    try {
      this.client = new PostHog(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        flushAt: 1,
        flushInterval: 3000,
      });

      this.distinctId = this._getOrCreateDistinctId();

      this.client.identify({
        distinctId: this.distinctId,
        properties: {
          app_version: app.isReady() ? app.getVersion() : 'unknown',
          platform: process.platform,
          os_release: require('os').release(),
        },
      });

      console.log('[Analytics] 初始化成功, distinctId:', this.distinctId);
    } catch (error) {
      console.error('[Analytics] 初始化失败:', error.message);
    }
  }

  capture(event, properties = {}) {
    if (!this.enabled || !this.client) {
      console.log(`[Analytics] 事件跳过 (${event}), enabled=${this.enabled}, client=${!!this.client}`);
      return;
    }

    try {
      this.client.capture({
        event,
        distinctId: this.distinctId,
        properties: {
          ...properties,
          app_version: app.isReady() ? app.getVersion() : 'unknown',
          platform: process.platform,
        },
      });
      console.log(`[Analytics] 事件已捕获: ${event}`);
    } catch (error) {
      console.error(`[Analytics] 事件捕获失败 (${event}):`, error.message);
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this._saveConfig();

    if (!enabled && this.client) {
      this.client.shutdown();
      this.client = null;
      console.log('[Analytics] 数据分析已禁用');
    } else if (enabled && !this.client) {
      this.init();
      this.capture('analytics_enabled');
      console.log('[Analytics] 数据分析已启用');
    }
  }

  getEnabled() {
    return this.enabled;
  }

  async shutdown() {
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch (error) {
        console.error('[Analytics] 关闭失败:', error.message);
      }
    }
  }

  registerIpcHandlers() {
    const { ipcMain } = require('electron');

    ipcMain.handle('get-analytics-enabled', () => {
      return this.enabled;
    });

    ipcMain.handle('set-analytics-enabled', (event, enabled) => {
      this.setEnabled(enabled);
      return { success: true };
    });

    ipcMain.handle('capture-event', (event, eventName, properties) => {
      this.capture(eventName, properties);
      return { success: true };
    });
  }

  _getOrCreateDistinctId() {
    const idFilePath = path.join(CONFIG_DIR, '.device_id');
    try {
      if (fs.existsSync(idFilePath)) {
        return fs.readFileSync(idFilePath, 'utf-8').trim();
      }
    } catch (_) {}

    const { v4: uuidv4 } = require('uuid');
    const newId = uuidv4();
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(idFilePath, newId, 'utf-8');
    } catch (_) {}
    return newId;
  }

  _loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        this.enabled = config.enabled !== false;
      }
    } catch (_) {
      this.enabled = true;
    }
  }

  _saveConfig() {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ enabled: this.enabled }), 'utf-8');
    } catch (error) {
      console.error('[Analytics] 保存配置失败:', error.message);
    }
  }
}

module.exports = AnalyticsManager;
