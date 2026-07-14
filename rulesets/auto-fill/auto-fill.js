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
let supportChoiceQuestions = localStorage.getItem('supportChoiceQuestions') === 'true' || false;
let rawAnswerData = [];
let elementAnswerMap = new Map();
const MAX_LOG_MESSAGES = 200;  // 最大日志数量

// ===== 时间修改（参考 auto-pk / auto-listening，对应本地代理 /fill-time 端点）=====
let fillTimeModEnabled = localStorage.getItem('fillTimeModEnabled') === 'true';
let fillTimeModSeconds = (function() {
    var raw = localStorage.getItem('fillTimeModSeconds');
    if (raw === null || raw === '') return null;
    var v = parseInt(raw, 10);
    return Number.isFinite(v) ? v : null;
})();
const FILL_TIME_INT32_MIN = -2147483648;
const FILL_TIME_INT32_MAX = 2147483647;

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
                                elementId: i.elementId,
                                questionNum: questionNum
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

                // 题号→答案映射表（用于选择题题号精确匹配）
                window.questionNumAnswerMap = answerMap;

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

    // 子串匹配：当一个文本是另一个的子串时，给予高分
    // 解决英文题干→中文答案、中文题干→英文答案的长度差异问题
    const shorter = c1.length <= c2.length ? c1 : c2;
    const longer = c1.length <= c2.length ? c2 : c1;
    if (shorter.length >= 3) {
        if (longer.startsWith(shorter) || longer.endsWith(shorter)) return 90;
        if (shorter.length >= 5 && longer.includes(shorter)) {
            const ratio = shorter.length / longer.length;
            return 80 + ratio * 10;
        }
    }

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

