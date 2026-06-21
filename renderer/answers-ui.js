class AnswersUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
  }

  // 初始化答案UI
  initAnswersUI() {

    // 清空答案按钮
    const clearAnswersBtn = document.getElementById('clearAnswersBtn');
    if (clearAnswersBtn) {
      clearAnswersBtn.addEventListener('click', () => {
        this.clearAnswers();
      });
    }

    // 分享答案按钮
    const shareAnswersBtn = document.getElementById('shareAnswerBtn');
    if (shareAnswersBtn) {
      shareAnswersBtn.addEventListener('click', () => {
        this.shareAnswers();
      });
    }

    // 导出菜单
    const exportAnswersBtn = document.getElementById('exportAnswerBtn');
    const exportAnswerDropdown = document.getElementById('exportAnswerDropdown');
    const exportAnswerMenu = document.getElementById('exportAnswerMenu');

    if (exportAnswersBtn) {
      exportAnswersBtn.addEventListener('click', () => {
        this.exportAnswersPdf();
      });
    }

    if (exportAnswerDropdown) {
      exportAnswerDropdown.querySelectorAll('.export-menu__item').forEach(item => {
        item.addEventListener('click', () => {
          const action = item.dataset.action;
          if (action === 'json') {
            this.exportAnswersJson();
          }
        });
      });
    }

    // 悬停显示/隐藏导出 JSON 菜单
    let hideDropdownTimeout = null;
    const showDropdown = () => {
      if (hideDropdownTimeout) {
        clearTimeout(hideDropdownTimeout);
        hideDropdownTimeout = null;
      }
      if (exportAnswerDropdown) {
        exportAnswerDropdown.classList.add('is-visible');
      }
    };
    const hideDropdown = () => {
      hideDropdownTimeout = setTimeout(() => {
        if (exportAnswerDropdown) {
          exportAnswerDropdown.classList.remove('is-visible');
        }
      }, 150);
    };

    if (exportAnswerMenu) {
      exportAnswerMenu.addEventListener('mouseenter', showDropdown);
      exportAnswerMenu.addEventListener('mouseleave', hideDropdown);
    }
  }

  // 显示答案
  displayAnswers(data) {
    const container = document.getElementById('answersContainer');
    if (!container) return;

    this.state.setLastAnswersData(data);

    if (!data || !data.answers || data.answers.length === 0) {
      container.innerHTML = `
        <div class="answers-view__empty">
          <i class="bi bi-inbox"></i>
          <p>暂无答案数据</p>
        </div>
      `;
      return;
    }

    // 按文件组织数据
    let organizedData = {};

    data.answers.forEach(answer => {
      const fileName = answer.file || '未知文件';
      if (!organizedData[fileName]) {
        organizedData[fileName] = [];
      }
      organizedData[fileName].push(answer);
    });

    // 生成HTML
    let html = '';
    Object.keys(organizedData).forEach(groupName => {
      const answers = organizedData[groupName];
      html += `
        <div class="answer-group">
          <div class="answer-group__header">
            <h4>${groupName}</h4>
            <span class="badge--count">${answers.length} 个答案</span>
          </div>
          <div class="answer-group__list">
      `;

      answers.forEach((answer, index) => {
        const answerId = `answer_${Date.now()}_${index}`;
        const answerText = answer.answer || '无答案';

        // 优先使用questionText字段，如果没有则使用question字段
        let questionText = answer.questionText || answer.question || '无题目';

        // 如果question字段包含"第X题"格式，尝试从content字段提取真正的题目
        if (questionText.match(/^第\d+题/) && answer.content) {
          const contentMatch = answer.content.match(/题目:\s*(.+?)(?:\n|$)/);
          if (contentMatch) {
            questionText = contentMatch[1].trim();
          }
        }

        // 安全地转义HTML和JavaScript字符
        const safeAnswerText = answerText.replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeQuestionText = questionText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const hasChildren = answer.children && Array.isArray(answer.children) && answer.children.length > 0;

        html += `
          <div class="answer-item ${hasChildren ? 'answer-item--has-children' : ''}">
            <div class="answer-item__header">
              <span class="answer-item__index">#${index + 1}</span>
              <span class="answer-item__type">${answer.pattern || '未知题型'}</span>
              <button class="btn--copy" onclick="universalAnswerFeature.copyAnswerByIndex(${index}, '${groupName}', this)" title="复制答案">
                <i class="bi bi-copy"></i>
              </button>
            </div>
            <div class="answer-item__content">
              <div class="answer-item__question">${safeQuestionText}</div>
              ${hasChildren ? `
                <div class="answer-item__text answer-item__main">${safeAnswerText}</div>
                <button class="btn--expand" onclick="universalAnswerFeature.toggleAnswerExpansion(this)" title="展开/收起答案">
                  <i class="bi bi-chevron-down"></i>
                  <span>展开全部答案</span>
                </button>
                <div class="answer-item__children" style="display: none;">
                  ${answer.children.map((child, childIndex) => {
          const safeChildAnswer = (child.answer || '无答案').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const childAnswerForJs = (child.answer || '').replace(/'/g, "\\'").replace(/"/g, '\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
          return `
                      <div class="child-answer">
                        <div class="child-answer__header">
                          <span class="child-answer__index">${child.question || `答案${childIndex + 1}`}</span>
                          <button class="btn--copy" onclick="universalAnswerFeature.copyAnswer('${childAnswerForJs}', this)" title="复制此答案">
                            <i class="bi bi-copy"></i>
                          </button>
                        </div>
                        <div class="child-answer__content answer-item__content--clickable" onclick="universalAnswerFeature.copyAnswer('${childAnswerForJs}', this)" title="点击复制答案">${safeChildAnswer}</div>
                      </div>
                    `;
        }).join('')}
                </div>
              ` : `
                <div class="answer-item__text answer-item__content--clickable" onclick="universalAnswerFeature.copyAnswerByIndex(${index}, '${groupName}', this)" title="点击复制答案">${safeAnswerText}</div>
              `}
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    this.logManager.addSuccessLog(`显示答案完成，共 ${data.answers.length} 个答案`);
  }

  // 通过索引复制答案功能
  copyAnswerByIndex(answerIndex, groupName, element) {
    try {
      if (!this.state.lastAnswersData || !this.state.lastAnswersData.answers) {
        this.showCopyToast('没有可复制的答案数据', 'error');
        return;
      }

      // 按文件分组找到对应的答案
      const groupAnswers = this.state.lastAnswersData.answers.filter(answer =>
        (answer.file || '未知文件') === groupName
      );
      const targetAnswer = groupAnswers[answerIndex];

      if (!targetAnswer) {
        this.showCopyToast('找不到对应的答案', 'error');
        return;
      }

      let answerText = '';
      if (targetAnswer.children && Array.isArray(targetAnswer.children) && targetAnswer.children.length > 0) {
        answerText = targetAnswer.children.map((child, index) =>
          `${child.question || `答案${index + 1}`}: ${child.answer || '无答案'}`
        ).join('\n');
      } else {
        answerText = targetAnswer.answer || '无答案';
      }

      this.copyAnswer(answerText, element);

    } catch (error) {
      console.error('复制答案失败:', error);
      this.showCopyToast('复制失败', 'error');
    }
  }

  // 切换答案展开状态
  toggleAnswerExpansion(button) {
    try {
      const answerItem = button.closest('.answer-item');
      const childrenAnswers = answerItem.querySelector('.answer-item__children');
      const icon = button.querySelector('i');
      const buttonText = button.querySelector('span');

      if (!childrenAnswers) return;

      const isExpanded = childrenAnswers.style.display !== 'none';

      if (isExpanded) {
        childrenAnswers.style.display = 'none';
        icon.className = 'bi bi-chevron-down';
        if (buttonText) buttonText.textContent = '展开全部答案';
        button.title = '展开答案';
      } else {
        childrenAnswers.style.display = 'block';
        icon.className = 'bi bi-chevron-up';
        if (buttonText) buttonText.textContent = '收起答案';
        button.title = '收起答案';
      }
    } catch (error) {
      console.error('切换答案展开状态失败:', error);
    }
  }

  // 复制答案功能
  copyAnswer(answerText, element) {
    try {
      // 使用现代的 Clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(answerText).then(() => {
          this.showCopyToast('答案已复制到剪贴板', 'success');
          this.animateCopyButton(element);
        }).catch(err => {
          console.error('复制失败:', err);
          this.fallbackCopyText(answerText, element);
        });
      } else {
        // 降级方案
        this.fallbackCopyText(answerText, element);
      }
    } catch (error) {
      console.error('复制答案失败:', error);
      this.showCopyToast('复制失败', 'error');
    }
  }

  // 降级复制方案
  fallbackCopyText(text, element) {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        this.showCopyToast('答案已复制到剪贴板', 'success');
        this.animateCopyButton(element);
      } else {
        this.showCopyToast('复制失败', 'error');
      }
    } catch (err) {
      console.error('降级复制失败:', err);
      this.showCopyToast('复制失败', 'error');
    }
  }

  // 显示复制提示
  showCopyToast(message, type = 'success') {
    // 移除现有的提示
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }

    // 创建新的提示
    const toast = document.createElement('div');
    toast.className = type === 'error' ? 'toast toast--error' : 'toast';
    toast.innerHTML = `
      <i class="bi bi-${type === 'success' ? 'check-circle' : 'x-circle'}"></i>
      <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // 显示动画
    setTimeout(() => {
      toast.classList.add('is-visible');
    }, 10);

    // 自动隐藏
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 2000);
  }

  // 复制按钮动画
  animateCopyButton(element) {
    if (element && element.classList) {
      element.classList.add('is-copied');
      setTimeout(() => {
        element.classList.remove('is-copied');
      }, 1000);
    }
  }

  // 清空答案
  clearAnswers() {
    if (!confirm('确定要清空所有答案数据吗？此操作不可撤销。')) {
      return;
    }

    const container = document.getElementById('answersContainer');
    if (container) {
      container.innerHTML = `
        <div class="answers-view__empty">
          <i class="bi bi-inbox"></i>
          <p>暂无答案数据</p>
        </div>
      `;
    }

    this.state.lastAnswersData = null;
    this.logManager.addSuccessLog('答案数据已清空');
  }

  // 分享答案到服务器
  async shareAnswers() {
    if (!this.state.lastAnswersData || !this.state.lastAnswersData.answers || this.state.lastAnswersData.answers.length === 0) {
      this.logManager.addErrorLog('没有可分享的答案数据');
      return;
    }

    try {
      this.logManager.addInfoLog('正在上传答案到服务器...');

      // 使用现有的答案文件路径
      let filePath = this.state.lastAnswersData.file;

      if (!filePath) {
        this.logManager.addErrorLog('没有找到答案文件，请先提取答案');
        return;
      }

      // 上传到服务器
      const result = await window.electronAPI.shareAnswerFile(filePath);

      if (result && result.success) {
        const downloadUrl = result.downloadUrl;
        const viewerUrl = `https://366.cyril.qzz.io/answer-viewer?url=${encodeURIComponent(downloadUrl)}`;

        this.logManager.addSuccessLog(`答案已分享成功！查看地址: ${viewerUrl}`);

        // 显示分享结果小窗口
        this.showShareResultModal(downloadUrl);

        // 复制查看地址到剪贴板
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(viewerUrl);
          this.logManager.addInfoLog('查看地址已复制到剪贴板');
        }
      } else {
        this.logManager.addErrorLog(`分享失败: ${result?.error || '未知错误'}`);
      }

    } catch (error) {
      this.logManager.addErrorLog(`分享失败: ${error.message}`);
    }
  }

  // 导出 JSON 答案文件
  async exportAnswersJson() {
    if (!this.state.lastAnswersData || !this.state.lastAnswersData.answers || this.state.lastAnswersData.answers.length === 0) {
      this.logManager.addErrorLog('没有可导出的答案数据');
      return;
    }

    try {
      let appVersion = '1.0';
      if (window.electronAPI && window.electronAPI.getAppVersion) {
        appVersion = await window.electronAPI.getAppVersion();
      }

      const exportData = {
        timestamp: new Date().toISOString(),
        totalAnswers: this.state.lastAnswersData.answers.length,
        answers: this.state.lastAnswersData.answers,
        version: appVersion,
        exportedBy: 'Auto366'
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `answers_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);

      this.logManager.addSuccessLog(`JSON 答案文件已导出: ${link.download}`);

    } catch (error) {
      this.logManager.addErrorLog(`导出失败: ${error.message}`);
    }
  }

  // 导出 PDF 答案文件
  async exportAnswersPdf() {
    if (!this.state.lastAnswersData || !this.state.lastAnswersData.answers || this.state.lastAnswersData.answers.length === 0) {
      this.logManager.addErrorLog('没有可导出的答案数据');
      return;
    }

    try {
      this.logManager.addInfoLog('正在生成 PDF 答案文件...');

      let appVersion = '1.0';
      if (window.electronAPI && window.electronAPI.getAppVersion) {
        appVersion = await window.electronAPI.getAppVersion();
      }

      const exportData = {
        timestamp: new Date().toISOString(),
        totalAnswers: this.state.lastAnswersData.answers.length,
        answers: this.state.lastAnswersData.answers,
        version: appVersion,
        exportedBy: 'Auto366'
      };

      const htmlContent = this.buildPdfHtml(exportData, appVersion);

      if (window.electronAPI && window.electronAPI.exportAnswersPdf) {
        const result = await window.electronAPI.exportAnswersPdf(htmlContent);
        if (result && result.success) {
          this.logManager.addSuccessLog(`PDF 答案文件已导出: ${result.filePath}`);
        } else {
          this.logManager.addErrorLog(`导出 PDF 失败: ${result?.error || '未知错误'}`);
        }
      } else {
        this.logManager.addErrorLog('当前环境不支持 PDF 导出');
      }

    } catch (error) {
      this.logManager.addErrorLog(`导出 PDF 失败: ${error.message}`);
    }
  }

  // 构建 PDF 水印网格 HTML
  buildWatermarkGridHtml(cols = 2, rows = 3) {
    const text = '文档与答案由Auto366提取并生成';
    let html = '';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const top = ((row + 0.5) / rows) * 100;
        const left = ((col + 0.5) / cols) * 100;
        html += `<div class="watermark" style="top: ${top}%; left: ${left}%;">${text}</div>`;
      }
    }
    return html;
  }

  // 构建 PDF 用 HTML
  buildPdfHtml(exportData, appVersion) {
    const escapeHtml = (text) => {
      if (text == null) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const formatTime = (iso) => {
      try {
        const date = new Date(iso);
        return date.toLocaleString('zh-CN');
      } catch (e) {
        return iso;
      }
    };

    // 按文件分组
    const organizedData = {};
    exportData.answers.forEach(answer => {
      const fileName = answer.file || '未知文件';
      if (!organizedData[fileName]) {
        organizedData[fileName] = [];
      }
      organizedData[fileName].push(answer);
    });

    let contentHtml = '';
    Object.keys(organizedData).forEach(groupName => {
      const answers = organizedData[groupName];
      const answersHtml = answers.map((answer, index) => {
        const questionText = answer.questionText || answer.question || '无题目';
        const hasChildren = answer.children && Array.isArray(answer.children) && answer.children.length > 0;

        let answerHtml = '';
        if (hasChildren) {
          const childrenHtml = answer.children.map((child, childIndex) => `
            <div class="child-answer">
              <div class="child-answer__header">${escapeHtml(child.question || `答案${childIndex + 1}`)}</div>
              <div class="child-answer__content">${escapeHtml(child.answer || '无答案')}</div>
            </div>
          `).join('');
          answerHtml = `
            <div class="answer-item__main">${escapeHtml(answer.answer || '无答案')}</div>
            <div class="answer-item__children">${childrenHtml}</div>
          `;
        } else {
          answerHtml = `<div class="answer-item__answer">${escapeHtml(answer.answer || '无答案')}</div>`;
        }

        return `
          <div class="answer-item">
            <div class="answer-item__header">
              <span class="answer-item__index">#${index + 1}</span>
              <span class="answer-item__type">${escapeHtml(answer.pattern || '未知题型')}</span>
            </div>
            <div class="answer-item__question">${escapeHtml(questionText)}</div>
            ${answerHtml}
          </div>
        `;
      }).join('');

      contentHtml += `
        <div class="answer-group">
          <div class="answer-group__header">
            <span class="answer-group__title">${escapeHtml(groupName)}</span>
            <span class="badge--count">${answers.length} 个答案</span>
          </div>
          <div class="answer-group__list">${answersHtml}</div>
        </div>
      `;
    });

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Auto366 答案报告</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 40px;
      font-family: "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      background: #fff;
    }
    .pdf-header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #2196f3;
    }
    .pdf-title {
      font-size: 26px;
      font-weight: bold;
      color: #1976d2;
      margin: 0 0 10px 0;
    }
    .pdf-meta {
      font-size: 12px;
      color: #666;
    }
    .pdf-meta span {
      margin: 0 10px;
    }
    .answer-group {
      margin-bottom: 25px;
    }
    .answer-group__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f5f5f5;
      padding: 10px 14px;
      border-left: 4px solid #2196f3;
      margin-bottom: 12px;
    }
    .answer-group__title {
      font-size: 15px;
      font-weight: bold;
      color: #333;
    }
    .badge--count {
      font-size: 11px;
      color: #fff;
      background: #2196f3;
      padding: 2px 10px;
      border-radius: 9999px;
    }
    .answer-item {
      padding: 12px 0;
      border-bottom: 1px dashed #ddd;
    }
    .answer-item:last-child {
      border-bottom: none;
    }
    .answer-item__header {
      display: flex;
      gap: 12px;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .answer-item__index {
      font-weight: bold;
      color: #2196f3;
    }
    .answer-item__type {
      color: #666;
    }
    .answer-item__question {
      font-weight: bold;
      margin-bottom: 8px;
      color: #222;
    }
    .answer-item__answer {
      color: #1565c0;
      font-weight: 500;
      white-space: pre-wrap;
    }
    .answer-item__main {
      color: #333;
      font-weight: 500;
      margin-bottom: 8px;
      white-space: pre-wrap;
    }
    .answer-item__children {
      margin-left: 16px;
      padding-left: 12px;
      border-left: 2px solid #e0e0e0;
    }
    .child-answer {
      margin-bottom: 8px;
    }
    .child-answer__header {
      font-size: 12px;
      font-weight: bold;
      color: #666;
      margin-bottom: 4px;
    }
    .child-answer__content {
      color: #1565c0;
      white-space: pre-wrap;
    }
    .watermark {
      position: fixed;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 20px;
      color: rgba(0, 0, 0, 0.08);
      pointer-events: none;
      z-index: 9999;
      white-space: nowrap;
      font-weight: bold;
      letter-spacing: 2px;
    }
  </style>
</head>
<body>
  ${this.buildWatermarkGridHtml()}
  <div class="pdf-header">
    <h1 class="pdf-title">Auto366 答案报告</h1>
    <div class="pdf-meta">
      <span>生成时间：${formatTime(exportData.timestamp)}</span>
      <span>Auto366版本：${escapeHtml(appVersion)}</span>
      <span>答案总数：${exportData.totalAnswers}</span>
    </div>
  </div>
  ${contentHtml}
</body>
</html>`;
  }

  // 显示分享结果模态框
  showShareResultModal(downloadUrl) {
    const mainUrl = `https://366.cyril.qzz.io/answer-viewer?url=${encodeURIComponent(downloadUrl)}`;
    const backupUrl = `https://a366.netlify.app/answer-viewer?url=${encodeURIComponent(downloadUrl)}`;

    const modalHtml = `
      <div class="modal modal--share" id="shareResultModal">
        <div class="modal__content">
          <div class="modal__header">
            <h4><i class="bi bi-check-circle text--success"></i> 分享成功</h4>
            <button class="btn--close" onclick="universalAnswerFeature.hideShareResultModal()">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="modal__body">
            <p class="modal__info">答案已成功上传到服务器，您可以通过以下地址在线查看：</p>
            <div class="modal__url-section">
              <label><i class="bi bi-link-45deg"></i> 主地址：</label>
              <div class="modal__url-input-group">
                <input type="text" value="${mainUrl}" readonly class="modal__url-input" id="mainUrl">
                <button class="btn--copy-url" onclick="universalAnswerFeature.copyUrl('mainUrl')" title="复制主地址">
                  <i class="bi bi-copy"></i>
                </button>
                <button class="btn--open-url" onclick="electronAPI.openUrl('${mainUrl}')" title="打开主地址">
                  <i class="bi bi-box-arrow-up-right"></i>
                </button>
              </div>
            </div>
            <div class="modal__url-section">
              <label><i class="bi bi-link-45deg"></i> 备用地址：</label>
              <div class="modal__url-input-group">
                <input type="text" value="${backupUrl}" readonly class="modal__url-input" id="backupUrl">
                <button class="btn--copy-url" onclick="universalAnswerFeature.copyUrl('backupUrl')" title="复制备用地址">
                  <i class="bi bi-copy"></i>
                </button>
                <button class="btn--open-url" onclick="electronAPI.openUrl('${backupUrl}')" title="打开备用地址">
                  <i class="bi bi-box-arrow-up-right"></i>
                </button>
              </div>
            </div>
            <div class="modal__tips">
              <p><i class="bi bi-info-circle"></i> 提示：如果主地址无法访问，请尝试使用备用地址。点击 <i class="bi bi-box-arrow-up-right"></i> 按钮可直接在浏览器中打开</p>
            </div>
            <div class="modal__footer">
              <button class="btn--primary" onclick="universalAnswerFeature.copyUrl('mainUrl')">
                <i class="bi bi-copy"></i>
                复制主地址
              </button>
              <button class="btn--open" onclick="electronAPI.openUrl('${mainUrl}')">
                <i class="bi bi-box-arrow-up-right"></i>
                打开查看
              </button>
              <button class="btn--ghost" onclick="universalAnswerFeature.hideShareResultModal()">
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 显示模态框
    const modal = document.getElementById('shareResultModal');
    modal.style.display = 'flex';

    // 添加点击背景关闭功能
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.hideShareResultModal();
      }
    });
  }

  // 隐藏分享结果模态框
  hideShareResultModal() {
    const modal = document.getElementById('shareResultModal');
    if (modal) {
      modal.remove();
    }
  }

  // 复制URL
  async copyUrl(inputId) {
    const input = document.getElementById(inputId);
    if (input) {
      try {
        await navigator.clipboard.writeText(input.value);
        this.showCopyToast('地址已复制到剪贴板', 'success');
      } catch (error) {
        // 降级方案
        input.select();
        document.execCommand('copy');
        this.showCopyToast('地址已复制到剪贴板', 'success');
      }
    }
  }

  // 导入答案文件
  importAnswerFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.answers && Array.isArray(data.answers)) {
          this.displayAnswers(data);
          this.logManager.addSuccessLog(`成功导入 ${data.answers.length} 个答案`);
        } else {
          this.logManager.addErrorLog('导入文件格式不正确');
        }
      } catch (error) {
        this.logManager.addErrorLog('导入文件解析失败: ' + error.message);
      }
    };
    reader.readAsText(file);
  }
}

export default AnswersUI;
