const { app, dialog, shell } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

class UpdateManager {
  constructor() {
    this.currentVersion = app.getVersion();
    this.updateUrl = 'https://366.cyril.qzz.io/api/update';
    this.downloadUrl = 'https://366.cyril.qzz.io/download';
  }

  // 检查更新
  checkForUpdates() {
    return new Promise((resolve) => {
      try {
        // 开发环境不检查更新
        if (app.isDev) {
          resolve({ hasUpdate: false, isDev: true });
          return;
        }

        const options = {
          hostname: '366.cyril.qzz.io',
          port: 443,
          path: '/api/update?version=' + this.currentVersion,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const req = https.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              // 检查响应是否为有效的JSON
              if (!data || typeof data !== 'string') {
                throw new Error('无效的响应数据');
              }
              
              // 尝试解析JSON
              const result = JSON.parse(data);
              
              if (result.success && result.hasUpdate) {
                resolve({
                  hasUpdate: true,
                  version: result.version,
                  releaseNotes: result.releaseNotes,
                  downloadUrl: result.downloadUrl
                });
              } else {
                resolve({ hasUpdate: false, message: result.message || '当前已是最新版本' });
              }
            } catch (error) {
              // 静默处理非 JSON 响应，避免控制台错误信息干扰用户
              // 服务器可能返回 "API endpoint not found" 等非 JSON 数据
              resolve({ hasUpdate: false, error: '解析更新信息失败' });
            }
          });
        });

        req.on('error', (error) => {
          console.error('检查更新失败:', error);
          resolve({ hasUpdate: false, error: '检查更新失败' });
        });

        req.end();

      } catch (error) {
        console.error('检查更新失败:', error);
        resolve({ hasUpdate: false, error: '检查更新失败' });
      }
    });
  }

  // 下载更新
  downloadUpdate(version) {
    return new Promise((resolve, reject) => {
      try {
        const platform = os.platform();
        let filename = '';

        switch (platform) {
          case 'win32':
            filename = `Auto366-${version}-win.exe`;
            break;
          case 'darwin':
            filename = `Auto366-${version}-mac.dmg`;
            break;
          case 'linux':
            filename = `Auto366-${version}-linux.AppImage`;
            break;
          default:
            reject(new Error('不支持的平台'));
            return;
        }

        const downloadUrl = `${this.downloadUrl}/${filename}`;
        const downloadPath = path.join(os.tmpdir(), filename);

        console.log(`开始下载更新: ${downloadUrl}`);

        const file = fs.createWriteStream(downloadPath);
        https.get(downloadUrl, (response) => {
          const totalSize = parseInt(response.headers['content-length'], 10);
          let downloadedSize = 0;

          response.pipe(file);

          response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            const progress = Math.floor((downloadedSize / totalSize) * 100);
            
            // 发送下载进度
            if (this.onDownloadProgress) {
              this.onDownloadProgress({
                percent: progress,
                bytesPerSecond: 0, // 简化处理
                total: totalSize,
                transferred: downloadedSize
              });
            }
          });

          file.on('finish', () => {
            file.close();
            console.log(`更新下载完成: ${downloadPath}`);
            resolve(downloadPath);
          });

        }).on('error', (error) => {
          fs.unlinkSync(downloadPath);
          console.error('下载更新失败:', error);
          reject(new Error('下载更新失败'));
        });

      } catch (error) {
        console.error('下载更新失败:', error);
        reject(new Error('下载更新失败'));
      }
    });
  }

  // 安装更新
  installUpdate(downloadPath) {
    try {
      const platform = os.platform();

      switch (platform) {
        case 'win32':
          // Windows系统
          execSync(`"${downloadPath}" /S`, { detached: true, stdio: 'ignore' });
          break;
        case 'darwin':
          // macOS系统
          execSync(`open "${downloadPath}"`, { detached: true, stdio: 'ignore' });
          break;
        case 'linux':
          // Linux系统
          execSync(`chmod +x "${downloadPath}" && "${downloadPath}"`, { detached: true, stdio: 'ignore' });
          break;
        default:
          throw new Error('不支持的平台');
      }

      // 退出应用
      app.quit();

    } catch (error) {
      console.error('安装更新失败:', error);
      throw new Error('安装更新失败');
    }
  }

  // 手动检查更新
  async checkForUpdatesManually() {
    try {
      const result = await this.checkForUpdates();
      
      if (result.hasUpdate) {
        const options = {
          type: 'info',
          title: '发现新版本',
          message: `发现新版本 ${result.version}，是否立即下载？`,
          detail: result.releaseNotes || '性能优化和错误修复',
          buttons: ['立即下载', '稍后提醒']
        };

        const { response } = await dialog.showMessageBox(options);
        if (response === 0) {
          // 立即下载
          const downloadPath = await this.downloadUpdate(result.version);
          this.installUpdate(downloadPath);
        }
      } else {
        const options = {
          type: 'info',
          title: '检查更新',
          message: result.message || '当前已是最新版本',
          buttons: ['确定']
        };

        await dialog.showMessageBox(options);
      }

    } catch (error) {
      console.error('手动检查更新失败:', error);
      const options = {
        type: 'error',
        title: '检查更新失败',
        message: '检查更新失败，请检查网络连接',
        buttons: ['确定']
      };

      await dialog.showMessageBox(options);
    }
  }

  // 注册事件监听器
  on(event, callback) {
    if (event === 'downloadProgress') {
      this.onDownloadProgress = callback;
    }
  }
}

module.exports = UpdateManager;
