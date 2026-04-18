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
        <div class="loading-state">
          <div class="loading-spinner"></div>
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
        <div class="error-state">
          <i class="bi bi-exclamation-triangle"></i>
          <p>加载失败</p>
          <p class="error-message">${message}</p>
          <button class="primary-btn" onclick="universalAnswerFeature.refreshRulesets()">
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
        <div class="no-rulesets">
          <i class="bi bi-collection"></i>
          <p>未找到规则集</p>
          <p class="text-muted">尝试调整搜索条件或刷新列表</p>
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
      // 获取本地所有规则集
      const localRules = await window.electronAPI.getRules();
      const localRuleGroups = localRules.filter(rule => rule.isGroup);

      // 为每个社区规则集检查是否已安装
      this.state.communityRulesets.forEach(ruleset => {
        // 通过多种方式匹配判断是否已安装
        const isInstalled = localRuleGroups.some(localGroup => {
          // 方式1: 通过社区规则集ID匹配（最准确）
          if (localGroup.communityRulesetId === ruleset.id) {
            return true;
          }

          // 方式2: 通过名称和作者匹配
          if (localGroup.name === ruleset.name && localGroup.author === ruleset.author) {
            return true;
          }

          // 方式3: 通过名称匹配（兼容旧数据）
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
        <div class="ruleset-item ${isInstalled ? 'installed' : ''}">
          <div class="ruleset-header">
            <div class="ruleset-info">
              <div class="ruleset-name">
                ${Utils.escapeHtml(ruleset.name)}
                ${isInstalled ? '<span class="installed-badge"><i class="bi bi-check-circle"></i> 已安装</span>' : ''}
              </div>
              <div class="ruleset-description">${Utils.escapeHtml(ruleset.description || '暂无描述')}</div>
            </div>
            <div class="ruleset-actions">
              <button class="install-btn ${isInstalled ? 'installed' : ''}" 
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
      <div class="ruleset-item ${isInstalled ? 'installed' : ''}" onclick="universalAnswerFeature.showRulesetDetail('${ruleset.id}')">
        <div class="ruleset-header">
          <div class="ruleset-info">
            <div class="ruleset-name">
              ${Utils.escapeHtml(ruleset.name)}
              ${isInstalled ? '<span class="installed-badge"><i class="bi bi-check-circle"></i> 已安装</span>' : ''}
            </div>
            <div class="ruleset-author">作者: ${Utils.escapeHtml(ruleset.author)}</div>
            <div class="ruleset-description">${Utils.escapeHtml(ruleset.description || '暂无描述')}</div>
            <div class="ruleset-meta">
              <div class="ruleset-downloads">
                <i class="bi bi-download"></i>
                <span>${downloadCount} 次下载</span>
              </div>
              <div class="ruleset-date">${createdDate}</div>
            </div>
            <div class="ruleset-tags">
              ${hasInjection ? '<span class="ruleset-tag has-injection">包含注入文件</span>' : ''}
              <span class="ruleset-tag">已审核</span>
            </div>
          </div>
          <div class="ruleset-actions" onclick="event.stopPropagation()">
            <button class="view-details-btn" onclick="universalAnswerFeature.showRulesetDetail('${ruleset.id}')">
              <i class="bi bi-eye"></i>
              <span>查看详情</span>
            </button>
            <button class="install-btn ${isInstalled ? 'installed' : ''}" 
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
        <div class="file-item">
          <div class="file-info">
            <i class="file-icon bi ${Utils.getFileIcon(file.type)}"></i>
            <span class="file-name">${Utils.escapeHtml(file.name)}</span>
          </div>
          <span class="file-size">${Utils.formatFileSize(file.size)}</span>
        </div>
      `).join('');
    }

    content.innerHTML = `
      <div class="detail-header">
        <div class="detail-title">${Utils.escapeHtml(ruleset.name)}</div>
        <div class="detail-author">作者: ${Utils.escapeHtml(ruleset.author)}</div>
        <div class="detail-description">${Utils.escapeHtml(ruleset.description || '暂无描述')}</div>
        <div class="detail-stats">
          <div class="detail-stat">
            <i class="bi bi-download"></i>
            <span>${downloadCount} 次下载</span>
          </div>
          <div class="detail-stat">
            <i class="bi bi-calendar"></i>
            <span>${createdDate}</span>
          </div>
          <div class="detail-stat">
            <i class="bi bi-files"></i>
            <span>${fileCount} 个文件</span>
          </div>
          <div class="detail-stat">
            <i class="bi bi-hdd"></i>
            <span>${totalSize}</span>
          </div>
        </div>
      </div>
      ${filesHTML ? `
        <div class="detail-files">
          <h4>包含文件</h4>
          <div class="file-list">
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

    // 如果已安装，不允许重复安装
    if (ruleset.isInstalled) {
      this.logManager.addInfoLog(`规则集 "${ruleset.name}" 已经安装`);
      return;
    }

    try {
      this.logManager.addInfoLog(`开始安装规则集: ${ruleset.name}`);

      // 下载规则文件
      const jsonUrl = ruleset.file_urls.find(url => url.includes('.json'));
      if (!jsonUrl) {
        throw new Error('未找到规则文件');
      }

      const response = await fetch(jsonUrl);
      if (!response.ok) {
        throw new Error(`下载规则文件失败: HTTP ${response.status}`);
      }

      let rulesData = await response.json();

      // 如果有注入文件，先下载并处理路径
      if (ruleset.has_injection_package) {
        const zipUrl = ruleset.file_urls.find(url => url.includes('.zip'));
        if (zipUrl) {
          try {
            const localZipPath = await this.downloadAndSaveInjectionPackage(zipUrl, ruleset.name);

            // 更新规则数据中的ZIP路径
            let rulesToUpdate = [];
            if (Array.isArray(rulesData)) {
              // 纯JSON格式：直接是规则数组
              rulesToUpdate = rulesData;
            } else if (rulesData.rules) {
              // 包含rules的对象格式
              rulesToUpdate = rulesData.rules;
            }

            // 替换ZIP路径
            rulesToUpdate.forEach(rule => {
              if (rule.type === 'zip-implant' && rule.zipImplant) {
                rule.zipImplant = localZipPath;
              }
            });
          } catch (error) {
            console.error('下载注入包失败:', error);
            this.logManager.addErrorLog(`注入包下载失败: ${error.message}`);
            // 继续安装规则，但不包含注入包
          }
        }
      }

      // 为规则集添加社区标识
      const communityRulesetId = ruleset.id;
      let rulesToSave = [];

      if (Array.isArray(rulesData)) {
        // 纯JSON格式：直接是规则数组
        rulesToSave = rulesData.map(rule => {
          if (rule.isGroup) {
            return {
              ...rule,
              communityRulesetId: communityRulesetId
            };
          }
          return rule;
        });
      } else if (rulesData.rules) {
        // 包含rules的对象格式
        rulesToSave = rulesData.rules.map(rule => {
          if (rule.isGroup) {
            return {
              ...rule,
              communityRulesetId: communityRulesetId
            };
          }
          return rule;
        });
      } else if (rulesData.isGroup) {
        // 单个规则集对象
        rulesToSave = [{
          ...rulesData,
          communityRulesetId: communityRulesetId
        }];
      }

      // 保存规则到本地
      for (const rule of rulesToSave) {
        try {
          const result = await window.electronAPI.saveRule(rule);
          if (!result.success) {
            this.logManager.addErrorLog(`保存规则失败: ${result.error}`);
          }
        } catch (error) {
          this.logManager.addErrorLog(`保存规则失败: ${error.message}`);
        }
      }

      // 重新检查安装状态
      await this.checkInstalledStatus();
      this.displayRulesets();
      this.logManager.addSuccessLog(`规则集 "${ruleset.name}" 安装成功`);

      // 隐藏详情模态框
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
  showUploadRulesetModal() {
    const modal = document.getElementById('uploadRulesetModal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  // 隐藏上传规则集模态框
  hideUploadRulesetModal() {
    const modal = document.getElementById('uploadRulesetModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  // 提交上传规则集
  async submitUploadRuleset() {
    const rulesetSelect = document.getElementById('uploadRulesetSelect');
    const rulesetName = document.getElementById('rulesetName').value.trim();
    const rulesetDescription = document.getElementById('rulesetDescription').value.trim();

    if (!rulesetSelect.files || rulesetSelect.files.length === 0) {
      this.logManager.addErrorLog('请选择规则集文件');
      return;
    }

    if (!rulesetName) {
      this.logManager.addErrorLog('请输入规则集名称');
      return;
    }

    try {
      this.logManager.addInfoLog('正在上传规则集...');

      const file = rulesetSelect.files[0];
      const formData = new FormData();
      formData.append('ruleset', file);
      formData.append('name', rulesetName);
      formData.append('description', rulesetDescription);

      const response = await fetch('https://366.cyril.qzz.io/api/rulesets/upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        this.logManager.addSuccessLog('规则集上传成功，等待审核');
        this.hideUploadRulesetModal();
        this.refreshRulesets();
      } else {
        this.logManager.addErrorLog(`上传失败: ${data.message}`);
      }
    } catch (error) {
      console.error('上传规则集失败:', error);
      this.logManager.addErrorLog(`上传失败: ${error.message}`);
    }
  }

  // 规则集选择变化
  onRulesetSelectChange() {
    const rulesetSelect = document.getElementById('uploadRulesetSelect');
    const fileNameDisplay = document.getElementById('fileNameDisplay');

    if (rulesetSelect.files && rulesetSelect.files.length > 0) {
      fileNameDisplay.textContent = rulesetSelect.files[0].name;
    } else {
      fileNameDisplay.textContent = '未选择文件';
    }
  }
}

export default CommunityUI;
