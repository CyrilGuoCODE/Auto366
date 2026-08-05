/*
 * auto-fill-once.js
 * 基于 auto-fill.js，唯一的区别：跟读朗读的 TTS 音频只播放一遍后停止，不再循环。
 * 适用于需要音频播放完后自然结束而不重复播放的场景。
 *
 * 与 auto-fill.js 的差异：
 *   - audioSource.loop = false（原为 true）
 *   - 录音等待时间改为 audioDuration + 1.5s 缓冲（原为 audioDuration * 2）
 */

let answers = [];
let bucketLoaded = false;
let bucketError = null;
let autoFillIntervalId = null;
let autoFillDelay = 200;
let autoFillPanel = null;
let customBucketUrl = localStorage.getItem('customFillBucketUrl') || '';
let logPanel = null;
let logMessages = [];
let contentMatchMode = localStorage.getItem('contentMatchMode') === 'true' || false;
let supportChoiceQuestions = localStorage.getItem('supportChoiceQuestions') === 'true' || false;
let supportReadAlong = localStorage.getItem('supportReadAlong') === 'true' || false;
let isReadAlongProcessing = false;
let fillExecMode = localStorage.getItem('fillExecMode') || 'auto'; // 执行模式：auto(按题型自动) | serial(强制串行) | concurrent(强制并发)
let isWorking = false; // 新题型（u3-input 填空）的 work() 串行重入锁：上一轮未结束时不允许重入
let readAlongAborted = false;
let rawAnswerData = [];
let elementAnswerMap = new Map();
const LOG_ROW_HEIGHT = 22;

// ===== 时间修改 =====
let fillTimeModEnabled = localStorage.getItem('fillTimeModEnabled') === 'true';
let fillTimeModSeconds = (function() {
    var raw = localStorage.getItem('fillTimeModSeconds');
    if (raw === null || raw === '') return null;
    var v = parseInt(raw, 10);
    return Number.isFinite(v) ? v : null;
})();
const FILL_TIME_INT32_MIN = -2147483648;
const FILL_TIME_INT32_MAX = 2147483647;

