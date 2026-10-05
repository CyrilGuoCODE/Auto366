const ttsClean = require('./clean');

module.exports = {
generateFromRule(rule, url, extracted) {
  const answers = extracted.answers || [];
  if (!Array.isArray(answers) || !answers.length) return;
  const options = { compact: rule.ttsCompact === true, autoApprove: rule.ttsAutoApprove === true };
  this._log(options.autoApprove
    ? '检测到 ' + answers.length + ' 个答案，预清洗后将自动开始生成...'
    : '检测到 ' + answers.length + ' 个答案，已加入预清洗审批队列...');
  setImmediate(() => {
    try { this.queueForApproval(answers, rule.ttsBasePath || '/tts', rule.name || url, options); }
    catch (error) { this._log('TTS 预清洗入队失败: ' + error.message, 'error'); }
  });
},
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
    // 见 ./clean.js：去断句标记、听后回答从 children 取答案、转述取范例段。
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
  },

_notifyApprovalPending() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    try {
      this.mainWindow.webContents.send('tts-approval-pending', {
        count: this.pendingApprovalQueue.length,
        basePath: this.pendingBasePath,
        source: this.pendingApprovalSource,
      });
    } catch (e) { /* 忽略 */ }
  },

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
  },

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
  },

clearApprovalQueue() {
    const n = this.pendingApprovalQueue.length;
    this.pendingApprovalQueue = [];
    this.pendingBasePath = null;
    this.pendingApprovalSource = null;
    this._log(`审批队列已清空 (${n} 条丢弃)`, 'info');
  },

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
};
