let jsonData = {
}  // 单词表

let bucketLoaded = false;
let bucketError = null;
let autoPkIntervalId = null;
let autoPkDelay = 10;
let autoPkPanel = null;

function loadBucketFromServer() {
    try {
        fetch('http://127.0.0.1:5290/bucket-detail-info', { cache: 'no-cache' })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(data => {
                jsonData = data;
                bucketLoaded = true;
                bucketError = null;
                updateAutoPkPanelStatus();
                console.log('单词PK词库加载成功');
            })
            .catch(err => {
                bucketLoaded = false;
                bucketError = err.message || String(err);
                updateAutoPkPanelStatus();
                console.error('单词PK词库加载失败:', err);
            });
    } catch (e) {
        bucketLoaded = false;
        bucketError = e.message || String(e);
        updateAutoPkPanelStatus();
        console.error('单词PK词库加载异常:', e);
    }
}

function findBestMatchIndex(word, candidates) {
    if (!jsonData || !jsonData.data || !jsonData.data.contentList || !jsonData.data.contentList[0] || !jsonData.data.contentList[0].entryList) {
        return 0;
    }
    // 1. 在 JSON 中查找单词的中文释义或英文单词
    let targetMeaning = '';
    let isChineseInput = /[\u4e00-\u9fff]/.test(word); // 判断输入是否为中文

    for (let entry of jsonData.data.contentList[0].entryList) {
        if (isChineseInput) {
            // 如果输入是中文，查找该中文对应的英文单词
            if (entry.paraphrase.includes(word)) {
                targetMeaning = entry.entry; // 英文单词
                break;
            }
        } else {
            // 如果输入是英文，查找该英文的中文释义
            if (entry.entry.toLowerCase() === word.toLowerCase()) {
                targetMeaning = entry.paraphrase; // 中文释义
                break;
            }
        }
    }

    if (!targetMeaning) {
        return 0; // 未找到单词，返回-1
    }

    // 2. 计算每个候选词的匹配度
    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        let score = 0;

        // 简单匹配：完全匹配得最高分
        if (candidate.toLowerCase() === targetMeaning.toLowerCase()) {
            score = 100;
        } else {
            // 部分匹配：计算公共字符数比例
            const targetWords = targetMeaning.split(/[\s，；,;]/).filter(w => w);
            const candidateWords = candidate.split(/[\s，；,;]/).filter(w => w);

            let matchedWords = 0;
            for (let tw of targetWords) {
                for (let cw of candidateWords) {
                    if (tw.toLowerCase() === cw.toLowerCase()) {
                        matchedWords++;
                        break;
                    }
                }
            }
            score = (matchedWords / Math.max(targetWords.length, candidateWords.length)) * 100;
        }

        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }

    return bestIndex;
}

