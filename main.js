const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const { autoUpdater } = require('electron-updater')
const fs = require('fs-extra')
const { createClient } = require('@supabase/supabase-js')

// 引入抓包代理类
const AnswerProxy = require('./answer-proxy');

let mainWindow
let updateInfo = null

process.on('uncaughtException', (error) => {
  if (error.code === 'ECONNRESET') {
    console.log('网络连接被重置，这可能是因为远程服务器主动关闭了连接');
    return;
  }

  console.error(error);
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason.code === 'ECONNRESET') {
    console.log('网络连接被重置，这可能是因为远程服务器主动关闭了连接');
    return;
  }
  console.error(reason);
});

// 创建抓包代理实例
let answerProxy = new AnswerProxy();

const SUPABASE_URL = 'https://myenzpblosjnrtvicdor.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15ZW56cGJsb3NqbnJ0dmljZG9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NjAxMzAsImV4cCI6MjA4MzUzNjEzMH0.XkwQ72RmH8l1_krYc_IdPXsFk5pwL5JXQ3mDZ-ax3mU'
const SUPABASE_BUCKET = 'auto366-share'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'cyrilguocode',
  repo: 'Auto366'
})

autoUpdater.autoDownload = false

autoUpdater.on('update-available', (info) => {
  updateInfo = info
  if (mainWindow && !mainWindow.isDestroyed()) {
    let releaseNotes = '新版本已发布，请更新以获得最新功能。'
    if (info.releaseNotes) {
      if (typeof info.releaseNotes === 'string') {
        releaseNotes = info.releaseNotes
      } else if (info.releaseNotes.body) {
        releaseNotes = info.releaseNotes.body
      } else if (Array.isArray(info.releaseNotes)) {
        releaseNotes = info.releaseNotes.join('\n')
      }
    }
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: releaseNotes
    })
  }
})

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-download-progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
      bytesPerSecond: progressObj.bytesPerSecond
    })
  }
})

autoUpdater.on('update-downloaded', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded')
  }
})

autoUpdater.on('error', (error) => {
  console.error('更新检查失败:', error)
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.on('update-confirm', async () => {
  if (updateInfo) {
    await autoUpdater.downloadUpdate()
  }
})

ipcMain.on('update-install', () => {
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { hasUpdate: false, isDev: true, message: '开发环境不支持自动更新' };
  }

  try {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ hasUpdate: false, message: '检查更新超时' });
      }, 20000);

      const onUpdateAvailable = (info) => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        autoUpdater.removeListener('error', onError);
        resolve({
          hasUpdate: true,
          version: info.version,
          releaseNotes: info.releaseNotes,
          releaseDate: info.releaseDate
        });
      };

      const onUpdateNotAvailable = () => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('error', onError);
        resolve({ hasUpdate: false, message: '当前已是最新版本' });
      };

      const onError = (error) => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        resolve({ hasUpdate: false, error: error.message });
      };

      autoUpdater.once('update-available', onUpdateAvailable);
      autoUpdater.once('update-not-available', onUpdateNotAvailable);
      autoUpdater.once('error', onError);

      autoUpdater.checkForUpdates().catch(error => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        autoUpdater.removeListener('error', onError);
        resolve({ hasUpdate: false, error: error.message });
      });
    });
  } catch (error) {
    console.error('检查更新失败:', error);
    return { hasUpdate: false, error: error.message };
  }
})

autoUpdater.on('update-not-available', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-not-available', {})
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: true,
    }
  })

  mainWindow.setMenu(null);

  mainWindow.loadFile('index.html')

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key === 'F12') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
      event.preventDefault();
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 所有链接都在外部浏览器打开
    shell.openExternal(url);
    return { action: 'deny' }; // 阻止在Electron中打开
  });
}

app.whenReady().then(async () => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  if (app.isPackaged) {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`
          localStorage.getItem('auto-check-updates') !== 'false'
        `).then(autoCheckEnabled => {
          if (autoCheckEnabled) {
            console.log('应用启动，开始检查更新...');
            autoUpdater.checkForUpdates().catch(error => {
              console.error('启动时检查更新失败:', error)
            });
          } else {
            console.log('自动检查更新已禁用');
          }
        }).catch(error => {
          console.error('获取自动检查更新设置失败:', error);
          console.log('获取设置失败，默认检查更新...');
          autoUpdater.checkForUpdates().catch(error => {
            console.error('默认检查更新失败:', error)
          });
        });
      }
    }, 1000)
  }
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// IPC事件处理 - 抓包代理相关
ipcMain.on('start-answer-proxy', async () => {
  await answerProxy.startProxy(mainWindow);
})

