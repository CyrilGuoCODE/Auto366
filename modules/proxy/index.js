const moduleLog = require('../logging').create('代理');
const interceptorMethods = require('./interceptor');
const responseMethods = require('./response');
const timeModifierMethods = require('./time-modifier');
const apiForwardMethods = require('./api-forward');
const RuleEngine = require('../rules/engine');
const AnswerOutput = require('../answers/output');
const ContentChange = require('./content-change');
const InjectionManager = require('../injection');
const http = require('http');

const fs = require('fs-extra');
const path = require('path');

const AnswerExtractor = require('../answers/index');
const TrafficCache = require('./traffic');

class ProxyServer {
  constructor(certManager, rulesManager, analyticsManager, ttsManager) {
    this.certManager = certManager;
    this.rulesManager = rulesManager;
    this.analyticsManager = analyticsManager;
    this.ttsManager = ttsManager || null;
    this.localServer = null;
    this.proxyPort = 5291;
    this.bucketPort = 5290;
    this.isRunning = false;
    this.isCapturing = false;
    this.answerCaptureEnabled = true;
    // ===== 时间修改（"通用自动PK"子规则，状态由PK面板经 /pk-time 推送）=====
    // 代理层读不到注入页 localStorage，故经本地 bucket server 同步开关/秒数到此。
    this.pkTimeMod = { enabled: false, seconds: null };
    // ===== 听力时间修改（"内置-自动基础听力"子规则，状态由听力面板经 /listen-time 推送）=====
    // 改 task/score/submit 的 tasksJson.seconds 并重算 ut 签名（salt 固定）。
    this.listenTime = { enabled: false, seconds: null };
    this.LISTEN_TIME_SALT = 'submitTaskToken-pc-987654';
    // ===== 填空时间修改（"内置-自动填空"子规则，状态由填空面板经 /fill-time 推送）=====
    // 同样改 task/score/submit 的 tasksJson.seconds 并重算 ut，用不同的 salt 以与听力区分
    this.fillTimeMod = { enabled: false, seconds: null };
    this.FILL_TIME_SALT = 'submitTaskToken-pc-987654'; // 与听力共用同一服务端盐值
    // 当前由最近一次成功触发的 answer-upload 规则指定的特殊填空提交接口。
    // 仅当规则携带 fillSubmitUrl 字段且 URL 命中时设置；普通填空规则触发后置 null 恢复默认。
    this.activeFillSubmitUrl = null;
    // ===== 听力时间预设（zip 内 mp3 自动计算）=====
    this.lastZipPath = null;  // 最近一次处理的套题 zip 路径
    this.listenTimePresetCache = {};  // { zipPath: { success, seconds, detail, ts } }
    this.mainWindow = null;
    this.speedManager = null;  // 由 main.js 注入; 用于关键请求期间瞬时降速(网络保护)
    this.trafficCache = new TrafficCache();
    this.isStopping = false;
    this.proxy = null;
    this.answerExtractor = new AnswerExtractor((log) => {
      this.safeIpcSend('rule-log', moduleLog.event(log));
    });
    
    // 初始化目录
    this.appPath = process.cwd();
    this.tempDir = path.join(this.appPath, 'temp');
    this.ansDir = path.join(this.appPath, 'answers');
    this.fileDir = path.join(this.appPath, 'file');
    this.loadConfig();
    const safeIpcSend = (...args) => this.safeIpcSend(...args);
    this.answerOutput = new AnswerOutput({ answerExtractor: this.answerExtractor, analyticsManager, safeIpcSend });
    this.ruleEngine = new RuleEngine(rulesManager, {
      answer: (rule, url, body, extracted) => {
        this.activeFillSubmitUrl = rule.fillSubmitUrl || null;
        safeIpcSend('rule-log', moduleLog.event({ type: 'info', url, message: this.activeFillSubmitUrl
          ? '[填空提交模式] 已启用特殊提交接口: ' + this.activeFillSubmitUrl
          : '[填空提交模式] 使用默认 gzip/submit 接口' }));
        this.answerOutput.publish(rule, url, body, extracted);
      },
      tts: (rule, url, extracted) => this.ttsManager?.generateFromRule(rule, url, extracted),
    });
    this.injection = new InjectionManager({ rulesManager, ruleEngine: this.ruleEngine, analyticsManager,
      appPath: this.appPath, tempDir: this.tempDir, getPort: () => this.bucketPort, safeIpcSend,
      extractFileNameFromResponse: (...args) => this.extractFileNameFromResponse(...args) });
    this.contentChange = new ContentChange({ ruleEngine: this.ruleEngine, appPath: this.appPath,
      getPort: () => this.bucketPort, isTextualContentType: type => this.isTextualContentType(type), safeIpcSend });
  }

