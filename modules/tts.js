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
const glmTts = require('./glm-tts');
const ttsClean = require('./tts-clean');

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

// GLM-TTS 音色映射（友好名 → API voice 参数）
const GLM_VOICE_MAP = {
  Jasper: 'tongtong', Bella: 'tongtong', Bruno: 'tongtong', Luna: 'tongtong',
  Hugo: 'tongtong', Rosie: 'tongtong', Leo: 'tongtong', Kiki: 'tongtong',
};

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
      // 默认要求用户检查预清洗文本；设置中关闭后，允许标记过的规则自动生成。
      approvalEnabled: true,
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
    // 审批通过后队列会清空，这份清单留着供规则集查询（见 handleTtsManifestRequest）
    this.manifest = [];
  }

  // ---- 预清洗：入队审批 ----
  // 替代旧 setImmediate(() => generateForAnswers(answers, basePath)) 的直接调用
  // 此处只做文本抽取 + 入队，不实际生成 wav；后续由审批通过后的 generateForApprovedTexts 真正生成
  queueForApproval(answers, basePath, sourceInfo, options) {
    if (!Array.isArray(answers) || answers.length === 0) {
      this._log('预清洗入队跳过：答案为空', 'warning');
      return;
    }
    if (basePath) {
      this.currentBasePath = basePath;
      this.pendingBasePath = basePath;
    }
    this.pendingApprovalSource = sourceInfo || null;

    // 清空旧队列（新一批答案到达意味着旧一批准已过期或已处理）
    this.pendingApprovalQueue = [];

    // ===== 预清洗 =====
    // 见 modules/tts-clean.js：去断句标记、听后回答从 children 取答案、转述取范例段。
    // compact 会额外过滤选择题并去重重排，只有明确要求时才开 —— 作业跟读那条链路
    // 按下标取 wav，重排会错位。
    const compact = !!(options && options.compact);
    let cleaned = [];
    let cleanFailed = false;
    try {
      cleaned = ttsClean.cleanAnswersForTts(answers, { compact });
    } catch (e) {
      this._log(`预清洗失败，回退为原始文本: ${e.message}`, 'warning');
      cleaned = [];
      cleanFailed = true;
    }

    // compact 下清洗出 0 条不是失败，是这份卷子没有要念的题（例如整卷只有听后选择）。
    // 这种情况必须彻底不弹审批框 —— 否则基础听力卷也会被拉进朗读流程。
    if (compact && !cleanFailed && !cleaned.length) {
      this.manifest = [];
      this._log(`预清洗：${answers.length} 条答案里没有需要朗读的题，跳过 TTS`, 'info');
      return;
    }

    if (cleaned.length) {
      this.manifest = [];
      for (const c of cleaned) {
        if (!c.text || !c.text.trim()) continue;
        const src = answers[c.meta.origIndex] || {};
        const raw = src.answer || src.content || src.text || '';
        const index = this.pendingApprovalQueue.length + 1;
        this.pendingApprovalQueue.push({
          index,
          original: String(raw),
          edited: c.text,
          source: sourceInfo || null,
          meta: c.meta,
        });
        // 审批通过后队列会被清空，但规则集还要靠 meta 把 wav 跟题目对上号，
        // 所以在这里另存一份清单
        this.manifest.push({ index, text: c.text, meta: c.meta });
      }
    } else {
      this.manifest = [];
      // 清洗没产出（异常或答案结构不认识）时按原样入队，保证链路不断
      for (let i = 0; i < answers.length; i++) {
        const originalText = answers[i].answer || answers[i].content || answers[i].text || '';
        if (!originalText || !String(originalText).trim()) continue;
        this.pendingApprovalQueue.push({
          index: this.pendingApprovalQueue.length + 1,
          original: String(originalText),
          edited: String(originalText),
          source: sourceInfo || null,
        });
      }
    }

    const dropped = answers.length - this.pendingApprovalQueue.length;
    this._log(
      `预清洗入队: ${this.pendingApprovalQueue.length} 条待审批` +
      (dropped > 0 ? ` (原 ${answers.length} 条, 合并/过滤 ${dropped} 条)` : '') +
      ` (basePath=${this.pendingBasePath})`,
      'info'
    );

    // 自动听说是单按钮考试流程：清洗规则已经限定只保留需要朗读的题，
    // 若仍等待主窗口里的另一个审批弹窗，用户进入考试后会整卷录到静音。
    // 仅显式配置 autoApprove 的规则自动确认，作业跟读等其他规则保持人工审批。
    if (options && options.autoApprove && this.config.approvalEnabled === false) {
      const texts = this.pendingApprovalQueue.map(item => item.edited);
      const autoBasePath = this.pendingBasePath;
      this._log(`自动听说: 已自动确认 ${texts.length} 条清洗文本，立即开始生成`, 'success');
      this.generateForApprovedTexts(texts, autoBasePath)
        .catch(error => this._log(`自动听说 TTS 生成失败: ${error.message}`, 'error'));
      return;
    }

    // 通知渲染进程弹出审批 UI
    this._notifyApprovalPending();
  }

  _notifyApprovalPending() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    try {
      this.mainWindow.webContents.send('tts-approval-pending', {
        count: this.pendingApprovalQueue.length,
        basePath: this.pendingBasePath,
        source: this.pendingApprovalSource,
      });
    } catch (e) { /* 忽略 */ }
  }

  getPendingApprovalQueue() {
    return {
      items: this.pendingApprovalQueue.map(it => ({
        index: it.index,
        original: it.original,
        edited: it.edited,
        source: it.source,
      })),
      basePath: this.pendingBasePath,
      source: this.pendingApprovalSource,
    };
  }

  // 用户审批通过后调用：texts 为最终文本数组（顺序与 queue 一致）
  async generateForApprovedTexts(texts, basePath) {
    if (!Array.isArray(texts) || texts.length === 0) {
      this._log('审批通过但文本为空，跳过生成', 'warning');
      return;
    }
    if (basePath) this.currentBasePath = basePath;

    // 空文本会被 generateForAnswers 跳过（序号只按非空文本递增），
    // 清单如果还按原下标编号就会跟 wav 错位，所以两边都先剔掉空的。
    const kept = [];
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (!t || !String(t).trim()) continue;
      kept.push({ text: String(t), meta: (this.manifest && this.manifest[i] && this.manifest[i].meta) || null });
    }
    if (!kept.length) {
      this._log('审批通过但文本全为空，跳过生成', 'warning');
      return;
    }

    // 用审批后的文本走原始生成流程（复用 generateForAnswers 内部逻辑，构造一个伪 answers 数组）
    const fakeAnswers = kept.map(k => ({ answer: k.text }));

    // 用户可能在审批弹窗里改过文本，按位置回填清单，meta 保持不变
    if (Array.isArray(this.manifest) && this.manifest.length) {
      this.manifest = kept.map((k, i) => ({ index: i + 1, text: k.text, meta: k.meta }));
    }

    // 同步回 textMap（regenerateAll 时能复用）
    this.pendingApprovalQueue = [];
    this._log(`审批通过: ${fakeAnswers.length} 条文本开始生成`, 'success');
    await this.generateForAnswers(fakeAnswers, basePath);
  }

  // 用户取消：丢弃队列
  clearApprovalQueue() {
    const n = this.pendingApprovalQueue.length;
    this.pendingApprovalQueue = [];
    this.pendingBasePath = null;
    this.pendingApprovalSource = null;
    this._log(`审批队列已清空 (${n} 条丢弃)`, 'info');
  }

  // 从 textMap 把已有文本重新入审批队列（引擎/音色/模型/速度切换时，
  // 若存在未审批内容，不允许直接 regenerateAll 绕过审批，而是重新弹窗审批）
  _requeueFromTextMap(sourceHint) {
    if (this.textMap.size === 0) return false;
    // 清理已生成缓存和索引，但保留 textMap 作为源数据
    this._cleanCacheDir();
    this.fileIndex.clear();
    this.nextIndex = 1;

    const sortedKeys = Array.from(this.textMap.keys()).sort((a, b) => a - b);
    const source = sourceHint || '重新生成前审批';
    this.pendingApprovalQueue = [];
    for (const oldIndex of sortedKeys) {
      const text = String(this.textMap.get(oldIndex) || '');
      if (!text.trim()) continue;
      this.pendingApprovalQueue.push({
        index: this.pendingApprovalQueue.length + 1,
        original: text,
        edited: text,
        source: source,
      });
    }
    this.pendingBasePath = this.currentBasePath;
    this.pendingApprovalSource = source;
    this._log(`${source}: 检测到 ${this.pendingApprovalQueue.length} 条待审批文本，已重新入队审批，不直接生成`, 'info');
    this._notifyApprovalPending();
    return true;
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

    this._syncConfigFromRenderer();
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

  /* pathname 命中任一已配置 basePath + suffix 时返回该 basePath，否则 null */
  _matchTtsPath(pathname, suffix) {
    for (const bp of this._getTtsBasePaths()) {
      if (pathname === bp + suffix) return bp;
    }
    return null;
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
          // 恢复 glm-tts 音色
          if (saved.glmVoice) {
            this.config.glmVoice = saved.glmVoice;
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
    if (this.activeEngine === 'glm-tts') return 'glm-tts';
    if (this.activeEngine === 'sherpa-onnx' && this.initialized) return 'sherpa-onnx';

    const wantChestnut = this.engine === 'chestnut';
    const wantGlmTts = this.engine === 'glm-tts';
    const wantSherpa = this.engine === 'sherpa-onnx';
    const wantAuto = this.engine === 'auto';

    // 强制使用 chestnut
    if (wantChestnut) {
      this.activeEngine = 'chestnut';
      this._log('使用 chestnut 在线 TTS 引擎', 'info');
      return 'chestnut';
    }

    // 强制使用 glm-tts
    if (wantGlmTts) {
      this.activeEngine = 'glm-tts';
      this._log('使用 GLM-TTS 云端语音合成引擎', 'info');
      return 'glm-tts';
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

  /**
   * 使用 GLM-TTS 引擎生成单条音频并写入磁盘
   * @returns {Promise<{index, filePath}>}
   */
  async _generateViaGlmTts(text, index) {
    const voice = this.config.glmVoice || 'tongtong';
    const t0 = Date.now();
    const result = await glmTts.synthLong(text, voice);
    const ext = result.format || 'wav';
    const filePath = path.join(this.cacheDir, `${index}.${ext}`);
    fs.writeFileSync(filePath, result.audio);
    this._log(`GLM-TTS #${index}: ${(result.audio.length / 1024).toFixed(0)}KB ${ext} ${Date.now() - t0}ms`, 'info');
    return { index, filePath };
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
    if (newConfig.speed !== undefined) {
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

  // ---- Bucket Server 端点处理 ----

  handleTtsOutputRequest(pathname, res) {
    let outputPrefix = null;
    for (const bp of this._getTtsBasePaths()) {
      if (pathname.startsWith(bp + '/output/')) { outputPrefix = bp + '/output/'; break; }
    }
    if (!outputPrefix) return false;

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
    const basePath = this._matchTtsPath(pathname, '/setting');
    if (!basePath) return false;

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        voice: this.config.voice, speed: this.config.speed, basePath,
        availableVoices: Object.keys(VOICE_MAP), voiceMap: VOICE_MAP,
        generatedCount: this.fileIndex.size,
        engine: this.engine, activeEngine: this.activeEngine, availableEngines: AVAILABLE_ENGINES,
        chestnutVoice: this.config.chestnutVoice || null,
        glmVoice: this.config.glmVoice || null }));
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
    if (!this._matchTtsPath(pathname, '/status')) return false;

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
      glmVoice: this.config.glmVoice || null,
    }));
    return true;
  }

  /*
   * {basePath}/list —— 朗读清单
   * 规则集用它把页面上的题目跟 {index}.wav 对上号：朗读类按 text 匹配页面文本，
   * 听后回答按 meta.question 匹配，两者都不中时按 meta.paperSeq 顺序兜底。
   */
  handleTtsManifestRequest(pathname, res) {
    const basePath = this._matchTtsPath(pathname, '/list');
    if (!basePath) return false;

    // 整批 TTS 可能要生成几十秒，但前面的题通常早已落盘。
    // 把逐题就绪状态交给规则集，不能用全局 ready 把已生成音频一起封住。
    const readyIndexes = Array.from(this.fileIndex.keys())
      .filter(index => Number.isInteger(index))
      .sort((a, b) => a - b);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      basePath,
      generating: this.isGenerating,
      ready: !this.isGenerating && this.fileIndex.size > 0,
      partialReady: readyIndexes.length > 0,
      generatedCount: readyIndexes.length,
      readyIndexes,
      approvalEnabled: this.config.approvalEnabled !== false,
      approvalPending: this.pendingApprovalQueue.length > 0 &&
        !this.isGenerating && readyIndexes.length === 0,
      count: Array.isArray(this.manifest) ? this.manifest.length : 0,
      items: Array.isArray(this.manifest) ? this.manifest : [],
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
        glmVoice: this.config.glmVoice || null,
        approvalEnabled: this.config.approvalEnabled !== false,
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

    // ===== 预清洗审批 IPC =====
    // 获取当前待审批队列
    ipcMain.handle('get-pending-tts-approval', async () => {
      return this.getPendingApprovalQueue();
    });

    // 用户审批通过：items 为 [{index, edited}, ...]，按顺序生成 wav
    ipcMain.handle('approve-tts-queue', async (event, items, basePath) => {
      try {
        if (!Array.isArray(items)) {
          return { success: false, error: '参数 items 必须是数组' };
        }
        // 用审批后的 edited 文本作为最终 TTS 输入
        const texts = items.map(it => (it && it.edited != null ? String(it.edited) : ''));
        const finalBasePath = basePath || this.pendingBasePath;
        await this.generateForApprovedTexts(texts, finalBasePath);
        return { success: true, count: items.length };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    // 用户跳过/取消：清空队列
    ipcMain.handle('skip-tts-queue', async () => {
      this.clearApprovalQueue();
      return { success: true };
    });

    ipcMain.handle('get-tts-status', async () => {
      const basePath = this._getBasePathFromRules();
      return {
        initialized: this.initialized, initializing: this.initializing,
        voice: this.config.voice, speed: this.config.speed,
        basePath, generatedCount: this.fileIndex.size,
        engine: this.engine, activeEngine: this.activeEngine,
        chestnutVoice: this.config.chestnutVoice || null,
        glmVoice: this.config.glmVoice || null,
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

            // ===== 审批守卫：切换 sherpa-onnx 模型不直接 regenerateAll 绕过审批 =====
            // 有 textMap 时重新入审批队列，用户确认后再生成；textMap 空则直接 regenerateAll。
            if (this.textMap.size > 0) {
              this._requeueFromTextMap('Sherpa模型切换(' + modelName + ')');
            } else {
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
