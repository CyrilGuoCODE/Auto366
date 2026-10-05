const moduleLog = require('../logging').create('文件');
const { dialog, app } = require('electron');
const ipcMain = require('../register').forModule('file');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class FileManager {
  constructor(appPath) {
    this.appPath = appPath || process.cwd();
    this.cacheDir = path.join(os.homedir(), '.Auto366', 'cache');
    this.tempDir = path.join(this.appPath, 'temp');
    this.ensureDirectories();
  }

  // 确保目录存在
  ensureDirectories() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  // 获取天学网缓存路径（由 config 统一读取，参数保留用于兼容旧调用）
  async getCachePath(mainWindow) {
    try {
      const cachePath = require('../config').get('cache-path', '');
      return cachePath || null;
    } catch (error) {
      moduleLog.error('获取缓存路径失败:', error);
      return null;
    }
  }

  // 统计目录中的文件和目录数量
  async countItems(dirPath) {
    let files = 0;
    let dirs = 0;
    if (!await fs.pathExists(dirPath)) return { files, dirs };
    const traverse = async (currentPath) => {
      const stats = await fs.lstat(currentPath);
      if (stats.isSymbolicLink()) return;
      if (stats.isDirectory()) {
        dirs++;
        const items = await fs.readdir(currentPath);
        for (const item of items) {
          await traverse(path.join(currentPath, item));
        }
      } else {
        files++;
      }
    };
    await traverse(dirPath);
    return { files, dirs };
  }

  // 合并清理所有缓存（Auto366 temp + 天学网缓存）
  async clearAllCache(mainWindow) {
    let totalFiles = 0;
    let totalDirs = 0;
    const results = [];

    try {
      // 1. 清理 Auto366 temp 目录
      if (await fs.pathExists(this.tempDir)) {
        const shouldKeepCache = (require('../config').get('keep-cache-files') === 'true');

        if (!shouldKeepCache) {
          const count = await this.countItems(this.tempDir);
          totalFiles += count.files;
          totalDirs += count.dirs;
          await fs.remove(this.tempDir);
          await fs.mkdirp(this.tempDir);
          results.push('Auto366 缓存已清理');
        } else {
          results.push('Auto366 缓存保留模式已启用，跳过清理');
        }
      }

      // 2. 清理天学网缓存目录
      const cachePath = await this.getCachePath(mainWindow);
      if (cachePath && await fs.pathExists(cachePath)) {
        const subDirs = ['flipbooks', 'homework', 'resources'];
        for (const subDir of subDirs) {
          const itemPath = path.join(cachePath, subDir);
          if (!await fs.pathExists(itemPath)) continue;

          const stat = await fs.lstat(itemPath);
          if (stat.isSymbolicLink()) { results.push(`跳过链接目录：${subDir}`); continue; }
          if (stat.isDirectory()) {
            const count = await this.countItems(itemPath);
            totalFiles += count.files;
            totalDirs += count.dirs;
            // 清空目录内容而非删除目录本身
            const items = await fs.readdir(itemPath);
            for (const item of items) {
              const fullPath = path.join(itemPath, item);
              await fs.rm(fullPath, { recursive: true, force: true });
            }
          } else {
            // 是文件而非目录，直接删除
            await fs.unlink(itemPath);
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
      moduleLog.error('打开文件对话框失败:', error);
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
      moduleLog.error('打开目录对话框失败:', error);
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
      moduleLog.error('保存文件对话框失败:', error);
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
      moduleLog.error('写入文件失败:', error);
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

      if (!await fs.pathExists(initAudioPath)) {
        return { success: false, error: 'init.mp3 文件不存在于 resources 目录' };
      }

      if (!await fs.pathExists(flipbooksPath)) {
        return { success: false, error: 'flipbooks 目录不存在' };
      }
      if ((await fs.lstat(flipbooksPath)).isSymbolicLink()) return { success: false, error: '音频目录不能是链接目录' };

      const initAudioBuffer = await fs.readFile(initAudioPath);
      let replacedCount = 0;
      const directories = new Set();

      // 递归遍历并替换
      const traverseAndReplace = async (dirPath) => {
        const items = await fs.readdir(dirPath);
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const stat = await fs.lstat(fullPath);
          if (stat.isSymbolicLink()) continue;

          if (stat.isDirectory()) {
            directories.add(fullPath);
            await traverseAndReplace(fullPath);
          } else if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase();
            if (ext === '.mp3') {
              await fs.writeFile(fullPath, initAudioBuffer);
              replacedCount++;
            }
          }
        }
      };

      await traverseAndReplace(flipbooksPath);

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
      moduleLog.error('音频替换失败:', error);
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
          if (await fs.pathExists(drive)) {
            const stats = await fs.stat(drive);
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
          if (await fs.pathExists(searchTarget)) {
            const stats = await fs.stat(searchTarget);
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
  registerIpcHandlers(mainWindow) {
    const chooseDirectory = () => this.openDirectoryDialog();
    ipcMain.handle('open-directory-choosing', chooseDirectory);
    require('../register').forModule('app', { legacy: false }).handle('open-directory-choosing', chooseDirectory);
    const chooseFile = async () => {
      const filePath = await this.openFileDialog({
        properties: ['openFile'],
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
          { name: 'Videos', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv'] },
          { name: 'Archives', extensions: ['zip', 'rar', '7z', 'tar', 'gz'] },
          { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf'] },
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'XML Files', extensions: ['xml'] },
          { name: 'HTML Files', extensions: ['html', 'htm'] },
        ],
      });
      if (filePath && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('choose-file', filePath);
    };
    ipcMain.on('open-file-choosing', chooseFile);
    require('../register').forModule('app', { legacy: false }).on('open-file-choosing', chooseFile);

    ipcMain.handle('set-cache-path', (event, newPath) => {
      try {
        if (typeof newPath !== 'string' || !path.isAbsolute(newPath)) return 0;
        const normalizedPath = path.resolve(newPath);
        fs.ensureDirSync(normalizedPath);
        require('../config').set('cache-path', normalizedPath);
        return 1;
      } catch (error) {
        return 0;
      }
    });

    ipcMain.handle('clear-cache', async () => {
      try {
        return await this.clearAllCache(mainWindow);
      } catch (error) {
        return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
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
