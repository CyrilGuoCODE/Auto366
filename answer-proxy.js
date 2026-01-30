const crypto = require('crypto');
const { ipcMain } = require('electron')
const http = require('http')
const https = require('https')
const net = require('net')
const url = require('url')
const fs = require('fs-extra')
const axios = require('axios')
const StreamZip = require('node-stream-zip')
const mitmproxy = require('node-mitmproxy')
const zlib = require('zlib')
const { pipeline } = require('stream')
const { Transform } = require('stream')
const path = require('path')
const { app } = require('electron')
const { v4: uuidv4 } = require('uuid')
const CertificateManager = require('./certificate-manager')
const appPath = app.isPackaged ? process.resourcesPath : __dirname;
const tempDir = path.join(appPath, 'temp');
const ansDir = path.join(appPath, 'answers');
const rulesDir = path.join(app.getPath('userData'), 'response-rules');

class AnswerProxy {
  constructor() {
    this.proxyAgent = null;
    this.extractedAnswers = [];
    this.downloadUrl = '';
    this.mainWindow = null;
    this.trafficCache = new Map();
    this.responseRules = [];
    this.certManager = new CertificateManager();
    this.pendingPkRequests = new Map(); // 存储待处理的PK请求
    this.pkConfig = {
      enabled: false,
      zipPath: path.join(__dirname, 'auto-pk', 'auto-pk.zip'),
      md5: '',
      md5Base64: '',
      size: 0
    };
    this.wordPkBucketData = null; // 单词PK词库数据
    this.bucketServer = null; // 本地词库HTTP服务器

    // 启动时自动根据默认zip计算MD5/size
    try {
      this.refreshPkZipInfo();
    } catch (e) {
      console.error('初始化PK默认zip信息失败:', e);
    }
    this.loadResponseRules();
  }

  // 设置主窗口引用
  setMainWindow(window) {
    this.mainWindow = window;
  }

  setPkConfig(config) {
    try {
      if (!this.pkConfig) this.pkConfig = {};
      if (typeof config.enabled === 'boolean') this.pkConfig.enabled = config.enabled;

      if (typeof config.zipPath === 'string' && config.zipPath.trim()) {
        const zipPath = config.zipPath.trim();
        if (!fs.existsSync(zipPath)) {
          throw new Error('zip文件不存在: ' + zipPath);
        }
        const buffer = fs.readFileSync(zipPath);
        const md5 = crypto.createHash('md5').update(buffer).digest('hex');
        const md5Base64 = Buffer.from(md5, 'hex').toString('base64');
        const size = buffer.length;
        this.pkConfig.zipPath = zipPath;
        this.pkConfig.md5 = md5;
        this.pkConfig.md5Base64 = md5Base64;
        this.pkConfig.size = size;
      }

      console.log('PK配置已更新:', this.pkConfig);
      return true;
    } catch (e) {
      console.error('更新PK配置失败:', e);
      return false;
    }
  }

  getPkConfig() {
    return this.pkConfig || {};
  }

  refreshPkZipInfo() {
    if (!this.pkConfig || !this.pkConfig.zipPath) return;
    try {
      const zipPath = this.pkConfig.zipPath;
      if (!fs.existsSync(zipPath)) {
        console.warn('默认PK zip不存在:', zipPath);
        return;
      }
      const buffer = fs.readFileSync(zipPath);
      const md5 = crypto.createHash('md5').update(buffer).digest('hex');
      const md5Base64 = Buffer.from(md5, 'hex').toString('base64');
      const size = buffer.length;
      this.pkConfig.md5 = md5;
      this.pkConfig.md5Base64 = md5Base64;
      this.pkConfig.size = size;
      console.log('默认PK zip信息已自动计算:', this.pkConfig);
    } catch (e) {
      console.error('自动计算默认PK zip信息失败:', e);
    }
  }

