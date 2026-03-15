let answers = [];
let bucketLoaded = false;
let bucketError = null;
let autoFillIntervalId = null;
let autoFillDelay = 1000;
let autoFillPanel = null;
let customBucketUrl = localStorage.getItem('customFillBucketUrl') || '';  // 自定义词库URL
let logPanel = null;  // 日志面板
let logMessages = [];  // 日志消息数组

function loadBucketFromServer() {
    try {
        const url = customBucketUrl || 'http://127.0.0.1:5290/fill-answer';
        fetch(url, { cache: 'no-cache' })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(data => {
                answers = [];
                const answerMap = new Map();
                for (let i of data) {
                    if (i.sourceFile === 'correctAnswer.xml') {
                        const answerParts = i.answer.split('/');
                        const answerText = answerParts[0];
                        const questionNum = i.questionNumber || answers.length + 1;
                        answerMap.set(questionNum, answerText);
                    }
                }

                const sortedKeys = Array.from(answerMap.keys()).sort((a, b) => a - b);
                for (let key of sortedKeys) {
                    answers.push(answerMap.get(key));
                }

                bucketLoaded = true;
                bucketError = null;
                updateAutoFillPanelStatus();
                addLogMessage('填空答案库加载成功，共 ' + answers.length + ' 个答案', 'success');
                console.log('填空答案库加载成功，共' + answers.length + '个答案');
            })
            .catch(err => {
                bucketLoaded = false;
                bucketError = err.message || String(err);
                updateAutoFillPanelStatus();
                addLogMessage('填空答案库加载失败: ' + err.message, 'error');
                console.error('填空答案库加载失败:', err);
                setTimeout(() => {
                    console.log('自动重试加载答案库...');
                    loadBucketFromServer();
                }, 1000);
            });
    } catch (e) {
        bucketLoaded = false;
        bucketError = e.message || String(e);
        updateAutoFillPanelStatus();
        addLogMessage('填空答案库加载异常: ' + e.message, 'error');
        console.error('填空答案库加载异常:', e);
        setTimeout(() => {
            console.log('自动重试加载答案库...');
            loadBucketFromServer();
        }, 1000);
    }
}

async function wait1(x) {
    return new Promise(resolve => setTimeout(resolve, x));
}

async function work() {
    const preparedElements = document.getElementsByClassName('u3-input__prepared');
    const inputElements = document.getElementsByClassName('u3-input__content--input');

    let filledCount = 0;
    for (let i = 0; i < inputElements.length; i++) {
        const index = parseInt(preparedElements[i].innerHTML) - 1;
        if (index >= 0 && index < answers.length) {
            inputElements[i].value = answers[index];
            inputElements[i].dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            filledCount++;
            await wait1(100);
        }
    }

    if (filledCount > 0) {
        addLogMessage('已填入 ' + filledCount + ' 个答案', 'success');
    }

    const buttons = document.getElementsByClassName('btn');
    if (buttons.length > 1) {
        buttons[1].click();
        addLogMessage('已点击提交按钮', 'info');
    }
}

function startAutoFill() {
    if (autoFillIntervalId) {
        clearInterval(autoFillIntervalId);
        autoFillIntervalId = null;
    }
    autoFillIntervalId = setInterval(work, autoFillDelay);
    updateAutoFillPanelStatus();
    addLogMessage('自动填空已启动，间隔: ' + autoFillDelay + 'ms', 'info');
}

function stopAutoFill() {
    if (autoFillIntervalId) {
        clearInterval(autoFillIntervalId);
        autoFillIntervalId = null;
    }
    updateAutoFillPanelStatus();
    addLogMessage('自动填空已停止', 'info');
}

// 注入成功后显示提示文字
const showSuccessMessage = () => {
    const messageDiv = document.createElement('div');
    messageDiv.style.position = 'fixed';
    messageDiv.style.top = '20px';
    messageDiv.style.left = '50%';
    messageDiv.style.transform = 'translateX(-50%)';
    messageDiv.style.padding = '15px 25px';
    messageDiv.style.backgroundColor = 'rgba(0, 200, 0, 0.9)';
    messageDiv.style.color = 'white';
    messageDiv.style.borderRadius = '5px';
    messageDiv.style.fontSize = '16px';
    messageDiv.style.fontWeight = 'bold';
    messageDiv.style.zIndex = '9999';
    messageDiv.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
    messageDiv.textContent = 'Auto366自动填空注入成功，请点击控制面板的开始填空按钮，并保持天学网在前台运行';
    document.body.appendChild(messageDiv);
    setTimeout(() => {
        messageDiv.style.transition = 'opacity 0.5s';
        messageDiv.style.opacity = '0';
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 500);
    }, 15000);
};

