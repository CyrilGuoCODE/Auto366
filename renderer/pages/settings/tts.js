import { createLogger } from '../../services/logger.js';
const moduleLog = createLogger('TTS');
import settingsStorage from '../../services/settings.js';

export default {
initTtsSettings() {
    try {
      // 初始化 GLM-TTS API Key
      const glmApiKeyInput = document.getElementById('glmApiKeyInput');
      if (glmApiKeyInput) {
        const savedGlmApiKey = settingsStorage.getItem('glm-api-key') || '';
        glmApiKeyInput.value = savedGlmApiKey;
        if (savedGlmApiKey && window.electronAPI && window.electronAPI.setGlmApiKey) {
          window.electronAPI.setGlmApiKey(savedGlmApiKey);
        }

        glmApiKeyInput.addEventListener('change', async () => {
          const newKey = glmApiKeyInput.value.trim();
          settingsStorage.setItem('glm-api-key', newKey);
          if (window.electronAPI && window.electronAPI.setGlmApiKey) {
            try {
              await window.electronAPI.setGlmApiKey(newKey);
            } catch (error) {
              moduleLog.error('同步GLM-TTS API Key到主进程失败:', error);
            }
          }
          this.logManager.addSuccessLog('GLM-TTS Key已更新' + (newKey ? '' : ' (已清空)'), "TTS");
        });
      }
      // 从 localStorage 读取已保存的配置
      const savedConfig = (() => {
        try {
          return JSON.parse(settingsStorage.getItem('tts-config') || 'null');
        } catch (e) { return null; }
      })();

      const voiceSelect = document.getElementById('ttsVoiceSelect');
      const speedInput = document.getElementById('ttsSpeedInput');
      const modelSelect = document.getElementById('ttsModelSelect');
      const engineSelect = document.getElementById('ttsEngineSelect');
      const approvalEnabled = document.getElementById('ttsApprovalEnabled');
      const modelItem = modelSelect ? modelSelect.closest('.setting-item') : null;
      const voiceItem = voiceSelect ? voiceSelect.closest('.setting-item') : null;

      // chestnut 音色选项
      const CHESTNUT_VOICES = [
        ['english',  'English (youxiaomei)'],
        ['normal',   '中文标准 (you_xiao_shi)'],
        ['taiyi',    '太乙真人'],
        ['tianjin',  '天津话 (you_xiao_jin)'],
      ];

      // GLM-TTS 音色选项
      const GLM_VOICES = [
        ['tongtong',  '彤彤（默认女声）'],
        ['xiaochen',  '小陈'],
        ['chuichui',  '锤锤'],
        ['jam',       'jam'],
        ['kazi',      'kazi'],
        ['douji',     'douji'],
        ['luodo',     'luodo'],
      ];

      function populateSherpaVoices(select) {
        if (!select) return;
        const opts = [
          ['Jasper', 'Jasper (男)'], ['Bella', 'Bella (女)'],
          ['Bruno', 'Bruno (男)'], ['Luna', 'Luna (女)'],
          ['Hugo', 'Hugo (男)'], ['Rosie', 'Rosie (女)'],
          ['Leo', 'Leo (男)'], ['Kiki', 'Kiki (女)'],
        ];
        select.innerHTML = '';
        opts.forEach(([v, t]) => {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = t;
          select.appendChild(opt);
        });
      }

      function populateChestnutVoices(select, savedChestnutVoice) {
        if (!select) return;
        select.innerHTML = '';
        CHESTNUT_VOICES.forEach(([v, t]) => {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = t;
          if (v === savedChestnutVoice) opt.selected = true;
          select.appendChild(opt);
        });
      }

      async function populateGlmVoices(select, savedGlmVoice) {
        if (!select) return;
        select.innerHTML = '';

        // 先填入内置音色
        GLM_VOICES.forEach(([v, t]) => {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = t;
          if (v === savedGlmVoice) opt.selected = true;
          select.appendChild(opt);
        });

        // 从账号拉取克隆音色
        if (window.electronAPI && window.electronAPI.getGlmVoices) {
          try {
            const result = await window.electronAPI.getGlmVoices();
            if (result.success && result.voices && result.voices.length > 0) {
              // 添加分隔线
              const sep = document.createElement('option');
              sep.disabled = true;
              sep.textContent = '── 克隆音色 ──';
              select.appendChild(sep);

              result.voices.forEach((v) => {
                const opt = document.createElement('option');
                opt.value = v.voice;
                opt.textContent = v.voice_name + ' (' + v.voice_type + ')';
                if (v.voice === savedGlmVoice) opt.selected = true;
                select.appendChild(opt);
              });
            }
          } catch (e) {
            moduleLog.log('获取GLM克隆音色失败:', e);
          }
        }
      }

      // 根据引擎切换音色下拉
      function applyVoiceOptions(engine, savedChestnutVoice, savedGlmVoice) {
        if (engine === 'chestnut') {
          populateChestnutVoices(voiceSelect, savedChestnutVoice);
        } else if (engine === 'glm-tts') {
          populateGlmVoices(voiceSelect, savedGlmVoice);
        } else {
          populateSherpaVoices(voiceSelect);
        }
      }

      // ===== A366 资源下载：TTS 模型下载入口（无本地模型时显示） =====
      const showTtsDownloadHint = () => {
        if (this._ttsHintEl) return;
        const container = modelSelect && modelSelect.closest('.setting-item');
        if (!container || !container.parentElement) return;
        const wrap = document.createElement('div');
        wrap.className = 'setting-item a366-dl';
        wrap.innerHTML =
          '<button type="button" class="btn btn--primary btn--sm" id="ttsModelDownloadBtn">下载模型</button>' +
          '<div class="a366-dl__track"><div id="ttsModelDownloadFill" class="a366-dl__fill"></div></div>' +
          '<span class="a366-dl__status" id="ttsModelDownloadStatus"></span>';
        container.parentElement.insertBefore(wrap, container.nextSibling);
        this._ttsHintEl = wrap;
        const btn = wrap.querySelector('#ttsModelDownloadBtn');
        const status = wrap.querySelector('#ttsModelDownloadStatus');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          status.textContent = '下载中...';
          const res = await window.electronAPI.downloadA366Resource('tts', {});
          if (res && res.success) {
            hideTtsDownloadHint();
            if (this._ttsLoadModels) this._ttsLoadModels();
            this.logManager.addSuccessLog('TTS 本地模型下载完成', "TTS");
          } else {
            status.textContent = '下载失败';
            btn.disabled = false;
            this.logManager.addErrorLog('TTS 模型下载失败：' + (res ? res.message : '未知错误'), "TTS");
          }
        });
        if (!this._ttsDlListener) {
          this._ttsDlListener = (data) => {
            if (!this._ttsHintEl || !data || data.group !== 'tts') return;
            const f = this._ttsHintEl.querySelector('#ttsModelDownloadFill');
            const s = this._ttsHintEl.querySelector('#ttsModelDownloadStatus');
            if (!f || !s) return;
            if (data.stage === 'download') {
              f.style.width = (data.percent || 0) + '%';
              s.textContent = `${data.percent || 0}%${data.source === 'github' ? '·备用' : ''}`;
            } else if (data.stage === 'extract') {
              s.textContent = '解包中...';
            } else if (data.stage === 'done') {
              f.style.width = '100%';
              s.textContent = '下载完成';
            }
          };
          window.electronAPI.onA366DownloadProgress(this._ttsDlListener);
        }
      };
      const hideTtsDownloadHint = () => {
        if (this._ttsHintEl) { this._ttsHintEl.remove(); this._ttsHintEl = null; }
      };
      this._showTtsDownloadHint = showTtsDownloadHint;
      this._hideTtsDownloadHint = hideTtsDownloadHint;

      // 加载可用模型列表；无本地模型时显示下载入口
      if (modelSelect && window.electronAPI && window.electronAPI.getTtsModels) {
        const loadModels = () => window.electronAPI.getTtsModels().then(modelNames => {
          if (modelNames && modelNames.length > 0) {
            modelSelect.innerHTML = '';
            modelNames.forEach(name => {
              const opt = document.createElement('option');
              opt.value = name;
              opt.textContent = name;
              modelSelect.appendChild(opt);
            });
            // 恢复已保存的模型
            if (savedConfig && savedConfig.modelName) {
              modelSelect.value = savedConfig.modelName;
            }
            hideTtsDownloadHint();
          } else {
            showTtsDownloadHint();
          }
        }).catch(() => {});
        loadModels();
        this._ttsLoadModels = loadModels;
      }

      // 恢复已保存的值
      if (savedConfig) {
        if (savedConfig.voice && voiceSelect && savedConfig.engine !== 'chestnut') {
          voiceSelect.value = savedConfig.voice;
        }
        if (savedConfig.speed !== undefined && speedInput) {
          speedInput.value = savedConfig.speed;
        }
        if (savedConfig.engine && engineSelect) {
          engineSelect.value = savedConfig.engine;
        }
      }
      if (approvalEnabled) {
        approvalEnabled.checked = !savedConfig || savedConfig.approvalEnabled !== false;
      }
      // 主进程每次启动都会用默认配置初始化；把用户上次保存的审批开关立即同步过去，
      // 否则界面虽显示“关闭”，本次启动仍会按默认值弹审批框。
      if (savedConfig && window.electronAPI && window.electronAPI.saveTtsConfig) {
        window.electronAPI.saveTtsConfig({
          ...savedConfig,
          approvalEnabled: savedConfig.approvalEnabled !== false,
        }).catch(() => {});
      }

      // 按引擎初始化音色下拉
      applyVoiceOptions(engineSelect ? engineSelect.value : 'auto', savedConfig ? savedConfig.chestnutVoice : null, savedConfig ? savedConfig.glmVoice : null);

      // 保存配置到 localStorage 并同步到主进程
      const saveTtsConfig = () => {
        const engine = engineSelect ? engineSelect.value : 'auto';
        const config = {
          voice: voiceSelect ? voiceSelect.value : 'Jasper',
          speed: speedInput ? parseFloat(speedInput.value) || 1.0 : 1.0,
          modelName: modelSelect ? modelSelect.value : undefined,
          engine: engine,
          approvalEnabled: approvalEnabled ? approvalEnabled.checked : true,
        };
        // chestnut 模式下额外保存 chestnutVoice
        if (engine === 'chestnut' && voiceSelect) {
          config.chestnutVoice = voiceSelect.value;
        }
        // glm-tts 模式下额外保存 glmVoice
        if (engine === 'glm-tts' && voiceSelect) {
          config.glmVoice = voiceSelect.value;
        }
        // auto 模式：不使用自定义音色/模型，回退到默认
        if (engine === 'auto') {
          config.voice = 'Jasper';
          config.modelName = undefined;
          config.chestnutVoice = undefined;
          config.glmVoice = undefined;
        }
        settingsStorage.setItem('tts-config', JSON.stringify(config));

        // 同步到主进程
        if (window.electronAPI && window.electronAPI.saveTtsConfig) {
          window.electronAPI.saveTtsConfig(config).then(result => {
            if (result && result.success) {
              this.logManager.addSuccessLog('TTS 设置已保存', "TTS");
            }
          }).catch(e => {
            moduleLog.error('保存 TTS 配置到主进程失败:', e);
          });
        }
      };

      // 模型切换：保存配置 + 通知主进程切换模型
      if (modelSelect) {
        modelSelect.addEventListener('change', () => {
          saveTtsConfig();
          if (window.electronAPI && window.electronAPI.setTtsModel) {
            window.electronAPI.setTtsModel(modelSelect.value).then(result => {
              if (result && result.success) {
                this.logManager.addSuccessLog('TTS 模型已切换为: ' + modelSelect.value + (result.restarted ? ' (引擎已重启)' : ''), "TTS");
              } else {
                this.logManager.addErrorLog('TTS 模型切换失败: ' + (result.error || '未知错误'), "TTS");
              }
            }).catch(e => {
              this.logManager.addErrorLog('TTS 模型切换失败: ' + e.message, "TTS");
            });
          }
        });
      }

      if (voiceSelect) {
        voiceSelect.addEventListener('change', saveTtsConfig);
      }
      if (speedInput) {
        speedInput.addEventListener('change', saveTtsConfig);
      }
      if (approvalEnabled) {
        approvalEnabled.addEventListener('change', saveTtsConfig);
      }
      if (engineSelect) {
        engineSelect.addEventListener('change', () => {
          const engine = engineSelect.value;
          const isChestnut = engine === 'chestnut';
          const isGlmTts = engine === 'glm-tts';
          const isAuto = engine === 'auto';
          // 切换音色下拉选项
          if (isChestnut) {
            populateChestnutVoices(voiceSelect, savedConfig ? savedConfig.chestnutVoice : null);
          } else if (isGlmTts) {
            populateGlmVoices(voiceSelect, savedConfig ? savedConfig.glmVoice : null);
          } else {
            populateSherpaVoices(voiceSelect);
            if (savedConfig && savedConfig.voice && !isAuto) {
              voiceSelect.value = savedConfig.voice;
            }
          }
          // 模型选择：仅 sherpa-onnx 需要手动选
          if (modelItem) modelItem.style.display = isAuto || isChestnut || isGlmTts ? 'none' : '';
          // 音色选择：auto 模式用默认音色，隐藏
          if (voiceItem) voiceItem.style.display = isAuto ? 'none' : '';
          saveTtsConfig();
        });
        // 初始状态：auto 与在线引擎隐藏模型，auto 隐藏音色
        const initEngine = savedConfig ? savedConfig.engine : 'auto';
        if (modelItem) modelItem.style.display = (initEngine === 'auto' || initEngine === 'chestnut' || initEngine === 'glm-tts') ? 'none' : '';
        if (voiceItem) voiceItem.style.display = (initEngine === 'auto') ? 'none' : '';
      }
    } catch (error) {
      moduleLog.error('初始化 TTS 设置失败:', error);
    }
  }
};