  loadConfig() {
    const config = require('../config');
    const port = (key, fallback) => {
      const value = Number(config.get(key));
      return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : fallback;
    };
    this.proxyPort = port('proxy-port', this.proxyPort);
    this.bucketPort = port('bucket-port', this.bucketPort);
  }

  // ===== 进程加速"网络保护" =====
  // 关键 up366 请求在飞期间, 把加速倍率瞬时压回 1×(引用计数), 响应结束/出错再恢复,
  // 避免加速把 renderer 的请求超时按倍率缩短 → 题目进不去/交卷失败。时钟污染不在此列。
  _speedHold(ctx) {
    const sm = this.speedManager;
    if (!sm || !sm.enabled || !ctx || ctx._speedHeld) return;
    const host = (ctx.clientToProxyRequest && ctx.clientToProxyRequest.headers
                  && ctx.clientToProxyRequest.headers.host) || '';
    if (!/up366/i.test(host)) return;   // 只保护天学网自身请求
    ctx._speedHeld = true;
    sm.netHold();
  }

  _speedRelease(ctx) {
    if (!ctx || !ctx._speedHeld) return;
    ctx._speedHeld = false;
    if (this.speedManager) this.speedManager.netRelease();
  }

  handleProxyStop() {
    this.isStopping = false;
    moduleLog.log('处理代理服务器停止...');

    this.localServer?.stop();

    this.isRunning = false;
    this.isCapturing = false;

    this.safeIpcSend('proxy-status', {
      running: false,
      host: null,
      port: null,
      message: '代理服务器已停止'
    });

    moduleLog.log('代理服务器停止处理完成');
  }

