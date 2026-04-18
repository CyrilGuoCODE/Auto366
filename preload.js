const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const { v4 : uuidv4 } = require('uuid')
const FormData = require('form-data');
const https = require('https');

let cachePath = 'D:\\Up366StudentFiles'

contextBridge.exposeInMainWorld('electronAPI', {
  getUiMode: () => ipcRenderer.invoke('get-ui-mode'),
  switchUiMode: (mode) => ipcRenderer.invoke('switch-ui-mode', mode),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximized: (callback) => ipcRenderer.on('window-maximized', (event, value) => callback(value)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // 答案获取相关API
  startAnswerProxy: () => ipcRenderer.invoke('start-answer-proxy'),
  stopAnswerProxy: () => ipcRenderer.invoke('stop-answer-proxy'),
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
  downloadFile: (uuid) => ipcRenderer.invoke('download-file', uuid),
  shareAnswerFile: (filePath) => ipcRenderer.invoke('share-answer-file', filePath),
  saveInjectionPackage: (data) => ipcRenderer.invoke('save-injection-package', data),

  // 目录选择
  openDirectoryChoosing: () => ipcRenderer.invoke('open-directory-choosing'),
  openImplantZipChoosing: () => ipcRenderer.invoke('open-implant-zip-choosing'),
  chooseImplantZip: (callback) => ipcRenderer.on('choose-implant-zip', (event, filePath) => callback(filePath)),

  // 缓存路径管理
  setCachePath: (newPath) => {
    try {
      const normalizedPath = path.resolve(newPath);
      if (!fs.existsSync(normalizedPath)) {
        fs.mkdirSync(normalizedPath, { recursive: true });
      }
      cachePath = normalizedPath;
      return 1;
    } catch (error) {
      console.error('设置缓存路径失败:', error);
      return 0;
    }
  },
  removeCacheFile: () => ipcRenderer.invoke('remove-cache-file'),

  // 规则管理API
  getRules: () => ipcRenderer.invoke('get-rules'),
  saveRule: (rule) => ipcRenderer.invoke('save-rule', rule),
  deleteRule: (ruleId) => ipcRenderer.invoke('delete-rule', ruleId),
  toggleRule: (ruleId, enabled) => ipcRenderer.invoke('toggle-rule', ruleId, enabled),
  resetRuleTriggers: (ruleId) => ipcRenderer.invoke('reset-rule-triggers', ruleId),
  saveResponseRules: (rules) => ipcRenderer.invoke('save-response-rules', rules),

  // 更新相关API
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  updateConfirm: () => ipcRenderer.invoke('update-confirm'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),

  // 上传规则集
  uploadRules: async (name, description, author, groupRules, updateUploadProgress) => {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    formData.append('author', author);

    for (let rule of groupRules){
      if (rule.type === 'zip-implant'){
        const stream = fs.createReadStream(rule.zipImplant)
        const filename = uuidv4() + path.extname(rule.zipImplant);
        formData.append('files', stream, { filename: filename });
        rule.zipImplant = 'https://objectstorageapi.us-west-1.clawcloudrun.com/d9k8xp0t-auto366-ruleset/files/'+filename
      }
    }

    const rulesJson = JSON.stringify(groupRules, null, 2);
    formData.append('json', Buffer.from(rulesJson), { filename: `${name}.json`, type: 'application/json' });

    updateUploadProgress(0, '上传中...');

    return await new Promise((resolve, reject) => {
      const headers = formData.getHeaders();

      const url = new URL('https://366.cyril.qzz.io/api/rulesets');

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          ...headers,
        },
        timeout: 30000
      };

      // 创建请求
      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          updateUploadProgress(100, '上传完成');
          try {
            const parsed = JSON.parse(responseData);
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: parsed
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: responseData
            });
          }
        });
      });
      req.on('error', (error) => {
        reject(error);
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      formData.pipe(req);
    })
  },
  downloadRuleFile: (url) => {
    return new Promise((resolve) => {
      const fileDir = path.join(__dirname, 'file');
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }
      const dest = path.join(fileDir, url.split('/').pop());
      const file = fs.createWriteStream(dest);
      https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(dest);
        })
      }).on('error', (err) => {
        fs.unlink(dest, () => {}); // 删除错误文件
        console.error('下载出错:', err.message);
      });
    })
  }
})
