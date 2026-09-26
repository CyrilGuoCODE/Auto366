class TutorialManager {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
    this.currentPage = 0;
    this.totalPages = 6;
    this.selectedMode = 'simple';
    this.prepPage = 3;
    this.prepLeft = 0;
    this.prepTimer = null;
  }

  init() {
    const hasCompletedTutorial = localStorage.getItem('tutorial-completed') === 'true';
    if (!hasCompletedTutorial) {
      setTimeout(() => this.showTutorial(), 500);
    }
  }

  showTutorial() {
    const modal = document.getElementById('tutorialModal');
    if (modal) {
      modal.style.display = 'flex';
      this.currentPage = 0;
      this.updatePage();
      this.bindEvents();
    }
  }

  hideTutorial() {
    this.clearPrepLock();
    const modal = document.getElementById('tutorialModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  bindEvents() {
    const nextBtn = document.getElementById('tutorialNextBtn');
    const prevBtn = document.getElementById('tutorialPrevBtn');
    const modeCards = document.querySelectorAll('.modal__mode-card');

    if (nextBtn) {
      nextBtn.onclick = () => this.handleNext();
    }

    if (prevBtn) {
      prevBtn.onclick = () => this.handlePrev();
    }

    modeCards.forEach(card => {
      card.onclick = () => this.handleModeSelect(card);
    });

    const ackBox = document.getElementById('tutorialPrepAckBox');
    if (ackBox) {
      ackBox.onchange = () => this.paintPrepLock();
    }

    const browseBtn = document.getElementById('tutorialBrowseCacheBtn');
    if (browseBtn) {
      browseBtn.addEventListener('click', async () => {
        if (window.electronAPI && window.electronAPI.chooseDirectory) {
          const dirPath = await window.electronAPI.chooseDirectory();
          if (dirPath) {
            const input = document.getElementById('tutorialCachePathInput');
            if (input) {
              input.value = dirPath;
            }
            localStorage.setItem('cache-path', dirPath);
            if (window.electronAPI.setCachePath) {
              window.electronAPI.setCachePath(dirPath);
            }
            // 同步更新设置页面的缓存路径输入框
            const settingsCacheInput = document.getElementById('cachePathInput');
            if (settingsCacheInput) {
              settingsCacheInput.value = dirPath;
            }
          }
        }
      });
    }
  }

  showCachePathInput(path) {
    const spinner = document.getElementById('tutorialCacheSpinner');
    const statusEl = document.getElementById('tutorialCacheStatus');
    const wrap = document.getElementById('tutorialCachePathWrap');
    const input = document.getElementById('tutorialCachePathInput');

    if (spinner) {
      spinner.style.display = 'none';
    }
    if (statusEl) {
      statusEl.style.display = 'none';
    }
    if (wrap) {
      wrap.style.display = 'flex';
    }
    if (input && path) {
      input.value = path;
    }
  }

  handleModeSelect(card) {
    const modeCards = document.querySelectorAll('.modal__mode-card');
    modeCards.forEach(c => c.classList.remove('is-selected'));
    card.classList.add('is-selected');
    this.selectedMode = card.dataset.mode;
  }

  async handleNext() {
    if (this.currentPage === 1) {
      if (this.selectedMode) {
        try {
          await window.electronAPI.switchUiMode(this.selectedMode);
          document.documentElement.setAttribute('data-ui', this.selectedMode);
          if (this.selectedMode === 'simple') {
            document.documentElement.setAttribute('data-simple-page', 'menu');
            if (window.app && window.app.communityUI) {
              await window.app.communityUI.renderSimpleHomeRulesets();
            }
          } else {
            document.documentElement.removeAttribute('data-simple-page');
            if (window.app && window.app.state) {
              window.app.state.syncSimpleControlPanelActive(window.app.state.currentView);
            }
          }
          if (window.app && window.app.rulesUI) {
            await window.app.rulesUI.loadRules();
          }
          this.logManager.addInfoLog(`已切换到${this.selectedMode === 'simple' ? '简易' : '专业'}模式`);
        } catch (error) {
          console.error('切换UI模式失败:', error);
        }
      }
    }

    if (this.currentPage >= this.totalPages - 1) {
      localStorage.setItem('tutorial-completed', 'true');
      this.hideTutorial();
      return;
    }

    this.currentPage++;
    this.updatePage();
  }

  handlePrev() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.updatePage();
    }
  }

  updatePage() {
    const pages = document.querySelectorAll('.modal__page');
    const dots = document.querySelectorAll('.modal__progress-dot');
    const prevBtn = document.getElementById('tutorialPrevBtn');
    const nextBtn = document.getElementById('tutorialNextBtn');

    pages.forEach((page, index) => {
      page.style.display = index === this.currentPage ? 'block' : 'none';
    });

    dots.forEach((dot, index) => {
      dot.classList.toggle('is-active', index <= this.currentPage);
    });

    prevBtn.style.display = this.currentPage > 0 ? 'inline-block' : 'none';

    if (this.currentPage === this.prepPage) {
      this.startPrepLock();
    } else {
      this.clearPrepLock();
      nextBtn.disabled = false;
      nextBtn.textContent = this.currentPage === this.totalPages - 1 ? '开始使用' : '下一步';
    }

    if (this.currentPage === 2) {
      this.startAutoFindCache();
    }
  }

  clearPrepLock() {
    if (this.prepTimer) {
      clearInterval(this.prepTimer);
      this.prepTimer = null;
    }
  }

  startPrepLock() {
    this.clearPrepLock();
    const box = document.getElementById('tutorialPrepAckBox');
    const ack = document.getElementById('tutorialPrepAck');
    this.prepLeft = 5;
    if (box) {
      box.checked = false;
      box.disabled = true;
    }
    if (ack) ack.classList.add('is-locked');
    this.paintPrepLock();
    this.prepTimer = setInterval(() => {
      this.prepLeft -= 1;
      if (this.prepLeft <= 0) {
        this.clearPrepLock();
        if (box) box.disabled = false;
        if (ack) ack.classList.remove('is-locked');
      }
      this.paintPrepLock();
    }, 1000);
  }

  paintPrepLock() {
    if (this.currentPage !== this.prepPage) return;
    const nextBtn = document.getElementById('tutorialNextBtn');
    const box = document.getElementById('tutorialPrepAckBox');
    if (!nextBtn) return;
    if (this.prepLeft > 0) {
      nextBtn.disabled = true;
      nextBtn.textContent = '请读完 ' + this.prepLeft;
      return;
    }
    if (!box || !box.checked) {
      nextBtn.disabled = true;
      nextBtn.textContent = '请勾选确认';
      return;
    }
    nextBtn.disabled = false;
    nextBtn.textContent = '下一步';
  }

  async startAutoFindCache() {
    const statusEl = document.getElementById('tutorialCacheStatus');
    const descEl = document.getElementById('tutorialCacheDesc');
    const nextBtn = document.getElementById('tutorialNextBtn');

    if (nextBtn) {
      nextBtn.disabled = true;
    }
    if (statusEl) {
      statusEl.textContent = '正在搜索...';
    }

    try {
      const result = await window.electronAPI.autoFindCacheDir();
      this.cacheFindResult = result;
      if (result.success) {
        localStorage.setItem('cache-path', result.path);
        if (window.electronAPI.setCachePath) {
          window.electronAPI.setCachePath(result.path);
        }
        // 同步更新设置页面的缓存路径输入框
        const settingsCacheInput = document.getElementById('cachePathInput');
        if (settingsCacheInput) {
          settingsCacheInput.value = result.path;
        }
        this.showCachePathInput(result.path);
        if (statusEl) {
          statusEl.style.display = 'none';
        }
        if (descEl) {
          descEl.textContent = '已自动匹配缓存目录，可直接下一步';
        }
        this.logManager.addInfoLog('教程：缓存目录已自动设置');
      } else {
        this.showCachePathInput(null);
        if (statusEl) {
          statusEl.style.display = 'none';
        }
        if (descEl) {
          descEl.textContent = '未找到缓存目录，请手动选择';
        }
      }
    } catch (error) {
      this.cacheFindResult = { success: false, error: error.message };
      this.showCachePathInput(null);
      if (statusEl) {
        statusEl.style.display = 'none';
      }
      if (descEl) {
        descEl.textContent = '搜索失败，请手动选择';
      }
    }

    if (nextBtn) {
      nextBtn.disabled = false;
    }
  }
}

export default TutorialManager;