// 添加日志消息
function addLogMessage(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    logMessages.unshift({ timestamp, message, type });
    // 保留最近50条日志
    if (logMessages.length > 50) {
        logMessages = logMessages.slice(0, 50);
    }
    updateLogPanel();
}

// 创建日志面板
function createLogPanel() {
    if (logPanel) return;
    logPanel = document.createElement('div');
    logPanel.id = 'auto-fill-log-panel';
    logPanel.style.position = 'fixed';
    logPanel.style.right = '300px';
    logPanel.style.bottom = '80px';
    logPanel.style.width = '350px';
    logPanel.style.height = '400px';
    logPanel.style.background = 'rgba(0,0,0,0.9)';
    logPanel.style.color = '#fff';
    logPanel.style.borderRadius = '8px';
    logPanel.style.padding = '10px';
    logPanel.style.zIndex = '9998';
    logPanel.style.overflow = 'hidden';
    logPanel.style.display = 'none';
    logPanel.style.userSelect = 'text'; // 允许文字选中

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';
    header.style.paddingBottom = '8px';
    header.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
    header.style.cursor = 'move'; // 添加拖动光标

    const titleSpan = document.createElement('span');
    titleSpan.textContent = '运行日志';
    titleSpan.style.fontSize = '14px';
    titleSpan.style.fontWeight = 'bold';
    header.appendChild(titleSpan);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.fontSize = '18px';
    closeBtn.style.padding = '0 6px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = '#fff';
    closeBtn.style.userSelect = 'none'; // 关闭按钮不参与文字选中
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡
        logPanel.style.display = 'none';
    });
    header.appendChild(closeBtn);
    logPanel.appendChild(header);

    const logContent = document.createElement('div');
    logContent.id = 'auto-fill-log-content';
    logContent.style.height = 'calc(100% - 40px)';
    logContent.style.overflowY = 'auto';
    logContent.style.fontSize = '11px';
    logContent.style.fontFamily = 'monospace';
    logContent.style.userSelect = 'text'; // 日志内容可选中
    logPanel.appendChild(logContent);

    document.body.appendChild(logPanel);

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn) return;
        isDragging = true;
        offsetX = e.clientX - logPanel.offsetLeft;
        offsetY = e.clientY - logPanel.offsetTop;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        logPanel.style.left = (e.clientX - offsetX) + 'px';
        logPanel.style.top = (e.clientY - offsetY) + 'px';
        logPanel.style.right = 'auto';
        logPanel.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// 更新日志面板
function updateLogPanel() {
    if (!logPanel) return;
    const logContent = document.getElementById('auto-fill-log-content');
    if (!logContent) return;

    logContent.innerHTML = logMessages.map(msg => {
        let color = '#fff';
        if (msg.type === 'success') color = '#4caf50';
        if (msg.type === 'error') color = '#f44336';
        if (msg.type === 'warning') color = '#ff9800';
        if (msg.type === 'info') color = '#2196f3';

        return `<div style="margin-bottom: 4px; color: ${color}">[${msg.timestamp}] ${msg.message}</div>`;
    }).join('');
}