// ===== 控分功能：设定错题数量，随机选中题目填入其他题目的答案 =====
let fillScoreControlEnabled = localStorage.getItem('fillScoreControlEnabled') === 'true';
let fillScoreControlWrongCount = (function() {
    var raw = localStorage.getItem('fillScoreControlWrongCount');
    if (raw === null || raw === '') return 0;
    var v = parseInt(raw, 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
})();
let wrongQuestionSet = new Set(); // 本轮随机选中的错题题号（1-based）

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

                window.multiAnswerMap = multiAnswerMap;
                window.elementAnswerMap = elementAnswerMap;
                window.questionNumAnswerMap = answerMap;

                bucketLoaded = true;
                bucketError = null;
                updateAutoFillPanelStatus();
                addLogMessage('填空答案库加载成功，共 ' + answers.length + ' 个题目', 'success');

                const multiBlankCount = Array.from(multiAnswerMap.values()).filter(list => list.length > 1).length;
                if (multiBlankCount > 0) {
                    addLogMessage(`检测到 ${multiBlankCount} 个多空/多选题`, 'info');
                    for (let [qNum, ansList] of multiAnswerMap) {
                        if (ansList.length > 1) {
                            const answerTexts = ansList.map(a => a.answer).join(', ');
                            addLogMessage(`  题${qNum}: ${ansList.length}个答案 → [${answerTexts}]`, 'info');
                        }
                    }
                }

                addLogMessage('内容匹配模式: ' + (contentMatchMode ? '已启用' : '已禁用'), 'info');
                addLogMessage('支持选择题: ' + (supportChoiceQuestions ? '已启用' : '已禁用'), 'info');
                addLogMessage('支持跟读朗读: ' + (supportReadAlong ? '已启用' : '已禁用'), 'info');
                addLogMessage('[单次播放] 跟读朗读音频只播放一遍后停止，不再循环', 'info');

                // 答案库加载后重建控分计划（若已启用控分）
                if (fillScoreControlEnabled && fillScoreControlWrongCount > 0 && autoFillIntervalId) {
                    buildWrongPlan(answers.length || rawAnswerData.length);
                    if (wrongQuestionSet.size > 0) {
                        addLogMessage(`[控分] 答案库已加载，随机错 ${wrongQuestionSet.size} 题: 题号 [${[...wrongQuestionSet].sort((a, b) => a - b).join(', ')}]`, 'info');
                    }
                }
                console.log('填空答案库加载成功，共' + answers.length + '个题目');
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

function findAnswerByReadText(readText) {
    if (!rawAnswerData || rawAnswerData.length === 0) return null;
    const normalizedRead = readText.trim().toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    rawAnswerData.forEach((item) => {
        const answerText = (item.answer || '').trim();
        const normalizedAnswer = answerText.toLowerCase();
        let score = 0;

        if (normalizedRead === normalizedAnswer) {
            score = 100;
        } else if (normalizedAnswer.length > 0 && (normalizedRead.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedRead))) {
            score = Math.min(normalizedRead.length, normalizedAnswer.length) / Math.max(normalizedRead.length, normalizedAnswer.length) * 90;
        } else {
            score = calculateTextSimilarity(readText, answerText);
        }

        if (score > bestScore && score > 20) {
            bestScore = score;
            bestMatch = {
                answer: answerText,
                similarity: score,
                index: item.index,
                answerIndex: item.answerIndex,
                questionNum: item.questionNum
            };
        }
    });
    return bestMatch;
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
        if (similarity > bestScore && similarity > 60) {
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

async function fillChoiceQuestions() {
    let filledCount = 0;

    const optionElements = document.querySelectorAll('.u3-option__content.is-text, .u3-option__content--default, .u3-option-img');
    addLogMessage(`选择题检测: 找到 ${optionElements.length} 个选项元素`, 'info');
    if (optionElements.length === 0) return 0;

    const questionContainers = [];
    const assignedOptions = new Set();

    for (let i = 0; i < optionElements.length; i++) {
        if (assignedOptions.has(i)) continue;
        const opt = optionElements[i];

        let container = null;
        let el = opt.parentElement;
        while (el && el !== document.body) {
            const optCount = el.querySelectorAll('.u3-option__content.is-text, .u3-option__content--default, .u3-option-img').length;
            if (optCount >= 2) {
                container = el;
                break;
            }
            el = el.parentElement;
        }
        if (!container) continue;

        let finalContainer = container;
        const totalOpts = container.querySelectorAll('.u3-option__content.is-text, .u3-option__content--default, .u3-option-img').length;
        if (totalOpts > 6) {
            for (const child of container.children) {
                const childOpts = child.querySelectorAll('.u3-option__content.is-text, .u3-option__content--default, .u3-option-img').length;
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
        const options = container.querySelectorAll('.u3-option__content.is-text, .u3-option__content--default, .u3-option-img');
        if (options.length === 0) continue;

        let questionNum = 0;
        const noEl = container.querySelector('.u3-question-no, .u3-question__no, [class*="question-no"]');
        if (noEl) {
            const parsed = parseInt(noEl.textContent.trim());
            if (!isNaN(parsed) && parsed > 0) questionNum = parsed;
        }
        if (!questionNum) {
            const preparedEl = queryPrepared(container);
            if (preparedEl) {
                const parsed = parseInt(preparedEl.textContent.trim());
                if (!isNaN(parsed) && parsed > 0) questionNum = parsed;
            }
        }
        if (!questionNum) {
            const dataNum = container.getAttribute('data-question-no') || container.getAttribute('data-index');
            if (dataNum) {
                const parsed = parseInt(dataNum);
                if (!isNaN(parsed) && parsed > 0) questionNum = parsed;
            }
        }
        if (!questionNum) {
            let parent = container.parentElement;
            for (let up = 0; up < 5 && parent; up++) {
                const parentNoEl = parent.querySelector('.u3-question-no, .u3-question__no, [class*="question-no"], .u3-input__prepared, .u3-input__prepead');
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
        if (!questionNum) questionNum = qi + 1;

        const getCleanText = (el) => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('.u3-audioPlayer, [slot*="audio"]').forEach(e => e.remove());
            return clone.textContent.trim();
        };
        let questionText = '';
        const allTextEls = container.querySelectorAll('.u3-question-text');
        for (const textEl of allTextEls) {
            if (textEl.closest('.u3-option__content')) continue;
            questionText = getCleanText(textEl);
            break;
        }
        if (!questionText) {
            const stemEl = container.querySelector('.u3-question-stem, .u3-stem, [class*="question-stem"], .u3-choice__question--text');
            if (stemEl) questionText = getCleanText(stemEl);
        }
        if (!questionText) {
            let parent = container.parentElement;
            for (let up = 0; up < 3 && parent; up++) {
                const parentTextEl = parent.querySelector('.u3-question-text, .u3-question-stem, .u3-choice__question--text, [class*="question-text"]');
                if (parentTextEl && !parentTextEl.closest('.u3-option__content')) {
                    questionText = getCleanText(parentTextEl);
                    break;
                }
                parent = parent.parentElement;
            }
        }
        if (!questionText) {
            questionText = container.getAttribute('data-question-text') || container.getAttribute('data-stem') || '';
        }

        const optionsData = [];
        let imgOptIndex = 0;
        for (const opt of options) {
            if (opt.classList.contains('u3-option-img')) {
                const img = opt.querySelector('img');
                const src = img ? (img.getAttribute('src') || '') : '';
                const filename = src.split('/').pop().split('?')[0];
                const letterLabel = String.fromCharCode(65 + imgOptIndex);
                optionsData.push({ element: opt, rawText: filename, cleanText: filename, letterLabel });
                imgOptIndex++;
            } else {
                const optTextEl = opt.querySelector('.u3-question-text');
                const rawText = optTextEl ? optTextEl.textContent.trim() : opt.textContent.trim();
                const letterMatch = rawText.match(/^([A-Fa-f])[.、\s]+/);
                const letterLabel = letterMatch ? letterMatch[1].toUpperCase() : null;
                const cleanText = letterMatch ? rawText.substring(letterMatch[0].length).trim() : rawText;
                optionsData.push({ element: opt, rawText, cleanText, letterLabel });
            }
        }

        const allChecked = optionsData.every(od => od.element.classList.contains('is-checked'));
        if (allChecked) continue;

        function answerMatchesOption(answerText, optCleanText) {
            const ansLower = answerText.toLowerCase().trim();
            const optLower = optCleanText.toLowerCase().trim();
            const ansClean = ansLower.replace(/\s+/g, '');
            const optClean = optLower.replace(/\s+/g, '');
            if (ansClean === optClean) return true;
            if (ansClean.length <= optClean.length + 5 && ansClean.includes(optClean)) return true;
            if (ansLower.length > optLower.length + 5 && ansLower.startsWith(optLower)) return true;
            return false;
        }

        function pickBestAnswer(candidatesList) {
            if (candidatesList.length === 0) return null;
            if (candidatesList.length === 1) return candidatesList[0].answer;
            candidatesList.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return (b.answer.length || 0) - (a.answer.length || 0);
            });
            return candidatesList[0].answer;
        }

        let targetAnswer = null;
        let strategyUsed = '';
        let backendQuestionNum = null;
        if (questionText) {
            const match = findAnswerByContent(questionText);
            if (match) {
                for (let oi = 0; oi < optionsData.length; oi++) {
                    if (answerMatchesOption(match.answer, optionsData[oi].cleanText)) {
                        targetAnswer = optionsData[oi].cleanText;
                        strategyUsed = '策略1(内容匹配 ' + Math.round(match.similarity || 0) + '%)';
                        backendQuestionNum = match.questionNum;
                        break;
                    }
                }
            }
            if (!targetAnswer) {
                for (const item of rawAnswerData) {
                    const matchText = item.questionText || item.question || '';
                    if (!matchText) continue;
                    const sim = calculateTextSimilarity(questionText, matchText);
                    if (sim < 40) continue;
                    for (let oi = 0; oi < optionsData.length; oi++) {
                        if (answerMatchesOption(item.answer, optionsData[oi].cleanText)) {
                            targetAnswer = optionsData[oi].cleanText;
                            backendQuestionNum = item.questionNum;
                            break;
                        }
                    }
                    if (targetAnswer) break;
                }
            }
        }

        if (!targetAnswer) {
            const candidates = [];
            const hasQText = !!questionText;
            for (const item of rawAnswerData) {
                if (!item.answer) continue;
                let matchIndex = -1;
                for (let oi = 0; oi < optionsData.length; oi++) {
                    if (answerMatchesOption(item.answer, optionsData[oi].cleanText)) {
                        matchIndex = oi;
                        break;
                    }
                }
                if (matchIndex === -1) continue;

                if (hasQText) {
                    const itemQuestionText = item.questionText || item.question || '';
                    if (!itemQuestionText) continue;
                    const score = calculateTextSimilarity(questionText, itemQuestionText);
                    if (score < 20) continue;
                    candidates.push({ answer: item.answer, score, matchIndex });
                } else {
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
            if (targetAnswer) strategyUsed = '策略2(选项反查)';
        }

        if (!targetAnswer) {
            for (const item of rawAnswerData) {
                if (!item.answer) continue;
                const trimmed = item.answer.trim();
                if (!/^[A-Fa-f]$/.test(trimmed)) continue;
                const letter = trimmed.toUpperCase();
                const matchIdx = optionsData.findIndex(od => od.letterLabel === letter);
                if (matchIdx !== -1) {
                    targetAnswer = optionsData[matchIdx].cleanText;
                    strategyUsed = '策略3(字母匹配)';
                    break;
                }
            }
        }

        if (targetAnswer && !backendQuestionNum) {
            const entry = rawAnswerData.find(item => answerMatchesOption(item.answer, targetAnswer));
            if (entry) backendQuestionNum = entry.questionNum;
        }

        let allAnswersForQuestion = [];
        const lookupNum = backendQuestionNum || questionNum;
        if (window.multiAnswerMap && window.multiAnswerMap.has(lookupNum)) {
            const multiAnswers = window.multiAnswerMap.get(lookupNum);
            allAnswersForQuestion = multiAnswers.map(a => a.answer).filter(Boolean);
        }
        if (allAnswersForQuestion.length === 0 && targetAnswer) {
            allAnswersForQuestion = [targetAnswer];
        }

        if (allAnswersForQuestion.length === 0) continue;

        let matched = false;

        for (const answerText of allAnswersForQuestion) {
            for (let oi = 0; oi < optionsData.length; oi++) {
                const od = optionsData[oi];
                if (od.element.classList.contains('is-checked')) continue;
                if (answerMatchesOption(answerText, od.cleanText)) {
                    const clickTarget = od.element.classList.contains('u3-option-img')
                        ? (od.element.querySelector('.u3-option-img__content') || od.element)
                        : od.element;
                    clickTarget.click();
                    filledCount++;
                    addLogMessage(`选择题 ${questionNum} 选中: ${od.rawText}`, 'success');
                    await wait1(50);
                    matched = true;
                    break;
                }
            }
        }

        if (!matched) {
            const letterAnswers = allAnswersForQuestion.filter(a => /^[A-Fa-f]$/.test(a.trim()));
            for (const letter of letterAnswers) {
                const letterIndex = letter.trim().toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
                if (letterIndex < optionsData.length) {
                    const od = optionsData[letterIndex];
                    if (!od.element.classList.contains('is-checked')) {
                        const clickTarget = od.element.classList.contains('u3-option-img')
                            ? (od.element.querySelector('.u3-option-img__content') || od.element)
                            : od.element;
                        clickTarget.click();
                        filledCount++;
                        addLogMessage(`选择题 ${questionNum} 按字母 ${letter.trim().toUpperCase()} 选中: ${od.rawText}`, 'success');
                        await wait1(50);
                    }
                }
            }
        }
    }

    return filledCount;
}

// ===== 跟读朗读题型处理（单次播放版） =====

function waitInterruptible(ms) {
    return new Promise(resolve => {
        const check = () => { if (readAlongAborted) { resolve(); return; } };
        const timer = setTimeout(() => { resolve(); }, ms);
        const interval = setInterval(() => { if (readAlongAborted) { clearTimeout(timer); clearInterval(interval); resolve(); } }, 100);
    });
}

function vueClick(el) {
    if (!el) return;
    const events = ['mousedown', 'mouseup', 'click'];
    for (const type of events) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
}

async function findStopRecordBtn(parentEl, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 3000);
    while (Date.now() < deadline) {
        const btn = parentEl.querySelector('.u3-recorder-panel__btn-circle-middle')
            || parentEl.querySelector('.u3-recorder-panel__btn-circle')
            || parentEl.querySelector('.u3-recorder-panel__btn');
        if (btn && btn.offsetParent !== null) return btn;
        await new Promise(r => setTimeout(r, 100));
    }
    return parentEl.querySelector('.u3-recorder-panel__btn-circle-middle')
        || parentEl.querySelector('.u3-recorder-panel__btn-circle')
        || parentEl.querySelector('.u3-recorder-panel__btn');
}

function speakWithSpeechSynthesis(text) {
    return new Promise(resolve => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        utterance.onend = resolve;
        utterance.onerror = resolve;
        speechSynthesis.speak(utterance);
    });
}

// ===== 关键差异点：handleReadAlongQuestions 中音频只播放一遍 =====
async function handleReadAlongQuestions() {
    if (!supportReadAlong || !contentMatchMode) return 0;
    if (isReadAlongProcessing) return 0;

    const activeSlide = document.querySelector('.swiper-slide-active');
    if (!activeSlide) return 0;

    const readAlongElements = [
        ...activeSlide.querySelectorAll('.partA_word_repeat'),
        ...activeSlide.querySelectorAll('.u3-paragraphRepeat')
    ];
    const uniqueReadAlongEls = [...new Set(readAlongElements)];
    if (uniqueReadAlongEls.length === 0) return 0;

    const readAlongQuestions = [];
    for (const el of uniqueReadAlongEls) {
        const nameEl = el.querySelector('.u3-question-container__ques-order--name');
        if (nameEl && (nameEl.textContent.includes('跟读') || nameEl.textContent.includes('口语跟读') || nameEl.textContent.includes('听读'))) {
            readAlongQuestions.push(el);
        }
    }

    if (readAlongQuestions.length === 0) return 0;

    isReadAlongProcessing = true;
    readAlongAborted = false;
    let processedCount = 0;

    let directAnswers = [];
    try {
        const url = customBucketUrl || 'http://127.0.0.1:5290/fill-answer';
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
                for (let i = 0; i < data.length; i++) {
                    const item = data[i];
                    let answerTexts = [];
                    if (Array.isArray(item.multipleAnswers) && item.multipleAnswers.length > 0) {
                        answerTexts = item.multipleAnswers.map(x => String(x).trim()).filter(Boolean);
                    } else if (typeof item.answer === 'string') {
                        const raw = item.answer.replace(/\s+/g, ' ').trim();
                        if (raw.includes('/')) {
                            answerTexts = raw.split('/').map(s => s.trim()).filter(Boolean);
                        } else if (raw) {
                            answerTexts = [raw];
                        }
                    }
                    for (const at of answerTexts) {
                        directAnswers.push({
                            answer: at,
                            index: i,
                            answerIndex: item.answerIndex || (directAnswers.length + 1)
                        });
                    }
                }
            }
        }
        addLogMessage('跟读朗读: 直接获取答案 ' + directAnswers.length + ' 条', directAnswers.length > 0 ? 'success' : 'warning');
    } catch (e) {
        addLogMessage('跟读朗读: 获取答案失败: ' + e.message, 'warning');
    }

    const allAnswers = directAnswers.length > 0 ? directAnswers : rawAnswerData.map((item, i) => ({
        answer: item.answer,
        index: i,
        answerIndex: item.answerIndex || (i + 1)
    }));

    function matchReadTextToAnswer(readText) {
        if (allAnswers.length === 0) return null;
        const normalizedRead = readText.trim().toLowerCase();
        const englishPart = readText.replace(/[\u4e00-\u9fff].*$/, '').replace(/\s*\/[^a-zA-Z].*$/, '').trim().toLowerCase();

        let bestMatch = null;
        let bestScore = 0;
        allAnswers.forEach((item) => {
            const answerText = (item.answer || '').trim();
            const normalizedAnswer = answerText.toLowerCase();
            let score = 0;

            if (normalizedRead === normalizedAnswer) {
                score = 100;
            } else if (englishPart.length > 2 && englishPart === normalizedAnswer) {
                score = 95;
            } else if (englishPart.length > 2 && normalizedAnswer.length > 2 && englishPart.includes(normalizedAnswer)) {
                score = (normalizedAnswer.length / englishPart.length) * 90;
            } else if (normalizedAnswer.length > 0 && (normalizedRead.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedRead))) {
                score = Math.min(normalizedRead.length, normalizedAnswer.length) / Math.max(normalizedRead.length, normalizedAnswer.length) * 80;
            } else {
                score = calculateTextSimilarity(readText, answerText) * 0.8;
            }

            if (score > bestScore && score > 20) {
                bestScore = score;
                bestMatch = { answer: answerText, similarity: score, index: item.index, answerIndex: item.answerIndex };
            }
        });
        return bestMatch;
    }

    const globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (globalAudioCtx.state === 'suspended') await globalAudioCtx.resume();
    const globalGain = globalAudioCtx.createGain();
    globalGain.gain.value = 1.0;
    const globalDest = globalAudioCtx.createMediaStreamDestination();
    globalGain.connect(globalDest);
    const globalFakeStream = globalDest.stream;
    const ourTracks = new Set(globalFakeStream.getAudioTracks());

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async function(constraints) {
        if (constraints && constraints.audio) {
            console.log('[auto-fill-once] getUserMedia → 假流');
            return globalFakeStream;
        }
        return originalGetUserMedia.call(this, constraints);
    };

    const originalTrackStop = MediaStreamTrack.prototype.stop;
    let trackStopBlocked = 0;
    MediaStreamTrack.prototype.stop = function() {
        if (ourTracks.has(this)) {
            trackStopBlocked++;
            console.log('[auto-fill-once] 阻止 track.stop() #' + trackStopBlocked);
            addLogMessage('跟读朗读: 阻止组件 stop track #' + trackStopBlocked, 'info');
            return;
        }
        return originalTrackStop.call(this);
    };

    addLogMessage('跟读朗读: [单次播放] 双层劫持就绪 (tracks: ' + ourTracks.size + ')', 'info');

    try {
        const currentSlide = document.querySelector('.swiper-slide-active');
        if (!currentSlide) return 0;

        const currentReadAlongEls = [
            ...currentSlide.querySelectorAll('.partA_word_repeat'),
            ...currentSlide.querySelectorAll('.u3-paragraphRepeat')
        ];
        const currentUniqueEls = [...new Set(currentReadAlongEls)];
        const currentQuestions = [];
        for (const el of currentUniqueEls) {
            const nameEl = el.querySelector('.u3-question-container__ques-order--name');
            if (nameEl && (nameEl.textContent.includes('跟读') || nameEl.textContent.includes('口语跟读') || nameEl.textContent.includes('听读'))) {
                currentQuestions.push(el);
            }
        }

        if (currentQuestions.length === 0) {
            return 0;
        }

        for (const questionEl of currentQuestions) {
            if (readAlongAborted) break;

                const recorderBtn = questionEl.querySelector('.u3-recorder-btns__recorder-first');
                if (!recorderBtn) continue;

                const hasResult = questionEl.querySelector('.u3-recorder-result, .u3-recorder-btns__result');
                if (hasResult) continue;

                let readText = '';
                const readTextSelectors = [
                    '.u3-paragraphRepeat-content__midPanel-enText',
                    '.u3-paragraphRepeat-content__midPanel-enText p',
                    '.u3-wordBlock-content__midPanel-enText p',
                    '.u3-wordBlock-content__midPanel-enText',
                    '.u3-wordBlock-content__enText',
                    '.u3-wordBlock-content p',
                    '.u3-wordBlock-content',
                    '.u3-read-text',
                    '.u3-question-text'
                ];
                for (const sel of readTextSelectors) {
                    const el = questionEl.querySelector(sel);
                    if (el) {
                        const txt = el.textContent.trim();
                        if (txt.length > 0) {
                            readText = txt;
                            break;
                        }
                    }
                }
                if (!readText) {
                    const clone = questionEl.cloneNode(true);
                    clone.querySelectorAll('button, .u3-recorder-btns, .u3-recorder-panel, .u3-audioPlayer, [slot*="audio"]').forEach(e => e.remove());
                    readText = clone.textContent.trim();
                }
                if (!readText) {
                    addLogMessage('跟读朗读: 未找到朗读文本，跳过', 'warning');
                    continue;
                }

                addLogMessage(`跟读朗读: [单次播放] 开始处理第 ${processedCount + 1} 题`, 'info');

                const answerMatch = matchReadTextToAnswer(readText);
                let answerIndex = -1;
            if (answerMatch) {
                answerIndex = answerMatch.index + 1;
                addLogMessage(`跟读朗读: 匹配到答案 #${answerIndex} (相似度 ${answerMatch.similarity.toFixed(0)}%)`, 'info');
            } else {
                const allSlides = document.querySelectorAll('.swiper-slide');
                for (let si = 0; si < allSlides.length; si++) {
                    if (allSlides[si].classList.contains('swiper-slide-active')) {
                        answerIndex = si + 1;
                        break;
                    }
                }
                addLogMessage(`跟读朗读: 未匹配答案，回退用 slide #${answerIndex}`, 'warning');
            }

            const base = FillTimeMod.bucketBase();
            let ttsWavData = null;
            let usedFallback = false;

            try {
                let ttsReady = false;
                for (let poll = 0; poll < 30; poll++) {
                    if (readAlongAborted) break;
                    const statusRes = await fetch(base + '/fill-tts/status', { cache: 'no-cache' });
                    if (statusRes.ok) {
                        const statusData = await statusRes.json();
                        if (!statusData.generating) {
                            ttsReady = true;
                            break;
                        }
                    }
                    await waitInterruptible(1000);
                }

                if (ttsReady) {
                    const wavRes = await fetch(base + '/fill-tts/output/' + answerIndex + '.wav', { cache: 'no-cache' });
                    if (wavRes.ok) {
                        ttsWavData = await wavRes.arrayBuffer();
                        addLogMessage(`跟读朗读: TTS音频获取成功 (answer #${answerIndex}, ${ttsWavData.byteLength} bytes)`, 'success');
                    } else {
                        addLogMessage(`跟读朗读: TTS音频未找到 (answer #${answerIndex}, HTTP ${wavRes.status})`, 'warning');
                    }
                }
            } catch (e) {
                addLogMessage('跟读朗读: TTS服务异常: ' + e.message, 'warning');
            }

            if (readAlongAborted) break;

            if (!ttsWavData) {
                addLogMessage('跟读朗读: 使用浏览器语音合成回退', 'info');
                usedFallback = true;

                await speakWithSpeechSynthesis(readText);
                vueClick(recorderBtn);
                await waitInterruptible(500);
                await speakWithSpeechSynthesis(readText);
                await waitInterruptible(500);

                const stopBtn = questionEl.querySelector('.u3-recorder-panel__btn');
                if (stopBtn) {
                    vueClick(stopBtn);
                } else {
                    vueClick(recorderBtn);
                }

                processedCount++;
                await waitInterruptible(1000);
                continue;
            }

            let audioSource = null;
            let audioDuration = 0;
            try {
                const audioBuffer = await globalAudioCtx.decodeAudioData(ttsWavData);
                audioSource = globalAudioCtx.createBufferSource();
                audioSource.buffer = audioBuffer;
                // ===== 关键差异：单次播放，不循环 =====
                audioSource.loop = false;
                audioSource.connect(globalGain);
                // 不在此处 start，等录音后再播放
                audioDuration = audioBuffer.duration;
                addLogMessage(`跟读朗读: [单次播放] 音频源就绪 (时长 ${audioDuration.toFixed(1)}s, 只播放一遍)`, 'success');
            } catch (e) {
                addLogMessage('跟读朗读: 解码音频失败: ' + e.message, 'error');
                await speakWithSpeechSynthesis(readText);
                vueClick(recorderBtn);
                await waitInterruptible(500);
                await speakWithSpeechSynthesis(readText);
                await waitInterruptible(500);
                const stopBtn = await findStopRecordBtn(questionEl);
                if (stopBtn) {
                    vueClick(stopBtn);
                } else {
                    vueClick(recorderBtn);
                }
                processedCount++;
                await waitInterruptible(1000);
                continue;
            }

            const hijackActive = navigator.mediaDevices.getUserMedia !== originalGetUserMedia;
            addLogMessage(`跟读朗读: [单次播放] 点击录音按钮 (劫持${hijackActive ? '生效' : '已失效!'})`, 'info');
            vueClick(recorderBtn);

            // 等待 1s 后再开始播放音频，确保录音已启动
            await waitInterruptible(1000);
            if (audioSource) {
                try { audioSource.start(); } catch(e) {}
            }

            // ===== 关键差异：等待时间 = audioDuration + 1.5s 缓冲，最少 3s =====
            const waitTime = Math.max(Math.ceil((audioDuration + 1.5) * 1000), 3000);
            addLogMessage(`跟读朗读: [单次播放] 等待录音中... (音频 ${audioDuration.toFixed(1)}s + 1.5s缓冲, 共 ${(waitTime / 1000).toFixed(1)}s)`, 'info');
            await waitInterruptible(waitTime);

            if (audioSource) {
                try { audioSource.stop(); } catch(e) {}
                try { audioSource.disconnect(); } catch(e) {}
            }

            const tracksAfter = globalFakeStream.getAudioTracks();
            const trackStates = tracksAfter.map(t => t.readyState + '/muted=' + t.muted);
            addLogMessage('跟读朗读: 录音后 track 状态: [' + trackStates.join(', ') + ']', 'info');

            const stopBtn = await findStopRecordBtn(questionEl);
            addLogMessage('跟读朗读: 点击停止录音', 'info');
            if (stopBtn) {
                vueClick(stopBtn);
            } else {
                vueClick(recorderBtn);
            }

            processedCount++;
            addLogMessage(`跟读朗读: [单次播放] 第 ${processedCount} 题完成`, 'success');

            await waitInterruptible(1500);
        }

        if (processedCount > 0) {
            addLogMessage(`跟读朗读: [单次播放] 共处理 ${processedCount} 个跟读题目`, 'success');
        }
    } catch (e) {
        addLogMessage('跟读朗读处理异常: ' + e.message, 'error');
    } finally {
        MediaStreamTrack.prototype.stop = originalTrackStop;
        for (const track of ourTracks) {
            try { originalTrackStop.call(track); } catch(e) {}
        }
        navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        if (globalAudioCtx.state !== 'closed') {
            try { globalAudioCtx.close(); } catch(e) {}
        }
        addLogMessage(`跟读朗读: [单次播放] 劫持已恢复 (阻止了 ${trackStopBlocked} 次 track.stop)`, 'info');
        isReadAlongProcessing = false;
    }

    return processedCount;
}

