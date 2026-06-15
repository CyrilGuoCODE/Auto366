const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

const AGREEMENTS_API = 'https://366.cyril.qzz.io/api/agreements';

class AgreementManager {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.cacheDir = path.join(this.userDataPath, 'agreements');
    this.appPath = app.getAppPath();
  }

  init() {
    this.registerIpcHandlers();
  }

  registerIpcHandlers() {
    ipcMain.handle('get-agreement-content', async () => {
      return this.getAgreementContent();
    });

    ipcMain.handle('accept-agreement', async (event, version) => {
      return this.acceptAgreement(version);
    });

    ipcMain.handle('reject-agreement', async () => {
      app.quit();
    });
  }

  async getAgreementContent() {
    // 先尝试从远程获取最新协议
    const remoteResult = await this.fetchRemoteAgreements();
    if (remoteResult) {
      // 缓存到本地
      this.cacheAgreements(remoteResult);
      return { ...remoteResult, isCacheMode: false };
    }

    // 远程获取失败，使用本地缓存
    const cached = this.readCachedAgreements();
    if (cached) {
      return { ...cached, isCacheMode: true };
    }

    // 无缓存，使用内置默认
    return { ...this.readBuiltinAgreements(), isCacheMode: true };
  }

  async fetchRemoteAgreements() {
    return new Promise((resolve) => {
      const req = https.get(AGREEMENTS_API, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.version && parsed.privacyPolicy && parsed.termsOfService) {
              resolve(parsed);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => { resolve(null); });
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  cacheAgreements(data) {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      fs.writeFileSync(path.join(this.cacheDir, 'privacy.md'), data.privacyPolicy, 'utf-8');
      fs.writeFileSync(path.join(this.cacheDir, 'terms.md'), data.termsOfService, 'utf-8');
      fs.writeFileSync(path.join(this.cacheDir, 'version.json'), JSON.stringify({
        version: data.version,
        updatedAt: data.updatedAt || null
      }), 'utf-8');
    } catch (error) {
      console.error('缓存协议失败:', error);
    }
  }

  readCachedAgreements() {
    try {
      const versionPath = path.join(this.cacheDir, 'version.json');
      const privacyPath = path.join(this.cacheDir, 'privacy.md');
      const termsPath = path.join(this.cacheDir, 'terms.md');

      if (fs.existsSync(versionPath) && fs.existsSync(privacyPath) && fs.existsSync(termsPath)) {
        const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
        const privacyPolicy = fs.readFileSync(privacyPath, 'utf-8');
        const termsOfService = fs.readFileSync(termsPath, 'utf-8');
        return {
          version: versionData.version,
          updatedAt: versionData.updatedAt || null,
          privacyPolicy,
          termsOfService
        };
      }
    } catch (error) {
      console.error('读取缓存协议失败:', error);
    }
    return null;
  }

  readBuiltinAgreements() {
    try {
      const versionData = JSON.parse(
        fs.readFileSync(path.join(this.appPath, 'resources', 'agreements', 'version.json'), 'utf-8')
      );
      const privacyPolicy = fs.readFileSync(
        path.join(this.appPath, 'resources', 'agreements', 'privacy.md'), 'utf-8'
      );
      const termsOfService = fs.readFileSync(
        path.join(this.appPath, 'resources', 'agreements', 'terms.md'), 'utf-8'
      );
      return {
        version: versionData.version,
        updatedAt: versionData.updatedAt || null,
        privacyPolicy,
        termsOfService
      };
    } catch (error) {
      console.error('读取内置协议失败:', error);
      return {
        version: 0,
        updatedAt: null,
        privacyPolicy: '# 隐私协议\n\n暂无法加载协议内容，请检查网络连接后重启应用。',
        termsOfService: '# 使用协议\n\n暂无法加载协议内容，请检查网络连接后重启应用。'
      };
    }
  }

  acceptAgreement(version) {
    // 由渲染进程通过 localStorage 存储，主进程只返回确认
    return { success: true, acceptedVersion: version };
  }
}

module.exports = AgreementManager;
