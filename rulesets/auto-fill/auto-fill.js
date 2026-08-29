/*
 * auto-fill.js
 * 整合自 auto-fill-once.js 的代码：事件驱动翻页流水线 + 控分(错题) + 跟读朗读播放模式切换。
 *
 * 跟读朗读播放模式（控制面板可切换，localStorage 'readAlongPlayMode' 持久化）：
 *   - once   : audioSource.loop = false，录音等待 = 0.5s + audioDuration + 0.5s
 *   - loop   : audioSource.loop = true， 录音等待 = audioDuration * 2
 * 默认 once（单次播放）。
 */

function a366BucketOrigin() {
    if (window.__A366__ && window.__A366__.bucket) return window.__A366__.bucket;
    return 'http://127.0.0.1:5290';
}

// 跟读朗读播放模式: 'once'(单次) / 'loop'(循环)。默认单次播放。
let readAlongPlayMode = localStorage.getItem('readAlongPlayMode') === 'loop' ? 'loop' : 'once';

// ===== 跟读朗读音轨劫持：全局单例 + 世代(epoch) 管理 =====
// 整场自动填答期间复用同一个 AudioContext/stream 与双层劫持，
// 避免每轮新建/关闭导致"停止后再开始 / 一开始"劫持失效。
let _afCtx = null;
let _afGain = null;
let _afDest = null;
let _afStream = null;
let _afOurTracks = null;
let _afHijacked = false;
let _afBlockedCount = 0;
let _afEpoch = 0;         // start/stop 时自增，标记"世代"
let _afRunningEpoch = 0;  // 当前这轮 handleReadAlongQuestions 进入时的世代
let _origReadAlongGum = null;
let _origReadAlongStop = null;
let _origReadAlongProtoGum = null;
let _isFirstReadAlongRecording = true; // 首次录音需要更长等待(覆盖初始化开销)

function isOurHijack(fn) {
    return !!(fn && typeof fn === 'function' && fn.__a366Hijacked__);
}

// 确保 AudioContext 处于 running（resume 失败不阻塞，避免假音轨无声）
async function ensureCtxRunning() {
    if (!_afCtx) return;
    if (_afCtx.state === 'suspended') {
        try {
            await Promise.race([_afCtx.resume(), new Promise(r => setTimeout(r, 800))]);
        } catch (e) {}
    }
}

// 重建全局假音轨（AudioContext + MediaStreamDestination）
function buildFakeStream() {
    _afCtx = new (window.AudioContext || window.webkitAudioContext)();
    _afGain = _afCtx.createGain();
    _afGain.gain.value = 1.0;
    _afDest = _afCtx.createMediaStreamDestination();
    _afGain.connect(_afDest);
    _afStream = _afDest.stream;
    _afOurTracks = new Set(_afStream.getAudioTracks());
}

// 创建/复用全局假音轨，并自检重装劫持（实例 + 原型 + stop 三保险）。
// 可随时重复调用：上下文被关/音轨已 ended 会整组重建，任一劫持丢失会补装。
async function ensureReadAlongHijack() {
    const ctxDead = !_afCtx || _afCtx.state === 'closed';
    const tracksEnded = _afOurTracks && _afOurTracks.size > 0
        && [..._afOurTracks].some(t => t.readyState === 'ended');
    if (ctxDead || tracksEnded) {
        if (_afCtx && _afCtx.state !== 'closed') { try { _afCtx.close(); } catch (e) {} }
        buildFakeStream();
        _afHijacked = false;
    }

    await ensureCtxRunning();

    // 自检：实例 / 原型 / stop 任一丢失 __a366Hijacked__ 标记（被页面/前一轮还原）就补装
    const instHijacked = !!(navigator.mediaDevices && isOurHijack(navigator.mediaDevices.getUserMedia));
    const protoHijacked = !!(window.MediaDevices && MediaDevices.prototype && isOurHijack(MediaDevices.prototype.getUserMedia));
    const stopHijacked = !!(window.MediaStreamTrack && MediaStreamTrack.prototype && isOurHijack(MediaStreamTrack.prototype.stop));

    if (!instHijacked || !protoHijacked || !stopHijacked || !_afHijacked) {
        // 重新采集原生实现（跳过我们自己的劫持函数，避免串台/递归）
        const curInst = navigator.mediaDevices ? navigator.mediaDevices.getUserMedia : null;
        const curProto = (window.MediaDevices && MediaDevices.prototype) ? MediaDevices.prototype.getUserMedia : null;
        if (curInst && !isOurHijack(curInst)) _origReadAlongGum = curInst;
        if (curProto && !isOurHijack(curProto)) _origReadAlongProtoGum = curProto;

        const hijackedGum = async function(constraints) {
            if (constraints && constraints.audio) return _afStream;
            // 若页面已把实例换成原生，则用它，否则用保存的原生，避免递归
            const orig = (this && this.getUserMedia && !isOurHijack(this.getUserMedia))
                ? this.getUserMedia
                : (_origReadAlongGum || _origReadAlongProtoGum);
            if (orig) return orig.call(this, constraints);
            throw new Error('getUserMedia not supported');
        };
        hijackedGum.__a366Hijacked__ = true;
        if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = hijackedGum;
        if (window.MediaDevices && MediaDevices.prototype) MediaDevices.prototype.getUserMedia = hijackedGum;

        if (!_origReadAlongStop || isOurHijack(_origReadAlongStop)) {
            _origReadAlongStop = MediaStreamTrack.prototype.stop;
        }
        const hijackedStop = function() {
            if (_afOurTracks && _afOurTracks.has(this)) {
                _afBlockedCount++;
                console.log('[auto-fill] 阻止 track.stop() #' + _afBlockedCount);
                addLogMessage('跟读朗读: 阻止组件 stop track #' + _afBlockedCount, 'info');
                return; // 不真正 stop，保持 track live
            }
            return _origReadAlongStop.call(this);
        };
        hijackedStop.__a366Hijacked__ = true;
        MediaStreamTrack.prototype.stop = hijackedStop;

        _afHijacked = true;
    }
    return { ctx: _afCtx, gain: _afGain, stream: _afStream, ourTracks: _afOurTracks };
}