// 题号元素查找：优先 .u3-input__prepared，找不到回退 .u3-input__prepead（适配新版页面拼写）
function getPreparedElements(root) {
    let els = root.getElementsByClassName('u3-input__prepared');
    if (els.length === 0) els = root.getElementsByClassName('u3-input__prepead');
    return els;
}
function queryPrepared(root) {
    return root.querySelector('.u3-input__prepared') || root.querySelector('.u3-input__prepead');
}

async function work() {
    if (isReadAlongProcessing) return;

    // 串行判断：需要"点击序列提交已答"的新题型（u3-input 填空）必须串行，
    // 否则间隔小于单次耗时（如80ms）时 work() 并发重入会导致漏答/跳题；
    // 旧题型无此提交要求，保持并发以保留流水线效率。
    // 手动模式（fillExecMode）可覆盖自动判定：serial 强制串行，concurrent 强制并发。
    const isU3InputPage = !!document.querySelector('.u3-input__content--input');
    let useSerial;
    if (fillExecMode === 'serial') useSerial = true;
    else if (fillExecMode === 'concurrent') useSerial = false;
    else useSerial = isU3InputPage;
    if (useSerial) {
        if (isWorking) return;
        isWorking = true;
    }
    try {
    const getInputs = (root) => {
        const a = root.getElementsByClassName('u3-input__content--input');
        if (a && a.length) return a;
        return root.getElementsByClassName('u3-input__content');
    };

    const setElValue = (el, v) => {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
            // 原生 setter 赋值，避免直接赋值绕过 Vue 响应式
            try {
                const proto = tag === 'input' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
                Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
            } catch (e) {
                el.value = v;
            }
        } else {
            el.textContent = v;
        }
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        // 仅新题型（u3-input 填空）需模拟点击序列提交"已作答"；旧题型不派发，避免触发多余交互
        if (isU3InputPage) {
            try {
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                el.dispatchEvent(new Event('focus', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new Event('focusin', { bubbles: true, cancelable: true }));
                el.focus();
            } catch (e) {}
        }
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

    const choiceFilledCount = supportChoiceQuestions ? await fillChoiceQuestions() : 0;

    const preparedElements = getPreparedElements(document);
    const inputElements = getInputs(document);

    let filledCount = 0;

    if (contentMatchMode) {
        addLogMessage('使用内容匹配模式', 'info');
        
        let questionTexts = document.getElementsByClassName('u3-question-text');
        if (questionTexts.length === 0) {
            // 备选：使用 u3-fillblank-base__cont（新版页面无 u3-question-text 时）
            questionTexts = document.getElementsByClassName('u3-fillblank-base__cont');
        }
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
                if (processedScopes.has(scopeEl)) continue;
                processedScopes.add(scopeEl);

                const clone = scopeEl.cloneNode(true);
                clone.querySelectorAll('input, textarea, button, .u3-option__content, .u3-input__prepared, .u3-input__prepead, [contenteditable]').forEach(el => el.remove());
                const questionText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
                const cleanQuestionText = questionText.replace(/分值\d+分\s*/g, '').replace(/^\d+[\s\.\)]*/, '').trim();

                const match = findAnswerByContent(cleanQuestionText);

                if (match) {
                    const preparedElements = getPreparedElements(scopeEl);
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

                    // ===== 控分：该题被选中为错题时，填入相邻题目的答案 =====
                    if (wrongQuestionSet.has(questionNum)) {
                        const wrongAns = getWrongAnswersForQuestion(questionNum, answers.length || rawAnswerData.length);
                        if (wrongAns && wrongAns.length > 0) {
                            answersToFill = wrongAns;
                            addLogMessage(`[控分] 题目 ${questionNum} 故意填错: ${wrongAns.join(' / ')}`, 'warning');
                        }
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

        // swiper 单题单页：限定在 active slide，用 .u3-question-container__ques-order--number 作为真正题号
        const activeSlide = document.querySelector('.swiper-slide-active');
        let modeInputs = Array.from(inputElements);
        let modePrepared = Array.from(preparedElements);
        if (activeSlide) {
            const numEl = activeSlide.querySelector('.u3-question-container__ques-order--number');
            const realNum = numEl ? parseInt(numEl.textContent.trim()) : 0;
            // 只取输入框元素，避免容器 div 与子 input 双重匹配导致 textContent 替换销毁 DOM
            let slideInputs = activeSlide.querySelectorAll('.u3-input__content--input');
            if (!slideInputs.length) slideInputs = activeSlide.querySelectorAll('.u3-input__content');
            if (slideInputs.length > 0 && realNum > 0) {
                modeInputs = Array.from(slideInputs);
                modePrepared = Array.from(slideInputs).map(() => ({ innerHTML: String(realNum) }));
            }
        }

        for (let i = 0; i < modeInputs.length; i++) {
            if (i >= modePrepared.length) break;

            const questionNum = parseInt(modePrepared[i].innerHTML);
            if (isNaN(questionNum) || questionNum <= 0) continue;

            const multiAnswers = window.multiAnswerMap ? window.multiAnswerMap.get(questionNum) : null;

            let currentInputIndex = i;
            while (currentInputIndex < modePrepared.length && parseInt(modePrepared[currentInputIndex].innerHTML) === questionNum) {
                currentInputIndex++;
            }
            const inputsSlice = modeInputs.slice(i, currentInputIndex);

            let answersToFill;
            if (multiAnswers && multiAnswers.length > 0) {
                answersToFill = multiAnswers.map(item => item.answer);
            } else {
                const answerIndex = questionNum - 1;
                answersToFill = (answerIndex >= 0 && answerIndex < answers.length) ? [answers[answerIndex]] : [];
            }

            // ===== 控分：该题被选中为错题时，填入相邻题目的答案 =====
            if (wrongQuestionSet.has(questionNum)) {
                const wrongAns = getWrongAnswersForQuestion(questionNum, answers.length || rawAnswerData.length);
                if (wrongAns && wrongAns.length > 0) {
                    answersToFill = wrongAns;
                    addLogMessage(`[控分] 题目 ${questionNum} 故意填错: ${wrongAns.join(' / ')}`, 'warning');
                }
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

    const readAlongCount = supportReadAlong && contentMatchMode ? await handleReadAlongQuestions() : 0;

    if (readAlongCount > 0) {
        addLogMessage('本次跟读朗读完成 ' + readAlongCount + ' 题', 'success');
    }

    if (!readAlongAborted) {
        const nextBtn = findButtonByText('下一题', '下一页');
        if (nextBtn) {
            nextBtn.click();
            addLogMessage('已点击翻页按钮（下一题）', 'info');
        }
    }
    } finally {
        if (useSerial) isWorking = false;
    }
}

function findButtonByText(...texts) {
    const candidates = document.querySelectorAll('.x-button, .u3-button, .btn, button');
    for (const text of texts) {
        for (const el of candidates) {
            if (el.textContent.trim() === text && el.offsetParent !== null) {
                return el;
            }
        }
    }
    return null;
}

// ===== 控分功能辅助函数 =====

// 从 totalQuestions 个题目中随机选出 wrongCount 个题号作为错题
function buildWrongPlan(totalQuestions) {
    wrongQuestionSet = new Set();
    if (!fillScoreControlEnabled || fillScoreControlWrongCount <= 0 || !totalQuestions || totalQuestions <= 0) return;
    const wrongNum = Math.min(fillScoreControlWrongCount, totalQuestions);
    const pool = Array.from({ length: totalQuestions }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < wrongNum; i++) wrongQuestionSet.add(pool[i]);
}

// 获取某题的错误答案：使用相邻题目（题号+1，循环）的答案作为错误答案
function getWrongAnswersForQuestion(questionNum, totalQuestions) {
    if (!totalQuestions || totalQuestions <= 0) return null;
    const nextNum = (questionNum % totalQuestions) + 1;
    if (window.multiAnswerMap && window.multiAnswerMap.has(nextNum)) {
        const list = window.multiAnswerMap.get(nextNum);
        if (list && list.length > 0) return list.map(a => a.answer);
    }
    if (window.questionNumAnswerMap && window.questionNumAnswerMap.has(nextNum)) {
        return [window.questionNumAnswerMap.get(nextNum)];
    }
    if (nextNum >= 1 && nextNum <= answers.length) {
        return [answers[nextNum - 1]];
    }
    return null;
}

function startAutoFill() {
    if (autoFillIntervalId) {
        clearInterval(autoFillIntervalId);
        autoFillIntervalId = null;
    }
    readAlongAborted = false;
    isReadAlongProcessing = false;

    // 构建本轮控分计划：随机选出错题
    const totalQ = answers.length || rawAnswerData.length;
    buildWrongPlan(totalQ);
    if (fillScoreControlEnabled && wrongQuestionSet.size > 0) {
        addLogMessage(`[控分] 本轮随机错 ${wrongQuestionSet.size} 题: 题号 [${[...wrongQuestionSet].sort((a, b) => a - b).join(', ')}]`, 'info');
    } else if (fillScoreControlEnabled && fillScoreControlWrongCount > 0) {
        addLogMessage('[控分] 答案库未加载，等加载后自动生成错题计划', 'warning');
    }

    autoFillIntervalId = setInterval(work, autoFillDelay);
    updateAutoFillPanelStatus();
    addLogMessage('自动填空已启动 [单次播放模式], 间隔: ' + autoFillDelay + 'ms', 'info');
}

function stopAutoFill() {
    if (autoFillIntervalId) {
        clearInterval(autoFillIntervalId);
        autoFillIntervalId = null;
    }
    isReadAlongProcessing = false;
    readAlongAborted = true;
    updateAutoFillPanelStatus();
    addLogMessage('自动填空已停止', 'info');
}

let FillTimeMod = {
    bucketBase: function() {
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
            fetch(FillTimeMod.bucketBase() + '/listen-time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: false, seconds: null }),
                cache: 'no-cache'
            }).catch(function() {});
        } catch (e) {
            addLogMessage('[时间修改] 同步异常：' + e.message, 'warning');
        }
    },
    install: function() {
        FillTimeMod.push();
    }
};

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
    messageDiv.textContent = 'Auto366自动填空注入成功 [单次播放模式]，请点击控制面板的开始填空按钮';
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

function addLogMessage(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    logMessages.unshift({ timestamp, message, type });
    updateLogPanel();
}

function createLogPanel() {
    if (logPanel) return;
    logPanel = document.createElement('div');
    logPanel.id = 'auto-fill-log-panel';
    logPanel.style.position = 'fixed';
    logPanel.style.right = '300px';
    logPanel.style.bottom = '80px';
    logPanel.style.width = '380px';
    logPanel.style.height = '400px';
    logPanel.style.background = 'rgba(0,0,0,0.9)';
    logPanel.style.color = '#fff';
    logPanel.style.borderRadius = '8px';
    logPanel.style.padding = '10px';
    logPanel.style.zIndex = '9998';
    logPanel.style.overflow = 'hidden';
    logPanel.style.display = 'none';
    logPanel.style.userSelect = 'text';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';
    header.style.paddingBottom = '8px';
    header.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
    header.style.cursor = 'move';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = '运行日志 [单次播放]';
    titleSpan.style.fontSize = '14px';
    titleSpan.style.fontWeight = 'bold';
    header.appendChild(titleSpan);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '导出';
    exportBtn.title = '导出日志到桌面';
    exportBtn.style.fontSize = '12px';
    exportBtn.style.padding = '2px 6px';
    exportBtn.style.cursor = 'pointer';
    exportBtn.style.background = '#fff';
    exportBtn.style.border = 'none';
    exportBtn.style.color = '#000';
    exportBtn.style.borderRadius = '3px';
    exportBtn.style.marginRight = '3px';
    exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exportLogs();
    });
    header.appendChild(exportBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00d7';
    closeBtn.style.fontSize = '18px';
    closeBtn.style.padding = '0 6px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = '#fff';
    closeBtn.style.userSelect = 'none';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        logPanel.style.display = 'none';
    });
    header.appendChild(closeBtn);
    logPanel.appendChild(header);

    const logViewport = document.createElement('div');
    logViewport.id = 'auto-fill-log-viewport';
    logViewport.style.height = 'calc(100% - 40px)';
    logViewport.style.overflowY = 'auto';
    logViewport.style.position = 'relative';
    logViewport.style.fontSize = '11px';
    logViewport.style.fontFamily = 'monospace';
    logViewport.style.userSelect = 'text';

    const logSpacer = document.createElement('div');
    logSpacer.id = 'auto-fill-log-spacer';

    const logVisible = document.createElement('div');
    logVisible.id = 'auto-fill-log-visible';
    logVisible.style.position = 'absolute';
    logVisible.style.top = '0';
    logVisible.style.left = '0';
    logVisible.style.right = '0';

    logViewport.appendChild(logSpacer);
    logViewport.appendChild(logVisible);
    logPanel.appendChild(logViewport);

    logViewport.addEventListener('scroll', () => {
        renderVisibleLogs();
    });

    document.body.appendChild(logPanel);

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn || e.target === exportBtn) return;
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

