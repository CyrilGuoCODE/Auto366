const moduleLog = require('../../logging').create('AI答案');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fingerprint, digest, redactResponse, requestText } = require('./request');
const { validate, LIMITS, validEntry } = require('./policy');
const execute = require('./executor');
const sync = require('./sync');
const discover = require('./discovery');

class AnswerLearning {
  constructor({ getAiConfig, notify, directory = require('../../config').root }) {
    this.getAiConfig = getAiConfig;
    this.notify = notify;
    this.file = path.join(directory, 'answer-policies.json');
    this.samples = new Map();
    this.previews = new Map();
    this.quarantined = new Map();
    this.generating = false;
    this.lastGeneration = 0;
    this.attempts = new Map();
    this.pending = new Map();
    this.activity = '等待未识别的题目响应';
    this.epoch = 0;
    this.state = { version: 1, enabled: false, autoGenerate: false, autoShare: false, heuristic: true, records: [], checkpoints: {} };
    try {
      if (fs.statSync(this.file).size > 2097152) throw new Error('策略文件过大');
      let saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version === 2) {
        if (!saved.settings || !saved.sync || !Array.isArray(saved.rules)) throw new Error('策略存储分区无效');
        saved = { version: 1, enabled: saved.settings.enabled, autoGenerate: saved.settings.autoGenerate ?? saved.settings.enabled,
          autoShare: saved.settings.autoShare, heuristic: saved.settings.heuristic, records: saved.rules, checkpoints: saved.sync.checkpoints };
      }
      if (saved.version !== 1 || !Array.isArray(saved.records) || saved.records.length > 50) throw new Error('策略存储格式无效');
      for (const record of saved.records) {
        validate(record.pair);
        if (record.id !== digest(record.pair)) throw new Error('策略内容已改变');
      }
      for (const key of ['enabled', 'autoGenerate', 'autoShare', 'heuristic']) if (saved[key] !== undefined && typeof saved[key] !== 'boolean') throw new Error('策略开关无效');
      if (!saved.checkpoints || typeof saved.checkpoints !== 'object' || Array.isArray(saved.checkpoints)) throw new Error('同步状态无效');
      this.state = { ...this.state, ...saved, heuristic: saved.heuristic !== false };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.loadError = error;
        this.notify('rule-log', moduleLog.event({ type: 'warning', message: 'AI 规则未加载，原文件已保留：' + error.message }));
      }
    }
    this.activity = this.state.enabled ? '等待未识别的题目响应' : '未开启自动答案获取';
    this.persistedState = JSON.stringify(this.state);
  }
  save() {
    try {
      if (this.loadError) throw new Error('原 AI 规则文件读取失败，禁止覆盖；请恢复备份后重启');
      const content = JSON.stringify({ version: 2,
        settings: { enabled: this.state.enabled, autoGenerate: this.state.autoGenerate, autoShare: this.state.autoShare, heuristic: this.state.heuristic },
        rules: this.state.records, sync: { checkpoints: this.state.checkpoints } }, null, 2);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (fs.existsSync(this.file) && !fs.existsSync(this.file + '.bak')) fs.copyFileSync(this.file, this.file + '.bak', fs.constants.COPYFILE_EXCL);
      fs.writeFileSync(this.file + '.tmp', content);
      fs.renameSync(this.file + '.tmp', this.file);
      this.persistedState = JSON.stringify(this.state);
    } catch (error) { this.state = JSON.parse(this.persistedState); throw error; }
  }
  status() {
    this.pruneSamples();
    return { enabled: this.state.enabled, autoGenerate: this.state.autoGenerate, autoShare: this.state.autoShare, heuristic: this.state.heuristic, pending: this.pending.size, activity: this.activity, generating: this.generating, cloudConfigured: sync.configured(),
      samples: [...this.samples].map(([id, sample]) => ({ id, label: sample.method + ' ' + new URL(sample.url).host + new URL(sample.url).pathname + (sample.entry ? ' · ZIP: ' + sample.entry : ''), reasons: sample.discovery?.reasons || [], confidence: sample.discovery?.confidence })),
      records: this.state.records.map(({ id, pair, enabled, origin, expiresAt, revoked, blockedReason, shareState, shareError }) => ({ id, questionType: pair.questionType, enabled: !!(enabled && !revoked && (!expiresAt || expiresAt > Date.now()) && !this.quarantined.has(id)), origin, expiresAt, blockedReason: this.quarantined.get(id) || blockedReason || (revoked ? '已撤销' : expiresAt && expiresAt <= Date.now() ? '已过期' : ''), pattern: pair.request.regex.pattern, entry: pair.response.entry, shareState, shareError, review: !revoked && (!expiresAt || expiresAt > Date.now()) ? this.review(id) : null })) };
  }
  sample(id) { this.pruneSamples(); const sample = this.samples.get(id); if (!sample) throw new Error('样本已失效，请重新捕获'); return sample; }
  record(id) { const record = this.state.records.find(r => r.id === id); if (!record) throw new Error('规则不存在'); return record; }
  invalidate() { this.epoch++; }
  async observeArchive(info, result) {
    if (!this.state.enabled || info.statusCode < 200 || info.statusCode >= 300 || !result?.extractDir || (this.archiveJobs || 0) >= 2) return;
    this.archiveJobs = (this.archiveJobs || 0) + 1;
    const epoch = this.epoch;
    // Do not retain originalResponse or the traffic log's binary buffer while AI runs.
    info = { url: info.url, method: info.method, statusCode: info.statusCode,
      requestHeaders: { 'content-type': info.requestHeaders?.['content-type'] || '' }, requestBody: info.requestBody || '', uuid: info.uuid };
    let handedOff = false;
    try {
      const host = new URL(info.url).host.toLowerCase();
      const members = await require('./archive')(result, member =>
        this.state.enabled && epoch === this.epoch && (discover({ ...info, ...member }, this.state.heuristic)
          || this.state.records.some(record => record.enabled && record.pair.request.host === host && record.pair.response.entry === member.entry)));
      if (!members.length || epoch !== this.epoch || !this.state.enabled) return;
      // Only bounded in-memory text survives cleanup. AI/network work does not
      // hold the response callback or depend on the extraction directory.
      const processMembers = async () => {
        for (const member of members) {
          if (epoch !== this.epoch || !this.state.enabled) break;
          await this.observe({ ...info, contentType: 'text/plain', responseBody: member.response, entry: member.entry }, true);
        }
        // Collect all members before a slow AI call or cloud sync can occupy
        // the queue or invalidate the generation epoch.
        await this.drain();
      };
      handedOff = true;
      this.archiveWork = processMembers().catch(error => moduleLog.warn('ZIP 候选分析失败：', error.message))
        .finally(() => { this.archiveJobs--; });
    } finally { if (!handedOff) this.archiveJobs--; }
  }
  async observe(info, deferGeneration = false) {
    if (!this.state.enabled || info.statusCode < 200 || info.statusCode >= 300 || !/json|text|xml|javascript/i.test(info.contentType || '')) return;
    const response = info.responseBody;
    if (typeof response !== 'string' || !response.length || Buffer.byteLength(response) > LIMITS.input) return;
    if (info.entry !== undefined && !validEntry(info.entry)) return;
    const sample = { url: info.url, method: info.method, requestContentType: info.requestHeaders?.['content-type'] || '', requestBody: info.requestBody || '', response, ...(info.entry ? { entry: info.entry } : {}) };
    if (Buffer.byteLength(JSON.stringify(sample)) > LIMITS.input * 2) return;
    const discovery = discover(sample, this.state.heuristic);
    if (!discovery && !this.state.records.some(record => record.enabled && (record.pair.request.host === new URL(sample.url).host.toLowerCase() || record.pair.version === 1))) return;
    this.pruneSamples();
    const route = discovery?.route || sample.method + ' ' + new URL(sample.url).origin + new URL(sample.url).pathname + (sample.entry ? ' ZIP:' + sample.entry : '');
    // 路径仅用于样本去重和生成限频，是否匹配完全由规则正则决定。
    const sampleId = digest(sample);
    const activeSample = this.samples.get(sampleId);
    if (activeSample && (sampleId === this.generatingSampleId || sampleId === this.processingSampleId)) {
      activeSample.capturedAt = Date.now();
      return;
    }
    for (const [id, old] of this.samples) if (id !== this.generatingSampleId && id !== this.processingSampleId && old.route === route) this.samples.delete(id);
    Object.assign(sample, { route, discovery, capturedAt: Date.now(), captureId: info.uuid });
    this.samples.set(sampleId, sample);
    this.startMaintenance();
    if (this.samples.size > 8) this.samples.delete([...this.samples.keys()].find(id => id !== this.generatingSampleId && id !== this.processingSampleId));
    this.notify('answer-learning:changed', null);
    const epoch = this.epoch;
    const candidates = this.state.records.filter(r => r.enabled && (r.pair.response.entry || null) === (sample.entry || null) && !this.quarantined.has(r.id) && !r.revoked && (!r.expiresAt || r.expiresAt > Date.now()) && (r.pair.version === 1 ? r.pair.request.fingerprint === fingerprint(sample).id : r.pair.request.host === new URL(sample.url).host.toLowerCase()));
    const matches = [];
    for (const record of candidates) {
      try {
        const result = await execute(record.pair, sample);
        if (result.matched && result.answers.length) matches.push(result);
      } catch (error) {
        if (error.code === 'BUSY') return;
        if (!['POLICY_TIMEOUT', 'POLICY_INVALID'].includes(error.code)) throw error;
        record.enabled = false;
        record.blockedReason = error.message;
        this.quarantined.set(record.id, error.message);
        this.invalidate();
        try { this.save(); }
        catch (saveError) { moduleLog.error('异常规则已在当前会话隔离，但保存失败：', saveError); }
        this.notify('rule-log', moduleLog.event({ type: 'warning', message: '已隔离异常 AI 规则：' + error.message }));
        this.notify('answer-learning:changed', null);
        return;
      }
    }
    if (!this.state.enabled || epoch !== this.epoch || this.samples.get(sampleId) !== sample) return;
    if (matches.length === 1) this.notify('answers-extracted', { answers: matches[0].answers, count: matches[0].answers.length, source: 'ai-policy', captureId: sample.captureId });
    else if (matches.length > 1) this.notify('rule-log', moduleLog.event({ type: 'warning', message: 'AI 答案规则匹配存在歧义，已跳过；请只启用一条适用规则。' }));
    else if (this.state.autoGenerate && discovery) await this.enqueue(sampleId, route, deferGeneration);
  }
  pruneSamples() {
    const now = Date.now();
    for (const [id, sample] of this.samples) if (id !== this.generatingSampleId && id !== this.processingSampleId && now - sample.capturedAt >= 300000) this.samples.delete(id);
    for (const [route, id] of this.pending) if (!this.samples.has(id)) this.pending.delete(route);
    for (const [token, preview] of this.previews) if (preview.expires <= now) this.previews.delete(token);
  }
  startMaintenance() {
    if (this.maintenance) return;
    this.maintenance = setInterval(() => {
      this.pruneSamples();
      this.drain().catch(error => moduleLog.warn('候选处理失败：', error.message));
      if (!this.samples.size && !this.pending.size && !this.previews.size) { clearInterval(this.maintenance); this.maintenance = null; }
      this.notify('answer-learning:changed', null);
    }, 15000);
    this.maintenance.unref?.();
  }
  async enqueue(id, route, deferGeneration = false) {
    this.pending.set(route, id);
    while (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value);
    if (!deferGeneration) await this.drain();
  }
  async drain() {
    if (this.processing || this.generating || !this.state.enabled || !this.state.autoGenerate) return;
    this.pruneSamples();
    if (Date.now() - this.lastGeneration < 60000) return;
    const next = this.pending.entries().next().value;
    if (!next) return;
    const [route, id] = next;
    this.pending.delete(route); this.processing = true; this.processingSampleId = id;
    try { await this.automate(id, route); }
    catch (error) {
      if (error.code === 'BUSY' && this.state.enabled && this.samples.has(id)) this.pending.set(route, id);
      else throw error;
    }
    finally { this.processing = false; this.processingSampleId = null; }
  }
  clearSamples() {
    this.invalidate(); this.samples.clear(); this.previews.clear(); this.pending.clear();
    clearInterval(this.maintenance); this.maintenance = null;
    this.activity = this.state.enabled ? '临时样本已清除，等待新的题目响应' : '未开启自动答案获取';
    this.notify('answer-learning:changed', null);
  }
  dispose() { this.state.enabled = false; this.clearSamples(); }
  review(id) {
    const values = [...this.previews.values()].filter(p => p.id === id && p.expires > Date.now());
    const last = values.at(-1);
    if (!last) return null;
    const token = [...this.previews].find(([, value]) => value === last)?.[0];
    return { token, answers: last.result.answers };
  }
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('开关参数无效');
    this.state.enabled = enabled;
    this.state.autoGenerate = enabled;
    this.invalidate();
    if (!enabled) this.clearSamples();
    this.activity = enabled ? '已开启，自动捕获并生成规则；请正常打开题目' : '已关闭自动答案获取';
    this.save(); this.notify('answer-learning:changed', null);
    return this.status();
  }
  async automate(sampleId, route) {
    if (this.generating || !this.state.enabled) return;
    const sample = this.sample(sampleId);
    // 只把可能包含答案的小响应送往 AI，不把每个页面和日志都上传。
    if (!sample.discovery || Buffer.byteLength(sample.response) > 65536) return;
    if (await this.previewPending(sampleId, sample)) return;
    const now = Date.now();
    if (now - this.lastGeneration < 60000 || now - (this.attempts.get(route) || 0) < 600000) return;
    if (this.attempts.size >= 32) this.attempts.delete(this.attempts.keys().next().value);
    this.attempts.set(route, now); this.lastGeneration = now;
    this.activity = '正在自动生成并验证匹配规则'; this.notify('answer-learning:changed', null);
    try {
      if (sync.configured()) {
        await this.download(sampleId).catch(error => moduleLog.warn('自动同步规则失败：', error.message));
        if (!this.state.enabled || !this.samples.has(sampleId)) return;
        if (await this.previewPending(sampleId, sample)) return;
      }
      if (!this.state.enabled || !this.samples.has(sampleId)) return;
      const generated = await this.generate(sampleId);
      if (!this.state.enabled || !this.samples.has(sampleId)) return;
      const record = this.record(generated.id);
      if (record.userDisabled || record.blockedReason || record.revoked || this.quarantined.has(record.id)) {
        this.activity = '生成结果与已停用或隔离的规则相同，已跳过';
        return;
      }
      await this.preview(generated.id, sampleId);
      this.activity = '已准备好答案预览，请在设置中核对后启用';
      this.notify('rule-log', moduleLog.event({ type: 'info', message: this.activity }));
    } catch (error) {
      if (!this.state.enabled) return;
      this.activity = '自动处理未完成：' + error.message + '；同类请求冷却后可再次尝试';
      moduleLog.warn(this.activity);
    } finally { this.notify('answer-learning:changed', null); }
  }
  async previewPending(sampleId, sample) {
    for (const record of this.state.records.filter(r => !r.enabled && (r.pair.response.entry || null) === (sample.entry || null) && !r.userDisabled && !r.blockedReason && !r.revoked && (!r.expiresAt || r.expiresAt > Date.now()) && r.pair.version === 2 && r.pair.request.host === new URL(sample.url).host.toLowerCase())) {
      try {
        await this.preview(record.id, sampleId);
        this.activity = '已更新待确认答案，请在设置中核对后启用';
        this.notify('answer-learning:changed', null);
        return true;
      } catch (error) {
        if (error.code === 'BUSY') throw error;
        if (['POLICY_TIMEOUT', 'POLICY_INVALID'].includes(error.code)) {
          record.blockedReason = error.message;
          this.quarantined.set(record.id, error.message);
          try { this.save(); } catch {}
        }
      }
    }
    return false;
  }
  async share(record) {
    if (!this.state.autoShare || !sync.configured() || record.origin !== 'local' || record.shareState === 'submitted') return;
    if (!record.enabled || record.revoked || record.blockedReason || this.quarantined.has(record.id)) return;
    try {
      await sync.submit(record.pair);
      record.shareState = 'submitted'; delete record.shareError;
    } catch (error) { record.shareState = 'failed'; record.shareError = error.message; }
    this.save();
  }
  async generate(sampleId) {
    if (this.generating) throw new Error('已有规则生成任务');
    const sample = this.sample(sampleId);
    const response = redactResponse(sample.response);
    if (Buffer.byteLength(response) > 65536) throw new Error('生成样本超过 64 KB，请选择较小的响应');
    this.generating = true;
    this.generatingSampleId = sampleId;
    const epoch = this.epoch;
    try {
      const pair = await require('./generate-policy')(this.getAiConfig(), { ...sample, response });
      if (epoch !== this.epoch) throw new Error('设置已改变，生成结果已丢弃');
      validate(pair);
      const id = digest(pair);
      if (!this.state.records.some(r => r.id === id)) {
        if (this.state.records.length >= 50) throw new Error('已达 50 条规则上限，请删除不再使用的规则');
        this.state.records.push({ id, pair, enabled: false, origin: 'local' });
        this.save();
      }
      return { id, pair };
    } finally { this.generating = false; this.generatingSampleId = null; }
  }
  async preview(id, sampleId) {
    const record = this.record(id);
    if (record.revoked || record.expiresAt && record.expiresAt <= Date.now()) throw new Error('共享规则已撤销或过期，请同步后重试');
    const sample = this.sample(sampleId), epoch = this.epoch;
    const result = await execute(record.pair, sample);
    if (epoch !== this.epoch || this.samples.get(sampleId) !== sample) throw new Error('样本或设置已改变，请重新打开题目');
    if (!result.matched || !result.answers.length) throw new Error('规则没有匹配到有效答案');
    for (const [oldToken, old] of this.previews) if (old.id === id) this.previews.delete(oldToken);
    const token = crypto.randomUUID();
    if (this.previews.size >= 16) this.previews.clear();
    this.previews.set(token, { id, sampleId, captureId: sample.captureId, digest: digest(record.pair), expires: Date.now() + 300000, result });
    this.notify('answer-learning:changed', null);
    return { token, pair: record.pair, ...result };
  }
  async approve(token) {
    const preview = this.previews.get(token);
    if (!preview || preview.expires < Date.now()) throw new Error('预览已过期，请重新验证');
    const record = this.record(preview.id);
    if (record.id !== preview.digest || record.revoked || record.expiresAt && record.expiresAt <= Date.now()) throw new Error('规则已变更或失效');
    record.enabled = true;
    delete record.userDisabled;
    delete record.blockedReason;
    this.invalidate();
    this.save();
    this.quarantined.delete(record.id);
    this.previews.delete(token);
    this.notify('answers-extracted', { answers: preview.result.answers, count: preview.result.answers.length, source: 'ai-policy', captureId: preview.captureId });
    await this.share(record);
    this.notify('answer-learning:changed', null);
  }
  async download(sampleId) {
    const fp = new URL(this.sample(sampleId).url).host.toLowerCase();
    const { manifest, checkpoint } = sync.verify(await sync.download(fp), fp, this.state.checkpoints[fp]);
    const existing = new Set(this.state.records.map(r => r.id));
    if (this.state.records.length + manifest.policies.filter(p => !existing.has(p.id)).length > 50) throw new Error('共享规则超过本地容量');
    for (const policy of manifest.policies) {
      const old = this.state.records.find(r => r.id === policy.id);
      if (old && old.origin === 'cloud') old.expiresAt = manifest.expiresAt;
      else if (!old) this.state.records.push({ ...policy, enabled: false, origin: 'cloud', expiresAt: manifest.expiresAt });
    }
    for (const record of this.state.records) if (manifest.revoked.includes(record.id)) { record.enabled = false; record.revoked = true; }
    this.state.checkpoints[fp] = checkpoint;
    this.invalidate();
    this.save();
  }
  register() {
    const ipc = require('../../register').forModule('answer-learning', { legacy: false });
    ipc.handle('status', () => this.status());
    ipc.handle('enabled', (_event, enabled) => {
      return this.setEnabled(enabled);
    });
    ipc.handle('clear-samples', () => { this.clearSamples(); return this.status(); });
    ipc.handle('heuristic', (_event, enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('开关参数无效');
      this.state.heuristic = enabled; this.save(); this.clearSamples();
      return this.status();
    });
    ipc.handle('sample', (_event, id) => { const s = this.sample(id); return { requestText: requestText(s), response: redactResponse(s.response) }; });
    ipc.handle('auto-share', (_event, enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('开关参数无效');
      this.state.autoShare = enabled; this.save();
      this.notify('answer-learning:changed', null);
    });
    ipc.handle('generate', (_event, id) => this.generate(id));
    ipc.handle('preview', (_event, id, sampleId) => this.preview(id, sampleId));
    ipc.handle('approve', (_event, token) => this.approve(token));
    ipc.handle('delete', (_event, id) => { this.state.records = this.state.records.filter(r => r.id !== id); this.invalidate(); this.previews.clear(); this.save(); this.quarantined.delete(id); });
    ipc.handle('disable', (_event, id) => { this.record(id).enabled = false; this.record(id).userDisabled = true; this.invalidate(); this.previews.clear(); this.save(); });
    ipc.handle('download', (_event, id) => this.download(id));
    ipc.handle('submit', (_event, id) => {
      const record = this.record(id);
      if (!record.enabled || this.quarantined.has(id) || record.revoked || record.blockedReason || record.origin !== 'local') throw new Error('只能提交经过本地验证并确认的本地规则');
      return sync.submit(record.pair);
    });
  }
}
module.exports = AnswerLearning;
