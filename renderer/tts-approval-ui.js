// TTS 预清洗审批弹窗
// 监听主进程 'tts-approval-pending' 事件，弹出审批 UI
// 用户可修改每条文本后点击「确认生成」或「跳过」

class TtsApprovalUI {
  constructor(logManager) {
    this.logManager = logManager;
    this.modal = null;
    this.currentItems = []; // 当前展示的队列项 [{index, original, edited, source}]
    this.currentBasePath = null;
    this.currentSource = null;
  }

  // 初始化：监听主进程推送
  init() {
    if (!window.electronAPI || !window.electronAPI.onTtsApprovalPending) {
      console.warn('[TtsApprovalUI] electronAPI.onTtsApprovalPending 不可用');
      return;
    }
    window.electronAPI.onTtsApprovalPending((data) => {
      if (this.logManager && this.logManager.addInfoLog) {
        this.logManager.addInfoLog(`[TTS预清洗] 收到 ${data.count} 条待审批文本（来源: ${data.source || '-'}）`);
      }
      this.open();
    });
  }

  // 打开弹窗：从主进程拉取最新队列
  async open() {
    try {
      const result = await window.electronAPI.getPendingTtsApproval();
      if (!result || !result.items || result.items.length === 0) {
        if (this.logManager && this.logManager.addInfoLog) {
          this.logManager.addInfoLog('[TTS预清洗] 当前队列为空');
        }
        return;
      }
      this.currentItems = result.items.map(it => ({ ...it }));
      this.currentBasePath = result.basePath;
      this.currentSource = result.source;
      this._render();
    } catch (e) {
      console.error('[TtsApprovalUI] 打开失败:', e);
      if (this.logManager && this.logManager.addErrorLog) {
        this.logManager.addErrorLog('[TTS预清洗] 打开失败: ' + e.message);
      }
    }
  }

  close() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }

  _render() {
    this.close();

    // 把所有项的 edited 文本拼接成一整段，用「单独一行的 ---」作为分隔符
    // 选择该分隔符：与正常答案文本冲突概率极低；用户在编辑器里也容易识别
    const bulkText = this.currentItems.map(it => it.edited).join('\n---\n');

    const modal = document.createElement('div');
    modal.className = 'modal tts-approval-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal__content tts-approval__content">
        <div class="modal__header">
          <h4>TTS 预清洗审批</h4>
          <button class="btn--close" data-action="close">×</button>
        </div>
        <div class="modal__body tts-approval__body">
          <div class="tts-approval__meta">
            <span class="tts-approval__meta-item">来源: <strong>${this._escape(this.currentSource || '-')}</strong></span>
            <span class="tts-approval__meta-item">原始 <strong>${this.currentItems.length}</strong> 条</span>
            <span class="tts-approval__meta-item">基础路径: <code>${this._escape(this.currentBasePath || '-')}</code></span>
          </div>
          <div class="tts-approval__hint">
            下方文本框包含所有待生成内容，每条之间用 <code>---</code>（单独一行）分隔。
            可直接编辑：增删字符、合并/拆分条目、新增或删除 <code>---</code> 分隔行。
            确认生成时按分隔行拆分后逐条合成 wav，空段会被自动跳过，最终序号按非空段顺序分配。
          </div>
          <textarea class="form-input tts-approval__bulk-textarea" data-action="bulk-edit" spellcheck="false" wrap="off">${this._escape(bulkText)}</textarea>
        </div>
        <div class="modal__footer tts-approval__footer">
          <span class="tts-approval__footer-hint">未审批前不会生成任何 wav 文件</span>
          <div class="tts-approval__footer-actions">
            <button type="button" class="btn--ghost" data-action="skip">跳过</button>
            <button type="button" class="btn--primary" data-action="approve">确认生成</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    this.modal = modal;

    modal.querySelector('[data-action="close"]').addEventListener('click', () => this.close());
    modal.querySelector('[data-action="skip"]').addEventListener('click', () => this._onSkip());
    modal.querySelector('[data-action="approve"]').addEventListener('click', () => this._onApprove());
  }

  // 把整段文本按分隔行拆回数组
  // 分隔行定义：单独一行只含 ---（前后可含空白字符）
  _parseBulkText(raw) {
    const normalized = raw.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const segments = [];
    let current = [];
    for (const line of lines) {
      if (/^---\s*$/.test(line)) {
        segments.push(current.join('\n'));
        current = [];
      } else {
        current.push(line);
      }
    }
    segments.push(current.join('\n'));
    return segments;
  }

  async _onApprove() {
    const ta = this.modal.querySelector('textarea[data-action="bulk-edit"]');
    if (!ta) return;

    const texts = this._parseBulkText(ta.value);
    // 构造 items：按顺序分配 1-based 序号
    // 空段不在此过滤：tts.js generateForAnswers 内部对空文本会自动 skip
    // 这样保留用户编辑的结构语义（即使中间留了空段也不会错位后续段）
    const items = texts.map((t, i) => ({ index: i + 1, edited: t }));

    // 全空校验
    const allEmpty = items.every(it => !it.edited || !it.edited.trim());
    if (allEmpty) {
      if (this.logManager && this.logManager.addWarningLog) {
        this.logManager.addWarningLog('[TTS预清洗] 所有文本都为空，无法生成');
      }
      return;
    }

    const nonEmptyCount = items.filter(it => it.edited && it.edited.trim()).length;
    if (this.logManager && this.logManager.addInfoLog) {
      this.logManager.addInfoLog(`[TTS预清洗] 已确认 ${nonEmptyCount} 条（共 ${items.length} 段），开始生成 wav...`);
    }

    try {
      const result = await window.electronAPI.approveTtsQueue(items, this.currentBasePath);
      if (result && result.success) {
        if (this.logManager && this.logManager.addSuccessLog) {
          this.logManager.addSuccessLog(`[TTS预清洗] 审批通过，已开始生成 ${result.count} 条 wav`);
        }
        this.close();
      } else {
        if (this.logManager && this.logManager.addErrorLog) {
          this.logManager.addErrorLog('[TTS预清洗] 生成失败: ' + (result && result.error ? result.error : '未知错误'));
        }
      }
    } catch (e) {
      if (this.logManager && this.logManager.addErrorLog) {
        this.logManager.addErrorLog('[TTS预清洗] 审批调用异常: ' + e.message);
      }
    }
  }

  async _onSkip() {
    try {
      await window.electronAPI.skipTtsQueue();
      if (this.logManager && this.logManager.addInfoLog) {
        this.logManager.addInfoLog('[TTS预清洗] 已跳过本次审批，队列已清空');
      }
      this.close();
    } catch (e) {
      if (this.logManager && this.logManager.addErrorLog) {
        this.logManager.addErrorLog('[TTS预清洗] 跳过失败: ' + e.message);
      }
    }
  }

  _escape(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export default TtsApprovalUI;