function createAutoFillPanel() {
    if (autoFillPanel) return;
    autoFillPanel = document.createElement('div');
    autoFillPanel.style.position = 'fixed';
    autoFillPanel.style.right = '20px';
    autoFillPanel.style.bottom = '80px';
    autoFillPanel.style.width = '260px';
    autoFillPanel.style.background = 'rgba(0,0,0,0.8)';
    autoFillPanel.style.color = '#fff';
    autoFillPanel.style.borderRadius = '8px';
    autoFillPanel.style.padding = '10px';
    autoFillPanel.style.zIndex = '9999';
    autoFillPanel.style.cursor = 'move';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = '自动填空控制面板';
    titleSpan.style.fontSize = '14px';
    titleSpan.style.fontWeight = 'bold';
    header.appendChild(titleSpan);

    const settingsBtn = document.createElement('button');
    settingsBtn.textContent = '⚙';
    settingsBtn.title = '设置答案库位置';
    settingsBtn.style.fontSize = '14px';
    settingsBtn.style.padding = '2px 6px';
    settingsBtn.style.cursor = 'pointer';
    settingsBtn.style.background = 'rgba(255,255,255,0.2)';
    settingsBtn.style.border = 'none';
    settingsBtn.style.color = '#fff';
    settingsBtn.style.borderRadius = '3px';
    settingsBtn.style.marginRight = '4px';
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        const dialog = document.createElement('div');
        dialog.style.position = 'fixed';
        dialog.style.left = '50%';
        dialog.style.top = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
        dialog.style.background = 'rgba(0,0,0,0.9)';
        dialog.style.color = '#fff';
        dialog.style.padding = '20px';
        dialog.style.borderRadius = '8px';
        dialog.style.zIndex = '10000';
        dialog.style.minWidth = '300px';
        dialog.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';

        const title = document.createElement('span');
        title.textContent = '设置自定义答案库URL';
        title.style.fontSize = '16px';
        title.style.fontWeight = 'bold';
        title.style.display = 'block';
        title.style.marginBottom = '15px';
        dialog.appendChild(title);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = customBucketUrl;
        input.style.width = '100%';
        input.style.padding = '8px';
        input.style.marginBottom = '15px';
        input.style.boxSizing = 'border-box';
        input.style.borderRadius = '4px';
        input.style.border = '1px solid rgba(255,255,255,0.3)';
        input.style.background = 'rgba(255,255,255,0.1)';
        input.style.color = '#fff';
        dialog.appendChild(input);

        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.justifyContent = 'flex-end';
        btnContainer.style.gap = '10px';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.padding = '8px 16px';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.border = 'none';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.background = 'rgba(255,255,255,0.2)';
        cancelBtn.style.color = '#fff';

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确定';
        confirmBtn.style.padding = '8px 16px';
        confirmBtn.style.borderRadius = '4px';
        confirmBtn.style.border = 'none';
        confirmBtn.style.cursor = 'pointer';
        confirmBtn.style.background = '#4caf50';
        confirmBtn.style.color = '#fff';

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        dialog.appendChild(btnContainer);

        document.body.appendChild(dialog);

        setTimeout(() => input.focus(), 100);

        function closeDialog() {
            if (dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }
        }

        cancelBtn.addEventListener('click', closeDialog);

        confirmBtn.addEventListener('click', () => {
            const newUrl = input.value.trim();
            customBucketUrl = newUrl;
            localStorage.setItem('customFillBucketUrl', customBucketUrl);
            bucketLoaded = false;
            bucketError = null;
            updateAutoFillPanelStatus();
            addLogMessage('答案库URL已更新: ' + (customBucketUrl || '使用默认URL'), 'info');
            loadBucketFromServer();
            closeDialog();
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                confirmBtn.click();
            }
        });
    });
    header.appendChild(settingsBtn);

    const logBtn = document.createElement('button');
    logBtn.textContent = 'Logs';
    logBtn.title = '查看日志';
    logBtn.style.fontSize = '14px';
    logBtn.style.padding = '2px 6px';
    logBtn.style.cursor = 'pointer';
    logBtn.style.background = 'rgba(255,255,255,0.2)';
    logBtn.style.border = 'none';
    logBtn.style.color = '#fff';
    logBtn.style.borderRadius = '3px';
    logBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡
        if (!logPanel) {
            createLogPanel();
        }
        logPanel.style.display = logPanel.style.display === 'none' ? 'block' : 'none';
    });
    header.appendChild(logBtn);
    autoFillPanel.appendChild(header);

    const delayRow = document.createElement('div');
    delayRow.style.display = 'flex';
    delayRow.style.alignItems = 'center';
    delayRow.style.marginBottom = '6px';
    const delayLabel = document.createElement('span');
    delayLabel.textContent = '间隔(ms)：';
    delayLabel.style.fontSize = '12px';
    const delayInput = document.createElement('input');
    delayInput.type = 'number';
    delayInput.value = String(autoFillDelay);
    delayInput.style.flex = '1';
    delayInput.style.marginLeft = '6px';
    delayInput.style.fontSize = '12px';
    delayInput.addEventListener('change', () => {
        const v = parseInt(delayInput.value, 10);
        if (Number.isFinite(v) && v > 0) {
            autoFillDelay = v;
            if (autoFillIntervalId) {
                startAutoFill();
            }
        }
    });
    delayRow.appendChild(delayLabel);
    delayRow.appendChild(delayInput);
    autoFillPanel.appendChild(delayRow);

    const presetRow = document.createElement('div');
    presetRow.style.display = 'flex';
    presetRow.style.gap = '4px';
    presetRow.style.marginBottom = '6px';

    const preset1 = document.createElement('button');
    preset1.textContent = '500ms';
    preset1.title = '快速';
    preset1.style.flex = '1';
    preset1.style.fontSize = '11px';
    preset1.style.padding = '4px';
    preset1.addEventListener('click', () => {
        autoFillDelay = 500;
        delayInput.value = '500';
        if (autoFillIntervalId) {
            startAutoFill();
        }
    });

    const preset2 = document.createElement('button');
    preset2.textContent = '1000ms';
    preset2.title = '均衡';
    preset2.style.flex = '1';
    preset2.style.fontSize = '11px';
    preset2.style.padding = '4px';
    preset2.addEventListener('click', () => {
        autoFillDelay = 1000;
        delayInput.value = '1000';
        if (autoFillIntervalId) {
            startAutoFill();
        }
    });

    const preset3 = document.createElement('button');
    preset3.textContent = '3000ms';
    preset3.title = '稳定';
    preset3.style.flex = '1';
    preset3.style.fontSize = '11px';
    preset3.style.padding = '4px';
    preset3.addEventListener('click', () => {
        autoFillDelay = 3000;
        delayInput.value = '3000';
        if (autoFillIntervalId) {
            startAutoFill();
        }
    });

    presetRow.appendChild(preset1);
    presetRow.appendChild(preset2);
    presetRow.appendChild(preset3);
    autoFillPanel.appendChild(presetRow);

    const statusRow = document.createElement('div');
    statusRow.style.fontSize = '12px';
    statusRow.style.marginBottom = '6px';
    statusRow.id = 'auto-fill-status';
    autoFillPanel.appendChild(statusRow);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '6px';

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'auto-fill-toggle';
    toggleBtn.textContent = '开始填空';
    toggleBtn.style.flex = '1';
    toggleBtn.style.fontSize = '12px';
    toggleBtn.addEventListener('click', () => {
        if (autoFillIntervalId) {
            stopAutoFill();
        } else {
            startAutoFill();
        }
    });

    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '重载答案库';
    reloadBtn.style.flex = '1';
    reloadBtn.style.fontSize = '12px';
    reloadBtn.addEventListener('click', () => {
        bucketLoaded = false;
        bucketError = null;
        updateAutoFillPanelStatus();
        loadBucketFromServer();
    });

    btnRow.appendChild(toggleBtn);
    btnRow.appendChild(reloadBtn);
    autoFillPanel.appendChild(btnRow);

    document.body.appendChild(autoFillPanel);

    // 简单拖拽
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    autoFillPanel.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - autoFillPanel.offsetLeft;
        offsetY = e.clientY - autoFillPanel.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        autoFillPanel.style.left = (e.clientX - offsetX) + 'px';
        autoFillPanel.style.top = (e.clientY - offsetY) + 'px';
        autoFillPanel.style.right = 'auto';
        autoFillPanel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    updateAutoFillPanelStatus();
}

function updateAutoFillPanelStatus() {
    if (!autoFillPanel) return;
    const statusEl = document.getElementById('auto-fill-status');
    const toggleBtn = document.getElementById('auto-fill-toggle');
    if (statusEl) {
        if (bucketLoaded) {
            statusEl.textContent = '答案库加载成功';
            statusEl.style.color = '#4caf50';
        } else if (bucketError) {
            statusEl.textContent = '答案库加载失败: ' + bucketError;
            statusEl.style.color = '#ff9800';
        } else {
            statusEl.textContent = '答案库加载中...';
            statusEl.style.color = '#ffc107';
        }
    }
    if (toggleBtn) {
        toggleBtn.textContent = autoFillIntervalId ? '停止填空' : '开始填空';
    }
}

function initAutoFill() {
    createAutoFillPanel();
    createLogPanel();
    addLogMessage('系统初始化完成', 'success');
    loadBucketFromServer();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        showSuccessMessage();
        initAutoFill();
    });
} else {
    showSuccessMessage();
    initAutoFill();
}