/*
 * TtsManager —— TTS 语音生成管理器 (主进程侧)
 * ------------------------------------------------------------
 * 职责:
 *   - 管理 sherpa-onnx-node OfflineTts 引擎生命周期
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
 */

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const crypto = require('crypto');

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

class TtsManager {
  constructor() {
    this.mainWindow = null;
    this.tts = null;
    this.initialized = false;
    this.initializing = false;

    this.config = {
      voice: 'Jasper',
      speed: 1.1,
    };

    // 序号 → 磁盘文件路径（不存音频 Buffer，节省内存）
    this.fileIndex = new Map();
    // 序号 → 答案文本（用于配置变更时重新生成）
    this.textMap = new Map();
    this.nextIndex = 1;
    this.currentBasePath = '/tts';
    this.modelDir = null;
    this.cacheDir = null;
    this.rulesManager = null;
  }

  init(appPath, mainWindow, rulesManager) {
    this.mainWindow = mainWindow;
    this.rulesManager = rulesManager;

    if (app && app.isPackaged) {
      this.modelDir = path.join(process.resourcesPath, 'tts', 'kitten-nano-en-v0_8-int8');
    } else {
      const sherpaDir = path.join(appPath, 'resources', 'tts', 'kitten-nano-en-v0_8-int8');
      const hfDir = path.join(appPath, 'resources', 'tts', 'kitten-tts-nano-0.8-int8');
      this.modelDir = fs.existsSync(sherpaDir) ? sherpaDir : hfDir;
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
        const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.wav'));
        for (const f of files) {
          fs.unlinkSync(path.join(this.cacheDir, f));
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  // ---- 引擎管理 ----
  async _ensureEngine() {
    if (this.tts && this.initialized) return true;
    if (this.initializing) return false;

    this.initializing = true;
    this._log('正在加载 TTS 引擎...', 'info');

    try {
      const sherpa_onnx = require('sherpa-onnx-node');

      if (!fs.existsSync(this.modelDir)) {
        this.initializing = false;
        this._log('模型目录不存在: ' + this.modelDir, 'error');
        return false;
      }

      const config = {
        model: {
          kitten: {
            model: path.join(this.modelDir, 'model.int8.onnx'),
            voices: path.join(this.modelDir, 'voices.bin'),
            tokens: path.join(this.modelDir, 'tokens.txt'),
            dataDir: path.join(this.modelDir, 'espeak-ng-data'),
          },
          debug: false, numThreads: 1, provider: 'cpu',
        },
        maxNumSentences: 1,
      };

      this.tts = new sherpa_onnx.OfflineTts(config);
      this.initialized = true;
      this.initializing = false;
      this._log('引擎加载完成 (' + this.tts.numSpeakers + ' 种音色)', 'success');
      return true;
    } catch (error) {
      this.initializing = false;
      this._log('引擎加载失败: ' + error.message, 'error');
      return false;
    }
  }

  // ---- 单条音频生成 → 写磁盘，返回文件路径 ----
  async _generateOne(text, index) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return null;

    const cleanText = text.replace(/<[^>]*>/g, '').replace(/[<>{}[\]\\]/g, '').trim();
    if (!cleanText) return null;

    const ready = await this._ensureEngine();
    if (!ready) return null;

    try {
      const sid = VOICE_MAP[this.config.voice] || 0;
      const audio = this.tts.generate({
        text: cleanText,
        sid: sid,
        speed: this.config.speed,
        enableExternalBuffer: false,
      });
      const wavBuffer = this._buildWavBuffer(audio.samples, audio.sampleRate);

      // 写入磁盘，不存内存
      const filePath = this._wavPath(index);
      fs.writeFileSync(filePath, wavBuffer);

      return filePath;
    } catch (error) {
      this._log('生成失败: ' + error.message, 'error');
      return null;
    }
  }

  _buildWavBuffer(samples, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;

    const int16Samples = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const dataSize = int16Samples.length * bytesPerSample;
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * blockAlign, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    Buffer.from(int16Samples.buffer, int16Samples.byteOffset, int16Samples.byteLength).copy(buffer, 44);
    return buffer;
  }

  // ---- 批量为答案生成 TTS ----
  async generateForAnswers(answers, basePath) {
    if (!answers || !Array.isArray(answers) || answers.length === 0) return;

    if (basePath) this.currentBasePath = basePath;

    const ready = await this._ensureEngine();
    if (!ready) {
      this._log('引擎未就绪，跳过', 'warning');
      return;
    }

    // 清理旧文件和索引
    this._cleanCacheDir();
    this.fileIndex.clear();
    this.textMap.clear();
    this.nextIndex = 1;

    let generated = 0;
    const total = answers.length;

    for (let i = 0; i < answers.length; i++) {
      const answer = answers[i];
      const text = answer.answer || answer.content || answer.text || '';
      if (!text) continue;

      const index = this.nextIndex;
      const filePath = await this._generateOne(text, index);
      if (filePath) {
        this.fileIndex.set(index, filePath);
        this.textMap.set(index, text);
        this.nextIndex++;
        generated++;
      }
    }

    // 一行简洁日志
    this._log(`${generated}/${total} 答案已生成完成`, 'success');
  }

  // ---- 配置变更后重新生成 ----
  async regenerateAll() {
    if (this.textMap.size === 0) return;

    this._cleanCacheDir();
    this.fileIndex.clear();
    this.nextIndex = 1;

    const sortedKeys = Array.from(this.textMap.keys()).sort((a, b) => a - b);
    const newTextMap = new Map();
    let generated = 0;

    for (const oldIndex of sortedKeys) {
      const text = this.textMap.get(oldIndex);
      const index = this.nextIndex;
      const filePath = await this._generateOne(text, index);
      if (filePath) {
        newTextMap.set(index, text);
        this.fileIndex.set(index, filePath);
        this.nextIndex++;
        generated++;
      }
    }

    this.textMap = newTextMap;
    this._log(`${generated} 个答案已重新生成`, 'success');
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
    const match = rest.match(/^(\d+)\.wav$/);
    if (!match) return false;

    const index = parseInt(match[1], 10);
    const filePath = this.fileIndex.get(index);

    if (filePath && fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Access-Control-Allow-Origin': '*',
          'Content-Length': stat.size,
        });
        fs.createReadStream(filePath).pipe(res);
        return true;
      } catch (e) { /* 读取失败走 404 */ }
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
      }));
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

  async _pushConfigToRenderer() {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        const json = JSON.stringify(this.config);
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
  }

  // ---- 生命周期 ----
  stop() {
    if (this.tts) {
      try { if (typeof this.tts.free === 'function') this.tts.free(); } catch (e) { /* 忽略 */ }
      this.tts = null;
    }
    this.initialized = false;
    this.fileIndex.clear();
    this.textMap.clear();
    // 退出时清理磁盘缓存
    this._cleanCacheDir();
  }
}

module.exports = TtsManager;
