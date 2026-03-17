let answers = [];
let bucketLoaded = false;
let bucketError = null;
let autoFillIntervalId = null;
let autoFillDelay = 200;
let autoFillPanel = null;
let customBucketUrl = localStorage.getItem('customFillBucketUrl') || '';  // 自定义词库URL
let logPanel = null;  // 日志面板
let logMessages = [];  // 日志消息数组
let contentMatchMode = localStorage.getItem('contentMatchMode') === 'true' || false;
let rawAnswerData = [];
let elementAnswerMap = new Map();
const MAX_LOG_MESSAGES = 200;  // 最大日志数量

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
                rawAnswerData = [];
                elementAnswerMap = new Map();
                const answerMap = new Map();
                const multiAnswerMap = new Map(); 

                for (let i of data) {
                    if (i.sourceFile === 'correctAnswer.xml') {
                        let parts = [];
                        if (Array.isArray(i.multipleAnswers) && i.multipleAnswers.length > 0) {
                            parts = i.multipleAnswers.map(x => String(x).trim()).filter(Boolean);
                        } else if (typeof i.answer === 'string') {
                            const raw = i.answer.replace(/\s+/g, ' ').trim();
                            if (raw.includes('/')) {
                                parts = raw.split('/').map(s => s.trim()).filter(Boolean);
                            } else if (raw) {
                                parts = [raw];
                            }
                        }
                        if (parts.length === 0) continue;

                        let questionNum = 1;
                        if (i.question && typeof i.question === 'string') {
                            const match = i.question.match(/第(\d+)题/);
                            if (match) {
                                questionNum = parseInt(match[1], 10);
                            }
                        }

                        if (!questionNum || questionNum <= 0) {
                            questionNum = i.answerIndex || (answers.length + 1);
                        }

                        if (!multiAnswerMap.has(questionNum)) {
                            multiAnswerMap.set(questionNum, []);
                        }

                        const baseAnswerIndex = Number.isFinite(i.answerIndex) && i.answerIndex > 0 ? i.answerIndex : 1;
                        for (let p = 0; p < parts.length; p++) {
                            const answerText = parts[p];
                            const answerIndex = baseAnswerIndex + p;

                            rawAnswerData.push({
                                question: i.question || '',
                                questionText: i.questionText || '',
                                answer: answerText,
                                answerIndex: answerIndex,
                                index: i.index,
                                elementId: i.elementId
                            });

                            multiAnswerMap.get(questionNum).push({
                                answer: answerText,
                                answerIndex: answerIndex,
                                elementId: i.elementId
                            });

                            if (i.elementId) {
                                if (!elementAnswerMap.has(i.elementId)) {
                                    elementAnswerMap.set(i.elementId, []);
                                }
                                elementAnswerMap.get(i.elementId).push({
                                    answer: answerText,
                                    answerIndex: answerIndex,
                                    elementId: i.elementId,
                                    questionNum: questionNum
                                });
                            }

                            if (!answerMap.has(questionNum)) {
                                answerMap.set(questionNum, answerText);
                            }
                        }
                    }
                }

                for (let [questionNum, answerList] of multiAnswerMap) {
                    answerList.sort((a, b) => (a.answerIndex || 1) - (b.answerIndex || 1));
                    multiAnswerMap.set(questionNum, answerList);
                }

                for (let [eid, answerList] of elementAnswerMap) {
                    answerList.sort((a, b) => (a.answerIndex || 1) - (b.answerIndex || 1));
                    elementAnswerMap.set(eid, answerList);
                }

                const sortedKeys = Array.from(answerMap.keys()).sort((a, b) => a - b);
                for (let key of sortedKeys) {
                    answers.push(answerMap.get(key));
                }

                // 将多空题数据存储到全局变量
                window.multiAnswerMap = multiAnswerMap;
                window.elementAnswerMap = elementAnswerMap;

                bucketLoaded = true;
                bucketError = null;
                updateAutoFillPanelStatus();
                addLogMessage('填空答案库加载成功，共 ' + answers.length + ' 个题目', 'success');

                const multiBlankCount = Array.from(multiAnswerMap.values()).filter(list => list.length > 1).length;
                if (multiBlankCount > 0) {
                    addLogMessage(`检测到 ${multiBlankCount} 个多空题`, 'info');
                }
                
                addLogMessage('内容匹配模式: ' + (contentMatchMode ? '已启用' : '已禁用'), 'info');
                console.log('填空答案库加载成功，共' + answers.length + '个题目');
                console.log('多空题数据:', multiAnswerMap);
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

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
}

function calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    const clean = s => s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
    const c1 = clean(text1), c2 = clean(text2);
    if (c1 === c2) return 100;
    if (!c1 || !c2) return 0;
    const maxLen = Math.max(c1.length, c2.length);
    const editSim = (1 - levenshtein(c1, c2) / maxLen) * 60;
    const words1 = c1.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || [];
    const words2 = new Set(c2.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || []);
    const overlap = words1.filter(w => words2.has(w)).length;
    const wordSim = (overlap / Math.max(words1.length, words2.size, 1)) * 40;
    return editSim + wordSim;
}

function findAnswerByContent(questionText) {
    if (!rawAnswerData || rawAnswerData.length === 0) {
        return null;
    }

    let bestMatch = null;
    let bestScore = 0;

    rawAnswerData.forEach((item, index) => {
        const matchText = item.questionText || item.question || '';
        const similarity = calculateTextSimilarity(questionText, matchText);
        if (similarity > bestScore && similarity > 60) { // 提高最低相似度阈值到60%
            bestScore = similarity;
            let questionNum = 0;
            if (item.question && typeof item.question === 'string') {
                const m = item.question.match(/第(\d+)题/);
                if (m) questionNum = parseInt(m[1], 10);
            }
            bestMatch = {
                answer: item.answer,
                similarity: similarity,
                originalQuestion: matchText,
                index: index,
                elementId: item.elementId,
                questionNum: questionNum
            };
        }
    });

    return bestMatch;
}

