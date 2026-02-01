let jsonData = {
}  // 单词表

let bucketLoaded = false;
let bucketError = null;
let autoPkIntervalId = null;
let autoPkDelay = 1000;
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
                setTimeout(() => {
                    console.log('自动重试加载词库...');
                    loadBucketFromServer();
                }, 1000);
            });
    } catch (e) {
        bucketLoaded = false;
        bucketError = e.message || String(e);
        updateAutoPkPanelStatus();
        console.error('单词PK词库加载异常:', e);
        setTimeout(() => {
            console.log('自动重试加载词库...');
            loadBucketFromServer();
        }, 1000);
    }
}

function normalizeText(text) {
    if (!text) return '';
    return text.trim().toLowerCase();
}

function extractMeanings(text) {
    if (!text) return [];
    const meanings = [];
    const separators = /[；;，,]/;
    const parts = text.split(separators);
    
    for (let part of parts) {
        part = part.trim();
        if (part) {
            meanings.push(part);
        }
    }
    
    if (meanings.length === 0) {
        meanings.push(text.trim());
    }
    
    return meanings;
}

function calculateSimilarity(str1, str2) {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);
    
    if (s1 === s2) return 100;
    
    if (s1.includes(s2) || s2.includes(s1)) {
        const minLen = Math.min(s1.length, s2.length);
        const maxLen = Math.max(s1.length, s2.length);
        return (minLen / maxLen) * 90;
    }
    
    const words1 = s1.split(/[\s，；,;、]/).filter(w => w.length > 0);
    const words2 = s2.split(/[\s，；,;、]/).filter(w => w.length > 0);
    
    if (words1.length === 0 || words2.length === 0) {
        let commonChars = 0;
        const minLen = Math.min(s1.length, s2.length);
        for (let i = 0; i < minLen; i++) {
            if (s1[i] === s2[i]) commonChars++;
        }
        return (commonChars / Math.max(s1.length, s2.length)) * 70;
    }
    
    let matchedWords = 0;
    for (const w1 of words1) {
        for (const w2 of words2) {
            if (w1 === w2) {
                matchedWords++;
                break;
            } else if (w1.includes(w2) || w2.includes(w1)) {
                matchedWords += 0.7;
                break;
            }
        }
    }
    
    const wordScore = (matchedWords / Math.max(words1.length, words2.length)) * 80;
    
    let commonChars = 0;
    const minLen = Math.min(s1.length, s2.length);
    for (let i = 0; i < minLen; i++) {
        if (s1[i] === s2[i]) commonChars++;
    }
    const charScore = (commonChars / Math.max(s1.length, s2.length)) * 20;
    
    return wordScore + charScore;
}

function findBestMatchIndex(word, candidates) {
    if (!jsonData || !jsonData.data) {
        return 0;
    }
    
    const isChineseInput = /[\u4e00-\u9fff]/.test(word);
    let targetMeanings = [];
    
    let entryList = [];
    if (jsonData.data.words && Array.isArray(jsonData.data.words)) {
        entryList = jsonData.data.words;
    } else if (jsonData.data.contentList && jsonData.data.contentList[0] && jsonData.data.contentList[0].entryList) {
        entryList = jsonData.data.contentList[0].entryList;
    } else {
        return 0;
    }

    if (isChineseInput) {
        for (let entry of entryList) {
            const cn = entry.cn || entry.paraphrase || '';
            if (cn && cn.includes(word)) {
                const en = entry.en || entry.entry || '';
                if (en) {
                    const meanings = extractMeanings(en);
                    targetMeanings.push(...meanings);
                    targetMeanings.push(en);
                }
            }
        }
    } else {
        const normalizedWord = normalizeText(word);
        for (let entry of entryList) {
            const en = entry.en || entry.entry || '';
            if (en && normalizeText(en) === normalizedWord) {
                const cn = entry.cn || entry.paraphrase || '';
                if (cn) {
                    const meanings = extractMeanings(cn);
                    targetMeanings.push(...meanings);
                    targetMeanings.push(cn);
                }
            }
        }
    }

    if (targetMeanings.length === 0) {
        return 0;
    }

    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (!candidate) continue;
        
        let maxScore = 0;
        
        for (const targetMeaning of targetMeanings) {
            const score = calculateSimilarity(targetMeaning, candidate);
            if (score > maxScore) {
                maxScore = score;
            }
        }
        
        if (maxScore > bestScore) {
            bestScore = maxScore;
            bestIndex = i;
        }
    }

    return bestIndex >= 0 ? bestIndex : 0;
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

    const presetRow = document.createElement('div');
    presetRow.style.display = 'flex';
    presetRow.style.gap = '4px';
    presetRow.style.marginBottom = '6px';
    
    const preset1 = document.createElement('button');
    preset1.textContent = '10ms';
    preset1.title = '速度最快';
    preset1.style.flex = '1';
    preset1.style.fontSize = '11px';
    preset1.style.padding = '4px';
    preset1.addEventListener('click', () => {
        autoPkDelay = 10;
        delayInput.value = '10';
        if (autoPkIntervalId) {
            startAutoPk();
        }
    });
    
    const preset2 = document.createElement('button');
    preset2.textContent = '500ms';
    preset2.title = '均衡';
    preset2.style.flex = '1';
    preset2.style.fontSize = '11px';
    preset2.style.padding = '4px';
    preset2.addEventListener('click', () => {
        autoPkDelay = 500;
        delayInput.value = '500';
        if (autoPkIntervalId) {
            startAutoPk();
        }
    });
    
    const preset3 = document.createElement('button');
    preset3.textContent = '2000ms';
    preset3.title = '准确率最高';
    preset3.style.flex = '1';
    preset3.style.fontSize = '11px';
    preset3.style.padding = '4px';
    preset3.addEventListener('click', () => {
        autoPkDelay = 2000;
        delayInput.value = '2000';
        if (autoPkIntervalId) {
            startAutoPk();
        }
    });
    
    presetRow.appendChild(preset1);
    presetRow.appendChild(preset2);
    presetRow.appendChild(preset3);
    autoPkPanel.appendChild(presetRow);

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
