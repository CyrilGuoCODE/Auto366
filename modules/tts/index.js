const moduleLog = require('../logging').create('TTS');
const engineMethods = require('./engine');
const ipcMethods = require('./ipc');
const approvalMethods = require('./approval');
/*
 * TtsManager —— TTS 语音生成管理器 (主进程侧)
 * ------------------------------------------------------------
 * 职责:
 *   - 通过 child_process.fork() 启动子进程运行 sherpa-onnx TTS 引擎
 *   - 主进程通过 IPC 消息与子进程通信，不阻塞 UI
 *   - 对答案文本批量生成 WAV 音频，写入磁盘（不存内存）
 *   - 通过 bucket 服务器提供 {basePath}/output/{n}.wav 和 {basePath}/setting 端点
 *   - 配置管理（音色、语速）—— 由 config 持久化，通过 IPC 同步界面
 *   - basePath 从 TTS 规则中读取
 *   - 磁盘缓存可清理，避免堆积
 *
 * 不应包含:
 *   - 代理逻辑、规则匹配
 *   - UI 渲染
 *   - 配置文件的读写细节（交给 config 模块）
 *   - sherpa-onnx 引擎加载或 tts.generate() 调用（由子进程负责）
 */

const { app } = require('electron');

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

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
const AVAILABLE_ENGINES = ['auto', 'sherpa-onnx', 'chestnut', 'glm-tts'];

