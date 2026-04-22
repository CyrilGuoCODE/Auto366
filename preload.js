const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getUiMode: () => ipcRenderer.invoke('get-ui-mode'),
  switchUiMode: (mode) => ipcRenderer.invoke('switch-ui-mode', mode),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximized: (callback) => ipcRenderer.on('window-maximized', (event, value) => callback(value)),
  getScaleFactor: () => ipcRenderer.invoke('get-scale-factor'),
  setGlobalScale: () => ipcRenderer.send('set-global-scale'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // 答案获取相关API
  startAnswerProxy: () => ipcRenderer.send('start-answer-proxy'),
  stopAnswerProxy: () => ipcRenderer.send('stop-answer-proxy'),
  setProxyPort: (port) => ipcRenderer.invoke('set-proxy-port', port),
  getProxyPort: () => ipcRenderer.invoke('get-proxy-port'),
  setBucketPort: (port) => ipcRenderer.invoke('set-bucket-port', port),
  getBucketPort: () => ipcRenderer.invoke('get-bucket-port'),
  setAnswerCaptureEnabled: (enabled) => ipcRenderer.invoke('set-answer-capture-enabled', enabled),
  getAnswerCaptureEnabled: () => ipcRenderer.invoke('get-answer-capture-enabled'),

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
  onRuleLog: (callback) => ipcRenderer.on('rule-log', callback),

  // 文件操作
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  openUp366: () => ipcRenderer.invoke('open-up366'),
  downloadFile: (uuid) => ipcRenderer.invoke('download-file', uuid),
  shareAnswerFile: (filePath) => ipcRenderer.invoke('share-answer-file', filePath),
  saveInjectionPackage: (data) => ipcRenderer.invoke('save-injection-package', data),

  // 目录选择
  openDirectoryChoosing: () => ipcRenderer.send('open-directory-choosing'),
  openFileChoosing: () => ipcRenderer.send('open-file-choosing'),
  openImplantZipChoosing: () => ipcRenderer.send('open-implant-zip-choosing'),
  chooseDirectory: () => ipcRenderer.invoke('open-directory-choosing'),
  chooseFile: (callback) => ipcRenderer.on('choose-file', (event, filePath) => callback(filePath)),
  chooseImplantZip: (callback) => ipcRenderer.on('choose-implant-zip', (event, filePath) => callback(filePath)),

  // 缓存路径管理
  setCachePath: (newPath) => ipcRenderer.invoke('set-cache-path', newPath),

  // 规则管理API
  getRules: () => ipcRenderer.invoke('get-rules'),
  getResponseRules: () => ipcRenderer.invoke('get-response-rules'),
  saveRule: (rule) => ipcRenderer.invoke('save-response-rule', rule),
  saveRules: (rules) => ipcRenderer.invoke('save-response-rules', rules),
  deleteRule: (ruleId) => ipcRenderer.invoke('delete-response-rule', ruleId),
  toggleRule: (ruleId, enabled) => ipcRenderer.invoke('toggle-response-rule', ruleId, enabled),
  resetRuleTriggers: (ruleId) => ipcRenderer.invoke('reset-rule-triggers', ruleId),
  saveResponseRules: (rules) => ipcRenderer.invoke('save-response-rules', rules),
  exportResponseRules: () => ipcRenderer.invoke('export-response-rules'),
  importResponseRules: () => ipcRenderer.invoke('import-response-rules'),
  importResponseRulesFromData: (rulesData) => ipcRenderer.invoke('import-response-rules-from-data', rulesData),
  getActionTypes: (ruleType) => ipcRenderer.invoke('get-action-types', ruleType),

  // 注入包相关
  importImplantZip: (sourcePath) => ipcRenderer.invoke('import-implant-zip', sourcePath),
  downloadAndImportInjectionPackage: (arrayBuffer, rulesetName) => ipcRenderer.invoke('download-and-import-injection-package', arrayBuffer, rulesetName),
  downloadAndSaveInjectionPackage: (arrayBuffer, originalFileName, rulesetName) => ipcRenderer.invoke('download-and-save-injection-package', arrayBuffer, originalFileName, rulesetName),
  downloadAndSaveInjectionPackageWithMD5: (arrayBuffer, fileName, rulesetName, newFileMD5) => ipcRenderer.invoke('download-and-save-injection-package-with-md5', arrayBuffer, fileName, rulesetName, newFileMD5),

  // 更新相关API
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  updateConfirm: () => ipcRenderer.send('update-confirm'),
  updateInstall: () => ipcRenderer.send('update-install'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', (event, data) => callback(data)),

  // 社区规则集上传下载（通过IPC调用）
  uploadRules: async (name, description, author, groupRules, updateUploadProgress) => {
    return ipcRenderer.invoke('upload-rules', { name, description, author, groupRules }, updateUploadProgress);
  },
  downloadRuleFile: (url) => ipcRenderer.invoke('download-rule-file', url)
})
