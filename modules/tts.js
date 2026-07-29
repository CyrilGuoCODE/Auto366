/*
 * TtsManager —— TTS 语音生成管理器 (主进程侧)
 * ------------------------------------------------------------
 * 职责:
 *   - 通过 child_process.fork() 启动子进程运行 sherpa-onnx TTS 引擎
 *   - 主进程通过 IPC 消息与子进程通信，不阻塞 UI
 *   - 对答案文本批量生成 WAV 音频，写入磁盘（不存内存）
 *   - 通过 bucket 服务器提供 {basePath}/output/{n}.wav 和 {basePath}/setting 端点
 *   - 配置管理（音色、语速）—— 仅内存，通过 IPC 与渲染进程 localStorage 同步
 *   - basePath 从 TTS 规则中读取
 *   - 磁盘缓存可清理，避免堆积
 *
 * 不应包含:
 *   - 代理逻辑、规则匹配
 *   - UI 渲染
 *   - 本地文件持久化（配置由渲染进程 localStorage 管理）
 *   - sherpa-onnx 引擎加载或 tts.generate() 调用（由子进程负责）
 */

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const child_process = require('child_process');

const chestnutTts = require('./chestnut-tts');

const VOICE_MAP = {
  Jasper: 0,
  Bella: 1,
  Bruno: 2,
  Luna: 3,
  Hugo: 4,
  Rosie: 5,
  Leo: 6,
  Kiki: 7,
};

// 可用引擎列表
const AVAILABLE_ENGINES = ['auto', 'sherpa-onnx', 'chestnut'];

class TtsManager {
  constructor() {
    this.mainWindow = null;
    this.worker = null;
    this.initialized = false;
    this.initializing = false;

    // 异步请求追踪：id → { resolve, reject, timer }
    this.pendingRequests = new Map();
    this._requestId = 0;

    this.config = {
      voice: 'Jasper',
      speed: 1.0,
    };

    // 引擎选择: 'auto'(优先sherpa-onnx,失败回退chestnut) / 'sherpa-onnx' / 'chestnut'
    this.engine = 'auto';
    // 运行时实际使用的引擎（resolve 后的值）
    this.activeEngine = null;

    // 序号 → 磁盘文件路径（不存音频 Buffer，节省内存）
    this.fileIndex = new Map();
    // 序号 → 答案文本（用于配置变更时重新生成）
    this.textMap = new Map();
    this.nextIndex = 1;
    this.currentBasePath = '/tts';

    // 生成状态（供 /status 轮询）
    this.isGenerating = false;
    this.generationProgress = { total: 0, generated: 0, skipped: 0 };
    this.modelDir = null;
    this.cacheDir = null;
    this.rulesManager = null;
    this.appPath = null;
    this.selectedModel = null; // 用户选中的模型文件夹名
  }

