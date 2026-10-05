import { createLogger } from '../../services/logger.js';
const moduleLog = createLogger('扩展规则');
import Utils from '../../utils.js';

class ExtensionRulesUI {
  constructor(state, logManager) {
    this.state = state;
    this.rulesets = [];
    this.currentRulesetDetail = null;
    this.currentPage = 0;
    this.pageSize = 10;
    this.hasMorePages = false;
    this.isLoadingRulesets = false;
    this.logManager = logManager;
  }

  // 初始化扩展规则集
  initExtensionRulesets() {
    // 初始化扩展规则集相关事件监听器
    const searchInput = document.getElementById('rulesetSearchInput');
    const searchBtn = document.getElementById('searchRulesetsBtn');
    const refreshBtn = document.getElementById('refreshRulesetsBtn');
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

    // 模态框背景点击关闭
    const detailModal = document.getElementById('rulesetDetailModal');
    if (detailModal) {
      detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) {
          this.hideRulesetDetailModal();
        }
      });
    }

  }

  // 加载扩展规则集
  async loadExtensionRulesets(reset = true) {
    if (this.isLoadingRulesets) return;

    if (reset) {
      this.currentPage = 0;
      this.rulesets = [];
    }

    this.isLoadingRulesets = true;
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
        limit: this.pageSize.toString(),
        offset: (this.currentPage * this.pageSize).toString()
      });

      const response = await fetch(`https://366.cyril.qzz.io/api/rulesets?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        if (reset) {
          this.rulesets = data.data;
        } else {
          this.rulesets.push(...data.data);
        }

        // 检查已安装状态
        await this.checkInstalledStatus();

        this.hasMorePages = data.pagination.hasMore;
        this.displayRulesets();
        this.updatePaginationControls();
      } else {
        throw new Error(data.message || '获取规则集列表失败');
      }
    } catch (error) {
      moduleLog.error('加载扩展规则集失败:', error);
      this.showErrorState(error.message);
    } finally {
      this.isLoadingRulesets = false;
    }
  }

  // 显示加载状态
  showLoadingState() {
    const container = document.getElementById('rulesetsContainer');
    if (container) {
      container.innerHTML = `
        <div class="extensions-view__loading">
          <div class="extensions-view__spinner"></div>
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
        <div class="extensions-view__error">
          <i class="bi bi-exclamation-triangle"></i>
          <p>加载失败</p>
          <p class="extensions-view__error-text">${this.escapeHtml(String(message))}</p>
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

    if (this.rulesets.length === 0) {
      container.innerHTML = `
        <div class="extensions-view__empty">
          <i class="bi bi-collection"></i>
          <p>未找到规则集</p>
          <p class="text--muted">尝试调整搜索条件或刷新列表</p>
        </div>
      `;
      return;
    }

    const html = this.rulesets.map(ruleset => this.createRulesetItemHTML(ruleset)).join('');
    container.innerHTML = html;
  }

  // 检查已安装状态
  async checkInstalledStatus() {
    try {
      const localRulesets = await window.electronAPI.getRules();

      this.rulesets.forEach(ruleset => {
        const isInstalled = localRulesets.some(localGroup => {
          if ((localGroup.extensionRulesetId || localGroup.communityRulesetId) === ruleset.id) {
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
      moduleLog.error('检查安装状态失败:', error);
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
    this.loadExtensionRulesets(true);
  }

  // 刷新规则集
  refreshRulesets() {
    this.loadExtensionRulesets(true);
  }

  // 上一页
  previousPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.loadExtensionRulesets(false);
    }
  }

  // 下一页
  nextPage() {
    if (this.hasMorePages) {
      this.currentPage++;
      this.loadExtensionRulesets(false);
    }
  }

  // 更新分页控制
  updatePaginationControls() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');

    if (prevBtn) {
      prevBtn.disabled = this.currentPage === 0;
    }

    if (nextBtn) {
      nextBtn.disabled = !this.hasMorePages;
    }

    if (pageInfo) {
      pageInfo.textContent = `第 ${this.currentPage + 1} 页`;
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
        this.currentRulesetDetail = data.data;
        this.displayRulesetDetail(data.data);
        this.showRulesetDetailModal();
      } else {
        throw new Error(data.message || '获取规则集详情失败');
      }
    } catch (error) {
      moduleLog.error('获取规则集详情失败:', error);
      this.logManager.addErrorLog('获取规则集详情失败: ' + error.message, "扩展规则");
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
    if (this.currentRulesetDetail) {
      this.installRuleset(this.currentRulesetDetail.id);
    }
  }

  // 安装规则集
  async installRuleset(rulesetId) {
    const ruleset = this.rulesets.find(r => r.id === rulesetId) || this.currentRulesetDetail;
    if (!ruleset) {
      this.logManager.addErrorLog('未找到规则集信息', "扩展规则");
      return;
    }

    if (ruleset.isInstalled) {
      this.logManager.addInfoLog(`规则集 "${ruleset.name}" 已经安装`, "扩展规则");
      return;
    }

    try {
      this.logManager.addInfoLog(`开始安装规则集: ${ruleset.name}`, "扩展规则");

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
            moduleLog.error('下载注入包失败:', error);
            this.logManager.addErrorLog(`注入包下载失败: ${error.message}`, "扩展规则");
          }
        }
      }

      const extensionRulesetId = ruleset.id;

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
        communityRulesetId: extensionRulesetId, // 保留旧版持久化字段，避免重复安装
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
      this.logManager.addSuccessLog(`规则集 "${ruleset.name}" 安装成功`, "扩展规则");

      this.hideRulesetDetailModal();

    } catch (error) {
      moduleLog.error('安装规则集失败:', error);
      this.logManager.addErrorLog(`安装规则集失败: ${error.message}`, "扩展规则");
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
      moduleLog.error('下载并保存注入包失败:', error);
      throw error;
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

export default ExtensionRulesUI;