// 停止时还原劫持并关闭全局 AudioContext
function stopReadAlongHijack() {
    if (_afHijacked) {
        if (!isOurHijack(_origReadAlongGum) && _origReadAlongGum && navigator.mediaDevices) navigator.mediaDevices.getUserMedia = _origReadAlongGum;
        if (!isOurHijack(_origReadAlongProtoGum) && _origReadAlongProtoGum && window.MediaDevices && MediaDevices.prototype) MediaDevices.prototype.getUserMedia = _origReadAlongProtoGum;
        if (!isOurHijack(_origReadAlongStop) && _origReadAlongStop) MediaStreamTrack.prototype.stop = _origReadAlongStop;
    }
    _afHijacked = false;
    if (_afOurTracks && _origReadAlongStop && !isOurHijack(_origReadAlongStop)) {
        for (const t of _afOurTracks) { try { _origReadAlongStop.call(t); } catch (e) {} }
    }
    if (_afCtx && _afCtx.state !== 'closed') { try { _afCtx.close(); } catch (e) {} }
    _afCtx = null; _afGain = null; _afDest = null; _afStream = null; _afOurTracks = null;
}

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
let isWorking = false; // 单执行链重入锁：上一轮 work()（含翻页动画等待）未结束时不允许重入
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
        const url = customBucketUrl || (a366BucketOrigin() + '/fill-answer');
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
                // XML 各分区从"第N题"重新编号时会撞车（如完成句子与整句批改都从35开始）。
                // 同一题号若来自不同 elementId，绝不能合并进同一张答案列表，
                // 否则整句批改的完整句子会被顺次塞进填空题的输入框。
                // 撞车的分区改为按 elementId 分组存放，填入时按输入框数量挑最贴合的一组。
                const multiAnswerGroups = new Map();

                for (let i of data) {
                    // 全来源接入：阅读回答等新题型的答案可能存于 paper.xml 附件或
                    // 其他提取模式，不再限定 correctAnswer.xml；
                    // 非答案行（无 answer/multipleAnswers/questionNo 字段）由下方过滤
                    if (i.answer !== undefined || i.multipleAnswers !== undefined || i.questionNo !== undefined) {
                        let parts = [];
                        if (Array.isArray(i.multipleAnswers) && i.multipleAnswers.length > 0) {
                            parts = i.multipleAnswers.map(x => String(x).trim()).filter(Boolean);
                        } else if (typeof i.answer === 'string') {
                            let raw = i.answer.replace(/\s+/g, ' ').trim();
                            // 多等价完整答案（阅读回答题型，如 "A||B||C"，|| 分隔的是
                            // 同一空的可接受写法而非不同空）：取首选写入
                            raw = raw.split('||')[0].trim();
                            if (raw.includes('/')) {
                                parts = raw.split('/').map(s => s.trim()).filter(Boolean);
                            } else if (raw) {
                                parts = [raw];
                            }
                        }
                        if (parts.length === 0) continue;

                        // 题号解析：优先显式 questionNo 字段，其次 "第N题" 正则；
                        // 两者皆无的条目（元数据/附件描述行）直接跳过，防止污染低题号
                        let questionNum = parseInt(i.questionNo, 10);
                        if (!Number.isFinite(questionNum) || questionNum <= 0) {
                            questionNum = 0;
                            if (i.question && typeof i.question === 'string') {
                                const m = i.question.match(/第(\d+)题/);
                                if (m) questionNum = parseInt(m[1], 10);
                            }
                        }
                        if (!questionNum || questionNum <= 0) continue;

                        if (!multiAnswerMap.has(questionNum)) {
                            multiAnswerMap.set(questionNum, []);
                        }

                        const baseAnswerIndex = Number.isFinite(i.answerIndex) && i.answerIndex > 0 ? i.answerIndex : 1;
                        const entryItems = [];
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

                            entryItems.push({
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

                        // 题号撞车检测：同题号不同 elementId → 转入分组存储
                        const existFlat = multiAnswerMap.get(questionNum);
                        if (existFlat && existFlat.length > 0 && existFlat[0].elementId !== i.elementId) {
                            multiAnswerMap.delete(questionNum);
                            multiAnswerGroups.set(questionNum, [
                                { elementId: existFlat[0].elementId, items: existFlat },
                                { elementId: i.elementId, items: entryItems }
                            ]);
                        } else if (multiAnswerGroups.has(questionNum)) {
                            const groups = multiAnswerGroups.get(questionNum);
                            let merged = false;
                            for (const g of groups) {
                                if (g.elementId === i.elementId) {
                                    g.items.push(...entryItems);
                                    merged = true;
                                    break;
                                }
                            }
                            if (!merged) groups.push({ elementId: i.elementId, items: entryItems });
                        } else {
                            if (!multiAnswerMap.has(questionNum)) {
                                multiAnswerMap.set(questionNum, []);
                            }
                            multiAnswerMap.get(questionNum).push(...entryItems);
                        }
                    }
                }

                for (let [questionNum, answerList] of multiAnswerMap) {
                    answerList.sort((a, b) => (a.answerIndex || 1) - (b.answerIndex || 1));
                    multiAnswerMap.set(questionNum, answerList);
                }

                for (let [questionNum, groups] of multiAnswerGroups) {
                    for (const g of groups) {
                        g.items.sort((a, b) => (a.answerIndex || 1) - (b.answerIndex || 1));
                    }
                    multiAnswerGroups.set(questionNum, groups);
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
                window.multiAnswerGroups = multiAnswerGroups;
                window.elementAnswerMap = elementAnswerMap;
                window.questionNumAnswerMap = answerMap;
                // 对外暴露分组友好接口：外部脚本请迁移到
                // getAnswersForQuestionNum(num, inputCount, elementId)，
                // 直读 multiAnswerMap 将看不到撞车分区（multiAnswerGroups）里的答案
                window.getAnswersForQuestionNum = getAnswersForQuestionNum;

                bucketLoaded = true;
                bucketError = null;
                updateAutoFillPanelStatus();
                addLogMessage('填空答案库加载成功，共 ' + answers.length + ' 个题目', 'success');

                const multiBlankCount = Array.from(multiAnswerMap.values()).filter(list => list.length > 1).length
                    + Array.from(multiAnswerGroups.values()).reduce((acc, gs) => acc + gs.filter(g => g.items.length > 1).length, 0);
                if (multiBlankCount > 0) {
                    addLogMessage(`检测到 ${multiBlankCount} 个多空/多选题`, 'info');
                    for (let [qNum, ansList] of multiAnswerMap) {
                        if (ansList.length > 1) {
                            const answerTexts = ansList.map(a => a.answer).join(', ');
                            addLogMessage(`  题${qNum}: ${ansList.length}个答案 → [${answerTexts}]`, 'info');
                        }
                    }
                    for (let [qNum, groups] of multiAnswerGroups) {
                        for (const g of groups) {
                            addLogMessage(`  题${qNum}(分区): ${g.items.length}个答案 → [${g.items.map(a => a.answer).join(', ')}]`, 'info');
                        }
                    }
                }

                addLogMessage('内容匹配模式: ' + (contentMatchMode ? '已启用' : '已禁用'), 'info');
                addLogMessage('支持选择题: ' + (supportChoiceQuestions ? '已启用' : '已禁用'), 'info');
                addLogMessage('支持跟读朗读: ' + (supportReadAlong ? '已启用' : '已禁用'), 'info');
                addLogMessage('跟读朗读播放模式: ' + (readAlongPlayMode === 'once' ? '单次播放' : '循环播放'), 'info');

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
        // 题干为单个字母（如"A"/"B"）是答案字母的提取残留，非真实题干；
        // 参与匹配会在共享同一字母的多道题之间产生歧义命中（答案来回翻转），直接跳过
        if (/^[A-Fa-f]$/.test(matchText.trim())) return;
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

// 按题号取答案列表。XML 分区题号撞车时（multiAnswerGroups），同一题号挂着
// 多个分区的答案组，无法从题号本身区分——改用"输入框数量"挑最贴合的一组：
// 优先选 items 数不超过输入框数的分组里答案最多的（如3个空的完成句子题
// 会选中 [lost, his, life] 而不是整句批改的单句答案，反之亦然）。
// 若调用方能提供 elementId（内容匹配等场景），则跳过启发式直接精确匹配。
function getAnswersForQuestionNum(num, inputCount, elementId) {
    // ① elementId 精确路径：跨分区绝对无歧义，永远优先于启发式
    if (elementId && window.elementAnswerMap && window.elementAnswerMap.has(elementId)) {
        return window.elementAnswerMap.get(elementId).map(a => a.answer);
    }
    // ② 撞车分组：按输入框数量挑最贴合的分区组
    const groups = window.multiAnswerGroups && window.multiAnswerGroups.get(num);
    if (groups && groups.length > 0) {
        let best = null;
        if (inputCount > 0) {
            for (const g of groups) {
                const n = g.items.length;
                if (n <= inputCount && (!best || n > best.items.length)) best = g;
            }
        }
        if (!best) best = groups.reduce((a, b) => (b.items.length > a.items.length ? b : a), groups[0]);
        addLogMessage(`题${num} 命中 ${groups.length} 个同名分区答案组，按输入框数 ${inputCount} 选用含 ${best.items.length} 个答案的分组`, 'info');
        return best.items.map(a => a.answer);
    }
    const flat = window.multiAnswerMap && window.multiAnswerMap.get(num);
    if (flat && flat.length > 0) return flat.map(a => a.answer);
    return null;
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
            if (candidatesList.length === 1) return candidatesList[0];
            candidatesList.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return (b.answer.length || 0) - (a.answer.length || 0);
            });
            return candidatesList[0];
        }

        let targetAnswer = null;
        let backendQuestionNum = null;
        let backendElementId = null;
        if (questionText) {
            const match = findAnswerByContent(questionText);
            if (match) {
                // 最优匹配：优先完全相等，其次选 cleanText 最长(更具体)的选项，
                // 避免正确答案 "to look" 被其子串 "look"(DOM 序靠前时)抢先命中
                let bestOi = -1;
                let bestLen = -1;
                for (let oi = 0; oi < optionsData.length; oi++) {
                    if (!answerMatchesOption(match.answer, optionsData[oi].cleanText)) continue;
                    const ansClean = match.answer.toLowerCase().replace(/\s+/g, '');
                    const optClean = optionsData[oi].cleanText.toLowerCase().replace(/\s+/g, '');
                    if (ansClean === optClean) { bestOi = oi; break; }
                    if (optionsData[oi].cleanText.length > bestLen) { bestOi = oi; bestLen = optionsData[oi].cleanText.length; }
                }
                if (bestOi >= 0) {
                    targetAnswer = optionsData[bestOi].cleanText;
                    backendQuestionNum = match.questionNum;
                    backendElementId = match.elementId || null;
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
                            backendElementId = item.elementId || null;
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
                    candidates.push({ answer: item.answer, score, matchIndex, elementId: item.elementId });
                } else {
                    const itemAns = item.answer.replace(/\s+/g, '').toLowerCase();
                    const optText = optionsData[matchIndex].cleanText.replace(/\s+/g, '').toLowerCase();
                    const isExact = itemAns === optText;
                    const isShort = itemAns.length <= optText.length + 5;
                    if (isExact || isShort) {
                        candidates.push({ answer: item.answer, score: 0, matchIndex, elementId: item.elementId });
                    }
                }
            }
            const bestCandidate = pickBestAnswer(candidates);
            if (bestCandidate) {
                targetAnswer = bestCandidate.answer;
                backendElementId = bestCandidate.elementId || null;
            }
        }

        // 策略3(字母匹配)已移除：原实现遍历整个答案库找第一条纯字母答案，
        // 不校验归属题号，导致任何卷内存在字母答案时所有未解析的选择题
        // 都被强制点同一个字母。字母兜底逻辑已由下方 allAnswersForQuestion
        // 构建后的 letterAnswers 循环接管（作用域正确限定在本题答案内）。

        if (targetAnswer && !backendQuestionNum) {
            const entry = rawAnswerData.find(item => answerMatchesOption(item.answer, targetAnswer));
            if (entry) backendQuestionNum = entry.questionNum;
        }

        let allAnswersForQuestion = [];
        const lookupNum = backendQuestionNum || questionNum;
        // 统一走分组友好接口：撞车分区的题号已迁移进 multiAnswerGroups，
        // 直接读 flat multiAnswerMap 会"看不到"这些答案，导致多选/多空漏填。
        // 能拿到 elementId 时（策略1/2/反查命中）由接口内部精确匹配，跳过启发式
        const resolvedChoices = getAnswersForQuestionNum(lookupNum, optionsData.length, backendElementId);
        if (resolvedChoices && resolvedChoices.length > 0) {
            allAnswersForQuestion = resolvedChoices.filter(Boolean);
        }
        if (allAnswersForQuestion.length === 0 && targetAnswer) {
            allAnswersForQuestion = [targetAnswer];
        }

        if (allAnswersForQuestion.length === 0) continue;

        let matched = false;

        for (const answerText of allAnswersForQuestion) {
            // 在所有通过匹配的选项中选最优：完全相等 > cleanText 最长（更具体）。
            // 避免正确答案 "to look" 被其子串 "look"（DOM 序恰好靠前时）抢先命中
            let bestIdx = -1;
            let bestLen = -1;
            for (let oi = 0; oi < optionsData.length; oi++) {
                const od = optionsData[oi];
                if (od.element.classList.contains('is-checked')) continue;
                if (!answerMatchesOption(answerText, od.cleanText)) continue;
                const ansClean = answerText.replace(/\s+/g, '').toLowerCase();
                const optClean = od.cleanText.replace(/\s+/g, '').toLowerCase();
                if (ansClean === optClean) { bestIdx = oi; break; }
                if (od.cleanText.length > bestLen) { bestIdx = oi; bestLen = od.cleanText.length; }
            }
            if (bestIdx === -1) continue;
            const od = optionsData[bestIdx];
            const clickTarget = od.element.classList.contains('u3-option-img')
                ? (od.element.querySelector('.u3-option-img__content') || od.element)
                : od.element;
            clickTarget.click();
            filledCount++;
            addLogMessage(`选择题 ${questionNum} 选中: ${od.rawText}`, 'success');
            await wait1(50);
            matched = true;
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

// ===== 跟读朗读题型处理（支持单次/循环播放两种模式） =====

function waitInterruptible(ms) {
    return new Promise(resolve => {
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

// ===== 跟读朗读：复用全局单例劫持（见 ensureReadAlongHijack），按播放模式播放音频 =====
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
        if (nameEl && (nameEl.textContent.includes('跟读') || nameEl.textContent.includes('口语跟读') || nameEl.textContent.includes('听读') || nameEl.textContent.includes('朗读'))) {
            readAlongQuestions.push(el);
        }
    }

    if (readAlongQuestions.length === 0) return 0;

    isReadAlongProcessing = true;
    readAlongAborted = false;
    let processedCount = 0;

    let directAnswers = [];
    try {
        const url = customBucketUrl || (a366BucketOrigin() + '/fill-answer');
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

    // 复用全局单例劫持并自检重装；记录本世代，用于识别"停止/重启"后失效的旧回调
    _afRunningEpoch = _afEpoch;
    const ep = _afRunningEpoch;
    let setup = await ensureReadAlongHijack();
    let globalAudioCtx = setup.ctx;
    let globalGain = setup.gain;
    let globalFakeStream = setup.stream;
    let ourTracks = setup.ourTracks;

    addLogMessage('跟读朗读: 双层劫持就绪 (' + (readAlongPlayMode === 'once' ? '单次播放' : '循环播放') + ', tracks: ' + ourTracks.size + ')', 'info');

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
            if (nameEl && (nameEl.textContent.includes('跟读') || nameEl.textContent.includes('口语跟读') || nameEl.textContent.includes('听读') || nameEl.textContent.includes('朗读'))) {
                currentQuestions.push(el);
            }
        }

        if (currentQuestions.length === 0) {
            return 0;
        }

        for (const questionEl of currentQuestions) {
            if (readAlongAborted || _afEpoch !== ep) break;

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
                    clone.querySelectorAll('button, .u3-recorder-bts, .u3-recorder-panel, .u3-audioPlayer, [slot*="audio"]').forEach(e => e.remove());
                    readText = clone.textContent.trim();
                }
                addLogMessage('跟读朗读: readText=' + readText.substring(0, 60) + (readText.length > 60 ? '...' : '') + ' (len=' + readText.length + ')', 'info');
                if (!readText) {
                    addLogMessage('跟读朗读: 未找到朗读文本，跳过', 'warning');
                    continue;
                }

                addLogMessage(`跟读朗读: 开始处理第 ${processedCount + 1} 题`, 'info');

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

            try {
                let ttsReady = false;
                for (let poll = 0; poll < 30; poll++) {
                    if (readAlongAborted || _afEpoch !== ep) break;
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

            if (readAlongAborted || _afEpoch !== ep) break;

            if (!ttsWavData) {
                addLogMessage('跟读朗读: 使用浏览器语音合成回退', 'info');

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

            const isOnce = readAlongPlayMode !== 'loop';
            // 每题前重新自检/补装劫持，并刷新全局引用（若音轨已 ended 会整组重建）
            setup = await ensureReadAlongHijack();
            globalAudioCtx = setup.ctx;
            globalGain = setup.gain;
            globalFakeStream = setup.stream;
            ourTracks = setup.ourTracks;
            let audioSource = null;
            let audioDuration = 0;
            try {
                const audioBuffer = await globalAudioCtx.decodeAudioData(ttsWavData);
                audioSource = globalAudioCtx.createBufferSource();
                audioSource.buffer = audioBuffer;
                // 播放模式：once=单次不循环；loop=循环播放
                audioSource.loop = !isOnce;
                audioSource.connect(globalGain);
                // 不在此处 start，等录音后再播放
                audioDuration = audioBuffer.duration;
                addLogMessage(`跟读朗读: 音频源就绪 (时长 ${audioDuration.toFixed(1)}s, ${isOnce ? '单次播放' : '循环播放'})`, 'success');
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

            const hijackActive = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
                && navigator.mediaDevices.getUserMedia.__a366Hijacked__);
            addLogMessage(`跟读朗读: 点击录音按钮 (劫持${hijackActive ? '生效' : '已失效!'})`, 'info');
            vueClick(recorderBtn);

            // 录音按钮点击是用户手势，此时显式 resume AudioContext（之前非手势时 resume 会被浏览器忽略）
            if (globalAudioCtx && globalAudioCtx.state !== 'running') {
                try {
                    await Promise.race([globalAudioCtx.resume(), new Promise(r => setTimeout(r, 500))]);
                } catch (e) {}
            }
            addLogMessage('跟读朗读: AudioContext 状态=' + (globalAudioCtx ? globalAudioCtx.state : 'null'), 'info');

            // 动态等待：首次录音有 AudioContext/劫持初始化开销，需要更长的等待；
            // 后续录音初始化已完成，用较短等待即可
            const preAudioWait = _isFirstReadAlongRecording
                ? (isOnce ? 1500 : 2000)
                : (isOnce ? 500 : 1000);
            addLogMessage('跟读朗读: 等待 ' + preAudioWait + 'ms 后播放音频' + (_isFirstReadAlongRecording ? ' (首次)' : ' (后续)'), 'info');
            await waitInterruptible(preAudioWait);
            if (audioSource && globalAudioCtx && globalAudioCtx.state === 'running') {
                try { audioSource.start(); } catch(e) {}
            } else if (audioSource) {
                addLogMessage('跟读朗读: AudioContext 未 running(' + (globalAudioCtx ? globalAudioCtx.state : 'null') + ')，尝试最后 resume', 'warning');
                try {
                    await globalAudioCtx.resume();
                    audioSource.start();
                } catch(e) {}
            }

            // 等待录音：once=播放完成后再过 0.5s；loop=音频×2（均最少 1s）
            const waitTime = isOnce
                ? Math.ceil(audioDuration * 1000) + 500
                : Math.max(Math.ceil(audioDuration * 2 * 1000), 1000);
            addLogMessage(`跟读朗读: 等待录音中... (音频 ${audioDuration.toFixed(1)}s, 共 ${(waitTime / 1000).toFixed(1)}s)`, 'info');
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
            addLogMessage(`跟读朗读: 第 ${processedCount} 题完成`, 'success');
            // 首次录音已完成，后续录音用较短等待
            if (_isFirstReadAlongRecording) _isFirstReadAlongRecording = false;

            await waitInterruptible(1500);
        }

        if (processedCount > 0) {
            addLogMessage(`跟读朗读: ${readAlongPlayMode === 'loop' ? '循环' : '单次'}播放 本轮共处理 ${processedCount} 个跟读题目`, 'success');
        }
    } catch (e) {
        addLogMessage('跟读朗读处理异常: ' + e.message, 'error');
    } finally {
        // 劫持为全局单例跨轮复用，这里不还原、不关闭 AudioContext。
        // epoch 已变化说明本回调已被停止/重启，静默退出即可，劫持交给新世代。
        addLogMessage('跟读朗读: 本轮回调结束 (共阻止 ' + _afBlockedCount + ' 次 track.stop)', 'info');
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

// 填充当前页：选择题 + 填空（内容匹配/题号匹配），不翻页、不跟读。
// 抽取为独立函数，供并发模式在翻页动画期间预填下一页复用。
async function fillCurrentPage() {
    const isU3InputPage = !!document.querySelector('.u3-input__content--input');

    const getInputs = (root) => {
        const a = root.getElementsByClassName('u3-input__content--input');
        if (a && a.length) return a;
        return root.getElementsByClassName('u3-input__content');
    };

    const setElValue = (el, v) => {
        if (!el) return false;
        // 同一空存在多个等价完整答案时（阅读回答题型，"A||B||C"），
        // 取首选答案写入，避免整串原样提交判错
        if (typeof v === 'string' && v.includes('||')) {
            v = v.split('||')[0].trim();
        }
        // 同一空存在多个可接受答案时（如 laws/aws、ought/ught，写不写首字母都给分），
        // XML 会把变体用紧贴的 / 拼在同一答案里；只取第一个变体填入，
        // 否则 "laws/aws" 会被原样写进空格导致判错。
        // 注意区分两种语义：带空格的 " / " 是分空分隔符（加载层已按其拆分，
        // 此处防御性保持原样不截断），紧贴斜杠才是变体分隔符
        if (typeof v === 'string' && v.includes('/') && !/\s\/\s/.test(v)) {
            v = v.split('/')[0].trim();
        }
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
        // 整句批改(U3WholeMark)、半批改(U3HalfMark)在 blur 时才保存答案（"失焦保存"）。
        // 仅对这类组件补发焦点事件，其他 textarea/contenteditable 组件保持原行为，
        // 避免误触发额外校验/提交/弹窗等副作用
        if (tag === 'textarea' && el.classList && el.classList.contains('u3-translate__textarea')) {
            try {
                el.focus();
                el.dispatchEvent(new FocusEvent('blur'));
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

    // ===== 整句批改(U3WholeMark)：textarea.u3-translate__textarea，中文提示句内容匹配 =====
    // 该组件的 DOM 与普通填空完全不同（题干在 .u3-translate__text，输入是 textarea），
    // 常规扫描扫不到，这里独立处理，题号匹配/内容匹配两种模式下都生效。
    const fillTranslateQuestions = async () => {
        const areas = document.querySelectorAll('textarea.u3-translate__textarea');
        if (!areas.length) return 0;
        let count = 0;
        for (const ta of areas) {
            if (ta.readOnly || ta.disabled) continue;
            // 向上找到同时包含题干文本与输入框的组件根节点
            let comp = ta.closest('.u3-translate');
            if (!comp || !comp.querySelector('.u3-translate__text')) {
                let el = ta.parentElement;
                while (el && el !== document.body && !el.querySelector('.u3-translate__text')) {
                    el = el.parentElement;
                }
                comp = (el && el !== document.body) ? el : null;
            }
            if (!comp) continue;
            const clone = comp.cloneNode(true);
            clone.querySelectorAll('textarea, input, button, [contenteditable]').forEach(el => el.remove());
            const hintText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
            if (!hintText) continue;
            const cleanHint = hintText.replace(/分值\d+分\s*/g, '').replace(/^\d+[\s\.\)]*/, '').trim();
            const match = findAnswerByContent(cleanHint);
            let answerText = match ? match.answer : null;
            let matchInfo = match ? ('相似度: ' + Math.round(match.similarity) + '%') : '';
            if (!answerText) {
                // 内容匹配回退：此类题的 questionText 存的是答案本身而非真实题干
                // （阅读回答/整句批改共用该组件时），拿页面问题比答案文本必然失配。
                // 改按组件附近的题号直查答案库
                let numEl = comp.querySelector('.u3-question-no, .u3-question__no, [class*="question-no"], .u3-input__prepared, .u3-question-container__ques-order--number');
                if (!numEl) {
                    let parent = comp.parentElement;
                    for (let up = 0; up < 5 && parent && parent !== document.body; up++) {
                        numEl = parent.querySelector('.u3-question-no, .u3-question__no, [class*="question-no"], .u3-input__prepared, .u3-question-container__ques-order--number');
                        if (numEl) break;
                        parent = parent.parentElement;
                    }
                }
                const parsedNum = numEl ? parseInt(numEl.textContent.trim(), 10) : NaN;
                if (Number.isFinite(parsedNum) && parsedNum > 0) {
                    const resolved = getAnswersForQuestionNum(parsedNum, 1);
                    if (resolved && resolved.length > 0) {
                        answerText = resolved[0];
                        matchInfo = '题号' + parsedNum;
                    }
                }
            }
            if (!answerText) {
                addLogMessage(`整句批改 未匹配到答案: ${cleanHint.substring(0, 40)}...`, 'warning');
                continue;
            }
            if (setElValue(ta, answerText)) {
                count++;
                addLogMessage(`整句批改 填入答案 (${matchInfo}): ${answerText}`, 'success');
                await wait1(80);
            }
        }
        return count;
    };

    const choiceFilledCount = supportChoiceQuestions ? await fillChoiceQuestions() : 0;

    const preparedElements = getPreparedElements(document);
    const inputElements = getInputs(document);

    let filledCount = 0;

    if (contentMatchMode) {
        addLogMessage('使用内容匹配模式', 'info');

        // 只处理当前 active slide 内的题目：swiper 懒加载时 document 中已渲染多页，
        // 全文档遍历会让相似度计算量随翻页累积、严重拖慢翻页节奏。
        // 非 swiper 整卷页面（无 active slide）回退全文档。
        const activeSlideForMatch = document.querySelector('.swiper-slide-active');
        let questionTexts = [];
        if (activeSlideForMatch) {
            questionTexts = activeSlideForMatch.getElementsByClassName('u3-question-text');
        }
        if (questionTexts.length === 0) {
            // 备选：使用 u3-fillblank-base__cont（新版页面无 u3-question-text 时）
            if (activeSlideForMatch) {
                questionTexts = activeSlideForMatch.getElementsByClassName('u3-fillblank-base__cont');
            } else {
                questionTexts = document.getElementsByClassName('u3-question-text');
                if (questionTexts.length === 0) {
                    questionTexts = document.getElementsByClassName('u3-fillblank-base__cont');
                }
            }
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

                    if (!answersToFill) {
                        let resolved = getAnswersForQuestionNum(questionNum, containerInputs.length);
                        if (!resolved && match.questionNum) {
                            resolved = getAnswersForQuestionNum(match.questionNum, containerInputs.length);
                            if (resolved) questionNum = match.questionNum;
                        }
                        if (resolved) answersToFill = resolved;
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
                    // 内容匹配失败时的题号回退：阅读回答等题型库内无真实题干
                    // （questionText 存的是答案本身），match 必为 null。
                    // 用全局配对数组（与题号匹配模式同源）定位本容器首个输入框
                    // 对应的题号，再直查答案库——确定性命中，不依赖题干文本
                    const allPrep = Array.from(preparedElements);
                    const allInp = Array.from(inputElements);
                    let scopedNum = NaN;
                    for (let pi = 0; pi < allInp.length; pi++) {
                        if (scopeEl.contains(allInp[pi])) {
                            const pn = allPrep[pi] ? parseInt(allPrep[pi].innerHTML) : NaN;
                            if (!isNaN(pn) && pn > 0) scopedNum = pn;
                            break;
                        }
                    }
                    const resolvedFb = Number.isFinite(scopedNum)
                        ? getAnswersForQuestionNum(scopedNum, containerInputs.length)
                        : null;
                    if (resolvedFb && resolvedFb.length > 0) {
                        const fbFilled = await fillByAnswers(containerInputs, resolvedFb);
                        filledCount += fbFilled;
                        if (fbFilled > 0) {
                            addLogMessage(`题目 ${scopedNum} 题号回退填入 (${fbFilled}个空): ${resolvedFb.slice(0, fbFilled).join(' / ')}`, 'success');
                            await wait1(100);
                        }
                    } else {
                        addLogMessage(`题目 ${i + 1} 未找到匹配答案: ${cleanQuestionText.substring(0, 50)}...`, 'warning');
                    }
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

            let currentInputIndex = i;
            while (currentInputIndex < modePrepared.length && parseInt(modePrepared[currentInputIndex].innerHTML) === questionNum) {
                currentInputIndex++;
            }
            const inputsSlice = modeInputs.slice(i, currentInputIndex);

            let answersToFill = getAnswersForQuestionNum(questionNum, inputsSlice.length);
            if (!answersToFill) {
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

    try {
        filledCount += await fillTranslateQuestions();
    } catch (e) {
        addLogMessage('整句批改填充异常(已跳过): ' + (e && e.message || e), 'error');
    }

    if (filledCount > 0) {
        addLogMessage('已填入 ' + filledCount + ' 个答案', 'success');
    } else {
        addLogMessage('未找到可填入的题目', 'warning');
    }

    if (choiceFilledCount > 0) {
        addLogMessage('已选择 ' + choiceFilledCount + ' 个选择题答案', 'success');
    }

    return filledCount;
}

async function work() {
    if (isReadAlongProcessing) return;

    // 单一事件驱动流水线：填当前页 → 立即翻页 → 继续下一页，翻页由"填答完成"触发，
    // 不再依赖 setInterval 的下一个 tick（消除翻页滞后）。
    // 实测：swiper 支持动画中连翻（slideTo 后 activeIndex 立即切换、动画自动中断），
    // 翻页无需等待动画播放完，80ms 缓冲即可继续下一次翻页。
    if (isWorking) return;
    isWorking = true;
    try {
        // 事件驱动循环：正常在最后一页（turnNextPage 返回 false）或停止时 break
        for (let i = 0; i < 500; i++) { // 兜底上限，防止异常死循环
            // 等当前 active slide 渲染完成再填（swiper 懒加载晚于 activeIndex 切换，防漏答）
            await waitSlideRendered();
            try {
                await fillCurrentPage();
            } catch (e) {
                // 单页异常不中断整轮翻页，记录日志便于定位
                addLogMessage('本页填充异常(已跳过,继续翻页): ' + (e && e.message || e), 'error');
            }

            try {
                const readAlongCount = supportReadAlong && contentMatchMode ? await handleReadAlongQuestions() : 0;
                if (readAlongCount > 0) {
                    addLogMessage('本次跟读朗读完成 ' + readAlongCount + ' 题', 'success');
                }
            } catch (e) {
                addLogMessage('跟读处理异常(已跳过,继续翻页): ' + (e && e.message || e), 'error');
            }

            if (readAlongAborted) break;
            if (!(await turnNextPage())) break; // 已到最后一页

            // 实测：无需等待翻页动画播放完，80ms 缓冲即可继续下一次翻页
            await wait1(80);
        }
    } finally {
        isWorking = false;
    }
}

// 翻到下一页：点击"下一页"按钮触发页面自己的翻页逻辑（与 dbd9449 版本一致）。
// 点击后检测 activeIndex 是否前进判断翻页是否成功（短暂等待容错按钮点击的异步触发），
// 最后一页时按钮无效、activeIndex 不变 → 返回 false 停止循环。
async function turnNextPage() {
    const swiperEl = document.querySelector('.swiper');
    const swiper = swiperEl && swiperEl.swiper;
    const before = swiper ? swiper.activeIndex : -1;

    const nextBtn = findButtonByText('下一题', '下一页');
    if (!nextBtn) return false;
    nextBtn.click();
    addLogMessage('已点击翻页按钮（下一页）', 'info');

    // 等待 activeIndex 前进（最多 500ms；最后一页按钮点击无效时 activeIndex 不变）
    const deadline = Date.now() + 500;
    while (swiper && Date.now() < deadline && swiper.activeIndex <= before) {
        await wait1(30);
    }
    if (swiper && swiper.activeIndex > before) {
        addLogMessage('已翻到第 ' + (swiper.activeIndex + 1) + ' 题', 'info');
        return true;
    }
    return false; // activeIndex 未前进 = 已到最后一页
}

// 等待当前 active slide 渲染完成。
// swiper 懒加载渲染晚于 activeIndex 切换，不等渲染就填充会漏答；轮询题型元素出现，超时兜底。
async function waitSlideRendered(timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const activeSlide = document.querySelector('.swiper-slide-active');
        if (activeSlide && activeSlide.querySelector('.u3-input__content--input, .u3-input__content, .u3-option__content, .partA_word_repeat, .u3-paragraphRepeat, .u3-question-container')) {
            return true;
        }
        await wait1(30);
    }
    return false;
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
    const wrongResolved = getAnswersForQuestionNum(nextNum, 0);
    if (wrongResolved && wrongResolved.length > 0) return wrongResolved;
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
    _isFirstReadAlongRecording = true; // 每次启动重置：首次录音需要更长等待覆盖初始化开销

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
    addLogMessage('自动填空已启动 [' + '跟读朗读播放模式：' + (readAlongPlayMode === 'once' ? '单次播放' : '循环播放') + '], 间隔: ' + autoFillDelay + 'ms', 'info');
}

function stopAutoFill() {
    if (autoFillIntervalId) {
        clearInterval(autoFillIntervalId);
        autoFillIntervalId = null;
    }
    _afEpoch++;               // 标记世代变更，令在跑的旧读本回调失效
    stopReadAlongHijack();    // 还原劫持并关闭全局 AudioContext
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
        // 没有自定义地址时用代理层注入的真实端口。bucket 端口是可改的，
        // 写死 5290 一旦用户改过就全链路失联。
        return a366BucketOrigin();
    },
    push: function() {
        var payload = {
            enabled: fillTimeModEnabled === true,
            seconds: (fillTimeModSeconds === null || fillTimeModSeconds === undefined)
                ? null : fillTimeModSeconds,
            fillSubmitUrl: 'study-api.up366.cn/client/task/score/submit/v2'
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
    messageDiv.textContent = 'Auto366自动填空注入成功，请点击控制面板的开始填空按钮';
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
    titleSpan.textContent = '运行日志';
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

    fetch(a366BucketOrigin() + '/save-log', {
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
    titleSpan.textContent = '自动填空';
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
        const modeText = readAlongPlayMode === 'loop' ? '循环播放' : '单次播放';
        const statusText = supportReadAlong ? (contentMatchMode ? '(开启)' : '(已禁用-需先开启内容匹配)') : '(关闭)';
        supportReadAlongLabel.innerHTML = `
            <span style="color: ${color};">
                支持跟读朗读(需要先开启内容匹配) ${statusText} [${modeText}]
            </span>
        `;
    }

    updateReadAlongLabel();

    supportReadAlongRow.appendChild(supportReadAlongCheckbox);
    supportReadAlongRow.appendChild(supportReadAlongLabel);
    autoFillPanel.appendChild(supportReadAlongRow);

    // 跟读朗读播放模式切换（单次播放 / 循环播放）
    const readAlongModeRow = document.createElement('div');
    readAlongModeRow.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 4px 4px 4px 16px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
        opacity: ${(contentMatchMode && supportReadAlong) ? '1' : '0.5'};
    `;
    const readAlongModeSelect = document.createElement('select');
    readAlongModeSelect.style.cssText = `
        font-size: 11px;
        margin-right: 8px;
        background: #333;
        color: #fff;
        border: 1px solid #555;
        border-radius: 3px;
    `;
    ['once', 'loop'].forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m === 'once' ? '单次播放' : '循环播放';
        if (m === readAlongPlayMode) opt.selected = true;
        readAlongModeSelect.appendChild(opt);
    });
    readAlongModeSelect.disabled = !(contentMatchMode && supportReadAlong);
    readAlongModeSelect.addEventListener('change', () => {
        readAlongPlayMode = readAlongModeSelect.value;
        localStorage.setItem('readAlongPlayMode', readAlongPlayMode);
        updateReadAlongLabel();
        addLogMessage('跟读朗读播放模式: ' + (readAlongPlayMode === 'once' ? '单次播放' : '循环播放'), 'info');
    });
    const readAlongModeLabel = document.createElement('label');
    readAlongModeLabel.style.cssText = 'font-size: 11px; flex: 1;';
    readAlongModeLabel.textContent = '跟读播放模式';
    readAlongModeRow.appendChild(readAlongModeSelect);
    readAlongModeRow.appendChild(readAlongModeLabel);
    autoFillPanel.appendChild(readAlongModeRow);

    // 同步模式开关的可用状态（随 内容匹配/支持跟读 联动禁用）
    const syncReadAlongModeState = () => {
        const on = contentMatchMode && supportReadAlong;
        readAlongModeSelect.disabled = !on;
        readAlongModeRow.style.opacity = on ? '1' : '0.5';
    };
    supportReadAlongCheckbox.addEventListener('change', syncReadAlongModeState);
    matchModeCheckbox.addEventListener('change', syncReadAlongModeState);
    syncReadAlongModeState();

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
    addLogMessage('[' + (readAlongPlayMode === 'once' ? '单次播放' : '循环播放') + '] 系统初始化完成', 'success');
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
