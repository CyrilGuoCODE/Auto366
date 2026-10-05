import detailsMethods from './details.js';
import Utils from '../../utils.js';
import { prefix, record } from '../../services/logger.js';

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
        this.scheduleSearch();
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
      if (this.currentFilter === 'info' && this.getLogItemType(item) === 'info') typeMatch = true;

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

  scheduleSearch() {
    if (this.searchTimer) return;
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      if (this.searchActive) this.executeSearch();
    }, 80);
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

    let safeUrl = '';
    try { const parsed = new URL(data.url); safeUrl = parsed.origin + parsed.pathname; } catch { safeUrl = '(无效地址)'; }
    this.addLogItem(logText, logType, iconClass, requestId, timestamp, !!data.ruleMatched, {
      module: '网络', recordText: `${method} ${safeUrl} - ${status} ${size}`
    });
  }

  // 添加重要日志
  addImportantLog(data) {
    const logText = `[重要] ${data.url} - 包含关键数据`;
    this.addLogItem(logText, 'important', 'bi-star-fill', null, null, false, { module: '网络', recordText: '检测到包含关键数据的请求' });
  }

  // 添加成功日志
  addSuccessLog(message, moduleName = '界面') {
    this.addLogItem(`${message}`, 'success', 'bi-check-circle', null, null, false, { module: moduleName });
  }

  // 添加错误日志
  addErrorLog(message, moduleName = '界面') {
    this.addLogItem(`${message}`, 'error', 'bi-x-circle', null, null, false, { module: moduleName });
  }

  // 添加信息日志
  addInfoLog(message, moduleName = '界面') {
    this.addLogItem(`${message}`, 'normal', 'bi-info-circle', null, null, false, { module: moduleName });
  }

  // 添加规则日志
  addRuleLog(data) {
    const iconClass = ({ success: 'bi-gear-fill', error: 'bi-exclamation-triangle-fill', warning: 'bi-exclamation-triangle', info: 'bi-info-circle' })[data.type] || 'bi-info-circle';
    const logType = ({ success: 'rule-success', error: 'rule-error', warning: 'warning', info: 'normal' })[data.type] || 'normal';

    let message = data.message;
    if (data.details) {
      message += ` (${data.details})`;
    }

    this.addLogItem(message, logType, iconClass, null, null, false, { module: data.module || '规则', recorded: data._logged === true });
  }

  // 添加日志项
  addLogItem(text, type, iconClass = 'bi-circle', requestId = null, timestamp = null, isRuleHit = false, options = {}) {
    const moduleName = options.module || '日志';
    const level = type.includes('error') ? 'error' : type.includes('success') ? 'success' : type === 'warning' ? 'warn' : 'info';
    if (!options.recorded) record(moduleName, level, options.recordText ?? text);
    text = prefix(moduleName, text);
    const trafficLog = document.getElementById('trafficLog');
    if (!trafficLog) return;
    const followLatest = trafficLog.scrollHeight - trafficLog.clientHeight - trafficLog.scrollTop < 40;

    const logItem = document.createElement('div');
    const displayTimestamp = timestamp || new Date().toLocaleTimeString();
    const timeElement = document.createElement('div');
    timeElement.className = 'log-item__time';
    timeElement.textContent = displayTimestamp;
    const iconElement = document.createElement('i');
    iconElement.className = `bi ${iconClass}`;
    const textElement = document.createElement('span');
    textElement.className = 'log-item__text';
    textElement.textContent = text;
    logItem.append(timeElement);

    if (requestId) {
      logItem.className = `log-item log-item--${type} log-item--clickable`;
      if (isRuleHit) logItem.classList.add('log-item--rule-hit');
      logItem.dataset.requestId = requestId;

      if (this.multiSelectMode) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'log-item__checkbox';
        checkbox.dataset.msCheckbox = requestId;
        logItem.append(checkbox);
      }

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
    }
    logItem.append(iconElement, textElement);

    const firstItem = trafficLog.querySelector('.log-item');
    if (firstItem && firstItem.textContent.includes('等待网络请求')) {
      trafficLog.removeChild(firstItem);
    }

    trafficLog.appendChild(logItem);

    const logItems = trafficLog.querySelectorAll('.log-item');
    if (logItems.length > 200) {
      const removedItem = logItems[0];
      if (this.state.selectedLogItem === removedItem) this.state.selectedLogItem = null;
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

    if (followLatest) trafficLog.scrollTop = trafficLog.scrollHeight;

    this.updateRequestCount();

    if (this.searchActive) {
      this.scheduleSearch();
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

  // 清空日志
  clearLogs() {
    window.electronAPI.call('proxy', 'clear-traffic-cache').catch(error => this.addErrorLog('释放抓包缓存失败：' + error.message, '日志'));
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
    if (selectAllBtn) selectAllBtn.addEventListener('click', () => this.selectAllVisible());
    if (selectReqBtn) selectReqBtn.addEventListener('click', () => this.selectAllVisible());
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

  // 全选可见可勾选项（由于不可点击的项没有 checkbox，全选与全选请求条目效果相同）
  selectAllVisible() {
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

// Submodules share this feature's instance; existing method contracts stay unchanged.
Object.assign(LogManager.prototype, detailsMethods);
export default LogManager;
