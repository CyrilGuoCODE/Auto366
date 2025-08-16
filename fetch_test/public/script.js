class TianxueToolApp {
    constructor() {
        this.ws = null;
        this.isCapturing = false;
        this.answers = [];
        
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

        startBtn.addEventListener('click', () => this.startCapture());
        stopBtn.addEventListener('click', () => this.stopCapture());
        clearBtn.addEventListener('click', () => this.clearLogs());
        downloadAnswersBtn.addEventListener('click', () => this.downloadAnswers());
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