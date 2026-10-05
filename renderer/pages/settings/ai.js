import { createLogger } from '../../services/logger.js';
import settingsStorage from '../../services/settings.js';
const moduleLog = createLogger('AI');

export default function initAiSettings(logManager) {
    try {
      // 初始化 AI 兜底配置；主进程 settings.json 持久化，复杂配置只缓存在内存，不再写入 localStorage。
      // 内置 doubao/qwen/chatnut 走词典笔免费链路，不需要地址和 Key，这几行直接隐藏。
      const aiPresetSelect = document.getElementById('aiPresetSelect');
      const aiBaseUrlInput = document.getElementById('aiBaseUrlInput');
      const aiApiKeyInput = document.getElementById('aiApiKeyInput');
      const aiModelInput = document.getElementById('aiModelInput');
      if (aiPresetSelect && aiBaseUrlInput && aiApiKeyInput && aiModelInput) {
        const AI_PRESETS = {
          'doubao':  { baseUrl: '', model: 'doubao',  builtin: true },
          'qwen':    { baseUrl: '', model: 'qwen',    builtin: true },
          'chatnut': { baseUrl: '', model: 'chatnut', builtin: true },
          'cehpoint': { baseUrl: '', model: 'cehpoint-ai', builtin: true },
          'custom':  { baseUrl: '', model: '', builtin: false },
        };
        const rows = ['aiBaseUrlRow', 'aiApiKeyRow', 'aiModelRow'].map(id => document.getElementById(id));

        const applyPresetVisibility = (presetKey) => {
          const p = AI_PRESETS[presetKey] || AI_PRESETS.custom;
          rows.forEach(el => { if (el) el.style.display = p.builtin ? 'none' : ''; });
          const hint = document.getElementById('aiProviderHint');
          if (hint) hint.textContent = p.builtin ? '使用内置免 Key 通道，无需填写地址或密钥。AI 答题和答案规则生成共用此选项。' : '使用 OpenAI 兼容接口；支持免鉴权服务，API Key 可留空。AI 答题和答案规则生成共用此配置。';
        };

        const pushAiConfig = async () => {
          const cfg = {
            preset: aiPresetSelect.value,
            key: aiPresetSelect.value === 'custom' ? aiApiKeyInput.value.trim() : '',
            baseUrl: aiBaseUrlInput.value.trim(),
            model: aiModelInput.value.trim(),
          };
          settingsStorage.setItem('ai-api-key', cfg.key);
          settingsStorage.setItem('ai-base-url', cfg.baseUrl);
          settingsStorage.setItem('ai-model', cfg.model);
          settingsStorage.setItem('ai-preset', aiPresetSelect.value);
          if (cfg.preset === 'custom') settingsStorage.setItem('ai-custom-config', JSON.stringify(cfg));
          if (window.electronAPI && window.electronAPI.setAiConfig) {
            try {
              await window.electronAPI.setAiConfig(cfg);
            } catch (error) {
              moduleLog.error('同步AI配置到主进程失败:', error);
            }
          } else if (window.electronAPI && window.electronAPI.setAiApiKey) {
            try { await window.electronAPI.setAiApiKey(cfg.key); } catch (e) { /* 旧版回退 */ }
          }
        };

        // 旧版无 preset 时按已有模型推断，避免覆盖自定义供应商。
        const savedModel = settingsStorage.getItem('ai-model') || 'doubao';
        const savedPreset = settingsStorage.getItem('ai-preset') || (AI_PRESETS[savedModel]?.builtin ? savedModel : 'custom');
        aiPresetSelect.value = AI_PRESETS[savedPreset] ? savedPreset : 'custom';
        aiApiKeyInput.value = settingsStorage.getItem('ai-api-key') || '';
        aiBaseUrlInput.value = settingsStorage.getItem('ai-base-url') || '';
        aiModelInput.value = savedModel;
        if (AI_PRESETS[aiPresetSelect.value].builtin) {
          aiBaseUrlInput.value = ''; aiApiKeyInput.value = ''; aiModelInput.value = AI_PRESETS[aiPresetSelect.value].model;
        }
        applyPresetVisibility(aiPresetSelect.value);
        pushAiConfig();

        aiPresetSelect.addEventListener('change', async () => {
          const p = AI_PRESETS[aiPresetSelect.value] || AI_PRESETS.custom;
          let custom = {};
          try { custom = JSON.parse(settingsStorage.getItem('ai-custom-config') || '{}') || {}; } catch {}
          aiBaseUrlInput.value = p.builtin ? '' : custom.baseUrl || '';
          aiApiKeyInput.value = p.builtin ? '' : custom.key || '';
          aiModelInput.value = p.builtin ? p.model : custom.model || '';
          applyPresetVisibility(aiPresetSelect.value);
          const status = document.getElementById('aiTestStatus');
          if (status) status.textContent = '';
          await pushAiConfig();
          logManager.addSuccessLog('AI 服务已切换为 ' + aiPresetSelect.options[aiPresetSelect.selectedIndex].text, "AI");
        });

        [aiBaseUrlInput, aiApiKeyInput, aiModelInput].forEach(el => {
          el.addEventListener('change', async () => {
            await pushAiConfig();
            logManager.addSuccessLog('AI 配置已更新', "AI");
          });
        });

        // 测试连接: 先同步最新配置, 再调用主进程发起真实请求并展示状态
        const aiTestBtn = document.getElementById('aiTestBtn');
        const aiTestStatus = document.getElementById('aiTestStatus');
        const aiTestLabel = aiTestBtn && aiTestBtn.querySelector('span');
        if (aiTestBtn) {
          const renderTestStatus = (text, color) => {
            if (!aiTestStatus) return;
            aiTestStatus.textContent = text;
            aiTestStatus.style.color = color;
          };
          const setBtnLabel = (text) => {
            if (aiTestLabel) aiTestLabel.textContent = text;
            else aiTestBtn.textContent = text;
          };
          aiTestBtn.addEventListener('click', async () => {
            if (aiTestBtn.disabled) return;
            aiTestBtn.disabled = true;
            setBtnLabel('测试中...');
            renderTestStatus('正在测试连接，请稍候...', 'var(--color-text-muted)');
            try {
              await pushAiConfig();
              const result = await window.electronAPI.testAiConnection();
              if (result && result.success) {
                logManager.addSuccessLog(`AI 连接测试成功（${result.model}，${result.ms}ms）`, "AI");
                renderTestStatus(`连接成功（${result.ms}ms）`, 'var(--color-success-text)');
              } else {
                const msg = (result && result.error) || '连接失败';
                logManager.addErrorLog(`AI 连接测试失败: ${msg}`, "AI");
                renderTestStatus(`连接失败: ${msg}`, 'var(--color-error-text)');
              }
            } catch (error) {
              logManager.addErrorLog(`AI 连接测试异常: ${error.message}`, "AI");
              renderTestStatus(`测试异常: ${error.message}`, 'var(--color-error-text)');
            } finally {
              aiTestBtn.disabled = false;
              setBtnLabel('测试连接');
            }
          });
        }
      }

    } catch (error) { moduleLog.error('初始化 AI 设置失败:', error); }
}