ipcMain.on('stop-answer-proxy', async () => {
  try {
    await answerProxy.stopProxy();
  } catch (error) {
    console.error('停止代理服务器失败:', error);
  }
})

// 设置代理端口
ipcMain.handle('set-proxy-port', async (event, port) => {
  try {
    answerProxy.setProxyPort(port);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取代理端口
ipcMain.handle('get-proxy-port', () => {
  return answerProxy.getProxyPort();
});

// 设置答案服务器端口
ipcMain.handle('set-bucket-port', async (event, port) => {
  try {
    answerProxy.setBucketPort(port);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取答案服务器端口
ipcMain.handle('get-bucket-port', () => {
  return answerProxy.getBucketPort();
});

// 设置答案获取开关状态
ipcMain.handle('set-answer-capture-enabled', (event, enabled) => {
  answerProxy.setAnswerCaptureEnabled(enabled);
  return { success: true };
});

// 获取答案获取开关状态
ipcMain.handle('get-answer-capture-enabled', () => {
  return answerProxy.isAnswerCaptureEnabled();
});

ipcMain.on('open-directory-choosing', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled) mainWindow.webContents.send('choose-directory', result.filePaths[0])
})

ipcMain.on('open-file-choosing', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
      { name: 'Videos', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv'] },
      { name: 'Archives', extensions: ['zip', 'rar', '7z', 'tar', 'gz'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf'] },
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'XML Files', extensions: ['xml'] },
      { name: 'HTML Files', extensions: ['html', 'htm'] }
    ]
  });
  if (!result.canceled) mainWindow.webContents.send('choose-file', result.filePaths[0])
})

ipcMain.on('open-implant-zip-choosing', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Zip Files', extensions: ['zip'] }
    ]
  });
  if (!result.canceled) mainWindow.webContents.send('choose-implant-zip', result.filePaths[0]);
})

// 响应体更改规则相关IPC处理
ipcMain.handle('get-response-rules', () => {
  try {
    const rules = answerProxy.getResponseRules();
    return rules;
  } catch (error) {
    console.error('获取响应规则失败:', error);
    return [];
  }
});

