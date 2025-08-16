class TianxueToolApp {
    constructor() {
        this.ws = null;
        this.isCapturing = false;
        this.answers = [];
        this.trafficFilters = {
            showAll: true,
            postOnly: false,
            jsonOnly: false
        };
        
        this.initializeWebSocket();
        this.bindEvents();
        this.updateUI();
    }

    // 初始化WebSocket连接
    initializeWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                this.addLog('WebSocket连接已建立', 'success');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    console.error('解析WebSocket消息失败:', error);
                }
            };
            
            this.ws.onclose = () => {
                this.addLog('WebSocket连接已断开，尝试重连...', 'warning');
                setTimeout(() => this.initializeWebSocket(), 3000);
            };
            
            this.ws.onerror = (error) => {
                this.addLog('WebSocket连接错误', 'error');
                console.error('WebSocket错误:', error);
            };
        } catch (error) {
            this.addLog('WebSocket初始化失败', 'error');
            console.error('WebSocket初始化错误:', error);
        }
    }

    // 处理WebSocket消息
    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'log':
                this.addLog(message.message);
                break;
            
            case 'error':
                this.addLog(message.message, 'error');
                break;
            
            case 'status':
                this.updateStatus(message.data);
                break;
            
            case 'downloadUrl':
                this.handleDownloadUrl(message.url);
                break;
            
            case 'answers':
                this.displayAnswers(message.data);
                break;
            
            case 'traffic':
                this.addTrafficLog(message.data);
                break;
            
            case 'response':
                this.addResponseLog(message.data);
                break;
            
            case 'requestBody':
                this.addRequestBodyLog(message.data);
                break;
            
            case 'responseBody':
                this.addResponseBodyLog(message.data);
                break;
            
            default:
                console.log('未知消息类型:', message);
        }
    }

    // 绑定事件监听器
    bindEvents() {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const clearBtn = document.getElementById('clear-btn');
        const downloadAnswersBtn = document.getElementById('download-answers-btn');
        
        // 流量过滤器
        const showAllTraffic = document.getElementById('show-all-traffic');
        const showPostOnly = document.getElementById('show-post-only');
        const showJsonOnly = document.getElementById('show-json-only');

        startBtn.addEventListener('click', () => this.startCapture());
        stopBtn.addEventListener('click', () => this.stopCapture());
        clearBtn.addEventListener('click', () => this.clearLogs());
        downloadAnswersBtn.addEventListener('click', () => this.downloadAnswers());
        
        // 流量过滤器事件
        showAllTraffic.addEventListener('change', (e) => {
            this.trafficFilters.showAll = e.target.checked;
            this.applyTrafficFilters();
        });
        
        showPostOnly.addEventListener('change', (e) => {
            this.trafficFilters.postOnly = e.target.checked;
            this.applyTrafficFilters();
        });
        
        showJsonOnly.addEventListener('change', (e) => {
            this.trafficFilters.jsonOnly = e.target.checked;
            this.applyTrafficFilters();
        });
    }

    // 开始抓包
    async startCapture() {
        try {
            const response = await fetch('/api/start-capture', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();
            
            if (result.success) {
                this.isCapturing = true;
                this.updateUI();
                this.addLog('开始监听网络请求...', 'info');
            } else {
                this.addLog('启动失败: ' + result.message, 'error');
            }
        } catch (error) {
            this.addLog('启动失败: ' + error.message, 'error');
        }
    }

    // 停止抓包
    async stopCapture() {
        try {
            const response = await fetch('/api/stop-capture', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();
            
            if (result.success) {
                this.isCapturing = false;
                this.updateUI();
                this.addLog('停止监听网络请求', 'info');
            } else {
                this.addLog('停止失败: ' + result.message, 'error');
            }
        } catch (error) {
            this.addLog('停止失败: ' + error.message, 'error');
        }
    }

    // 更新UI状态
    updateUI() {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const captureStatus = document.getElementById('capture-status');
        const captureText = document.getElementById('capture-text');

        if (this.isCapturing) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            captureStatus.classList.add('active');
            captureText.innerHTML = '正在监听 <span class="loading"></span>';
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
            captureStatus.classList.remove('active');
            captureText.textContent = '未开始';
        }
    }

    // 更新状态
    updateStatus(data) {
        if (data.isCapturing !== undefined) {
            this.isCapturing = data.isCapturing;
        }
        
        if (data.isProcessing) {
            const processStatus = document.getElementById('process-status');
            const processText = document.getElementById('process-text');
            processStatus.classList.add('processing');
            processText.innerHTML = '正在处理 <span class="loading"></span>';
        }
        
        if (data.isComplete) {
            const processStatus = document.getElementById('process-status');
            const processText = document.getElementById('process-text');
            processStatus.classList.remove('processing');
            processStatus.classList.add('success');
            processText.textContent = '处理完成';
        }
        
        this.updateUI();
    }

    // 处理下载链接
    handleDownloadUrl(url) {
        const downloadStatus = document.getElementById('download-status');
        const downloadText = document.getElementById('download-text');
        downloadStatus.classList.add('active');
        downloadText.innerHTML = '开始下载 <span class="loading"></span>';
    }

    // 显示答案
    displayAnswers(answers) {
        this.answers = answers;
        const answersSection = document.getElementById('answers-section');
        const answersContainer = document.getElementById('answers-container');
        const answerStatus = document.getElementById('answer-status');
        const answerText = document.getElementById('answer-text');

        // 更新答案状态
        answerStatus.classList.add('success');
        answerText.textContent = `已提取 ${answers.length} 道题`;

        // 清空容器
        answersContainer.innerHTML = '';

        // 显示答案
        answers.forEach((answer, index) => {
            const answerItem = document.createElement('div');
            answerItem.className = 'answer-item';
            answerItem.innerHTML = `
                <div class="answer-number">第 ${index + 1} 题</div>
                <div class="answer-option">${answer.answer}</div>
                <div class="answer-content">${answer.content || '暂无内容'}</div>
            `;
            answersContainer.appendChild(answerItem);
        });

        // 显示答案区域
        answersSection.style.display = 'block';
        
        // 滚动到答案区域
        answersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // 添加日志
    addLog(message, type = 'info') {
        const logContainer = document.getElementById('log-container');
        const timestamp = new Date().toLocaleTimeString();
        
        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        logItem.textContent = `[${timestamp}] ${message}`;
        
        logContainer.appendChild(logItem);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // 限制日志数量
        const logItems = logContainer.querySelectorAll('.log-item');
        if (logItems.length > 100) {
            logContainer.removeChild(logItems[0]);
        }
    }

    // 清空日志
    clearLogs() {
        const logContainer = document.getElementById('log-container');
        logContainer.innerHTML = '';
        this.addLog('日志已清空', 'info');
    }

    // 添加流量日志
    addTrafficLog(data) {
        const trafficContainer = document.getElementById('traffic-container');
        const timestamp = new Date(data.timestamp).toLocaleTimeString();
        
        const trafficItem = document.createElement('div');
        trafficItem.className = 'traffic-item';
        trafficItem.dataset.method = data.method;
        trafficItem.dataset.url = data.url;
        
        // 检查是否包含关键词
        const isImportant = this.isImportantRequest(data);
        if (isImportant) {
            trafficItem.classList.add('traffic-highlight');
        }
        
        trafficItem.innerHTML = `
            <div class="traffic-request">
                <span class="traffic-method ${data.method}">${data.method}</span>
                <span class="traffic-url">${data.url}</span>
                <span class="traffic-timestamp">${timestamp}</span>
            </div>
            <div class="traffic-details">
                Host: ${data.host} | Content-Type: ${data.contentType} | Size: ${data.contentLength}
            </div>
        `;
        
        trafficContainer.appendChild(trafficItem);
        trafficContainer.scrollTop = trafficContainer.scrollHeight;
        
        // 限制流量日志数量
        const trafficItems = trafficContainer.querySelectorAll('.traffic-item');
        if (trafficItems.length > 200) {
            trafficContainer.removeChild(trafficItems[0]);
        }
        
        this.applyTrafficFilters();
    }

    // 添加响应日志
    addResponseLog(data) {
        const trafficContainer = document.getElementById('traffic-container');
        const lastItem = trafficContainer.lastElementChild;
        
        if (lastItem && lastItem.dataset.url === data.request.url) {
            const statusClass = this.getStatusClass(data.response.statusCode);
            
            const responseDiv = document.createElement('div');
            responseDiv.className = 'traffic-response';
            responseDiv.innerHTML = `
                <span class="traffic-status ${statusClass}">${data.response.statusCode}</span>
                ${data.response.statusMessage} | ${data.response.contentType} | ${data.response.contentLength}
            `;
            
            lastItem.appendChild(responseDiv);
        }
    }

    // 添加请求体日志
    addRequestBodyLog(data) {
        const trafficContainer = document.getElementById('traffic-container');
        const lastItem = trafficContainer.lastElementChild;
        
        if (lastItem && lastItem.dataset.url === data.url) {
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'traffic-body';
            bodyDiv.innerHTML = `
                <strong>请求体 (${data.fullLength} bytes):</strong><br>
                ${this.escapeHtml(data.body)}
                ${data.fullLength > 1000 ? '<br><em>...内容已截断</em>' : ''}
            `;
            
            lastItem.appendChild(bodyDiv);
            
            // 如果包含重要信息，高亮显示
            if (this.containsImportantData(data.body)) {
                lastItem.classList.add('traffic-highlight');
                this.addLog(`发现重要请求数据: ${data.url}`, 'warning');
            }
        }
    }

    // 添加响应体日志
    addResponseBodyLog(data) {
        const trafficContainer = document.getElementById('traffic-container');
        const lastItem = trafficContainer.lastElementChild;
        
        if (lastItem && lastItem.dataset.url === data.url) {
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'traffic-body';
            bodyDiv.innerHTML = `
                <strong>响应体 (${data.fullLength} bytes):</strong><br>
                ${this.escapeHtml(data.body)}
                ${data.fullLength > 1000 ? '<br><em>...内容已截断</em>' : ''}
            `;
            
            lastItem.appendChild(bodyDiv);
            
            // 如果包含重要信息，高亮显示
            if (this.containsImportantData(data.body)) {
                lastItem.classList.add('traffic-highlight');
                this.addLog(`发现重要响应数据: ${data.url}`, 'warning');
            }
        }
    }

    // 检查是否是重要请求
    isImportantRequest(data) {
        const importantKeywords = [
            'fileinfo', 'download', 'page1', 'exam', 'question', 
            'answer', 'zip', 'tianxue', 'test', 'quiz'
        ];
        
        const url = data.url.toLowerCase();
        return importantKeywords.some(keyword => url.includes(keyword));
    }

    // 检查是否包含重要数据
    containsImportantData(text) {
        const importantKeywords = [
            'downloadUrl', 'download_url', 'fileUrl', 'file_url',
            'zipUrl', 'zip_url', 'page1.js', '.zip', 'answer_text',
            'question', 'exam', 'test'
        ];
        
        const lowerText = text.toLowerCase();
        return importantKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
    }

    // 获取状态码样式类
    getStatusClass(statusCode) {
        if (statusCode >= 200 && statusCode < 300) return 'success';
        if (statusCode >= 300 && statusCode < 400) return 'redirect';
        return 'error';
    }

    // 应用流量过滤器
    applyTrafficFilters() {
        const trafficItems = document.querySelectorAll('.traffic-item');
        
        trafficItems.forEach(item => {
            let show = true;
            
            if (!this.trafficFilters.showAll) {
                show = false;
            }
            
            if (this.trafficFilters.postOnly && item.dataset.method !== 'POST') {
                show = false;
            }
            
            if (this.trafficFilters.jsonOnly) {
                const hasJsonContent = item.textContent.includes('application/json');
                if (!hasJsonContent) {
                    show = false;
                }
            }
            
            item.style.display = show ? 'block' : 'none';
        });
    }

    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 下载答案文件
    downloadAnswers() {
        if (this.answers.length === 0) {
            this.addLog('没有可下载的答案', 'warning');
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `tianxue_answers_${timestamp}.txt`;
        
        const content = this.answers.map((answer, index) => {
            return `第${index + 1}题: ${answer.answer}\n内容: ${answer.content || '暂无内容'}\n`;
        }).join('\n');

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        this.addLog(`答案文件已下载: ${filename}`, 'success');
    }
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new TianxueToolApp();
});