  /**
   * 扫描 TTS 模型目录，返回可用模型列表
   */
  getAvailableModels() {
    let ttsRoot;
    if (app && app.isPackaged) {
      ttsRoot = path.join(process.resourcesPath, 'tts');
    } else {
      ttsRoot = path.join(this.appPath || '', 'resources', 'tts');
    }

    const models = [];
    try {
      if (fs.existsSync(ttsRoot)) {
        const dirs = fs.readdirSync(ttsRoot, { withFileTypes: true });
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          const dirPath = path.join(ttsRoot, d.name);
          // 检查是否包含必要的模型文件
          const hasOnnx = fs.existsSync(path.join(dirPath, 'model.onnx'))
            || fs.existsSync(path.join(dirPath, 'model.int8.onnx'))
            || fs.existsSync(path.join(dirPath, 'model.fp32.onnx'));
          const hasTokens = fs.existsSync(path.join(dirPath, 'tokens.txt'));
          if (hasOnnx && hasTokens) {
            models.push({ name: d.name, path: dirPath });
          }
        }
      }
    } catch (e) { /* 忽略 */ }
    return models;
  }

  init(appPath, mainWindow, rulesManager) {
    this.mainWindow = mainWindow;
    this.rulesManager = rulesManager;
    this.appPath = appPath;

    // 扫描可用模型
    const availableModels = this.getAvailableModels();

    // 从 localStorage 读取用户选中的模型
    let savedModelName = null;
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        // 同步读取 - init 阶段不能用 executeJavaScript
      }
    } catch (e) { /* 忽略 */ }

    // 确定 modelDir：优先用用户选中的模型 > 第一个可用模型
    if (availableModels.length > 0) {
      // 默认选中第一个
      this.modelDir = availableModels[0].path;
      this.selectedModel = availableModels[0].name;
    } else {
      // 回退：尝试硬编码路径
      if (app && app.isPackaged) {
        this.modelDir = path.join(process.resourcesPath, 'tts', 'kitten-micro-en-v0_8');
      } else {
        this.modelDir = path.join(appPath, 'resources', 'tts', 'kitten-micro-en-v0_8');
      }
      this.selectedModel = 'kitten-micro-en-v0_8';
    }

    // 临时缓存目录，可随时清理
    this.cacheDir = path.join(os.homedir(), '.Auto366', 'tts-cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });

    this._syncConfigFromRenderer();
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  _getBasePathFromRules() {
    if (!this.rulesManager) return '/tts';
    try {
      const rulesets = this.rulesManager.getRules();
      for (const ruleset of rulesets) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (rule.type === 'tts-generate' && rule.enabled !== false) {
            let bp = (rule.ttsBasePath || '/tts').trim();
            if (!bp.startsWith('/')) bp = '/' + bp;
            return bp;
          }
        }
      }
    } catch (e) { /* 忽略 */ }
    return '/tts';
  }

  async _syncConfigFromRenderer() {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        const saved = await this.mainWindow.webContents.executeJavaScript(
          `(function() { try { return JSON.parse(localStorage.getItem('tts-config') || 'null'); } catch(e) { return null; } })()`
        );
        if (saved) {
          if (saved.voice && VOICE_MAP[saved.voice] !== undefined) this.config.voice = saved.voice;
          if (saved.speed !== undefined) this.config.speed = Math.max(0.5, Math.min(2.0, Number(saved.speed)));
          // 恢复选中的模型
          if (saved.modelName) {
            const models = this.getAvailableModels();
            const found = models.find(m => m.name === saved.modelName);
            if (found) {
              this.modelDir = found.path;
              this.selectedModel = found.name;
            }
          }
          // 恢复引擎选择
          if (saved.engine && AVAILABLE_ENGINES.includes(saved.engine)) {
            this.engine = saved.engine;
          }
          // 恢复 chestnut 音色
          if (saved.chestnutVoice) {
            this.config.chestnutVoice = saved.chestnutVoice;
          }
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  _log(message, type = 'info') {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('rule-log', {
          type, message: '[TTS] ' + message, timestamp: new Date().toISOString(),
        });
      }
    } catch (e) { /* 忽略 */ }
    console.log('[TtsManager]', message);
  }

  // ---- 缓存文件路径：序号 → 磁盘路径 ----
  _wavPath(index) {
    return path.join(this.cacheDir, `${index}.wav`);
  }

  // ---- 清理旧缓存文件 ----
  _cleanCacheDir() {
    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3'));
        for (const f of files) {
          fs.unlinkSync(path.join(this.cacheDir, f));
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  // ================================================================
  //  子进程管理
  // ================================================================

  /**
   * 启动 worker 子进程并初始化 TTS 引擎
   * @returns {Promise<boolean>} 引擎是否就绪
   */
  _startWorker() {
    return new Promise((resolve) => {
      if (this.worker && this.initialized) {
        resolve(true);
        return;
      }

      // 如果已有旧 worker 但未就绪，先清理
      if (this.worker) {
        try { this.worker.kill(); } catch (e) { /* 忽略 */ }
        this.worker = null;
      }

      const workerPath = path.join(__dirname, 'tts-worker.js');
      this.worker = child_process.fork(workerPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

      // 监听子进程消息
      this.worker.on('message', (msg) => {
        this._handleWorkerMessage(msg);
      });

      // 子进程异常退出
      this.worker.on('exit', (code, signal) => {
        this._log(`子进程退出 (code=${code}, signal=${signal})`, code === 0 ? 'info' : 'warning');
        this.worker = null;
        this.initialized = false;
        this.initializing = false;

        // 拒绝所有未完成的请求
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error('子进程已退出'));
        }
        this.pendingRequests.clear();
      });

      // 子进程错误
      this.worker.on('error', (err) => {
        this._log('子进程错误: ' + err.message, 'error');
        this.worker = null;
        this.initialized = false;
        this.initializing = false;
      });

      // 发送 init 消息到子进程
      this._initResolve = resolve;
      this.worker.send({ type: 'init', modelDir: this.modelDir });
    });
  }

  /**
   * 处理子进程发来的消息
   */
  _handleWorkerMessage(msg) {
    const { type } = msg;

    if (type === 'ready') {
      // 引擎初始化完成
      this.initialized = msg.success;
      this.initializing = false;
      if (this._initResolve) {
        this._initResolve(msg.success);
        this._initResolve = null;
      }
      return;
    }

    if (type === 'result') {
      // 生成结果
      const { id, index, filePath, error } = msg;
      const pending = this.pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve({ index, filePath });
        }
      }
      return;
    }

    if (type === 'log') {
      // 转发子进程日志
      this._log(msg.message, msg.logType || 'info');
      return;
    }
  }

  /**
   * 发送生成请求到子进程，返回 Promise
   * @param {object} params - { text, index, voice, speed }
   * @param {number} timeout - 超时时间 (ms)，默认 60 秒
   * @returns {Promise<{index: number, filePath: string|null}>}
   */
  _sendToWorker(params, timeout = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.initialized) {
        reject(new Error('TTS 引擎未就绪'));
        return;
      }

      const id = ++this._requestId;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`TTS 生成超时 (${timeout}ms)`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.worker.send({
        type: 'generate',
        id,
        text: params.text,
        index: params.index,
        cacheDir: this.cacheDir,
        voice: params.voice || this.config.voice,
        speed: params.speed || this.config.speed,
      });
    });
  }

  /**
   * 确保引擎已就绪，如未启动则自动启动
   * @returns {Promise<'sherpa-onnx'|'chestnut'|null>} 就绪的引擎名，null=不可用
   */
  async _ensureEngine() {
    // 已就绪
    if (this.activeEngine === 'chestnut') return 'chestnut';
    if (this.activeEngine === 'sherpa-onnx' && this.initialized) return 'sherpa-onnx';

    const wantChestnut = this.engine === 'chestnut';
    const wantSherpa = this.engine === 'sherpa-onnx';
    const wantAuto = this.engine === 'auto';

    // 强制使用 chestnut
    if (wantChestnut) {
      this.activeEngine = 'chestnut';
      this._log('使用 chestnut 在线 TTS 引擎', 'info');
      return 'chestnut';
    }

    // 尝试 sherpa-onnx
    if (wantSherpa || wantAuto) {
      if (this.initializing) {
        this._log('sherpa-onnx 引擎正在初始化中，请稍候...', 'warning');
        return null;
      }

      this.initializing = true;
      this._log('正在启动 sherpa-onnx TTS 子进程...', 'info');
      const success = await this._startWorker();
      this.initializing = false;

      if (success) {
        this.activeEngine = 'sherpa-onnx';
        this._log('sherpa-onnx 引擎就绪', 'success');
        return 'sherpa-onnx';
      }

      // sherpa-onnx 失败
      if (wantSherpa) {
        this._log('sherpa-onnx 引擎启动失败，且引擎设置为 sherpa-onnx，不回退', 'error');
        return null;
      }

      // auto 模式下回退到 chestnut
      this._log('sherpa-onnx 引擎不可用，自动回退到 chestnut 在线 TTS', 'warning');
      this.activeEngine = 'chestnut';
      return 'chestnut';
    }

    return null;
  }

  /**
   * 使用 chestnut 引擎生成单条音频并写入磁盘
   * @returns {Promise<{index, filePath}>}
   */
  async _generateViaChestnut(text, index) {
    const voice = this.config.chestnutVoice || 'english';
    const t0 = Date.now();
    const result = await chestnutTts.synthLong(text, voice);
    const ext = result.format || 'mp3';
    const filePath = path.join(this.cacheDir, `${index}.${ext}`);
    fs.writeFileSync(filePath, result.audio);
    this._log(`chestnutTTS #${index}: ${(result.audio.length / 1024).toFixed(0)}KB ${ext} ${Date.now() - t0}ms`, 'info');
    return { index, filePath };
  }

  // ---- 批量为答案生成 TTS ----
  async generateForAnswers(answers, basePath) {
    if (!answers || !Array.isArray(answers) || answers.length === 0) return;

    if (basePath) this.currentBasePath = basePath;

    const engine = await this._ensureEngine();
    if (!engine) {
      this._log('引擎未就绪，跳过', 'warning');
      return;
    }

    // 清理旧文件和索引
    this._cleanCacheDir();
    this.fileIndex.clear();
    this.textMap.clear();
    this.nextIndex = 1;

    let generated = 0;
    let skipped = 0;
    const total = answers.length;
    const batchStart = Date.now();

    this.isGenerating = true;
    this.generationProgress = { total, generated: 0, skipped: 0 };
    this._log(`开始生成 ${total} 条语音 [${engine}]...`, 'info');

    for (let i = 0; i < answers.length; i++) {
      const answer = answers[i];
      const text = answer.answer || answer.content || answer.text || '';
      if (!text) { skipped++; this.generationProgress.skipped = skipped; continue; }

      const index = this.nextIndex;
      try {
        let result;
        if (engine === 'chestnut') {
          result = await this._generateViaChestnut(text, index);
        } else {
          result = await this._sendToWorker({ text, index });
        }
        if (result.filePath) {
          this.fileIndex.set(index, result.filePath);
          this.textMap.set(index, text);
          this.nextIndex++;
          generated++;
          this.generationProgress.generated = generated;
        }
      } catch (e) {
        this._log('生成第 ' + index + ' 条失败: ' + e.message, 'error');
      }

      // 每 5 条或最后一条时输出进度
      const processed = generated + skipped;
      if (processed % 5 === 0 || i === answers.length - 1) {
        const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
        this._log(`进度 ${processed}/${total} (${elapsed}s)`, 'info');
      }
    }

    // 汇总日志
    const totalElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    this._log(`生成完成: ${generated}/${total} 成功, ${skipped} 跳过 (${totalElapsed}s) [${engine}]`, 'success');

    this.isGenerating = false;
  }

  // ---- 配置变更后重新生成 ----
  async regenerateAll() {
    if (this.textMap.size === 0) return;

    const engine = await this._ensureEngine();
    if (!engine) {
      this._log('引擎未就绪，跳过重新生成', 'warning');
      return;
    }

    this._cleanCacheDir();
    this.fileIndex.clear();
    this.nextIndex = 1;

    const sortedKeys = Array.from(this.textMap.keys()).sort((a, b) => a - b);
    const newTextMap = new Map();
    let generated = 0;
    const total = sortedKeys.length;
    const batchStart = Date.now();

    this._log(`开始重新生成 ${total} 条语音 [${engine}]...`, 'info');

    this.isGenerating = true;
    this.generationProgress = { total, generated: 0, skipped: 0 };

    for (let i = 0; i < sortedKeys.length; i++) {
      const oldIndex = sortedKeys[i];
      const text = this.textMap.get(oldIndex);
      const index = this.nextIndex;
      try {
        let result;
        if (engine === 'chestnut') {
          result = await this._generateViaChestnut(text, index);
        } else {
          result = await this._sendToWorker({ text, index });
        }
        if (result.filePath) {
          newTextMap.set(index, text);
          this.fileIndex.set(index, result.filePath);
          this.nextIndex++;
          generated++;
          this.generationProgress.generated = generated;
        }
      } catch (e) {
        this._log('重新生成第 ' + index + ' 条失败: ' + e.message, 'error');
      }

      // 每 5 条或最后一条时输出进度
      if ((i + 1) % 5 === 0 || i === sortedKeys.length - 1) {
        const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
        this._log(`进度 ${i + 1}/${total} (${elapsed}s)`, 'info');
      }
    }

    this.textMap = newTextMap;
    const totalElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    this._log(`重新生成完成: ${generated}/${total} 成功 (${totalElapsed}s) [${engine}]`, 'success');

    this.isGenerating = false;
  }

  // ---- 更新配置 ----
  updateConfig(newConfig) {
    let needRegenerate = false;

    if (newConfig.voice && VOICE_MAP[newConfig.voice] !== undefined) {
      if (this.config.voice !== newConfig.voice) { this.config.voice = newConfig.voice; needRegenerate = true; }
    }
    if (newConfig.speed !== undefined) {
      const s = Math.max(0.5, Math.min(2.0, Number(newConfig.speed)));
      if (this.config.speed !== s) { this.config.speed = s; needRegenerate = true; }
    }
    // 引擎切换
    if (newConfig.engine && AVAILABLE_ENGINES.includes(newConfig.engine) && newConfig.engine !== this.engine) {
      this.engine = newConfig.engine;
      this.activeEngine = null; // 重置，下次 _ensureEngine 会重新选择
      needRegenerate = true;
      this._log('TTS 引擎切换为: ' + this.engine, 'info');
    }
    // chestnut 音色
    if (newConfig.chestnutVoice) {
      if (this.config.chestnutVoice !== newConfig.chestnutVoice) {
        this.config.chestnutVoice = newConfig.chestnutVoice;
        needRegenerate = true;
      }
    }

    if (needRegenerate && this.textMap.size > 0) {
      this.regenerateAll().catch(e => { this._log('重新生成失败: ' + e.message, 'error'); });
    }

    return needRegenerate;
  }

  // ---- Bucket Server 端点处理 ----

  handleTtsOutputRequest(pathname, res) {
    const basePath = this._getBasePathFromRules();
    const outputPrefix = basePath + '/output/';
    if (!pathname.startsWith(outputPrefix)) return false;

    const rest = pathname.slice(outputPrefix.length);
    // 支持 .wav 和 .mp3 扩展名
    const match = rest.match(/^(\d+)\.(wav|mp3)$/);
    if (!match) return false;

    const index = parseInt(match[1], 10);
    const filePath = this.fileIndex.get(index);

    if (filePath && fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        const ext = path.extname(filePath).slice(1);
        const mime = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav';
        res.writeHead(200, {
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Content-Length': stat.size,
        });
        fs.createReadStream(filePath).pipe(res);
        return true;
      } catch (e) { /* 读取失败走 404 */ }
    }

    // 兼容：客户端请求 .wav 但实际文件是 .mp3（或反之），按 index 查找任何格式
    if (!filePath) {
      for (const ext of ['mp3', 'wav']) {
        const altPath = path.join(this.cacheDir, `${index}.${ext}`);
        if (fs.existsSync(altPath)) {
          try {
            const stat = fs.statSync(altPath);
            const mime = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav';
            res.writeHead(200, {
              'Content-Type': mime,
              'Access-Control-Allow-Origin': '*',
              'Content-Length': stat.size,
            });
            fs.createReadStream(altPath).pipe(res);
            // 同时更新 fileIndex 以便后续请求直接命中
            this.fileIndex.set(index, altPath);
            return true;
          } catch (e) { /* 读取失败走 404 */ }
        }
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'TTS audio not found', index }));
    return true;
  }

  handleTtsSettingRequest(req, res, pathname) {
    const basePath = this._getBasePathFromRules();
    const settingPath = basePath + '/setting';
    if (pathname !== settingPath) return false;

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        voice: this.config.voice, speed: this.config.speed, basePath,
        availableVoices: Object.keys(VOICE_MAP), voiceMap: VOICE_MAP,
        generatedCount: this.fileIndex.size,
        engine: this.engine, activeEngine: this.activeEngine, availableEngines: AVAILABLE_ENGINES,
        chestnutVoice: this.config.chestnutVoice || null }));
      return true;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const needRegenerate = this.updateConfig(data);
          this._pushConfigToRenderer();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, voice: this.config.voice, speed: this.config.speed, basePath, needRegenerate }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return true;
    }

    return false;
  }

  handleTtsStatusRequest(pathname, res) {
    const basePath = this._getBasePathFromRules();
    const statusPath = basePath + '/status';
    if (pathname !== statusPath) return false;

    const progress = this.generationProgress;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      generating: this.isGenerating,
      total: progress.total,
      generated: progress.generated,
      skipped: progress.skipped,
      generatedCount: this.fileIndex.size,
      voice: this.config.voice,
      speed: this.config.speed,
      engine: this.engine,
      activeEngine: this.activeEngine,
      chestnutVoice: this.config.chestnutVoice || null,
    }));
    return true;
  }

  async _pushConfigToRenderer() {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        const json = JSON.stringify({ ...this.config, engine: this.engine });
        await this.mainWindow.webContents.executeJavaScript(
          `localStorage.setItem('tts-config', '${json.replace(/'/g, "\\'")}')`
        );
      }
    } catch (e) { /* 忽略 */ }
  }

  // ---- IPC Handlers ----
  registerIpcHandlers(mainWindow) {
    this.mainWindow = mainWindow;

    ipcMain.handle('get-tts-config', async () => {
      const basePath = this._getBasePathFromRules();
      return {
        voice: this.config.voice, speed: this.config.speed, basePath,
        availableVoices: Object.keys(VOICE_MAP), voiceMap: VOICE_MAP,
        initialized: this.initialized, generatedCount: this.fileIndex.size,
        modelName: this.selectedModel, availableModels: this.getAvailableModels().map(m => m.name),
        engine: this.engine, activeEngine: this.activeEngine, availableEngines: AVAILABLE_ENGINES,
        chestnutVoice: this.config.chestnutVoice || null,
      };
    });

    ipcMain.handle('save-tts-config', async (event, config) => {
      return { success: true, needRegenerate: this.updateConfig(config) };
    });

    ipcMain.handle('generate-tts-for-answers', async (event, answers, basePath) => {
      try {
        await this.generateForAnswers(answers, basePath);
        return { success: true, count: this.fileIndex.size };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('get-tts-status', async () => {
      const basePath = this._getBasePathFromRules();
      return {
        initialized: this.initialized, initializing: this.initializing,
        voice: this.config.voice, speed: this.config.speed,
        basePath, generatedCount: this.fileIndex.size,
        engine: this.engine, activeEngine: this.activeEngine,
        chestnutVoice: this.config.chestnutVoice || null,
      };
    });

    ipcMain.handle('clear-tts-cache', async () => {
      try {
        this._cleanCacheDir();
        this.fileIndex.clear();
        this.textMap.clear();
        this.nextIndex = 1;
        this._log('缓存已清除', 'info');
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('get-tts-models', async () => {
      return this.getAvailableModels().map(m => m.name);
    });

    ipcMain.handle('set-tts-model', async (event, modelName) => {
      try {
        const models = this.getAvailableModels();
        const found = models.find(m => m.name === modelName);
        if (!found) {
          return { success: false, error: '模型不存在: ' + modelName };
        }

        const changed = found.path !== this.modelDir;
        this.modelDir = found.path;
        this.selectedModel = found.name;
        this._log('TTS 模型切换为: ' + modelName, 'info');

        // 如果模型路径变了且 worker 已启动，需要重启 worker
        if (changed && this.worker) {
          this._log('重启 TTS 引擎以加载新模型...', 'info');
          // 停止旧 worker：先移除监听器，防止退出事件干扰新 worker 状态
          const oldWorker = this.worker;
          try { oldWorker.send({ type: 'shutdown' }); } catch (e) { /* 忽略 */ }
          oldWorker.removeAllListeners();
          setTimeout(() => { try { oldWorker.kill(); } catch (e) { /* 忽略 */ } }, 2000);
          this.worker = null;
          this.initialized = false;
          this.initializing = false;

          // 启动新 worker
          const ok = await this._startWorker();
          if (ok) {
            this._log('TTS 引擎已用新模型重新加载', 'success');

            // 清理旧缓存，用新模型重新生成已有语音
            if (this.textMap.size > 0) {
              this._log('正在用新模型重新生成语音...', 'info');
              await this.regenerateAll();
            }
          } else {
            this._log('TTS 引擎新模型加载失败', 'error');
          }
        }

        return { success: true, restarted: changed && !!this.worker };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
  }

  // ---- 生命周期 ----
  stop() {
    // 发送 shutdown 消息给子进程
    if (this.worker) {
      try {
        this.worker.send({ type: 'shutdown' });
      } catch (e) { /* 忽略 */ }

      // 2 秒后强制 kill
      const workerRef = this.worker;
      setTimeout(() => {
        try {
          if (workerRef && !workerRef.killed) {
            workerRef.kill('SIGKILL');
          }
        } catch (e) { /* 忽略 */ }
      }, 2000);
    }

    this.worker = null;
    this.initialized = false;
    this.initializing = false;
    this.activeEngine = null;

    // 拒绝所有未完成的请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('TTS 管理器已停止'));
    }
    this.pendingRequests.clear();

    this.fileIndex.clear();
    this.textMap.clear();

    // 退出时清理磁盘缓存
    this._cleanCacheDir();
  }
}

module.exports = TtsManager;
