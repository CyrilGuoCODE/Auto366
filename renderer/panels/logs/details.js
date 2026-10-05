import settingsStorage from '../../services/settings.js';
import Utils from '../../utils.js';

export default {
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
    const savedMonitorFlex = settingsStorage.getItem('trafficMonitorFlex') || '1';
    const savedDetailsFlex = settingsStorage.getItem('requestDetailsFlex') || '1';

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
          <span class="log-detail__value">${Utils.escapeHtml(String(requestData.method || 'GET'))}</span>
        </div>
        <div class="log-detail__item">
          <span class="log-detail__label">URL:</span>
          <span class="log-detail__value">${Utils.escapeHtml(String(requestData.url || ''))}</span>
        </div>
        <div class="log-detail__item">
          <span class="log-detail__label">状态码:</span>
          <span class="log-detail__value">${Utils.escapeHtml(String(requestData.statusCode || requestData.status || '未知'))}</span>
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
          <div class="log-detail__json">${Utils.escapeHtml(Utils.formatHeaders(requestData.requestHeaders))}</div>
        </div>
      `;
    }

    // 请求体
    if (requestData.requestBody) {
      html += `
        <div class="log-detail__section">
          <h5>请求体</h5>
          <div class="log-detail__json">${Utils.escapeHtml(Utils.formatBody(requestData.requestBody, true))}</div>
        </div>
      `;
    }

    // 响应头
    if (requestData.responseHeaders) {
      html += `
        <div class="log-detail__section">
          <h5>响应头</h5>
          <div class="log-detail__json">${Utils.escapeHtml(Utils.formatHeaders(requestData.responseHeaders))}</div>
        </div>
      `;
    }

    // 响应体
    if (requestData.responseBody) {
      html += `
        <div class="log-detail__section">
          <h5>响应体</h5>
          <div class="log-detail__json">${Utils.escapeHtml(Utils.formatBody(requestData.responseBody, true))}</div>
        </div>
      `;
    }

    // 下载按钮（如果有UUID）
    if (requestData.uuid) {
      html += `
        <div class="log-detail__section">
          <h5>操作</h5>
          <button class="btn--download" data-download-uuid="${Utils.escapeHtml(String(requestData.uuid))}">
            <i class="bi bi-download"></i>
            <span>下载响应文件</span>
          </button>
        </div>
      `;
    }

    detailsContent.innerHTML = html;
  },

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
  },

displayFileStructure(data) {
    this.addInfoLog(`文件结构分析完成，解压目录: ${data.extractDir}`);

    if (data.structure && data.structure.length > 0) {
      const structureText = Utils.formatFileStructure(data.structure);
      this.addLogItem(`文件结构:\n${structureText}`, 'detail', 'bi-folder', null, null, false, { module: '文件' });
    }
  },

displayProcessedFiles(data) {
    this.addInfoLog(`文件处理完成，共处理 ${data.processedFiles.length} 个文件，提取到 ${data.totalAnswers} 个答案`);

    if (data.processedFiles && data.processedFiles.length > 0) {
      data.processedFiles.forEach(file => {
        const fileName = file.file || file.name || '未知文件';
        const answerCount = file.answerCount || file.answers || 0;
        this.addLogItem(`处理文件: ${fileName} - 提取 ${answerCount} 个答案`, 'success', 'bi-file-check', null, null, false, { module: '答案' });
      });
    }

    // 输出答案文件位置
    if (data.file) {
      this.addSuccessLog(`答案文件已保存到: ${data.file}`);
    }
  }
};