  // 设置代理端口
  setProxyPort(port) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('代理端口无效');
    require('../config').set('proxy-port', String(port));
    this.proxyPort = port;
    return { success: true };
  }

  // 获取代理端口
  getProxyPort() {
    return this.proxyPort;
  }

  // 设置答案服务器端口
  setBucketPort(port) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('答案服务端口无效');
    require('../config').set('bucket-port', String(port));
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

  // 安全的IPC发送函数
  safeIpcSend(channel, data) {
    try {
      if (channel === 'answers-extracted') this.answerLearning?.invalidate();
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data);
      } else {
        moduleLog.warn(`无法发送IPC消息 [${channel}]: 主窗口不可用`);
      }
    } catch (error) {
      moduleLog.error(`发送IPC消息失败 [${channel}]:`, error);
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
      const { execText: exec } = require('../app/process-text');
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
      const { execText: exec } = require('../app/process-text');
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

  // 解压ZIP文件并提取答案（交给 answers 模块处理）
  async extractZipFile(zipPath, ansDir, captureId) {
    try {
      // 缓存 zip 路径并立即计算听力时间预设（Q1：处理时即计算，不依赖文件后续存在）
      this.lastZipPath = zipPath;

      if (!await fs.pathExists(zipPath)) {
        throw new Error(`ZIP文件不存在: ${zipPath}`);
      }

      const stats = await fs.stat(zipPath);
      if (stats.size === 0) {
        throw new Error('ZIP文件为空');
      }

      const handle = await fs.open(zipPath, 'r');
      try {
        const header = Buffer.alloc(4);
        const { bytesRead } = await fs.read(handle, header, 0, 4, 0);
        if (bytesRead !== 4 || !this._looksLikeZip(header)) throw new Error('文件不是有效的ZIP格式');
      } finally { await fs.close(handle); }

      this.safeIpcSend('process-status', { status: 'processing', message: '正在处理ZIP文件...' });

      // 两个读取者都结束后才能释放捕获文件，避免缓存淘汰打断时长计算。
      const preset = this.calcListenTimePresetFromZip(zipPath).catch(error => {
        moduleLog.error('听力时间预设计算失败:', error.message);
      });
      let result;
      try { result = await this.answerExtractor.processZipAnswer(zipPath, ansDir); }
      finally { await preset; }

      if (result.success && result.answers.length > 0) {
        if (this.analyticsManager) {
          this.analyticsManager.capture('answer_extracted', { count: result.count });
        }
        this.safeIpcSend('file-structure', {
          structure: result.fileStructure,
          extractDir: result.extractDir
        });
        this.safeIpcSend('answers-extracted', {
          captureId,
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
      moduleLog.error('处理ZIP文件失败:', error);
      this.safeIpcSend('process-error', { error: `处理失败: ${error.message}` });
      return {};
    }
  }

  // 启动代理服务器
  async start(mainWindow) {
    moduleLog.log('开始启动抓包代理...');
    this.mainWindow = mainWindow;

    // 如果代理已经存在，先停止它
    if (this.proxy) {
      moduleLog.log('代理已存在，先停止它...');
      await this.stop();
    }

    this.injection.start();

    // 检查端口是否被占用
    moduleLog.log(`开始检查端口 ${this.proxyPort} 是否被占用...`);
    const portInUse = await this.checkPortInUse(this.proxyPort);
    if (portInUse) {
      moduleLog.log(`端口 ${this.proxyPort} 被占用，准备查找占用进程...`);
      // 端口被占用，发送日志到UI
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'error',
        message: `端口 ${this.proxyPort} 已被占用，正在尝试结束占用进程...`
      }));

      // 查找占用端口的进程
      const pid = await this.findProcessByPort(this.proxyPort);
      if (pid) {
        moduleLog.log(`找到占用进程 PID: ${pid}，准备结束进程...`);
        // 尝试结束进程
        const killed = await this.killProcess(pid);
        if (killed) {
          this.safeIpcSend('rule-log', moduleLog.event({
            type: 'success',
            message: `已成功结束占用端口 ${this.proxyPort} 的进程 (PID: ${pid})`
          }));
          // 等待一小段时间确保端口释放
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // 结束进程失败，发送错误日志
          this.safeIpcSend('rule-log', moduleLog.event({
            type: 'error',
            message: `无法结束占用端口 ${this.proxyPort} 的进程 (PID: ${pid})，请手动结束该进程后重试`
          }));
          return { running: false, error: '端口被占用' };
        }
      } else {
        // 无法找到占用端口的进程
        this.safeIpcSend('rule-log', moduleLog.event({
          type: 'error',
          message: `端口 ${this.proxyPort} 已被占用，但无法找到占用进程，请手动检查后重试`
        }));
        return { running: false, error: '端口被占用' };
      }
    }

    moduleLog.log(`端口 ${this.proxyPort} 可用，准备启动代理服务器...`);
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
        moduleLog.warn('证书导入失败，但代理将继续启动:', certResult.error);
      }
    } catch (error) {
      this.safeIpcSend('certificate-status', {
        status: 'error',
        message: '证书导入过程中发生错误: ' + error.message
      });
      moduleLog.warn('证书导入过程中发生错误，但代理将继续启动:', error);
    }

    // 启动本地词库HTTP服务器
    try {
      await this.localServer.start(this.bucketPort);
    } catch (error) {
      await this.stop();
      throw error;
    }

    moduleLog.log(`万能答案获取代理服务器已启动: 127.0.0.1:${this.proxyPort}`);
    this.isRunning = true;
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
    this.isStopping = true;
    const proxy = this.proxy;
    this.proxy = null;
    try {
      proxy?.close?.();
      await this.injection.stop();
      return { success: true };
    } catch (error) {
      moduleLog.error('停止代理失败：', error);
      return { success: false, error: error.message };
    } finally {
      this.handleProxyStop();
    }
  }

  getTrafficByUuid(uuid) {
    return this.trafficCache.get(uuid);
  }

  registerIpcHandlers(dialog, mainWindow) {
    require('./ipc').call(this, mainWindow);
    require('./export').call(this, dialog);
  }

  // 注册事件监听器
  on(event, callback) {
    if (event === 'trafficLog') {
      this.onTrafficLog = callback;
    }
  }
}

// Submodules share this feature's instance; existing method contracts stay unchanged.
Object.assign(ProxyServer.prototype, interceptorMethods, responseMethods, timeModifierMethods, apiForwardMethods);
module.exports = ProxyServer;