function exportLogs() {
    if (logMessages.length === 0) {
        addLogMessage('没有日志可导出', 'warning');
        return;
    }

    const logText = logMessages.slice().reverse().map(msg => {
        let typePrefix = '';
        if (msg.type === 'success') typePrefix = '[成功] ';
        else if (msg.type === 'error') typePrefix = '[错误] ';
        else if (msg.type === 'warning') typePrefix = '[警告] ';
        else if (msg.type === 'match') typePrefix = '[匹配] ';
        else if (msg.type === 'info') typePrefix = '[信息] ';
        return '[' + msg.timestamp + '] ' + typePrefix + msg.message;
    }).join('\n');

    addLogMessage('正在保存日志到桌面...', 'info');

    fetch('http://127.0.0.1:5290/save-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: logText })
    })
    .then(res => res.json())
    .then(result => {
        if (result.success) {
            addLogMessage('日志已保存到: ' + result.path, 'success');
        } else {
            addLogMessage('保存失败: ' + result.error, 'error');
        }
    })
    .catch(err => {
        addLogMessage('保存失败: ' + err.message, 'error');
    });
}

function updateLogPanel() {
    if (!logPanel) return;
    const viewport = document.getElementById('auto-fill-log-viewport');
    if (!viewport) return;
    renderVisibleLogs();
}

