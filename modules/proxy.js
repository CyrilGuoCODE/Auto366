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
const { ipcMain, app, BrowserWindow } = require('electron');
const AnswerExtractor = require('./answer');
const archiver = require('archiver');

class ProxyServer {
  constructor(certManager, rulesManager, analyticsManager) {
    this.certManager = certManager;
    this.rulesManager = rulesManager;
    this.analyticsManager = analyticsManager;
    this.bucketServer = null;
    this.proxyPort = 5291;
    this.bucketPort = 5290;
    this.isRunning = false;
    this.isCapturing = false;
    this.answerCaptureEnabled = true;
    this.aiApiKey = '';
    // ===== 时间修改修改（"通用自动PK"子规则，状态由PK面板经 /fish-time 推送）=====
    // 代理层读不到注入页 localStorage，故经本地 bucket server 同步开关/秒数到此。
    this.fishTime = { enabled: false, seconds: null };
    this.mainWindow = null;
    this.trafficCache = new Map();
    this.serverDatas = {};
    this.isStopping = false;
    this.proxy = null;
    this.answerExtractor = new AnswerExtractor((log) => {
      this.safeIpcSend('rule-log', log);
    });
    
    // 初始化目录
    this.appPath = process.cwd();
    this.tempDir = path.join(this.appPath, 'temp');
    this.ansDir = path.join(this.appPath, 'answers');
    this.fileDir = path.join(this.appPath, 'file');
    this.dynamicInjectTemp = new Map();
    this.progressWindow = null;
    this._progressWindowReady = false;
  }

