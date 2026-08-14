// ==UserScript==
// @name         学习页自动听力RC
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  学习页听后选择题自动作答：题干文本匹配答案，自动/手动翻页遍历全卷，点击选项内容元素；支持时间修改与控分，答案数≠题目数时可手动清洗答案
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // bucket 端口用户可以改；代理层在注入脚本时把真实地址写进 window.__A366__。
    const BUCKET_URL = (window.__A366__ && window.__A366__.bucket) || 'http://127.0.0.1:5290';
    // 听力答案由代理从试卷 zip 自动提取，走 /listening-answer 文件分支
    const ANSWER_PATH = '/listening-answer';

    const CSS_VARS = `
        --a366-primary: #007bff;
        --a366-primary-hover: #0056b3;
        --a366-primary-light: #e7f1ff;
        --a366-danger: #dc3545;
        --a366-danger-light: #f8d7da;
        --a366-success: #28a745;
        --a366-success-light: #d4edda;
        --a366-warning: #ffc107;
        --a366-info: #17a2b8;
        --a366-bg: #ffffff;
        --a366-bg-secondary: #f8f9fa;
        --a366-bg-tertiary: #e9ecef;
        --a366-border: #dee2e6;
        --a366-text: #212529;
        --a366-text-secondary: #6c757d;
        --a366-text-muted: #adb5bd;
        --a366-radius-sm: 4px;
        --a366-radius-md: 6px;
        --a366-radius-lg: 8px;
        --a366-shadow: 0 2px 12px rgba(0,0,0,0.12);
        --a366-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    `;

    const state = {
        answerList: [],        // 代理答案
        answerIndex: {},       // 题干(norm) -> 答案 索引
        answerLoading: false,
        answerError: null,
        questions: [],         // 已解析题目（增量采集）
        targetWrongCount: 0,
        filledWrong: 0,        // 已答错题数（控分预算消耗）
        autoFillRunning: false,
        autoFillTimer: null,
        filling: false,        // 填答锁，防止并发
        logEntries: [],
        collapsed: false,
        devPanelVisible: false,
    };

    let container = null;
    let devPanel = null;
    let logContent = null;

    // ===== 时间修改（与 auto-fill-once 共用同一套状态与代理接口） =====
    let fillTimeModEnabled = localStorage.getItem('fillTimeModEnabled') === 'true';
    let fillTimeModSeconds = (function() {
        const raw = localStorage.getItem('fillTimeModSeconds');
        if (raw === null || raw === '') return null;
        const v = parseInt(raw, 10);
        return Number.isFinite(v) ? v : null;
    })();
    const FILL_TIME_INT32_MIN = -2147483648;
    const FILL_TIME_INT32_MAX = 2147483647;

    // ==========================================
    // 工具函数
    // ==========================================

    function normalizeText(str) {
        return String(str || '')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function makeDraggable(targetEl, handleEl) {
        if (!handleEl || !targetEl) return;
        let isDragging = false, startX, startY, initialLeft, initialTop;
        handleEl.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = targetEl.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            targetEl.style.transition = 'none';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            targetEl.style.right = 'auto';
            targetEl.style.bottom = 'auto';
            targetEl.style.left = (initialLeft + e.clientX - startX) + 'px';
            targetEl.style.top = (initialTop + e.clientY - startY) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (isDragging) { isDragging = false; targetEl.style.transition = ''; }
        });
    }

    function addLog(message, type = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        state.logEntries.push({ time, message, type });
        if (!logContent) return;
        const colors = {
            info: 'var(--a366-text-secondary)',
            success: 'var(--a366-success)',
            warn: '#e67e22',
            error: 'var(--a366-danger)',
            click: '#6f42c1',
        };
        const color = colors[type] || colors.info;
        const div = document.createElement('div');
        div.style.cssText = `padding:1px 0;border-bottom:1px solid var(--a366-border);color:${color};word-break:break-all;`;
        div.innerHTML = `<span style="color:var(--a366-text-muted);">[${time}]</span> ${message}`;
        logContent.appendChild(div);
        logContent.scrollTop = logContent.scrollHeight;
    }

    // 覆盖式日志（用于轮询等高频场景，避免刷屏）
    function updateWaitingLog(message, type = 'info', id = 'waiting-log') {
        if (!logContent) return;
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        let div = logContent.querySelector(`[data-log-id="${id}"]`);
        const colors = { info: 'var(--a366-text-secondary)', success: 'var(--a366-success)', warn: '#e67e22', error: 'var(--a366-danger)' };
        const color = colors[type] || colors.info;
        if (div) {
            div.innerHTML = `<span style="color:var(--a366-text-muted);">[${time}]</span> ${message}`;
            div.style.color = color;
        } else {
            div = document.createElement('div');
            div.setAttribute('data-log-id', id);
            div.style.cssText = `padding:1px 0;border-bottom:1px solid var(--a366-border);color:${color};word-break:break-all;`;
            div.innerHTML = `<span style="color:var(--a366-text-muted);">[${time}]</span> ${message}`;
            logContent.appendChild(div);
        }
        logContent.scrollTop = logContent.scrollHeight;
    }

    // ==========================================
    // 时间修改（与 auto-fill-once 同款：状态经 /fill-time 推送，并关闭 /listen-time）
    // ==========================================

    const FillTimeMod = {
        push: function() {
            const payload = {
                enabled: fillTimeModEnabled === true,
                seconds: (fillTimeModSeconds === null || fillTimeModSeconds === undefined) ? null : fillTimeModSeconds,
                fillSubmitUrl: 'study-api.up366.cn/client/task/score/submit/v2'
            };
            try {
                fetch(BUCKET_URL + '/fill-time', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    cache: 'no-cache'
                }).then(r => r.json())
                  .then(res => {
                      if (res && res.success) {
                          addLog('[时间修改] 状态已同步到代理层 | 启用=' + payload.enabled + ' 秒数=' + (payload.seconds === null ? '-' : payload.seconds), 'success');
                      } else {
                          addLog('[时间修改] 同步失败(代理层返回异常)', 'warn');
                      }
                  })
                  .catch(e => {
                      addLog('[时间修改] 同步失败：连不上本地服务(' + e.message + ')，确认代理已开启', 'warn');
                  });
                // 关闭旧听力时间修改，避免与填空时间修改冲突（听力 salt 优先级更高）
                fetch(BUCKET_URL + '/listen-time', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: false, seconds: null }),
                    cache: 'no-cache'
                }).catch(() => {});
            } catch (e) {
                addLog('[时间修改] 同步异常：' + e.message, 'warn');
            }
        },
        install: function() {
            FillTimeMod.push();
        }
    };

    // 时间修改 UI 绑定（enable 复选框 + 分/秒输入框）
    function bindTimeModUI() {
        const tmEnable = document.getElementById('a366-timemod-enable');
        const tmMin = document.getElementById('a366-timemod-min');
        const tmSec = document.getElementById('a366-timemod-sec');
        if (!tmEnable || !tmMin || !tmSec) return;

        const tmSetDisabled = (dis) => {
            tmMin.disabled = dis; tmSec.disabled = dis;
            tmMin.style.opacity = dis ? '0.5' : '1';
            tmSec.style.opacity = dis ? '0.5' : '1';
        };
        const tmFillFromTotal = () => {
            if (fillTimeModSeconds === null || fillTimeModSeconds === undefined) {
                tmMin.value = ''; tmSec.value = ''; return;
            }
            const total = fillTimeModSeconds;
            const sign = total < 0 ? -1 : 1;
            const abs = Math.abs(total);
            tmMin.value = String(Math.floor(abs / 60) * sign);
            tmSec.value = String((abs % 60) * sign);
        };
        const tmCommit = () => {
            const mRaw = tmMin.value.trim();
            const sRaw = tmSec.value.trim();
            if (mRaw === '' && sRaw === '') {
                fillTimeModSeconds = null;
                localStorage.removeItem('fillTimeModSeconds');
                addLog('[时间修改] 时间已清空（提交不会被修改）', 'info');
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
            tmFillFromTotal();
            addLog('[时间修改] 提交用时设为 ' + m + '分' + s + '秒 = ' + total + '秒', 'info');
            FillTimeMod.push();
        };

        tmEnable.checked = fillTimeModEnabled;
        tmSetDisabled(!fillTimeModEnabled);
        tmFillFromTotal();

        tmEnable.addEventListener('change', () => {
            fillTimeModEnabled = tmEnable.checked;
            localStorage.setItem('fillTimeModEnabled', String(fillTimeModEnabled));
            tmSetDisabled(!fillTimeModEnabled);
            addLog('[时间修改] ' + (fillTimeModEnabled ? '已启用' : '已禁用')
                + (fillTimeModEnabled && fillTimeModSeconds === null ? '（时间未填，提交不会被修改）' : ''), 'info');
            FillTimeMod.push();
        });
        tmMin.addEventListener('change', tmCommit);
        tmSec.addEventListener('change', tmCommit);
    }

    // ==========================================
    // 题目解析（学习页结构，增量采集去重）
    // .u3-question-container 为一题容器：
    //   .u3-question-container__ques-order--number 题号
    //   .u3-question-container__ques-content 题干 + 选项（题干在选项前）
    //   .u3-option__label A/B/C 标记
    //   .u3-option__content 选项内容（点击有效）
    // ==========================================

    // 扫描当前 DOM 中的题目容器，把新题加入 state.questions（按题干去重）
    function collectQuestions() {
        const containers = document.querySelectorAll('.u3-question-container');
        let added = 0;
        containers.forEach((qc, idx) => {
            let text = '';
            const contentEl = qc.querySelector('.u3-question-container__ques-content');
            if (contentEl) {
                const clone = contentEl.cloneNode(true);
                clone.querySelectorAll('.u3-choice, .u3-choice__question--options--option').forEach(el => el.remove());
                text = normalizeText(clone.textContent);
            }
            const key = text;
            if (!key) return;
            if (state.questions.some(q => q.key === key)) return;

            const numEl = qc.querySelector('.u3-question-container__ques-order--number');
            const number = numEl ? (parseInt((numEl.textContent || '').trim(), 10) || state.questions.length + 1) : state.questions.length + 1;

            const options = [];
            qc.querySelectorAll('.u3-option').forEach(optEl => {
                const labelEl = optEl.querySelector('.u3-option__label');
                const contentEl2 = optEl.querySelector('.u3-option__content');
                options.push({
                    mark: normalizeText(labelEl ? labelEl.textContent : ''),
                    content: normalizeText(contentEl2 ? contentEl2.textContent : ''),
                    _contentElement: contentEl2 || optEl,
                    _isCorrect: false,
                });
            });

            state.questions.push({ number, text, key, options });
            added++;
        });
        if (added > 0) addLog(`采集到 ${added} 道新题，累计 ${state.questions.length} 道`, 'success');
        return added;
    }

    // ==========================================
    // 答案匹配（题干文本匹配）
    // 答案 questionText 与页面题干做精确匹配（已验证可靠，顺序匹配会错位）
    // rebuild=true 时重置索引与旧匹配（清洗答案后使用）
    // ==========================================

    function matchAnswers(rebuild) {
        if (rebuild || Object.keys(state.answerIndex).length === 0) {
            state.answerIndex = {};
            state.answerList.forEach(a => {
                const q = normalizeText(a.questionText || a.question || '');
                if (q) state.answerIndex[q] = a;
            });
        }
        let matched = 0;
        state.questions.forEach(q => {
            if (rebuild) {
                q._matchedAnswer = null;
                q.options.forEach(o => { o._isCorrect = false; });
            }
            if (q._matchedAnswer) {
                if (q.options.some(o => o._isCorrect)) matched++;
                return;
            }
            const match = state.answerIndex[q.key];
            if (!match) return;
            const raw = match.answer || match.answerContent || '';
            const answerContent = normalizeText(raw.replace(/^[A-Za-z]\s*[.、．]\s*/, ''));
            q.options.forEach(opt => {
                if (answerContent && normalizeText(opt.content) === answerContent) opt._isCorrect = true;
            });
            q._matchedAnswer = match;
            if (q.options.some(o => o._isCorrect)) matched++;
        });
        if (matched > 0) addLog(`答案匹配：${matched}/${state.questions.length} 题`, 'success');
        return matched;
    }

    // ==========================================
    // 填答（点击选项内容元素，串行 200ms 间隔）
    // ==========================================

    function clickOption(opt, q, mode) {
        const contentEl = opt._contentElement;
        if (!contentEl || !document.contains(contentEl)) {
            addLog(`[填答] #${q.number} 无可点击内容元素`, 'warn');
            return false;
        }
        try {
            const color = mode === 'correct' ? 'var(--a366-success)' : '#dc3545';
            contentEl.style.outline = '3px solid ' + color;
            contentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            contentEl.click();
            const modeLabel = mode === 'correct' ? '✓' : '✗';
            addLog(`[填答] #${q.number} ${modeLabel} ${opt.mark} ${escapeHtml((opt.content || '').substring(0, 30))} → content.click()`, mode === 'correct' ? 'click' : 'warn');
            setTimeout(() => { if (document.contains(contentEl)) contentEl.style.outline = ''; }, 1000);
            return true;
        } catch (e) {
            addLog(`[填答] #${q.number} 点击异常: ${e.message}`, 'error');
            return false;
        }
    }

    // 填答当前未填答的题目：有匹配答案的按控分预算随机部分答错，未匹配的跳过
    async function fillVisible() {
        const pending = state.questions.filter(q => !q._filled);
        if (pending.length === 0) return 0;

        const matched = pending.filter(q => q.options.some(o => o._isCorrect));
        if (matched.length === 0) {
            pending.forEach(q => { q._filled = 'skipped'; });
            addLog('[填答] 当前题目均无匹配答案，跳过', 'warn');
            renderFillSection();
            return 0;
        }

        // 从匹配题中随机选 剩余控分预算 道答错
        const budget = Math.max(0, state.targetWrongCount - state.filledWrong);
        const shuffled = [...matched].sort(() => Math.random() - 0.5);
        const wrongKeys = new Set(shuffled.slice(0, budget).map(q => q.key));

        let filled = 0, wrongFilled = 0, skipped = 0;
        for (const q of pending) {
            const isWrong = wrongKeys.has(q.key);
            const opt = isWrong ? q.options.find(o => !o._isCorrect) : q.options.find(o => o._isCorrect);
            if (!opt) { q._filled = 'skipped'; skipped++; continue; }
            if (clickOption(opt, q, isWrong ? 'wrong' : 'correct')) {
                q._filled = isWrong ? 'wrong' : true;
                if (isWrong) { state.filledWrong++; wrongFilled++; } else { filled++; }
            } else { q._filled = 'skipped'; skipped++; }
            await new Promise(r => setTimeout(r, 200));
        }
        addLog(`[填答] 本批完成：答对 ${filled} / 答错 ${wrongFilled} / 跳过 ${skipped}`, (filled + wrongFilled) > 0 ? 'success' : 'warn');
        renderFillSection();
        renderQuestions();
        return filled + wrongFilled;
    }

    // ==========================================
    // 答案获取 + 轮询解析
    // ==========================================

    async function fetchAnswers() {
        state.answerLoading = true;
        state.answerError = null;
        try {
            const resp = await fetch(BUCKET_URL + ANSWER_PATH, { cache: 'no-cache' });
            if (resp.status === 404) {
                let detail = '答案尚未提取，请先在主程序中启动代理捕获答案';
                try { const d = await resp.json(); if (d.error) detail = d.error; } catch (_) {}
                throw new Error(detail);
            }
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            let raw = [];
            if (Array.isArray(data)) raw = data;
            else if (data && Array.isArray(data.answers)) raw = data.answers;
            else if (data && Array.isArray(data.data)) raw = data.data;

            // 学习页答案按题号顺序使用；优先保留听后选择题型，否则全量
            const filtered = raw.filter(a => (a.pattern || '').indexOf('听后选择') >= 0);
            state.answerList = filtered.length > 0 ? filtered : raw;

            if (state.answerList.length > 0) {
                addLog(`获取答案成功：${state.answerList.length} 条（${filtered.length > 0 ? '听后选择过滤' : '全量'}）`, 'success');
            } else {
                addLog('获取到 0 条答案', 'warn');
            }
            renderFillSection();
            collectAndMatch();
        } catch (e) {
            state.answerError = e.message;
            addLog('获取答案失败: ' + escapeHtml(e.message), 'error');
            renderFillSection();
        } finally {
            state.answerLoading = false;
        }
    }

    // 采集当前 DOM 题目并匹配答案（被动解析，供"解析题目"按钮与自动填答复用）
    function collectAndMatch() {
        const added = collectQuestions();
        if (added > 0 || Object.keys(state.answerIndex).length === 0) matchAnswers();
        renderFillSection();
        renderQuestions();
        updateScorePreview();
        return state.questions.length;
    }

    // ==========================================
    // 翻页（学习页 swiper：U3SwiperContainer.$refs.swiper.swiper）
    // ==========================================

    function getSwiper() {
        const slide = document.querySelector('.swiper-slide');
        if (!slide || !slide.__vue__) return null;
        let cur = slide.__vue__;
        while (cur && cur.$parent) {
            if (cur.$options && cur.$options.name === 'U3SwiperContainer') {
                const sw = cur.$refs && cur.$refs.swiper && cur.$refs.swiper.swiper;
                if (sw) return sw;
                return null;
            }
            cur = cur.$parent;
        }
        return null;
    }

    function updatePageInfo() {
        const el = document.getElementById('a366-page-info');
        if (!el) return;
        const sw = getSwiper();
        if (!sw) { el.textContent = '无 swiper'; return; }
        el.textContent = `${sw.activeIndex + 1} / ${sw.slides ? sw.slides.length : '?'}`;
    }

    function goPrevPage() {
        const sw = getSwiper();
        if (!sw) { addLog('未找到 swiper 实例，无法翻页', 'warn'); return; }
        if (sw.activeIndex <= 0) { addLog('已在第一页', 'warn'); return; }
        sw.slidePrev();
        addLog(`已翻到第 ${sw.activeIndex + 1} 页`, 'info');
        setTimeout(() => { collectAndMatch(); updatePageInfo(); }, 400);
    }

    function goNextPage() {
        const sw = getSwiper();
        if (!sw) { addLog('未找到 swiper 实例，无法翻页', 'warn'); return; }
        if (sw.isEnd) { addLog('已在最后一页', 'warn'); return; }
        sw.slideNext();
        addLog(`已翻到第 ${sw.activeIndex + 1} 页`, 'info');
        setTimeout(() => { collectAndMatch(); updatePageInfo(); }, 400);
    }

    // ==========================================
    // 自动填答（持续监控：新题渲染出来自动解析并填答，页内题填完后自动翻页）
    // ==========================================

    async function startAutoFill() {
        if (state.autoFillRunning) { stopAutoFill(); return; }
        state.autoFillRunning = true;
        const btn = document.getElementById('a366-auto-fill-all');
        if (btn) { btn.textContent = '停止填答'; btn.style.background = 'var(--a366-danger)'; }
        addLog('━━━━ 自动填答开始（持续监控新题） ━━━━', 'info');

        if (state.answerList.length === 0) {
            await fetchAnswers();
            if (state.answerList.length === 0) {
                stopAutoFill();
                addLog('获取答案失败，自动填答终止', 'error');
                return;
            }
        }

        collectAndMatch();
        updatePageInfo();
        await fillVisible();

        state.autoFillTimer = setInterval(async () => {
            if (state.filling) return;
            state.filling = true;
            try {
                const added = collectQuestions();
                if (added > 0) { matchAnswers(); renderFillSection(); renderQuestions(); }
                await fillVisible();
                updatePageInfo();
                // 翻页条件：DOM 中所有题目容器均已采集且填答（防止跳过刚渲染的新题）
                const containers = document.querySelectorAll('.u3-question-container');
                const allHandled = Array.from(containers).every(qc => {
                    const ce = qc.querySelector('.u3-question-container__ques-content');
                    if (!ce) return true;
                    const c = ce.cloneNode(true);
                    c.querySelectorAll('.u3-choice, .u3-choice__question--options--option').forEach(el => el.remove());
                    const key = normalizeText(c.textContent);
                    const q = state.questions.find(qq => qq.key === key);
                    return q && q._filled;
                });
                const sw = getSwiper();
                if (sw && allHandled) {
                    if (!sw.isEnd) {
                        sw.slideNext();
                        updatePageInfo();
                        addLog(`当前页已填完，自动翻到第 ${sw.activeIndex + 1} 页`, 'info');
                    } else {
                        stopAutoFill();
                        addLog('已到最后一页，全卷填答完成', 'success');
                    }
                }
            } catch (e) {
                addLog('自动填答异常: ' + e.message, 'error');
            } finally {
                state.filling = false;
            }
        }, 800);
    }

    function stopAutoFill() {
        if (state.autoFillTimer) { clearInterval(state.autoFillTimer); state.autoFillTimer = null; }
        state.autoFillRunning = false;
        const btn = document.getElementById('a366-auto-fill-all');
        if (btn) { btn.textContent = '开始填答'; btn.style.background = 'var(--a366-primary)'; }
        addLog('已停止自动填答', 'warn');
    }

    // ==========================================
    // 主面板 UI
    // ==========================================

    function createUI() {
        container = document.createElement('div');
        container.id = 'a366-panel';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 420px;
            max-height: 480px;
            background: var(--a366-bg, #fff);
            color: var(--a366-text, #212529);
            border-radius: var(--a366-radius-lg, 8px);
            border: 1px solid var(--a366-border, #dee2e6);
            box-shadow: var(--a366-shadow, 0 2px 12px rgba(0,0,0,0.12));
            z-index: 999999;
            font-family: var(--a366-font, sans-serif);
            font-size: 13px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            ${CSS_VARS}
        `;

        container.innerHTML = `
            <div id="a366-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--a366-bg-secondary);border-radius:8px 8px 0 0;border-bottom:1px solid var(--a366-border);cursor:move;user-select:none;">
                <span style="font-weight:600;font-size:14px;color:var(--a366-primary);">自动听力RC（学习页）</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    <button id="a366-dev-btn" style="background:var(--a366-info);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:3px 10px;font-size:11px;cursor:pointer;font-weight:500;">Develop</button>
                    <button id="a366-minimize" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:3px 8px;font-size:11px;cursor:pointer;">_</button>
                </div>
            </div>
            <div id="a366-body" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;">
                <div id="a366-fill-section" style="padding:12px;display:flex;flex-direction:column;gap:10px;">
                    <div style="font-size:12px;font-weight:500;color:var(--a366-text-secondary);">答案状态</div>
                    <div id="a366-fill-status" style="padding:8px 10px;background:var(--a366-bg-secondary);border-radius:var(--a366-radius-md);border:1px solid var(--a366-border);min-height:40px;">
                        <div style="color:var(--a366-text-muted);text-align:center;font-size:12px;">正在获取答案...</div>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                        <button id="a366-auto-fill-all" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;display:none;">开始填答</button>
                        <button id="a366-parse-btn" style="background:var(--a366-warning);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 12px;font-size:13px;cursor:pointer;font-weight:500;">解析题目</button>
                        <button id="a366-score-btn" style="background:#17a2b8;color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 12px;font-size:13px;cursor:pointer;font-weight:500;">控分</button>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                        <button id="a366-page-prev" style="background:var(--a366-bg-tertiary);color:var(--a366-text);border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:6px 12px;font-size:12px;cursor:pointer;">◀ 上一页</button>
                        <span id="a366-page-info" style="font-size:11px;color:var(--a366-text-secondary);">-</span>
                        <button id="a366-page-next" style="background:var(--a366-bg-tertiary);color:var(--a366-text);border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:6px 12px;font-size:12px;cursor:pointer;">下一页 ▶</button>
                    </div>
                </div>
            </div>
            <div style="border-top:1px solid var(--a366-border);padding:8px 10px;display:flex;align-items:center;gap:4px;flex-shrink:0;">
                <span style="font-size:12px;font-weight:600;color:var(--a366-text);">时间修改</span>
                <input type="checkbox" id="a366-timemod-enable" style="margin:0 4px 0 2px;cursor:pointer;">
                <input type="number" id="a366-timemod-min" step="1" placeholder="-" style="width:52px;font-size:12px;text-align:center;padding:3px 4px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);background:var(--a366-bg);color:var(--a366-text);outline:none;" disabled>
                <span style="font-size:12px;color:var(--a366-text-secondary);">分</span>
                <input type="number" id="a366-timemod-sec" step="1" placeholder="-" style="width:52px;font-size:12px;text-align:center;padding:3px 4px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);background:var(--a366-bg);color:var(--a366-text);outline:none;" disabled>
                <span style="font-size:12px;color:var(--a366-text-secondary);">秒</span>
            </div>
            <div style="border-top:1px solid var(--a366-border);background:var(--a366-bg-secondary);display:flex;flex-direction:column;flex-shrink:0;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px;">
                    <span style="font-size:11px;font-weight:500;color:var(--a366-text-secondary);">操作日志</span>
                    <button id="a366-log-clear" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">清空</button>
                </div>
                <div id="a366-log-content" style="height:120px;overflow-y:auto;padding:4px 10px 6px;font-size:11px;font-family:'Consolas','Courier New','PingFang SC',monospace;background:var(--a366-bg);">
                    <div style="color:var(--a366-success);">自动听力RC（学习页）已就绪</div>
                    <div style="color:var(--a366-text-secondary);">填答 | 控分</div>
                </div>
            </div>
        `;

        document.body.appendChild(container);
        createDevPanel();

        logContent = document.getElementById('a366-log-content');

        document.getElementById('a366-dev-btn').addEventListener('click', toggleDevPanel);
        document.getElementById('a366-minimize').addEventListener('click', toggleCollapse);
        document.getElementById('a366-auto-fill-all').addEventListener('click', () => { startAutoFill(); });
        document.getElementById('a366-parse-btn').addEventListener('click', collectAndMatch);
        document.getElementById('a366-page-prev').addEventListener('click', goPrevPage);
        document.getElementById('a366-page-next').addEventListener('click', goNextPage);
        document.getElementById('a366-score-btn').addEventListener('click', () => {
            if (!state.devPanelVisible) toggleDevPanel();
            switchDevTab('dev-score');
        });
        document.getElementById('a366-log-clear').addEventListener('click', () => {
            state.logEntries = [];
            logContent.innerHTML = '';
        });

        bindTimeModUI();

        makeDraggable(container, document.getElementById('a366-header'));
        updatePageInfo();
        fetchAnswers();
    }

    // ==========================================
    // 开发者面板（题目结果 + 控分设置）
    // ==========================================

    function createDevPanel() {
        devPanel = document.createElement('div');
        devPanel.id = 'a366-dev-panel';
        devPanel.style.cssText = `
            display: none;
            position: fixed;
            bottom: 510px;
            right: 20px;
            width: 480px;
            max-height: 600px;
            background: var(--a366-bg, #fff);
            color: var(--a366-text, #212529);
            border-radius: var(--a366-radius-lg, 8px);
            border: 1px solid var(--a366-border, #dee2e6);
            box-shadow: var(--a366-shadow, 0 2px 12px rgba(0,0,0,0.12));
            z-index: 1000000;
            font-family: var(--a366-font, sans-serif);
            font-size: 13px;
            flex-direction: column;
            overflow: hidden;
            ${CSS_VARS}
        `;

        devPanel.innerHTML = `
            <div id="a366-dev-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--a366-bg-secondary);border-radius:8px 8px 0 0;border-bottom:1px solid var(--a366-border);cursor:move;user-select:none;">
                <span style="font-weight:600;font-size:14px;color:var(--a366-info);">自动听力RC（学习页）</span>
                <button id="a366-dev-close" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:3px 8px;font-size:11px;cursor:pointer;">✕</button>
            </div>
            <div style="display:flex;border-bottom:1px solid var(--a366-border);background:var(--a366-bg-secondary);">
                <button class="a366-dev-tab active" data-tab="dev-questions" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-primary);border-bottom:2px solid var(--a366-primary);transition:all 0.15s;">题目结果</button>
                <button class="a366-dev-tab" data-tab="dev-score" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-text-secondary);border-bottom:2px solid transparent;transition:all 0.15s;">控分设置</button>
            </div>
            <div id="a366-dev-body" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;">
                <div id="a366-dev-tab-questions" style="padding:12px;display:flex;flex-direction:column;gap:8px;">
                    <div style="font-size:11px;color:var(--a366-text-muted);text-align:center;padding:20px;">获取答案后将自动解析题目</div>
                </div>
                <div id="a366-dev-tab-score" style="padding:12px;display:none;flex-direction:column;gap:10px;">
                    <div id="a366-score-info" style="font-size:12px;font-weight:500;color:var(--a366-text);">默认20题，满分30分</div>
                    <div id="a366-score-slider-wrap" style="display:flex;flex-direction:column;gap:8px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:11px;color:#6c757d;">0 分</span>
                            <span id="a366-score-current" style="font-size:18px;font-weight:700;color:var(--a366-primary);">0.0 分</span>
                            <span style="font-size:11px;color:#6c757d;">30 分</span>
                        </div>
                        <input id="a366-score-slider" type="range" min="0" max="30" step="1.5" value="30" style="width:100%;accent-color:var(--a366-primary);">
                        <div id="a366-score-ticks" style="display:flex;justify-content:space-between;align-items:flex-start;padding:0 2px;">
                            <span class="a366-score-tick" data-score="18" style="display:flex;flex-direction:column;align-items:center;cursor:pointer;min-width:28px;">
                                <span style="width:1px;height:6px;background:var(--a366-border);"></span>
                                <span style="font-size:10px;color:var(--a366-text-secondary);margin-top:2px;">18</span>
                            </span>
                            <span class="a366-score-tick" data-score="21" style="display:flex;flex-direction:column;align-items:center;cursor:pointer;min-width:28px;">
                                <span style="width:1px;height:6px;background:var(--a366-border);"></span>
                                <span style="font-size:10px;color:var(--a366-text-secondary);margin-top:2px;">21</span>
                            </span>
                            <span class="a366-score-tick" data-score="24" style="display:flex;flex-direction:column;align-items:center;cursor:pointer;min-width:28px;">
                                <span style="width:1px;height:6px;background:var(--a366-border);"></span>
                                <span style="font-size:10px;color:var(--a366-text-secondary);margin-top:2px;">24</span>
                            </span>
                            <span class="a366-score-tick" data-score="25.5" style="display:flex;flex-direction:column;align-items:center;cursor:pointer;min-width:28px;">
                                <span style="width:1px;height:6px;background:var(--a366-border);"></span>
                                <span style="font-size:10px;color:var(--a366-text-secondary);margin-top:2px;">25.5</span>
                            </span>
                            <span class="a366-score-tick" data-score="27" style="display:flex;flex-direction:column;align-items:center;cursor:pointer;min-width:28px;">
                                <span style="width:1px;height:6px;background:var(--a366-border);"></span>
                                <span style="font-size:10px;color:var(--a366-text-secondary);margin-top:2px;">27</span>
                            </span>
                            <span class="a366-score-tick" data-score="28.5" style="display:flex;flex-direction:column;align-items:center;cursor:pointer;min-width:28px;">
                                <span style="width:1px;height:6px;background:var(--a366-border);"></span>
                                <span style="font-size:10px;color:var(--a366-text-secondary);margin-top:2px;">28.5</span>
                            </span>
                        </div>
                        <div id="a366-score-preview" style="font-size:11px;color:#6c757d;padding:6px 10px;background:#e9ecef;border-radius:4px;text-align:center;"></div>
                    </div>
                    <div id="a366-answer-clean" style="display:none;border-top:1px solid var(--a366-border);padding-top:10px;flex-direction:column;gap:8px;">
                        <div style="font-size:12px;font-weight:600;color:var(--a366-danger);">答案清洗（答案数 ≠ 题目数）</div>
                        <div id="a366-clean-stats" style="font-size:11px;color:var(--a366-text-secondary);"></div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button id="a366-clean-auto" style="background:var(--a366-warning);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:4px 10px;font-size:11px;cursor:pointer;font-weight:500;">自动清洗</button>
                            <button id="a366-clean-trim" style="background:var(--a366-info);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:4px 10px;font-size:11px;cursor:pointer;font-weight:500;">截取到题目数</button>
                        </div>
                        <div id="a366-clean-list" style="max-height:200px;overflow-y:auto;border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:6px;background:var(--a366-bg);"></div>
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                            <input id="a366-clean-q" type="text" placeholder="题干（添加答案）" style="flex:2;min-width:120px;padding:6px 8px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);background:var(--a366-bg);color:var(--a366-text);font-size:11px;outline:none;">
                            <input id="a366-clean-a" type="text" placeholder="答案，如 B. xxx" style="flex:1;min-width:80px;padding:6px 8px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);background:var(--a366-bg);color:var(--a366-text);font-size:11px;outline:none;">
                            <button id="a366-clean-add" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:6px 10px;font-size:11px;cursor:pointer;font-weight:500;">添加</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(devPanel);

        document.getElementById('a366-dev-close').addEventListener('click', toggleDevPanel);
        devPanel.querySelectorAll('.a366-dev-tab').forEach(tab => {
            tab.addEventListener('click', () => switchDevTab(tab.dataset.tab));
        });

        bindScoreSlider();
        bindScoreTicks();
        updateScorePreview();

        document.getElementById('a366-clean-auto').addEventListener('click', cleanAuto);
        document.getElementById('a366-clean-trim').addEventListener('click', cleanTrim);
        document.getElementById('a366-clean-add').addEventListener('click', cleanAdd);
        renderCleanList();

        makeDraggable(devPanel, document.getElementById('a366-dev-header'));
    }

    function toggleDevPanel() {
        state.devPanelVisible = !state.devPanelVisible;
        devPanel.style.display = state.devPanelVisible ? 'flex' : 'none';
    }

    function switchDevTab(tabName) {
        devPanel.querySelectorAll('.a366-dev-tab').forEach(tab => {
            const active = tab.dataset.tab === tabName;
            tab.style.color = active ? 'var(--a366-primary)' : 'var(--a366-text-secondary)';
            tab.style.borderBottom = active ? '2px solid var(--a366-primary)' : '2px solid transparent';
        });
        ['dev-questions', 'dev-score'].forEach(id => {
            const contentId = id.replace('dev-', '');
            const el = devPanel.querySelector('#a366-dev-tab-' + contentId);
            if (el) el.style.display = id === tabName ? 'flex' : 'none';
        });
        if (tabName === 'dev-score') updateScorePreview();
    }

    function toggleCollapse() {
        state.collapsed = !state.collapsed;
        const body = document.getElementById('a366-body');
        const fill = document.getElementById('a366-fill-section');
        if (body) body.style.display = state.collapsed ? 'none' : '';
    }

    // ==========================================
    // 渲染
    // ==========================================

    function renderFillSection() {
        const fillStatus = document.getElementById('a366-fill-status');
        if (!fillStatus) return;
        const questions = state.questions;
        const answers = state.answerList;

        if (answers.length === 0 && questions.length === 0) {
            fillStatus.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;font-size:12px;">${state.answerError ? escapeHtml(state.answerError) : '未获取答案'}</div>`;
            document.getElementById('a366-auto-fill-all').style.display = 'none';
            return;
        }

        if (questions.length === 0) {
            fillStatus.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;font-size:12px;">已获取 ${answers.length} 条答案，等待题目渲染...</div>`;
            document.getElementById('a366-auto-fill-all').style.display = 'none';
            return;
        }

        const matchedCount = questions.filter(q => !!q._matchedAnswer).length;
        const correctOptCount = questions.reduce((sum, q) => sum + q.options.filter(o => o._isCorrect).length, 0);
        const filledCount = questions.filter(q => q._filled === true).length;
        const wrongFilledCount = questions.filter(q => q._filled === 'wrong').length;

        let badges = '';
        questions.forEach(q => {
            if (q._filled === true) badges += '<span style="color:var(--a366-success);font-weight:600;">✓</span>';
            else if (q._filled === 'wrong') badges += '<span style="color:var(--a366-danger);font-weight:600;">✗</span>';
            else if (q._filled === 'skipped') badges += '<span style="color:var(--a366-text-muted);font-weight:600;">—</span>';
            else badges += '<span style="color:var(--a366-text-muted);">○</span>';
        });

        fillStatus.innerHTML = `
            <div style="font-size:12px;color:var(--a366-text);margin-bottom:6px;">
                题目 <b>${questions.length}</b> | 匹配 <b style="color:var(--a366-success);">${matchedCount}</b> 题 | 正确选项 <b style="color:var(--a366-success);">${correctOptCount}</b> 个${filledCount > 0 ? ' | 已填 <b style="color:var(--a366-success);">' + filledCount + '</b>' : ''}${wrongFilledCount > 0 ? ' | <span style="color:var(--a366-danger);">答错 ' + wrongFilledCount + '</span>' : ''}
            </div>
            <div style="font-size:15px;letter-spacing:2px;word-break:break-all;line-height:1.8;">${badges}</div>
        `;

        const fillAllBtn = document.getElementById('a366-auto-fill-all');
        fillAllBtn.style.display = questions.length > 0 ? '' : 'none';
    }

    function renderQuestions() {
        const tabContainer = document.getElementById('a366-dev-tab-questions');
        if (!tabContainer) return;
        const questions = state.questions;
        if (questions.length === 0) {
            tabContainer.innerHTML = `<div style="font-size:11px;color:var(--a366-text-muted);text-align:center;padding:20px;">获取答案后将自动解析题目，或点击主面板"解析题目"</div>`;
            return;
        }
        const matchedCount = questions.filter(q => !!q._matchedAnswer).length;
        const correctCount = questions.reduce((sum, q) => sum + q.options.filter(o => o._isCorrect).length, 0);
        let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:11px;color:var(--a366-primary);">题目结果：${questions.length} 道 | 已匹配 ${matchedCount} 题 | 正确选项 ${correctCount} 个</span>
            <button id="a366-fill-btn" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:3px 10px;font-size:11px;cursor:pointer;font-weight:500;">一键填答</button>
        </div>`;

        questions.forEach(q => {
            const hasMatch = !!q._matchedAnswer;
            const headerColor = hasMatch ? 'var(--a366-success)' : 'var(--a366-text)';
            html += `
            <div style="border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:6px 8px;background:var(--a366-bg);margin-bottom:6px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                    <span style="font-weight:600;color:var(--a366-primary);font-size:12px;">#${q.number}</span>
                    ${hasMatch ? '<span style="color:var(--a366-success);font-size:10px;">✓ 已匹配</span>' : '<span style="color:var(--a366-text-muted);font-size:10px;">未匹配</span>'}
                </div>
                <div style="font-size:12px;color:${headerColor};word-break:break-all;margin-bottom:4px;">${escapeHtml(q.text)}</div>`;
            q.options.forEach(opt => {
                const optBg = opt._isCorrect ? 'var(--a366-success-light)' : 'var(--a366-bg-secondary)';
                const optBorder = opt._isCorrect ? 'border-left:3px solid var(--a366-success);' : 'border-left:3px solid transparent;';
                html += `
                <div style="${optBorder}padding:3px 8px;background:${optBg};margin:2px 0;border-radius:0 var(--a366-radius-sm) var(--a366-radius-sm) 0;font-size:11px;display:flex;gap:6px;align-items:center;">
                    <b>${escapeHtml(opt.mark)}</b>
                    <span style="word-break:break-all;">${escapeHtml(opt.content)}</span>
                    ${opt._isCorrect ? '<span style="color:var(--a366-success);font-weight:600;">✓</span>' : ''}
                </div>`;
            });
            html += `</div>`;
        });

        tabContainer.innerHTML = html;
        const fillBtn = document.getElementById('a366-fill-btn');
        if (fillBtn) fillBtn.addEventListener('click', () => { fillVisible(); });
    }

    // ==========================================
    // 控分设置（滑块固定 0~30 分，每题 1.5 分）
    // ==========================================

    function updateScorePreview() {
        const total = state.questions.length || 20;
        const pointsPerQuestion = 1.5;
        const info = document.getElementById('a366-score-info');
        const slider = document.getElementById('a366-score-slider');
        const currentLabel = document.getElementById('a366-score-current');
        const preview = document.getElementById('a366-score-preview');

        const targetScore = parseFloat(slider ? slider.value : 0) || 0;
        if (currentLabel) currentLabel.textContent = targetScore.toFixed(1) + ' 分';

        const rebuilt = state.questions.length > 0;
        const mismatch = rebuilt && state.questions.length !== state.answerList.length;

        if (info) {
            if (!rebuilt) {
                info.textContent = '默认20题，满分30分（解析后生效）';
                info.style.color = '';
            } else if (mismatch) {
                info.innerHTML = `⚠ 答案${state.answerList.length}条 ≠ 题目${state.questions.length}题，控分可能不准确`;
                info.style.color = 'var(--a366-danger)';
            } else {
                info.textContent = `满分 ${(total * 1.5).toFixed(1)} 分（${total} 题 × 1.5）`;
                info.style.color = '';
            }
        }

        const correctCount = Math.min(total, Math.round(targetScore / pointsPerQuestion));
        const wrongCount = total - correctCount;
        if (preview) preview.innerHTML = `答对：<span style="color:#28a745;">${correctCount} 题</span> | 答错：<span style="color:#dc3545;">${wrongCount} 题</span>`;

        // 答案数≠题数时，主面板操作按钮背景变红警告
        const btnIds = ['a366-auto-fill-all', 'a366-score-btn'];
        btnIds.forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            if (mismatch) {
                btn.dataset.origBg = btn.dataset.origBg || btn.style.background;
                btn.style.background = 'var(--a366-danger)';
            } else if (btn.dataset.origBg) {
                btn.style.background = btn.dataset.origBg;
                delete btn.dataset.origBg;
            }
        });

        // 答案数≠题目数时显示答案清洗区块
        const cleanEl = document.getElementById('a366-answer-clean');
        if (cleanEl) {
            if (mismatch) {
                cleanEl.style.display = 'flex';
                renderCleanList();
            } else {
                cleanEl.style.display = 'none';
            }
        }
    }

    function bindScoreSlider() {
        const scoreSlider = document.getElementById('a366-score-slider');
        if (!scoreSlider) return;
        scoreSlider.addEventListener('input', () => { updateScorePreview(); });
        scoreSlider.addEventListener('change', () => {
            const total = state.questions.length || 20;
            const targetScore = parseFloat(scoreSlider.value) || 0;
            const correctCount = Math.min(total, Math.round(targetScore / 1.5));
            const wrongCount = total - correctCount;
            state.targetWrongCount = wrongCount;
            addLog(`[控分] 目标得分 ${targetScore.toFixed(1)} 分 | 答对 ${correctCount} | 答错 ${wrongCount}`, 'success');
            renderFillSection();
        });
    }

    function bindScoreTicks() {
        const scoreSlider = document.getElementById('a366-score-slider');
        if (!scoreSlider) return;
        devPanel.querySelectorAll('.a366-score-tick').forEach(tick => {
            tick.addEventListener('click', () => {
                const score = parseFloat(tick.dataset.score);
                scoreSlider.value = score;
                scoreSlider.dispatchEvent(new Event('input'));
                scoreSlider.dispatchEvent(new Event('change'));
            });
        });
    }

    // ==========================================
    // 答案清洗（答案数 ≠ 题目数时手动整理答案）
    // ==========================================

    // 应用清洗后的答案列表：更新状态、重建索引、重新匹配并刷新所有渲染
    function applyAnswerClean(newList) {
        state.answerList = newList;
        matchAnswers(true);
        renderFillSection();
        renderQuestions();
        renderCleanList();
        updateScorePreview();
        addLog(`[答案清洗] 答案已更新为 ${newList.length} 条`, 'success');
    }

    // 渲染答案列表：每条标注是否与页面题目匹配（绿✓/红✗），提供删除按钮
    function renderCleanList() {
        const listEl = document.getElementById('a366-clean-list');
        if (!listEl) return;
        const qKeys = new Set(state.questions.map(q => q.key));
        const stats = document.getElementById('a366-clean-stats');
        if (stats) stats.textContent = `答案 ${state.answerList.length} 条 | 题目 ${state.questions.length} 题 | 不匹配 ${state.answerList.filter(a => !qKeys.has(normalizeText(a.questionText || a.question || ''))).length} 条`;

        if (state.answerList.length === 0) {
            listEl.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;font-size:11px;padding:8px;">答案列表为空</div>`;
            return;
        }
        let html = '';
        state.answerList.forEach((a, i) => {
            const qText = normalizeText(a.questionText || a.question || '');
            const match = qKeys.has(qText);
            const color = match ? 'var(--a366-success)' : 'var(--a366-danger)';
            const badge = match ? '✓' : '✗';
            html += `
            <div style="display:flex;align-items:center;gap:6px;padding:3px 6px;margin:2px 0;border-left:3px solid ${color};background:var(--a366-bg-secondary);border-radius:0 var(--a366-radius-sm) var(--a366-radius-sm) 0;font-size:11px;">
                <span style="color:${color};font-weight:600;flex-shrink:0;">${badge}</span>
                <div style="flex:1;overflow:hidden;min-width:0;">
                    <div style="color:var(--a366-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(qText)}</div>
                    <div style="color:var(--a366-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(a.answer || '')}${a.pattern ? ' <span style="color:var(--a366-text-muted);">[' + escapeHtml(a.pattern) + ']</span>' : ''}</div>
                </div>
                <button data-clean-del="${i}" style="background:var(--a366-danger);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:1px 8px;font-size:10px;cursor:pointer;flex-shrink:0;">删除</button>
            </div>`;
        });
        listEl.innerHTML = html;
        listEl.querySelectorAll('[data-clean-del]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.cleanDel, 10);
                applyAnswerClean(state.answerList.filter((_, i) => i !== idx));
            });
        });
    }

    // 自动清洗：删除题干与页面题目不匹配的答案（基于当前已解析题目，建议翻完全卷后再用）
    function cleanAuto() {
        const qKeys = new Set(state.questions.map(q => q.key));
        const keep = state.answerList.filter(a => qKeys.has(normalizeText(a.questionText || a.question || '')));
        const removed = state.answerList.length - keep.length;
        if (removed === 0) { addLog('[答案清洗] 无不匹配答案可删除', 'warn'); return; }
        applyAnswerClean(keep);
        addLog(`[答案清洗] 基于当前已解析 ${state.questions.length} 题，删除 ${removed} 条不匹配答案（未渲染题目的答案会被删除，建议先翻完全卷）`, 'success');
    }

    // 截取到题目数：保留前 N 条（N = 当前题目数）
    function cleanTrim() {
        const total = state.questions.length;
        if (total <= 0) { addLog('[答案清洗] 尚无题目数据', 'warn'); return; }
        if (state.answerList.length <= total) { addLog('[答案清洗] 答案数未超过题目数，无需截取', 'warn'); return; }
        const removed = state.answerList.length - total;
        applyAnswerClean(state.answerList.slice(0, total));
        addLog(`[答案清洗] 截取到 ${total} 条，删除 ${removed} 条`, 'success');
    }

    // 手动添加答案
    function cleanAdd() {
        const qEl = document.getElementById('a366-clean-q');
        const aEl = document.getElementById('a366-clean-a');
        if (!qEl || !aEl) return;
        const qText = qEl.value.trim();
        const answer = aEl.value.trim();
        if (!qText || !answer) { addLog('[答案清洗] 题干和答案都不能为空', 'warn'); return; }
        applyAnswerClean([...state.answerList, { questionText: qText, answer }]);
        qEl.value = '';
        aEl.value = '';
    }

    // ==========================================
    // 初始化
    // ==========================================

    function boot() {
        createUI();
        FillTimeMod.install();
        addLog('学习页规则集 v1.5 · bucket ' + BUCKET_URL + (window.__A366__ ? '（代理注入）' : '（默认端口）'), 'info');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
