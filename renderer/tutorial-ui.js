class TutorialManager {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
    this.currentPage = 0;
    this.totalPages = 6;
    this.selectedMode = null;
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

    if (this.currentPage === this.totalPages - 1) {
      nextBtn.textContent = '开始使用';
    } else {
      nextBtn.textContent = '下一步';
    }

    if (this.currentPage === 2) {
      this.startAutoFindCache();
    }
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
