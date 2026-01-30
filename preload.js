const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')

// 这些路径将在 setCachePath 函数中根据缓存路径设置
let resourcePath = 'D:\\Up366StudentFiles\\resources\\'
let flipbooksPath = 'D:\\Up366StudentFiles\\flipbooks\\'

function deleteDirectoryRecursively(dirPath) {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath)

    for (const file of files) {
      const curPath = path.join(dirPath, file)
      const stats = fs.statSync(curPath)

      if (stats.isDirectory()) {
        deleteDirectoryRecursively(curPath)
      } else {
        fs.unlinkSync(curPath)
      }
    }

    fs.rmdirSync(dirPath)
  }
}

function replaceMp3FilesSync(folder, audioFile) {
  const files = fs.readdirSync(folder, { withFileTypes: true })
  let replacedCount = 0

  for (const file of files) {
    const fullPath = path.join(folder, file.name)

    if (file.isDirectory()) {
      replacedCount += replaceMp3FilesSync(fullPath, audioFile)
    } else if (file.isFile() && path.extname(file.name).toLowerCase() === '.mp3') {
      const newPath = path.join(folder, file.name)
      const backupsPath = path.join(folder, file.name + '_1')
      fs.copyFileSync(newPath, backupsPath)
      fs.copyFileSync(audioFile, newPath)
      replacedCount++
    }
  }

  return replacedCount
}

function restoreMp3FilesSync(folder) {
  const files = fs.readdirSync(folder, { withFileTypes: true })
  let restoredCount = 0

  for (const file of files) {
    const fullPath = path.join(folder, file.name)

    if (file.isDirectory()) {
      restoredCount += restoreMp3FilesSync(fullPath)
    } else if (file.isFile() && path.extname(file.name).toLowerCase() === '.mp3_1') {
      const backupsPath = path.join(folder, file.name)
      const oldPath = path.join(folder, file.name.replace('_1', ''))
      fs.copyFileSync(backupsPath, oldPath)
      fs.unlinkSync(backupsPath)
      restoredCount++
    }
  }

  return restoredCount
}

