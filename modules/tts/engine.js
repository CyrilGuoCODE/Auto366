const path = require('path');
const fs = require('fs-extra');
const child_process = require('child_process');
const { readLines } = require('../app/process-text');
const moduleLog = require('../logging').create('TTS引擎');
const chestnutTts = require('./providers/chestnut');
const glmTts = require('./providers/glm');

module.exports = {
  _startWorker() {
    if (this.worker && this.initialized) return Promise.resolve(true);
    // 旧 worker 的退出事件不能清空随后创建的新 worker。
    this._initResolve?.(false);
    const previous = this.worker;
    this.worker = null;
    if (previous) {
      try { previous.kill(); } catch (_) {}
      for (const pending of this.pendingRequests.values()) {
        clearTimeout(pending.timer); pending.reject(new Error('TTS 引擎已重新初始化'));
      }
      this.pendingRequests.clear();
    }
    return new Promise(resolve => {
      let worker, timer, settled = false;
      const finish = success => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this._initResolve === finish) this._initResolve = null;
        this.initializing = false;
        this.initialized = !!success;
        resolve(!!success);
      };
      const failed = error => {
        if (this.worker !== worker) return;
        this.worker = null;
        this.initialized = false;
        finish(false);
        try { worker?.kill(); } catch (_) {}
        for (const pending of this.pendingRequests.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pendingRequests.clear();
        this._log(error.message, 'error');
      };
      try {
        worker = child_process.fork(path.join(__dirname, 'worker.js'), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
        this.worker = worker;
        this._initResolve = finish;
        readLines(worker.stdout, line => moduleLog.info(line));
        readLines(worker.stderr, line => moduleLog.warn(line));
        worker.on('message', msg => {
          if (this.worker !== worker) return;
          if (msg.type === 'ready' && !msg.success) failed(new Error('TTS 引擎初始化失败'));
          else this._handleWorkerMessage(msg);
        });
        worker.once('exit', (code, signal) => failed(new Error('TTS 子进程退出: ' + code + '/' + signal)));
        worker.on('error', failed);
        timer = setTimeout(() => {
          failed(new Error('TTS 引擎初始化超时'));
          try { worker.kill(); } catch (_) {}
        }, 30000);
        worker.send({ type: 'init', modelDir: this.modelDir }, error => { if (error) { failed(error); try { worker.kill(); } catch (_) {} } });
      } catch (error) {
        if (worker) { failed(error); try { worker.kill(); } catch (_) {} }
        else { finish(false); this._log('TTS 子进程创建失败: ' + error.message, 'error'); }
      }
    });
  },

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
  },

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

      try { this.worker.send({
        type: 'generate',
        id,
        text: params.text,
        index: params.index,
        cacheDir: this.cacheDir,
        voice: params.voice || this.config.voice,
        speed: params.speed || this.config.speed,
      }, error => {
        if (!error || !this.pendingRequests.has(id)) return;
        clearTimeout(timer); this.pendingRequests.delete(id); reject(error);
      }); } catch (error) {
        clearTimeout(timer); this.pendingRequests.delete(id); reject(error);
      }
    });
  },

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

    // 强制使用 sherpa-onnx（不回退）
    if (wantSherpa) {
      const ok = await this._ensureSherpaForAuto();
      if (!ok) this._log('sherpa-onnx 引擎启动失败，且引擎设置为 sherpa-onnx，不回退', 'error');
      return ok ? 'sherpa-onnx' : null;
    }

    // auto 模式：优先在线 chestnut，不可用时回退本地 sherpa-onnx（无模型自动下载）
    if (wantAuto) {
      if (await this._probeChestnut()) {
        this.activeEngine = 'chestnut';
        this._log('使用 chestnut 在线 TTS 引擎', 'info');
        return 'chestnut';
      }
      this._log('chestnut 在线不可用，回退到本地 sherpa-onnx', 'warning');
      const ok = await this._ensureSherpaForAuto(true);
      return ok ? 'sherpa-onnx' : null;
    }

    return null;
  },

  async _probeChestnut() {
    try {
      const r = await chestnutTts.synth('test', this.config.chestnutVoice || 'english', { timeout: 3000, retries: 1 });
      return !!(r && r.audio);
    } catch (e) {
      return false;
    }
  },

  async _ensureSherpaForAuto(useDefault = false) {
    if (this.initializing) {
      this._log('sherpa-onnx 引擎正在初始化中，请稍候...', 'warning');
      return false;
    }

    // 无本地模型 → 自动下载
    if (this.getAvailableModels().length === 0) {
      if (this.resourceDownloader) {
        this._log('本地无 sherpa-onnx 模型，正在自动下载...', 'warning');
        try {
          const r = await this.resourceDownloader.ensure('tts');
          if (!r.ready) {
            this._log('TTS 模型自动下载失败: ' + (r.message || '未知错误'), 'error');
            return false;
          }
        } catch (e) {
          this._log('TTS 模型自动下载失败: ' + e.message, 'error');
          return false;
        }
      } else {
        this._log('本地无 sherpa-onnx 模型且无下载器', 'error');
        return false;
      }
    }

    // 确保 modelDir 指向有效模型
    const models = this.getAvailableModels();
    if (models.length === 0) {
      this._log('本地无可用 sherpa-onnx 模型', 'error');
      return false;
    }
    if (useDefault || !models.some((m) => m.path === this.modelDir)) {
      this.modelDir = models[0].path;
      this.selectedModel = models[0].name;
    }

    this.initializing = true;
    this._log('正在启动 sherpa-onnx TTS 子进程...', 'info');
    const success = await this._startWorker();
    this.initializing = false;
    if (success) {
      this.activeEngine = 'sherpa-onnx';
      this._log('sherpa-onnx 引擎就绪', 'success');
      return true;
    }
    this._log('sherpa-onnx 引擎启动失败', 'error');
    return false;
  },

  async _generateViaChestnut(text, index) {
    const voice = this.config.chestnutVoice || 'english';
    const t0 = Date.now();
    const result = await chestnutTts.synthLong(text, voice);
    const ext = result.format || 'mp3';
    const filePath = path.join(this.cacheDir, `${index}.${ext}`);
    fs.writeFileSync(filePath, result.audio);
    this._log(`chestnutTTS #${index}: ${(result.audio.length / 1024).toFixed(0)}KB ${ext} ${Date.now() - t0}ms`, 'info');
    return { index, filePath };
  },

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
};
