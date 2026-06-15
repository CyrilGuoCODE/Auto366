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
    
    // 预处理：标准化换行符
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    let html = '';
    const lines = text.split('\n');
    let i = 0;
    let inList = false;
    let listType = '';
    let inParagraph = false;
    
    while (i < lines.length) {
      const line = lines[i];
      
      // 代码块
      if (line.startsWith('```')) {
        if (inParagraph) {
          html += '</p>';
          inParagraph = false;
        }
        if (inList) {
          html += listType === 'ul' ? '</ul>' : '</ol>';
          inList = false;
        }
        const lang = line.slice(3).trim();
        let code = '';
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          code += this.escapeHtml(lines[i]) + '\n';
          i++;
        }
        html += `<pre><code class="language-${lang}">${code}</code></pre>`;
        i++;
        continue;
      }
      
      // 表格
      if (line.includes('|') && line.trim().startsWith('|')) {
        if (inParagraph) {
          html += '</p>';
          inParagraph = false;
        }
        if (inList) {
          html += listType === 'ul' ? '</ul>' : '</ol>';
          inList = false;
        }
        
        let tableHtml = '<table>';
        let isHeader = true;
        
        while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
          const tableLine = lines[i].trim();
          
          // 跳过分隔行（如 |------|------| 或 |:---|---:|）
          const splitCells = tableLine.split('|').filter(cell => cell.trim() !== '');
          const isSeparator = splitCells.length > 0 && splitCells.every(cell => /^[\s\-:]+$/.test(cell) && cell.includes('-'));
          if (isSeparator) {
            i++;
            continue;
          }
          
          const cells = tableLine.split('|').slice(1, -1).map(cell => cell.trim());
          
          if (isHeader) {
            tableHtml += '<thead><tr>';
            cells.forEach(cell => {
              tableHtml += `<th>${this.renderInline(cell)}</th>`;
            });
            tableHtml += '</tr></thead><tbody>';
            isHeader = false;
          } else {
            tableHtml += '<tr>';
            cells.forEach(cell => {
              tableHtml += `<td>${this.renderInline(cell)}</td>`;
            });
            tableHtml += '</tr>';
          }
          i++;
        }
        
        tableHtml += '</tbody></table>';
        html += tableHtml;
        continue;
      }
      
      // 水平线
      if (line.match(/^---+$/) || line.match(/^\*\*\*+$/) || line.match(/^___+$/)) {
        if (inParagraph) {
          html += '</p>';
          inParagraph = false;
        }
        if (inList) {
          html += listType === 'ul' ? '</ul>' : '</ol>';
          inList = false;
        }
        html += '<hr>';
        i++;
        continue;
      }
      
      // 标题
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (inParagraph) {
          html += '</p>';
          inParagraph = false;
        }
        if (inList) {
          html += listType === 'ul' ? '</ul>' : '</ol>';
          inList = false;
        }
        const level = headingMatch[1].length;
        const content = this.renderInline(headingMatch[2]);
        html += `<h${level}>${content}</h${level}>`;
        i++;
        continue;
      }
      
      // 无序列表
      const ulMatch = line.match(/^[\*\-\+]\s+(.+)$/);
      if (ulMatch) {
        if (inParagraph) {
          html += '</p>';
          inParagraph = false;
        }
        if (!inList || listType !== 'ul') {
          if (inList) {
            html += listType === 'ul' ? '</ul>' : '</ol>';
          }
          html += '<ul>';
          inList = true;
          listType = 'ul';
        }
        html += `<li>${this.renderInline(ulMatch[1])}</li>`;
        i++;
        continue;
      }
      
      // 有序列表
      const olMatch = line.match(/^\d+\.\s+(.+)$/);
      if (olMatch) {
        if (inParagraph) {
          html += '</p>';
          inParagraph = false;
        }
        if (!inList || listType !== 'ol') {
          if (inList) {
            html += listType === 'ul' ? '</ul>' : '</ol>';
          }
          html += '<ol>';
          inList = true;
          listType = 'ol';
        }
        html += `<li>${this.renderInline(olMatch[1])}</li>`;
        i++;
        continue;
      }
      
      // 空行
      if (line.trim() === '') {
        if (inParagraph) {
          html += '</p>';
          inParagraph = false;
        }
        if (inList) {
          html += listType === 'ul' ? '</ul>' : '</ol>';
          inList = false;
        }
        i++;
        continue;
      }
      
      // 普通段落
      if (!inParagraph) {
        html += '<p>';
        inParagraph = true;
      } else {
        html += '<br>';
      }
      html += this.renderInline(line);
      i++;
    }
    
    // 关闭未关闭的标签
    if (inParagraph) {
      html += '</p>';
    }
    if (inList) {
      html += listType === 'ul' ? '</ul>' : '</ol>';
    }
    
    return html;
  }
  
  renderInline(text) {
    // 行内代码
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 粗体
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // 斜体
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');
    // 链接
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    return text;
  }
  
  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