class TtsManager {
  static get voices() { return VOICE_MAP; }
  static get engines() { return AVAILABLE_ENGINES; }
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
      // 默认要求用户检查预清洗文本；设置中关闭后，允许标记过的规则自动生成。
      approvalEnabled: true,
    };

    // 引擎选择: 'auto'(优先在线chestnut,不可用时回退本地sherpa-onnx,无模型则自动下载) / 'sherpa-onnx' / 'chestnut'
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
    this.resourceDownloader = null; // 用于 auto 模式下自动下载本地模型

    // ===== 预清洗审批队列 =====
    // 答案到达后先入此队列，等用户审批/修改后再调用 generateForApprovedTexts 生成 wav
    // 队列项: { index, original, edited, source }
    //   - index: 1-based 序号，与最终 wav 文件名对应
    //   - original: 从 answers[i].answer 提取的原始文本
    //   - edited: 用户审批后的文本（初始 = original）
    //   - source: 来源元信息（ruleName / url，便于追溯）
    this.pendingApprovalQueue = [];
    this.pendingBasePath = null;
    this.pendingApprovalSource = null;
    // 审批通过后队列会清空，这份清单留着供规则集查询（见 http.js 的 manifest）
    this.manifest = [];
  }

  /**
   * 扫描 TTS 模型目录，返回可用模型列表
   * 优先用户数据目录 ~/.Auto366/resources/tts（下载/迁移后的位置），
   * 其次兜底安装目录/开发资源目录。
   */
  getAvailableModels() {
    const roots = [];
    roots.push(path.join(os.homedir(), '.Auto366', 'resources', 'tts'));
    if (app && app.isPackaged) {
      roots.push(path.join(process.resourcesPath, 'tts'));
    } else {
      roots.push(path.join(this.appPath || '', 'resources', 'tts'));
    }

    const seen = new Set();
    const models = [];
    for (const ttsRoot of roots) {
      try {
        if (!fs.existsSync(ttsRoot)) continue;
        const dirs = fs.readdirSync(ttsRoot, { withFileTypes: true });
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          const name = d.name;
          if (seen.has(name)) continue;
          const dirPath = path.join(ttsRoot, name);
          // 检查是否包含必要的模型文件
          const hasOnnx = fs.existsSync(path.join(dirPath, 'model.onnx'))
            || fs.existsSync(path.join(dirPath, 'model.int8.onnx'))
            || fs.existsSync(path.join(dirPath, 'model.fp32.onnx'));
          const hasTokens = fs.existsSync(path.join(dirPath, 'tokens.txt'));
          if (hasOnnx && hasTokens) {
            seen.add(name);
            models.push({ name, path: dirPath });
          }
        }
      } catch (e) { /* 忽略 */ }
    }
    return models;
  }

  init(appPath, mainWindow, rulesManager) {
    this.mainWindow = mainWindow;
    this.rulesManager = rulesManager;
    this.appPath = appPath;

    // 扫描可用模型
    const availableModels = this.getAvailableModels();

    // 确定 modelDir：优先用用户选中的模型 > 第一个可用模型
    if (availableModels.length > 0) {
      // 默认选中第一个
      this.modelDir = availableModels[0].path;
      this.selectedModel = availableModels[0].name;
    } else {
      // 回退：尝试硬编码路径（优先用户数据目录，开发时兜底 appPath/resources）
      const userModel = path.join(os.homedir(), '.Auto366', 'resources', 'tts', 'kitten-micro-en-v0_8');
      if (fs.existsSync(userModel)) {
        this.modelDir = userModel;
      } else if (app && app.isPackaged) {
        this.modelDir = path.join(process.resourcesPath, 'tts', 'kitten-micro-en-v0_8');
      } else {
        this.modelDir = path.join(appPath, 'resources', 'tts', 'kitten-micro-en-v0_8');
      }
      this.selectedModel = 'kitten-micro-en-v0_8';
    }

    // 临时缓存目录，可随时清理
    this.cacheDir = path.join(os.homedir(), '.Auto366', 'tts-cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });

    this._loadConfig();
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  /*
   * 所有启用中的 tts-generate 规则各自的 basePath。
   * 必须收集全部而不是只取第一个：作业(/fill-tts)和听说(/listening-tts)
   * 可以同时启用，只认第一个的话另一个的 output/status/list 全部 404。
   */
  _getTtsBasePaths() {
    const out = [];
    if (!this.rulesManager) return ['/tts'];
    try {
      const rulesets = this.rulesManager.getRules();
      for (const ruleset of rulesets) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (rule.type === 'tts-generate' && rule.enabled !== false) {
            let bp = (rule.ttsBasePath || '/tts').trim();
            if (!bp.startsWith('/')) bp = '/' + bp;
            if (out.indexOf(bp) < 0) out.push(bp);
          }
        }
      }
    } catch (e) { /* 忽略 */ }
    return out.length ? out : ['/tts'];
  }

  /* 正在生成的那一份优先，其次第一个已配置的 */
  _getBasePathFromRules() {
    const all = this._getTtsBasePaths();
    if (this.currentBasePath && all.indexOf(this.currentBasePath) >= 0) return this.currentBasePath;
    return all[0];
  }

  setResourceDownloader(dl) {
    this.resourceDownloader = dl;
  }

  setGlmApiKey(key) {
    require('../config').set('glm-api-key', key || '');
    require('./providers/glm').setApiKey(key || '');
    return { success: true };
  }

  getGlmApiKey() { return require('../config').get('glm-api-key', ''); }

  _loadConfig() {
    try {
      require('./providers/glm').setApiKey(this.getGlmApiKey());
      const saved = JSON.parse(require('../config').get('tts-config', 'null'));
      if (saved) {
        if (saved.voice && VOICE_MAP[saved.voice] !== undefined) this.config.voice = saved.voice;
        if (saved.speed !== undefined && Number.isFinite(Number(saved.speed))) this.config.speed = Math.max(0.5, Math.min(2.0, Number(saved.speed)));
        if (typeof saved.approvalEnabled === 'boolean') this.config.approvalEnabled = saved.approvalEnabled;
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
        // 恢复 glm-tts 音色
        if (saved.glmVoice) {
          this.config.glmVoice = saved.glmVoice;
        }
      }
    } catch (e) { moduleLog.warn('读取 TTS 设置失败：', e); }
  }

  _log(message, type = 'info') {
    const data = moduleLog.event({ type, message });
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('rule-log', data);
      }
    } catch (e) { /* 忽略 */ }
  }

  // ---- 缓存文件路径：序号 → 磁盘路径 ----
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

  // ---- 并发池：处理任务数组，限制并发数 ----
  // 支持暂停/恢复：任务函数内部可通过 this._concurrencyController.pause()/resume() 控制
  // 用于 glm-tts 失败重试场景（重试期间不拉取新任务）
  async _runConcurrently(tasks, concurrency, onProgress) {
    const results = new Array(tasks.length);
    let idx = 0;
    let done = 0;

    // 暂停机制：所有 worker 在拉取新任务前等待 gate
    // 用数组保存所有等待者，resume 时全部唤醒
    const waiters = [];
    let paused = false;
    const waitGate = () => {
      if (!paused) return Promise.resolve();
      return new Promise(resolve => { waiters.push(resolve); });
    };
    const pause = () => {
      if (paused) return;
      paused = true;
      this._log('[并发池] 暂停拉取新任务，等待重试完成...', 'warning');
    };
    const resume = () => {
      if (!paused) return;
      paused = false;
      const toWake = waiters.splice(0);
      for (const w of toWake) w();
      this._log('[并发池] 已恢复并发', 'info');
    };
    this._concurrencyController = { pause, resume };

    const run = async () => {
      while (idx < tasks.length) {
        await waitGate();
        if (idx >= tasks.length) break;
        const i = idx++;
        try {
          results[i] = await tasks[i]();
        } catch (e) {
          results[i] = { error: e };
        }
        done++;
        if (onProgress) onProgress(done, results[i], i);
      }
    };

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, tasks.length); w++) {
      workers.push(run());
    }
    await Promise.all(workers);
    this._concurrencyController = null;
    return results;
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
    this._log(`开始生成 ${total} 条语音 [${engine}] (并发3)...`, 'info');

    // 预计算任务列表：过滤空文本，分配序号
    const tasks = [];
    for (let i = 0; i < answers.length; i++) {
      const text = answers[i].answer || answers[i].content || answers[i].text || '';
      if (!text) { skipped++; continue; }
      const index = tasks.length + 1;
      tasks.push({ text, index });
    }
    this.generationProgress.skipped = skipped;

    // 并发执行（并发3）
    // glm-tts 单条失败时：任务函数内部暂停并发 → 重试最多 2 次（间隔 500ms）→ 仍失败则恢复并发
    // 主流程结束后还有一次补生成（仅 glm-tts 失败项，串行每项3次）
    const maxRetries = 2;
    await this._runConcurrently(
      tasks.map(({ text, index }) => async () => {
        // glm-tts 内联重试：失败 → 暂停并发 → 重试 → 恢复并发
        // 非 glm-tts 引擎无重试
        let result, lastErr;
        for (let attempt = 0; attempt <= (engine === 'glm-tts' ? maxRetries : 0); attempt++) {
          try {
            if (engine === 'glm-tts') {
              result = await this._generateViaGlmTts(text, index);
            } else if (engine === 'chestnut') {
              result = await this._generateViaChestnut(text, index);
            } else {
              result = await this._sendToWorker({ text, index });
            }
            if (result && result.filePath) break; // 成功
          } catch (e) {
            lastErr = e;
          }
          // glm-tts 失败重试：暂停并发 → 等 500ms → 重试
          if (engine === 'glm-tts' && attempt < maxRetries) {
            if (this._concurrencyController) this._concurrencyController.pause();
            this._log(`第 ${index} 条失败，重试 ${attempt + 1}/${maxRetries}...`, 'warning');
            await new Promise(r => setTimeout(r, 500));
            // resume 在循环末尾统一处理（见下）
          }
        }
        // 重试完成后恢复并发
        if (this._concurrencyController) this._concurrencyController.resume();

        if (result && result.filePath) {
          return { index, ...result };
        }
        return { index, error: lastErr || new Error('生成失败') };
      }),
      3,
      (_done, result, _i) => {
        if (result && !result.error && result.filePath) {
          this.fileIndex.set(result.index, result.filePath);
          this.textMap.set(result.index, tasks.find(t => t.index === result.index).text);
          if (result.index >= this.nextIndex) this.nextIndex = result.index + 1;
          generated++;
          this.generationProgress.generated = generated;
        } else if (result && result.error) {
          this._log('生成第 ' + result.index + ' 条失败: ' + result.error.message, 'error');
        }
        // 进度日志
        const processed = generated + skipped + (result && result.error ? 1 : 0);
        if (processed % 5 === 0 || processed >= total) {
          const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
          this._log(`进度 ${generated}/${tasks.length} (${elapsed}s)`, 'info');
        }
      }
    );

    // 阶段二：补生成（仅 glm-tts 失败项，串行每项3次，使用原序号原文本）
    // 通过 fileIndex 是否含该序号判断是否仍失败（重试成功的项会被排除）
    if (engine === 'glm-tts') {
      const stillFailed = tasks.filter(t => !this.fileIndex.has(t.index));
      if (stillFailed.length > 0) {
        const recovered = await this._batchRetryGlm(stillFailed, 3, 500);
        generated += recovered;
        this.generationProgress.generated = generated;
      }
    }

    // 汇总日志
    const totalElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    this._log(`生成完成: ${generated}/${tasks.length} 成功, ${skipped} 跳过 (${totalElapsed}s) [${engine}]`, 'success');

    this.isGenerating = false;
  }

  // glm-tts 失败项补生成：串行执行，每项尝试 maxAttempts 次，间隔 delayMs
  // 返回成功补回的条数
  async _batchRetryGlm(failedTasks, maxAttempts = 3, delayMs = 500) {
    let recovered = 0;
    for (const task of failedTasks) {
      let lastErr = null;
      let success = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        this._log(`补生成 #${task.index} 尝试 ${attempt}/${maxAttempts}...`, 'warning');
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        try {
          const r = await this._generateViaGlmTts(task.text, task.index);
          if (r && r.filePath) {
            this.fileIndex.set(r.index, r.filePath);
            this.textMap.set(r.index, task.text);
            if (r.index >= this.nextIndex) this.nextIndex = r.index + 1;
            recovered++;
            success = true;
            this._log(`补生成 #${task.index} 成功`, 'success');
            break;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      if (!success) {
        this._log(`补生成 #${task.index} ${maxAttempts} 次后仍失败: ${lastErr ? lastErr.message : '未知错误'}`, 'error');
      }
    }
    if (failedTasks.length > 0) {
      this._log(`补生成结束: ${recovered}/${failedTasks.length} 成功`, recovered > 0 ? 'success' : 'warning');
    }
    return recovered;
  }

  // ---- 配置变更后重新生成 ----
  async regenerateAll() {
    if (this.textMap.size === 0) return;

    // ===== 审批守卫：存在未审批内容时，不直接生成，改为重新入审批队列 =====
    // pendingApprovalQueue 非空 = 上一批答案仍在等待审批，不应绕过审批直接重新生成
    if (this.pendingApprovalQueue.length > 0) {
      this._log(`重新生成取消：存在 ${this.pendingApprovalQueue.length} 条待审批内容，需先完成审批`, 'warning');
      this._notifyApprovalPending();
      return;
    }

    const engine = await this._ensureEngine();
    if (!engine) {
      this._log('引擎未就绪，跳过重新生成', 'warning');
      return;
    }

    this._cleanCacheDir();
    this.fileIndex.clear();
    this.nextIndex = 1;

    const sortedKeys = Array.from(this.textMap.keys()).sort((a, b) => a - b);
    const total = sortedKeys.length;
    const batchStart = Date.now();

    this._log(`开始重新生成 ${total} 条语音 [${engine}] (并发3)...`, 'info');

    this.isGenerating = true;
    this.generationProgress = { total, generated: 0, skipped: 0 };

    // 预分配新序号 1, 2, 3, ...
    const tasks = sortedKeys.map((oldIndex, i) => ({
      text: this.textMap.get(oldIndex),
      oldIndex,
      index: i + 1,
    }));

    let generated = 0;
    const newTextMap = new Map();

    const maxRetries = 2;
    await this._runConcurrently(
      tasks.map(({ text, index }) => async () => {
        let result, lastErr;
        for (let attempt = 0; attempt <= (engine === 'glm-tts' ? maxRetries : 0); attempt++) {
          try {
            if (engine === 'glm-tts') {
              result = await this._generateViaGlmTts(text, index);
            } else if (engine === 'chestnut') {
              result = await this._generateViaChestnut(text, index);
            } else {
              result = await this._sendToWorker({ text, index });
            }
            if (result && result.filePath) break;
          } catch (e) {
            lastErr = e;
          }
          if (engine === 'glm-tts' && attempt < maxRetries) {
            if (this._concurrencyController) this._concurrencyController.pause();
            this._log(`第 ${index} 条失败，重试 ${attempt + 1}/${maxRetries}...`, 'warning');
            await new Promise(r => setTimeout(r, 500));
          }
        }
        if (this._concurrencyController) this._concurrencyController.resume();

        if (result && result.filePath) {
          return { index, ...result };
        }
        return { index, error: lastErr || new Error('生成失败') };
      }),
      3,
      (_done, result, _i) => {
        if (result && !result.error && result.filePath) {
          newTextMap.set(result.index, tasks.find(t => t.index === result.index).text);
          this.fileIndex.set(result.index, result.filePath);
          if (result.index >= this.nextIndex) this.nextIndex = result.index + 1;
          generated++;
          this.generationProgress.generated = generated;
        } else if (result && result.error) {
          this._log('重新生成第 ' + result.index + ' 条失败: ' + result.error.message, 'error');
        }
        const done = generated + (result && result.error ? 1 : 0);
        if (done % 5 === 0 || done >= total) {
          const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
          this._log(`进度 ${generated}/${total} (${elapsed}s)`, 'info');
        }
      }
    );

    this.textMap = newTextMap;
    const totalElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    this._log(`重新生成完成: ${generated}/${total} 成功 (${totalElapsed}s) [${engine}]`, 'success');

    this.isGenerating = false;
  }

  // ---- 更新配置 ----
  updateConfig(newConfig) {
    let needRegenerate = false;
    let changeType = null;

    if (newConfig.voice && VOICE_MAP[newConfig.voice] !== undefined) {
      if (this.config.voice !== newConfig.voice) { this.config.voice = newConfig.voice; needRegenerate = true; changeType = changeType || '音色切换'; }
    }
    if (newConfig.speed !== undefined && Number.isFinite(Number(newConfig.speed))) {
      const s = Math.max(0.5, Math.min(2.0, Number(newConfig.speed)));
      if (this.config.speed !== s) { this.config.speed = s; needRegenerate = true; changeType = changeType || '语速切换'; }
    }
    if (typeof newConfig.approvalEnabled === 'boolean') {
      this.config.approvalEnabled = newConfig.approvalEnabled;
    }
    // 引擎切换
    if (newConfig.engine && AVAILABLE_ENGINES.includes(newConfig.engine) && newConfig.engine !== this.engine) {
      this.engine = newConfig.engine;
      this.activeEngine = null; // 重置，下次 _ensureEngine 会重新选择
      needRegenerate = true;
      changeType = '引擎切换(' + this.engine + ')';
      this._log('TTS 引擎切换为: ' + this.engine, 'info');
    }
    // chestnut 音色
    if (newConfig.chestnutVoice) {
      if (this.config.chestnutVoice !== newConfig.chestnutVoice) {
        this.config.chestnutVoice = newConfig.chestnutVoice;
        needRegenerate = true;
        changeType = changeType || ('Chestnut音色切换(' + newConfig.chestnutVoice + ')');
      }
    }
    // glm-tts 音色
    if (newConfig.glmVoice) {
      if (this.config.glmVoice !== newConfig.glmVoice) {
        this.config.glmVoice = newConfig.glmVoice;
        needRegenerate = true;
        changeType = changeType || ('GLM音色切换(' + newConfig.glmVoice + ')');
      }
    }

    if (needRegenerate && this.textMap.size > 0) {
      // ===== 审批守卫：配置变更（引擎/音色/语速）不直接 regenerateAll 绕过审批 =====
      // 只要有 textMap 就意味着这批内容曾审批通过过，但在切换引擎/音色时
      // 仍要求重新审批，确保生成参数（新引擎/新音色）与内容匹配、不静默重新生成。
      const requeued = this._requeueFromTextMap(changeType || '配置变更');
      if (!requeued) {
        // textMap 为空时才走旧的直接 regenerateAll
        this.regenerateAll().catch(e => { this._log('重新生成失败: ' + e.message, 'error'); });
      }
    }

    return needRegenerate;
  }

  _saveConfig() {
    const json = JSON.stringify({ ...this.config, engine: this.engine, modelName: this.selectedModel });
    require('../config').set('tts-config', json);
  }

  // ---- 生命周期 ----
  async stop() {
    this._initResolve?.(false);
    const worker = this.worker;
    this.worker = null;
    this.initialized = false;
    this.initializing = false;
    this.activeEngine = null;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('TTS 管理器已停止'));
    }
    this.pendingRequests.clear();
    if (worker && worker.exitCode == null) {
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); worker.removeListener('exit', finish); resolve(); };
        const timer = setTimeout(() => { try { worker.kill('SIGKILL'); } catch (_) {} finish(); }, 2000);
        worker.once('exit', finish);
        try { worker.send({ type: 'shutdown' }, error => { if (error) { try { worker.kill(); } catch (_) {} } }); }
        catch (_) { try { worker.kill(); } catch (_) {} }
      });
    }
    this.fileIndex.clear();
    this.textMap.clear();
    this._cleanCacheDir();
  }

}

// Submodules share this feature's instance; existing method contracts stay unchanged.
Object.assign(TtsManager.prototype, approvalMethods, engineMethods, ipcMethods);
module.exports = TtsManager;
