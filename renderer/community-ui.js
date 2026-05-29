import Utils from './utils.js';

class CommunityUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
  }

  // 初始化社区规则集
  initCommunityRulesets() {
    // 初始化社区规则集相关事件监听器
    const searchInput = document.getElementById('rulesetSearchInput');
    const searchBtn = document.getElementById('searchRulesetsBtn');
    const refreshBtn = document.getElementById('refreshRulesetsBtn');
    const uploadBtn = document.getElementById('uploadRulesetBtn');
    const sortBySelect = document.getElementById('sortBySelect');
    const sortOrderSelect = document.getElementById('sortOrderSelect');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    if (searchInput) {
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.searchRulesets();
        }
      });
    }

    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        this.searchRulesets();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.refreshRulesets();
      });
    }

    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        this.showUploadRulesetModal();
      });
    }

    if (sortBySelect) {
      sortBySelect.addEventListener('change', () => {
        this.searchRulesets();
      });
    }

    if (sortOrderSelect) {
      sortOrderSelect.addEventListener('change', () => {
        this.searchRulesets();
      });
    }

    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        this.previousPage();
      });
    }

    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        this.nextPage();
      });
    }

    // 规则集详情模态框事件
    const closeDetailModal = document.getElementById('closeRulesetDetailModal');
    const cancelDetailBtn = document.getElementById('cancelRulesetDetailBtn');
    const installBtn = document.getElementById('installRulesetBtn');

    if (closeDetailModal) {
      closeDetailModal.addEventListener('click', () => {
        this.hideRulesetDetailModal();
      });
    }

    if (cancelDetailBtn) {
      cancelDetailBtn.addEventListener('click', () => {
        this.hideRulesetDetailModal();
      });
    }

    if (installBtn) {
      installBtn.addEventListener('click', () => {
        this.installCurrentRuleset();
      });
    }

    // 上传规则集模态框事件
    const closeUploadModal = document.getElementById('closeUploadRulesetModal');
    const cancelUploadBtn = document.getElementById('cancelUploadRulesetBtn');
    const uploadForm = document.getElementById('uploadRulesetForm');
    const rulesetSelect = document.getElementById('uploadRulesetSelect');

    if (closeUploadModal) {
      closeUploadModal.addEventListener('click', () => {
        this.hideUploadRulesetModal();
      });
    }

    if (cancelUploadBtn) {
      cancelUploadBtn.addEventListener('click', () => {
        this.hideUploadRulesetModal();
      });
    }

    if (uploadForm) {
      uploadForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitUploadRuleset();
      });
    }

    if (rulesetSelect) {
      rulesetSelect.addEventListener('change', () => {
        this.onRulesetSelectChange();
      });
    }

    // 模态框背景点击关闭
    const detailModal = document.getElementById('rulesetDetailModal');
    if (detailModal) {
      detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) {
          this.hideRulesetDetailModal();
        }
      });
    }

    const uploadModal = document.getElementById('uploadRulesetModal');
    if (uploadModal) {
      uploadModal.addEventListener('click', (e) => {
        if (e.target === uploadModal) {
          this.hideUploadRulesetModal();
        }
      });
    }
  }

  // 加载社区规则集
  async loadCommunityRulesets(reset = true) {
    if (this.state.isLoadingRulesets) return;

    if (reset) {
      this.state.currentPage = 0;
      this.state.communityRulesets = [];
    }

    this.state.isLoadingRulesets = true;
    this.showLoadingState();

    try {
      const searchTerm = document.getElementById('rulesetSearchInput')?.value || '';
      const sortBy = document.getElementById('sortBySelect')?.value || 'created_at';
      const sortOrder = document.getElementById('sortOrderSelect')?.value || 'desc';

      const params = new URLSearchParams({
        search: searchTerm,
        status: 'approved',
        sortBy: sortBy,
        sortOrder: sortOrder,
        limit: this.state.pageSize.toString(),
        offset: (this.state.currentPage * this.state.pageSize).toString()
      });

      const response = await fetch(`https://366.cyril.qzz.io/api/rulesets?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        if (reset) {
          this.state.communityRulesets = data.data;
        } else {
          this.state.communityRulesets.push(...data.data);
        }

        // 检查已安装状态
        await this.checkInstalledStatus();

        this.state.hasMorePages = data.pagination.hasMore;
        this.displayRulesets();
        this.updatePaginationControls();
      } else {
        throw new Error(data.message || '获取规则集列表失败');
      }
    } catch (error) {
      console.error('加载社区规则集失败:', error);
      this.showErrorState(error.message);
    } finally {
      this.state.isLoadingRulesets = false;
    }
  }

  // 显示加载状态
  showLoadingState() {
    const container = document.getElementById('rulesetsContainer');
    if (container) {
      container.innerHTML = `
        <div class="community-view__loading">
          <div class="community-view__spinner"></div>
          <p>正在加载规则集...</p>
        </div>
      `;
    }
  }

  // 显示错误状态
  showErrorState(message) {
    const container = document.getElementById('rulesetsContainer');
    if (container) {
      container.innerHTML = `
        <div class="community-view__error">
          <i class="bi bi-exclamation-triangle"></i>
          <p>加载失败</p>
          <p class="community-view__error-text">${message}</p>
          <button class="btn--primary" onclick="universalAnswerFeature.refreshRulesets()">
            重试
          </button>
        </div>
      `;
    }
  }

  // 显示规则集
  displayRulesets() {
    const container = document.getElementById('rulesetsContainer');
    if (!container) return;

    if (this.state.communityRulesets.length === 0) {
      container.innerHTML = `
        <div class="community-view__empty">
          <i class="bi bi-collection"></i>
          <p>未找到规则集</p>
          <p class="text--muted">尝试调整搜索条件或刷新列表</p>
        </div>
      `;
      return;
    }

    const html = this.state.communityRulesets.map(ruleset => this.createRulesetItemHTML(ruleset)).join('');
    container.innerHTML = html;
  }

  // 检查已安装状态
  async checkInstalledStatus() {
    try {
      const localRulesets = await window.electronAPI.getRules();

      this.state.communityRulesets.forEach(ruleset => {
        const isInstalled = localRulesets.some(localGroup => {
          if (localGroup.communityRulesetId === ruleset.id) {
            return true;
          }
          if (localGroup.name === ruleset.name && localGroup.author === ruleset.author) {
            return true;
          }
          if (localGroup.name === ruleset.name) {
            return true;
          }
          return false;
        });

        ruleset.isInstalled = isInstalled;
      });
    } catch (error) {
      console.error('检查安装状态失败:', error);
    }
  }

  // 创建规则集项HTML
  createRulesetItemHTML(ruleset) {
    const downloadCount = ruleset.download_count || 0;
    const createdDate = new Date(ruleset.created_at).toLocaleDateString('zh-CN');
    const hasInjection = ruleset.has_injection_package;
    const isInstalled = ruleset.isInstalled;
    const isSimple = document.documentElement.getAttribute('data-ui') === 'simple';

    if (isSimple) {
      return `
        <div class="ruleset-item ${isInstalled ? 'is-installed' : ''}">
          <div class="ruleset-item__header">
            <div class="ruleset-item__info">
              <div class="ruleset-item__name">
                ${Utils.escapeHtml(ruleset.name)}
                ${isInstalled ? '<span class="badge--installed"><i class="bi bi-check-circle"></i> 已安装</span>' : ''}
              </div>
              <div class="ruleset-item__description">${Utils.escapeHtml(ruleset.description || '暂无描述')}</div>
            </div>
            <div class="ruleset-item__actions">
              <button class="btn--install ${isInstalled ? 'is-installed' : ''}" 
                      onclick="universalAnswerFeature.installRuleset('${ruleset.id}')"
                      ${isInstalled ? 'disabled' : ''}>
                <i class="bi bi-${isInstalled ? 'check-circle' : 'download'}"></i>
                <span>${isInstalled ? '已安装' : '安装'}</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="ruleset-item ${isInstalled ? 'is-installed' : ''}" onclick="universalAnswerFeature.showRulesetDetail('${ruleset.id}')">
        <div class="ruleset-item__header">
          <div class="ruleset-item__info">
            <div class="ruleset-item__name">
              ${Utils.escapeHtml(ruleset.name)}
              ${isInstalled ? '<span class="badge--installed"><i class="bi bi-check-circle"></i> 已安装</span>' : ''}
            </div>
            <div class="ruleset-item__author">作者: ${Utils.escapeHtml(ruleset.author)}</div>
            <div class="ruleset-item__description">${Utils.escapeHtml(ruleset.description || '暂无描述')}</div>
            <div class="ruleset-item__meta">
              <div class="ruleset-item__downloads">
                <i class="bi bi-download"></i>
                <span>${downloadCount} 次下载</span>
              </div>
              <div class="ruleset-item__date">${createdDate}</div>
            </div>
            <div class="ruleset-item__tags">
              ${hasInjection ? '<span class="badge--tag has-injection">包含注入文件</span>' : ''}
              <span class="badge--tag">已审核</span>
            </div>
          </div>
          <div class="ruleset-item__actions" onclick="event.stopPropagation()">
            <button class="btn--view-details" onclick="universalAnswerFeature.showRulesetDetail('${ruleset.id}')">
              <i class="bi bi-eye"></i>
              <span>查看详情</span>
            </button>
            <button class="btn--install ${isInstalled ? 'is-installed' : ''}" 
                    onclick="universalAnswerFeature.installRuleset('${ruleset.id}')"
                    ${isInstalled ? 'disabled' : ''}>
              <i class="bi bi-${isInstalled ? 'check-circle' : 'download'}"></i>
              <span>${isInstalled ? '已安装' : '安装'}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // 搜索规则集
  searchRulesets() {
    this.loadCommunityRulesets(true);
  }

  // 刷新规则集
  refreshRulesets() {
    this.loadCommunityRulesets(true);
  }

  // 上一页
  previousPage() {
    if (this.state.currentPage > 0) {
      this.state.currentPage--;
      this.loadCommunityRulesets(false);
    }
  }

  // 下一页
  nextPage() {
    if (this.state.hasMorePages) {
      this.state.currentPage++;
      this.loadCommunityRulesets(false);
    }
  }

  // 更新分页控制
  updatePaginationControls() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');

    if (prevBtn) {
      prevBtn.disabled = this.state.currentPage === 0;
    }

    if (nextBtn) {
      nextBtn.disabled = !this.state.hasMorePages;
    }

    if (pageInfo) {
      pageInfo.textContent = `第 ${this.state.currentPage + 1} 页`;
    }
  }

  // 显示规则集详情
  async showRulesetDetail(rulesetId) {
    try {
      const response = await fetch(`https://366.cyril.qzz.io/api/rulesets/${rulesetId}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        this.state.currentRulesetDetail = data.data;
        this.displayRulesetDetail(data.data);
        this.showRulesetDetailModal();
      } else {
        throw new Error(data.message || '获取规则集详情失败');
      }
    } catch (error) {
      console.error('获取规则集详情失败:', error);
      this.logManager.addErrorLog('获取规则集详情失败: ' + error.message);
    }
  }

  // 显示规则集详情模态框
  showRulesetDetailModal() {
    const modal = document.getElementById('rulesetDetailModal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  // 隐藏规则集详情模态框
  hideRulesetDetailModal() {
    const modal = document.getElementById('rulesetDetailModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  // 显示规则集详情内容
  displayRulesetDetail(ruleset) {
    const content = document.getElementById('rulesetDetailContent');
    if (!content) return;

    const downloadCount = ruleset.download_count || 0;
    const createdDate = new Date(ruleset.created_at).toLocaleDateString('zh-CN');
    const totalSize = Utils.formatFileSize(ruleset.file_info?.totalSize || 0);
    const fileCount = ruleset.file_info?.totalFiles || 0;

    let filesHTML = '';
    if (ruleset.file_info?.files) {
      filesHTML = ruleset.file_info.files.map(file => `
        <div class="modal__file-item">
          <div class="modal__file-info">
            <i class="modal__file-icon bi ${Utils.getFileIcon(file.type)}"></i>
            <span class="modal__file-name">${Utils.escapeHtml(file.name)}</span>
          </div>
          <span class="modal__file-size">${Utils.formatFileSize(file.size)}</span>
        </div>
      `).join('');
    }

    content.innerHTML = `
      <div class="modal__detail-header">
        <div class="modal__detail-title">${Utils.escapeHtml(ruleset.name)}</div>
        <div class="modal__detail-author">作者: ${Utils.escapeHtml(ruleset.author)}</div>
        <div class="modal__detail-description">${Utils.escapeHtml(ruleset.description || '暂无描述')}</div>
        <div class="modal__detail-stats">
          <div class="modal__detail-stat">
            <i class="bi bi-download"></i>
            <span>${downloadCount} 次下载</span>
          </div>
          <div class="modal__detail-stat">
            <i class="bi bi-calendar"></i>
            <span>${createdDate}</span>
          </div>
          <div class="modal__detail-stat">
            <i class="bi bi-files"></i>
            <span>${fileCount} 个文件</span>
          </div>
          <div class="modal__detail-stat">
            <i class="bi bi-hdd"></i>
            <span>${totalSize}</span>
          </div>
        </div>
      </div>
      ${filesHTML ? `
        <div class="modal__detail-files">
          <h4>包含文件</h4>
          <div class="modal__file-list">
            ${filesHTML}
          </div>
        </div>
      ` : ''}
    `;
  }

  // 安装当前规则集
  installCurrentRuleset() {
    if (this.state.currentRulesetDetail) {
      this.installRuleset(this.state.currentRulesetDetail.id);
    }
  }

  // 安装规则集
  async installRuleset(rulesetId) {
    const ruleset = this.state.communityRulesets.find(r => r.id === rulesetId) || this.state.currentRulesetDetail;
    if (!ruleset) {
      this.logManager.addErrorLog('未找到规则集信息');
      return;
    }

    if (ruleset.isInstalled) {
      this.logManager.addInfoLog(`规则集 "${ruleset.name}" 已经安装`);
      return;
    }

    try {
      this.logManager.addInfoLog(`开始安装规则集: ${ruleset.name}`);

      const jsonUrl = ruleset.file_urls.find(url => url.includes('.json'));
      if (!jsonUrl) {
        throw new Error('未找到规则文件');
      }

      const response = await fetch(jsonUrl);
      if (!response.ok) {
        throw new Error(`下载规则文件失败: HTTP ${response.status}`);
      }

      let rulesData = await response.json();

      if (ruleset.has_injection_package) {
        const zipUrl = ruleset.file_urls.find(url => url.includes('.zip'));
        if (zipUrl) {
          try {
            const localZipPath = await this.downloadAndSaveInjectionPackage(zipUrl, ruleset.name);

            let rulesToUpdate = [];
            if (Array.isArray(rulesData)) {
              rulesToUpdate = rulesData;
            } else if (rulesData.rules) {
              rulesToUpdate = rulesData.rules;
            }

            rulesToUpdate.forEach(rule => {
              if (rule.type === 'zip-implant' && rule.zipImplant) {
                rule.zipImplant = localZipPath;
              }
            });
          } catch (error) {
            console.error('下载注入包失败:', error);
            this.logManager.addErrorLog(`注入包下载失败: ${error.message}`);
          }
        }
      }

      const communityRulesetId = ruleset.id;

      const allRules = Array.isArray(rulesData)
        ? rulesData
        : rulesData.rules
          ? rulesData.rules
          : [];
      const hasInjection = allRules.some(r => r.type === 'zip-implant' || r.type === 'zip-implant-dynamic');
      const autoCompatible = !hasInjection;

      const group = {
        name: ruleset.name,
        description: ruleset.description,
        author: ruleset.author,
        communityRulesetId: communityRulesetId,
        compatible: autoCompatible
      };

      const importData = {
        group: group,
        rules: allRules.filter(r => !r.isGroup)
      };

      const result = await window.electronAPI.importResponseRulesFromData(importData);
      if (!result || !result.success) {
        throw new Error(result?.error || '导入规则数据失败');
      }

      await this.checkInstalledStatus();
      this.displayRulesets();
      this.logManager.addSuccessLog(`规则集 "${ruleset.name}" 安装成功`);

      this.hideRulesetDetailModal();

    } catch (error) {
      console.error('安装规则集失败:', error);
      this.logManager.addErrorLog(`安装规则集失败: ${error.message}`);
    }
  }

  // 下载并保存注入包
  async downloadAndSaveInjectionPackage(zipUrl, rulesetName) {
    try {
      const response = await fetch(zipUrl);
      if (!response.ok) {
        throw new Error(`下载注入包失败: HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      // 调用主进程保存文件
      const result = await window.electronAPI.saveInjectionPackage({
        buffer: arrayBuffer,
        fileName: `${rulesetName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_injection.zip`
      });

      if (result && result.path) {
        return result.path;
      } else {
        throw new Error('保存注入包失败');
      }
    } catch (error) {
      console.error('下载并保存注入包失败:', error);
      throw error;
    }
  }

  // 显示上传规则集模态框
  async showUploadRulesetModal() {
    try {
      const rulesets = await window.electronAPI.getRules();

      const select = document.getElementById('uploadRulesetSelect');
      if (select) {
        select.innerHTML = '<option value="">请选择要上传的规则集</option>';
        rulesets.forEach(group => {
          const option = document.createElement('option');
          option.value = group.id;
          option.textContent = `${group.name} (${group.author || '未知作者'})`;
          select.appendChild(option);
        });
      }

      const modal = document.getElementById('uploadRulesetModal');
      if (modal) {
        modal.style.display = 'flex';
      }
    } catch (error) {
      console.error('加载规则集列表失败:', error);
      this.logManager.addErrorLog('加载规则集列表失败: ' + error.message);
    }
  }

  // 隐藏上传规则集模态框
  hideUploadRulesetModal() {
    const modal = document.getElementById('uploadRulesetModal');
    if (modal) {
      modal.style.display = 'none';
    }

    const form = document.getElementById('uploadRulesetForm');
    if (form) {
      form.reset();
    }

    const progress = document.getElementById('uploadProgress');
    if (progress) {
      progress.style.display = 'none';
    }
  }

  // 规则集选择变化
  async onRulesetSelectChange() {
    const select = document.getElementById('uploadRulesetSelect');
    const nameInput = document.getElementById('uploadRulesetName');
    const descInput = document.getElementById('uploadRulesetDescription');
    const authorInput = document.getElementById('uploadRulesetAuthor');
    const includeInjectionCheckbox = document.getElementById('uploadIncludeInjection');

    if (!select.value) {
      if (nameInput) nameInput.value = '';
      if (descInput) descInput.value = '';
      if (authorInput) authorInput.value = '';
      if (includeInjectionCheckbox) includeInjectionCheckbox.checked = false;
      return;
    }

    try {
      const rulesets = await window.electronAPI.getRules();
      const selectedGroup = rulesets.find(rs => rs.id === select.value);

      if (selectedGroup) {
        if (nameInput) nameInput.value = selectedGroup.name || '';
        if (descInput) descInput.value = selectedGroup.description || '';
        if (authorInput) authorInput.value = selectedGroup.author || '';

        const hasZipRules = (selectedGroup.rules || []).some(rule => rule.type === 'zip-implant');
        if (includeInjectionCheckbox) includeInjectionCheckbox.checked = hasZipRules;
      }
    } catch (error) {
      console.error('获取规则集详情失败:', error);
    }
  }

  // 提交上传规则集
  async submitUploadRuleset() {
    const form = document.getElementById('uploadRulesetForm');
    const submitBtn = document.getElementById('submitUploadRulesetBtn');
    const progress = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('uploadProgressFill');
    const progressText = document.getElementById('uploadProgressText');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const rulesetId = document.getElementById('uploadRulesetSelect').value;
    const name = document.getElementById('uploadRulesetName').value;
    const description = document.getElementById('uploadRulesetDescription').value;
    const author = document.getElementById('uploadRulesetAuthor').value;
    const includeInjection = document.getElementById('uploadIncludeInjection').checked;

    if (!rulesetId) {
      this.logManager.addErrorLog('请选择规则集');
      return;
    }

    try {
      submitBtn.disabled = true;
      progress.style.display = 'block';
      progressText.textContent = '准备上传...';
      progressFill.style.width = '0%';

      const rulesets = await window.electronAPI.getRules();
      const selectedGroup = rulesets.find(rs => rs.id === rulesetId);
      const groupRules = selectedGroup ? (selectedGroup.rules || []) : [];

      if (!selectedGroup || groupRules.length === 0) {
        throw new Error('未找到规则集或规则集为空');
      }

      progressText.textContent = '正在上传规则集...';
      progressFill.style.width = '30%';

      const result = await window.electronAPI.uploadRules(
        name,
        description,
        author,
        groupRules,
        (p) => {
          progressFill.style.width = `${30 + p * 0.7}%`;
          progressText.textContent = `上传中... ${Math.round(p)}%`;
        }
      );

      if (result.status === 200 || result.status === 201) {
        progressFill.style.width = '100%';
        progressText.textContent = '上传成功！';

        this.logManager.addSuccessLog(`规则集 "${name}" 上传成功，等待审核`);

        setTimeout(() => {
          this.hideUploadRulesetModal();
          this.refreshRulesets();
        }, 2000);
      } else {
        throw new Error(result.data?.message || `上传失败 (HTTP ${result.status})`);
      }
    } catch (error) {
      console.error('上传规则集失败:', error);
      this.logManager.addErrorLog('上传规则集失败: ' + error.message);
      const progressEl = document.getElementById('uploadProgress');
      if (progressEl) {
        progressEl.style.display = 'none';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  // 渲染简单模式首页规则集
  async renderSimpleHomeRulesets() {
    if (document.documentElement.getAttribute('data-ui') !== 'simple') {
      return;
    }
    const grid = document.getElementById('simple-ruleset-grid');
    const emptyEl = document.getElementById('simple-ruleset-empty');
    if (!grid) {
      return;
    }
    let rulesets;
    try {
      rulesets = await window.electronAPI.getRules();
    } catch (e) {
      grid.innerHTML = '';
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '无法加载规则集列表';
      }
      return;
    }
    if (rulesets.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '暂无已安装的规则集，请在专业模式下从社区安装或导入。';
      }
      return;
    }
    if (emptyEl) {
      emptyEl.hidden = true;
    }
    grid.innerHTML = rulesets.map((g) => {
      const name = this.escapeHtml(g.name || '未命名规则集');
      const desc = this.escapeHtml(g.description || '无描述');
      const gid = g.id;
      const active = g.enabled ? ' simple-home__card is-active' : ' simple-home__card';
      return `<div class="${active}" data-group-id="${gid}"><h3>${name}</h3><p>${desc}</p></div>`;
    }).join('');
    grid.querySelectorAll('.simple-home__card').forEach((card) => {
      card.addEventListener('click', () => {
        const gid = card.getAttribute('data-group-id');
        if (gid) {
          this.enterSimpleRuleset(gid);
        }
      });
    });
  }

  // 进入简单模式规则集
  async enterSimpleRuleset(groupId) {
    await this.applyExclusiveRuleset(groupId);
    document.documentElement.setAttribute('data-ui', 'simple');
    document.documentElement.setAttribute('data-simple-page', 'app');
    this.state.switchView('answers');
  }

  // 应用独占规则集
  async applyExclusiveRuleset(groupId) {
    let rulesets;
    try {
      rulesets = await window.electronAPI.getRules();
    } catch (e) {
      this.logManager.addErrorLog(`读取规则失败: ${e.message}`);
      return;
    }
    const target = rulesets.find(rs => rs.id === groupId);
    if (!target) {
      this.logManager.addErrorLog('未找到该规则集');
      return;
    }
    let changed = false;
    const disabledGroups = [];
    const updated = rulesets.map(rs => {
      if (rs.id === groupId) {
        if (!rs.enabled) {
          changed = true;
          return { ...rs, enabled: true };
        }
        return rs;
      }
      if (rs.enabled) {
        changed = true;
        disabledGroups.push(rs.name || rs.id);
        return { ...rs, enabled: false };
      }
      return rs;
    });

    if (changed) {
      const res = await window.electronAPI.saveResponseRules(updated);
      if (!res || !res.success) {
        this.logManager.addErrorLog('保存规则集开关失败');
        return;
      }
      this.logManager.addSuccessLog(`已启用规则集：${target.name || groupId}`);
      if (disabledGroups.length > 0) {
        const names = disabledGroups.join('、');
        this.logManager.addInfoLog(`已自动关闭其他规则集：${names}`);
      }
    }
    const ui = document.documentElement.getAttribute('data-ui');
    await this.renderSimpleHomeRulesets();
    if (ui === 'simple' && this.state.currentView === 'rules') {
    }
  }

  // 简单模式返回
  goSimpleBack() {
    const ui = document.documentElement.getAttribute('data-ui');
    if (ui !== 'simple') return;
    if (this.state.simpleViewHistory.length > 1) {
      this.state.simpleViewHistory.pop();
      const prev = this.state.simpleViewHistory[this.state.simpleViewHistory.length - 1];
      this.state.switchView(prev, false);
      return;
    }
    this.state.setSimplePage('menu');
  }

  // 删除简单模式规则集
  async deleteSimpleRuleset(groupId) {
    if (!confirm('确定删除这个规则集吗？这会同时删除规则集中的规则。')) {
      return;
    }
    try {
      const result = await window.electronAPI.deleteRule(groupId);
      if (result && result.success) {
        this.logManager.addSuccessLog('规则集删除成功');
        await this.renderSimpleHomeRulesets();
      } else {
        this.logManager.addErrorLog(`规则集删除失败: ${result ? result.error : '未知错误'}`);
      }
    } catch (error) {
      this.logManager.addErrorLog(`规则集删除失败: ${error.message}`);
    }
  }

  // HTML转义
  escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#039;');
  }
}

export default CommunityUI;