const auto = () => {
    let word = document.getElementsByClassName('u3-pk-core__cn')[0].innerHTML
    let l = []
    let items = document.getElementsByClassName('u3-pk-core__text')
    Array.from(items).forEach(e => l.push(e.innerHTML))
    const result = findBestMatchIndex(word, l);
    items[result].click();
    items[result].parentNode.click();
    items[result].parentNode.parentNode.click();
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
    messageDiv.textContent = 'Auto366注入成功，请点击控制面板的开始pk后点击页面中的开始PK按钮，并保持天学网在前台运行';
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

function startAutoPk() {
    if (autoPkIntervalId) {
        clearInterval(autoPkIntervalId);
        autoPkIntervalId = null;
    }
    autoPkIntervalId = setInterval(auto, autoPkDelay);
    updateAutoPkPanelStatus();
}

function stopAutoPk() {
    if (autoPkIntervalId) {
        clearInterval(autoPkIntervalId);
        autoPkIntervalId = null;
    }
    updateAutoPkPanelStatus();
}

function createAutoPkPanel() {
    if (autoPkPanel) return;
    autoPkPanel = document.createElement('div');
    autoPkPanel.style.position = 'fixed';
    autoPkPanel.style.right = '20px';
    autoPkPanel.style.bottom = '80px';
    autoPkPanel.style.width = '260px';
    autoPkPanel.style.background = 'rgba(0,0,0,0.8)';
    autoPkPanel.style.color = '#fff';
    autoPkPanel.style.borderRadius = '8px';
    autoPkPanel.style.padding = '10px';
    autoPkPanel.style.zIndex = '9999';
    autoPkPanel.style.cursor = 'move';

    const header = document.createElement('div');
    header.textContent = '单词PK自动化控制面板';
    header.style.fontSize = '14px';
    header.style.fontWeight = 'bold';
    header.style.marginBottom = '8px';
    autoPkPanel.appendChild(header);

    const delayRow = document.createElement('div');
    delayRow.style.display = 'flex';
    delayRow.style.alignItems = 'center';
    delayRow.style.marginBottom = '6px';
    const delayLabel = document.createElement('span');
    delayLabel.textContent = '间隔(ms)：';
    delayLabel.style.fontSize = '12px';
    const delayInput = document.createElement('input');
    delayInput.type = 'number';
    delayInput.value = String(autoPkDelay);
    delayInput.style.flex = '1';
    delayInput.style.marginLeft = '6px';
    delayInput.style.fontSize = '12px';
    delayInput.addEventListener('change', () => {
        const v = parseInt(delayInput.value, 10);
        if (Number.isFinite(v) && v > 0) {
            autoPkDelay = v;
            if (autoPkIntervalId) {
                startAutoPk();
            }
        }
    });
    delayRow.appendChild(delayLabel);
    delayRow.appendChild(delayInput);
    autoPkPanel.appendChild(delayRow);

    const statusRow = document.createElement('div');
    statusRow.style.fontSize = '12px';
    statusRow.style.marginBottom = '6px';
    statusRow.id = 'auto-pk-status';
    autoPkPanel.appendChild(statusRow);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '6px';

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'auto-pk-toggle';
    toggleBtn.textContent = '开始PK';
    toggleBtn.style.flex = '1';
    toggleBtn.style.fontSize = '12px';
    toggleBtn.addEventListener('click', () => {
        if (autoPkIntervalId) {
            stopAutoPk();
        } else {
            startAutoPk();
        }
    });

    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '重载词库';
    reloadBtn.style.flex = '1';
    reloadBtn.style.fontSize = '12px';
    reloadBtn.addEventListener('click', () => {
        bucketLoaded = false;
        bucketError = null;
        updateAutoPkPanelStatus();
        loadBucketFromServer();
    });

    btnRow.appendChild(toggleBtn);
    btnRow.appendChild(reloadBtn);
    autoPkPanel.appendChild(btnRow);

    document.body.appendChild(autoPkPanel);

    // 简单拖拽
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    autoPkPanel.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - autoPkPanel.offsetLeft;
        offsetY = e.clientY - autoPkPanel.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        autoPkPanel.style.left = (e.clientX - offsetX) + 'px';
        autoPkPanel.style.top = (e.clientY - offsetY) + 'px';
        autoPkPanel.style.right = 'auto';
        autoPkPanel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    updateAutoPkPanelStatus();
}

function updateAutoPkPanelStatus() {
    if (!autoPkPanel) return;
    const statusEl = document.getElementById('auto-pk-status');
    const toggleBtn = document.getElementById('auto-pk-toggle');
    if (statusEl) {
        if (bucketLoaded) {
            statusEl.textContent = '词库加载成功';
            statusEl.style.color = '#4caf50';
        } else if (bucketError) {
            statusEl.textContent = '词库加载失败: ' + bucketError;
            statusEl.style.color = '#ff9800';
        } else {
            statusEl.textContent = '词库加载中...';
            statusEl.style.color = '#ffc107';
        }
    }
    if (toggleBtn) {
        toggleBtn.textContent = autoPkIntervalId ? '停止PK' : '开始PK';
    }
}

function initAutoPk() {
    createAutoPkPanel();
    loadBucketFromServer();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        showSuccessMessage();
        initAutoPk();
    });
} else {
    showSuccessMessage();
    initAutoPk();
}