ipcMain.handle('save-response-rule', (event, rule) => {
  try {
    const success = answerProxy.saveRule(rule);
    return { success };
  } catch (error) {
    console.error('保存规则失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-response-rules', (event, rules) => {
  try {
    const success = answerProxy.saveResponseRules(rules);
    return { success };
  } catch (error) {
    console.error('保存规则失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-response-rule', (event, ruleId) => {
  try {
    const success = answerProxy.deleteRule(ruleId);
    return { success };
  } catch (error) {
    console.error('删除规则失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('toggle-response-rule', (event, ruleId, enabled) => {
  try {
    const success = answerProxy.toggleRule(ruleId, enabled);
    return { success };
  } catch (error) {
    console.error('切换规则状态失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-response-rules', async () => {
  const rules = answerProxy.getResponseRules();
  const result = await dialog.showSaveDialog({
    defaultPath: `response-rules-${new Date().toISOString().split('T')[0]}.json`,
    filters: [
      { name: 'JSON Files', extensions: ['json'] }
    ]
  });

  if (!result.canceled) {
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(rules, null, 2), 'utf-8');
      return { success: true, path: result.filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: '用户取消操作' };
});

ipcMain.handle('import-response-rules', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'JSON Files', extensions: ['json'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const rulesData = fs.readFileSync(result.filePaths[0], 'utf-8');
      const rules = JSON.parse(rulesData);

      if (Array.isArray(rules)) {
        // 为导入的规则生成新的ID
        const importedRules = rules.map(rule => ({
          ...rule,
          id: require('uuid').v4(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }));

        // 添加到现有规则中
        const currentRules = answerProxy.getResponseRules();
        answerProxy.responseRules = [...currentRules, ...importedRules];
        answerProxy.saveResponseRules();

        return { success: true, count: importedRules.length };
      } else {
        return { success: false, error: '无效的规则文件格式' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: '用户取消操作' };
});

ipcMain.handle('import-response-rules-from-data', async (event, rulesData) => {
  try {
    let rules;
    if (typeof rulesData === 'string') {
      rules = JSON.parse(rulesData);
    } else {
      rules = rulesData;
    }

    let rulesToImport = [];
    let groupToImport = null;

    if (Array.isArray(rules)) {
      // 格式1：直接是规则数组（纯JSON规则集）
      rulesToImport = rules;
    } else if (rules.group && rules.rules) {
      // 格式2：包含group和rules的对象
      groupToImport = rules.group;
      rulesToImport = rules.rules;
    } else if (rules.rules && Array.isArray(rules.rules)) {
      // 格式3：只有rules数组，没有group
      rulesToImport = rules.rules;
    } else {
      return { success: false, error: '无效的规则数据格式' };
    }

    const currentRules = answerProxy.getResponseRules();

    // 如果有规则集信息，检查并处理规则集
    if (groupToImport) {
      // 检查是否已存在相同的规则集
      const existingGroupIndex = currentRules.findIndex(rule =>
        rule.isGroup && (
          rule.communityRulesetId === groupToImport.communityRulesetId ||
          (rule.name === groupToImport.name && rule.author === groupToImport.author)
        )
      );

      if (existingGroupIndex !== -1) {
        // 如果规则集已存在，先删除旧的规则集和相关规则
        const existingGroup = currentRules[existingGroupIndex];
        const groupId = existingGroup.id;

        console.log(`发现已存在的规则集: ${existingGroup.name}，正在替换...`);

        // 删除旧的规则集和所有属于该规则集的规则
        answerProxy.responseRules = answerProxy.responseRules.filter(rule =>
          rule.id !== groupId && rule.groupId !== groupId
        );
      }

      // 添加新的规则集
      answerProxy.responseRules.push(groupToImport);

      // 为规则添加groupId
      rulesToImport.forEach(rule => {
        rule.groupId = groupToImport.id;
      });
    } else {
      // 如果没有规则集信息，检查是否有重复的独立规则
      // 这里可以根据规则的特征（如name, urlPattern等）来判断重复
      const existingRuleNames = currentRules
        .filter(rule => !rule.isGroup && rule.name)
        .map(rule => rule.name);

      const originalCount = rulesToImport.length;
      rulesToImport = rulesToImport.filter(rule => {
        if (rule.name && existingRuleNames.includes(rule.name)) {
          console.log(`跳过重复规则: ${rule.name}`);
          return false;
        }
        return true;
      });

      if (originalCount > rulesToImport.length) {
        console.log(`过滤了 ${originalCount - rulesToImport.length} 个重复规则`);
      }
    }

    // 添加规则
    answerProxy.responseRules = [...answerProxy.responseRules, ...rulesToImport];
    answerProxy.saveResponseRules();

    return { success: true, count: rulesToImport.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-cache', async () => {
  try {
    const result = await answerProxy.clearCache();
    return result;
  } catch (error) {
    return { success: false, error: error.message, filesDeleted: 0, dirsDeleted: 0 };
  }
});

ipcMain.handle('import-implant-zip', async (event, sourcePath) => {
  try {
    return await answerProxy.importZipToDir(sourcePath);
  } catch (error) {
    console.error('导入压缩包失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('download-and-import-injection-package', async (event, arrayBuffer, rulesetName) => {
  try {
    const buffer = Buffer.from(arrayBuffer);
    const tempPath = path.join(require('os').tmpdir(), `injection_${Date.now()}.zip`);

    // 保存到临时文件
    fs.writeFileSync(tempPath, buffer);

    // 导入注入包
    const result = await answerProxy.importZipToDir(tempPath);

    // 清理临时文件
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {
      console.warn('清理临时文件失败:', error);
    }

    return result;
  } catch (error) {
    console.error('下载并导入注入包失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('download-and-save-injection-package', async (event, arrayBuffer, originalFileName, rulesetName) => {
  try {
    const buffer = Buffer.from(arrayBuffer);

    // 确保文件名安全，但保持原始文件名
    const safeFileName = originalFileName.replace(/[<>:"/\\|?*]/g, '_');

    // 创建保存目录（在应用运行目录下的file文件夹）
    const appDir = path.dirname(process.execPath);
    const fileDir = path.join(appDir, 'file');

    // 如果是开发环境，使用当前工作目录
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const targetDir = isDev ? path.join(process.cwd(), 'file') : fileDir;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 保存文件
    const localPath = path.join(targetDir, safeFileName);
    fs.writeFileSync(localPath, buffer);

    console.log(`注入包已保存到: ${localPath}`);

    return {
      success: true,
      localPath: localPath,
      originalFileName: safeFileName
    };
  } catch (error) {
    console.error('下载并保存注入包失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('download-and-save-injection-package-with-md5', async (event, arrayBuffer, fileName, rulesetName, newFileMD5) => {
  try {
    const crypto = require('crypto');
    const buffer = Buffer.from(arrayBuffer);

    const appDir = path.dirname(process.execPath);
    const fileDir = path.join(appDir, 'file');

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const targetDir = isDev ? path.join(process.cwd(), 'file') : fileDir;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = path.join(targetDir, fileName);
    let finalFileName = fileName;
    let finalPath = targetPath;

    if (fs.existsSync(targetPath)) {

      const existingBuffer = fs.readFileSync(targetPath);
      const existingMD5 = crypto.createHash('sha256').update(existingBuffer).digest('hex');

      if (existingMD5 === newFileMD5) {
        console.log(`文件已存在且内容相同，跳过下载: ${fileName}`);
        return {
          success: true,
          skipped: true,
          localPath: targetPath,
          finalFileName: fileName
        };
      } else {
        const nameWithoutExt = path.parse(fileName).name;
        const ext = path.parse(fileName).ext;
        const timestamp = Date.now();
        finalFileName = `${nameWithoutExt}_${timestamp}${ext}`;
        finalPath = path.join(targetDir, finalFileName);

        console.log(`检测到重名文件但内容不同，重命名为: ${finalFileName}`);
      }
    }

    fs.writeFileSync(finalPath, buffer);

    console.log(`注入包已保存到: ${finalPath}`);

    return {
      success: true,
      renamed: finalFileName !== fileName,
      localPath: finalPath,
      finalFileName: finalFileName
    };
  } catch (error) {
    console.error('下载并保存注入包失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('download-file', async (event, uuid) => {
  let traffic = answerProxy.getTrafficByUuid(uuid)
  if (!traffic) return 0;
  let extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.txt`;
  if (traffic.contentType) {
    if (traffic.contentType.includes('json')) {
      extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.json`;
    } else if (traffic.contentType.includes('html')) {
      extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.html`;
    } else if (traffic.contentType.includes('xml')) {
      extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.xml`;
    } else if (traffic.contentType.includes('javascript')) {
      extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.js`;
    } else if (traffic.contentType.includes('css')) {
      extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.css`;
    } else if (traffic.contentType.includes('image')) {
      extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.png`;
    } else if (traffic.contentType.includes('octet-stream')) {
      extension = traffic.responseBody;
    }
  }
  const result = await dialog.showSaveDialog({ defaultPath: extension });
  if (result.canceled) return -1;
  try {
    await answerProxy.downloadFileByUuid(uuid, result.filePath)
    return 1;
  } catch (error) {
    console.error('下载文件失败:', error);
    return 0;
  }
});

ipcMain.handle('share-answer-file', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }

    const fileName = path.basename(filePath);
    const fileExtension = path.extname(fileName);
    const timestamp = Date.now();
    const randomId = require('uuid').v4().substring(0, 8);
    const uniqueFileName = `${timestamp}_${randomId}${fileExtension}`;

    const fileBuffer = fs.readFileSync(filePath);

    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(uniqueFileName, fileBuffer, {
        contentType: 'application/json',
        upsert: false
      });

    if (error) {
      console.error('Supabase 上传错误:', error);
      return {
        success: false,
        error: `上传失败: ${error.message}`
      };
    }

    const { data: urlData } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(uniqueFileName);

    if (!urlData || !urlData.publicUrl) {
      return {
        success: false,
        error: '获取下载链接失败'
      };
    }

    return {
      success: true,
      fileId: data.path,
      downloadUrl: urlData.publicUrl
    };
  } catch (error) {
    console.error('分享答案文件失败:', error);
    return {
      success: false,
      error: error.message || '上传失败'
    };
  }
});