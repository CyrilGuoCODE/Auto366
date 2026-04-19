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

  // 获取天学网缓存路径（从 mainWindow 的 localStorage 读取）
  async getCachePath(mainWindow) {
    try {
      const cachePath = await mainWindow.webContents.executeJavaScript(`
        localStorage.getItem('cache-path') || 'D:\\Up366StudentFiles'
      `);
      return cachePath;
    } catch (error) {
      console.error('获取缓存路径失败，使用默认值:', error);
      return null;
    }
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
      console.log('开始清理Auto366缓存，tempDir:', this.tempDir);
      
      if (!fs.existsSync(this.tempDir)) {
        console.log('temp目录不存在');
        return { success: true, filesDeleted: 0, dirsDeleted: 0 };
      }

      const shouldKeepCache = await mainWindow.webContents.executeJavaScript(`
        localStorage.getItem('keep-cache-files') === 'true'
      `);

      console.log('shouldKeepCache:', shouldKeepCache);

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
        console.log('统计完成 - filesDeleted:', filesDeleted, 'dirsDeleted:', dirsDeleted);
        
        // 使用 fs-extra 的 removeSync 同步删除，更可靠
        fs.removeSync(this.tempDir);
        console.log('temp目录已删除');
        
        // 重新创建目录
        await fs.mkdirp(this.tempDir);
        console.log('temp目录已重新创建');
      }

      return { success: true, filesDeleted, dirsDeleted };
    } catch (error) {
      console.error('清理缓存失败:', error);
      return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
    }
  }

  // 清理天学网缓存
  async removeCacheFile(mainWindow) {
    let filesDeleted = 0;
    let dirsDeleted = 0;

    try {
      // 从 localStorage 获取用户设置的缓存路径
      const cachePath = await this.getCachePath(mainWindow);
      
      if (!cachePath || !fs.existsSync(cachePath)) {
        console.log('天学网缓存目录不存在:', cachePath);
        return { success: true, filesDeleted: 0, dirsDeleted: 0 };
      }

      console.log('开始清理天学网缓存，cachePath:', cachePath);

      const flipbooksPath = path.join(cachePath, 'flipbooks');
      const homeworkPath = path.join(cachePath, 'homework');
      const resourcesPath = path.join(cachePath, 'resources');

      // 统计并删除子目录
      const countAndDelete = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          const countItems = (currentPath) => {
            if (fs.existsSync(currentPath)) {
              const stats = fs.statSync(currentPath);
              if (stats.isDirectory()) {
                const items = fs.readdirSync(currentPath);
                for (const item of items) {
                  const itemPath = path.join(currentPath, item);
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

          countItems(dirPath);
          console.log(`删除目录: ${dirPath}`);
          fs.rmSync(dirPath, { recursive: true, force: true });
          // 重新创建空目录
          fs.mkdirSync(dirPath, { recursive: true });
        }
      };

      countAndDelete(flipbooksPath);
      countAndDelete(homeworkPath);
      countAndDelete(resourcesPath);

      console.log('统计完成 - filesDeleted:', filesDeleted, 'dirsDeleted:', dirsDeleted);

      return { success: true, filesDeleted, dirsDeleted };
    } catch (error) {
      console.error('清理天学网缓存失败:', error);
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

    ipcMain.handle('remove-cache-file', async (event, args) => {
      try {
        // 获取 mainWindow（从 event.sender 获取）
        const { BrowserWindow } = require('electron');
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) {
          return { success: false, error: '无法获取主窗口', filesDeleted: 0, dirsDeleted: 0 };
        }
        return await this.removeCacheFile(win);
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
