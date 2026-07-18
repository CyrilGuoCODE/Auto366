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

  // 获取天学网缓存路径（从 mainWindow 的 localStorage 读取）
  async getCachePath(mainWindow) {
    try {
      const cachePath = await mainWindow.webContents.executeJavaScript(`
        localStorage.getItem('cache-path') || ''
      `);
      return cachePath || null;
    } catch (error) {
      console.error('获取缓存路径失败:', error);
      return null;
    }
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
          const itemPath = path.join(cachePath, subDir);
          if (!fs.existsSync(itemPath)) continue;

          const stat = fs.statSync(itemPath);
          if (stat.isDirectory()) {
            const count = this.countItems(itemPath);
            totalFiles += count.files;
            totalDirs += count.dirs;
            // 清空目录内容而非删除目录本身
            const items = fs.readdirSync(itemPath);
            for (const item of items) {
              const fullPath = path.join(itemPath, item);
              fs.rmSync(fullPath, { recursive: true, force: true });
            }
          } else {
            // 是文件而非目录，直接删除
            fs.unlinkSync(itemPath);
            totalFiles++;
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

  // 替换音频文件（批量替换 flipbooks 目录下的所有 MP3 文件）
  async replaceAudioFiles(mainWindow) {
    try {
      const cachePath = await this.getCachePath(mainWindow);
      if (!cachePath) {
        return { success: false, error: '未找到缓存路径' };
      }

      const flipbooksPath = path.join(cachePath, 'flipbooks');

      let initAudioPath;
      if (app && app.isPackaged) {
        initAudioPath = path.join(process.resourcesPath, 'init.mp3');
      } else {
        initAudioPath = path.join(this.appPath, 'resources', 'init.mp3');
      }

      if (!fs.existsSync(initAudioPath)) {
        return { success: false, error: 'init.mp3 文件不存在于 resources 目录' };
      }

      if (!fs.existsSync(flipbooksPath)) {
        return { success: false, error: 'flipbooks 目录不存在' };
      }

      const initAudioBuffer = fs.readFileSync(initAudioPath);
      let replacedCount = 0;
      const directories = new Set();

      // 递归遍历并替换
      const traverseAndReplace = (dirPath) => {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            directories.add(fullPath);
            traverseAndReplace(fullPath);
          } else if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase();
            if (ext === '.mp3') {
              fs.writeFileSync(fullPath, initAudioBuffer);
              replacedCount++;
            }
          }
        }
      };

      traverseAndReplace(flipbooksPath);

      if (replacedCount === 0) {
        return { success: true, message: '未找到需要替换的音频文件', replacedCount: 0, directoryCount: directories.size };
      }

      return {
        success: true,
        message: `音频替换成功 - 已替换 ${replacedCount} 个文件，${directories.size} 个目录`,
        replacedCount,
        directoryCount: directories.size
      };
    } catch (error) {
      console.error('音频替换失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 自动寻找 Up366StudentFiles 文件夹
  async autoFindCacheDir() {
    try {
      const drives = [];
      for (let i = 67; i <= 90; i++) {
        const drive = String.fromCharCode(i) + ':\\';
        try {
          if (fs.existsSync(drive)) {
            const stats = fs.statSync(drive);
            if (stats.isDirectory()) {
              drives.push(drive);
            }
          }
        } catch (e) {
          // 忽略无效驱动器
        }
      }

      const foundPaths = [];
      for (const drive of drives) {
        try {
          const searchTarget = path.join(drive, 'Up366StudentFiles');
          if (fs.existsSync(searchTarget)) {
            const stats = fs.statSync(searchTarget);
            if (stats.isDirectory()) {
              foundPaths.push(searchTarget);
            }
          }
        } catch (e) {
          // 忽略访问失败的驱动器
        }
      }

      if (foundPaths.length === 1) {
        return { success: true, path: foundPaths[0] };
      } else {
        return { success: false, count: foundPaths.length, paths: foundPaths };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // 注册 IPC 处理器
  registerIpcHandlers(mainWindow, windowManager) {
    ipcMain.handle('clear-cache', async () => {
      try {
        return await this.clearAllCache(mainWindow);
      } catch (error) {
        return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
      }
    });

    ipcMain.handle('export-answers-pdf', async (e, htmlContent) => {
      try {
        if (!windowManager) {
          return { success: false, error: '窗口管理器未初始化' };
        }

        const pdfResult = await windowManager.exportHtmlToPdf(htmlContent);
        if (!pdfResult.success) {
          return { success: false, error: pdfResult.error };
        }

        const filePath = await this.saveFileDialog({
          defaultPath: `answers_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`,
          filters: [
            { name: 'PDF Files', extensions: ['pdf'] }
          ]
        });

        if (!filePath) {
          return { success: false, error: '用户取消保存' };
        }

        const writeOk = this.writeFile(filePath, pdfResult.pdfBuffer);
        if (!writeOk) {
          return { success: false, error: '写入 PDF 文件失败' };
        }

        return { success: true, filePath };
      } catch (error) {
        console.error('导出 PDF 失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('replace-audio', async () => {
      try {
        return await this.replaceAudioFiles(mainWindow);
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('auto-find-cache-dir', async () => {
      try {
        return await this.autoFindCacheDir();
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

}

module.exports = FileManager;