function renderVisibleLogs() {
    const viewport = document.getElementById('auto-fill-log-viewport');
    if (!viewport) return;

    const spacer = document.getElementById('auto-fill-log-spacer');
    const visible = document.getElementById('auto-fill-log-visible');
    if (!spacer || !visible) return;

    const totalHeight = logMessages.length * LOG_ROW_HEIGHT;
    spacer.style.height = totalHeight + 'px';

    const scrollTop = viewport.scrollTop;
    const viewportHeight = viewport.clientHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - 2);
    const visibleCount = Math.ceil(viewportHeight / LOG_ROW_HEIGHT) + 20;
    const endIndex = Math.min(startIndex + visibleCount, logMessages.length);

    visible.style.top = (startIndex * LOG_ROW_HEIGHT) + 'px';

    let html = '';
    for (let i = startIndex; i < endIndex; i++) {
        const msg = logMessages[i];
        let color = '#fff';
        if (msg.type === 'success') color = '#4caf50';
        else if (msg.type === 'error') color = '#f44336';
        else if (msg.type === 'warning') color = '#ff9800';
        else if (msg.type === 'match') color = '#e040fb';
        else if (msg.type === 'info') color = '#2196f3';

        const escapedMsg = msg.message
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        html += '<div style="margin-bottom:4px;color:' + color + '">[' + msg.timestamp + '] ' + escapedMsg + '</div>';
    }
    visible.innerHTML = html;
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
    titleSpan.textContent = '自动填空 [单次播放]';
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
        e.stopPropagation();
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

    // 执行模式切换：自动（按题型判断）/ 强制串行 / 强制并发
    const modeRow = document.createElement('div');
    modeRow.style.display = 'flex';
    modeRow.style.gap = '4px';
    modeRow.style.marginBottom = '6px';

    const modeLabel = document.createElement('span');
    modeLabel.textContent = '模式';
    modeLabel.style.fontSize = '11px';
    modeLabel.style.marginRight = '2px';
    modeLabel.style.color = 'rgba(255,255,255,0.7)';
    modeRow.appendChild(modeLabel);

    const modeList = [
        { key: 'auto', label: '自动', title: '按题型自动判断：u3-input 填空串行，旧题型并发' },
        { key: 'serial', label: '串行', title: '强制串行：每轮作答完（含已答提交）再进下一题，杜绝 80ms 漏答' },
        { key: 'concurrent', label: '并发', title: '强制并发：work() 可重叠执行（旧题型提速，u3-input 填空可能漏答）' }
    ];
    const modeBtns = {};
    const updateModeUI = () => {
        for (const m of modeList) {
            const b = modeBtns[m.key];
            const active = fillExecMode === m.key;
            b.style.background = active ? 'rgba(0,122,204,0.8)' : '';
            b.style.color = active ? '#fff' : '';
            b.style.border = active ? 'none' : '';
        }
    };
    for (const m of modeList) {
        const b = document.createElement('button');
        b.textContent = m.label;
        b.title = m.title;
        b.style.flex = '1';
        b.style.fontSize = '11px';
        b.style.padding = '4px';
        b.style.cursor = 'pointer';
        b.addEventListener('click', () => {
            fillExecMode = m.key;
            localStorage.setItem('fillExecMode', m.key);
            updateModeUI();
            addLogMessage('执行模式: ' + m.label, 'info');
        });
        modeBtns[m.key] = b;
        modeRow.appendChild(b);
    }
    updateModeUI();
    autoFillPanel.appendChild(modeRow);

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
            if (supportChoiceQuestions) {
                supportChoiceQuestions = false;
                localStorage.setItem('supportChoiceQuestions', 'false');
            }
            supportChoiceCheckbox.checked = false;
        }
        updateSupportChoiceLabel();

        supportReadAlongCheckbox.disabled = !enabled;
        supportReadAlongRow.style.opacity = enabled ? '1' : '0.5';
        supportReadAlongCheckbox.style.cursor = enabled ? 'pointer' : 'not-allowed';
        supportReadAlongLabel.style.cursor = enabled ? 'pointer' : 'not-allowed';
        if (!enabled) {
            if (supportReadAlong) {
                supportReadAlong = false;
                localStorage.setItem('supportReadAlong', 'false');
            }
            supportReadAlongCheckbox.checked = false;
        }
        updateReadAlongLabel();
        updateTtsProgressVisibility();
    }

    updateSupportChoiceLabel();

    matchModeCheckbox.addEventListener('change', updateSupportChoiceState);

    supportChoiceRow.appendChild(supportChoiceCheckbox);
    supportChoiceRow.appendChild(supportChoiceLabel);
    autoFillPanel.appendChild(supportChoiceRow);

    const supportReadAlongRow = document.createElement('div');
    supportReadAlongRow.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 4px 4px 4px 16px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
        opacity: ${contentMatchMode ? '1' : '0.5'};
    `;

    const supportReadAlongCheckbox = document.createElement('input');
    supportReadAlongCheckbox.type = 'checkbox';
    supportReadAlongCheckbox.id = 'support-read-along';
    supportReadAlongCheckbox.checked = supportReadAlong;
    supportReadAlongCheckbox.disabled = !contentMatchMode;
    supportReadAlongCheckbox.style.cssText = `
        margin-right: 8px;
        cursor: ${contentMatchMode ? 'pointer' : 'not-allowed'};
    `;
    supportReadAlongCheckbox.addEventListener('change', (e) => {
        if (!contentMatchMode) {
            e.target.checked = false;
            return;
        }
        supportReadAlong = e.target.checked;
        localStorage.setItem('supportReadAlong', supportReadAlong.toString());
        addLogMessage('支持跟读朗读: ' + (supportReadAlong ? '已启用' : '已禁用'), 'info');
        updateReadAlongLabel();
        updateTtsProgressVisibility();
    });

    const supportReadAlongLabel = document.createElement('label');
    supportReadAlongLabel.htmlFor = 'support-read-along';
    supportReadAlongLabel.style.cssText = `
        font-size: 11px;
        cursor: ${contentMatchMode ? 'pointer' : 'not-allowed'};
        flex: 1;
    `;

    function updateReadAlongLabel() {
        const enabled = contentMatchMode && supportReadAlong;
        const color = enabled ? '#4caf50' : '#888';
        const statusText = supportReadAlong ? (contentMatchMode ? '(开启)' : '(已禁用-需先开启内容匹配)') : '(关闭)';
        supportReadAlongLabel.innerHTML = `
            <span style="color: ${color};">
                支持跟读朗读(需要先开启内容匹配) ${statusText} [单次播放]
            </span>
        `;
    }

    updateReadAlongLabel();

    supportReadAlongRow.appendChild(supportReadAlongCheckbox);
    supportReadAlongRow.appendChild(supportReadAlongLabel);
    autoFillPanel.appendChild(supportReadAlongRow);

    const ttsProgressDiv = document.createElement('div');
    ttsProgressDiv.id = 'tts-progress-display';
    ttsProgressDiv.style.cssText = `
        font-size: 11px;
        margin-bottom: 6px;
        padding: 4px 4px 4px 16px;
        color: #ffc107;
        display: ${supportReadAlong && contentMatchMode ? 'block' : 'none'};
    `;
    ttsProgressDiv.textContent = 'TTS: 就绪';
    autoFillPanel.appendChild(ttsProgressDiv);

    let ttsPollIntervalId = null;

    function updateTtsProgressVisibility() {
        const visible = supportReadAlong && contentMatchMode;
        ttsProgressDiv.style.display = visible ? 'block' : 'none';
        if (visible && !ttsPollIntervalId) {
            startTtsPoll();
        } else if (!visible && ttsPollIntervalId) {
            clearInterval(ttsPollIntervalId);
            ttsPollIntervalId = null;
        }
    }

    function startTtsPoll() {
        if (ttsPollIntervalId) return;
        const pollTts = async () => {
            if (!supportReadAlong || !contentMatchMode) return;
            try {
                const base = FillTimeMod.bucketBase();
                const res = await fetch(base + '/fill-tts/status', { cache: 'no-cache' });
                if (res.ok) {
                    const data = await res.json();
                    if (data.generating) {
                        const gen = data.generated || 0;
                        const tot = data.total || '?';
                        const pct = tot > 0 ? Math.round(gen / tot * 100) : 0;
                        ttsProgressDiv.textContent = 'TTS生成: ' + gen + '/' + tot + ' (' + pct + '%)';
                        ttsProgressDiv.style.color = '#ffc107';
                    } else {
                        ttsProgressDiv.textContent = 'TTS: 就绪';
                        ttsProgressDiv.style.color = '#4caf50';
                    }
                }
            } catch (e) {
                ttsProgressDiv.textContent = 'TTS: 未连接';
                ttsProgressDiv.style.color = '#ff9800';
            }
        };
        pollTts();
        ttsPollIntervalId = setInterval(pollTts, 5000);
    }

    updateTtsProgressVisibility();

    // ===== 控分功能行 =====
    const scoreRow = document.createElement('div');
    scoreRow.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 4px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
        gap: 4px;
    `;

    const scoreLabel = document.createElement('span');
    scoreLabel.textContent = '控分';
    scoreLabel.style.cssText = `font-size: 11px; font-weight: 600; color: #fff; margin-right: 2px;`;

    const scoreEnable = document.createElement('input');
    scoreEnable.type = 'checkbox';
    scoreEnable.checked = fillScoreControlEnabled;
    scoreEnable.style.cssText = `margin: 0 2px; cursor: pointer;`;

    const scoreCountInput = document.createElement('input');
    scoreCountInput.type = 'number';
    scoreCountInput.min = '0';
    scoreCountInput.value = String(fillScoreControlWrongCount);
    scoreCountInput.placeholder = '错题数';
    scoreCountInput.style.cssText = `
        width: 52px; font-size: 11px; text-align: center;
        background: rgba(255,255,255,0.2); color: #fff;
        border: 1px solid rgba(255,255,255,0.3); border-radius: 3px;
        padding: 2px 4px;
    `;
    scoreCountInput.disabled = !fillScoreControlEnabled;
    scoreCountInput.style.opacity = fillScoreControlEnabled ? '1' : '0.5';

    const scoreHint = document.createElement('span');
    scoreHint.textContent = '随机错题';
    scoreHint.style.cssText = `font-size: 10px; color: #ccc;`;

    scoreEnable.addEventListener('change', () => {
        fillScoreControlEnabled = scoreEnable.checked;
        localStorage.setItem('fillScoreControlEnabled', String(fillScoreControlEnabled));
        scoreCountInput.disabled = !fillScoreControlEnabled;
        scoreCountInput.style.opacity = fillScoreControlEnabled ? '1' : '0.5';
        addLogMessage('[控分] ' + (fillScoreControlEnabled ? '已启用' : '已禁用')
            + (fillScoreControlEnabled && fillScoreControlWrongCount <= 0 ? '（请先填写错题数量）' : ''), 'info');
    });

    scoreCountInput.addEventListener('change', () => {
        const v = parseInt(scoreCountInput.value, 10);
        if (Number.isFinite(v) && v >= 0) {
            fillScoreControlWrongCount = v;
            localStorage.setItem('fillScoreControlWrongCount', String(v));
            addLogMessage(`[控分] 错题数量设为 ${v} 题`, 'info');
        } else {
            scoreCountInput.value = String(fillScoreControlWrongCount);
        }
    });

    scoreRow.appendChild(scoreLabel);
    scoreRow.appendChild(scoreEnable);
    scoreRow.appendChild(scoreCountInput);
    scoreRow.appendChild(scoreHint);
    autoFillPanel.appendChild(scoreRow);

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
    addLogMessage('[单次播放模式] 系统初始化完成', 'success');
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