// 选择题自动选择：遍历所有选项，匹配答案文本后点击
async function fillChoiceQuestions() {
    let filledCount = 0;

    const optionElements = document.querySelectorAll('.u3-option__content.is-text');
    addLogMessage(`选择题检测: 找到 ${optionElements.length} 个选项元素`, 'info');
    if (optionElements.length === 0) return 0;

    // 按题目分组：从第一个未分组的选项开始，向上找最低的包含>=2个选项的祖先作为容器
    const questionContainers = [];
    const assignedOptions = new Set();

    for (let i = 0; i < optionElements.length; i++) {
        if (assignedOptions.has(i)) continue;
        const opt = optionElements[i];

        let container = null;
        let el = opt.parentElement;
        while (el && el !== document.body) {
            const optCount = el.querySelectorAll('.u3-option__content.is-text').length;
            if (optCount >= 2) {
                container = el;
                break;
            }
            el = el.parentElement;
        }
        if (!container) continue;

        let finalContainer = container;
        const totalOpts = container.querySelectorAll('.u3-option__content.is-text').length;
        if (totalOpts > 6) {
            for (const child of container.children) {
                const childOpts = child.querySelectorAll('.u3-option__content.is-text').length;
                if (childOpts >= 2 && childOpts <= 6) {
                    finalContainer = child;
                    break;
                }
            }
        }

        questionContainers.push(finalContainer);
        for (let j = i; j < optionElements.length; j++) {
            if (finalContainer.contains(optionElements[j])) {
                assignedOptions.add(j);
            }
        }
    }

    addLogMessage(`选择题检测: 找到 ${questionContainers.length} 个题目容器`, 'info');

    for (let qi = 0; qi < questionContainers.length; qi++) {
        const container = questionContainers[qi];
        const options = container.querySelectorAll('.u3-option__content.is-text');
        if (options.length === 0) continue;

        // 获取题号（多层回退检测）
        let questionNum = 0;
        // 方法1: 标准题号元素
        const noEl = container.querySelector('.u3-question-no, .u3-question__no, [class*="question-no"]');
        if (noEl) {
            const parsed = parseInt(noEl.textContent.trim());
            if (!isNaN(parsed) && parsed > 0) questionNum = parsed;
        }
        // 方法2: u3-input__prepared 元素（填空题使用的题号标记）
        if (!questionNum) {
            const preparedEl = container.querySelector('.u3-input__prepared');
            if (preparedEl) {
                const parsed = parseInt(preparedEl.textContent.trim());
                if (!isNaN(parsed) && parsed > 0) questionNum = parsed;
            }
        }
        // 方法3: data 属性
        if (!questionNum) {
            const dataNum = container.getAttribute('data-question-no') || container.getAttribute('data-index');
            if (dataNum) {
                const parsed = parseInt(dataNum);
                if (!isNaN(parsed) && parsed > 0) questionNum = parsed;
            }
        }
        // 方法4: 向上查找父容器中的题号
        if (!questionNum) {
            let parent = container.parentElement;
            for (let up = 0; up < 5 && parent; up++) {
                const parentNoEl = parent.querySelector('.u3-question-no, .u3-question__no, [class*="question-no"], .u3-input__prepared');
                if (parentNoEl) {
                    const parsed = parseInt(parentNoEl.textContent.trim());
                    if (!isNaN(parsed) && parsed > 0) {
                        questionNum = parsed;
                        break;
                    }
                }
                parent = parent.parentElement;
            }
        }
        // 回退: 使用容器索引
        if (!questionNum) questionNum = qi + 1;

        // 获取题目文本（多层回退），排除选项内的文本
        let questionText = '';
        // 方法1: .u3-question-text（排除选项内的）
        const allTextEls = container.querySelectorAll('.u3-question-text');
        for (const textEl of allTextEls) {
            if (textEl.closest('.u3-option__content')) continue;
            questionText = textEl.textContent.trim();
            break;
        }
        // 方法2: .u3-question-stem 或 .u3-stem
        if (!questionText) {
            const stemEl = container.querySelector('.u3-question-stem, .u3-stem, [class*="question-stem"]');
            if (stemEl) questionText = stemEl.textContent.trim();
        }
        // 方法3: 向上查找父容器中的题目文本
        if (!questionText) {
            let parent = container.parentElement;
            for (let up = 0; up < 3 && parent; up++) {
                const parentTextEl = parent.querySelector('.u3-question-text, .u3-question-stem, [class*="question-text"]');
                if (parentTextEl && !parentTextEl.closest('.u3-option__content')) {
                    questionText = parentTextEl.textContent.trim();
                    break;
                }
                parent = parent.parentElement;
            }
        }
        // 方法4: data 属性
        if (!questionText) {
            questionText = container.getAttribute('data-question-text') || container.getAttribute('data-stem') || '';
        }

        // 收集选项信息：原始文本、清洗文本（去字母前缀）、字母标签
        const optionsData = [];
        for (const opt of options) {
            const optTextEl = opt.querySelector('.u3-question-text');
            const rawText = optTextEl ? optTextEl.textContent.trim() : opt.textContent.trim();
            // 从选项文本中提取字母标签（如 "C.beer" → letter="C", cleanText="beer"）
            const letterMatch = rawText.match(/^([A-Fa-f])[.、\s]+/);
            const letterLabel = letterMatch ? letterMatch[1].toUpperCase() : null;
            const cleanText = letterMatch ? rawText.substring(letterMatch[0].length).trim() : rawText;
            optionsData.push({ element: opt, rawText, cleanText, letterLabel });
        }

        const allChecked = optionsData.every(od => od.element.classList.contains('is-checked'));
        if (allChecked) continue;

        const cleanTextsLower = optionsData.map(od => od.cleanText.replace(/\s+/g, '').toLowerCase());

        // 辅助函数：判断答案文本是否匹配某个选项
        // answerText: 答案文本（可能短如"scent"，也可能长如"greet the new day with songs"）
        // optCleanText: 选项清洗后的文本（通常较短，如"scent", "greet", "kingdom"）
        function answerMatchesOption(answerText, optCleanText) {
            const ansLower = answerText.toLowerCase().trim();
            const optLower = optCleanText.toLowerCase().trim();
            const ansClean = ansLower.replace(/\s+/g, '');
            const optClean = optLower.replace(/\s+/g, '');

            // 精确匹配
            if (ansClean === optClean) return true;

            // 答案较短时：答案包含选项（如 "C.beer" → "cbeer" 包含 "beer"）
            if (ansClean.length <= optClean.length + 5 && ansClean.includes(optClean)) return true;

            // 答案比选项长很多时：只有答案以选项文本开头才匹配
            // 这表示答案是选项的前缀截断（如 "greet" 匹配 "greet the new day with songs"）
            // 但不会误匹配中间出现的词（如 "scent" 不匹配 "breathe in the sweet scent"）
            if (ansLower.length > optLower.length + 5 && ansLower.startsWith(optLower)) return true;

            return false;
        }

        // 辅助函数：从候选项中选择最佳答案
        function pickBestAnswer(candidatesList) {
            if (candidatesList.length === 0) return null;
            if (candidatesList.length === 1) return candidatesList[0].answer;

            // 按相似度降序，相同时优先选更长的答案（更具体的描述，消歧效果更好）
            candidatesList.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return (b.answer.length || 0) - (a.answer.length || 0);
            });
            return candidatesList[0].answer;
        }

        // === 策略1: 内容匹配 — 用题目文本在答案库中查找，并验证答案出现在选项中 ===
        let targetAnswer = null;
        if (questionText) {
            // 首先尝试 findAnswerByContent（相似度>60%的最佳匹配）
            const match = findAnswerByContent(questionText);
            if (match) {
                for (let oi = 0; oi < optionsData.length; oi++) {
                    if (answerMatchesOption(match.answer, optionsData[oi].cleanText)) {
                        targetAnswer = optionsData[oi].cleanText;
                        break;
                    }
                }
            }
            // 如果最佳匹配的答案不在选项中，遍历所有候选项（相似度>40%）
            if (!targetAnswer) {
                for (const item of rawAnswerData) {
                    const matchText = item.questionText || item.question || '';
                    if (!matchText) continue;
                    const sim = calculateTextSimilarity(questionText, matchText);
                    if (sim < 40) continue;
                    for (let oi = 0; oi < optionsData.length; oi++) {
                        if (answerMatchesOption(item.answer, optionsData[oi].cleanText)) {
                            targetAnswer = optionsData[oi].cleanText;
                            break;
                        }
                    }
                    if (targetAnswer) break;
                }
            }
        }

        // === 策略2: 选项反查 — 严格防止跨题误匹配 ===
        // 只在以下情况接受候选项：
        // A) 题目文本存在 且 候选项的题目文本相似度 >= 20%
        // B) 题目文本不存在 且 答案与选项精确匹配（排除长答案的前缀匹配，防止跨题污染）
        if (!targetAnswer) {
            const candidates = [];
            const hasQText = !!questionText;
            for (const item of rawAnswerData) {
                if (!item.answer) continue;
                // 检查答案是否匹配某个选项
                let matchIndex = -1;
                for (let oi = 0; oi < optionsData.length; oi++) {
                    if (answerMatchesOption(item.answer, optionsData[oi].cleanText)) {
                        matchIndex = oi;
                        break;
                    }
                }
                if (matchIndex === -1) continue;

                if (hasQText) {
                    // 路径A：题目文本存在时，必须验证相似度 >= 20%
                    const itemQuestionText = item.questionText || item.question || '';
                    if (!itemQuestionText) continue;
                    const score = calculateTextSimilarity(questionText, itemQuestionText);
                    if (score < 20) continue; // 相似度过低说明是不同题目，拒绝
                    candidates.push({ answer: item.answer, score, matchIndex });
                } else {
                    // 路径B：题目文本不存在时，只接受精确匹配或短答案包含匹配
                    // 拒绝长答案的前缀匹配（如 "greet the new day" 不应匹配 "greet"）
                    const itemAns = item.answer.replace(/\s+/g, '').toLowerCase();
                    const optText = optionsData[matchIndex].cleanText.replace(/\s+/g, '').toLowerCase();
                    const isExact = itemAns === optText;
                    const isShort = itemAns.length <= optText.length + 5;
                    if (isExact || isShort) {
                        candidates.push({ answer: item.answer, score: 0, matchIndex });
                    }
                }
            }
            targetAnswer = pickBestAnswer(candidates);
        }

        // === 策略3: 字母标签匹配 — 答案为单字母时直接匹配选项的字母标签 ===
        if (!targetAnswer) {
            for (const item of rawAnswerData) {
                if (!item.answer) continue;
                const trimmed = item.answer.trim();
                if (!/^[A-Fa-f]$/.test(trimmed)) continue;
                const letter = trimmed.toUpperCase();
                const matchIdx = optionsData.findIndex(od => od.letterLabel === letter);
                if (matchIdx !== -1) {
                    targetAnswer = optionsData[matchIdx].cleanText;
                    break;
                }
            }
        }

        addLogMessage(`选择题 ${questionNum}: 题目="${questionText || '(空)'}", 答案="${targetAnswer || '未找到'}", 选项=[${optionsData.map(od => od.cleanText).join(', ')}]`, 'info');

        if (!targetAnswer) continue;

        // === 选择匹配的选项并点击 ===
        let matched = false;

        for (let oi = 0; oi < optionsData.length; oi++) {
            const od = optionsData[oi];
            if (od.element.classList.contains('is-checked')) continue;
            if (answerMatchesOption(targetAnswer, od.cleanText)) {
                od.element.click();
                filledCount++;
                addLogMessage(`选择题 ${questionNum} 选中: ${od.rawText}`, 'success');
                await wait1(50);
                matched = true;
                break;
            }
        }

        // 字母回退：答案为单字母时按位置选择
        if (!matched && /^[A-Fa-f]$/.test(targetAnswer.trim())) {
            const letterIndex = targetAnswer.trim().toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
            if (letterIndex < optionsData.length) {
                const od = optionsData[letterIndex];
                if (!od.element.classList.contains('is-checked')) {
                    od.element.click();
                    filledCount++;
                    addLogMessage(`选择题 ${questionNum} 按字母 ${targetAnswer.trim().toUpperCase()} 选中: ${od.rawText}`, 'success');
                    await wait1(50);
                }
            }
        }
    }

    return filledCount;
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

    // ========== 选择题自动选择 ==========
    const choiceFilledCount = supportChoiceQuestions ? await fillChoiceQuestions() : 0;

    // ========== 填空题自动填写 ==========
    const preparedElements = document.getElementsByClassName('u3-input__prepared');
    const inputElements = getInputs(document);

    let filledCount = 0;

    if (contentMatchMode) {
        addLogMessage('使用内容匹配模式', 'info');
        
        const questionTexts = document.getElementsByClassName('u3-question-text');
        const processedScopes = new Set();
        
        for (let i = 0; i < questionTexts.length; i++) {
            const questionTextElement = questionTexts[i];
            let scopeEl = questionTextElement;
            let containerInputs = getInputs(scopeEl);
            for (let up = 0; up < 6 && containerInputs.length <= 1 && scopeEl && scopeEl.parentElement; up++) {
                scopeEl = scopeEl.parentElement;
                containerInputs = getInputs(scopeEl);
            }

            if (containerInputs.length > 0) {
                // 跳过已处理过的容器（填空在题干中间时会有多个 .u3-question-text）
                if (processedScopes.has(scopeEl)) continue;
                processedScopes.add(scopeEl);

                // 从整个题目容器获取完整题干文本（包含填空前后的部分）
                // 克隆后移除 input/textarea/button/选项/题号等非题干元素
                const clone = scopeEl.cloneNode(true);
                clone.querySelectorAll('input, textarea, button, .u3-option__content, .u3-input__prepared, [contenteditable]').forEach(el => el.remove());
                const questionText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
                const cleanQuestionText = questionText.replace(/分值\d+分\s*/g, '').replace(/^\d+[\s\.\)]*/, '').trim();

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

    if (choiceFilledCount > 0) {
        addLogMessage('已选择 ' + choiceFilledCount + ' 个选择题答案', 'success');
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

// 时间修改 —— 把"启用/秒数"状态经本地 bucket server 推给代理层
// 代理层据此改写 fill 提交的 duration（落库时 ×1000 转毫秒）
let FillTimeMod = {
    bucketBase: function() {
        // 从 customBucketUrl 提取 origin；为空时回退默认端口
        // 不用 new URL() 以兼容 local:// 等 protocol
        var full = customBucketUrl || '';
        if (full) {
            var m = full.match(/^(https?:\/\/[^\/]+)/);
            if (m) return m[1];
        }
        return 'http://127.0.0.1:5290';
    },
    push: function() {
        var payload = {
            enabled: fillTimeModEnabled === true,
            seconds: (fillTimeModSeconds === null || fillTimeModSeconds === undefined)
                ? null : fillTimeModSeconds
        };
        try {
            fetch(FillTimeMod.bucketBase() + '/fill-time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                cache: 'no-cache'
            }).then(function(r) { return r.json(); })
              .then(function(res) {
                  if (res && res.success) {
                      addLogMessage('[时间修改] 状态已同步到代理层 | 启用='
                          + payload.enabled + ' 秒数=' + (payload.seconds === null ? '-' : payload.seconds), 'success');
                  } else {
                      addLogMessage('[时间修改] 同步失败(代理层返回异常)', 'warning');
                  }
              })
              .catch(function(e) {
                  addLogMessage('[时间修改] 同步失败：连不上本地服务(' + e.message + ')，确认代理已开启', 'warning');
              });
        } catch (e) {
            addLogMessage('[时间修改] 同步异常：' + e.message, 'warning');
        }
    },
    install: function() {
        FillTimeMod.push();
    }
};

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

    // 支持选择题复选框（依赖内容匹配模式）
    const supportChoiceRow = document.createElement('div');
    supportChoiceRow.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 4px 4px 4px 16px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
        opacity: ${contentMatchMode ? '1' : '0.5'};
    `;

    const supportChoiceCheckbox = document.createElement('input');
    supportChoiceCheckbox.type = 'checkbox';
    supportChoiceCheckbox.id = 'support-choice-questions';
    supportChoiceCheckbox.checked = supportChoiceQuestions;
    supportChoiceCheckbox.disabled = !contentMatchMode;
    supportChoiceCheckbox.style.cssText = `
        margin-right: 8px;
        cursor: ${contentMatchMode ? 'pointer' : 'not-allowed'};
    `;
    supportChoiceCheckbox.addEventListener('change', (e) => {
        if (!contentMatchMode) {
            e.target.checked = false;
            return;
        }
        supportChoiceQuestions = e.target.checked;
        localStorage.setItem('supportChoiceQuestions', supportChoiceQuestions.toString());
        addLogMessage('支持选择题: ' + (supportChoiceQuestions ? '已启用' : '已禁用'), 'info');
        updateSupportChoiceLabel();
    });

    const supportChoiceLabel = document.createElement('label');
    supportChoiceLabel.htmlFor = 'support-choice-questions';
    supportChoiceLabel.style.cssText = `
        font-size: 11px;
        cursor: ${contentMatchMode ? 'pointer' : 'not-allowed'};
        flex: 1;
    `;

    function updateSupportChoiceLabel() {
        const enabled = contentMatchMode && supportChoiceQuestions;
        const color = enabled ? '#4caf50' : '#888';
        const statusText = supportChoiceQuestions ? (contentMatchMode ? '(开启)' : '(已禁用-需先开启内容匹配)') : '(关闭)';
        supportChoiceLabel.innerHTML = `
            <span style="color: ${color};">
                支持选择题(需要先开启内容匹配) ${statusText}
            </span>
        `;
    }

    function updateSupportChoiceState() {
        const enabled = contentMatchMode;
        supportChoiceCheckbox.disabled = !enabled;
        supportChoiceRow.style.opacity = enabled ? '1' : '0.5';
        supportChoiceCheckbox.style.cursor = enabled ? 'pointer' : 'not-allowed';
        supportChoiceLabel.style.cursor = enabled ? 'pointer' : 'not-allowed';
        if (!enabled) {
            // 内容匹配关闭时，自动取消支持选择题
            if (supportChoiceQuestions) {
                supportChoiceQuestions = false;
                localStorage.setItem('supportChoiceQuestions', 'false');
            }
            supportChoiceCheckbox.checked = false;
        }
        updateSupportChoiceLabel();
    }

    updateSupportChoiceLabel();

    // 内容匹配模式变化时同步支持选择题状态
    matchModeCheckbox.addEventListener('change', updateSupportChoiceState);

    supportChoiceRow.appendChild(supportChoiceCheckbox);
    supportChoiceRow.appendChild(supportChoiceLabel);
    autoFillPanel.appendChild(supportChoiceRow);

    // ===== 时间修改行（参考 auto-pk / auto-listening）=====
    const timeModRow = document.createElement('div');
    timeModRow.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 4px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
        gap: 4px;
    `;

    const timeModLabel = document.createElement('span');
    timeModLabel.textContent = '时间修改';
    timeModLabel.style.cssText = `font-size: 11px; font-weight: 600; color: #fff; margin-right: 4px;`;

    const timeModEnable = document.createElement('input');
    timeModEnable.type = 'checkbox';
    timeModEnable.checked = fillTimeModEnabled;
    timeModEnable.style.cssText = `margin: 0 2px; cursor: pointer;`;

    function ftMakeNumInput() {
        const el = document.createElement('input');
        el.type = 'number';
        el.step = '1';
        el.min = String(FILL_TIME_INT32_MIN);
        el.max = String(FILL_TIME_INT32_MAX);
        el.placeholder = '-';
        el.style.cssText = `
            width: 52px; font-size: 11px; text-align: center;
            background: rgba(255,255,255,0.2); color: #fff;
            border: 1px solid rgba(255,255,255,0.3); border-radius: 3px;
            padding: 2px 4px;
        `;
        el.disabled = !fillTimeModEnabled;
        el.style.opacity = fillTimeModEnabled ? '1' : '0.5';
        return el;
    }
    const ftMinInput = ftMakeNumInput();
    const ftSecInput = ftMakeNumInput();

    function ftFillFromTotal() {
        if (fillTimeModSeconds === null || fillTimeModSeconds === undefined) {
            ftMinInput.value = '';
            ftSecInput.value = '';
            return;
        }
        const total = fillTimeModSeconds;
        const sign = total < 0 ? -1 : 1;
        const abs = Math.abs(total);
        ftMinInput.value = String(Math.floor(abs / 60) * sign);
        ftSecInput.value = String((abs % 60) * sign);
    }
    ftFillFromTotal();

    function ftCommitFromInputs() {
        const mRaw = ftMinInput.value.trim();
        const sRaw = ftSecInput.value.trim();
        if (mRaw === '' && sRaw === '') {
            fillTimeModSeconds = null;
            localStorage.removeItem('fillTimeModSeconds');
            addLogMessage('[时间修改] 时间已清空（提交不会被修改）', 'info');
            FillTimeMod.push();
            return;
        }
        let m = mRaw === '' ? 0 : parseInt(mRaw, 10);
        let s = sRaw === '' ? 0 : parseInt(sRaw, 10);
        if (!Number.isFinite(m)) m = 0;
        if (!Number.isFinite(s)) s = 0;
        let total = m * 60 + s;
        if (total < FILL_TIME_INT32_MIN) total = FILL_TIME_INT32_MIN;
        if (total > FILL_TIME_INT32_MAX) total = FILL_TIME_INT32_MAX;
        fillTimeModSeconds = total;
        localStorage.setItem('fillTimeModSeconds', String(total));
        ftFillFromTotal();
        addLogMessage('[时间修改] 提交用时设为 ' + m + '分' + s + '秒 = ' + total + '秒', 'info');
        FillTimeMod.push();
    }

    timeModEnable.addEventListener('change', () => {
        fillTimeModEnabled = timeModEnable.checked;
        localStorage.setItem('fillTimeModEnabled', String(fillTimeModEnabled));
        ftMinInput.disabled = !fillTimeModEnabled;
        ftSecInput.disabled = !fillTimeModEnabled;
        ftMinInput.style.opacity = fillTimeModEnabled ? '1' : '0.5';
        ftSecInput.style.opacity = fillTimeModEnabled ? '1' : '0.5';
        addLogMessage('[时间修改] ' + (fillTimeModEnabled ? '已启用' : '已禁用')
            + (fillTimeModEnabled && fillTimeModSeconds === null ? '（时间未填，提交不会被修改）' : ''), 'info');
        FillTimeMod.push();
    });
    ftMinInput.addEventListener('change', ftCommitFromInputs);
    ftSecInput.addEventListener('change', ftCommitFromInputs);

    const ftMinSuffix = document.createElement('span');
    ftMinSuffix.textContent = '分';
    ftMinSuffix.style.cssText = `font-size: 11px; color: #ccc; margin: 0 4px 0 2px;`;

    const ftSecSuffix = document.createElement('span');
    ftSecSuffix.textContent = '秒';
    ftSecSuffix.style.cssText = `font-size: 11px; color: #ccc; margin-left: 2px;`;

    timeModRow.appendChild(timeModLabel);
    timeModRow.appendChild(timeModEnable);
    timeModRow.appendChild(ftMinInput);
    timeModRow.appendChild(ftMinSuffix);
    timeModRow.appendChild(ftSecInput);
    timeModRow.appendChild(ftSecSuffix);
    autoFillPanel.appendChild(timeModRow);

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
    FillTimeMod.install();
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