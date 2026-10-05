class AiManager {
  constructor() { this.loadConfig(); }

  loadConfig() {
    const config = require('../config');
    this.setAiConfig({ preset: config.get('ai-preset', ''), key: config.get('ai-api-key', ''), baseUrl: config.get('ai-base-url', ''), model: config.get('ai-model', 'doubao') });
  }

  registerIpcHandlers() { require('./ipc').call(this); }

  setAiApiKey(key) {
    this.aiApiKey = key || '';
    return { success: true };
  }

  getAiApiKey() {
    return this.aiApiKey;
  }

  setAiConfig(cfg) {
    cfg = cfg || {};
    if (typeof cfg.preset === 'string') this.aiPreset = cfg.preset;
    else if (typeof cfg.model === 'string') this.aiPreset = ''; // 旧调用只传模型时，继续按原模型选择服务。
    if (typeof cfg.key === 'string') this.aiApiKey = cfg.key;
    if (typeof cfg.baseUrl === 'string') this.aiBaseUrl = cfg.baseUrl;
    if (typeof cfg.model === 'string') this.aiModel = cfg.model;
    return { success: true };
  }

  getAiConfig() {
    return {
      key: this.aiApiKey,
      baseUrl: this.aiBaseUrl,
      model: this.aiModel,
      preset: this.aiPreset,
      builtin: this.isBuiltinAiModel(),
    };
  }

  isBuiltinAiModel() {
    return !!AiManager.builtinModel({ preset: this.aiPreset, model: this.aiModel });
  }

  static builtinModel(config = {}) {
    if (config.preset === 'custom') return null;
    const model = String(config.preset || config.model || 'doubao').toLowerCase();
    return ['chatnut', 'qwen', 'doubao', 'cehpoint'].includes(model) ? model : null;
  }

  static askWithConfig(config = {}, prompt, options = {}) {
    const model = AiManager.builtinModel(config);
    if (model === 'cehpoint') {
      return require('./providers/openai-compatible')({ baseUrl: 'https://ai-api.cehpoint.co.in/v1/chat/completions', model: 'cehpoint-ai', key: '' }, prompt, options);
    }
    if (model) {
      return require('./providers/chatnut').ask(prompt, { ...options, model });
    }
    return require('./providers/openai-compatible')(config, prompt, options);
  }

  ask(prompt, options) { return AiManager.askWithConfig(this.getAiConfig(), prompt, options); }

  async askChoice(question, candidates, options = {}) {
    const chatnut = require('./providers/chatnut');
    const builtin = AiManager.builtinModel(this.getAiConfig());
    if (builtin && builtin !== 'cehpoint') return chatnut.askChoice(question, candidates, { ...options, model: builtin });
    const prompt = '题目: ' + question + '\n选项:\n' + candidates.map((text, i) => (i + 1) + '. ' + text).join('\n') + '\n哪个是正确的?';
    const result = await this.ask(prompt, { ...options, maxTokens: 512 });
    let index = chatnut.parseChoice(result.text, candidates.length);
    if (index < 0) index = chatnut.matchCandidate(result.text, candidates);
    return { ...result, index };
  }

  async testAiConnection() {
    const result = await this.ask('你好，请回复：连接成功。', { timeout: 15000, maxTokens: 20 });
    if (!result.text) throw new Error('AI 返回内容为空');
    return { success: true, model: this.aiModel || '', ms: result.ms, detail: result.text.slice(0, 60) };
  }
}
module.exports = AiManager;
