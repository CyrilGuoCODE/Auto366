const ipcMain = require('../register').forModule('tts');

module.exports = {
  registerIpcHandlers(mainWindow) {
    this.mainWindow = mainWindow;

    ipcMain.handle('set-glm-api-key', async (event, key) => {
      try {
        this.setGlmApiKey(key);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('get-glm-api-key', () => {
      return this.getGlmApiKey();
    });

    ipcMain.handle('get-glm-voices', async () => {
      try {
        const glmTts = require('./providers/glm');
        const voices = await glmTts.listVoices();
        return { success: true, voices };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });


    ipcMain.handle('get-tts-config', async () => {
      const basePath = this._getBasePathFromRules();
      return {
        voice: this.config.voice, speed: this.config.speed, basePath,
        availableVoices: Object.keys(this.constructor.voices), voiceMap: this.constructor.voices,
        initialized: this.initialized, generatedCount: this.fileIndex.size,
        modelName: this.selectedModel, availableModels: this.getAvailableModels().map(m => m.name),
        engine: this.engine, activeEngine: this.activeEngine, availableEngines: this.constructor.engines,
        chestnutVoice: this.config.chestnutVoice || null,
        glmVoice: this.config.glmVoice || null,
        approvalEnabled: this.config.approvalEnabled !== false,
      };
    });

    ipcMain.handle('save-tts-config', async (event, config) => {
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('无效 TTS 配置');
      const needRegenerate = this.updateConfig(config);
      this._saveConfig();
      return { success: true, needRegenerate };
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
        this._saveConfig();
        this._log('TTS 模型切换为: ' + modelName, 'info');

        // 如果模型路径变了且 worker 已启动，需要重启 worker
        if (changed && this.worker) {
          this._log('重启 TTS 引擎以加载新模型...', 'info');
          // 统一交给引擎替换旧 worker、结束旧请求，不在 IPC 层复制生命周期。
          this.initialized = false;

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
            return { success: false, error: '新模型加载失败', restarted: false };
          }
        }

        return { success: true, restarted: changed && !!this.worker };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
  }
};
