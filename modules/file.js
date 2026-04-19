const { dialog, app, ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

class FileManager {
  constructor(appPath) {
    this.appPath = appPath || process.cwd();
    this.cacheDir = path.join(os.homedir(), '.Auto366', 'cache');
    this.tempDir = path.join(this.appPath, 'temp');
    this.fileDir = path.join(this.appPath, 'file');
    this.ensureDirectories();
  }

  // 确保目录存在
  ensureDirectories() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  // 打开文件选择对话框
  async openFileDialog(options = {}) {
    try {
      const defaultOptions = {
        properties: ['openFile'],
        filters: [
          { name: 'All Files', extensions: ['*'] }
        ]
      };

      const dialogOptions = { ...defaultOptions, ...options };
      const { canceled, filePaths } = await dialog.showOpenDialog(dialogOptions);

      if (canceled) {
        return null;
      }

      return filePaths[0];
    } catch (error) {
      console.error('打开文件对话框失败:', error);
      return null;
    }
  }

  // 打开目录选择对话框
  async openDirectoryDialog() {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
      });

      if (canceled) {
        return null;
      }

      return filePaths[0];
    } catch (error) {
      console.error('打开目录对话框失败:', error);
      return null;
    }
  }

  // 保存文件对话框
  async saveFileDialog(options = {}) {
    try {
      const defaultOptions = {
        filters: [
          { name: 'All Files', extensions: ['*'] }
        ]
      };

      const dialogOptions = { ...defaultOptions, ...options };
      const { canceled, filePath } = await dialog.showSaveDialog(dialogOptions);

      if (canceled) {
        return null;
      }

      return filePath;
    } catch (error) {
      console.error('保存文件对话框失败:', error);
      return null;
    }
  }

  // 下载文件
  downloadFile(url, savePath) {
    return new Promise((resolve, reject) => {
      try {
        const protocol = url.startsWith('https') ? https : http;
        const fileName = path.basename(url);
        const destination = savePath || path.join(this.cacheDir, fileName);

        const file = fs.createWriteStream(destination);
        let downloadedSize = 0;
        let totalSize = 0;

        protocol.get(url, (response) => {
          totalSize = parseInt(response.headers['content-length'], 10);

          response.pipe(file);

          response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            if (this.onDownloadProgress) {
              this.onDownloadProgress({
                percent: Math.floor((downloadedSize / totalSize) * 100),
                bytesPerSecond: 0,
                total: totalSize,
                transferred: downloadedSize
              });
            }
          });

          file.on('finish', () => {
            file.close();
            resolve(destination);
          });

        }).on('error', (error) => {
          fs.unlinkSync(destination);
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  // 上传文件
  uploadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      try {
        const fs = require('fs');
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));

        const protocol = url.startsWith('https') ? https : http;
        const urlObj = new URL(url);

        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (url.startsWith('https') ? 443 : 80),
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            ...form.getHeaders()
          }
        };

        const req = protocol.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              resolve({ success: false, error: '解析响应失败' });
            }
          });
        });

        form.pipe(req);

        req.on('error', (error) => {
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  // 读取文件
  readFile(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      console.error('读取文件失败:', error);
      return null;
    }
  }

  // 写入文件
  writeFile(filePath, content) {
    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, content);
      return true;
    } catch (error) {
      console.error('写入文件失败:', error);
      return false;
    }
  }

  // 复制文件
  copyFile(source, destination) {
    try {
      // 确保目标目录存在
      const dir = path.dirname(destination);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.copyFileSync(source, destination);
      return true;
    } catch (error) {
      console.error('复制文件失败:', error);
      return false;
    }
  }

  // 删除文件
  deleteFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (error) {
      console.error('删除文件失败:', error);
      return false;
    }
  }

  // 清理Auto366缓存（temp目录）
  async clearCache(mainWindow) {
    let filesDeleted = 0;
    let dirsDeleted = 0;

    try {
      if (!fs.existsSync(this.tempDir)) {
        return { success: true, filesDeleted: 0, dirsDeleted: 0 };
      }

      const shouldKeepCache = await mainWindow.webContents.executeJavaScript(`
        localStorage.getItem('keep-cache-files') === 'true'
      `);

      if (!shouldKeepCache) {
        const countItems = (dirPath) => {
          if (fs.existsSync(dirPath)) {
            const stats = fs.statSync(dirPath);
            if (stats.isDirectory()) {
              const items = fs.readdirSync(dirPath);
              for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const itemStats = fs.statSync(itemPath);
                if (itemStats.isDirectory()) {
                  countItems(itemPath);
                } else {
                  filesDeleted++;
                }
              }
              dirsDeleted++;
            } else {
              filesDeleted++;
            }
          }
        };

        countItems(this.tempDir);
        await fs.remove(this.tempDir);
        await fs.mkdirp(this.tempDir);
      }

      return { success: true, filesDeleted, dirsDeleted };
    } catch (error) {
      return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
    }
  }

  // 清理天学网缓存（file目录）
  async removeCacheFile() {
    let filesDeleted = 0;
    let dirsDeleted = 0;

    try {
      if (!fs.existsSync(this.fileDir)) {
        return { success: true, filesDeleted: 0, dirsDeleted: 0 };
      }

      const countItems = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          const stats = fs.statSync(dirPath);
          if (stats.isDirectory()) {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
              const itemPath = path.join(dirPath, item);
              const itemStats = fs.statSync(itemPath);
              if (itemStats.isDirectory()) {
                countItems(itemPath);
              } else {
                filesDeleted++;
              }
            }
            dirsDeleted++;
          } else {
            filesDeleted++;
          }
        }
      };

      countItems(this.fileDir);
      await fs.remove(this.fileDir);
      await fs.mkdirp(this.fileDir);

      return { success: true, filesDeleted, dirsDeleted };
    } catch (error) {
      return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
    }
  }

  // 注册 IPC 处理器
  registerIpcHandlers(mainWindow) {
    ipcMain.handle('clear-cache', async () => {
      try {
        return await this.clearCache(mainWindow);
      } catch (error) {
        return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
      }
    });

    ipcMain.handle('remove-cache-file', async () => {
      try {
        return await this.removeCacheFile();
      } catch (error) {
        return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
      }
    });
  }

  // 删除目录
  deleteDirectory(dir) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          this.deleteDirectory(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      }
      fs.rmdirSync(dir);
    } catch (error) {
      console.error('删除目录失败:', error);
    }
  }

  // 注册事件监听器
  on(event, callback) {
    if (event === 'downloadProgress') {
      this.onDownloadProgress = callback;
    }
  }
}

module.exports = FileManager;