contextBridge.exposeInMainWorld('electronAPI', {
  checkFirst: () => {
    if (!fs.existsSync(resourcePath)) return null
    return fs.readdirSync(resourcePath)
  },
  checkSecond: (initialFiles) => {
    const currentFiles = fs.readdirSync(resourcePath)
    const append = currentFiles.filter(file => !initialFiles.includes(file))

    // 过滤掉cache目录
    const filteredAppend = append.filter(file => file !== 'cache')

    if (filteredAppend.length < 1) {
      return { error: '检测错误' }
    }

    const nPath = path.join(resourcePath, filteredAppend[0])
    const answer = []

    try {
      for (const item of fs.readdirSync(nPath)) {
        const dir = path.join(nPath, item)
        if (!fs.statSync(dir).isDirectory()) continue

        const subDir = path.join(dir, fs.readdirSync(dir)[0])
        const filename = fs.readdirSync(subDir)[0].replace('.mp3', '')
        const parts = filename.split('-')
        answer.push(parts[1])
      }

      const sortedAnswer = answer.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      ipcRenderer.send('set-answer', sortedAnswer)
      return { answer: sortedAnswer }
    } catch (e) {
      return { error: '处理文件时出错: ' + e.message }
    }
  },
  openLocationWindow: () => ipcRenderer.send('open-location-window'),
  setLocations: (locations) => ipcRenderer.send('set-locations', locations),
  updateLocations: (callback) => ipcRenderer.on('update-locations', callback),
  startPoint: () => ipcRenderer.send('start-point'),
  onOperationComplete: (callback) => ipcRenderer.on('operation-complete', callback),
  getScaleFactor: () => ipcRenderer.invoke('get-scale-factor'),
  setGlobalScale: (scale) => ipcRenderer.send('set-global-scale', scale),
  deleteAllFiles: () => {
    if (!fs.existsSync(resourcePath)) {
      return { error: '资源路径不存在' }
    }

    try {
      const files = fs.readdirSync(resourcePath)
      let deletedCount = 0

      for (const file of files) {
        const filePath = path.join(resourcePath, file)
        const stats = fs.statSync(filePath)

        if (stats.isDirectory()) {
          deleteDirectoryRecursively(filePath)
          deletedCount++
        } else {
          fs.unlinkSync(filePath)
          deletedCount++
        }
      }

      return { success: true, deletedCount }
    } catch (e) {
      return { error: '删除文件时出错: ' + e.message }
    }
  },
  replaceAudioFiles: (choosePath) => {
    const innerPath = path.join('bookres', 'media')
    const targetFolder = path.join(flipbooksPath, choosePath, innerPath)
    const specificAudio = path.join(__dirname, 'init.mp3')

    if (!fs.existsSync(targetFolder)) {
      return { error: '目标路径不存在: ' + targetFolder }
    }

    if (!fs.existsSync(specificAudio)) {
      return { error: '音频文件不存在: ' + specificAudio }
    }

    try {
      const replacedCount = replaceMp3FilesSync(targetFolder, specificAudio)
      return { success: true, message: '音频替换完成', replacedCount }
    } catch (e) {
      return { error: '音频替换失败: ' + e.message }
    }
  },
  restoreAudioFiles: (choosePath) => {
    const innerPath = path.join('bookres', 'media')
    const targetFolder = path.join(flipbooksPath, choosePath, innerPath)

    if (!fs.existsSync(targetFolder)) {
      return { error: '目标路径不存在: ' + targetFolder }
    }

    try {
      const restoredCount = restoreMp3FilesSync(targetFolder)
      return { success: true, message: '音频还原完成', restoredCount }
    } catch (e) {
      return { error: '音频还原失败: ' + e.message }
    }
  },
  getFlipbooksFolders: () => {

    if (!fs.existsSync(flipbooksPath)) {
      return { error: 'flipbooks目录不存在: ' + flipbooksPath }
    }

    try {
      const folders = fs.readdirSync(flipbooksPath, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => item.name)

      return { success: true, folders }
    } catch (e) {
      return { error: '读取目录失败: ' + e.message }
    }
  },
  getListeningAnswers: (choosePath) => {
    const targetFolder = path.join(flipbooksPath, choosePath)

    if (!fs.existsSync(targetFolder)) {
      return { error: '目标路径不存在: ' + targetFolder }
    }

    try {
      let results = { 'P2': {}, 'P3': [] }

      function findFilesByExtension(dir) {
        let list = fs.readdirSync(dir)
        if (list.length === 0) return

        for (let dirent of list) {
          const dirName = path.resolve(dir, dirent)
          if (fs.statSync(dirName).isDirectory()) {
            findFilesByExtension(dirName)
          } else {
            if (dirent.includes('A') && dirent.toLowerCase().includes('.mp3')) {
              let className = dirent.substring(1).split('.').slice(0, -2).join('.');
              if (!(className in results['P2'])) results['P2'][className] = [dirName]
              else results['P2'][className].push(dirName)
            }
            if (dirName.includes('psdata_new') && dirent === 'answer.json') {
              results['P3'].push(dirName)
            }
          }
        }
      }

      findFilesByExtension(targetFolder)

      const p3Answers = []
      for (const answerPath of results['P3']) {
        try {
          const answerContent = fs.readFileSync(answerPath, 'utf8')
          const answerData = JSON.parse(answerContent)
          p3Answers.push({
            path: answerPath,
            data: answerData
          })
        } catch (e) {
          p3Answers.push({
            path: answerPath,
            error: '解析JSON失败: ' + e.message
          })
        }
      }

      const p2WithProtocol = {}
      for (const [className, files] of Object.entries(results['P2'])) {
        p2WithProtocol[className] = files.map(file => file.replace(/\\/g, '/'))
      }

      return {
        success: true,
        P2: p2WithProtocol,
        P3: p3Answers
      }
    } catch (e) {
      return { error: '获取答案失败: ' + e.message }
    }
  },

  //答案获取相关API
  startAnswerProxy: () => ipcRenderer.send('start-answer-proxy'),
  stopAnswerProxy: () => ipcRenderer.send('stop-answer-proxy'),
  startCapturing: () => ipcRenderer.send('start-capturing'),
  stopCapturing: () => ipcRenderer.send('stop-capturing'),

  // 监听事件
  onProxyStatus: (callback) => ipcRenderer.on('proxy-status', callback),
  onProxyError: (callback) => ipcRenderer.on('proxy-error', callback),
  onTrafficLog: (callback) => ipcRenderer.on('traffic-log', callback),
  onResponseCaptured: (callback) => ipcRenderer.on('response-captured', callback),
  onResponseError: (callback) => ipcRenderer.on('response-error', callback),
  onImportantRequest: (callback) => ipcRenderer.on('important-request', callback),
  onDownloadFound: (callback) => ipcRenderer.on('download-found', callback),
  onProcessStatus: (callback) => ipcRenderer.on('process-status', callback),
  onProcessError: (callback) => ipcRenderer.on('process-error', callback),
  onAnswersExtracted: (callback) => ipcRenderer.on('answers-extracted', callback),
  onCaptureStatus: (callback) => ipcRenderer.on('capture-status', callback),
  onFileStructure: (callback) => ipcRenderer.on('file-structure', callback),
  onFilesProcessed: (callback) => ipcRenderer.on('files-processed', callback),
  onCertificateStatus: (callback) => ipcRenderer.on('certificate-status', callback),

  openLocationWindowPk: () => ipcRenderer.send('open-location-window-pk'),
  setLocationsPk1: (pos) => ipcRenderer.send('set-locations-pk-1', pos),
  setLocationsPk2: (pos) => ipcRenderer.send('set-locations-pk-2', pos),
  startChoose: () => ipcRenderer.send('start-choose'),
  getScaleFactor: () => ipcRenderer.invoke('get-scale-factor'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  downloadFile: (uuid) => ipcRenderer.invoke('download-file', uuid),
  shareAnswerFile: (filePath) => ipcRenderer.invoke('share-answer-file', filePath),
  deleteFlipbooksFiles: () => {

    if (!fs.existsSync(flipbooksPath)) {
      return { error: 'flipbooks目录不存在: ' + flipbooksPath }
    }

    try {
      const files = fs.readdirSync(flipbooksPath)
      let deletedCount = 0

      for (const file of files) {
        const filePath = path.join(flipbooksPath, file)
        const stats = fs.statSync(filePath)

        if (stats.isDirectory()) {
          deleteDirectoryRecursively(filePath)
          deletedCount++
        } else {
          fs.unlinkSync(filePath)
          deletedCount++
        }
      }

      return { success: true, deletedCount }
    } catch (e) {
      return { error: '删除文件时出错: ' + e.message }
    }
  },

  writeSystemAudio: (filePath) => {
    try {
      console.log(`系统音频写入: ${filePath}`);
      const audioInfo = {
        path: filePath,
        timestamp: new Date().toISOString(),
        action: 'write_to_system'
      };
      return { success: true, message: '系统音频已写入', audioInfo };
    }
    catch (e) {
      return { error: '系统音频写入失败: ' + e.message };
    }
  },

  openDirectoryChoosing: () => ipcRenderer.send('open-directory-choosing'),
  chooseDirectory: (callback) => ipcRenderer.on('choose-directory', callback),
  
  openFileChoosing: () => ipcRenderer.send('open-file-choosing'),
  chooseFile: (callback) => ipcRenderer.on('choose-file', callback),
  openPkZipChoosing: () => ipcRenderer.send('open-pk-zip-choosing'),
  choosePkZip: (callback) => ipcRenderer.on('choose-pk-zip', (event, filePath) => callback(filePath)),
  setCachePath: (cachePath) => {
    try {
      const normalizedPath = path.resolve(cachePath);
      const resourcesDir = path.join(normalizedPath, 'resources');
      const flipbooksDir = path.join(normalizedPath, 'flipbooks');

      if (!fs.existsSync(normalizedPath)) {
        fs.mkdirSync(normalizedPath, { recursive: true });
      }
      if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
      }
      if (!fs.existsSync(flipbooksDir)) {
        fs.mkdirSync(flipbooksDir, { recursive: true });
      }

      resourcePath = resourcesDir;
      flipbooksPath = flipbooksDir;
      return 1;
    } catch (error) {
      console.error('设置缓存路径失败:', error);
      return 0;
    }
  },

  // 响应体更改规则相关API
  getResponseRules: () => ipcRenderer.invoke('get-response-rules'),
  saveResponseRule: (rule) => ipcRenderer.invoke('save-response-rule', rule),
  deleteResponseRule: (ruleId) => ipcRenderer.invoke('delete-response-rule', ruleId),
  toggleResponseRule: (ruleId, enabled) => ipcRenderer.invoke('toggle-response-rule', ruleId, enabled),
  exportResponseRules: () => ipcRenderer.invoke('export-response-rules'),
  importResponseRules: () => ipcRenderer.invoke('import-response-rules'),
  getRuleTypes: () => ipcRenderer.invoke('get-rule-types'),
  getActionTypes: (ruleType) => ipcRenderer.invoke('get-action-types', ruleType),

  // PK注入相关API
  setPkConfig: (config) => ipcRenderer.invoke('set-pk-config', config),
  getPkConfig: () => ipcRenderer.invoke('get-pk-config'),
  clearPkCache: () => ipcRenderer.invoke('clear-pk-cache'),
  importPkWordList: (content) => ipcRenderer.invoke('import-pk-word-list', content),
  onPkInjectionStart: (callback) => ipcRenderer.on('pk-injection-start', (event, data) => callback(data)),
  onPkInjectionSuccess: (callback) => ipcRenderer.on('pk-injection-success', (event, data) => callback(data)),
  onPkInjectionError: (callback) => ipcRenderer.on('pk-injection-error', (event, data) => callback(data)),
  onPkRequestProcessed: (callback) => ipcRenderer.on('pk-request-processed', (event, data) => callback(data)),

  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  updateConfirm: () => ipcRenderer.send('update-confirm'),
  updateInstall: () => ipcRenderer.send('update-install'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', (event, data) => callback(data)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback)
})