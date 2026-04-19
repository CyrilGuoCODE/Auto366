const http = require('http');
const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const os = require('os');
const StreamZip = require('node-stream-zip');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');
const Proxy = require('http-mitm-proxy').Proxy;
const { ipcMain, app } = require('electron');
const AnswerExtractor = require('./answer');

class ProxyServer {
  constructor(certManager) {
    this.certManager = certManager;
    this.bucketServer = null;
    this.proxyPort = 5291;
    this.bucketPort = 5290;
    this.isRunning = false;
    this.isCapturing = false;
    this.answerCaptureEnabled = true;
    this.mainWindow = null;
    this.trafficCache = new Map();
    this.responseRules = [];
    this.serverDatas = {};
    this.isStopping = false;
    this.proxy = null;
    this.answerExtractor = new AnswerExtractor();
    
    // 初始化目录
    this.appPath = process.cwd();
    this.tempDir = path.join(this.appPath, 'temp');
    this.ansDir = path.join(this.appPath, 'answers');
    this.fileDir = path.join(this.appPath, 'file');
    this.rulesDir = path.join(process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : path.join(process.env.HOME, '.local', 'share')), 'Auto366', 'response-rules');
    
    // 加载响应规则
    this.loadResponseRules();
  }

  // 启动代理服务器
  startProxyPromise() {
    return new Promise((resolve) => {
      // 创建新的代理实例
      this.proxy = new Proxy();

      this.proxy.onError(function (ctx, err) {
        console.error('代理出错:', err);
      });

      this.proxy.onRequest((ctx, callback) => {
        const protocol = "http"; // 不知道怎么检测http还是https
        const fullUrl = `${protocol}://${ctx.clientToProxyRequest.headers.host}${ctx.clientToProxyRequest.url}`;

        const isAnswerCaptureEnabled = this.answerCaptureEnabled;

        let requestInfo = {
          method: ctx.clientToProxyRequest.method,
          url: fullUrl,
          host: ctx.clientToProxyRequest.headers.host,
          timestamp: new Date().toISOString(),
          isHttps: false,
          requestHeaders: ctx.clientToProxyRequest.headers,
          uuid: uuidv4(),
        }

        if (!isAnswerCaptureEnabled) {
          return callback();
        }

        let requestBody = [], responseBody = [];
        ctx.onRequestData((ctx, chunk, callback) => {
          requestBody.push(chunk)
          return callback(null, chunk);
        })
        ctx.onRequestEnd((ctx, callback) => {
          let body = Buffer.concat(requestBody).toString()
          if (ctx.clientToProxyRequest.headers['content-type'] && ctx.clientToProxyRequest.headers['content-type'].includes('application/json')) {
            try {
              body = JSON.stringify(JSON.parse(body), null, 2);
            } catch (error) {
              console.error('解析请求体失败:', error)
            }
          }
          else if (ctx.clientToProxyRequest.headers['content-type'] && ctx.clientToProxyRequest.headers['content-type'].includes('application/x-www-form-urlencoded')) {
            try {
              const params = new URLSearchParams(body);
              const result = Object.fromEntries(params.entries());
              body = JSON.stringify(result, null, 2);
            } catch (error) {
              console.error('解析请求体失败:', error)
            }
          }
          else if (ctx.clientToProxyRequest.headers['content-type']) {
            console.log('未知请求体类型', ctx.clientToProxyRequest.headers['content-type'])
          }
          requestInfo.requestBody = body
          return callback();
        })
        let responseBodyRules = this.haveRules(fullUrl, 'response-body');
        ctx.onResponse((ctx, callback) => {
          if (responseBodyRules.includes(2) && ctx.serverToProxyResponse.statusCode !== 200) {
            ctx.serverToProxyResponse.statusCode = 200;
            ctx.serverToProxyResponse.headers['content-type'] = 'application/octet-stream'
            delete ctx.serverToProxyResponse.headers['content-range'];
            delete ctx.serverToProxyResponse.headers['accept-ranges'];
          }

          // 如果是文件下载请求且需要应用规则，修改响应头
          if (responseBodyRules.includes(2)) {
            // 检查是否是文件下载请求
            const isFileDownloadRequest = fullUrl.endsWith('.zip') ||
              fullUrl.includes('/download/') ||
              fullUrl.includes('/cn/files/');

            if (isFileDownloadRequest) {
              // 获取匹配的规则并计算新文件的MD5
              for (const rule of this.responseRules) {
                if (!this.isRuleEffective(rule) || rule.isGroup || rule.type !== 'zip-implant') continue;

                const urlMatches = this.urlMatchesPattern(fullUrl, rule.urlZip);
                if (urlMatches && fs.existsSync(rule.zipImplant)) {
                  const buffer = fs.readFileSync(rule.zipImplant);
                  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
                  const md5Base64 = Buffer.from(md5, 'hex').toString('base64');

                  // 修改响应头
                  ctx.serverToProxyResponse.headers['etag'] = md5;
                  ctx.serverToProxyResponse.headers['content-md5'] = md5Base64;
                  ctx.serverToProxyResponse.headers['content-length'] = buffer.length.toString();

                  if (rule.maxTriggers !== undefined) {
                    rule.currentTriggers = (rule.currentTriggers || 0) + 1;
                    this.saveResponseRules();
                  }

                  // 发送响应头修改日志
                  this.safeIpcSend('rule-log', {
                    type: 'success',
                    message: `规则 "${rule.name}" 修改响应头 (${rule.currentTriggers || 1}/${rule.maxTriggers || '∞'})`,
                    ruleId: rule.id,
                    ruleName: rule.name,
                    url: fullUrl,
                    details: `ETag: ${md5}, Content-MD5: ${md5Base64}`
                  });

                  break;
                }
              }
            }
          }

          requestInfo.statusCode = ctx.serverToProxyResponse.statusCode;
          requestInfo.statusMessage = ctx.serverToProxyResponse.statusMessage;
          requestInfo.responseHeaders = ctx.serverToProxyResponse.headers;
          requestInfo.contentType = ctx.serverToProxyResponse.headers['content-type'];
          requestInfo.contentEncoding = ctx.serverToProxyResponse.headers['content-encoding'];
          requestInfo.isCompressed = !!requestInfo.contentEncoding;
          return callback();
        })
        ctx.onResponseData((ctx, chunk, callback) => {
          responseBody.push(chunk)
          if (responseBodyRules.includes(2)) return callback(null, Buffer.from(''));
          else return callback(null, chunk);
        })
        ctx.onResponseEnd(async (ctx, callback) => {
          let { buffer, text } = await this.decompressResponse(Buffer.concat(responseBody), ctx.serverToProxyResponse.headers['content-encoding']);
          if (responseBodyRules.includes(2)) {
            buffer = this.applyZipImplantRules(fullUrl, buffer);
            ctx.proxyToClientResponse.write(buffer);
          }
          const isJson = /application\/json/.test(requestInfo.contentType);
          const isFile = /application\/octet-stream|image/.test(requestInfo.contentType);
          if (isJson) {
            try {
              requestInfo.responseBody = JSON.stringify(JSON.parse(text), null, 2);
            } catch (e) {
              requestInfo.responseBody = text;
            }
          }
          else if (isFile) {
            if (requestInfo.responseHeaders["Content-Disposition"]) {
              requestInfo.responseBody = requestInfo.responseHeaders["Content-Disposition"].replaceAll('filename=', '').replaceAll('"', '')
            } else {
              requestInfo.responseBody = decodeURIComponent(fullUrl.match(/https?:\/\/[^\/]+\/(?:[^\/]+\/)*([^\/?]+)(?=\?|$)/)[1])
            }
          }
          else {
            requestInfo.responseBody = text;
          }
          requestInfo.bodySize = requestInfo.responseBody.length;
          this.safeIpcSend('traffic-log', requestInfo);
          requestInfo.originalResponse = buffer
          this.trafficCache.set(requestInfo.uuid, requestInfo);

          let extracted_answers;

          // 答案提取
          if (isFile && requestInfo.responseBody.includes('zip')) {
            fs.mkdirSync(this.tempDir, { recursive: true });
            fs.mkdirSync(this.ansDir, { recursive: true });
            const filePath = path.join(this.tempDir, requestInfo.responseBody)
            await this.downloadFileByUuid(requestInfo.uuid, filePath)
            extracted_answers = await this.extractZipFile(filePath, this.ansDir)

            try {
              const shouldKeepCache = await this.mainWindow.webContents.executeJavaScript(`
                    localStorage.getItem('keep-cache-files') === 'true'
                  `);

              if (!shouldKeepCache) {
                await fs.unlink(filePath)
                await fs.rm(filePath.replace('.zip', ''), { recursive: true, force: true })
              }
            } catch (error) {
              await fs.unlink(filePath)
              await fs.rm(filePath.replace('.zip', ''), { recursive: true, force: true })
            }
          }
          else {
            extracted_answers = {};
          }

          if (responseBodyRules.includes(3)) {
            this.applyAnswerUploadRules(fullUrl, buffer, extracted_answers)
          }

          return callback()
        })
        return callback();
      });

      this.proxy.listen({ host: '127.0.0.1', port: this.proxyPort }, resolve);
    });
  }

  // 启动代理服务器
  start() {
    return new Promise((resolve, reject) => {
      try {
        // 启动HTTP代理服务器
        this.startProxyPromise()
          .then(() => {
            // 启动本地答案服务器
            this.startBucketServer();

            this.isRunning = true;
            resolve({ running: true, host: '127.0.0.1', port: this.proxyPort });
          })
          .catch((error) => {
            console.error('启动代理服务器失败:', error);
            reject(error);
          });

      } catch (error) {
        console.error('启动代理服务器失败:', error);
        reject(error);
      }
    });
  }

  // 停止代理服务器
  stop() {
    return new Promise((resolve) => {
      try {
        this.isStopping = true;
        console.log('开始停止代理服务器...');

        // 关闭代理服务器
        if (this.proxy) {
          console.log('代理对象存在，检查close方法...');
          console.log('代理对象类型:', typeof this.proxy);
          console.log('代理对象close方法:', typeof this.proxy.close);

          if (typeof this.proxy.close === 'function') {
            try {
              // 不使用回调，直接关闭
              this.proxy.close();
              console.log('代理服务器关闭命令已发送');

              // 清理代理对象引用
              this.proxy = null;

              this.handleProxyStop();
              resolve({ success: true });
            } catch (closeError) {
              console.error('调用proxy.close时出错:', closeError);
              this.proxy = null;
              this.handleProxyStop();
              resolve({ success: true });
            }
          } else {
            console.log('代理对象没有close方法，直接处理停止');
            this.handleProxyStop();
            resolve({ success: true });
          }
        } else {
          console.log('代理服务器未运行或已关闭');
          this.handleProxyStop();
          resolve({ success: true });
        }

        setTimeout(() => {
          if (this.isStopping) {
            console.log('代理服务器停止超时，强制完成');
            this.proxy = null;
            this.handleProxyStop();
            resolve({ success: true });
          }
        }, 3000);

      } catch (error) {
        console.error('停止代理服务器时出错:', error);
        this.proxy = null;
        this.handleProxyStop();
        resolve({ success: false, error: error.message });
      }
    });
  }

  handleProxyStop() {
    this.isStopping = false;
    console.log('处理代理服务器停止...');

    if (this.bucketServer) {
      try {
        this.bucketServer.close(() => {
          console.log('答案服务器已关闭');
        });
      } catch (e) {
        console.error('关闭答案服务器失败:', e);
      }
      this.bucketServer = null;
    }

    this.isRunning = false;
    this.isCapturing = false;

    this.safeIpcSend('proxy-status', {
      running: false,
      host: null,
      port: null,
      message: '代理服务器已停止'
    });

    console.log('代理服务器停止处理完成');
  }

  // 处理HTTP请求
  handleHttpRequest(req, res) {
    try {
      const urlObj = url.parse(req.url);
      if (urlObj.pathname === '/') {
        // 本地代理服务器信息页面
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Auto366 Proxy Server</h1><p>代理服务器运行中...</p>');
        return;
      }

      // 处理HTTPS连接
      if (req.method === 'CONNECT') {
        this.handleHttpsConnect(req, res);
      } else {
        // 处理HTTP请求
        this.proxyHttpRequest(req, res);
      }
    } catch (error) {
      console.error('处理HTTP请求失败:', error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  // 处理HTTPS连接
  handleHttpsConnect(req, res) {
    try {
      const [host, port] = req.url.split(':');
      const socket = require('net').connect(port || 443, host, () => {
        res.writeHead(200, 'Connection Established');
        res.end();

        // 建立双向通信
        socket.pipe(req.connection);
        req.connection.pipe(socket);
      });

      socket.on('error', (error) => {
        console.error('HTTPS连接失败:', error);
        req.connection.end();
      });

      req.connection.on('error', (error) => {
        socket.end();
      });
    } catch (error) {
      console.error('处理HTTPS连接失败:', error);
      res.end();
    }
  }

  // 处理HTTPS请求
  handleHttpsRequest(req, res) {
    try {
      const urlObj = url.parse(`https://${req.headers.host}${req.url}`);
      this.proxyHttpRequest(req, res, true);
    } catch (error) {
      console.error('处理HTTPS请求失败:', error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  // 代理HTTP请求
  proxyHttpRequest(req, res, isHttps = false) {
    try {
      const urlObj = url.parse(isHttps ? `https://${req.headers.host}${req.url}` : req.url);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.path,
        method: req.method,
        headers: req.headers
      };

      // 移除代理相关的头部
      delete options.headers['proxy-connection'];
      delete options.headers['proxy-authorization'];

      const protocol = isHttps ? https : http;
      const proxyReq = protocol.request(options, (proxyRes) => {
        // 处理响应
        this.handleProxyResponse(req, res, proxyRes, isHttps);
      });

      // 处理请求体
      let requestBody = '';
      req.on('data', (chunk) => {
        requestBody += chunk;
        proxyReq.write(chunk);
      });

      req.on('end', () => {
        proxyReq.end();

        // 记录请求信息
        if (this.answerCaptureEnabled) {
          this.logRequest(req, urlObj, requestBody);
        }
      });

      proxyReq.on('error', (error) => {
        console.error('代理请求失败:', error);
        res.writeHead(502);
        res.end('Bad Gateway');
      });

    } catch (error) {
      console.error('代理HTTP请求失败:', error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  // 处理代理响应
  handleProxyResponse(req, res, proxyRes, isHttps) {
    try {
      // 复制响应头部
      res.writeHead(proxyRes.statusCode, proxyRes.headers);

      // 处理响应体
      let responseBody = '';
      proxyRes.on('data', (chunk) => {
        responseBody += chunk;
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        res.end();

        // 记录响应信息
        if (this.answerCaptureEnabled) {
          this.logResponse(req, proxyRes, responseBody, isHttps);
        }
      });

    } catch (error) {
      console.error('处理代理响应失败:', error);
      res.end();
    }
  }

  // 记录请求信息
  logRequest(req, urlObj, body) {
    const requestId = crypto.randomUUID();
    const requestData = {
      uuid: requestId,
      method: req.method,
      url: urlObj.href,
      headers: req.headers,
      body: body,
      timestamp: new Date().toISOString()
    };

    this.requestMap.set(requestId, requestData);

    // 发送请求日志
    if (this.onTrafficLog) {
      this.onTrafficLog(requestData);
    }
  }

  // 记录响应信息
  logResponse(req, proxyRes, body, isHttps) {
    const requestId = crypto.randomUUID();
    const responseData = {
      uuid: requestId,
      status: proxyRes.statusCode,
      headers: proxyRes.headers,
      body: body,
      timestamp: new Date().toISOString()
    };

    // 发送响应日志
    if (this.onTrafficLog) {
      this.onTrafficLog(responseData);
    }
  }

  // 启动本地答案服务器
  startBucketServer() {
    this.bucketServer = http.createServer((req, res) => {
      this.handleBucketRequest(req, res);
    });

    this.bucketServer.listen(this.bucketPort, () => {
      console.log(`本地答案服务器已启动，监听端口: ${this.bucketPort}`);
    });
  }

  // 处理本地答案服务器请求
  handleBucketRequest(req, res) {
    try {
      const urlObj = url.parse(req.url);
      const pathname = urlObj.pathname;

      if (pathname === '/') {
        // 服务器信息页面
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Auto366 Bucket Server</h1><p>本地答案服务器运行中...</p>');
        return;
      }

      // 处理其他请求
      res.writeHead(404);
      res.end('Not Found');

    } catch (error) {
      console.error('处理本地服务器请求失败:', error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  // 设置代理端口
  setProxyPort(port) {
    this.proxyPort = port;
    return { success: true };
  }

  // 获取代理端口
  getProxyPort() {
    return this.proxyPort;
  }

  // 设置答案服务器端口
  setBucketPort(port) {
    this.bucketPort = port;
    return { success: true };
  }

  // 获取答案服务器端口
  getBucketPort() {
    return this.bucketPort;
  }

  // 设置答案捕获启用状态
  setAnswerCaptureEnabled(enabled) {
    this.answerCaptureEnabled = enabled;
  }

  // 获取答案捕获启用状态
  getAnswerCaptureEnabled() {
    return this.answerCaptureEnabled;
  }

  // 清理HTML标签和转义符号的通用函数
  cleanHtmlText(text) {
    if (!text) return '';
    return text
      .replace(/<[^>]*>/g, '') // 移除HTML标签
      .replace(/&nbsp;/g, ' ') // 非断行空格
      .replace(/&amp;/g, '&') // &符号
      .replace(/&lt;/g, '<') // 小于号
      .replace(/&gt;/g, '>') // 大于号
      .replace(/&quot;/g, '"') // 双引号
      .replace(/&#39;/g, "'") // 单引号
      .replace(/&apos;/g, "'") // 单引号（另一种形式）
      .replace(/&hellip;/g, '...') // 省略号
      .replace(/&mdash;/g, '—') // 长破折号
      .replace(/&ndash;/g, '–') // 短破折号
      .replace(/&ldquo;/g, '"') // 左双引号
      .replace(/&rdquo;/g, '"') // 右双引号
      .replace(/&lsquo;/g, "'") // 左单引号
      .replace(/&rsquo;/g, "'") // 右单引号
      .trim();
  }

  // 安全的IPC发送函数
  safeIpcSend(channel, data) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
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
      fs.ensureDirSync(this.rulesDir);
      const rulesFile = path.join(this.rulesDir, 'rules.json');

      if (fs.existsSync(rulesFile)) {
        const rulesData = fs.readFileSync(rulesFile, 'utf-8');
        this.responseRules = JSON.parse(rulesData);
      } else {
        this.responseRules = [];
      }
    } catch (error) {
      console.error('加载响应体更改规则失败:', error);
      this.responseRules = [];
    }
  }

  // 保存响应体更改规则
  saveResponseRules(rules = null) {
    try {
      fs.ensureDirSync(this.rulesDir);
      const rulesFile = path.join(this.rulesDir, 'rules.json');

      // 如果传入了规则数组，则使用传入的规则；否则使用当前规则
      const rulesToSave = rules !== null ? rules : this.responseRules;

      fs.writeFileSync(rulesFile, JSON.stringify(rulesToSave, null, 2), 'utf-8');

      // 如果传入了规则数组，则更新当前规则
      if (rules !== null) {
        this.responseRules = rules;
      }

      return true;
    } catch (error) {
      console.error('保存响应体更改规则失败:', error);
      return false;
    }
  }

  // 获取所有规则
  getResponseRules() {
    return this.responseRules || [];
  }

  // 添加或更新规则
  saveRule(rule) {
    try {
      if (rule.id) {
        // 更新现有规则
        const index = this.responseRules.findIndex(r => r.id === rule.id);
        if (index !== -1) {
          const updatedRule = {
            ...this.responseRules[index],
            ...rule,
            updatedAt: new Date().toISOString()
          };
          this.responseRules[index] = updatedRule;
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
      // 查找要删除的规则
      const ruleToDelete = this.responseRules.find(r => r.id === ruleId);

      if (!ruleToDelete) {
        return false;
      }

      // 如果是规则集，需要删除规则集和所有属于它的规则
      if (ruleToDelete.isGroup) {
        this.responseRules = this.responseRules.filter(r =>
          r.id !== ruleId && r.groupId !== ruleId
        );
      } else {
        // 如果是单个规则，只删除该规则
        this.responseRules = this.responseRules.filter(r => r.id !== ruleId);
      }

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

        if (rule.isGroup && enabled) {
          const childRules = this.responseRules.filter(r => r.groupId === rule.id);
          childRules.forEach(childRule => {
            if (childRule.maxTriggers !== undefined) {
              childRule.currentTriggers = 0;
            }
          });
        }

        if (!rule.isGroup && rule.maxTriggers !== undefined) {
          rule.currentTriggers = 0;
        }

        return this.saveResponseRules();
      }
      return false;
    } catch (error) {
      console.error('切换规则状态失败:', error);
      return false;
    }
  }

  // 重置规则触发次数
  resetRuleTriggers(ruleId) {
    try {
      const rule = this.responseRules.find(r => r.id === ruleId);
      if (rule) {
        rule.updatedAt = new Date().toISOString();

        if (rule.isGroup) {
          const childRules = this.responseRules.filter(r => r.groupId === rule.id);
          childRules.forEach(childRule => {
            if (childRule.maxTriggers !== undefined) {
              childRule.currentTriggers = 0;
            }
          });
        } else if (rule.maxTriggers !== undefined) {
          rule.currentTriggers = 0;
        }

        return this.saveResponseRules();
      }
      return false;
    } catch (error) {
      console.error('重置规则触发次数失败:', error);
      return false;
    }
  }

  // 检查端口是否被占用
  async checkPortInUse(port) {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true); // 端口被占用
        } else {
          resolve(false);
        }
      });
      server.once('listening', () => {
        server.close();
        resolve(false); // 端口未被占用
      });
      server.listen(port, '127.0.0.1');
    });
  }

  // 查找占用端口的进程
  async findProcessByPort(port) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      if (process.platform === 'win32') {
        exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
          if (error || !stdout) {
            resolve(null);
            return;
          }
          const lines = stdout.split('\n');
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const localAddress = parts[1];
              if (localAddress.includes(`:${port}`)) {
                const pid = parseInt(parts[4]);
                if (!isNaN(pid)) {
                  resolve(pid);
                  return;
                }
              }
            }
          }
          resolve(null);
        });
      } else {
        // Linux/Mac
        exec(`lsof -i :${port} -t`, (error, stdout) => {
          if (error || !stdout) {
            resolve(null);
            return;
          }
          const pid = parseInt(stdout.trim());
          if (!isNaN(pid)) {
            resolve(pid);
          } else {
            resolve(null);
          }
        });
      }
    });
  }

  // 结束指定进程
  async killProcess(pid) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      if (!pid) {
        resolve(false);
        return;
      }
      const command = process.platform === 'win32' ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
      exec(command, (error) => {
        if (error) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  // 检查URL是否匹配规则模式（支持通配符）
  urlMatchesPattern(url, pattern) {
    // 将通配符模式转换为正则表达式
    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
      .replace(/\\\*\\\*/g, '.*') // 先处理 ** 替换为匹配任意字符（包括斜杠）
      .replace(/\\\*/g, '[^/]*'); // 再处理单个 * 替换为匹配非斜杠的任意字符

    const regex = new RegExp('^' + regexPattern + '$');
    return regex.test(url);
  }

  isRuleEffective(rule) {
    if (!rule.enabled) return false;

    if (rule.isGroup) {
      return rule.enabled;
    }

    if (rule.groupId) {
      const ruleGroup = this.responseRules.find(r => r.id === rule.groupId && r.isGroup);
      if (ruleGroup && !ruleGroup.enabled) {
        return false;
      }
    }

    // 检查触发次数限制
    if (rule.maxTriggers !== undefined && rule.maxTriggers > 0) {
      const currentTriggers = rule.currentTriggers || 0;
      if (currentTriggers >= rule.maxTriggers) {
        return false;
      }
    }

    return true;
  }

  // 检查是否有启用的zip注入规则
  hasEnabledZipImplantRules() {
    return this.responseRules.some(rule =>
      this.isRuleEffective(rule) &&
      !rule.isGroup &&
      rule.type === 'zip-implant' &&
      fs.existsSync(rule.zipImplant)
    );
  }

  haveRules(url, type) {
    let l = [];
    try {
      for (const rule of this.responseRules) {
        if (!this.isRuleEffective(rule)) continue;
        if (rule.isGroup) continue;
        if (rule.type === 'content-change') {
          if (!url.includes(rule.urlPattern)) continue;
          if (type !== rule.changeType) continue;
          l.push(1)
        }
        if (type === 'response-body' && rule.type === 'zip-implant') {
          if (!fs.existsSync(rule.zipImplant)) {
            continue;
          }

          // 检查URL是否匹配规则中的ZIP URL模式（支持通配符）
          const zipUrlMatches = this.urlMatchesPattern(url, rule.urlZip);

          // 检查URL是否匹配规则中的fileinfo URL模式（如果规则有定义的话）
          const fileinfoUrlMatches = rule.urlFileinfo ? this.urlMatchesPattern(url, rule.urlFileinfo) : true;

          // 支持文件信息请求的多种域名模式（更精确的判断）
          const isFileInfoRequest = url.includes('/fileinfo/') ||
            (url.includes('/files/') && !url.endsWith('.zip')) ||
            (url.includes('.json') && (url.includes('/fileinfo/') || url.includes('/files/')));

          // 支持文件下载请求的多种模式  
          const isFileDownloadRequest = url.endsWith('.zip') ||
            url.includes('/download/') ||
            url.includes('/cn/files/');

          // 对于文件信息请求，优先使用fileinfo URL模式匹配，如果没有设置则使用通用匹配
          // 对于文件下载请求，使用ZIP URL模式匹配
          if ((isFileInfoRequest && fileinfoUrlMatches) || (zipUrlMatches && isFileDownloadRequest)) {
            l.push(2)

            if (rule.maxTriggers !== undefined) {
              rule.currentTriggers = (rule.currentTriggers || 0) + 1;
              this.saveResponseRules();
            }
          }
        }
        if (type === 'response-body' && rule.type === 'answer-upload') {
          if (!url.includes(rule.urlUpload)) continue;

          if (rule.maxTriggers !== undefined) {
            rule.currentTriggers = (rule.currentTriggers || 0) + 1;
            this.saveResponseRules();
          }

          l.push(3)
        }
      }
    } catch (error) {
      console.error('获取需要应用的规则失败:', error);
      return [];
    }
    return l;
  }

  fileNameMatchesPattern(fileName, pattern) {
    if (!pattern) return true;

    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*');

    const regex = new RegExp('^' + regexPattern + '$', 'i');
    return regex.test(fileName);
  }

  extractFileNameFromResponse(responseBody, url) {
    try {
      if (typeof responseBody === 'string' || Buffer.isBuffer(responseBody)) {
        const bodyStr = responseBody.toString();

        try {
          const jsonData = JSON.parse(bodyStr);

          let objectName = jsonData.objectName || jsonData.object_name;
          let fileName = jsonData.fileName || jsonData.filename || jsonData.file_name;

          if (!objectName && !fileName && jsonData.data) {
            objectName = jsonData.data.objectName || jsonData.data.object_name;
            fileName = jsonData.data.fileName || jsonData.data.filename || jsonData.data.file_name;
          }

          if (objectName && fileName) {
            if (objectName === fileName) {
              return fileName;
            } else {
              return null;
            }
          }

          if (objectName) {
            return objectName;
          }
          if (fileName) {
            return fileName;
          }
        } catch (e) {
          console.error('解析JSON响应体失败:', e);
        }
      }

      return null;
    } catch (error) {
      console.error('提取文件名失败:', error);
      return null;
    }
  }

  // 应用zip注入规则
  applyZipImplantRules(url, responseBody) {
    try {
      for (const rule of this.responseRules) {
        if (!this.isRuleEffective(rule)) continue;
        if (rule.isGroup) continue;
        if (rule.type === 'zip-implant') {
          if (!fs.existsSync(rule.zipImplant)) {
            continue;
          }

          // 检查URL是否匹配规则中的ZIP URL模式（支持通配符）
          const zipUrlMatches = this.urlMatchesPattern(url, rule.urlZip);

          // 检查URL是否匹配规则中的fileinfo URL模式（如果规则有定义的话）
          const fileinfoUrlMatches = rule.urlFileinfo ? this.urlMatchesPattern(url, rule.urlFileinfo) : true;

          // 支持文件信息请求的多种域名模式（更精确的判断）
          const isFileInfoRequest = url.includes('/fileinfo/') ||
            (url.includes('/files/') && !url.endsWith('.zip')) ||
            (url.includes('.json') && (url.includes('/fileinfo/') || url.includes('/files/')));

          // 支持文件下载请求的多种模式  
          const isFileDownloadRequest = url.endsWith('.zip') ||
            url.includes('/download/') ||
            url.includes('/cn/files/');

          // 对于文件信息请求，优先使用fileinfo URL模式匹配，如果没有设置则使用通用匹配
          // 对于文件下载请求，使用ZIP URL模式匹配
          if (isFileInfoRequest && fileinfoUrlMatches) {
            // 检查目标文件名匹配
            if (rule.targetFileName) {
              const extractedFileName = this.extractFileNameFromResponse(responseBody, url);
              if (!extractedFileName || !this.fileNameMatchesPattern(extractedFileName, rule.targetFileName)) {
                continue;
              }
            }

            const buffer = fs.readFileSync(rule.zipImplant);
            const md5 = crypto.createHash('md5').update(buffer).digest('hex');
            const fileSize = buffer.length;

            responseBody = responseBody.toString();

            // 替换MD5相关字段
            responseBody = responseBody.replace(/"filemd5":"[^"]+"/g, `"filemd5":"${md5}"`);
            responseBody = responseBody.replace(/"objectMD5":"[^"]+"/g, `"objectMD5":"${md5}"`);

            // 替换文件大小相关字段
            responseBody = responseBody.replace(/"filesize":\s*\d+/g, `"filesize":${fileSize}`);
            responseBody = responseBody.replace(/"filesize":\s*"\d+"/g, `"filesize":"${fileSize}"`);
            responseBody = responseBody.replace(/"objectSize":\s*\d+/g, `"objectSize":${fileSize}`);
            responseBody = responseBody.replace(/"objectSize":\s*"\d+"/g, `"objectSize":"${fileSize}"`);

            if (rule.maxTriggers !== undefined) {
              rule.currentTriggers = (rule.currentTriggers || 0) + 1;
              this.saveResponseRules();
            }

            return Buffer.from(responseBody);
          }
          else if (zipUrlMatches && isFileDownloadRequest) {
            if (rule.maxTriggers !== undefined) {
              rule.currentTriggers = (rule.currentTriggers || 0) + 1;
              this.saveResponseRules();
            }

            return fs.readFileSync(rule.zipImplant);
          }
        }
      }
    } catch (error) {
      console.error('应用zip注入规则失败:', error);
    }

    return responseBody;
  }

  // 应用答案上传规则
  applyAnswerUploadRules(url, responseBody, extracted_answers) {
    try {
      for (const rule of this.responseRules) {
        if (!this.isRuleEffective(rule)) continue;
        if (rule.isGroup) continue;
        if (rule.type === 'answer-upload') {
          if (!url.includes(rule.urlUpload)) continue;

          if (rule.uploadType === 'original') {
            try {
              this.serverDatas[rule.serverLocate] = JSON.parse(responseBody.toString());
            }
            catch (error) {
              this.serverDatas[rule.serverLocate] = responseBody;
            }
          }
          else {
            this.serverDatas[rule.serverLocate] = extracted_answers;
          }
        }
      }
    } catch (error) {
      console.error('应用答案上传规则失败:', error);
      return {};
    }
  }

  // 响应体解压缩工具函数
  decompressResponse(buffer, encoding) {
    return new Promise((resolve, reject) => {
      try {
        if (!encoding || encoding === 'identity') {
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

  // 扫描目录结构
  scanDirectory(dir, maxDepth = 3, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const result = [];
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
          result.push({
            name: file,
            type: 'directory',
            path: filePath,
            children: this.scanDirectory(filePath, maxDepth, currentDepth + 1)
          });
        } else {
          result.push({
            name: file,
            type: 'file',
            path: filePath,
            size: stats.size
          });
        }
      }
    } catch (error) {
      console.error('扫描目录失败:', error);
    }
    return result;
  }

  // 查找可能的答案文件
  findAnswerFiles(dir) {
    const answerFiles = [];
    const extensions = ['.xml', '.json', '.txt', '.html', '.htm'];

    try {
      const files = fs.readdirSync(dir, { recursive: true });
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && extensions.some(ext => file.toLowerCase().endsWith(ext))) {
          answerFiles.push(filePath);
        }
      }
    } catch (error) {
      console.error('查找答案文件失败:', error);
    }

    return answerFiles;
  }

  // 解压ZIP文件
  async extractZipFile(zipPath, ansDir) {
    let mergedAnswers = {};
    try {
      if (!fs.existsSync(zipPath)) {
        throw new Error(`ZIP文件不存在: ${zipPath}`);
      }

      const stats = fs.statSync(zipPath);
      if (stats.size === 0) {
        throw new Error('ZIP文件为空');
      }

      const buffer = fs.readFileSync(zipPath);
      if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
        throw new Error('文件不是有效的ZIP格式');
      }

      const extractDir = zipPath.replace('.zip', '');

      if (fs.existsSync(extractDir)) {
        fs.removeSync(extractDir);
      }

      fs.ensureDirSync(extractDir);

      this.safeIpcSend('process-status', { status: 'processing', message: '正在解压ZIP文件...' });

      try {
        const zip = new StreamZip.async({ file: zipPath });

        const entries = await zip.entries();
        if (Object.keys(entries).length === 0) {
          await zip.close();
          throw new Error('ZIP文件为空或损坏');
        }

        await zip.extract(null, extractDir);
        await zip.close();

        console.log(`ZIP文件解压成功: ${zipPath} -> ${extractDir}`);
      } catch (zipError) {
        console.error('StreamZip解压失败，尝试使用备用方法:', zipError);
        throw new Error(`ZIP文件解压失败，可能文件已损坏: ${zipError.message}`);
      }

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

            const answers = this.answerExtractor.extractAnswersFromFile(filePath);
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
          mergedAnswers = this.answerExtractor.mergeAnswerData(allAnswers);

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
      console.error('解压ZIP文件失败:', error);
      this.safeIpcSend('process-error', { error: `解压失败: ${error.message}` });
    }
    return mergedAnswers;
  }

  // 下载文件
  async downloadFileByUuid(uuid, filePath) {
    try {
      const requestInfo = this.trafficCache.get(uuid);
      if (requestInfo && requestInfo.originalResponse) {
        fs.writeFileSync(filePath, requestInfo.originalResponse);
        return true;
      }
      return false;
    } catch (error) {
      console.error('下载文件失败:', error);
      return false;
    }
  }

  // 启动代理服务器
  async start(mainWindow) {
    console.log('开始启动抓包代理...');
    this.mainWindow = mainWindow;

    // 如果代理已经存在，先停止它
    if (this.proxy) {
      console.log('代理已存在，先停止它...');
      await this.stop();
    }

    // 检查端口是否被占用
    console.log(`开始检查端口 ${this.proxyPort} 是否被占用...`);
    const portInUse = await this.checkPortInUse(this.proxyPort);
    if (portInUse) {
      console.log(`端口 ${this.proxyPort} 被占用，准备查找占用进程...`);
      // 端口被占用，发送日志到UI
      this.safeIpcSend('rule-log', {
        type: 'error',
        message: `端口 ${this.proxyPort} 已被占用，正在尝试结束占用进程...`
      });

      // 查找占用端口的进程
      const pid = await this.findProcessByPort(this.proxyPort);
      if (pid) {
        console.log(`找到占用进程 PID: ${pid}，准备结束进程...`);
        // 尝试结束进程
        const killed = await this.killProcess(pid);
        if (killed) {
          this.safeIpcSend('rule-log', {
            type: 'success',
            message: `已成功结束占用端口 ${this.proxyPort} 的进程 (PID: ${pid})`
          });
          // 等待一小段时间确保端口释放
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // 结束进程失败，发送错误日志
          this.safeIpcSend('rule-log', {
            type: 'error',
            message: `无法结束占用端口 ${this.proxyPort} 的进程 (PID: ${pid})，请手动结束该进程后重试`
          });
          return { running: false, error: '端口被占用' };
        }
      } else {
        // 无法找到占用端口的进程
        this.safeIpcSend('rule-log', {
          type: 'error',
          message: `端口 ${this.proxyPort} 已被占用，但无法找到占用进程，请手动检查后重试`
        });
        return { running: false, error: '端口被占用' };
      }
    }

    console.log(`端口 ${this.proxyPort} 可用，准备启动代理服务器...`);
    // 创建MITM代理实例
    await this.startProxyPromise();

    // 自动导入证书
    try {
      this.safeIpcSend('certificate-status', {
        status: 'importing',
        message: '正在检查并导入证书到受信任的根证书颁发机构...'
      });

      // 先尝试正常导入
      let certResult = await this.certManager.importCertificate();

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

    // 启动本地词库HTTP服务器
    this.startBucketServer();

    console.log(`万能答案获取代理服务器已启动: 127.0.0.1:${this.proxyPort}`);
    this.safeIpcSend('proxy-status', {
      running: true,
      host: '127.0.0.1',
      port: this.proxyPort.toString(),
      message: `代理服务器已启动，请设置天学网客户端代理为 127.0.0.1:${this.proxyPort}`
    });

    return { running: true, host: '127.0.0.1', port: this.proxyPort };
  }

  // 停止代理服务器
  async stop() {
    return new Promise((resolve) => {
      try {
        this.isStopping = true;
        console.log('开始停止代理服务器...');

        // 关闭代理服务器
        if (this.proxy) {
          console.log('代理对象存在，检查close方法...');
          console.log('代理对象类型:', typeof this.proxy);
          console.log('代理对象close方法:', typeof this.proxy.close);

          if (typeof this.proxy.close === 'function') {
            try {
              // 不使用回调，直接关闭
              this.proxy.close();
              console.log('代理服务器关闭命令已发送');

              // 清理代理对象引用
              this.proxy = null;

              this.handleProxyStop();
              resolve({ success: true });
            } catch (closeError) {
              console.error('调用proxy.close时出错:', closeError);
              this.proxy = null;
              this.handleProxyStop();
              resolve({ success: true });
            }
          } else {
            console.log('代理对象没有close方法，直接处理停止');
            this.handleProxyStop();
            resolve({ success: true });
          }
        } else {
          console.log('代理服务器未运行或已关闭');
          this.handleProxyStop();
          resolve({ success: true });
        }

        setTimeout(() => {
          if (this.isStopping) {
            console.log('代理服务器停止超时，强制完成');
            this.proxy = null;
            this.handleProxyStop();
            resolve({ success: true });
          }
        }, 3000);

      } catch (error) {
        console.error('停止代理服务器时出错:', error);
        this.proxy = null;
        this.handleProxyStop();
        resolve({ success: false, error: error.message });
      }
    });
  }

  handleProxyStop() {
    this.isStopping = false;
    console.log('处理代理服务器停止...');

    this.safeIpcSend('proxy-status', {
      running: false,
      host: null,
      port: null,
      message: '代理服务器已停止'
    });

    console.log('代理服务器停止处理完成');
  }

  // 处理HTTP请求
  handleHttpRequest(req, res) {
    try {
      const urlObj = url.parse(req.url);
      if (urlObj.pathname === '/') {
        // 本地代理服务器信息页面
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Auto366 Proxy Server</h1><p>代理服务器运行中...</p>');
        return;
      }

      // 处理HTTPS连接
      if (req.method === 'CONNECT') {
        this.handleHttpsConnect(req, res);
      } else {
        // 处理HTTP请求
        this.proxyHttpRequest(req, res);
      }
    } catch (error) {
      console.error('处理HTTP请求失败:', error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  // 处理HTTPS连接
  handleHttpsConnect(req, res) {
    try {
      const [host, port] = req.url.split(':');
      const socket = require('net').connect(port || 443, host, () => {
        res.writeHead(200, 'Connection Established');
        res.end();

        // 建立双向通信
        socket.pipe(req.connection);
        req.connection.pipe(socket);
      });

      socket.on('error', (error) => {
        console.error('HTTPS连接失败:', error);
        req.connection.end();
      });

      req.connection.on('error', (error) => {
        socket.end();
      });
    } catch (error) {
      console.error('处理HTTPS连接失败:', error);
      res.end();
    }
  }

  // 处理HTTPS请求
  handleHttpsRequest(req, res) {
    try {
      const urlObj = url.parse(`https://${req.headers.host}${req.url}`);
      this.proxyHttpRequest(req, res, true);
    } catch (error) {
      console.error('处理HTTPS请求失败:', error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  // 代理HTTP请求
  proxyHttpRequest(req, res, isHttps = false) {
    try {
      const urlObj = url.parse(isHttps ? `https://${req.headers.host}${req.url}` : req.url);
      const fullUrl = urlObj.href;
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.path,
        method: req.method,
        headers: req.headers
      };

      // 移除代理相关的头部
      delete options.headers['proxy-connection'];
      delete options.headers['proxy-authorization'];

      const protocol = isHttps ? https : http;
      const proxyReq = protocol.request(options, (proxyRes) => {
        // 处理响应
        this.handleProxyResponse(req, res, proxyRes, isHttps, fullUrl);
      });

      // 处理请求体
      let requestBody = [];
      req.on('data', (chunk) => {
        requestBody.push(chunk);
        proxyReq.write(chunk);
      });

      req.on('end', () => {
        proxyReq.end();
      });

      proxyReq.on('error', (error) => {
        console.error('代理请求失败:', error);
        res.writeHead(502);
        res.end('Bad Gateway');
      });

    } catch (error) {
      console.error('代理HTTP请求失败:', error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  // 处理代理响应
  handleProxyResponse(req, res, proxyRes, isHttps, fullUrl) {
    try {
      const responseBodyRules = this.haveRules(fullUrl, 'response-body');
      
      // 如果是文件下载请求且需要应用规则，修改响应头
      if (responseBodyRules.includes(2)) {
        // 检查是否是文件下载请求
        const isFileDownloadRequest = fullUrl.endsWith('.zip') ||
          fullUrl.includes('/download/') ||
          fullUrl.includes('/cn/files/');

        if (isFileDownloadRequest) {
          // 获取匹配的规则并计算新文件的MD5
          for (const rule of this.responseRules) {
            if (!this.isRuleEffective(rule) || rule.isGroup || rule.type !== 'zip-implant') continue;

            const urlMatches = this.urlMatchesPattern(fullUrl, rule.urlZip);
            if (urlMatches && fs.existsSync(rule.zipImplant)) {
              const buffer = fs.readFileSync(rule.zipImplant);
              const md5 = crypto.createHash('md5').update(buffer).digest('hex');
              const md5Base64 = Buffer.from(md5, 'hex').toString('base64');

              // 修改响应头
              proxyRes.headers['etag'] = md5;
              proxyRes.headers['content-md5'] = md5Base64;
              proxyRes.headers['content-length'] = buffer.length.toString();

              if (rule.maxTriggers !== undefined) {
                rule.currentTriggers = (rule.currentTriggers || 0) + 1;
                this.saveResponseRules();
              }

              break;
            }
          }
        }
      }

      // 复制响应头部
      res.writeHead(proxyRes.statusCode, proxyRes.headers);

      // 处理响应体
      let responseBody = [];
      proxyRes.on('data', (chunk) => {
        responseBody.push(chunk);
        if (!responseBodyRules.includes(2)) {
          res.write(chunk);
        }
      });

      proxyRes.on('end', async () => {
        const buffer = Buffer.concat(responseBody);
        let processedBuffer = buffer;
        
        if (responseBodyRules.includes(2)) {
          processedBuffer = this.applyZipImplantRules(fullUrl, buffer);
          res.write(processedBuffer);
        }
        
        res.end();

        // 记录请求和响应信息
        if (this.answerCaptureEnabled) {
          const requestId = uuidv4();
          const requestInfo = {
            uuid: requestId,
            method: req.method,
            url: fullUrl,
            headers: req.headers,
            statusCode: proxyRes.statusCode,
            statusMessage: proxyRes.statusMessage,
            responseHeaders: proxyRes.headers,
            contentType: proxyRes.headers['content-type'],
            contentEncoding: proxyRes.headers['content-encoding'],
            timestamp: new Date().toISOString(),
            originalResponse: buffer
          };

          this.trafficCache.set(requestId, requestInfo);

          // 发送请求日志
          if (this.onTrafficLog) {
            this.onTrafficLog(requestInfo);
          }

          // 处理答案提取
          const isFile = /application\/octet-stream|image/.test(requestInfo.contentType);
          if (isFile && requestInfo.contentType && requestInfo.contentType.includes('zip')) {
            fs.mkdirSync(this.tempDir, { recursive: true });
            fs.mkdirSync(this.ansDir, { recursive: true });
            const filePath = path.join(this.tempDir, `${requestId}.zip`);
            await this.downloadFileByUuid(requestId, filePath);
            const extracted_answers = await this.extractZipFile(filePath, this.ansDir);

            try {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                const shouldKeepCache = await this.mainWindow.webContents.executeJavaScript(`
                  localStorage.getItem('keep-cache-files') === 'true'
                `);

                if (!shouldKeepCache) {
                  await fs.unlink(filePath);
                  await fs.rm(filePath.replace('.zip', ''), { recursive: true, force: true });
                }
              } else {
                await fs.unlink(filePath);
                await fs.rm(filePath.replace('.zip', ''), { recursive: true, force: true });
              }
            } catch (error) {
              await fs.unlink(filePath);
              await fs.rm(filePath.replace('.zip', ''), { recursive: true, force: true });
            }

            if (responseBodyRules.includes(3)) {
              this.applyAnswerUploadRules(fullUrl, buffer, extracted_answers);
            }
          }
        }
      });

    } catch (error) {
      console.error('处理代理响应失败:', error);
      res.end();
    }
  }

  // 启动本地答案服务器
  startBucketServer() {
    this.bucketServer = http.createServer((req, res) => {
      try {
        if (req.method === 'GET') {
          if (!(req.url in this.serverDatas)) {
            res.writeHead(404, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'no bucket data' }));
            return;
          }

          if (typeof this.serverDatas[req.url] === 'object') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(this.serverDatas[req.url], null, 2));
          }
          else {
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(this.serverDatas[req.url]);
          }
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
        } catch (_) { }
      }
    });

    this.bucketServer.listen(this.bucketPort, '127.0.0.1', () => {
      console.log(`本地服务器已启动: http://127.0.0.1:${this.bucketPort}/`);
    });
  }

  // 设置代理端口
  setProxyPort(port) {
    this.proxyPort = port;
    return { success: true };
  }

  // 获取代理端口
  getProxyPort() {
    return this.proxyPort;
  }

  // 设置答案服务器端口
  setBucketPort(port) {
    this.bucketPort = port;
    return { success: true };
  }

  // 获取答案服务器端口
  getBucketPort() {
    return this.bucketPort;
  }

  // 设置答案捕获启用状态
  setAnswerCaptureEnabled(enabled) {
    this.answerCaptureEnabled = enabled;
  }

  // 获取答案捕获启用状态
  getAnswerCaptureEnabled() {
    return this.answerCaptureEnabled;
  }

  // 导入规则（供 rules.js 调用）
  importRules(rules) {
    try {
      if (!Array.isArray(rules)) {
        return { success: false, error: '无效的规则数据格式' };
      }
      const importedRules = rules.map(rule => ({
        ...rule,
        id: rule.id || uuidv4(),
        createdAt: rule.createdAt || new Date().toISOString(),
        updatedAt: rule.updatedAt || new Date().toISOString()
      }));
      const currentRules = this.getResponseRules();
      this.responseRules = [...currentRules, ...importedRules];
      this.saveResponseRules();
      return { success: true, count: importedRules.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  registerIpcHandlers(dialog, mainWindow, supabase, SUPABASE_BUCKET) {
    // 代理控制 IPC
    ipcMain.on('start-answer-proxy', async () => {
      await this.start(mainWindow);
    });

    ipcMain.on('stop-answer-proxy', async () => {
      try {
        await this.stop();
      } catch (error) {
        console.error('停止代理服务器失败:', error);
      }
    });

    ipcMain.handle('set-proxy-port', async (event, port) => {
      try {
        this.setProxyPort(port);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-proxy-port', () => {
      return this.getProxyPort();
    });

    ipcMain.handle('set-bucket-port', async (event, port) => {
      try {
        this.setBucketPort(port);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-bucket-port', () => {
      return this.getBucketPort();
    });

    ipcMain.handle('set-answer-capture-enabled', (event, enabled) => {
      this.setAnswerCaptureEnabled(enabled);
      return { success: true };
    });

    ipcMain.handle('get-answer-capture-enabled', () => {
      return this.getAnswerCaptureEnabled();
    });

    ipcMain.handle('import-implant-zip', async (event, sourcePath) => {
      try {
        return await this.importZIPToDir(sourcePath);
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
        const tempPath = path.join(os.tmpdir(), `injection_${Date.now()}.zip`);
        fs.writeFileSync(tempPath, buffer);
        const result = await this.importZIPToDir(tempPath);
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
        const safeFileName = originalFileName.replace(/[<>:"/\\|?*]/g, '_');
        const appDir = path.dirname(process.execPath);
        const fileDir = path.join(appDir, 'file');
        const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
        const targetDir = isDev ? path.join(process.cwd(), 'file') : fileDir;
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
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
        const isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged;
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
      let traffic = this.getTrafficByUuid(uuid);
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
        await this.downloadFileByUuid(uuid, result.filePath);
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
        const randomId = uuidv4().substring(0, 8);
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

    // 规则管理 IPC
    ipcMain.handle('get-response-rules', () => {
      try {
        const rules = this.getResponseRules();
        return rules;
      } catch (error) {
        console.error('获取响应规则失败:', error);
        return [];
      }
    });

    ipcMain.handle('save-response-rule', (event, rule) => {
      try {
        const success = this.saveRule(rule);
        return { success };
      } catch (error) {
        console.error('保存规则失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('save-response-rules', (event, rules) => {
      try {
        const success = this.saveResponseRules(rules);
        return { success };
      } catch (error) {
        console.error('保存规则失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('delete-response-rule', (event, ruleId) => {
      try {
        const success = this.deleteRule(ruleId);
        return { success };
      } catch (error) {
        console.error('删除规则失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('toggle-response-rule', (event, ruleId, enabled) => {
      try {
        const success = this.toggleRule(ruleId, enabled);
        return { success };
      } catch (error) {
        console.error('切换规则状态失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('reset-rule-triggers', (event, ruleId) => {
      try {
        const success = this.resetRuleTriggers(ruleId);
        return { success };
      } catch (error) {
        console.error('重置规则触发次数失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('export-response-rules', async () => {
      const rules = this.getResponseRules();
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
            const importedRules = rules.map(rule => ({
              ...rule,
              id: uuidv4(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }));
            const currentRules = this.getResponseRules();
            this.responseRules = [...currentRules, ...importedRules];
            this.saveResponseRules();
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
          rulesToImport = rules;
        } else if (rules.group && rules.rules) {
          groupToImport = rules.group;
          rulesToImport = rules.rules;
        } else if (rules.rules && Array.isArray(rules.rules)) {
          rulesToImport = rules.rules;
        } else {
          return { success: false, error: '无效的规则数据格式' };
        }
        const currentRules = this.getResponseRules();
        if (groupToImport) {
          const existingGroupIndex = currentRules.findIndex(rule =>
            rule.isGroup && (
              rule.communityRulesetId === groupToImport.communityRulesetId ||
              (rule.name === groupToImport.name && rule.author === groupToImport.author)
            )
          );
          if (existingGroupIndex !== -1) {
            const existingGroup = currentRules[existingGroupIndex];
            const groupId = existingGroup.id;
            console.log(`发现已存在的规则集: ${existingGroup.name}，正在替换...`);
            this.responseRules = this.responseRules.filter(rule =>
              rule.id !== groupId && rule.groupId !== groupId
            );
          }
          this.responseRules.push(groupToImport);
          rulesToImport.forEach(rule => {
            rule.groupId = groupToImport.id;
          });
        } else {
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
        this.responseRules = [...this.responseRules, ...rulesToImport];
        this.saveResponseRules();
        return { success: true, count: rulesToImport.length };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  // 注册事件监听器
  on(event, callback) {
    if (event === 'trafficLog') {
      this.onTrafficLog = callback;
    }
  }
}

module.exports = ProxyServer;
