const { dialog, app, ipcMain, shell } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

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

  // 从注册表获取天学网安装路径
  getUp366Path() {
    try {
      const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\up366-2016';
      const result = execSync(`reg query "${regPath}" /v DisplayIcon`, { encoding: 'utf8' });
      const match = result.match(/DisplayIcon\s+REG_SZ\s+(.+)/);
      if (match && match[1]) {
        let exePath = match[1].trim();
        // 去除引号（如果有）
        exePath = exePath.replace(/^"|"$/g, '');
        if (fs.existsSync(exePath)) {
          return exePath;
        }
      }
      return null;
    } catch (error) {
      console.error('读取天学网注册表路径失败:', error);
      return null;
    }
  }

  // 一键打开天学网
  async openUp366() {
    const up366Path = this.getUp366Path();
    if (up366Path) {
      try {
        await shell.openPath(up366Path);
        return { success: true, path: up366Path };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: '未找到天学网安装路径' };
  }

  // 统计目录中的文件和目录数量
  countItems(dirPath) {
    let files = 0;
    let dirs = 0;
    if (!fs.existsSync(dirPath)) return { files, dirs };
    const traverse = (currentPath) => {
      const stats = fs.statSync(currentPath);
      if (stats.isDirectory()) {
        dirs++;
        const items = fs.readdirSync(currentPath);
        for (const item of items) {
          traverse(path.join(currentPath, item));
        }
      } else {
        files++;
      }
    };
    traverse(dirPath);
    return { files, dirs };
  }

  // 合并清理所有缓存（Auto366 temp + 天学网缓存）
  async clearAllCache(mainWindow) {
    let totalFiles = 0;
    let totalDirs = 0;
    const results = [];

    try {
      // 1. 清理 Auto366 temp 目录
      if (fs.existsSync(this.tempDir)) {
        const shouldKeepCache = await mainWindow.webContents.executeJavaScript(`
          localStorage.getItem('keep-cache-files') === 'true'
        `);

        if (!shouldKeepCache) {
          const count = this.countItems(this.tempDir);
          totalFiles += count.files;
          totalDirs += count.dirs;
          fs.removeSync(this.tempDir);
          await fs.mkdirp(this.tempDir);
          results.push('Auto366 缓存已清理');
        } else {
          results.push('Auto366 缓存保留模式已启用，跳过清理');
        }
      }

      // 2. 清理天学网缓存目录
      const cachePath = await this.getCachePath(mainWindow);
      if (cachePath && fs.existsSync(cachePath)) {
        const subDirs = ['flipbooks', 'homework', 'resources'];
        for (const subDir of subDirs) {
          const dirPath = path.join(cachePath, subDir);
          if (fs.existsSync(dirPath)) {
            const count = this.countItems(dirPath);
            totalFiles += count.files;
            totalDirs += count.dirs;
            fs.rmSync(dirPath, { recursive: true, force: true });
            fs.mkdirSync(dirPath, { recursive: true });
          }
        }
        results.push('天学网缓存已清理');
      }

      return {
        success: true,
        filesDeleted: totalFiles,
        dirsDeleted: totalDirs,
        messages: results
      };
    } catch (error) {
      return { success: false, error: error.message, filesDeleted: totalFiles, dirsDeleted: totalDirs };
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

  // 注册 IPC 处理器
  registerIpcHandlers(mainWindow) {
    ipcMain.handle('clear-cache', async () => {
      try {
        return await this.clearAllCache(mainWindow);
      } catch (error) {
        return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
      }
    });

    ipcMain.handle('open-up366', async () => {
      try {
        return await this.openUp366();
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

}

module.exports = FileManager;
