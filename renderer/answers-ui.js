class AnswersUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
  }

  // 初始化答案UI
  initAnswersUI() {
    // 排序模式切换
    const sortByFileBtn = document.getElementById('sortByFile');
    const sortByPatternBtn = document.getElementById('sortByPattern');

    if (sortByFileBtn) {
      sortByFileBtn.addEventListener('click', () => {
        this.state.setSortMode('file');
        this.updateSortButtons('file');
        if (this.state.lastAnswersData) {
          this.displayAnswers(this.state.lastAnswersData);
        }
      });
    }

    if (sortByPatternBtn) {
      sortByPatternBtn.addEventListener('click', () => {
        this.state.setSortMode('pattern');
        this.updateSortButtons('pattern');
        if (this.state.lastAnswersData) {
          this.displayAnswers(this.state.lastAnswersData);
        }
      });
    }

    // 清空答案按钮
    const clearAnswersBtn = document.getElementById('clearAnswersBtn');
    if (clearAnswersBtn) {
      clearAnswersBtn.addEventListener('click', () => {
        this.clearAnswers();
      });
    }

    // 分享答案按钮
    const shareAnswersBtn = document.getElementById('shareAnswersBtn');
    if (shareAnswersBtn) {
      shareAnswersBtn.addEventListener('click', () => {
        this.shareAnswers();
      });
    }

    // 导出答案按钮
    const exportAnswersBtn = document.getElementById('exportAnswersBtn');
    if (exportAnswersBtn) {
      exportAnswersBtn.addEventListener('click', () => {
        this.exportAnswers();
      });
    }
  }

  // 更新排序按钮状态
  updateSortButtons(activeMode) {
    const sortByFileBtn = document.getElementById('sortByFile');
    const sortByPatternBtn = document.getElementById('sortByPattern');

    if (sortByFileBtn) {
      sortByFileBtn.classList.toggle('active', activeMode === 'file');
    }

    if (sortByPatternBtn) {
      sortByPatternBtn.classList.toggle('active', activeMode === 'pattern');
    }
  }

  // 显示答案
  displayAnswers(data) {
    const container = document.getElementById('answersContainer');
    if (!container) return;

    this.state.setLastAnswersData(data);

    if (!data || !data.answers || data.answers.length === 0) {
      container.innerHTML = `
        <div class="no-answers">
          <i class="bi bi-inbox"></i>
          <p>暂无答案数据</p>
        </div>
      `;
      return;
    }

    // 根据排序模式组织数据
    let organizedData = {};

    if (this.state.sortMode === 'file') {
      // 按文件分组
      data.answers.forEach(answer => {
        const fileName = answer.file || '未知文件';
        if (!organizedData[fileName]) {
          organizedData[fileName] = [];
        }
        organizedData[fileName].push(answer);
      });
    } else {
      // 按题型分组
      data.answers.forEach(answer => {
        const pattern = answer.pattern || '未知题型';
        if (!organizedData[pattern]) {
          organizedData[pattern] = [];
        }
        organizedData[pattern].push(answer);
      });
    }

    // 生成HTML
    let html = '';
    Object.keys(organizedData).forEach(groupName => {
      const answers = organizedData[groupName];
      html += `
        <div class="answer-group">
          <div class="group-header">
            <h4>${groupName}</h4>
            <span class="answer-count">${answers.length} 个答案</span>
          </div>
          <div class="answers-list">
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
          <div class="answer-item ${hasChildren ? 'has-children' : ''}">
            <div class="answer-header">
              <span class="answer-index">#${index + 1}</span>
              <span class="answer-type">${answer.pattern || '未知题型'}</span>
              <button class="copy-answer-btn" onclick="universalAnswerFeature.copyAnswerByIndex(${index}, '${groupName}', this)" title="复制答案">
                <i class="bi bi-copy"></i>
              </button>
            </div>
            <div class="answer-content">
              <div class="question">${safeQuestionText}</div>
              ${hasChildren ? `
                <div class="answer main-answer">${safeAnswerText}</div>
                <button class="expand-answer-btn" onclick="universalAnswerFeature.toggleAnswerExpansion(this)" title="展开/收起答案">
                  <i class="bi bi-chevron-down"></i>
                  <span>展开全部答案</span>
                </button>
                <div class="children-answers" style="display: none;">
                  ${answer.children.map((child, childIndex) => {
          const safeChildAnswer = (child.answer || '无答案').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const childAnswerForJs = (child.answer || '').replace(/'/g, "\\'").replace(/"/g, '\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
          return `
                      <div class="child-answer-item">
                        <div class="child-answer-header">
                          <span class="child-answer-index">${child.question || `答案${childIndex + 1}`}</span>
                          <button class="copy-child-answer-btn" onclick="universalAnswerFeature.copyAnswer('${childAnswerForJs}', this)" title="复制此答案">
                            <i class="bi bi-copy"></i>
                          </button>
                        </div>
                        <div class="child-answer-content clickable-answer" onclick="universalAnswerFeature.copyAnswer('${childAnswerForJs}', this)" title="点击复制答案">${safeChildAnswer}</div>
                      </div>
                    `;
        }).join('')}
                </div>
              ` : `
                <div class="answer clickable-answer" onclick="universalAnswerFeature.copyAnswerByIndex(${index}, '${groupName}', this)" title="点击复制答案">${safeAnswerText}</div>
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

      // 根据排序模式找到对应的答案
      let targetAnswer = null;

      if (this.state.sortMode === 'file') {
        const groupAnswers = this.state.lastAnswersData.answers.filter(answer =>
          (answer.file || '未知文件') === groupName
        );
        targetAnswer = groupAnswers[answerIndex];
      } else {
        const groupAnswers = this.state.lastAnswersData.answers.filter(answer =>
          (answer.pattern || '未知题型') === groupName
        );
        targetAnswer = groupAnswers[answerIndex];
      }

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
      const childrenAnswers = answerItem.querySelector('.children-answers');
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
    const existingToast = document.querySelector('.copy-toast');
    if (existingToast) {
      existingToast.remove();
    }

    // 创建新的提示
    const toast = document.createElement('div');
    toast.className = `copy-toast ${type}`;
    toast.innerHTML = `
      <i class="bi bi-${type === 'success' ? 'check-circle' : 'x-circle'}"></i>
      <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // 显示动画
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    // 自动隐藏
    setTimeout(() => {
      toast.classList.remove('show');
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
      element.classList.add('copied');
      setTimeout(() => {
        element.classList.remove('copied');
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
        <div class="no-answers">
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
        const sortParam = this.state.sortMode === 'pattern' ? '&sort=pattern' : '';
        const finalViewerUrl = viewerUrl + sortParam;

        this.logManager.addSuccessLog(`答案已分享成功！查看地址: ${finalViewerUrl}`);

        // 显示分享结果小窗口
        this.showShareResultModal(downloadUrl);

        // 复制查看地址到剪贴板
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(finalViewerUrl);
          this.logManager.addInfoLog('查看地址已复制到剪贴板');
        }
      } else {
        this.logManager.addErrorLog(`分享失败: ${result?.error || '未知错误'}`);
      }

    } catch (error) {
      this.logManager.addErrorLog(`分享失败: ${error.message}`);
    }
  }

  // 导出答案文件
  exportAnswers() {
    if (!this.state.lastAnswersData || !this.state.lastAnswersData.answers || this.state.lastAnswersData.answers.length === 0) {
      this.logManager.addErrorLog('没有可导出的答案数据');
      return;
    }

    try {
      // 生成导出数据
      const exportData = {
        timestamp: new Date().toISOString(),
        totalAnswers: this.state.lastAnswersData.answers.length,
        answers: this.state.lastAnswersData.answers,
        version: '1.0',
        exportedBy: 'UniversalAnswerTool'
      };

      // 创建下载链接
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      // 创建下载链接
      const link = document.createElement('a');
      link.href = url;
      link.download = `answers_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 清理URL对象
      URL.revokeObjectURL(url);

      this.logManager.addSuccessLog(`答案文件已导出: ${link.download}`);

    } catch (error) {
      this.logManager.addErrorLog(`导出失败: ${error.message}`);
    }
  }

  // 显示分享结果模态框
  showShareResultModal(downloadUrl) {
    // 生成查看器地址
    const mainUrl = `https://366.cyril.qzz.io/answer-viewer?url=${encodeURIComponent(downloadUrl)}`;
    const backupUrl = `https://a366.netlify.app/answer-viewer?url=${encodeURIComponent(downloadUrl)}`;

    // 根据当前排序模式添加sort参数
    const sortParam = this.state.sortMode === 'pattern' ? '&sort=pattern' : '';
    const mainUrlWithSort = mainUrl + sortParam;
    const backupUrlWithSort = backupUrl + sortParam;

    // 创建模态框HTML
    const modalHtml = `
      <div class="share-result-modal" id="shareResultModal">
        <div class="modal-content">
          <div class="modal-header">
            <h4><i class="bi bi-check-circle text-success"></i> 分享成功</h4>
            <button class="close-btn" onclick="universalAnswerFeature.hideShareResultModal()">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="modal-body">
            <p class="share-info">答案已成功上传到服务器，您可以通过以下地址在线查看：</p>
            <div class="url-section">
              <label><i class="bi bi-link-45deg"></i> 主地址：</label>
              <div class="url-input-group">
                <input type="text" value="${mainUrlWithSort}" readonly class="url-input" id="mainUrl">
                <button class="copy-url-btn" onclick="universalAnswerFeature.copyUrl('mainUrl')" title="复制主地址">
                  <i class="bi bi-copy"></i>
                </button>
                <button class="open-url-btn" onclick="window.open('${mainUrlWithSort}', '_blank')" title="打开主地址">
                  <i class="bi bi-box-arrow-up-right"></i>
                </button>
              </div>
            </div>
            <div class="url-section">
              <label><i class="bi bi-link-45deg"></i> 备用地址：</label>
              <div class="url-input-group">
                <input type="text" value="${backupUrlWithSort}" readonly class="url-input" id="backupUrl">
                <button class="copy-url-btn" onclick="universalAnswerFeature.copyUrl('backupUrl')" title="复制备用地址">
                  <i class="bi bi-copy"></i>
                </button>
                <button class="open-url-btn" onclick="window.open('${backupUrlWithSort}', '_blank')" title="打开备用地址">
                  <i class="bi bi-box-arrow-up-right"></i>
                </button>
              </div>
            </div>
            <div class="sort-info">
              <p><i class="bi bi-funnel"></i> 当前排序方式：${this.state.sortMode === 'pattern' ? '按题型排序' : '按文件排序'}</p>
            </div>
            <div class="share-tips">
              <p><i class="bi bi-info-circle"></i> 提示：如果主地址无法访问，请尝试使用备用地址。点击 <i class="bi bi-box-arrow-up-right"></i> 按钮可直接在浏览器中打开</p>
            </div>
            <div class="modal-footer">
              <button class="primary-btn" onclick="universalAnswerFeature.copyUrl('mainUrl')">
                <i class="bi bi-copy"></i>
                复制主地址
              </button>
              <button class="open-btn" onclick="window.open('${mainUrlWithSort}', '_blank')">
                <i class="bi bi-box-arrow-up-right"></i>
                打开查看
              </button>
              <button class="secondary-btn" onclick="universalAnswerFeature.hideShareResultModal()">
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
