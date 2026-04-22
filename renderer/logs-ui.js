import Utils from './utils.js';

class LogManager {
  constructor(state) {
    this.state = state;
    this.searchActive = false;
    this.currentSearchKeyword = '';
    this.currentFilter = 'all';
    this.initSearchEvents();
  }

  initSearchEvents() {
    const searchBtn = document.getElementById('searchLogsBtn');
    const closeBtn = document.getElementById('logSearchCloseBtn');
    const searchInput = document.getElementById('logSearchInput');
    const filterBtns = document.querySelectorAll('#logSearchFilters .filter-btn');

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
          filterBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
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
      searchBtn.classList.add('active');
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
    if (searchBtn) searchBtn.classList.remove('active');
    this.searchActive = false;
    this.currentSearchKeyword = '';
    this.currentFilter = 'all';

    // 重置 filter 按钮
    const filterBtns = document.querySelectorAll('#logSearchFilters .filter-btn');
    filterBtns.forEach(b => b.classList.remove('active'));
    if (filterBtns[0]) filterBtns[0].classList.add('active');

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
      item.classList.remove('log-item-hidden', 'highlight-match');
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
      if (this.currentFilter === 'request' && item.classList.contains('clickable')) typeMatch = true;
      if (this.currentFilter === 'success' && (item.classList.contains('success') || item.classList.contains('rule-success'))) typeMatch = true;
      if (this.currentFilter === 'error' && (item.classList.contains('error') || item.classList.contains('rule-error'))) typeMatch = true;
      if (this.currentFilter === 'info' && (item.classList.contains('normal') || item.classList.contains('important')) && !item.classList.contains('clickable')) typeMatch = true;

      // 关键词过滤
      let keywordMatch = true;
      if (keyword) {
        keywordMatch = searchableText.includes(keyword);
      }

      if (typeMatch && keywordMatch) {
        item.classList.remove('log-item-hidden');
        if (keyword) {
          item.classList.add('highlight-match');
        } else {
          item.classList.remove('highlight-match');
        }
        matchCount++;
      } else {
        item.classList.add('log-item-hidden');
        item.classList.remove('highlight-match');
      }
    });

    if (status) {
      status.textContent = keyword ? `找到 ${matchCount} 条结果` : `共 ${matchCount} 条`;
    }
  }

  getLogItemType(item) {
    if (item.classList.contains('clickable')) return 'request';
    if (item.classList.contains('success') || item.classList.contains('rule-success')) return 'success';
    if (item.classList.contains('error') || item.classList.contains('rule-error')) return 'error';
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
      logItem.className = `log-item ${type} clickable`;
      logItem.dataset.requestId = requestId;

      logItem.innerHTML = `
        <div class="log-time">${displayTimestamp}</div>
        <i class="${iconClass}"></i>
        <span class="log-text">${text}</span>
      `;

      logItem.addEventListener('click', () => {
        this.showRequestDetails(requestId);

        if (this.state.selectedLogItem) {
          this.state.selectedLogItem.classList.remove('selected');
        }
        logItem.classList.add('selected');
        this.state.selectedLogItem = logItem;
      });
    } else {
      logItem.className = `log-item ${type}`;
      logItem.innerHTML = `
        <div class="log-time">${displayTimestamp}</div>
        <i class="${iconClass}"></i>
        <span class="log-text">${text}</span>
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
      <div class="detail-section">
        <h5>基本信息</h5>
        <div class="detail-item">
          <span class="detail-label">方法:</span>
          <span class="detail-value">${requestData.method || 'GET'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">URL:</span>
          <span class="detail-value">${requestData.url || ''}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">状态码:</span>
          <span class="detail-value">${requestData.statusCode || requestData.status || '未知'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">时间:</span>
          <span class="detail-value">${new Date(requestData.timestamp).toLocaleString()}</span>
        </div>
        ${requestData.bodySize ? `
        <div class="detail-item">
          <span class="detail-label">大小:</span>
          <span class="detail-value">${Utils.formatFileSize(requestData.bodySize)}</span>
        </div>
        ` : ''}
      </div>
    `;

    // 请求头
    if (requestData.requestHeaders) {
      html += `
        <div class="detail-section">
          <h5>请求头</h5>
          <div class="detail-json">${Utils.formatHeaders(requestData.requestHeaders)}</div>
        </div>
      `;
    }

    // 请求体
    if (requestData.requestBody) {
      html += `
        <div class="detail-section">
          <h5>请求体</h5>
          <div class="detail-json">${Utils.formatBody(requestData.requestBody, true)}</div>
        </div>
      `;
    }

    // 响应头
    if (requestData.responseHeaders) {
      html += `
        <div class="detail-section">
          <h5>响应头</h5>
          <div class="detail-json">${Utils.formatHeaders(requestData.responseHeaders)}</div>
        </div>
      `;
    }

    // 响应体
    if (requestData.responseBody) {
      html += `
        <div class="detail-section">
          <h5>响应体</h5>
          <div class="detail-json">${Utils.formatBody(requestData.responseBody, true)}</div>
        </div>
      `;
    }

    // 下载按钮（如果有UUID）
    if (requestData.uuid) {
      html += `
        <div class="detail-section">
          <h5>操作</h5>
          <button class="download-response-btn" data-download-uuid="${requestData.uuid}">
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
      this.state.selectedLogItem.classList.remove('selected');
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
}

export default LogManager;