  // 安全的IPC发送函数
  safeIpcSend(channel, data) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        console.log(`发送IPC消息 [${channel}]:`, data);
        this.mainWindow.webContents.send(channel, data);
      } else {
        console.warn(`无法发送IPC消息 [${channel}]: 主窗口不可用`);
      }
    } catch (error) {
      console.error(`发送IPC消息失败 [${channel}]:`, error);
    }
  }

  // 加载响应体更改规则
  loadResponseRules() {
    try {
      fs.ensureDirSync(rulesDir);
      const rulesFile = path.join(rulesDir, 'rules.json');

      if (fs.existsSync(rulesFile)) {
        const rulesData = fs.readFileSync(rulesFile, 'utf-8');
        this.responseRules = JSON.parse(rulesData);
        console.log(`已加载 ${this.responseRules.length} 条响应体更改规则`);
      } else {
        this.responseRules = [];
      }
    } catch (error) {
      console.error('加载响应体更改规则失败:', error);
      this.responseRules = [];
    }
  }

  // 保存响应体更改规则
  saveResponseRules() {
    try {
      fs.ensureDirSync(rulesDir);
      const rulesFile = path.join(rulesDir, 'rules.json');
      fs.writeFileSync(rulesFile, JSON.stringify(this.responseRules, null, 2), 'utf-8');
      console.log(`已保存 ${this.responseRules.length} 条响应体更改规则`);
      return true;
    } catch (error) {
      console.error('保存响应体更改规则失败:', error);
      return false;
    }
  }

  // 获取所有规则
  getResponseRules() {
    console.log('AnswerProxy.getResponseRules() 被调用');
    console.log('当前规则数量:', this.responseRules ? this.responseRules.length : 'undefined');
    console.log('规则数据:', this.responseRules);
    return this.responseRules || [];
  }

  // 添加或更新规则
  saveRule(rule) {
    try {
      if (rule.id) {
        // 更新现有规则
        const index = this.responseRules.findIndex(r => r.id === rule.id);
        if (index !== -1) {
          this.responseRules[index] = { ...rule, updatedAt: new Date().toISOString() };
        }
      } else {
        // 添加新规则
        rule.id = uuidv4();
        rule.createdAt = new Date().toISOString();
        rule.updatedAt = new Date().toISOString();
        this.responseRules.push(rule);
      }

      return this.saveResponseRules();
    } catch (error) {
      console.error('保存规则失败:', error);
      return false;
    }
  }

  // 删除规则
  deleteRule(ruleId) {
    try {
      this.responseRules = this.responseRules.filter(r => r.id !== ruleId);
      return this.saveResponseRules();
    } catch (error) {
      console.error('删除规则失败:', error);
      return false;
    }
  }

  // 切换规则启用状态
  toggleRule(ruleId, enabled) {
    try {
      const rule = this.responseRules.find(r => r.id === ruleId);
      if (rule) {
        rule.enabled = enabled;
        rule.updatedAt = new Date().toISOString();
        return this.saveResponseRules();
      }
      return false;
    } catch (error) {
      console.error('切换规则状态失败:', error);
      return false;
    }
  }

  // 应用请求修改规则
  applyRequestRules(url, method, requestOptions, headers) {
    try {
      let modifiedOptions = { ...requestOptions };
      let modifiedHeaders = { ...headers };
      let appliedRules = [];

      for (const rule of this.responseRules) {
        if (rule.enabled && rule.type === 'request' && this.matchesRule(rule, url, method)) {
          console.log(`应用请求规则: ${rule.name} 到 ${url}`);

          switch (rule.action) {
            case 'modify-headers':
              if (rule.requestHeaders) {
                Object.assign(modifiedHeaders, rule.requestHeaders);
                appliedRules.push(rule.name);
              }
              break;

            case 'modify-url':
              if (rule.newUrl) {
                const urlObj = new URL(rule.newUrl);
                modifiedOptions.hostname = urlObj.hostname;
                modifiedOptions.port = urlObj.port;
                modifiedOptions.path = urlObj.pathname + urlObj.search;
                appliedRules.push(rule.name);
              }
              break;

            case 'block':
              // 阻止请求 - 返回错误响应
              modifiedOptions.blocked = true;
              appliedRules.push(rule.name);
              break;
          }
        }
      }

      // 更新请求选项中的headers
      if (Object.keys(modifiedHeaders).length > 0) {
        modifiedOptions.headers = modifiedHeaders;
      }

      return {
        modified: appliedRules.length > 0,
        requestOptions: modifiedOptions,
        headers: modifiedHeaders,
        appliedRules: appliedRules
      };
    } catch (error) {
      console.error('应用请求修改规则失败:', error);
      return {
        modified: false,
        requestOptions: requestOptions,
        headers: headers,
        appliedRules: []
      };
    }
  }

  // 应用响应头修改规则
  applyResponseHeaderRules(url, method, responseHeaders) {
    try {
      let modifiedHeaders = {};
      let appliedRules = [];

      for (const rule of this.responseRules) {
        if (rule.enabled && rule.type === 'response-headers' && this.matchesRule(rule, url, method)) {
          console.log(`应用响应头规则: ${rule.name} 到 ${url}`);

          switch (rule.action) {
            case 'add-headers':
              if (rule.responseHeaders) {
                Object.assign(modifiedHeaders, rule.responseHeaders);
                appliedRules.push(rule.name);
              }
              break;

            case 'remove-headers':
              if (rule.removeHeaders && Array.isArray(rule.removeHeaders)) {
                for (const headerName of rule.removeHeaders) {
                  modifiedHeaders[headerName] = undefined; // 标记为删除
                }
                appliedRules.push(rule.name);
              }
              break;

            case 'modify-headers':
              if (rule.responseHeaders) {
                Object.assign(modifiedHeaders, rule.responseHeaders);
                appliedRules.push(rule.name);
              }
              break;
          }
        }
      }

      return {
        modified: appliedRules.length > 0,
        headers: modifiedHeaders,
        appliedRules: appliedRules
      };
    } catch (error) {
      console.error('应用响应头修改规则失败:', error);
      return {
        modified: false,
        headers: {},
        appliedRules: []
      };
    }
  }

  // 检查URL是否匹配规则
  matchesRule(rule, url, method, contentType) {
    try {
      // 检查是否启用
      if (!rule.enabled) return false;

      // 检查规则类型（如果指定了类型）
      if (rule.type && !['response', 'request', 'response-headers'].includes(rule.type)) {
        return false;
      }

      // 检查URL模式
      if (rule.urlPattern && rule.urlPattern.trim()) {
        const regex = new RegExp(rule.urlPattern, 'i');
        if (!regex.test(url)) return false;
      }

      // 检查请求方法
      if (rule.method && rule.method.trim() && rule.method !== method) {
        return false;
      }

      // 检查内容类型（仅对响应体规则有效）
      if (rule.type === 'response' && rule.contentType && rule.contentType.trim()) {
        if (!contentType || !contentType.includes(rule.contentType)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('规则匹配检查失败:', error);
      return false;
    }
  }

  // 应用响应体更改规则
  applyResponseRules(url, method, contentType, responseBody, responseBuffer) {
    try {
      let modifiedBody = responseBody;
      let modifiedBuffer = responseBuffer;
      let appliedRules = [];
      let isBinaryModified = false;

      for (const rule of this.responseRules) {
        // 只处理响应体规则（默认类型或明确指定为response）
        if ((!rule.type || rule.type === 'response') && this.matchesRule(rule, url, method, contentType)) {
          console.log(`应用响应体规则: ${rule.name} 到 ${url}`);

          switch (rule.action) {
            case 'replace':
              if (rule.replaceWithFile && rule.filePath) {
                // 从文件替换（支持二进制）
                try {
                  if (fs.existsSync(rule.filePath)) {
                    modifiedBuffer = fs.readFileSync(rule.filePath);
                    modifiedBody = modifiedBuffer.toString('utf8'); // 尝试转换为字符串用于显示
                    isBinaryModified = true;
                    appliedRules.push(rule.name);
                    console.log(`从文件替换响应体: ${rule.filePath}`);
                  } else {
                    console.error(`替换文件不存在: ${rule.filePath}`);
                  }
                } catch (error) {
                  console.error(`读取替换文件失败: ${rule.filePath}`, error);
                }
              } else {
                // 文本替换
                modifiedBody = rule.replaceContent || '';
                modifiedBuffer = Buffer.from(modifiedBody, 'utf8');
                appliedRules.push(rule.name);
              }
              break;

            case 'modify':
              if (rule.modifyRules && Array.isArray(rule.modifyRules)) {
                for (const modifyRule of rule.modifyRules) {
                  if (modifyRule.find && modifyRule.replace !== undefined) {
                    try {
                      const regex = new RegExp(modifyRule.find, 'g');
                      modifiedBody = modifiedBody.replace(regex, modifyRule.replace);
                      modifiedBuffer = Buffer.from(modifiedBody, 'utf8');
                    } catch (regexError) {
                      console.error('正则表达式错误:', regexError);
                    }
                  }
                }
                appliedRules.push(rule.name);
              }
              break;

            case 'inject':
              if (rule.injectContent) {
                switch (rule.injectPosition) {
                  case 'start':
                    modifiedBody = rule.injectContent + modifiedBody;
                    break;
                  case 'end':
                    modifiedBody = modifiedBody + rule.injectContent;
                    break;
                  case 'before':
                    if (rule.injectTarget) {
                      modifiedBody = modifiedBody.replace(rule.injectTarget, rule.injectContent + rule.injectTarget);
                    }
                    break;
                  case 'after':
                    if (rule.injectTarget) {
                      modifiedBody = modifiedBody.replace(rule.injectTarget, rule.injectTarget + rule.injectContent);
                    }
                    break;
                }
                modifiedBuffer = Buffer.from(modifiedBody, 'utf8');
                appliedRules.push(rule.name);
              }
              break;
          }
        }
      }

      return {
        modified: appliedRules.length > 0,
        body: modifiedBody,
        buffer: modifiedBuffer,
        isBinaryModified: isBinaryModified,
        appliedRules: appliedRules
      };
    } catch (error) {
      console.error('应用响应体更改规则失败:', error);
      return {
        modified: false,
        body: responseBody,
        buffer: responseBuffer,
        isBinaryModified: false,
        appliedRules: []
      };
    }
  }

  // 响应体解压缩工具函数
  decompressResponse(buffer, encoding) {
    return new Promise((resolve, reject) => {
      try {
        if (!encoding || encoding === 'identity') {
          console.log('无压缩');
          // 无压缩，返回buffer和字符串
          resolve({
            buffer: buffer,
            text: buffer.toString('utf8')
          });
          return;
        }

        if (encoding.includes('gzip')) {
          zlib.gunzip(buffer, (err, result) => {
            if (err) {
              console.error('Gzip解压失败:', err);
              // 解压失败时返回原始内容
              resolve({
                buffer: buffer,
                text: buffer.toString('utf8')
              });
            } else {
              console.log('Gzip解压成功');
              resolve({
                buffer: result,
                text: result.toString('utf8')
              });
            }
          });
        } else if (encoding.includes('deflate')) {
          zlib.inflate(buffer, (err, result) => {
            if (err) {
              console.error('Deflate解压失败:', err);
              resolve({
                buffer: buffer,
                text: buffer.toString('utf8')
              });
            } else {
              console.log('Deflate解压成功');
              resolve({
                buffer: result,
                text: result.toString('utf8')
              });
            }
          });
        } else if (encoding.includes('br')) {
          // Brotli压缩
          zlib.brotliDecompress(buffer, (err, result) => {
            if (err) {
              console.error('Brotli解压失败:', err);
              resolve({
                buffer: buffer,
                text: buffer.toString('utf8')
              });
            } else {
              console.log('Brotli解压成功');
              resolve({
                buffer: result,
                text: result.toString('utf8')
              });
            }
          });
        } else {
          // 未知压缩格式，直接返回
          console.log('未知压缩格式:', encoding)
          resolve({
            buffer: buffer,
            text: buffer.toString('utf8')
          });
        }
      } catch (error) {
        console.error('解压缩过程中出错:', error);
        resolve({
          buffer: buffer,
          text: buffer.toString('utf8')
        });
      }
    });
  }

  // 启动抓包代理
  async startProxy(mainWindow) {
    this.mainWindow = mainWindow;

    if (this.proxyAgent) {
      this.stopProxy();
    }

    // 自动导入证书
    try {
      this.safeIpcSend('certificate-status', {
        status: 'importing',
        message: '正在检查并导入证书到受信任的根证书颁发机构...'
      });

      // 先尝试正常导入
      let certResult = await this.certManager.importCertificate();

      // 如果显示"已存在"但实际可能没有，尝试强制导入
      if (certResult.status === 'exists') {
        console.log('检测到证书可能已存在，但为了确保正确性，尝试强制重新导入...');
        this.safeIpcSend('certificate-status', {
          status: 'importing',
          message: '检测到证书可能已存在，正在强制重新导入以确保正确性...'
        });

        certResult = await this.certManager.forceImportCertificate();
      }

      // 发送证书导入结果状态
      this.safeIpcSend('certificate-status', {
        status: certResult.status || (certResult.success ? 'success' : 'error'),
        message: certResult.message || certResult.error || '证书处理完成'
      });

      if (!certResult.success) {
        console.warn('证书导入失败，但代理将继续启动:', certResult.error);
      }
    } catch (error) {
      this.safeIpcSend('certificate-status', {
        status: 'error',
        message: '证书导入过程中发生错误: ' + error.message
      });
      console.warn('证书导入过程中发生错误，但代理将继续启动:', error);
    }

    // 创建MITM代理实例
    this.proxyAgent = mitmproxy.createProxy({
      port: 5291,
      ssl: {
        rejectUnauthorized: false
      },
      sslConnectInterceptor: (req, cltSocket, head) => {
        try {
          // 只拦截浏览器的https请求
          if (req.headers && req.headers['user-agent'] && /^Mozilla/.test(req.headers['user-agent'])) {
            return true;
          } else {
            return false;
          }
        } catch (error) {
          console.error('SSL连接拦截器错误:', error);
          return false;
        }
      },
      requestInterceptor: (requestOptions, clientReq, clientRes, ssl, next) => {
        try {
          // 构建请求URL
          const protocol = ssl ? "https" : "http";
          const fullUrl = `${protocol}://${requestOptions.hostname || requestOptions.host}${requestOptions.path}`;

          // 记录请求信息
          console.log(`拦截请求: ${clientReq.method} ${fullUrl}`);

          // 应用请求修改规则
          const modifiedRequest = this.applyRequestRules(fullUrl, clientReq.method, requestOptions, clientReq.headers);

          if (modifiedRequest.modified) {
            console.log(`请求已被规则修改: ${modifiedRequest.appliedRules.join(', ')}`);

            // 检查是否被阻止
            if (modifiedRequest.requestOptions.blocked) {
              console.log(`请求被阻止: ${fullUrl}`);
              clientRes.writeHead(403, { 'Content-Type': 'text/plain' });
              clientRes.end('Request blocked by proxy rules');
              return; // 不调用next()，阻止请求继续
            }

            // 应用修改后的请求选项
            Object.assign(requestOptions, modifiedRequest.requestOptions);

            // 应用修改后的请求头
            if (modifiedRequest.headers) {
              Object.assign(requestOptions.headers, modifiedRequest.headers);
            }
          }

          const pkCfg = this.pkConfig || {};

          if (pkCfg.enabled && this.isPkFileInfoRequest(fullUrl)) {
            console.log('检测到单词PK文件信息请求，暂停处理...', fullUrl);
            this.handlePkFileInfoRequest(fullUrl, clientReq, clientRes, requestOptions, ssl);
            return;
          }

          if (pkCfg.enabled && this.isPkFileRequest(fullUrl)) {
            console.log('检测到单词PK文件请求，暂停处理...', fullUrl);
            this.handlePkFileRequest(fullUrl, clientReq, clientRes, requestOptions, ssl);
            return;
          }

          // 发送请求拦截日志
          this.safeIpcSend('request-intercepted', {
            method: clientReq.method,
            url: fullUrl,
            headers: requestOptions.headers,
            modified: modifiedRequest.modified,
            appliedRules: modifiedRequest.appliedRules || [],
            timestamp: new Date().toISOString()
          });

        } catch (error) {
          console.error('请求拦截器错误:', error);
        }

        next();
      },
      responseInterceptor: (req, res, proxyReq, proxyRes, ssl, next) => {
        try {
          // 构建请求信息
          const protocol = ssl ? "https" : "http";
          let urlPath = req.url;
          let fullUrl;
          if (urlPath.startsWith(protocol + "://")) {
            fullUrl = urlPath;
          } else {
            fullUrl = protocol + "://" + (req.headers.host || "") + urlPath;
          }

          const requestInfo = {
            method: req.method,
            url: fullUrl,
            host: req.headers.host,
            timestamp: new Date().toISOString(),
            isHttps: ssl,
            requestHeaders: req.headers
          };

          // 检查内容类型和编码
          const contentType = proxyRes.headers['content-type'] || '';
          const contentEncoding = proxyRes.headers['content-encoding'] || '';
          const isJson = /application\/json/.test(contentType);
          const isFile = /application\/octet-stream|image/.test(contentType);
          const contentLengthIsZero = proxyRes.headers['content-length'] == 0;
          const isCompressed = Boolean(contentEncoding) && !isFile;

          console.log(`请求: ${fullUrl}, 内容类型: ${contentType}, 是否压缩: ${isCompressed}`);

          // 应用响应头修改规则
          const headerResult = this.applyResponseHeaderRules(fullUrl, req.method, proxyRes.headers);

          // 统一处理所有响应，收集完整数据后再发送
          const chunks = [];
          let totalLength = 0;
          let responseHandled = false; // 添加标志防止重复处理

          proxyRes.on('data', (chunk) => {
            chunks.push(chunk);
            totalLength += chunk.length;
          });

          proxyRes.on('end', async () => {
            if (responseHandled) return; // 防止重复处理
            responseHandled = true;

            try {
              // 合并所有chunks
              const responseBuffer = Buffer.concat(chunks, totalLength);
              let finalBuffer = responseBuffer;
              let finalResponseBody = '';

              // 只有在内容长度不为0时才处理响应体
              if (!contentLengthIsZero) {
                // 解压缩响应体
                let responseBody = '';
                let decompressedBuffer = responseBuffer;
                if (isCompressed) {
                  console.log(`开始解压缩响应 (${contentEncoding})`);
                  const decompressed = await this.decompressResponse(responseBuffer, contentEncoding);
                  responseBody = decompressed.text;
                  decompressedBuffer = decompressed.buffer;
                } else {
                  responseBody = responseBuffer.toString('utf8');
                  decompressedBuffer = responseBuffer;
                }

                // 应用响应体更改规则
                const ruleResult = this.applyResponseRules(
                  fullUrl,
                  req.method,
                  contentType,
                  responseBody,
                  decompressedBuffer
                );

                finalResponseBody = responseBody;

                if (ruleResult.modified) {
                  console.log(`响应体已被规则修改: ${ruleResult.appliedRules.join(', ')}`);
                  finalResponseBody = ruleResult.body;

                  // 使用修改后的buffer
                  let modifiedBuffer = ruleResult.buffer;

                  // 重新压缩修改后的内容（如果原来是压缩的）
                  if (isCompressed) {
                    try {
                      if (contentEncoding.includes('gzip')) {
                        finalBuffer = await new Promise((resolve, reject) => {
                          zlib.gzip(modifiedBuffer, (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                          });
                        });
                      } else if (contentEncoding.includes('deflate')) {
                        finalBuffer = await new Promise((resolve, reject) => {
                          zlib.deflate(modifiedBuffer, (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                          });
                        });
                      } else if (contentEncoding.includes('br')) {
                        finalBuffer = await new Promise((resolve, reject) => {
                          zlib.brotliCompress(modifiedBuffer, (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                          });
                        });
                      } else {
                        finalBuffer = modifiedBuffer;
                      }
                    } catch (compressError) {
                      console.error('重新压缩失败，发送未压缩内容:', compressError);
                      finalBuffer = modifiedBuffer;
                      // 如果压缩失败，需要移除压缩相关的头部
                      delete proxyRes.headers['content-encoding'];
                    }
                  } else {
                    finalBuffer = modifiedBuffer;
                  }

                  // 记录修改信息
                  requestInfo.modifiedByRules = ruleResult.appliedRules;
                }
              }

              // 设置所有响应头（在writeHead之前）
              Object.keys(proxyRes.headers).forEach(function (key) {
                if (proxyRes.headers[key] != undefined) {
                  if (key.toLowerCase() === 'content-length') {
                    // 使用最终buffer的长度
                    res.setHeader(key, finalBuffer.length);
                  } else {
                    res.setHeader(key, proxyRes.headers[key]);
                  }
                }
              });

              // 应用修改后的响应头
              if (headerResult.modified && headerResult.headers) {
                Object.keys(headerResult.headers).forEach(function (key) {
                  if (headerResult.headers[key] !== undefined) {
                    res.setHeader(key, headerResult.headers[key]);
                  }
                });
                console.log(`响应头已被规则修改: ${headerResult.appliedRules.join(', ')}`);
                requestInfo.headersModifiedByRules = headerResult.appliedRules;
              }

              // 发送响应头和响应体
              res.writeHead(proxyRes.statusCode);
              res.write(finalBuffer);
              res.end();

              // 发送完整的请求响应信息
              requestInfo.statusCode = proxyRes.statusCode;
              requestInfo.statusMessage = proxyRes.statusMessage;
              requestInfo.responseHeaders = proxyRes.headers;
              requestInfo.contentType = contentType;
              requestInfo.contentEncoding = contentEncoding;
              requestInfo.bodySize = finalResponseBody.length;
              requestInfo.originalBodySize = responseBuffer.length;
              requestInfo.isCompressed = isCompressed;
              let uuid = uuidv4()
              requestInfo.uuid = uuid;

              // 根据内容类型格式化响应体
              if (isJson && finalResponseBody) {
                try {
                  requestInfo.responseBody = JSON.stringify(JSON.parse(finalResponseBody), null, 2);
                } catch (e) {
                  requestInfo.responseBody = finalResponseBody;
                }
              } else if (isFile) {
                if (proxyRes.headers["Content-Disposition"]) {
                  requestInfo.responseBody = proxyRes.headers["Content-Disposition"].replaceAll('filename=', '').replaceAll('"', '')
                } else {
                  requestInfo.responseBody = decodeURIComponent(fullUrl.match(/https?:\/\/[^\/]+\/(?:[^\/]+\/)*([^\/?]+)(?=\?|$)/)[1])
                }
              } else {
                requestInfo.responseBody = finalResponseBody;
              }

              // 单词PK词库接口
              try {
                if (fullUrl.includes('https://words-v2-api.up366.cn/client/sync/teaching/bucket/detail-info')) {
                  this.wordPkBucketData = finalResponseBody;
                  console.log('已缓存单词PK词库数据，长度:', finalResponseBody.length);
                }
              } catch (e) {
                console.error('缓存单词PK词库数据失败:', e);
              }
              try {
                if (fullUrl.includes('https://wordsbtl-api.up366.cn/client/wordsbtl/student/start')) {
                  this.wordPkBucketData = finalResponseBody;
                  console.log('已缓存单词PK词库数据，长度:', finalResponseBody.length);
                }
              } catch (e) {
                console.error('缓存单词PK词库数据失败:', e);
              }

              this.safeIpcSend('traffic-log', requestInfo);

              requestInfo.originalResponse = responseBuffer;
              this.trafficCache.set(uuid, requestInfo)

              // 检查是否包含答案下载链接
              if (isFile && requestInfo.responseBody.includes('zip')) {
                fs.mkdirSync(tempDir, { recursive: true });
                fs.mkdirSync(ansDir, { recursive: true });
                const filePath = path.join(tempDir, requestInfo.responseBody)
                await this.downloadFileByUuid(uuid, filePath)
                await this.extractZipFile(filePath, ansDir)

                try {
                  const shouldKeepCache = await this.mainWindow.webContents.executeJavaScript(`
                    localStorage.getItem('keep-cache-files') === 'true'
                  `);

                  if (!shouldKeepCache) {
                    fs.unlink(filePath)
                    fs.rm(filePath.replace('.zip', ''), { recursive: true, force: true })
                  }
                } catch (error) {
                  fs.unlink(filePath)
                  fs.rm(filePath.replace('.zip', ''), { recursive: true, force: true })
                }
              }



            } catch (error) {
              console.error('处理响应数据时出错:', error);
              try {
                if (!res.headersSent) {
                  res.writeHead(proxyRes.statusCode || 500);
                  res.end('Response processing error');
                }
              } catch (e) {
                console.error('发送错误响应失败:', e);
              }
            }
          });

          proxyRes.on('error', (error) => {
            if (responseHandled) return; // 防止重复处理
            responseHandled = true;

            console.error('响应流错误:', error);
            try {
              if (!res.headersSent) {
                res.writeHead(500);
                res.end('Response stream error');
              }
            } catch (e) {
              console.error('发送错误响应失败:', e);
            }
          });

        } catch (error) {
          console.error('响应拦截器错误:', error);
          // 不要使用 pipe，而是手动发送错误响应
          try {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Proxy error occurred');
            }
          } catch (e) {
            console.error('发送错误响应失败:', e);
          }
        }

        // 不调用 next()，因为我们已经完全处理了响应
      }
    });

    // 启动本地词库HTTP服务器
    this.startBucketServer();

    console.log('万能答案获取代理服务器已启动: 127.0.0.1:5291');
    this.safeIpcSend('proxy-status', {
      running: true,
      message: '代理服务器已启动，请设置天学网客户端代理为 127.0.0.1:5291'
    });
  }

  stopProxy() {
    if (this.proxyAgent) {
      this.safeIpcSend('capture-status', { capturing: false });
      this.proxyAgent.close();
      this.proxyAgent = null;
      this.safeIpcSend('proxy-status', {
        running: false,
        message: '代理服务器已停止'
      });
    }

    if (this.bucketServer) {
      try {
        this.bucketServer.close();
      } catch (e) {
        console.error('关闭词库HTTP服务器失败:', e);
      }
      this.bucketServer = null;
    }
  }

  setWordPkBucketData(data) {
    this.wordPkBucketData = data;
    console.log('单词PK词库数据已更新，长度:', data ? data.length : 0);
    if (!this.bucketServer) {
      this.startBucketServer();
    }
  }

  startBucketServer() {
    if (this.bucketServer) return;

    try {
      this.bucketServer = http.createServer((req, res) => {
        try {
          if (req.method === 'GET' && req.url && req.url.startsWith('/bucket-detail-info')) {
            if (!this.wordPkBucketData) {
              res.writeHead(404, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              });
              res.end(JSON.stringify({ error: 'no bucket data' }));
              return;
            }

            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(this.wordPkBucketData);
          } else {
            res.writeHead(404, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'not found' }));
          }
        } catch (e) {
          console.error('词库HTTP服务器处理请求失败:', e);
          try {
            res.writeHead(500, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'server error' }));
          } catch (_) {}
        }
      });

      this.bucketServer.listen(5290, '127.0.0.1', () => {
        console.log('单词PK词库本地服务器已启动: http://127.0.0.1:5290/bucket-detail-info');
      });
    } catch (e) {
      console.error('启动词库HTTP服务器失败:', e);
      this.bucketServer = null;
    }
  }

  // 提取下载链接
  extractDownloadUrl(data) {
    try {
      const patterns = [
        /"downloadUrl":"(.*?)"/,
        /"downloadUrl":\s*"(.*?)"/,
        /downloadUrl['"]\s*:\s*['"]([^'"]+)['"]/
      ];

      for (const pattern of patterns) {
        const match = data.match(pattern);
        if (match && match[1]) {
          const url = match[1].replace(/\"/g, '"').replace(/\\/ / g, '/');

          // 只处理 fs.域名/download/ 格式的链接
          if (url.includes('fs.') && url.includes('/download/')) {
            this.downloadUrl = url;
            console.log('发现答案下载链接:', url);
            this.safeIpcSend('download-found', { url: this.downloadUrl });
            this.downloadAndProcessFile(this.downloadUrl);
            return;
          } else {
            console.log('跳过非答案下载链接:', url);
            this.safeIpcSend('traffic-log', {
              method: 'INFO',
              url: `跳过链接: ${url} (不符合 fs.域名/download/ 格式)`,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    } catch (error) {
      console.error('提取下载链接失败:', error);
    }
  }

  // 解压ZIP文件
  async extractZipFile(zipPath, ansDir) {
    try {
      const extractDir = zipPath.replace('.zip', '');

      if (fs.existsSync(extractDir)) {
        fs.removeSync(extractDir);
      }

      fs.ensureDirSync(extractDir);

      const zip = new StreamZip.async({ file: zipPath });
      await zip.extract(null, extractDir);
      await zip.close();

      this.safeIpcSend('process-status', { status: 'processing', message: '正在分析文件结构...' });

      // 扫描所有解压的文件
      const fileStructure = this.scanDirectory(extractDir);

      // 发送文件结构到前端
      this.safeIpcSend('file-structure', {
        structure: fileStructure,
        extractDir: extractDir
      });

      // 查找并处理所有可能的答案文件
      const answerFiles = this.findAnswerFiles(extractDir);

      if (answerFiles.length > 0) {
        this.safeIpcSend('process-status', { status: 'processing', message: `找到 ${answerFiles.length} 个可能的答案文件，正在提取...` });

        let allAnswers = [];
        let processedFiles = [];
        let allFilesContent = []; // 存储所有文件内容

        for (const filePath of answerFiles) {
          try {
            // 读取文件内容
            const content = fs.readFileSync(filePath, 'utf-8');
            const relativePath = path.relative(extractDir, filePath);

            // 存储文件内容
            allFilesContent.push({
              file: relativePath,
              content: content
            });

            const answers = this.extractAnswersFromFile(filePath);
            if (answers.length > 0) {
              allAnswers = allAnswers.concat(answers.map(ans => ({
                ...ans,
                sourceFile: relativePath
              })));
              processedFiles.push({
                file: relativePath,
                answerCount: answers.length,
                success: true
              });
            } else {
              processedFiles.push({
                file: relativePath,
                answerCount: 0,
                success: false,
                error: '未找到答案数据'
              });
            }
          } catch (error) {
            processedFiles.push({
              file: path.relative(extractDir, filePath),
              answerCount: 0,
              success: false,
              error: error.message
            });
          }
        }

        // 发送处理结果
        this.safeIpcSend('files-processed', {
          processedFiles: processedFiles,
          totalAnswers: allAnswers.length
        });

        if (allAnswers.length > 0) {
          // 尝试合并correctAnswer.xml和paper.xml的数据
          const mergedAnswers = this.mergeAnswerData(allAnswers);

          // 保存所有答案到文件
          const answerFile = path.join(ansDir, `answers_${Date.now()}.json`);
          const answerText = JSON.stringify({
            answers: mergedAnswers,
            count: mergedAnswers.length,
            file: answerFile,
            processedFiles: processedFiles
          }, null, 2);

          fs.writeFileSync(answerFile, answerText, 'utf-8');

          this.safeIpcSend('answers-extracted', {
            answers: mergedAnswers,
            count: mergedAnswers.length,
            file: answerFile,
            processedFiles: processedFiles
          });
        } else {
          // 未找到有效答案数据时，展示所有文件内容
          const allContentFile = path.join(ansDir, `all_content_${Date.now()}.txt`);
          const allContentText = allFilesContent.map(item =>
            `文件: ${item.file}\n内容:\n${item.content}\n\n${'='.repeat(50)}\n\n`
          ).join('\n');

          fs.writeFileSync(allContentFile, allContentText, 'utf-8');

          this.safeIpcSend('no-answers-found', {
            message: '所有文件中都未找到有效的答案数据，已显示所有文件内容',
            file: allContentFile,
            filesContent: allFilesContent,
            processedFiles: processedFiles
          });
        }
      } else {
        this.safeIpcSend('process-error', { error: '未找到可能包含答案的文件' });
      }

    } catch (error) {
      this.safeIpcSend('process-error', { error: `解压失败: ${error.message}` });
    }
  }

  // 扫描目录结构
  scanDirectory(dirPath, maxDepth = 3, currentDepth = 0) {
    const result = {
      name: path.basename(dirPath),
      type: 'directory',
      path: dirPath,
      children: []
    };

    if (currentDepth >= maxDepth) {
      return result;
    }

    try {
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          result.children.push(this.scanDirectory(itemPath, maxDepth, currentDepth + 1));
        } else {
          result.children.push({
            name: item,
            type: 'file',
            path: itemPath,
            size: stats.size,
            ext: path.extname(item).toLowerCase()
          });
        }
      }
    } catch (error) {
      console.error(`扫描目录失败: ${dirPath}`, error);
    }

    return result;
  }

  // 查找可能包含答案的文件
  findAnswerFiles(dirPath) {
    const answerFiles = [];

    function searchFiles(dir) {
      try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stats = fs.statSync(itemPath);

          if (stats.isDirectory()) {
            searchFiles(itemPath);
          } else {
            const ext = path.extname(item).toLowerCase();
            const name = item.toLowerCase();

            // 处理 XML、JSON、JS 和 TXT 文件
            if (ext === '.xml' || ext === '.json' || ext === '.js' || ext === '.txt') {
              // 特别关注包含 answer、paper、question 等关键词的文件
              if (name.includes('answer') || name.includes('paper') || name.includes('question') || name.includes('questionData')) {
                answerFiles.push(itemPath);
              }
            }
          }
        }
      } catch (error) {
        console.error(`搜索文件失败: ${dir}`, error);
      }
    }

    searchFiles(dirPath);
    return answerFiles;
  }

  // 从单个文件提取答案
  extractAnswersFromFile(filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const content = fs.readFileSync(filePath, 'utf-8');

      // 根据文件类型选择不同的处理方法
      if (ext === '.json') {
        // JS文件可能是变量赋值形式，需要尝试提取变量内容
        return this.extractFromJSON(content, filePath);
      } else if (ext === '.js') {
        let jsonContent = content;
        // 尝试提取变量赋值语句
        const varMatch = content.match(/var\s+pageConfig\s*=\s*({.+?});?$/s);
        if (varMatch && varMatch[1]) {
          jsonContent = varMatch[1];
        }
        return this.extractFromJS(jsonContent, filePath);
      } else if (ext === '.xml') {
        return this.extractFromXML(content, filePath);
      } else if (ext === '.txt') {
        // 尝试从文本文件中提取答案
        return this.extractFromText(content, filePath);
      }

      return [];
    } catch (error) {
      console.error(`读取文件失败: ${filePath}`, error);
      return [];
    }
  }

  // 从JSON文件提取答案
  extractFromJSON(content, filePath) {
    const answers = [];

    try {
      let jsonData;

      // 首先尝试直接解析为JSON
      try {
        jsonData = JSON.parse(content);
      } catch (e) {
        console.log('无法解析JSON文件，可能该文件为乱码或被编码')
        return []
      }

      // 处理句子跟读题型
      if (jsonData.Data && jsonData.Data.sentences) {
        jsonData.Data.sentences.forEach((sentence, index) => {
          if (sentence.text && sentence.text.length > 2) {
            answers.push({
              question: `第${index + 1}题`,
              answer: sentence.text,
              content: `请朗读: ${sentence.text}`,
              pattern: 'JSON句子跟读模式'
            });
          }
        });
      }

      // 处理单词发音题型
      if (jsonData.Data && jsonData.Data.words) {
        jsonData.Data.words.forEach((word, index) => {
          if (word && word.length > 1) {
            answers.push({
              question: `第${index + 1}题`,
              answer: word,
              content: `请朗读单词: ${word}`,
              pattern: 'JSON单词发音模式'
            });
          }
        });
      }

      if (jsonData.questionObj) {
        const questionAnswers = this.parseQuestionFile(jsonData);
        answers.push(...questionAnswers);
      }

      if (Array.isArray(jsonData.answers)) {
        jsonData.answers.forEach((answer, index) => {
          if (answer && (typeof answer === 'string' || (typeof answer === 'object' && answer.content))) {
            answers.push({
              question: `第${index + 1}题`,
              answer: typeof answer === 'string' ? answer : (answer.content || answer.answer || ''),
              content: typeof answer === 'string' ? answer : (answer.content || answer.answer || ''),
              pattern: 'JSON答案数组模式'
            });
          }
        });
      }

      if (jsonData.questions) {
        jsonData.questions.forEach((question, index) => {
          if (question && question.answer) {
            answers.push({
              question: `第${index + 1}题`,
              answer: question.answer,
              content: `题目: ${question.question || '未知题目'}\n答案: ${question.answer}`,
              pattern: 'JSON题目模式'
            });
          }
        });
      }
    } catch (e) {
      return []
    }
    return answers;
  }

  parseQuestionFile(fileContent) {
    try {
      const config = typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent;
      const questionObj = config.questionObj || {};
      const results = [];

      // 1. 精确检测类型
      const detectedType = this.detectExactType(questionObj);

      // 2. 根据类型调用相应的解析器
      switch (detectedType) {
        case '听后选择':
          return this.parseChoiceQuestions(questionObj);
        case '听后回答':
          return this.parseAnswerQuestions(questionObj);
        case '听后转述':
          return this.parseRetellContent(questionObj);
        case '朗读短文':
          return this.parseReadingContent(questionObj);
        default:
          return this.parseFallback(questionObj);
      }

    } catch (error) {
      console.error(error)
      return [];
    }
  }

  // 精确的类型检测
  detectExactType(questionObj) {
    // 听后选择：有questions_list且包含options
    if ((questionObj.questions_list && questionObj.questions_list.length > 0 &&
      questionObj.questions_list[0].options && questionObj.questions_list[0].options.length > 0) ||
      (questionObj.options && questionObj.options.length > 0 && questionObj.answer_text)) {
      return '听后选择';
    }

    // 听后回答：有record_speak且包含work/show属性，或者questions_list中的record_speak有这些属性
    if (this.hasAnswerAttributes(questionObj)) {
      return '听后回答';
    }

    // 听后转述：有record_speak但没有work/show属性，且内容较长
    if (questionObj.record_speak && questionObj.record_speak.length > 0) {
      const firstItem = questionObj.record_speak[0];
      if (firstItem && !firstItem.work && !firstItem.show &&
        firstItem.content && firstItem.content.length > 100) {
        return '听后转述';
      }
    }

    // 朗读短文：有record_follow_read或者analysis中包含停顿符号
    if (questionObj.record_follow_read ||
      (questionObj.analysis && /\/\//.test(questionObj.analysis))) {
      return '朗读短文';
    }

    return '未知';
  }

  hasAnswerAttributes(questionObj) {
    // 检查顶层的record_speak
    if (questionObj.record_speak && questionObj.record_speak.length > 0) {
      const firstItem = questionObj.record_speak[0];
      if (firstItem && (firstItem.work === "1" || firstItem.work === 1 ||
        firstItem.show === "1" || firstItem.show === 1)) {
        return true;
      }
    }

    // 检查questions_list中的record_speak
    if (questionObj.questions_list && questionObj.questions_list.length > 0) {
      for (const question of questionObj.questions_list) {
        if (question.record_speak && question.record_speak.length > 0) {
          const firstRecord = question.record_speak[0];
          if (firstRecord && (firstRecord.work === "1" || firstRecord.work === 1 ||
            firstRecord.show === "1" || firstRecord.show === 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // 解析听后选择题
  parseChoiceQuestions(questionObj) {
    const results = [];
    // 处理questions_list中的选择题
    if (questionObj.questions_list) {
      questionObj.questions_list.forEach((question, index) => {
        if (question.answer_text && question.options) {
          const correctOption = question.options.find(
            opt => opt.id === question.answer_text
          );
          if (correctOption) {
            results.push({
              question: `第${index + 1}题: ${question.question_text || '未知问题'}`,
              answer: `${question.answer_text}. ${correctOption.content?.trim() || ''}`,
              content: `请回答: ${question.answer_text}. ${correctOption.content?.trim() || ''}`,
              pattern: '听后选择'
            });
          }
        }
      });
    }

    // 处理单个选择题（没有questions_list但在顶层有options）
    if (results.length === 0 && questionObj.options && questionObj.options.length > 0 && questionObj.answer_text) {
      const correctOption = questionObj.options.find(
        opt => opt.id === questionObj.answer_text
      );
      if (correctOption) {
        // 清理问题文本中的HTML标签
        const cleanQuestionText = questionObj.question_text
          ? questionObj.question_text.replace(/<[^>]*>/g, '').trim()
          : '未知问题';

        results.push({
          question: `第1题: ${cleanQuestionText}`,
          answer: `${questionObj.answer_text}. ${correctOption.content?.trim() || ''}`,
          content: `请回答: ${questionObj.answer_text}. ${correctOption.content?.trim() || ''}`,
          pattern: '听后选择'
        });
      }
    }
    return results;
  }

  // 解析听后回答题
  parseAnswerQuestions(questionObj) {
    const results = [];

    // 处理questions_list中的回答
    if (questionObj.questions_list) {
      questionObj.questions_list.forEach((question, qIndex) => {
        if (question.record_speak) {
          const answers = question.record_speak
            .filter(item => item.show === "1" || item.show === 1)
            .map(item => item.content?.trim() || '')
            .filter(content => content && content !== '<answers/>');

          let messageInfo = {
            question: `第${qIndex + 1}题`,
            answer: question.question_text || '未知',
            content: `点击展开全部回答`,
            pattern: '听后回答',
            children: []
          }
          answers.forEach((answer, aIndex) => {
            messageInfo.children.push({
              question: `第${aIndex + 1}个答案`,
              answer: answer,
              content: `请回答: ${answer}`,
              pattern: '听后回答'
            });
          });
          results.push(messageInfo)
        }
      });
    }

    // 处理顶层的record_speak（单个问题的情况）
    if (questionObj.record_speak && results.length === 0) {
      const answers = questionObj.record_speak
        .filter(item => item.show === "1" || item.show === 1)
        .map(item => item.content?.trim() || '')
        .filter(content => content && content !== '<answers/>');

      let messageInfo = {
        question: `第1题`,
        answer: questionObj.question_text || '未知',
        content: `点击展开全部回答`,
        pattern: '听后回答',
        children: []
      }
      answers.forEach((answer, index) => {
        messageInfo.children.push({
          question: `第${index + 1}个答案`,
          answer: answer,
          content: `请回答: ${answer}`,
          pattern: '听后回答'
        });
      });
      results.push(messageInfo)
    }

    return results;
  }

  // 解析听后转述
  parseRetellContent(questionObj) {
    const results = [];

    if (questionObj.record_speak && questionObj.record_speak.length > 0) {
      questionObj.record_speak.forEach((item, itemIndex) => {
        if (item.content) {
          // 按换行符分割内容，每个段落作为一个答案
          const paragraphs = item.content.split('\n')
            .map(p => p.trim())
            .filter(p => p.length > 0);

          paragraphs.forEach((paragraph, pIndex) => {
            results.push({
              question: `第${itemIndex + 1}题-${pIndex == 0 ? '原文' : `参考答案${pIndex}`}`,
              answer: paragraph,
              content: `请回答: ${paragraph}`,
              pattern: '听后转述'
            });
          });
        }
      });
    }

    return results;
  }

  // 解析朗读短文
  parseReadingContent(questionObj) {
    const results = [];

    // 优先从analysis中提取带停顿的文本
    if (questionObj.analysis) {
      const cleanAnalysis = questionObj.analysis
        .replace(/<[^>]*>/g, '') // 移除HTML标签
        .replace(/参考答案[一二一二]：/g, '') // 移除参考答案标记
        .trim();

      if (cleanAnalysis) {
        // 按句号分割但保留原文格式
        const sentences = cleanAnalysis.split(/[.!?]。/)
          .map(s => s.trim())
          .filter(s => s.length > 0);

        sentences.forEach((sentence, index) => {
          results.push({
            question: `第${index + 1}题`,
            answer: sentence,
            content: `请回答: ${sentence}`,
            pattern: '朗读短文'
          });
        });
      }
    }

    // 如果没有analysis，从record_follow_read中提取
    if (results.length === 0 && questionObj.record_follow_read?.paragraph_list) {
      let sentenceCount = 1;
      questionObj.record_follow_read.paragraph_list.forEach((paragraph) => {
        if (paragraph.sentences) {
          paragraph.sentences.forEach((sentence) => {
            if (sentence.content_en) {
              results.push({
                question: `第${sentenceCount}题`,
                answer: sentence.content_en.trim(),
                content: `请回答: ${sentence.content_en.trim()}`,
                pattern: '朗读短文'
              });
              sentenceCount++;
            }
          });
        }
      });
    }

    return results;
  }

  // 备用解析方案
  parseFallback(questionObj) {
    const results = [];

    // 尝试从各种可能的位置提取答案
    if (questionObj.analysis) {
      const text = questionObj.analysis.replace(/<[^>]*>/g, '').trim();
      if (text) {
        results.push({
          question: '第1题',
          answer: text,
          content: `请回答: ${text}`,
          pattern: '分析内容'
        });
      }
    }

    return results;
  }

  extractFromJS(content, filePath) {
    try {
      let jsonData;

      // 首先尝试直接解析为JSON
      try {
        jsonData = JSON.parse(content);
      } catch (e) {
        console.log('无法解析JS文件，可能该文件为不支持的格式')
        return []
      }

      return this.parseQuestionFile(content)
    } catch (error) {
      console.error(`解析JS文件失败: ${filePath}`, error);
      return [];
    }
  }

  // 从文本文件提取答案
  extractFromText(content, filePath) {
    const answers = [];

    try {
      // 尝试匹配常见的答案格式
      const answerPatterns = [
        /答案\s*[:：]\s*([^\n]+)/g,  // 答案: xxx
        /标准答案\s*[:：]\s*([^\n]+)/g, // 标准答案: xxx
        /正确答案\s*[:：]\s*([^\n]+)/g, // 正确答案: xxx
        /参考答案\s*[:：]\s*([^\n]+)/g, // 参考答案: xxx
        /\b[A-D]\b/g  // 单独的选项字母
      ];

      // 按行处理文本
      const lines = content.split('\n');
      let lineNum = 0;

      for (const line of lines) {
        lineNum++;

        // 尝试每个答案模式
        for (const pattern of answerPatterns) {
          const matches = [...line.matchAll(pattern)];

          if (matches.length > 0) {
            matches.forEach((match, index) => {
              if (match[1]) {
                answers.push({
                  question: `文本-${lineNum}-${index + 1}`,
                  answer: match[1].trim(),
                  content: `答案: ${match[1].trim()} (行: ${lineNum})`,
                  pattern: '文本答案模式'
                });
              }
            });
          }
        }

        // 处理单独的选项字母
        const optionMatches = [...line.matchAll(/\b([A-D])\b/g)];
        if (optionMatches.length > 0) {
          answers.push({
            question: `选项-${lineNum}`,
            answer: optionMatches.map(m => m[1]).join(''),
            content: `选项: ${optionMatches.map(m => m[1]).join('')} (行: ${lineNum})`,
            pattern: '文本选项模式'
          });
        }
      }

      return answers;
    } catch (error) {
      console.error(`解析文本文件失败: ${filePath}`, error);
      return [];
    }
  }

  // 合并答案数据
  mergeAnswerData(allAnswers) {
    try {
      // 分离correctAnswer.xml和paper.xml的数据
      const correctAnswers = allAnswers.filter(ans => ans.sourceFile === 'correctAnswer.xml');
      const paperQuestions = allAnswers.filter(ans => ans.sourceFile === 'paper.xml');

      // 如果两个文件都存在，尝试合并
      if (correctAnswers.length > 0 && paperQuestions.length > 0) {
        const mergedAnswers = [];
        let successfulMerges = 0;

        // 为每个正确答案找到对应的题目
        correctAnswers.forEach((correctAns, index) => {
          // 尝试通过elementId匹配（最准确）
          let matchingQuestion = paperQuestions.find(q => q.elementId === correctAns.elementId);

          // 如果elementId匹配失败，尝试通过题目编号匹配
          if (!matchingQuestion) {
            matchingQuestion = paperQuestions.find(q =>
              q.questionNo === (index + 1) ||
              q.question.includes(`第${index + 1}题`)
            );
          }

          if (matchingQuestion) {
            // 检查是否有选项的题目类型
            if (matchingQuestion.options && matchingQuestion.options.length > 0) {
              // 找到对应的正确选项
              const correctOption = matchingQuestion.options.find(opt =>
                opt.id === correctAns.answer
              );

              if (correctOption) {
                // 成功合并选择题，使用合并格式
                mergedAnswers.push({
                  question: `第${index + 1}题`,
                  questionText: matchingQuestion.answer.replace('题目: ', ''),
                  answer: correctAns.answer,
                  answerText: correctOption.text,
                  fullAnswer: `${correctAns.answer}. ${correctOption.text}`,
                  options: matchingQuestion.options,
                  analysis: correctAns.content.includes('解析:') ?
                    correctAns.content.split('解析: ')[1].split('\n答案:')[0] : '',
                  pattern: '合并答案模式',
                  sourceFiles: ['correctAnswer.xml', 'paper.xml']
                });
                successfulMerges++;
              } else {
                // 没有找到对应选项，使用普通格式
                mergedAnswers.push({
                  question: `第${index + 1}题`,
                  answer: correctAns.answer,
                  content: correctAns.content,
                  pattern: correctAns.pattern
                });
              }
            } else {
              // 没有选项的题目类型（如填空题、单词题等），直接合并
              mergedAnswers.push({
                question: `第${index + 1}题`,
                questionText: matchingQuestion.content.replace('题目: ', ''),
                answer: correctAns.answer,
                answerText: correctAns.answer,
                fullAnswer: correctAns.answer,
                analysis: correctAns.content.includes('解析:') ?
                  correctAns.content.split('解析: ')[1].split('\n答案:')[0] : '',
                pattern: '合并答案模式',
                sourceFiles: ['correctAnswer.xml', 'paper.xml']
              });
              successfulMerges++;
            }
          } else {
            // 没有找到匹配的题目，使用普通格式
            mergedAnswers.push({
              question: `第${index + 1}题`,
              answer: correctAns.answer,
              content: correctAns.content,
              pattern: correctAns.pattern
            });
          }
        });

        // 如果成功合并的数量太少（少于总数的50%），回退到普通模式
        if (successfulMerges < correctAnswers.length * 0.5) {
          console.log(`合并成功率过低 (${successfulMerges}/${correctAnswers.length})，回退到普通模式`);
          return allAnswers;
        }

        console.log(`成功合并 ${successfulMerges}/${correctAnswers.length} 个答案`);
        return mergedAnswers;
      }

      // 如果只有一个文件或无法合并，返回原始数据
      return allAnswers;
    } catch (error) {
      console.error('合并答案数据失败:', error);
      return allAnswers;
    }
  }



  // 从XML文件提取答案
  extractFromXML(content, filePath) {
    const answers = [];

    try {
      // 处理correctAnswer.xml文件
      if (filePath.includes('correctAnswer')) {
        // 提取所有element元素，包含id、analysis和answers
        const elementMatches = [...content.matchAll(/<element\s+id="([^"]+)"[^>]*>(.*?)<\/element>/gs)];

        elementMatches.forEach((elementMatch, index) => {
          const elementId = elementMatch[1];
          const elementContent = elementMatch[2];

          if (!elementContent.trim()) {
            return;
          }

          let analysisText = '';

          const analysisMatch = elementContent.match(/<analysis>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/analysis>/s);
          if (analysisMatch && analysisMatch[1]) {
            analysisText = analysisMatch[1].replace(/<[^>]*>/g, '').trim();
          }

          const answersMatch = elementContent.match(/<answers>\s*<!\[CDATA\[([^\]]+)\]\]>\s*<\/answers>/);
          if (answersMatch && answersMatch[1]) {
            const answerText = answersMatch[1].trim();
            answers.push({
              question: `第${answers.length + 1}题`,
              answer: answerText,
              content: analysisText ? `解析: ${analysisText}\n答案: ${answerText}` : `答案: ${answerText}`,
              pattern: 'XML正确答案模式',
              elementId: elementId
            });
          } else {
            const answerMatches = [...elementContent.matchAll(/<answer[^>]*>\s*<!\[CDATA\[([^\]]+)\]\]>\s*<\/answer>/g)];

            if (answerMatches.length > 0) {
              answerMatches.forEach((answerMatch, answerIndex) => {
                const answerText = answerMatch[1].trim();
                if (answerText) {
                  answers.push({
                    question: `第${answers.length + 1}题`,
                    answer: answerText,
                    content: analysisText ? `解析: ${analysisText}\n答案: ${answerText}` : `答案: ${answerText}`,
                    pattern: 'XML正确答案模式',
                    elementId: elementId,
                    answerIndex: answerIndex + 1
                  });
                }
              });
            }
          }
        });
      }

      // 处理paper.xml文件
      if (filePath.includes('paper')) {
        const elementMatches = [...content.matchAll(/<element[^>]*id="([^"]+)"[^>]*>(.*?)<\/element>/gs)];

        elementMatches.forEach((elementMatch) => {
          const elementId = elementMatch[1];
          const elementContent = elementMatch[2];

          // 提取题目编号
          const questionNoMatch = elementContent.match(/<question_no>(\d+)<\/question_no>/);

          // 提取题目文本
          const questionTextMatch = elementContent.match(/<question_text>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/question_text>/s);

          const knowledgeMatch = elementContent.match(/<knowledge>\s*<!\[CDATA\[([^\]]+)\]\]>\s*<\/knowledge>/);

          if (questionNoMatch && questionTextMatch) {
            const questionNo = parseInt(questionNoMatch[1]);
            let questionText = questionTextMatch[1];

            questionText = questionText.replace(/<img[^>]*>/g, '[音频]').replace(/<[^>]*>/g, '').trim();

            const optionsMatches = [...elementContent.matchAll(/<option\s+id="([^"]+)"\s*[^>]*>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/option>/gs)];

            let answerInfo = {
              question: `第${questionNo}题`,
              answer: knowledgeMatch ? knowledgeMatch[1].trim() : '未找到答案',
              content: `题目: ${questionText}`,
              pattern: 'XML题目模式',
              elementId: elementId,
              questionNo: questionNo
            };

            if (optionsMatches.length > 0) {
              const optionsText = optionsMatches.map(optionMatch =>
                `${optionMatch[1]}. ${optionMatch[2].trim()}`
              ).join('\n');

              answerInfo.content = `题目: ${questionText}\n\n选项:\n${optionsText}`;
              answerInfo.pattern = 'XML题目选项模式';
              answerInfo.options = optionsMatches.map(optionMatch => ({
                id: optionMatch[1],
                text: optionMatch[2].trim()
              }));
            }

            answers.push(answerInfo);
          }
        });
      }

      return answers;
    } catch (error) {
      console.error(`解析XML文件失败: ${filePath}`, error);
      return [];
    }
  }
  async downloadFileByUuid(uuid, filePath) {
    const fileInfo = this.trafficCache.get(uuid);
    if (!fileInfo) {
      throw new Error('数据不存在');
    }

    let content = fileInfo.responseBody
    if (fileInfo.contentType && (fileInfo.contentType.includes('image') || fileInfo.contentType.includes('octet-stream'))) {
      content = fileInfo.originalResponse
      await fs.promises.writeFile(filePath, fileInfo.originalResponse);
    } else {
      const textContent = typeof content === 'string' ? content : fileInfo.originalResponse.toString('utf-8');
      await fs.promises.writeFile(filePath, textContent, 'utf-8');
    }
  }
  async clearCache() {
    this.trafficCache.clear()
    try {
      const shouldKeepCache = await this.mainWindow.webContents.executeJavaScript(`
        localStorage.getItem('keep-cache-files') === 'true'
      `);

      if (!shouldKeepCache) {
        fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      fs.rm(tempDir, { recursive: true, force: true });
    }
  }
  getTrafficByUuid(uuid) {
    return this.trafficCache.get(uuid)
  }

  // 获取规则类型列表
  // 检查是否是PK文件信息请求
  isPkFileInfoRequest(url) {
    return url.includes('https://fs.up366.cn/fileinfo/');
  }

  // 检查是否是PK文件请求
  isPkFileRequest(url) {
    return url.includes('https://cdn-ws.up366.cn/cn/files/feishu/');
  }

  // 处理PK文件信息请求
  handlePkFileInfoRequest(url, clientReq, clientRes, requestOptions, ssl) {
    console.log(`检测到PK文件信息请求: ${url}`);

    const config = this.pkConfig || {};
    if (!config.enabled) {
      const protocol = ssl ? https : http;
      try {
        const req = protocol.request(requestOptions, (res) => {
          Object.keys(res.headers).forEach(key => {
            try {
              clientRes.setHeader(key, res.headers[key]);
            } catch (e) {
            }
          });
          clientRes.writeHead(res.statusCode);
          res.pipe(clientRes);
        });
        req.on('error', (error) => {
          console.error('文件信息请求转发错误:', error);
          this.handleFileInfoError(clientRes, error);
        });
        if (clientReq.method === 'POST' || clientReq.method === 'PUT') {
          clientReq.pipe(req);
        } else {
          req.end();
        }
      } catch (error) {
        console.error('创建文件信息转发请求失败:', error);
        this.handleFileInfoError(clientRes, error);
      }
      return;
    }

    const protocol = ssl ? https : http;

    try {
      const req = protocol.request(requestOptions, (res) => {
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          try {
            const responseBuffer = Buffer.concat(chunks);
            let responseBody = responseBuffer.toString('utf-8');

            console.log('修改文件信息响应中的MD5和大小');

            const md5 = config.md5 || '1ddb71ec870ca3a6fd22d6e6c8ac18f8';
            const size = config.size || 25329247;

            responseBody = responseBody.replace(/"filemd5":"[^"]+"/g, `"filemd5":"${md5}"`);
            responseBody = responseBody.replace(/"objectMD5":"[^"]+"/g, `"objectMD5":"${md5}"`);
            responseBody = responseBody.replace(/"filesize":\d+/g, `"filesize":${size}`);
            responseBody = responseBody.replace(/"objectSize":\d+/g, `"objectSize":${size}`);

            // 继续让答案下载提取逻辑有机会工作
            try {
              this.extractDownloadUrl(responseBody);
            } catch (e) {
              console.error('调用extractDownloadUrl失败:', e);
            }

            const modifiedBuffer = Buffer.from(responseBody, 'utf-8');

            Object.keys(res.headers).forEach(key => {
              try {
                if (key.toLowerCase() === 'content-length') {
                  clientRes.setHeader(key, modifiedBuffer.length);
                } else {
                  clientRes.setHeader(key, res.headers[key]);
                }
              } catch (e) {
              }
            });

            if (!clientRes.headersSent) {
              clientRes.writeHead(res.statusCode);
              clientRes.write(modifiedBuffer);
              clientRes.end();
            }

            this.safeIpcSend('pk-request-processed', {
              type: 'fileinfo',
              url: url,
              mode: 'simple'
            });

          } catch (error) {
            console.error('处理文件信息响应失败:', error);
            this.handleFileInfoError(clientRes, error);
          }
        });

        res.on('error', (error) => {
          console.error('文件信息请求响应错误:', error);
          this.handleFileInfoError(clientRes, error);
        });
      });

      req.on('error', (error) => {
        console.error('文件信息请求发送错误:', error);
        this.handleFileInfoError(clientRes, error);
      });

      req.on('timeout', () => {
        console.log('文件信息请求超时');
        req.destroy();
        this.handleFileInfoError(clientRes, new Error('文件信息请求超时'));
      });

      req.setTimeout(30000);

      if (clientReq.method === 'POST' || clientReq.method === 'PUT') {
        clientReq.on('data', (chunk) => {
          req.write(chunk);
        });

        clientReq.on('end', () => {
          req.end();
        });

        clientReq.on('error', (error) => {
          console.error('客户端请求流错误:', error);
          req.destroy();
          this.handleFileInfoError(clientRes, error);
        });
      } else {
        req.end();
      }

    } catch (error) {
      console.error('创建文件信息请求失败:', error);
      this.handleFileInfoError(clientRes, error);
    }
  }

  // 处理PK文件请求
  handlePkFileRequest(url, clientReq, clientRes, requestOptions, ssl) {
    console.log(`检测到PK文件请求: ${url}`);

    const config = this.pkConfig || {};
    if (!config.enabled) {
      const protocol = ssl ? https : http;
      try {
        const req = protocol.request(requestOptions, (res) => {
          Object.keys(res.headers).forEach(key => {
            try {
              clientRes.setHeader(key, res.headers[key]);
            } catch (e) {
            }
          });
          clientRes.writeHead(res.statusCode);
          res.pipe(clientRes);
        });
        req.on('error', (error) => {
          console.error('文件请求转发错误:', error);
          this.releaseRequestWithError({ clientRes }, error);
        });
        if (clientReq.method === 'POST' || clientReq.method === 'PUT') {
          clientReq.pipe(req);
        } else {
          req.end();
        }
      } catch (error) {
        console.error('创建文件转发请求失败:', error);
        this.releaseRequestWithError({ clientRes }, error);
      }
      return;
    }

    this.handlePkFileRequestSimple(url, clientReq, clientRes, requestOptions, ssl);
  }

  // 处理PK文件请求
  async handlePkFileRequestSimple(url, clientReq, clientRes, requestOptions, ssl) {
    try {
      console.log('使用zip替换PK文件响应');

      const config = this.pkConfig || {};
      const zipPath = config.zipPath || path.join(__dirname, 'auto-pk', 'auto-pk.zip');
      const md5 = config.md5 || '1ddb71ec870ca3a6fd22d6e6c8ac18f8';
      const size = config.size || 25329247;
      const md5Base64 = config.md5Base64 || Buffer.from(md5, 'hex').toString('base64');

      if (!fs.existsSync(zipPath)) {
        throw new Error(`zip文件不存在: ${zipPath}`);
      }

      const zipBuffer = fs.readFileSync(zipPath);

      if (clientRes.destroyed) {
        console.log('客户端连接已断开');
        return;
      }

      try {
        clientRes.setHeader('Content-Type', 'application/zip');
        clientRes.setHeader('Content-Length', zipBuffer.length);
        clientRes.setHeader('ETag', `"${md5}"`);
        clientRes.setHeader('Content-MD5', md5Base64);
        clientRes.setHeader('Access-Control-Allow-Origin', '*');
        clientRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        clientRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      } catch (headerError) {
        console.error('设置响应头失败:', headerError);
      }

      if (!clientRes.headersSent) {
        clientRes.writeHead(200);
        clientRes.write(zipBuffer);
        clientRes.end();
      }

      this.safeIpcSend('pk-request-processed', {
        type: 'file',
        url: url,
        mode: 'auto'
      });

      this.safeIpcSend('pk-injection-success', {
        message: 'PK注入完成',
        url: url,
        newMd5: md5,
        newSize: size
      });

    } catch (error) {
      console.error('简单模式处理失败:', error);
      this.handleFileInfoError(clientRes, error);
    }
  }

  // 错误时释放请求
  releaseRequestWithError(request, error) {
    try {
      if (!request.clientRes.headersSent) {
        request.clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
        request.clientRes.end(`Proxy error: ${error.message}`);
      }
    } catch (e) {
      console.error('发送错误响应失败:', e);
    }
  }
}

module.exports = AnswerProxy;