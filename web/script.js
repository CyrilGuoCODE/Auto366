class AnswerViewer {
  constructor() {
    this.sortMode = 'file';
    this.lastAnswersData = null;
    this.loadedFromURL = false;
    this.initEventListeners();
    this.loadFromURL();
  }

  initEventListeners() {
    document.getElementById('sortMode').addEventListener('change', (e) => {
      this.sortMode = e.target.value;
      const container = document.getElementById('answersContainer');
      if (container.innerHTML && !container.innerHTML.includes('暂无答案数据')) {
        const answersData = this.lastAnswersData;
        if (answersData) {
          this.displayAnswers(answersData);
        }
      }
    });

    document.getElementById('importAnswer').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target.result;
          try {
            const answersData = JSON.parse(content);
            this.displayAnswers(answersData);
          } catch (error) {
            console.error(error);
            alert('解析答案文件失败');
          }
          event.target.value = '';
        };
        reader.readAsText(file);
      }
    });

    document.getElementById('clearAnswersBtn').addEventListener('click', () => {
      const container = document.getElementById('answersContainer');
      container.innerHTML = '<div class="no-answers">暂无答案数据</div>';
      this.lastAnswersData = null;
      this.hideShareButton();
      this.showToast('已清空提取结果');
    });

    document.getElementById('shareAnswerBtn').addEventListener('click', () => {
      this.copyCurrentURL();
    });
  }

  loadFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const url = urlParams.get('url');
    if (url) {
      fetch(url)
        .then(response => {
          if (!response.ok) {
            throw new Error('网络响应错误');
          }
          return response.json();
        })
        .then(data => {
          this.displayAnswers(data);
          this.loadedFromURL = true;
          this.showShareButton();
        })
        .catch(error => {
          console.error('加载JSON文件失败:', error);
          alert('加载JSON文件失败: ' + error.message);
        });
    }
  }

  showShareButton() {
    const shareButtonContainer = document.getElementById('shareAnswerButtonContainer');
    if (shareButtonContainer) {
      shareButtonContainer.style.display = 'flex';
    }
  }

  hideShareButton() {
    const shareButtonContainer = document.getElementById('shareAnswerButtonContainer');
    if (shareButtonContainer) {
      shareButtonContainer.style.display = 'none';
    }
    this.loadedFromURL = false;
  }

  copyCurrentURL() {
    const currentURL = window.location.href;
    this.copyToClipboard(currentURL);
    this.showToast('页面链接已复制到剪贴板！');
  }

  copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('答案已复制到剪贴板！');
      }).catch(err => {
        console.error('复制失败:', err);
        this.fallbackCopyToClipboard(text);
      });
    } else {
      this.fallbackCopyToClipboard(text);
    }
  }

  fallbackCopyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = 0;
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        this.showToast('答案已复制到剪贴板！');
      } else {
        this.showToast('复制失败，请手动复制', true);
      }
    } catch (err) {
      console.error('复制失败:', err);
      this.showToast('复制失败，请手动复制', true);
    }
    document.body.removeChild(textarea);
  }

  showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'copy-toast show';
    if (isError) {
      toast.classList.add('error');
    }
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (document.body.contains(toast)) {
          document.body.removeChild(toast);
        }
      }, 300);
    }, 2000);
  }

  displayAnswers(data) {
    const container = document.getElementById('answersContainer');

    container.innerHTML = '';

    if (!data.answers || data.answers.length === 0) {
      container.innerHTML = '<div class="no-answers">未找到答案数据</div>';
      return;
    }

    this.lastAnswersData = data;

    const patternOrder = {
      '听后选择': 1,
      '听后回答': 2,
      '听后转述': 3,
      '朗读短文': 4,
      '分析内容': 5,
      'JSON句子跟读模式': 6,
      'JSON单词发音模式': 7,
      'JSON答案数组模式': 8,
      'JSON题目模式': 9,
      '文本答案模式': 10,
      '文本选项模式': 11,
      'XML正确答案模式': 12,
      'XML题目答案模式': 13,
      '通用XML答案模式': 14
    };

    if (this.sortMode === 'file') {
      const answersByFile = {};
      data.answers.forEach(answer => {
        const sourceFile = answer.sourceFile || '未知文件';
        if (!answersByFile[sourceFile]) {
          answersByFile[sourceFile] = [];
        }
        answersByFile[sourceFile].push(answer);
      });
      Object.keys(answersByFile).forEach(sourceFile => {
        const fileSection = document.createElement('div');
        fileSection.className = 'file-section';

        const fileHeader = document.createElement('div');
        fileHeader.className = 'file-header';
        fileHeader.innerHTML = `
          <h4>📁 ${sourceFile}</h4>
          <span class="answer-count">${answersByFile[sourceFile].length} 个答案</span>
        `;
        fileSection.appendChild(fileHeader);

        const sortedAnswers = answersByFile[sourceFile].sort((a, b) => {
          const patternA = patternOrder[a.pattern] || 99;
          const patternB = patternOrder[b.pattern] || 99;
          return patternA - patternB;
        });

        sortedAnswers.forEach(answer => {
          fileSection.appendChild(this.createAnswerDisplay(answer));
        });

        container.appendChild(fileSection);
      });
    } else {
      const answersByPattern = {};
      data.answers.forEach(answer => {
        const pattern = answer.pattern || '未知题型';
        if (!answersByPattern[pattern]) {
          answersByPattern[pattern] = [];
        }
        answersByPattern[pattern].push(answer);
      });

      Object.keys(patternOrder).forEach(pattern => {
        if (answersByPattern[pattern]) {
          const patternSection = document.createElement('div');
          patternSection.className = 'pattern-section';

          const patternHeader = document.createElement('div');
          patternHeader.className = 'pattern-header';
          patternHeader.innerHTML = `
            <h4>📝 ${pattern}</h4>
            <span class="answer-count">${answersByPattern[pattern].length} 个答案</span>
          `;
          patternSection.appendChild(patternHeader);

          const sortedAnswers = answersByPattern[pattern].sort((a, b) => {
            const fileA = a.sourceFile || '未知文件';
            const fileB = b.sourceFile || '未知文件';
            return fileA.localeCompare(fileB);
          });

          sortedAnswers.forEach(answer => {
            patternSection.appendChild(this.createAnswerDisplay(answer));
          });

          container.appendChild(patternSection);
        }
      });
    }
  }

  createAnswerDisplay(answer) {
    const answerItem = document.createElement('div');
    answerItem.className = 'answer-item';

    const answerNumber = document.createElement('div');
    answerNumber.className = 'answer-number';
    answerNumber.textContent = answer.question;

    const answerOption = document.createElement('div');
    answerOption.className = 'answer-option';
    answerOption.textContent = answer.answer;

    const answerContent = document.createElement('div');
    answerContent.className = 'answer-content answer-content-clickable';
    
    const copyBtn = document.createElement('div');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '📋 复制';
    copyBtn.title = '点击复制答案';

    answerOption.addEventListener('click', () => {
      this.copyToClipboard(answer.answer);
    });

    let childrenItem = null;
    if (answer.children) {
      childrenItem = document.createElement('div');
      childrenItem.className = 'children';
      childrenItem.style.display = 'none';
      answer.children.forEach(child => {
        childrenItem.appendChild(this.createAnswerDisplay(child));
      });
      answerContent.textContent = '点击展开全部回答';
      
      answerContent.addEventListener('click', () => {
        if (childrenItem.style.display === 'none') {
          childrenItem.style.display = 'block';
          answerContent.textContent = '点击收起全部回答';
        } else {
          childrenItem.style.display = 'none';
          answerContent.textContent = '点击展开全部回答';
        }
      });
    } else {
      answerContent.textContent = answer.content || '暂无内容';
      answerContent.addEventListener('click', () => {
        this.copyToClipboard(answer.content || '暂无内容');
      });
    }

    copyBtn.addEventListener('click', () => {
      const fullAnswer = `${answer.answer}\n${answer.content || ''}`.trim();
      this.copyToClipboard(fullAnswer);
    });

    answerItem.appendChild(answerNumber);
    answerItem.appendChild(answerOption);
    answerItem.appendChild(answerContent);

    if (answer.pattern) {
      const answerPattern = document.createElement('div');
      answerPattern.className = 'answer-pattern';
      answerPattern.textContent = `提取模式: ${answer.pattern}`;
      answerItem.appendChild(answerPattern);
    }

    if (answer.sourceFile && this.sortMode === 'pattern') {
      const answerSource = document.createElement('div');
      answerSource.className = 'answer-source';
      answerSource.textContent = `来源: ${answer.sourceFile}`;
      answerItem.appendChild(answerSource);
    }

    answerItem.appendChild(copyBtn);

    if (childrenItem) {
      answerItem.appendChild(childrenItem);
    }

    return answerItem;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new AnswerViewer();
});