async function work() {
    const getInputs = (root) => {
        const a = root.getElementsByClassName('u3-input__content--input');
        if (a && a.length) return a;
        return root.getElementsByClassName('u3-input__content');
    };

    const setElValue = (el, v) => {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
            el.value = v;
        } else {
            el.textContent = v;
        }
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        return true;
    };

    const fillByAnswers = async (inputs, answersToFill) => {
        let filledBlanks = 0;
        for (let j = 0; j < inputs.length && j < answersToFill.length; j++) {
            if (setElValue(inputs[j], answersToFill[j])) {
                filledBlanks++;
            }
            await wait1(50);
        }
        return filledBlanks;
    };

    const preparedElements = document.getElementsByClassName('u3-input__prepared');
    const inputElements = getInputs(document);

    let filledCount = 0;

    if (contentMatchMode) {
        addLogMessage('使用内容匹配模式', 'info');
        
        const questionTexts = document.getElementsByClassName('u3-question-text');
        
        for (let i = 0; i < questionTexts.length; i++) {
            const questionTextElement = questionTexts[i];
            let scopeEl = questionTextElement;
            let containerInputs = getInputs(scopeEl);
            for (let up = 0; up < 6 && containerInputs.length <= 1 && scopeEl && scopeEl.parentElement; up++) {
                scopeEl = scopeEl.parentElement;
                containerInputs = getInputs(scopeEl);
            }

            if (containerInputs.length > 0) {
                // 获取纯文本内容，去除HTML标签和题号
                const questionText = questionTextElement.textContent || questionTextElement.innerText || '';
                const cleanQuestionText = questionText.replace(/^\d+[\s\.\)]*/, '').trim();

                const match = findAnswerByContent(cleanQuestionText);

                if (match) {
                    const preparedElements = scopeEl.getElementsByClassName('u3-input__prepared');
                    let questionNum = i + 1;
                    
                    if (preparedElements.length > 0) {
                        const parsedNum = parseInt(preparedElements[0].innerHTML);
                        if (!isNaN(parsedNum) && parsedNum > 0) {
                            questionNum = parsedNum;
                        }
                    }

                    let answersToFill = null;
                    if (match.elementId && window.elementAnswerMap) {
                        const list = window.elementAnswerMap.get(match.elementId);
                        if (list && list.length > 0) {
                            answersToFill = list.map(item => item.answer);
                            if (!preparedElements.length && list[0].questionNum) {
                                questionNum = list[0].questionNum;
                            }
                        }
                    }

                    if (!answersToFill && window.multiAnswerMap) {
                        const multiAnswers = window.multiAnswerMap.get(questionNum) || (match.questionNum ? window.multiAnswerMap.get(match.questionNum) : null);
                        if (multiAnswers && multiAnswers.length > 0) {
                            answersToFill = multiAnswers.map(item => item.answer);
                            if (match.questionNum) questionNum = match.questionNum;
                        }
                    }

                    if (!answersToFill) {
                        answersToFill = [match.answer];
                    }

                    const filledBlanks = await fillByAnswers(containerInputs, answersToFill);

                    filledCount += filledBlanks;
                    if (filledBlanks > 1) {
                        addLogMessage(`题目 ${questionNum} 内容多空匹配成功 (相似度: ${Math.round(match.similarity)}%, ${filledBlanks}个空): ${answersToFill.slice(0, filledBlanks).join(' / ')}`, 'success');
                    } else {
                        addLogMessage(`题目 ${questionNum} 内容匹配成功 (相似度: ${Math.round(match.similarity)}%): ${answersToFill[0]}`, 'success');
                    }
                    await wait1(100);
                } else {
                    addLogMessage(`题目 ${i + 1} 未找到匹配答案: ${cleanQuestionText.substring(0, 50)}...`, 'warning');
                }
            }
        }
    } else {
        addLogMessage('使用题号匹配模式', 'info');
        
        // 题号匹配模式：基于旧版逻辑，直接遍历输入框
        for (let i = 0; i < inputElements.length; i++) {
            if (i >= preparedElements.length) break;
            
            const questionNum = parseInt(preparedElements[i].innerHTML);
            if (isNaN(questionNum) || questionNum <= 0) continue;
            
            const multiAnswers = window.multiAnswerMap ? window.multiAnswerMap.get(questionNum) : null;
            
            let currentInputIndex = i;
            while (currentInputIndex < preparedElements.length && parseInt(preparedElements[currentInputIndex].innerHTML) === questionNum) {
                currentInputIndex++;
            }
            const inputsSlice = Array.from(inputElements).slice(i, currentInputIndex);

            let answersToFill;
            if (multiAnswers && multiAnswers.length > 0) {
                answersToFill = multiAnswers.map(item => item.answer);
            } else {
                const answerIndex = questionNum - 1;
                answersToFill = (answerIndex >= 0 && answerIndex < answers.length) ? [answers[answerIndex]] : [];
            }

            const filledBlanks = await fillByAnswers(inputsSlice, answersToFill);
            filledCount += filledBlanks;
            if (filledBlanks > 1) {
                addLogMessage(`题目 ${questionNum} 多空填入 (${filledBlanks}个空): ${answersToFill.slice(0, filledBlanks).join(' / ')}`, 'success');
            } else if (filledBlanks === 1) {
                addLogMessage(`题目 ${questionNum} 填入答案: ${answersToFill[0]}`, 'success');
            }

            i = currentInputIndex - 1;
            
            await wait1(100);
        }
    }

    if (filledCount > 0) {
        addLogMessage('已填入 ' + filledCount + ' 个答案', 'success');
    } else {
        addLogMessage('未找到可填入的题目', 'warning');
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

    if (logMessages.length > MAX_LOG_MESSAGES) {
        const importantLogs = logMessages.filter(log => log.type === 'error' || log.type === 'warning');
        const normalLogs = logMessages.filter(log => log.type !== 'error' && log.type !== 'warning');

        const maxNormalLogs = MAX_LOG_MESSAGES - importantLogs.length;
        const keptNormalLogs = normalLogs.slice(0, Math.max(0, maxNormalLogs));

        logMessages = [...importantLogs, ...keptNormalLogs].sort((a, b) => {
            return new Date('1970-01-01 ' + b.timestamp) - new Date('1970-01-01 ' + a.timestamp);
        });
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

        const title = document.createElement('h4');
        title.textContent = '设置自定义答案库URL';
        title.style.fontSize = '19px';
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
    logBtn.style.fontSize = '12px';
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

    const consoleBtn = document.createElement('button');
    consoleBtn.textContent = 'Console';
    consoleBtn.title = '打开内部控制台';
    consoleBtn.style.fontSize = '12px';
    consoleBtn.style.padding = '2px 6px';
    consoleBtn.style.cursor = 'pointer';
    consoleBtn.style.background = 'rgba(0,122,204,0.8)';
    consoleBtn.style.border = 'none';
    consoleBtn.style.color = '#fff';
    consoleBtn.style.borderRadius = '3px';
    consoleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof openDevConsole === 'function') {
            openDevConsole();
            addLogMessage('已打开内部控制台', 'info');
        } else {
            addLogMessage('内部控制台未加载', 'error');
        }
    });
    header.appendChild(consoleBtn);
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
    preset1.textContent = '80ms';
    preset1.title = '极速';
    preset1.style.flex = '1';
    preset1.style.fontSize = '11px';
    preset1.style.padding = '4px';
    preset1.addEventListener('click', () => {
        autoFillDelay = 80;
        delayInput.value = '80';
        if (autoFillIntervalId) {
            startAutoFill();
        }
    });

    const preset2 = document.createElement('button');
    preset2.textContent = '200ms';
    preset2.title = '快速';
    preset2.style.flex = '1';
    preset2.style.fontSize = '11px';
    preset2.style.padding = '4px';
    preset2.addEventListener('click', () => {
        autoFillDelay = 200;
        delayInput.value = '200';
        if (autoFillIntervalId) {
            startAutoFill();
        }
    });

    const preset3 = document.createElement('button');
    preset3.textContent = '1000ms';
    preset3.title = '稳定';
    preset3.style.flex = '1';
    preset3.style.fontSize = '11px';
    preset3.style.padding = '4px';
    preset3.addEventListener('click', () => {
        autoFillDelay = 1000;
        delayInput.value = '1000';
        if (autoFillIntervalId) {
            startAutoFill();
        }
    });

    presetRow.appendChild(preset1);
    presetRow.appendChild(preset2);
    presetRow.appendChild(preset3);
    autoFillPanel.appendChild(presetRow);

    // 内容匹配模式复选框
    const matchModeRow = document.createElement('div');
    matchModeRow.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 4px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
    `;

    const matchModeCheckbox = document.createElement('input');
    matchModeCheckbox.type = 'checkbox';
    matchModeCheckbox.id = 'content-match-mode';
    matchModeCheckbox.checked = contentMatchMode;
    matchModeCheckbox.style.cssText = `
        margin-right: 8px;
        cursor: pointer;
    `;
    matchModeCheckbox.addEventListener('change', (e) => {
        contentMatchMode = e.target.checked;
        localStorage.setItem('contentMatchMode', contentMatchMode.toString());
        addLogMessage('内容匹配模式: ' + (contentMatchMode ? '已启用' : '已禁用'), 'info');
        updateMatchModeLabel();
    });

    const matchModeLabel = document.createElement('label');
    matchModeLabel.htmlFor = 'content-match-mode';
    matchModeLabel.style.cssText = `
        font-size: 11px;
        cursor: pointer;
        flex: 1;
    `;

    function updateMatchModeLabel() {
        matchModeLabel.innerHTML = `
            <span style="color: ${contentMatchMode ? '#4caf50' : '#888'};">
                题面匹配模式 ${contentMatchMode ? '(开启)' : '(关闭)'}
            </span>
        `;
    }

    updateMatchModeLabel();

    matchModeRow.appendChild(matchModeCheckbox);
    matchModeRow.appendChild(matchModeLabel);
    autoFillPanel.appendChild(matchModeRow);

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