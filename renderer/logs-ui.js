import Utils from './utils.js';

class LogManager {
  constructor(state) {
    this.state = state;
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
      // 这是一个可点击的请求日志项
      logItem.className = `log-item ${type} clickable`;
      logItem.dataset.requestId = requestId;

      logItem.innerHTML = `
        <div class="log-time">${displayTimestamp}</div>
        <i class="${iconClass}"></i>
        <span class="log-text">${text}</span>
      `;

      // 添加点击事件
      logItem.addEventListener('click', () => {
        this.showRequestDetails(requestId);

        // 更新选中状态
        if (this.state.selectedLogItem) {
          this.state.selectedLogItem.classList.remove('selected');
        }
        logItem.classList.add('selected');
        this.state.selectedLogItem = logItem;
      });
    } else {
      // 这是一个普通的日志项（状态信息等）
      logItem.className = `log-item ${type}`;
      logItem.innerHTML = `
        <div class="log-time">${displayTimestamp}</div>
        <i class="${iconClass}"></i>
        <span class="log-text">${text}</span>
      `;
    }

    // 如果是第一个日志项且显示"等待网络请求..."，则替换它
    const firstItem = trafficLog.querySelector('.log-item');
    if (firstItem && firstItem.textContent.includes('等待网络请求')) {
      trafficLog.removeChild(firstItem);
    }

    trafficLog.appendChild(logItem);

    // 限制日志数量，保持最新的200条
    const logItems = trafficLog.querySelectorAll('.log-item');
    if (logItems.length > 200) {
      const removedItem = logItems[0];
      // 如果删除的是请求项，也要清理对应的数据
      if (removedItem.dataset.requestId) {
        this.state.requestDataMap.delete(removedItem.dataset.requestId);
      }
      trafficLog.removeChild(removedItem);
    }

    // 自动滚动到底部
    trafficLog.scrollTop = trafficLog.scrollHeight;

    // 更新请求计数
    this.updateRequestCount();
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