  // 启动代理服务器
  startProxyPromise() {
    return new Promise((resolve) => {
      // 执行maxTriggers数据迁移（幂等，仅首次生效）
      this._migrateMaxTriggers();

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
        const hasPostChangeTimeRule = this.getPostChangeTimeRules(fullUrl, ctx.clientToProxyRequest.method).length > 0;
        const hasFishTime = this.shouldApplyFishTime(fullUrl, ctx.clientToProxyRequest.method);
        // 需要拦截改写 body 的任一情形：post-change-time 规则 或 时间修改命中submit
        const needBufferBody = hasPostChangeTimeRule || hasFishTime;

        ctx.onRequestData((ctx, chunk, callback) => {
          requestBody.push(chunk)
          if (needBufferBody) return callback(null, null);
          return callback(null, chunk);
        })
        ctx.onRequestEnd(async (ctx, callback) => {
          try {
            let bodyBuffer = Buffer.concat(requestBody);
            const reqEncoding = ctx.clientToProxyRequest.headers['content-encoding'];

            // 解压请求体（如果客户端发送了压缩数据）
            let body;
            if (reqEncoding) {
              const { text, decompressFailed } = await this.decompressBuffer(bodyBuffer, reqEncoding);
              if (decompressFailed) {
                requestInfo.requestBody = text;
                return callback();
              }
              body = text;
            } else {
              body = bodyBuffer.toString();
            }

            if (hasPostChangeTimeRule) {
              const rules = this.getPostChangeTimeRules(fullUrl, ctx.clientToProxyRequest.method);
              const rule = rules[0];
              const modifiedBody = this.applyPostChangeTime(body, rule, fullUrl, ctx.clientToProxyRequest.headers['content-type']);
              ctx.proxyToServerRequest.removeHeader('transfer-encoding');
              ctx.proxyToServerRequest.removeHeader('content-encoding');
              ctx.proxyToServerRequest.setHeader('content-length', Buffer.byteLength(modifiedBody));
              ctx.proxyToServerRequest.write(modifiedBody);
              try {
                const params = new URLSearchParams(modifiedBody);
                requestInfo.requestBody = JSON.stringify(Object.fromEntries(params.entries()), null, 2);
              } catch (e) {
                requestInfo.requestBody = modifiedBody;
              }
              return callback();
            }

            // ===== 时间修改：改写 submit 提交用时 =====
            if (hasFishTime) {
              const modifiedBody = this.applyFishTime(body, fullUrl, ctx.clientToProxyRequest.headers['content-type']);
              ctx.proxyToServerRequest.removeHeader('transfer-encoding');
              ctx.proxyToServerRequest.removeHeader('content-encoding');
              ctx.proxyToServerRequest.setHeader('content-length', Buffer.byteLength(modifiedBody));
              ctx.proxyToServerRequest.write(modifiedBody);
              try {
                const params = new URLSearchParams(modifiedBody);
                requestInfo.requestBody = JSON.stringify(Object.fromEntries(params.entries()), null, 2);
              } catch (e) {
                requestInfo.requestBody = modifiedBody;
              }
              return callback();
            }

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
          } catch (error) {
            console.error('处理请求体失败:', error);
            return callback();
          }
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
            const isFileDownloadRequest = this._isFileDownloadRequest(fullUrl);

            if (isFileDownloadRequest) {
              for (const ruleset of this.rulesManager.getRules()) {
                if (!ruleset.enabled) continue;
                for (const rule of ruleset.rules) {
                  if (!this.isRuleEffective(rule, ruleset) || rule.type !== 'zip-implant') continue;

                  const urlMatches = this.urlMatchesPattern(fullUrl, rule.urlZip);
                  if (urlMatches && fs.existsSync(rule.zipImplant)) {
                    const buffer = fs.readFileSync(rule.zipImplant);
                    const md5 = crypto.createHash('md5').update(buffer).digest('hex');
                    const md5Base64 = Buffer.from(md5, 'hex').toString('base64');

                    ctx.serverToProxyResponse.headers['etag'] = md5;
                    ctx.serverToProxyResponse.headers['content-md5'] = md5Base64;
                    ctx.serverToProxyResponse.headers['content-length'] = buffer.length.toString();

                    this.safeIpcSend('rule-log', {
                      type: 'success',
                      message: `规则 "${rule.name}" 修改响应头`,
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
          if (responseBodyRules.includes(2) || responseBodyRules.includes(4)) return callback(null, Buffer.from(''));
          else return callback(null, chunk);
        })
        ctx.onResponseEnd(async (ctx, callback) => {
          let { buffer, text, decompressFailed } = await this.decompressBuffer(Buffer.concat(responseBody), ctx.serverToProxyResponse.headers['content-encoding']);
          if (responseBodyRules.includes(2)) {
            buffer = this.applyZipImplantRules(fullUrl, buffer);
            ctx.proxyToClientResponse.write(buffer);
          }
          if (responseBodyRules.includes(4)) {
            buffer = await this.applyDynamicInjectRules(fullUrl, buffer);
            ctx.proxyToClientResponse.write(buffer);
          }
          const isJson = /application\/json/.test(requestInfo.contentType);
          const isFile = /application\/octet-stream|image/.test(requestInfo.contentType);
          if (decompressFailed) {
            requestInfo.responseBody = text;
          }
          else if (isJson) {
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

  // 启动本地答案服务器
  startBucketServer() {
    this.bucketServer = http.createServer((req, res) => {
      this.handleBucketRequest(req, res);
    });

    this.bucketServer.listen(this.bucketPort, '127.0.0.1', () => {
      console.log(`本地服务器已启动: http://127.0.0.1:${this.bucketPort}/`);
    });
  }

  // 处理本地答案服务器请求
  handleBucketRequest(req, res) {
    try {
      if (req.method === 'POST' && req.url === '/save-log') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { content } = JSON.parse(body);
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
            const safeFilename = `auto-pk-logs-${timestamp}.txt`;
            const logDir = path.join(this.appPath, 'temp');
            if (!fs.existsSync(logDir)) {
              fs.mkdirSync(logDir, { recursive: true });
            }
            const filePath = path.join(logDir, safeFilename);
            fs.writeFileSync(filePath, content, 'utf-8');
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: true, path: filePath }));
          } catch (e) {
            res.writeHead(500, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }

      // ===== 时间修改：PK面板推送开关/秒数 =====
      if (req.method === 'POST' && req.url === '/fish-time') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const enabled = data.enabled === true;
            let seconds = null;
            if (data.seconds !== null && data.seconds !== undefined && data.seconds !== '') {
              const v = parseInt(data.seconds, 10);
              if (Number.isFinite(v)) {
                seconds = Math.max(-2147483648, Math.min(2147483647, v));
              }
            }
            this.fishTime = { enabled, seconds };
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: true, fishTime: this.fishTime }));
          } catch (e) {
            res.writeHead(500, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }
      if (req.method === 'GET' && url.parse(req.url).pathname === '/fish-time') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(this.fishTime));
        return;
      }

      if (req.method === 'POST' && req.url === '/save-collected-data') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { content, filename } = JSON.parse(body);
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
            const safeFilename = filename || `collected-data-${timestamp}.json`;
            const dataDir = path.join(this.appPath, 'temp');
            if (!fs.existsSync(dataDir)) {
              fs.mkdirSync(dataDir, { recursive: true });
            }
            const filePath = path.join(dataDir, safeFilename);
            fs.writeFileSync(filePath, content, 'utf-8');
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: true, path: filePath }));
          } catch (e) {
            res.writeHead(500, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }

      const urlObj = url.parse(req.url);
      const pathname = urlObj.pathname;

      if (pathname === '/ai-api-key') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ key: this.aiApiKey }));
        return;
      }

      if (pathname === '/') {
        // 服务器信息页面
        const availablePaths = Object.keys(this.serverDatas);
        let pathsHtml = '';
        if (availablePaths.length > 0) {
          pathsHtml = availablePaths.map(p =>
            `<li><a href="${p}">${p}</a></li>`
          ).join('');
          pathsHtml = `<ul>${pathsHtml}</ul>`;
        } else {
          pathsHtml = '<p>暂无已上传的答案路径</p>';
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8"><title>Auto366 Local Bucket Server</title></head>
          <body>
            <h1>Auto366 Local Bucket Server</h1>
            <p>本地答案服务器运行中...</p>
            <h2>已上传的答案路径:</h2>
            ${pathsHtml}
          </body>
          </html>
        `);
        return;
      }

      if (pathname === '/listening-answer') {
        const ansDir = path.join(this.appPath, 'answers');
        if (fs.existsSync(ansDir)) {
          const files = fs.readdirSync(ansDir)
            .filter(f => f.startsWith('answers_') && f.endsWith('.json'))
            .sort()
            .reverse();

          if (files.length > 0) {
            const latestFile = path.join(ansDir, files[0]);
            try {
              const content = fs.readFileSync(latestFile, 'utf-8');
              const parsed = JSON.parse(content);
              const answers = parsed.answers || parsed;
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              });
              res.end(JSON.stringify(answers, null, 2));
            } catch (e) {
              console.error('读取答案文件失败:', e);
              res.writeHead(500, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              });
              res.end(JSON.stringify({ error: '答案文件解析失败', detail: e.message }));
            }
            return;
          }
        }
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: '答案尚未提取，请先启动代理捕获', code: 'ANSWER_NOT_FOUND' }));
      } else if (pathname in this.serverDatas) {
        const data = this.serverDatas[pathname];
        if (typeof data === 'object') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(data, null, 2));
        } else {
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(data);
        }
      } else {
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: 'not found' }));
      }
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

  setAiApiKey(key) {
    this.aiApiKey = key || '';
    return { success: true };
  }

  getAiApiKey() {
    return this.aiApiKey;
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

  isRuleEffective(rule, ruleset) {
    if (!rule.enabled) return false;
    if (ruleset && !ruleset.enabled) return false;
    if (rule.maxTriggers !== undefined && rule.maxTriggers > 0) {
      const currentTriggers = rule.currentTriggers || 0;
      if (currentTriggers >= rule.maxTriggers) {
        return false;
      }
    }
    return true;
  }

  // 判断URL是否为文件信息请求（fileinfo/非ZIP的files请求等）
  _isFileInfoRequest(url) {
    return url.includes('/fileinfo/') ||
      (url.includes('/files/') && !url.endsWith('.zip')) ||
      (url.includes('.json') && (url.includes('/fileinfo/') || url.includes('/files/')));
  }

  // 判断URL是否为文件下载请求（ZIP下载/download/cn/files等）
  _isFileDownloadRequest(url) {
    return url.endsWith('.zip') ||
      url.includes('/download/') ||
      url.includes('/cn/files/');
  }

  // 替换响应体中的MD5和文件大小字段（统一处理filemd5/objectMD5/filesize/objectSize）
  _replaceFileInfoFields(bodyStr, md5, fileSize) {
    bodyStr = bodyStr.replace(/"filemd5"\s*:\s*"[^"]*"/g, `"filemd5":"${md5}"`);
    bodyStr = bodyStr.replace(/"objectMD5"\s*:\s*"[^"]*"/g, `"objectMD5":"${md5}"`);
    bodyStr = bodyStr.replace(/"filesize"\s*:\s*\d+/g, `"filesize":${fileSize}`);
    bodyStr = bodyStr.replace(/"filesize"\s*:\s*"\d+"/g, `"filesize":"${fileSize}"`);
    bodyStr = bodyStr.replace(/"objectSize"\s*:\s*\d+/g, `"objectSize":${fileSize}`);
    bodyStr = bodyStr.replace(/"objectSize"\s*:\s*"\d+"/g, `"objectSize":"${fileSize}"`);
    return bodyStr;
  }

  // maxTriggers数据迁移：将zip-implant的maxTriggers从"每次请求消耗3次"语义修正为"每次请求消耗1次"
  _migrateMaxTriggers() {
    const APP_VERSION = '1.0.0-maxTriggers-fix';
    const configPath = path.join(this.appPath, 'temp', '.migration');
    let done = false;
    try {
      if (fs.existsSync(configPath)) {
        done = fs.readFileSync(configPath, 'utf-8').trim() === APP_VERSION;
      }
    } catch (e) {}

    if (done) return;

    let migrated = false;
    for (const ruleset of this.rulesManager.getRules()) {
      for (const rule of ruleset.rules) {
        if (rule.type === 'zip-implant' && rule.maxTriggers !== undefined && rule.maxTriggers > 0) {
          rule.maxTriggers = Math.ceil(rule.maxTriggers / 3);
          rule.currentTriggers = Math.floor((rule.currentTriggers || 0) / 3);
          migrated = true;
        }
      }
    }
    if (migrated) {
      this.rulesManager.saveRules();
    }

    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(configPath, APP_VERSION, 'utf-8');
    } catch (e) {}
  }

  // 检查是否有启用的zip注入规则
  hasEnabledZipImplantRules() {
    for (const ruleset of this.rulesManager.getRules()) {
      if (!ruleset.enabled) continue;
      for (const rule of ruleset.rules) {
        if (this.isRuleEffective(rule, ruleset) &&
          rule.type === 'zip-implant' &&
          fs.existsSync(rule.zipImplant)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  haveRules(url, type) {
    let l = [];
    try {
      for (const ruleset of this.rulesManager.getRules()) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (!this.isRuleEffective(rule, ruleset)) continue;
          if (rule.type === 'content-change') {
            if (!url.includes(rule.urlPattern)) continue;
            if (type !== rule.changeType) continue;
            l.push(1)
          }
          if (type === 'response-body' && rule.type === 'zip-implant') {
            if (!fs.existsSync(rule.zipImplant)) {
              continue;
            }

            const zipUrlMatches = this.urlMatchesPattern(url, rule.urlZip);

            const fileinfoUrlMatches = rule.urlFileinfo ? this.urlMatchesPattern(url, rule.urlFileinfo) : true;

            const isFileInfoRequest = this._isFileInfoRequest(url);

            const isFileDownloadRequest = this._isFileDownloadRequest(url);

            if ((isFileInfoRequest && fileinfoUrlMatches) || (zipUrlMatches && isFileDownloadRequest)) {
              l.push(2)
            }
          }
          if (type === 'response-body' && rule.type === 'answer-upload') {
            if (!url.includes(rule.urlUpload)) continue;

            if (rule.maxTriggers !== undefined) {
              rule.currentTriggers = (rule.currentTriggers || 0) + 1;
              this.rulesManager.saveRules();
            }

            l.push(3)
          }
          if (type === 'response-body' && rule.type === 'zip-implant-dynamic') {
            const fileinfoUrlMatches = rule.urlFileinfo ? this.urlMatchesPattern(url, rule.urlFileinfo) : false;
            const isFileInfoRequest = this._isFileInfoRequest(url);

            const zipUrlMatches = rule.urlZip ? this.urlMatchesPattern(url, rule.urlZip) : false;
            const isFileDownloadRequest = this._isFileDownloadRequest(url);

            if (isFileInfoRequest && fileinfoUrlMatches) {
              l.push(4);
            } else if (zipUrlMatches && isFileDownloadRequest) {
              l.push(4);
            }
          }
        }
      }
    } catch (error) {
      console.error('获取需要应用的规则失败:', error);
      return [];
    }
    return l;
  }

  getPostChangeTimeRules(url, method) {
    const rules = [];
    for (const ruleset of this.rulesManager.getRules()) {
      if (!ruleset.enabled) continue;
      for (const rule of ruleset.rules) {
        if (!this.isRuleEffective(rule, ruleset)) continue;
        if (rule.type !== 'post-change-time') continue;
        if (rule.method && rule.method !== method) continue;
        if (!this.urlMatchesPattern(url, rule.urlRequest)) continue;
        rules.push(rule);
      }
    }
    return rules;
  }

  applyPostChangeTime(bodyText, rule, url, contentType) {
    if (!contentType || !contentType.includes('application/x-www-form-urlencoded')) {
      return bodyText;
    }

    const formFields = [];
    let tasksJsonRaw = null;

    for (const pair of bodyText.split('&')) {
      if (!pair.includes('=')) continue;
      const eqIndex = pair.indexOf('=');
      const key = pair.substring(0, eqIndex);
      const value = pair.substring(eqIndex + 1);
      if (key === 'tasksJson') {
        tasksJsonRaw = decodeURIComponent(value);
      } else if (key === 'ut') {
      } else {
        formFields.push([key, value]);
      }
    }

    if (tasksJsonRaw === null) return bodyText;

    const secondsMatch = tasksJsonRaw.match(/"seconds":(\d+)/);
    const originalSeconds = secondsMatch ? secondsMatch[1] : '未找到';

    const modifiedTasksJson = tasksJsonRaw.replace(
      /"seconds":\d+/g,
      `"seconds":${rule.targetSeconds}`
    );
    const newUt = this.calculateUt(modifiedTasksJson, rule.salt);

    const parts = ['tasksJson=' + encodeURIComponent(modifiedTasksJson)];
    for (const [k, v] of formFields) {
      parts.push(k + '=' + v);
    }
    parts.push('ut=' + newUt);

    this.safeIpcSend('rule-log', {
      type: 'success',
      message: `规则 "${rule.name}" 修改任务提交时间`,
      ruleId: rule.id,
      url,
      details: `seconds: ${originalSeconds} → ${rule.targetSeconds}`
    });

    return parts.join('&');
  }

  calculateUt(tasksJsonRaw, salt) {
    const timestampMs = String(Date.now());
    const r = crypto.createHash('md5').update(timestampMs).digest('hex');
    const i = crypto.createHash('md5').update(tasksJsonRaw).digest('hex');
    const n = crypto.createHash('md5').update(i + salt + r).digest('hex');
    return r.slice(0, 10) + n + r.slice(10);
  }

  // ===== 时间修改：是否命中 submit 提交接口 =====
  // 普通PK : wordsbtl/student/submit   词王争霸: word-king/submit
  // 仅当：子规则开启 且 秒数已填(非null)
  shouldApplyFishTime(url, method) {
    if (!this.fishTime || this.fishTime.enabled !== true) return false;
    if (this.fishTime.seconds === null || this.fishTime.seconds === undefined) return false;
    if (method && method !== 'POST') return false;
    if (url.indexOf('word-king/submit') !== -1) return true;
    // 普通PK submit，排除 submit/practice 等非PK提交
    if (url.indexOf('wordsbtl/student/submit') !== -1
        && url.indexOf('/submit/practice') === -1) return true;
    return false;
  }

  fishKindOf(url) {
    return url.indexOf('word-king/submit') !== -1 ? '词王争霸' : '普通PK';
  }

  // 改写表单里的 submitJson.duration(毫秒=秒数×1000) 与拟真 answerTime
  applyFishTime(bodyText, url, contentType) {
    if (!contentType || !contentType.includes('application/x-www-form-urlencoded')) {
      this.safeIpcSend('rule-log', {
        type: 'warning',
        message: `[时间修改] 命中${this.fishKindOf(url)}，但content-type非表单(${contentType||'无'})，原样放行`,
        url
      });
      return bodyText;
    }

    let targetSeconds = this.fishTime.seconds;
    targetSeconds = Math.max(-2147483648, Math.min(2147483647, targetSeconds));
    const targetMs = targetSeconds * 1000;

    let params;
    try {
      params = new URLSearchParams(bodyText);
    } catch (e) {
      this.safeIpcSend('rule-log', { type: 'warning', message: `[时间修改] body解析失败，原样放行`, url });
      return bodyText;
    }
    if (!params.has('submitJson')) {
      const keys = [];
      for (const k of params.keys()) keys.push(k);
      this.safeIpcSend('rule-log', {
        type: 'warning',
        message: `[时间修改] body无submitJson字段，原样放行 | 实际字段:[${keys.join(', ')}]`,
        url
      });
      return bodyText;
    }

    const rawSj = params.get('submitJson');
    let decoded = false;
    let sj;
    try {
      sj = JSON.parse(rawSj);
    } catch (e1) {
      try {
        sj = JSON.parse(decodeURIComponent(rawSj));
        decoded = true;
      } catch (e2) {
        this.safeIpcSend('rule-log', { type: 'warning', message: `[时间修改] submitJson解析失败，原样放行`, url });
        return bodyText;
      }
    }

    const oldDuration = sj.duration;
    sj.duration = targetMs;

    const n = Array.isArray(sj.wordInfos) ? sj.wordInfos.length : 0;
    if (n > 0) {
      const spanMs = targetMs > 0 ? targetMs : 0;
      const baseStart = Date.now() - spanMs;
      const gap = n > 1 ? spanMs / (n - 1) : 0;
      let prev = -Infinity;
      for (let i = 0; i < n; i++) {
        const wi = sj.wordInfos[i];
        if (!wi || typeof wi !== 'object') continue;
        let t = Math.round(baseStart + gap * i);
        if (gap > 40) t += Math.floor((Math.random() - 0.5) * Math.min(gap * 0.3, 200));
        if (t <= prev) t = prev + 1;
        prev = t;
        if (typeof wi.answerTime !== 'undefined') wi.answerTime = t;
      }
    }

    const newSj = JSON.stringify(sj);
    params.set('submitJson', decoded ? encodeURIComponent(newSj) : newSj);

    this.safeIpcSend('rule-log', {
      type: 'success',
      message: `[时间修改] ${this.fishKindOf(url)} 提交时间已修改 ✓`,
      url,
      details: `duration: ${oldDuration} → ${targetMs}ms (${targetSeconds}s) | 题数:${n}${decoded ? ' | IOS编码' : ''}`
    });

    return params.toString();
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
      for (const ruleset of this.rulesManager.getRules()) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (!this.isRuleEffective(rule, ruleset)) continue;
          if (rule.type === 'zip-implant') {
            if (!fs.existsSync(rule.zipImplant)) {
              continue;
            }

            const zipUrlMatches = this.urlMatchesPattern(url, rule.urlZip);

            const fileinfoUrlMatches = rule.urlFileinfo ? this.urlMatchesPattern(url, rule.urlFileinfo) : true;

            const isFileInfoRequest = this._isFileInfoRequest(url);

            const isFileDownloadRequest = this._isFileDownloadRequest(url);

            if (isFileInfoRequest && fileinfoUrlMatches) {
              if (rule.targetFileName) {
                const extractedFileName = this.extractFileNameFromResponse(responseBody, url);
                if (!extractedFileName || !this.fileNameMatchesPattern(extractedFileName, rule.targetFileName)) {
                  continue;
                }
              }

              const buffer = fs.readFileSync(rule.zipImplant);
              const md5 = crypto.createHash('md5').update(buffer).digest('hex');
              const fileSize = buffer.length;

              responseBody = this._replaceFileInfoFields(responseBody.toString(), md5, fileSize);

              if (this.analyticsManager) {
                this.analyticsManager.capture('zip_implant_applied', { rule_type: 'fileinfo' });
              }

              if (rule.maxTriggers !== undefined) {
                rule.currentTriggers = (rule.currentTriggers || 0) + 1;
                this.rulesManager.saveRules();
              }

              return Buffer.from(responseBody);
            }
            else if (zipUrlMatches && isFileDownloadRequest) {
              if (this.analyticsManager) {
                this.analyticsManager.capture('zip_implant_applied', { rule_type: 'download' });
              }

              if (rule.maxTriggers !== undefined) {
                rule.currentTriggers = (rule.currentTriggers || 0) + 1;
                this.rulesManager.saveRules();
              }

              return fs.readFileSync(rule.zipImplant);
            }
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
      for (const ruleset of this.rulesManager.getRules()) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (!this.isRuleEffective(rule, ruleset)) continue;
          if (rule.type === 'answer-upload') {
            if (!url.includes(rule.urlUpload)) continue;

            if (this.analyticsManager) {
              this.analyticsManager.capture('answer_upload_applied', { upload_type: rule.uploadType });
            }

            if (rule.uploadType === 'original') {
              try {
                const newData = JSON.parse(responseBody.toString());
                const existingData = this.serverDatas[rule.serverLocate];
                
                if (rule.serverLocate === '/word-pk-answer' && 
                    existingData && 
                    Array.isArray(existingData.data) && 
                    Array.isArray(newData.data)) {
                  const existingEntryIds = new Set();
                  for (const dict of existingData.data) {
                    if (Array.isArray(dict.entryList)) {
                      for (const entry of dict.entryList) {
                        existingEntryIds.add(entry.entryId);
                      }
                    }
                  }
                  let newCount = 0;
                  for (const dict of newData.data) {
                    if (Array.isArray(dict.entryList)) {
                      for (const entry of dict.entryList) {
                        if (!existingEntryIds.has(entry.entryId)) {
                          existingData.data[0].entryList.push(entry);
                          existingEntryIds.add(entry.entryId);
                          newCount++;
                        }
                      }
                    }
                  }
                  const totalCount = existingData.data[0].entryList.length;
                  this.safeIpcSend('rule-log', { type: 'success', message: `[词库合并] 新增 ${newCount} 个词条，总计 ${totalCount} 个` });
                } else {
                  this.serverDatas[rule.serverLocate] = newData;
                  this.safeIpcSend('rule-log', { type: 'info', message: `[词库存储] 存储数据到 ${rule.serverLocate}` });
                }
              }
              catch (error) {
                this.serverDatas[rule.serverLocate] = responseBody;
              }
            }
            else {
              this.serverDatas[rule.serverLocate] = extracted_answers.answers;
            }
          }
        }
      }
    } catch (error) {
      console.error('应用答案上传规则失败:', error);
      return {};
    }
  }

  async applyDynamicInjectRules(url, responseBody) {
    try {
      const isFileInfoRequest = this._isFileInfoRequest(url);
      const isFileDownloadRequest = this._isFileDownloadRequest(url);

      for (const ruleset of this.rulesManager.getRules()) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (!this.isRuleEffective(rule, ruleset) || rule.type !== 'zip-implant-dynamic') continue;

          const fileinfoUrlMatches = rule.urlFileinfo ? this.urlMatchesPattern(url, rule.urlFileinfo) : false;
          const zipUrlMatches = rule.urlZip ? this.urlMatchesPattern(url, rule.urlZip) : false;

          if (isFileInfoRequest && fileinfoUrlMatches) {
            if (this.analyticsManager) {
              this.analyticsManager.capture('dynamic_inject_applied', { phase: 'fileinfo' });
            }
            return await this.handleDynamicInjectFileInfo(url, responseBody, rule);
          }

          if (zipUrlMatches && isFileDownloadRequest) {
            if (this.analyticsManager) {
              this.analyticsManager.capture('dynamic_inject_applied', { phase: 'download' });
            }
            const result = await this.handleDynamicInjectZipDownload(url, rule);
            if (result !== null) return result;
          }
        }
      }
    } catch (error) {
      console.error('应用动态注入规则失败:', error);
      this.sendProgress('error', '动态注入失败: ' + error.message);
      this.closeProgressWindow();
    }
    return responseBody;
  }

  async handleDynamicInjectFileInfo(url, responseBody, rule) {
    try {
      let bodyStr = responseBody.toString();
      let jsonData;
      try {
        jsonData = JSON.parse(bodyStr);
      } catch (e) {
        return responseBody;
      }

      let objectName = jsonData.objectName || jsonData.object_name || '';
      if (jsonData.data) {
        objectName = objectName || jsonData.data.objectName || jsonData.data.object_name || '';
      }

      if (rule.targetFileName && !this.fileNameMatchesPattern(objectName, rule.targetFileName)) {
        return responseBody;
      }

      let downloadUrl = jsonData.downloadUrl || jsonData.download_url || '';
      if (jsonData.data) {
        downloadUrl = downloadUrl || jsonData.data.downloadUrl || jsonData.data.download_url || '';
      }

      if (!downloadUrl) {
        this.safeIpcSend('rule-log', { type: 'error', message: `动态注入: 未找到downloadUrl` });
        return responseBody;
      }

      this.showProgressWindow();

      const requestKey = crypto.createHash('md5').update(downloadUrl).digest('hex');
      this.sendProgress('downloading', '正在下载原始ZIP...', 10);

      const timeout = rule.downloadTimeout || 30000;
      const injectDir = path.join(this.tempDir, 'dynamic-inject', requestKey);
      if (!fs.existsSync(injectDir)) {
        fs.mkdirSync(injectDir, { recursive: true });
      }

      const originalZipPath = path.join(injectDir, objectName || 'original.zip');
      await this.downloadWithTimeout(downloadUrl, originalZipPath, timeout);

      this.sendProgress('extracting', '正在解压ZIP...', 30);
      const extractDir = path.join(injectDir, 'extracted');
      if (fs.existsSync(extractDir)) {
        fs.removeSync(extractDir);
      }
      fs.mkdirSync(extractDir, { recursive: true });

      await this.extractZip(originalZipPath, extractDir);

      this.sendProgress('injecting', '正在注入脚本...', 50);
      const injectScriptPath = this.resolveInjectScript(rule);
      if (!injectScriptPath || !fs.existsSync(injectScriptPath)) {
        this.safeIpcSend('rule-log', { type: 'error', message: `动态注入: 注入脚本不存在: ${injectScriptPath}` });
        this.closeProgressWindow();
        return responseBody;
      }

      const htmlFiles = this.findAllHtmlFiles(extractDir);
      if (htmlFiles.length === 0) {
        this.safeIpcSend('rule-log', { type: 'warning', message: '动态注入: 未找到HTML文件' });
        this.closeProgressWindow();
        return responseBody;
      }

      for (const htmlFile of htmlFiles) {
        this.injectScriptIntoHtml(htmlFile, path.basename(injectScriptPath));
        const scriptDest = path.join(path.dirname(htmlFile), path.basename(injectScriptPath));
        fs.copyFileSync(injectScriptPath, scriptDest);
      }

      this.sendProgress('packing', '正在重新打包...', 70);
      const injectedZipPath = path.join(injectDir, 'injected.zip');
      if (fs.existsSync(injectedZipPath)) {
        fs.unlinkSync(injectedZipPath);
      }
      await this.repackZip(extractDir, injectedZipPath);

      this.sendProgress('modifying', '正在修改响应...', 90);
      const injectedBuffer = fs.readFileSync(injectedZipPath);
      const injectedMd5 = crypto.createHash('md5').update(injectedBuffer).digest('hex');
      const injectedSize = injectedBuffer.length;

      this.dynamicInjectTemp.set(requestKey, {
        zipPath: injectedZipPath,
        md5: injectedMd5,
        size: injectedSize,
        timestamp: Date.now(),
        downloadUrl: downloadUrl,
        objectName: objectName
      });

      // 以rule.id作为匹配键存储，确保fileinfo请求和ZIP下载请求通过同一规则关联
      this.dynamicInjectTemp.set(rule.id, {
        zipPath: injectedZipPath,
        md5: injectedMd5,
        size: injectedSize,
        timestamp: Date.now(),
        downloadUrl: downloadUrl,
        objectName: objectName
      });

      bodyStr = this._replaceFileInfoFields(bodyStr, injectedMd5, injectedSize);

      if (rule.maxTriggers !== undefined) {
        rule.currentTriggers = (rule.currentTriggers || 0) + 1;
        this.rulesManager.saveRules();
      }

      this.safeIpcSend('rule-log', {
        type: 'success',
        message: `动态注入完成: ${objectName} → ${htmlFiles.length}个HTML已注入`,
        ruleId: rule.id,
        ruleName: rule.name
      });

      this.sendProgress('done', '动态注入完成', 100);
      setTimeout(() => this.closeProgressWindow(), 1500);

      return Buffer.from(bodyStr);
    } catch (error) {
      console.error('处理动态注入fileinfo失败:', error);
      this.safeIpcSend('rule-log', { type: 'error', message: `动态注入失败: ${error.message}` });
      this.sendProgress('error', '失败: ' + error.message);
      setTimeout(() => this.closeProgressWindow(), 3000);
      return responseBody;
    }
  }

  async handleDynamicInjectZipDownload(url, rule) {
    // 清理过期和无效的缓存条目
    for (const [key, value] of this.dynamicInjectTemp) {
      if (Date.now() - value.timestamp > 300000) {
        this.dynamicInjectTemp.delete(key);
        continue;
      }
      if (!fs.existsSync(value.zipPath)) {
        this.dynamicInjectTemp.delete(key);
      }
    }

    // 通过rule.id精确匹配：fileinfo请求和ZIP下载请求都匹配同一规则，用规则ID关联
    const entry = this.dynamicInjectTemp.get(rule.id);
    if (entry) {
      if (rule.maxTriggers !== undefined) {
        rule.currentTriggers = (rule.currentTriggers || 0) + 1;
        this.rulesManager.saveRules();
      }
      this.safeIpcSend('rule-log', {
        type: 'success',
        message: `动态注入: 返回已注入的ZIP (${entry.md5})`,
        ruleId: rule.id,
        ruleName: rule.name
      });
      return fs.readFileSync(entry.zipPath);
    }

    this.safeIpcSend('rule-log', {
      type: 'warning',
      message: '动态注入: 未找到已处理的ZIP，返回原始响应'
    });
    return null;
  }

  resolveInjectScript(rule) {
    if (rule.injectScript && fs.existsSync(rule.injectScript)) {
      return rule.injectScript;
    }
    const defaultPath = path.join(this.appPath, 'rulesets', 'auto-listening', 'auto-listening.js');
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }
    if (rule.injectScript) {
      return rule.injectScript;
    }
    return defaultPath;
  }

  downloadWithTimeout(downloadUrl, savePath, timeout) {
    return new Promise((resolve, reject) => {
      const protocol = downloadUrl.startsWith('https') ? https : http;
      const timer = setTimeout(() => {
        reject(new Error(`下载超时 (${timeout}ms)`));
      }, timeout);

      const file = fs.createWriteStream(savePath);

      const request = protocol.get(downloadUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          clearTimeout(timer);
          file.close();
          fs.unlinkSync(savePath);
          this.downloadWithTimeout(response.headers.location, savePath, timeout)
            .then(resolve)
            .catch(reject);
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          clearTimeout(timer);
          file.close();
          const buf = fs.readFileSync(savePath);
          if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
            fs.unlinkSync(savePath);
            reject(new Error('下载的文件不是有效的ZIP格式'));
            return;
          }
          resolve(savePath);
        });
      });

      request.on('error', (err) => {
        clearTimeout(timer);
        file.close();
        if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
        reject(err);
      });
    });
  }

  extractZip(zipPath, extractDir) {
    return new Promise((resolve, reject) => {
      try {
        const zip = new StreamZip({ file: zipPath, storeEntries: true });
        zip.on('ready', () => {
          zip.extract(null, extractDir, (err, count) => {
            zip.close();
            if (err) reject(err);
            else resolve(count);
          });
        });
        zip.on('error', (err) => {
          zip.close();
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  findAllHtmlFiles(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.findAllHtmlFiles(fullPath));
      } else if (entry.name.endsWith('.html') || entry.name.endsWith('.htm')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  injectScriptIntoHtml(htmlFilePath, scriptFileName) {
    let content = fs.readFileSync(htmlFilePath, 'utf-8');

    const injectCode = `var s = document.createElement('script');s.src='./${scriptFileName}';document.body.appendChild(s);`;

    if (content.includes('loadFile.load()')) {
      content = content.replace(
        /\.then\s*\(\s*function\s*\(\s*\)\s*\{/g,
        '.then(function(){' + injectCode
      );
    } else {
      content = content.replace(
        /<\/body>/i,
        '<script>' + injectCode + '</script></body>'
      );
    }

    fs.writeFileSync(htmlFilePath, content, 'utf-8');
  }

  repackZip(sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve(outputPath);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  showProgressWindow() {
    try {
      if (this.progressWindow && !this.progressWindow.isDestroyed()) {
        this.progressWindow.show();
        return;
      }

      this._progressWindowReady = false;
      this.progressWindow = new BrowserWindow({
        width: 400,
        height: 160,
        frame: false,
        resizable: false,
        movable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
          preload: path.join(__dirname, '..', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      // 加载独立的进度窗口HTML文件（替代内联data URL方式）
      const htmlPath = path.join(__dirname, '..', 'components', 'progress-window.html');
      this.progressWindow.loadFile(htmlPath);

      // 窗口加载完成后标记就绪，避免在DOM未就绪时发送IPC消息导致消息丢失
      this.progressWindow.webContents.on('did-finish-load', () => {
        this._progressWindowReady = true;
      });

      this.progressWindow.on('closed', () => {
        this.progressWindow = null;
        this._progressWindowReady = false;
      });
    } catch (error) {
      console.error('创建进度窗口失败:', error);
    }
  }

  sendProgress(step, message, percent) {
    try {
      // 通过IPC发送进度更新到渲染进程（替代executeJavaScript方式，更安全可靠）
      if (this.progressWindow && !this.progressWindow.isDestroyed() && this._progressWindowReady) {
        this.progressWindow.webContents.send('progress-update', {
          message: message,
          percent: percent || 0
        });
      }
      this.safeIpcSend('rule-log', {
        type: step === 'error' ? 'error' : (step === 'done' ? 'success' : 'info'),
        message: `[动态注入] ${message} (${percent || 0}%)`
      });
    } catch (error) {}
  }

  closeProgressWindow() {
    try {
      if (this.progressWindow && !this.progressWindow.isDestroyed()) {
        this.progressWindow.close();
        this.progressWindow = null;
      }
    } catch (error) {}
  }

  // 响应体解压缩工具函数
  decompressBuffer(buffer, encoding) {
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
              resolve({
                buffer: buffer,
                text: `[压缩数据 - gzip解压失败，原始大小: ${buffer.length}字节]`,
                decompressFailed: true
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
                text: `[压缩数据 - deflate解压失败，原始大小: ${buffer.length}字节]`,
                decompressFailed: true
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
                text: `[压缩数据 - brotli解压失败，原始大小: ${buffer.length}字节]`,
                decompressFailed: true
              });
            } else {
              resolve({
                buffer: result,
                text: result.toString('utf8')
              });
            }
          });
        } else {
          // 未知压缩格式
          console.log('未知压缩格式:', encoding)
          resolve({
            buffer: buffer,
            text: `[压缩数据 - 未知编码: ${encoding}，原始大小: ${buffer.length}字节]`,
            decompressFailed: true
          });
        }
      } catch (error) {
        console.error('解压缩过程中出错:', error);
        resolve({
          buffer: buffer,
          text: `[压缩数据 - 解压异常，原始大小: ${buffer.length}字节]`,
          decompressFailed: true
        });
      }
    });
  }

  // 扫描目录结构（只统计文件后缀数量）
  // 解压ZIP文件并提取答案（交给answer.js处理）
  async extractZipFile(zipPath, ansDir) {
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

      this.safeIpcSend('process-status', { status: 'processing', message: '正在处理ZIP文件...' });

      const result = await this.answerExtractor.processZipAnswer(zipPath, ansDir);

      if (result.success && result.answers.length > 0) {
        if (this.analyticsManager) {
          this.analyticsManager.capture('answer_extracted', { count: result.count });
        }
        this.safeIpcSend('file-structure', {
          structure: result.fileStructure,
          extractDir: result.extractDir
        });
        this.safeIpcSend('answers-extracted', {
          answers: result.answers,
          count: result.count,
          file: result.answerFile,
          processedFiles: result.processedFiles
        });
      } else if (result.success && result.answers.length === 0) {
        const allContentFile = path.join(ansDir, `all_content_${Date.now()}.txt`);
        this.safeIpcSend('no-answers-found', {
          message: '所有文件中都未找到有效的答案数据，已显示所有文件内容',
          file: allContentFile,
          filesContent: result.allFilesContent,
          processedFiles: result.processedFiles
        });
      } else {
        this.safeIpcSend('process-error', { error: result.message || '未找到可能包含答案的文件' });
      }

      return result;
    } catch (error) {
      console.error('处理ZIP文件失败:', error);
      this.safeIpcSend('process-error', { error: `处理失败: ${error.message}` });
      return {};
    }
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

  getTrafficByUuid(uuid) {
    return this.trafficCache.get(uuid);
  }

  registerIpcHandlers(dialog, mainWindow, supabase, SUPABASE_BUCKET, rulesManager) {
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

    ipcMain.handle('set-ai-api-key', async (event, key) => {
      try {
        this.setAiApiKey(key);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-ai-api-key', () => {
      return this.getAiApiKey();
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

      let contentType = traffic.contentType;
      if (!contentType && traffic.responseHeaders) {
        contentType = traffic.responseHeaders['content-type'];
      }

      let extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.txt`;
      let filters = [
        { name: 'All Files', extensions: ['*'] }
      ];
      let detectedType = null;
      if (contentType) {
        if (contentType.includes('json')) {
          detectedType = 'json';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.json`;
          filters.unshift({ name: 'JSON Files', extensions: ['json'] });
        } else if (contentType.includes('html')) {
          detectedType = 'html';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.html`;
          filters.unshift({ name: 'HTML Files', extensions: ['html'] });
        } else if (contentType.includes('xml')) {
          detectedType = 'xml';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.xml`;
          filters.unshift({ name: 'XML Files', extensions: ['xml'] });
        } else if (contentType.includes('javascript')) {
          detectedType = 'js';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.js`;
          filters.unshift({ name: 'JavaScript Files', extensions: ['js'] });
        } else if (contentType.includes('css')) {
          detectedType = 'css';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.css`;
          filters.unshift({ name: 'CSS Files', extensions: ['css'] });
        } else if (contentType.includes('image')) {
          detectedType = 'image';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.png`;
          filters.unshift({ name: 'Image Files', extensions: ['png'] });
        } else if (contentType.includes('octet-stream')) {
          detectedType = 'octet';
          extension = traffic.responseBody;
        }
      }

      if (!detectedType && traffic.responseBody) {
        try {
          JSON.parse(traffic.responseBody);
          detectedType = 'json';
          extension = `traffic_${traffic.timestamp.replace(/[:.]/g, '-')}.json`;
          filters.unshift({ name: 'JSON Files', extensions: ['json'] });
        } catch (e) {}
      }

      const result = await dialog.showSaveDialog({ defaultPath: extension, filters });
      if (result.canceled) return -1;
      try {
        if (detectedType === 'json') {
          let jsonContent = traffic.responseBody || (traffic.originalResponse ? traffic.originalResponse.toString('utf-8') : '');
          try {
            jsonContent = JSON.stringify(JSON.parse(jsonContent), null, 2);
          } catch (e) {}
          fs.writeFileSync(result.filePath, jsonContent, 'utf-8');
        } else {
          await this.downloadFileByUuid(uuid, result.filePath);
        }
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

    ipcMain.handle('import-response-rules-from-data', async (event, rulesData) => {
      try {
        let rules;
        if (typeof rulesData === 'string') {
          rules = JSON.parse(rulesData);
        } else {
          rules = rulesData;
        }

        let groupToImport = null;
        let rulesToImport = [];

        if (Array.isArray(rules)) {
          const hasOldFormat = rules.some(item => item.isGroup !== undefined || item.groupId !== undefined);
          if (hasOldFormat) {
            const groups = rules.filter(r => r.isGroup);
            const childRules = rules.filter(r => !r.isGroup);
            if (groups.length > 0) {
              groupToImport = groups[0];
              rulesToImport = childRules.filter(r => r.groupId === groupToImport.id);
            } else {
              rulesToImport = childRules;
            }
          } else if (rules.length > 0 && rules[0].rules !== undefined) {
            const importedRuleset = rules[0];
            groupToImport = { ...importedRuleset };
            rulesToImport = importedRuleset.rules || [];
            delete groupToImport.rules;
          } else {
            rulesToImport = rules;
          }
        } else if (rules.group && rules.rules) {
          groupToImport = rules.group;
          rulesToImport = rules.rules;
        } else if (rules.rules && Array.isArray(rules.rules)) {
          rulesToImport = rules.rules;
        } else if (rules.isGroup) {
          groupToImport = rules;
        } else {
          return { success: false, error: '无效的规则数据格式' };
        }

        const currentRulesets = this.rulesManager.getRules();

        if (groupToImport) {
          const crypto = require('crypto');
          const generateId = (name) => crypto.createHash('md5').update(name).digest('hex');

          const existingRulesetIndex = currentRulesets.findIndex(rs =>
            rs.communityRulesetId === groupToImport.communityRulesetId ||
            (rs.name === groupToImport.name && rs.author === groupToImport.author)
          );

          const rulesetId = existingRulesetIndex !== -1
            ? currentRulesets[existingRulesetIndex].id
            : generateId(groupToImport.name);

          const newRules = rulesToImport.map(rule => {
            const { groupId, isGroup, ...ruleData } = rule;
            return {
              ...ruleData,
              id: generateId(rule.name),
            };
          });

          const newRuleset = {
            id: rulesetId,
            name: groupToImport.name,
            description: groupToImport.description || '',
            author: groupToImport.author || '',
            isBuiltin: groupToImport.isBuiltin || false,
            enabled: groupToImport.enabled !== undefined ? groupToImport.enabled : true,
            compatible: groupToImport.compatible,
            communityRulesetId: groupToImport.communityRulesetId,
            createdAt: groupToImport.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            rules: newRules
          };

          if (existingRulesetIndex !== -1) {
            const updatedRulesets = [...currentRulesets];
            updatedRulesets[existingRulesetIndex] = newRuleset;
            this.rulesManager.saveRules(updatedRulesets);
          } else {
            this.rulesManager.saveRules([...currentRulesets, newRuleset]);
          }
        } else {
          const crypto = require('crypto');
          const generateId = (name) => crypto.createHash('md5').update(name).digest('hex');

          const existingRuleNames = [];
          for (const rs of currentRulesets) {
            for (const r of rs.rules) {
              if (r.name) existingRuleNames.push(r.name);
            }
          }

          const originalCount = rulesToImport.length;
          rulesToImport = rulesToImport.filter(rule => {
            if (rule.name && existingRuleNames.includes(rule.name)) {
              return false;
            }
            return true;
          });

          if (rulesToImport.length > 0) {
            const defaultRuleset = {
              id: generateId('导入的规则'),
              name: '导入的规则',
              description: '从外部导入的规则',
              enabled: true,
              compatible: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              rules: rulesToImport.map(rule => {
                const { groupId, isGroup, ...ruleData } = rule;
                return {
                  ...ruleData,
                  id: generateId(rule.name),
                };
              })
            };
            this.rulesManager.saveRules([...currentRulesets, defaultRuleset]);
          }
        }
        return { success: true, count: rulesToImport.length };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('set-cache-path', (event, newPath) => {
      try {
        const normalizedPath = require('path').resolve(newPath);
        fs.ensureDirSync(normalizedPath);
        return 1;
      } catch (error) {
        return 0;
      }
    });

    ipcMain.handle('upload-rules', async (event, { name, description, author, groupRules }) => {
      try {
        const { v4: uploadUuid } = require('uuid');
        const FormData = require('form-data');
        const https = require('https');
        const formData = new FormData();
        formData.append('name', name);
        formData.append('description', description);
        formData.append('author', author);

        for (const rule of groupRules) {
          if (rule.type === 'zip-implant' && rule.zipImplant && !rule.zipImplant.startsWith('http')) {
            const stream = fs.createReadStream(rule.zipImplant);
            const filename = uploadUuid() + require('path').extname(rule.zipImplant);
            formData.append('files', stream, { filename: filename });
            rule.zipImplant = 'https://objectstorageapi.us-west-1.clawcloudrun.com/d9k8xp0t-auto366-ruleset/files/' + filename;
          }
        }

        const rulesJson = JSON.stringify(groupRules, null, 2);
        formData.append('json', Buffer.from(rulesJson), { filename: `${name}.json`, type: 'application/json' });

        const headers = formData.getHeaders();
        const url = new URL('https://366.cyril.qzz.io/api/rulesets');

        return await new Promise((resolve, reject) => {
          const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: { ...headers },
            timeout: 30000
          };

          const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(responseData) });
              } catch (e) {
                resolve({ status: res.statusCode, headers: res.headers, data: responseData });
              }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
          formData.pipe(req);
        });
      } catch (error) {
        return { status: 500, data: { error: error.message } };
      }
    });

    ipcMain.handle('download-rule-file', async (event, url) => {
      try {
        const https = require('https');
        const path = require('path');
        const fileDir = path.join(this.appPath, 'file');
        fs.ensureDirSync(fileDir);
        const dest = path.join(fileDir, url.split('/').pop());

        return await new Promise((resolve) => {
          const file = fs.createWriteStream(dest);
          https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(dest); });
          }).on('error', (err) => { fs.unlink(dest, () => {}); resolve(null); });
        });
      } catch (error) {
        return null;
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
