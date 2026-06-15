export default class AgreementUI {
  constructor() {
    this.STORAGE_KEY = 'agreement-accepted';
    this.currentTab = 'privacy';
    this.agreementData = null;
  }

  async checkAndShow() {
    try {
      this.agreementData = await window.electronAPI.getAgreementContent();
      const acceptedVersion = this.getAcceptedVersion();

      if (this.agreementData.version > acceptedVersion) {
        this.showOverlay();
      }
    } catch (error) {
      console.error('检查协议失败:', error);
    }
  }

  getAcceptedVersion() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        return data.acceptedVersion || 0;
      }
    } catch {}
    return 0;
  }

  showOverlay() {
    const overlay = document.getElementById('agreement-overlay');
    if (!overlay) return;

    this.renderContent();
    overlay.classList.add('is-visible');
  }

  hideOverlay() {
    const overlay = document.getElementById('agreement-overlay');
    if (!overlay) return;

    overlay.classList.remove('is-visible');
  }

  renderContent() {
    if (!this.agreementData) return;

    const privacyContent = document.getElementById('agreement-privacy-content');
    const termsContent = document.getElementById('agreement-terms-content');
    const updatedAtEl = document.getElementById('agreement-updated-at');

    if (privacyContent) {
      privacyContent.innerHTML = this.renderMarkdown(this.agreementData.privacyPolicy);
    }
    if (termsContent) {
      termsContent.innerHTML = this.renderMarkdown(this.agreementData.termsOfService);
    }
    if (updatedAtEl && this.agreementData.updatedAt) {
      const date = new Date(this.agreementData.updatedAt);
      const formatted = date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      updatedAtEl.textContent = `最后更新：${formatted}`;
      updatedAtEl.style.display = 'block';
    }

    // 缓存模式提示
    if (this.agreementData.isCacheMode) {
      const cacheNotice = document.getElementById('agreement-cache-notice');
      if (cacheNotice) {
        cacheNotice.style.display = 'flex';
      }
    }

    this.switchTab('privacy');
  }

  switchTab(tab) {
    this.currentTab = tab;

    const privacyTab = document.getElementById('agreement-tab-privacy');
    const termsTab = document.getElementById('agreement-tab-terms');
    const privacyPanel = document.getElementById('agreement-panel-privacy');
    const termsPanel = document.getElementById('agreement-panel-terms');

    if (privacyTab && termsTab) {
      privacyTab.classList.toggle('is-active', tab === 'privacy');
      termsTab.classList.toggle('is-active', tab === 'terms');
    }
    if (privacyPanel && termsPanel) {
      privacyPanel.classList.toggle('is-active', tab === 'privacy');
      termsPanel.classList.toggle('is-active', tab === 'terms');
    }
  }

  renderMarkdown(text) {
    if (!text) return '';
    let html = text
      // 标题
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // 粗体
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // 斜体
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // 链接
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      // 水平线
      .replace(/^---$/gm, '<hr>')
      // 无序列表
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // 有序列表
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // 段落（连续非空行）
      .replace(/\n\n/g, '</p><p>')
      // 换行
      .replace(/\n/g, '<br>');

    // 包裹列表项
    html = html.replace(/(<li>.*?<\/li>(<br>)?)+/g, (match) => {
      return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
    });

    return html;
  }

  async handleAccept() {
    const checkbox = document.getElementById('agreement-checkbox');
    if (!checkbox || !checkbox.checked) return;

    const version = this.agreementData ? this.agreementData.version : 0;
    const result = await window.electronAPI.acceptAgreement(version);

    if (result.success) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
        acceptedVersion: result.acceptedVersion,
        acceptedAt: new Date().toISOString()
      }));
      this.hideOverlay();
    }
  }

  async handleReject() {
    await window.electronAPI.rejectAgreement();
  }

  initEventListeners() {
    // Tab 切换
    const privacyTab = document.getElementById('agreement-tab-privacy');
    const termsTab = document.getElementById('agreement-tab-terms');

    if (privacyTab) {
      privacyTab.addEventListener('click', () => this.switchTab('privacy'));
    }
    if (termsTab) {
      termsTab.addEventListener('click', () => this.switchTab('terms'));
    }

    // 同意按钮
    const acceptBtn = document.getElementById('agreement-accept-btn');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => this.handleAccept());
    }

    // 拒绝按钮
    const rejectBtn = document.getElementById('agreement-reject-btn');
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => this.handleReject());
    }

    // 勾选框控制同意按钮
    const checkbox = document.getElementById('agreement-checkbox');
    if (checkbox && acceptBtn) {
      acceptBtn.disabled = true;
      checkbox.addEventListener('change', () => {
        acceptBtn.disabled = !checkbox.checked;
      });
    }
  }
}
