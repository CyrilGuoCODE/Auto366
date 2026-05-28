import Utils from './utils.js';

class LogManager {
  constructor(state) {
    this.state = state;
    this.searchActive = false;
    this.currentSearchKeyword = '';
    this.currentFilter = 'all';
    // 多选状态
    this.multiSelectMode = false;
    this.selectedRequestIds = new Set();
    this.initSearchEvents();
    this.initMultiSelectEvents();
  }

  initSearchEvents() {
    const searchBtn = document.getElementById('searchLogsBtn');
    const closeBtn = document.getElementById('logSearchCloseBtn');
    const searchInput = document.getElementById('logSearchInput');
    const filterBtns = document.querySelectorAll('#logSearchFilters .btn--filter');

    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        this.toggleSearch();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hideSearch();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.executeSearch();
      });
    }

    if (filterBtns) {
      filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          filterBtns.forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          this.currentFilter = btn.dataset.filter;
          this.executeSearch();
        });
      });
    }
  }

  toggleSearch() {
    const searchBar = document.getElementById('logSearchBar');
    const searchBtn = document.getElementById('searchLogsBtn');
    if (!searchBar) return;

    if (searchBar.style.display === 'none') {
      searchBar.style.display = 'block';
      searchBtn.classList.add('is-active');
      this.searchActive = true;
      const input = document.getElementById('logSearchInput');
      if (input) {
        input.focus();
        this.executeSearch();
      }
    } else {
      this.hideSearch();
    }
  }

  hideSearch() {
    const searchBar = document.getElementById('logSearchBar');
    const searchBtn = document.getElementById('searchLogsBtn');
    if (searchBar) searchBar.style.display = 'none';
    if (searchBtn) searchBtn.classList.remove('is-active');
    this.searchActive = false;
    this.currentSearchKeyword = '';
    this.currentFilter = 'all';

    // 重置 filter 按钮
    const filterBtns = document.querySelectorAll('#logSearchFilters .btn--filter');
    filterBtns.forEach(b => b.classList.remove('is-active'));
    if (filterBtns[0]) filterBtns[0].classList.add('is-active');

    // 重置 input
    const input = document.getElementById('logSearchInput');
    if (input) input.value = '';

    // 重置 status
    const status = document.getElementById('logSearchStatus');
    if (status) status.textContent = '';

    // 显示所有日志
    this.showAllLogs();
  }

  showAllLogs(showCount = false) {
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;
    const items = trafficLog.querySelectorAll('.log-item');
    let totalCount = 0;
    items.forEach(item => {
      if (!item.textContent.includes('等待网络请求')) totalCount++;
      item.classList.remove('log-item--hidden', 'log-item__highlight');
    });
    const status = document.getElementById('logSearchStatus');
    if (status) {
      status.textContent = showCount ? `共 ${totalCount} 条` : '';
    }
  }

  executeSearch() {
    const input = document.getElementById('logSearchInput');
    const status = document.getElementById('logSearchStatus');
    if (!input) return;

    const keyword = input.value.trim().toLowerCase();
    this.currentSearchKeyword = keyword;

    if (!keyword && this.currentFilter === 'all') {
      this.showAllLogs(true);
      return;
    }

    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;

    const items = trafficLog.querySelectorAll('.log-item');
    let matchCount = 0;

    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      const type = this.getLogItemType(item);
      const requestId = item.dataset.requestId;
      const requestData = requestId ? this.state.requestDataMap.get(requestId) : null;

      // 构建可搜索的完整文本（包括请求详情）
      let searchableText = text;
      if (requestData) {
        const details = [
          requestData.method || '',
          requestData.url || '',
          requestData.responseBody || '',
          requestData.requestBody || '',
          JSON.stringify(requestData.requestHeaders || ''),
          JSON.stringify(requestData.responseHeaders || '')
        ].join(' ');
        searchableText += ' ' + details.toLowerCase();
      }

      // 类型过滤
      let typeMatch = this.currentFilter === 'all';
      if (this.currentFilter === 'request' && item.classList.contains('log-item--clickable')) typeMatch = true;
      if (this.currentFilter === 'success' && (item.classList.contains('log-item--success') || item.classList.contains('log-item--rule-success'))) typeMatch = true;
      if (this.currentFilter === 'error' && (item.classList.contains('log-item--error') || item.classList.contains('log-item--rule-error'))) typeMatch = true;
      if (this.currentFilter === 'info' && item.classList.contains('log-item--important') && !item.classList.contains('log-item--clickable')) typeMatch = true;

      // 关键词过滤
      let keywordMatch = true;
      if (keyword) {
        keywordMatch = searchableText.includes(keyword);
      }

      if (typeMatch && keywordMatch) {
        item.classList.remove('log-item--hidden');
        if (keyword) {
          item.classList.add('log-item__highlight');
        } else {
          item.classList.remove('log-item__highlight');
        }
        matchCount++;
      } else {
        item.classList.add('log-item--hidden');
        item.classList.remove('log-item__highlight');
      }
    });

    if (status) {
      status.textContent = keyword ? `找到 ${matchCount} 条结果` : `共 ${matchCount} 条`;
    }
  }

  getLogItemType(item) {
    if (item.classList.contains('log-item--clickable')) return 'request';
    if (item.classList.contains('log-item--success') || item.classList.contains('log-item--rule-success')) return 'success';
    if (item.classList.contains('log-item--error') || item.classList.contains('log-item--rule-error')) return 'error';
    return 'info';
  }

  // 添加流量日志
  addTrafficLog(data) {
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    const method = data.method || 'GET';
    const status = data.statusCode || data.status || '';
    const url = Utils.formatUrl(data.url);
    const size = data.bodySize ? Utils.formatFileSize(data.bodySize) : '';

    // 生成唯一ID
    const requestId = data.uuid || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 存储完整的请求数据
    this.state.requestDataMap.set(requestId, data);

    let logText = `${method} ${url}`;
    if (status) logText += ` - ${status}`;
    if (size) logText += ` (${size})`;

    let logType = 'normal';
    let iconClass = 'bi-globe';

    if (data.important) {
      logType = 'important';
      iconClass = 'bi-star-fill';
    } else if (status >= 400) {
      logType = 'error';
      iconClass = 'bi-x-circle';
    } else if (status >= 200 && status < 300) {
      logType = 'success';
      iconClass = 'bi-check-circle';
    }

    this.addLogItem(logText, logType, iconClass, requestId, timestamp);
  }

  // 添加重要日志
  addImportantLog(data) {
    const logText = `[重要] ${data.url} - 包含关键数据`;
    this.addLogItem(logText, 'important', 'bi-star-fill', null, null);
  }

  // 添加成功日志
  addSuccessLog(message) {
    this.addLogItem(`${message}`, 'success', 'bi-check-circle', null, null);
  }

  // 添加错误日志
  addErrorLog(message) {
    this.addLogItem(`${message}`, 'error', 'bi-x-circle', null, null);
  }

  // 添加信息日志
  addInfoLog(message) {
    this.addLogItem(`${message}`, 'normal', 'bi-info-circle', null, null);
  }

  // 添加规则日志
  addRuleLog(data) {
    const iconClass = data.type === 'success' ? 'bi-gear-fill' : 'bi-exclamation-triangle-fill';
    const logType = data.type === 'success' ? 'rule-success' : 'rule-error';

    let message = data.message;
    if (data.details) {
      message += ` (${data.details})`;
    }

    this.addLogItem(message, logType, iconClass, null, null);
  }

  // 添加日志项
  addLogItem(text, type, iconClass = 'bi-circle', requestId = null, timestamp = null) {
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;

    const logItem = document.createElement('div');
    const displayTimestamp = timestamp || new Date().toLocaleTimeString();

    if (requestId) {
      logItem.className = `log-item log-item--${type} log-item--clickable`;
      logItem.dataset.requestId = requestId;

      const checkboxHtml = this.multiSelectMode
        ? `<input type="checkbox" class="log-item__checkbox" data-ms-checkbox="${requestId}">`
        : '';

      logItem.innerHTML = `
        <div class="log-item__time">${displayTimestamp}</div>
        ${checkboxHtml}
        <i class="${iconClass}"></i>
        <span class="log-item__text">${text}</span>
      `;

      // 如果该项之前在选择集合里，恢复勾选状态
      if (this.multiSelectMode && this.selectedRequestIds.has(requestId)) {
        const cb = logItem.querySelector('input[data-ms-checkbox]');
        if (cb) cb.checked = true;
        logItem.classList.add('log-item--checked');
      }

      logItem.addEventListener('click', (e) => {
        // 多选模式：点击切换勾选，而非打开详情
        if (this.multiSelectMode) {
          // 如果直接点中 checkbox，让浏览器处理；其他位置由我们 toggle
          if (e.target && e.target.matches('input[data-ms-checkbox]')) return;
          this.toggleItemSelection(logItem, requestId);
          return;
        }

        this.showRequestDetails(requestId);

        if (this.state.selectedLogItem) {
          this.state.selectedLogItem.classList.remove('log-item--selected');
        }
        logItem.classList.add('log-item--selected');
        this.state.selectedLogItem = logItem;
      });

      // 在多选模式下，checkbox 本身的 change 事件同步状态
      const cb = logItem.querySelector('input[data-ms-checkbox]');
      if (cb) {
        cb.addEventListener('click', (e) => e.stopPropagation()); // 防止冒泡到 logItem 又 toggle 一次
        cb.addEventListener('change', () => {
          if (cb.checked) {
            this.selectedRequestIds.add(requestId);
            logItem.classList.add('log-item--checked');
          } else {
            this.selectedRequestIds.delete(requestId);
            logItem.classList.remove('log-item--checked');
          }
          this.updateMultiSelectStatus();
        });
      }
    } else {
      logItem.className = `log-item log-item--${type}`;
      logItem.innerHTML = `
        <div class="log-item__time">${displayTimestamp}</div>
        <i class="${iconClass}"></i>
        <span class="log-item__text">${text}</span>
      `;
    }

    const firstItem = trafficLog.querySelector('.log-item');
    if (firstItem && firstItem.textContent.includes('等待网络请求')) {
      trafficLog.removeChild(firstItem);
    }

    trafficLog.appendChild(logItem);

    const logItems = trafficLog.querySelectorAll('.log-item');
    if (logItems.length > 200) {
      const removedItem = logItems[0];
      if (removedItem.dataset.requestId) {
        this.state.requestDataMap.delete(removedItem.dataset.requestId);
        // 同步清理多选集合
        if (this.selectedRequestIds.has(removedItem.dataset.requestId)) {
          this.selectedRequestIds.delete(removedItem.dataset.requestId);
          if (this.multiSelectMode) this.updateMultiSelectStatus();
        }
      }
      trafficLog.removeChild(removedItem);
    }

    trafficLog.scrollTop = trafficLog.scrollHeight;

    this.updateRequestCount();

    if (this.searchActive) {
      this.executeSearch();
    }
  }

  // 更新请求计数
  updateRequestCount() {
    const trafficLog = document.getElementById('trafficLog');
    const requestCountElement = document.getElementById('requestCount');

    if (trafficLog && requestCountElement) {
      const logItems = trafficLog.querySelectorAll('.log-item');
      let requestCount = 0;

      logItems.forEach(item => {
        if (!item.textContent.includes('等待网络请求')) {
          requestCount++;
        }
      });

      requestCountElement.textContent = requestCount;
    }
  }

  // 显示请求详情
  showRequestDetails(requestId) {
    const requestData = this.state.requestDataMap.get(requestId);
    if (!requestData) return;

    const detailsPanel = document.getElementById('requestDetails');
    const detailsResizer = document.getElementById('detailsResizer');
    const detailsContent = document.getElementById('detailsContent');

    // 显示详情面板
    detailsPanel.style.display = 'flex';
    detailsResizer.style.display = 'block';

    // 从localStorage恢复保存的宽度比例
    const savedMonitorFlex = localStorage.getItem('trafficMonitorFlex') || '1';
    const savedDetailsFlex = localStorage.getItem('requestDetailsFlex') || '1';

    const trafficMonitor = document.getElementById('trafficMonitor');
    trafficMonitor.style.flex = savedMonitorFlex;
    detailsPanel.style.flex = savedDetailsFlex;

    // 生成详情内容
    let html = '';

    // 基本信息
    html += `
      <div class="log-detail__section">
        <h5>基本信息</h5>
        <div class="log-detail__item">
          <span class="log-detail__label">方法:</span>
          <span class="log-detail__value">${requestData.method || 'GET'}</span>
        </div>
        <div class="log-detail__item">
          <span class="log-detail__label">URL:</span>
          <span class="log-detail__value">${requestData.url || ''}</span>
        </div>
        <div class="log-detail__item">
          <span class="log-detail__label">状态码:</span>
          <span class="log-detail__value">${requestData.statusCode || requestData.status || '未知'}</span>
        </div>
        <div class="log-detail__item">
          <span class="log-detail__label">时间:</span>
          <span class="log-detail__value">${new Date(requestData.timestamp).toLocaleString()}</span>
        </div>
        ${requestData.bodySize ? `
        <div class="log-detail__item">
          <span class="log-detail__label">大小:</span>
          <span class="log-detail__value">${Utils.formatFileSize(requestData.bodySize)}</span>
        </div>
        ` : ''}
      </div>
    `;

    // 请求头
    if (requestData.requestHeaders) {
      html += `
        <div class="log-detail__section">
          <h5>请求头</h5>
          <div class="log-detail__json">${Utils.formatHeaders(requestData.requestHeaders)}</div>
        </div>
      `;
    }

    // 请求体
    if (requestData.requestBody) {
      html += `
        <div class="log-detail__section">
          <h5>请求体</h5>
          <div class="log-detail__json">${Utils.formatBody(requestData.requestBody, true)}</div>
        </div>
      `;
    }

    // 响应头
    if (requestData.responseHeaders) {
      html += `
        <div class="log-detail__section">
          <h5>响应头</h5>
          <div class="log-detail__json">${Utils.formatHeaders(requestData.responseHeaders)}</div>
        </div>
      `;
    }

    // 响应体
    if (requestData.responseBody) {
      html += `
        <div class="log-detail__section">
          <h5>响应体</h5>
          <div class="log-detail__json">${Utils.formatBody(requestData.responseBody, true)}</div>
        </div>
      `;
    }

    // 下载按钮（如果有UUID）
    if (requestData.uuid) {
      html += `
        <div class="log-detail__section">
          <h5>操作</h5>
          <button class="btn--download" data-download-uuid="${requestData.uuid}">
            <i class="bi bi-download"></i>
            <span>下载响应文件</span>
          </button>
        </div>
      `;
    }

    detailsContent.innerHTML = html;
  }

  // 隐藏请求详情
  hideRequestDetails() {
    const detailsPanel = document.getElementById('requestDetails');
    const detailsResizer = document.getElementById('detailsResizer');

    detailsPanel.style.display = 'none';
    detailsResizer.style.display = 'none';

    // 重置流量监控器的flex
    const trafficMonitor = document.getElementById('trafficMonitor');
    trafficMonitor.style.flex = '1';

    // 清除选中状态
    if (this.state.selectedLogItem) {
      this.state.selectedLogItem.classList.remove('log-item--selected');
      this.state.selectedLogItem = null;
    }
  }

  // 清空日志
  clearLogs() {
    const trafficLog = document.getElementById('trafficLog');
    if (trafficLog) {
      trafficLog.innerHTML = `
        <div class="log-item">
          <i class="bi bi-hourglass-split"></i>
          <span>等待网络请求...</span>
        </div>
      `;
    }

    // 清空请求数据映射
    this.state.requestDataMap.clear();

    // 清空多选状态（但保持多选模式）
    this.selectedRequestIds.clear();
    if (this.multiSelectMode) {
      this.updateMultiSelectStatus();
    }

    // 隐藏详情面板
    this.hideRequestDetails();

    // 重置请求计数
    this.updateRequestCount();

    // 重置搜索状态
    if (this.searchActive) {
      const status = document.getElementById('logSearchStatus');
      if (status) status.textContent = '共 0 条结果';
    }

    this.addInfoLog('日志已清空');
  }

  // 显示文件结构
  displayFileStructure(data) {
    this.addInfoLog(`文件结构分析完成，解压目录: ${data.extractDir}`);

    if (data.structure && data.structure.length > 0) {
      const structureText = Utils.formatFileStructure(data.structure);
      this.addLogItem(`文件结构:\n${structureText}`, 'detail', 'bi-folder', null, null);
    }
  }

  // 显示处理文件结果
  displayProcessedFiles(data) {
    this.addInfoLog(`文件处理完成，共处理 ${data.processedFiles.length} 个文件，提取到 ${data.totalAnswers} 个答案`);

    if (data.processedFiles && data.processedFiles.length > 0) {
      data.processedFiles.forEach(file => {
        const fileName = file.file || file.name || '未知文件';
        const answerCount = file.answerCount || file.answers || 0;
        this.addLogItem(`处理文件: ${fileName} - 提取 ${answerCount} 个答案`, 'success', 'bi-file-check', null, null);
      });
    }

    // 输出答案文件位置
    if (data.file) {
      this.addSuccessLog(`答案文件已保存到: ${data.file}`);
    }
  }

  // ==================== 多选模式 ====================

  initMultiSelectEvents() {
    const toggleBtn = document.getElementById('multiSelectLogsBtn');
    const cancelBtn = document.getElementById('logMsCancelBtn');
    const selectAllBtn = document.getElementById('logMsSelectAllBtn');
    const selectReqBtn = document.getElementById('logMsSelectRequestsBtn');
    const invertBtn = document.getElementById('logMsInvertBtn');
    const clearBtn = document.getElementById('logMsClearBtn');
    const exportBtn = document.getElementById('logMsExportBtn');

    if (toggleBtn) toggleBtn.addEventListener('click', () => this.toggleMultiSelect());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.exitMultiSelect());
    if (selectAllBtn) selectAllBtn.addEventListener('click', () => this.selectAllVisible(false));
    if (selectReqBtn) selectReqBtn.addEventListener('click', () => this.selectAllVisible(true));
    if (invertBtn) invertBtn.addEventListener('click', () => this.invertSelection());
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearSelection());
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportSelected());
  }

  toggleMultiSelect() {
    if (this.multiSelectMode) {
      this.exitMultiSelect();
    } else {
      this.enterMultiSelect();
    }
  }

  enterMultiSelect() {
    this.multiSelectMode = true;
    this.selectedRequestIds.clear();

    const bar = document.getElementById('logMultiSelectBar');
    const btn = document.getElementById('multiSelectLogsBtn');
    const trafficLog = document.getElementById('trafficLog');

    if (bar) bar.style.display = 'block';
    if (btn) btn.classList.add('is-active');
    if (trafficLog) trafficLog.classList.add('is-multiselect');

    // 隐藏详情面板（如果开着的话），多选模式下不需要
    this.hideRequestDetails();

    // 给所有已经存在的可点击日志项注入 checkbox
    this.renderCheckboxesForExistingItems();
    this.updateMultiSelectStatus();
  }

  exitMultiSelect() {
    this.multiSelectMode = false;
    this.selectedRequestIds.clear();

    const bar = document.getElementById('logMultiSelectBar');
    const btn = document.getElementById('multiSelectLogsBtn');
    const trafficLog = document.getElementById('trafficLog');

    if (bar) bar.style.display = 'none';
    if (btn) btn.classList.remove('is-active');
    if (trafficLog) trafficLog.classList.remove('is-multiselect');

    // 移除所有 checkbox 和高亮
    this.removeCheckboxesFromExistingItems();
  }

  renderCheckboxesForExistingItems() {
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;
    const items = trafficLog.querySelectorAll('.log-item--clickable');
    items.forEach(item => {
      if (item.querySelector('.log-item__checkbox')) return; // 已有
      const reqId = item.dataset.requestId;
      if (!reqId) return;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'log-item__checkbox';
      cb.dataset.msCheckbox = reqId;
      // 插到时间之后、图标之前
      const timeEl = item.querySelector('.log-item__time');
      if (timeEl && timeEl.nextSibling) {
        item.insertBefore(cb, timeEl.nextSibling);
      } else {
        item.insertBefore(cb, item.firstChild);
      }
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) {
          this.selectedRequestIds.add(reqId);
          item.classList.add('log-item--checked');
        } else {
          this.selectedRequestIds.delete(reqId);
          item.classList.remove('log-item--checked');
        }
        this.updateMultiSelectStatus();
      });
    });
  }

  removeCheckboxesFromExistingItems() {
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;
    trafficLog.querySelectorAll('.log-item__checkbox').forEach(cb => cb.remove());
    trafficLog.querySelectorAll('.log-item--checked').forEach(it => it.classList.remove('log-item--checked'));
  }

  toggleItemSelection(logItem, requestId) {
    const cb = logItem.querySelector('input[data-ms-checkbox]');
    if (!cb) return;
    cb.checked = !cb.checked;
    if (cb.checked) {
      this.selectedRequestIds.add(requestId);
      logItem.classList.add('log-item--checked');
    } else {
      this.selectedRequestIds.delete(requestId);
      logItem.classList.remove('log-item--checked');
    }
    this.updateMultiSelectStatus();
  }

  // mode=true 只选请求条目（有 requestId 的）；mode=false 全选可见可勾选项
  // 由于不可点击的项压根没 checkbox，二者实际是一样的，只是 UI 措辞不同
  selectAllVisible(onlyRequests = false) {
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;
    const items = trafficLog.querySelectorAll('.log-item--clickable');
    items.forEach(item => {
      if (item.classList.contains('log-item--hidden')) return;
      const reqId = item.dataset.requestId;
      if (!reqId) return;
      const cb = item.querySelector('input[data-ms-checkbox]');
      if (cb && !cb.checked) {
        cb.checked = true;
        this.selectedRequestIds.add(reqId);
        item.classList.add('log-item--checked');
      }
    });
    this.updateMultiSelectStatus();
  }

  invertSelection() {
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;
    const items = trafficLog.querySelectorAll('.log-item--clickable');
    items.forEach(item => {
      if (item.classList.contains('log-item--hidden')) return;
      const reqId = item.dataset.requestId;
      if (!reqId) return;
      const cb = item.querySelector('input[data-ms-checkbox]');
      if (!cb) return;
      cb.checked = !cb.checked;
      if (cb.checked) {
        this.selectedRequestIds.add(reqId);
        item.classList.add('log-item--checked');
      } else {
        this.selectedRequestIds.delete(reqId);
        item.classList.remove('log-item--checked');
      }
    });
    this.updateMultiSelectStatus();
  }

  clearSelection() {
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;
    trafficLog.querySelectorAll('input[data-ms-checkbox]').forEach(cb => { cb.checked = false; });
    trafficLog.querySelectorAll('.log-item--checked').forEach(it => it.classList.remove('log-item--checked'));
    this.selectedRequestIds.clear();
    this.updateMultiSelectStatus();
  }

  updateMultiSelectStatus() {
    const status = document.getElementById('logMsStatus');
    if (!status) return;
    const n = this.selectedRequestIds.size;
    status.textContent = n === 0 ? '未选择' : `已选 ${n} 条`;
  }

  exportSelected() {
    if (this.selectedRequestIds.size === 0) {
      this.addErrorLog('未选择任何请求，无法导出');
      return;
    }

    const arr = [];
    this.selectedRequestIds.forEach(reqId => {
      const data = this.state.requestDataMap.get(reqId);
      if (!data) return;
      // 收集最有用的字段，便于协议分析
      arr.push({
        timestamp: data.timestamp || null,
        method: data.method || 'GET',
        url: data.url || '',
        statusCode: data.statusCode || data.status || null,
        requestHeaders: data.requestHeaders || null,
        requestBody: this.tryParseMaybeJson(data.requestBody),
        responseHeaders: data.responseHeaders || null,
        responseBody: this.tryParseMaybeJson(data.responseBody),
        bodySize: data.bodySize || null,
        uuid: data.uuid || null
      });
    });

    // 按时间排序
    arr.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    const jsonStr = JSON.stringify(arr, null, 2);

    // 一份扔剪贴板，一份触发文件下载
    let clipboardOk = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonStr)
        .then(() => { clipboardOk = true; })
        .catch(() => { /* 忽略，下载兜底 */ });
    }

    try {
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fname = `auto366-logs-${this.timestampForFile()}.json`;
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.addSuccessLog(`已导出 ${arr.length} 条请求到 ${fname}${clipboardOk ? '（并已复制到剪贴板）' : ''}`);
    } catch (e) {
      this.addErrorLog('导出失败: ' + (e.message || e));
    }
  }

  // 请求/响应体是字符串里包JSON很常见，尽量解析成对象，让导出的 JSON 直接可读、可被脚本处理
  tryParseMaybeJson(body) {
    if (body == null) return null;
    if (typeof body === 'object') return body;
    if (typeof body !== 'string') return String(body);
    const trimmed = body.trim();
    if (!trimmed) return '';
    // 只在看起来像 JSON 时才解析
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch (_) {
        return body;
      }
    }
    return body;
  }

  timestampForFile() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
}

export default LogManager;
