// ==UserScript==
// @name         Beta 自动基础听力
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  精确文本匹配+原生点击，答案自动获取与填答，内嵌日志面板
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const BUCKET_URL = 'http://127.0.0.1:5290';
    const ANSWER_PATH = '/listening-answer';
    const TARGET_PATTERNS = ['听后选择-嵌套', '听后选择-整体'];

    const CSS_VARS = `
        --a366-primary: #007bff;
        --a366-primary-hover: #0056b3;
        --a366-primary-light: #e7f1ff;
        --a366-danger: #dc3545;
        --a366-danger-light: #f8d7da;
        --a366-success: #28a745;
        --a366-success-light: #d4edda;
        --a366-warning: #ffc107;
        --a366-warning-light: #fff3cd;
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
        currentResults: [],
        testQueue: [],
        logEntries: [],
        collapsed: false,
        noScroll: false,
        activeTab: 'search',
        answerList: [],
        answerLoading: false,
        answerError: null,
        autoFillRunning: false,
        autoFillIndex: 0,
    };

    let container = null;
    let inputEl = null;
    let resultsContainer = null;
    let answerListContainer = null;
    let logContent = null;

    function createUI() {
        container = document.createElement('div');
        container.id = 'a366-panel';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 520px;
            max-height: 680px;
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
                <span style="font-weight:600;font-size:14px;color:var(--a366-primary);">Beta 自动基础听力</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    <label id="a366-no-scroll-label" style="display:flex;align-items:center;gap:3px;cursor:pointer;background:var(--a366-bg-tertiary);padding:3px 8px;border-radius:var(--a366-radius-sm);font-size:11px;color:var(--a366-text-secondary);border:1px solid var(--a366-border);">
                        <input type="checkbox" id="a366-no-scroll" style="margin:0;accent-color:var(--a366-primary);"> 锁定滚动
                    </label>
                    <button id="a366-minimize" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:3px 8px;font-size:11px;cursor:pointer;">_</button>
                </div>
            </div>
            <div style="display:flex;border-bottom:1px solid var(--a366-border);background:var(--a366-bg-secondary);">
                <button class="a366-tab active" data-tab="search" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-primary);border-bottom:2px solid var(--a366-primary);transition:all 0.15s;">搜索测试</button>
                <button class="a366-tab" data-tab="answers" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-text-secondary);border-bottom:2px solid transparent;transition:all 0.15s;">答案列表</button>
            </div>
            <div id="a366-body" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;">
                <div id="a366-tab-search" style="padding:12px;display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;gap:6px;">
                        <input id="a366-search-input" type="text" placeholder="输入精确匹配的文本..." style="flex:1;padding:8px 10px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);background:var(--a366-bg);color:var(--a366-text);font-size:13px;outline:none;font-family:var(--a366-font);">
                        <button id="a366-search-btn" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">搜索</button>
                        <button id="a366-jiaojuan-btn" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">交卷</button>
                        <button id="a366-auto-btn" style="background:var(--a366-info);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">自动</button>
                    </div>
                    <div style="font-size:11px;color:var(--a366-text-secondary);padding:2px 0;">匹配方式：文本精确 | 点击方式：原生 .click()</div>
                    <div id="a366-results" style="min-height:30px;max-height:200px;overflow-y:auto;border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:6px;background:var(--a366-bg);"></div>
                    <div id="a366-queue" style="min-height:30px;max-height:160px;overflow-y:auto;border:1px solid var(--a366-warning);border-radius:var(--a366-radius-md);padding:6px;background:var(--a366-bg);">
                        <div style="color:var(--a366-warning);font-size:11px;margin-bottom:4px;">待测试队列</div>
                        <div style="color:var(--a366-text-muted);text-align:center;padding:6px;font-size:11px;">队列为空</div>
                    </div>
                </div>
                <div id="a366-tab-answers" style="padding:12px;display:none;flex-direction:column;gap:8px;">
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button id="a366-fetch-answers" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">获取答案</button>
                        <button id="a366-auto-fill-all" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;display:none;">一键填答</button>
                        <button id="a366-stop-auto-fill" style="background:var(--a366-danger);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;display:none;">停止</button>
                        <span id="a366-answer-status" style="font-size:11px;color:var(--a366-text-secondary);"></span>
                    </div>
                    <div id="a366-answer-info" style="font-size:11px;color:var(--a366-text-secondary);display:none;padding:6px 8px;background:var(--a366-primary-light);border-radius:var(--a366-radius-sm);border:1px solid var(--a366-primary);"></div>
                    <div id="a366-answer-list" style="flex:1;overflow-y:auto;max-height:320px;display:flex;flex-direction:column;gap:6px;">
                        <div style="color:var(--a366-text-muted);text-align:center;padding:20px;font-size:12px;">点击「获取答案」从本地服务器加载答案</div>
                    </div>
                </div>
            </div>
            <div style="border-top:1px solid var(--a366-border);background:var(--a366-bg-secondary);display:flex;flex-direction:column;flex-shrink:0;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px;">
                    <span style="font-size:11px;font-weight:500;color:var(--a366-text-secondary);">操作日志</span>
                    <button id="a366-log-clear" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">清空</button>
                </div>
                <div id="a366-log-content" style="height:120px;overflow-y:auto;padding:4px 10px 6px;font-size:11px;font-family:'Consolas','Courier New','PingFang SC',monospace;background:var(--a366-bg);">
                    <div style="color:var(--a366-success);">自动基础听力已就绪</div>
                    <div style="color:var(--a366-text-secondary);">搜索测试 | 答案获取 | 自动填答</div>
                </div>
            </div>
        `;

        document.body.appendChild(container);

        inputEl = document.getElementById('a366-search-input');
        resultsContainer = document.getElementById('a366-results');
        answerListContainer = document.getElementById('a366-answer-list');
        logContent = document.getElementById('a366-log-content');

        document.getElementById('a366-search-btn').addEventListener('click', performSearch);
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') performSearch(); });
        document.getElementById('a366-jiaojuan-btn').addEventListener('click', submitExam);
        document.getElementById('a366-auto-btn').addEventListener('click', executeAuto);
        document.getElementById('a366-minimize').addEventListener('click', toggleCollapse);
        document.getElementById('a366-fetch-answers').addEventListener('click', fetchAnswers);
        document.getElementById('a366-auto-fill-all').addEventListener('click', startAutoFillAll);
        document.getElementById('a366-stop-auto-fill').addEventListener('click', stopAutoFill);
        document.getElementById('a366-log-clear').addEventListener('click', () => {
            state.logEntries = [];
            logContent.innerHTML = '';
        });

        document.getElementById('a366-no-scroll').addEventListener('change', (e) => {
            state.noScroll = e.target.checked;
            const label = document.getElementById('a366-no-scroll-label');
            if (state.noScroll) {
                label.style.background = 'var(--a366-danger-light)';
                label.style.borderColor = 'var(--a366-danger)';
                addLog('页面滚动已锁定', 'warn');
            } else {
                label.style.background = 'var(--a366-bg-tertiary)';
                label.style.borderColor = 'var(--a366-border)';
                addLog('页面滚动已解锁', 'info');
            }
            try { localStorage.setItem('a366_noscroll', state.noScroll ? '1' : ''); } catch(e) {}
        });

        container.querySelectorAll('.a366-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        restoreScrollPref();
        makeDraggable();
    }

    function switchTab(tabName) {
        state.activeTab = tabName;
        container.querySelectorAll('.a366-tab').forEach(t => {
            const isActive = t.dataset.tab === tabName;
            t.style.color = isActive ? 'var(--a366-primary)' : 'var(--a366-text-secondary)';
            t.style.borderBottom = isActive ? '2px solid var(--a366-primary)' : '2px solid transparent';
            t.style.fontWeight = isActive ? '500' : '400';
        });
        document.getElementById('a366-tab-search').style.display = tabName === 'search' ? 'flex' : 'none';
        document.getElementById('a366-tab-answers').style.display = tabName === 'answers' ? 'flex' : 'none';
    }

    function performSearch() {
        const keyword = inputEl.value.trim();
        if (!keyword) { addLog('请输入搜索内容', 'warn'); return; }

        addLog(`搜索: "${keyword}"（文本精确匹配）`, 'info');

        const allElements = document.querySelectorAll('body *');
        const matchedResults = [];

        allElements.forEach(el => {
            if (el === container || container.contains(el) || el.contains(container)) return;
            try {
                if ((el.textContent || '').trim() === keyword) {
                    matchedResults.push(buildElementInfo(el, '文本精确匹配'));
                }
            } catch(e) {}
        });

        state.currentResults = matchedResults;

        if (matchedResults.length === 0) {
            addLog(`未找到文本精确匹配 "${keyword}" 的元素`, 'warn');
            resultsContainer.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;padding:12px;font-size:12px;">未找到匹配元素</div>`;
        } else {
            addLog(`共匹配到 ${matchedResults.length} 个元素`, 'success');
            renderResults(matchedResults);
        }
    }

    function submitExam() {
        addLog('开始交卷：搜索提交按钮元素', 'info');

        let submitBtns = document.querySelectorAll('.submit-btn');
        let selectorName = '.submit-btn';

        if (submitBtns.length === 0) {
            addLog('未找到 .submit-btn，尝试 .submit-btn-test', 'info');
            submitBtns = document.querySelectorAll('.submit-btn-test');
            selectorName = '.submit-btn-test';
        }

        if (submitBtns.length === 0) {
            addLog('未找到任何提交按钮元素', 'warn');
            resultsContainer.innerHTML = `<div style="color:var(--a366-warning);text-align:center;padding:12px;font-size:12px;">未找到提交按钮元素</div>`;
            return;
        }

        addLog(`找到 ${submitBtns.length} 个 ${selectorName} 元素`, 'success');

        state.currentResults = [];
        state.testQueue = [];

        submitBtns.forEach((el, i) => {
            const info = buildElementInfo(el, `${selectorName}类匹配`);
            state.currentResults.push(info);
        });

        renderResults(state.currentResults);

        submitBtns.forEach((el, i) => {
            const info = state.currentResults[i];
            state.testQueue.push(info);
            addLog(`${selectorName} #${i + 1} 已加入测试队列`, 'queue');
        });

        renderQueue();
        addLog(`共 ${submitBtns.length} 个 ${selectorName} 已加入队列，点击「全部测试」开始交卷`, 'info');
    }

    function buildElementInfo(el, strategyName) {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const isVisible = rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
        const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100);
        return {
            element: el,
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            className: (typeof el.className === 'string' ? el.className : ''),
            text: text,
            type: el.type || '',
            name: el.getAttribute('name') || '',
            title: el.title || '',
            href: el.href || '',
            role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            visible: isVisible,
            disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
            size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            position: `(${Math.round(rect.left)},${Math.round(rect.top)})`,
            zIndex: cs.zIndex !== 'auto' ? cs.zIndex : '',
            strategy: strategyName,
        };
    }

    function renderResults(results) {
        let html = `<div style="font-size:11px;color:var(--a366-primary);margin-bottom:4px;">匹配结果 (${results.length})</div>`;
        results.forEach((info, i) => {
            const visColor = info.visible ? 'var(--a366-success)' : 'var(--a366-danger)';
            html += `
            <div style="border-left:3px solid ${visColor};margin:4px 0;padding:4px 8px;background:var(--a366-bg-secondary);border-radius:0 var(--a366-radius-sm) var(--a366-radius-sm) 0;font-size:11px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <b style="color:var(--a366-primary);">#${i + 1}</b>
                    <span style="color:var(--a366-text-muted);font-size:10px;">${escapeHtml(info.strategy)}</span>
                </div>
                <div>&lt;<b>${info.tag}</b>&gt; ${info.id ? '<span style="color:var(--a366-warning);">#' + escapeHtml(info.id) + '</span> ' : ''}<span style="color:var(--a366-text-secondary);">${escapeHtml(info.className.substring(0, 50))}</span></div>
                <div style="color:var(--a366-text);word-break:break-all;">${escapeHtml(info.text.substring(0, 60)) || '<span style="color:var(--a366-text-muted);">(无文本)</span>'}</div>
                <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap;">
                    <span style="color:${visColor};">${info.visible ? '可见' : '隐藏'}</span>
                    ${info.disabled ? '<span style="color:var(--a366-danger);">禁用</span>' : ''}
                    <span>${info.size}</span>
                    <span>${info.position}</span>
                    ${info.zIndex ? '<span>z:' + info.zIndex + '</span>' : ''}
                    ${info.type ? '<span>type:' + escapeHtml(info.type) + '</span>' : ''}
                    ${info.name ? '<span>name:' + escapeHtml(info.name) + '</span>' : ''}
                    ${info.role ? '<span>role:' + escapeHtml(info.role) + '</span>' : ''}
                </div>
                <div style="margin-top:3px;display:flex;gap:4px;">
                    <button class="a366-add-queue" data-index="${i}" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:2px 8px;font-size:10px;cursor:pointer;">加入队列</button>
                    <button class="a366-dump-info" data-index="${i}" style="background:var(--a366-info);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:2px 8px;font-size:10px;cursor:pointer;">详情</button>
                </div>
            </div>`;
        });
        resultsContainer.innerHTML = html;

        resultsContainer.querySelectorAll('.a366-add-queue').forEach(btn => {
            btn.addEventListener('click', (e) => { addToQueue(parseInt(btn.dataset.index)); e.stopPropagation(); });
        });
        resultsContainer.querySelectorAll('.a366-dump-info').forEach(btn => {
            btn.addEventListener('click', (e) => { dumpElementInfo(parseInt(btn.dataset.index)); e.stopPropagation(); });
        });
    }

    function dumpElementInfo(resultIndex) {
        const info = state.currentResults[resultIndex];
        if (!info) return;
        const el = info.element;
        if (!el || !document.contains(el)) {
            addLog(`元素 #${resultIndex + 1}: 已不在DOM中，无法读取详情`, 'warn');
            return;
        }

        el.style.outline = '3px solid var(--a366-info)';
        if (!state.noScroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { el.style.outline = ''; }, 1500);

        addLog(`━━━━━━━━━━━━━━━━━━━━━━`, 'info');
        addLog(`元素 #${resultIndex + 1} 详细信息`, 'info');

        const buildCSSPath = (node) => {
            const parts = [];
            let cur = node;
            while (cur && cur !== document.documentElement && cur !== document.body.parentElement) {
                let selector = cur.tagName.toLowerCase();
                if (cur.id) {
                    selector += '#' + cur.id;
                } else {
                    if (cur.className && typeof cur.className === 'string') {
                        const cls = cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
                        if (cls) selector += '.' + cls;
                    }
                    const parent = cur.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
                        if (siblings.length > 1) {
                            const idx = siblings.indexOf(cur) + 1;
                            selector += `:nth-of-type(${idx})`;
                        }
                    }
                }
                parts.unshift(selector);
                cur = cur.parentElement;
            }
            return parts.join(' > ');
        };

        const buildXPath = (node) => {
            const parts = [];
            let cur = node;
            while (cur && cur !== document.documentElement) {
                let tag = cur.tagName.toLowerCase();
                if (cur.id) {
                    parts.unshift(`//${tag}[@id="${cur.id}"]`);
                    break;
                }
                const parent = cur.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
                    if (siblings.length > 1) {
                        const idx = siblings.indexOf(cur) + 1;
                        tag += `[${idx}]`;
                    }
                }
                parts.unshift(tag);
                cur = cur.parentElement;
            }
            return '/' + parts.join('/');
        };

        addLog(`  标签: &lt;${info.tag}&gt;`, 'info');
        if (info.id) addLog(`  id: ${info.id}`, 'info');
        if (info.className) addLog(`  class: ${info.className}`, 'info');
        if (info.type) addLog(`  type: ${info.type}`, 'info');
        if (info.name) addLog(`  name: ${info.name}`, 'info');
        if (info.title) addLog(`  title: ${info.title}`, 'info');
        if (info.href) addLog(`  href: ${info.href}`, 'info');
        if (info.role) addLog(`  role: ${info.role}`, 'info');
        if (info.ariaLabel) addLog(`  aria-label: ${info.ariaLabel}`, 'info');
        addLog(`  可见: ${info.visible ? '是' : '否'} | 禁用: ${info.disabled ? '是' : '否'}`, 'info');
        addLog(`  尺寸: ${info.size} | 位置: ${info.position}`, 'info');
        if (info.zIndex) addLog(`  z-index: ${info.zIndex}`, 'info');

        const allAttrs = Array.from(el.attributes);
        if (allAttrs.length > 0) {
            const attrStr = allAttrs.map(a => `${a.name}="${escapeHtml(a.value)}"`).join(', ');
            addLog(`  全部属性(${allAttrs.length}): ${attrStr}`, 'info');
        }

        const cs = getComputedStyle(el);
        const keyStyles = ['display', 'position', 'visibility', 'opacity', 'cursor', 'pointer-events',
                           'overflow', 'margin', 'padding', 'border', 'background-color', 'color'];
        const styleParts = [];
        keyStyles.forEach(p => {
            const v = cs.getPropertyValue(p);
            if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') {
                styleParts.push(`${p}: ${v}`);
            }
        });
        if (styleParts.length > 0) {
            addLog(`  关键样式: ${styleParts.join('; ')}`, 'info');
        }

        const parentChain = [];
        let p = el.parentElement;
        let depth = 0;
        while (p && depth < 10) {
            let desc = `<${p.tagName.toLowerCase()}>`;
            if (p.id) desc = `<${p.tagName.toLowerCase()}#${p.id}>`;
            else if (p.className && typeof p.className === 'string') desc = `<${p.tagName.toLowerCase()}.${p.className.trim().split(/\s+/).slice(0, 2).join('.')}>`;
            parentChain.push(desc);
            p = p.parentElement;
            depth++;
        }
        if (parentChain.length > 0) {
            addLog(`  父级链(${parentChain.length}层): ${parentChain.join(' -> ')}`, 'info');
        }

        addLog(`  子元素数: ${el.children.length}`, 'info');
        if (el.parentElement) {
            const siblings = Array.from(el.parentElement.children);
            const myIdx = siblings.indexOf(el);
            addLog(`  父级中第 ${myIdx + 1}/${siblings.length} 个子元素`, 'info');
        }

        addLog(`  CSS路径: ${buildCSSPath(el)}`, 'info');
        addLog(`  XPath: ${buildXPath(el)}`, 'info');
        addLog(`  匹配策略: ${info.strategy}`, 'info');
        addLog(`  innerHTML预览: ${escapeHtml((el.innerHTML || '').substring(0, 200))}`, 'info');
        addLog(`━━━━━━━━━━━━━━━━━━━━━━`, 'info');
    }

    function addToQueue(resultIndex) {
        const info = state.currentResults[resultIndex];
        if (!info) return;
        state.testQueue.push(info);
        addLog(`元素 #${resultIndex + 1} (&lt;${info.tag}&gt;) 已加入测试队列 (队列共 ${state.testQueue.length} 项)`, 'queue');
        renderQueue();
    }

    function renderQueue() {
        const q = document.getElementById('a366-queue');
        if (state.testQueue.length === 0) {
            q.innerHTML = `<div style="color:var(--a366-warning);font-size:11px;margin-bottom:4px;">待测试队列</div><div style="color:var(--a366-text-muted);text-align:center;padding:6px;font-size:11px;">队列为空</div>`;
            return;
        }

        let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="color:var(--a366-warning);font-size:11px;">待测试队列 (${state.testQueue.length})</span>
            <span>
                <button id="a366-test-all" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:2px 8px;font-size:10px;cursor:pointer;margin-right:4px;">全部测试</button>
                <button id="a366-clear-queue" style="background:var(--a366-danger);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:2px 8px;font-size:10px;cursor:pointer;">清空</button>
            </span>
        </div>`;

        state.testQueue.forEach((info, i) => {
            const tested = info._tested;
            const bgColor = tested ? (info._success ? 'var(--a366-success-light)' : 'var(--a366-danger-light)') : 'var(--a366-bg-secondary)';
            const borderColor = tested ? (info._success ? 'var(--a366-success)' : 'var(--a366-danger)') : 'var(--a366-warning)';
            html += `
            <div style="border-left:3px solid ${borderColor};margin:3px 0;padding:3px 8px;background:${bgColor};border-radius:0 var(--a366-radius-sm) var(--a366-radius-sm) 0;font-size:11px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span><b>#${i + 1}</b> &lt;${info.tag}&gt; ${escapeHtml(info.text.substring(0, 30))}</span>
                    <span>
                        ${tested ? `<span style="font-size:10px;color:${info._success ? 'var(--a366-success)' : 'var(--a366-danger)'};">${info._success ? '成功' : '失败'} ${info._clickMethod || ''}</span>` : ''}
                        <button class="a366-test-one" data-queue="${i}" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">测试</button>
                        <button class="a366-remove-queue" data-queue="${i}" style="background:var(--a366-text-muted);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">x</button>
                    </span>
                </div>
                ${tested && info._log ? `<div style="color:var(--a366-text-secondary);font-size:10px;">${info._log}</div>` : ''}
            </div>`;
        });

        q.innerHTML = html;
        document.getElementById('a366-test-all')?.addEventListener('click', testAll);
        document.getElementById('a366-clear-queue')?.addEventListener('click', () => { state.testQueue = []; addLog('测试队列已清空', 'info'); renderQueue(); });
        q.querySelectorAll('.a366-test-one').forEach(btn => {
            btn.addEventListener('click', (e) => { testOne(parseInt(btn.dataset.queue)); e.stopPropagation(); });
        });
        q.querySelectorAll('.a366-remove-queue').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(btn.dataset.queue);
                if (idx >= 0 && idx < state.testQueue.length) {
                    const info = state.testQueue[idx];
                    state.testQueue.splice(idx, 1);
                    addLog(`从队列移除: &lt;${info.tag}&gt; "${info.text.substring(0, 30)}"`, 'info');
                    renderQueue();
                }
                e.stopPropagation();
            });
        });
    }

    function testAll() {
        return new Promise((resolve) => {
            addLog('开始逐个测试队列中的所有元素...', 'info');
            testNextInQueueWithResolve(0, resolve);
        });
    }

    function testNextInQueueWithResolve(index, resolve) {
        if (index >= state.testQueue.length) {
            unlockScroll();
            addLog('队列中所有元素测试完毕', 'success');
            resolve();
            return;
        }
        testOne(index, () => {
            setTimeout(() => testNextInQueueWithResolve(index + 1, resolve), 400);
        });
    }

    function testNextInQueue(index) {
        if (index >= state.testQueue.length) {
            unlockScroll();
            addLog('队列中所有元素测试完毕', 'success');
            return;
        }
        testOne(index, () => {
            setTimeout(() => testNextInQueue(index + 1), 400);
        });
    }

    function testOne(queueIndex, callback) {
        const info = state.testQueue[queueIndex];
        if (!info) return;

        const el = info.element;
        if (!el || !document.contains(el)) {
            info._tested = true;
            info._success = false;
            info._clickMethod = '元素已不在DOM';
            info._log = '元素已从页面中移除';
            addLog(`队列 #${queueIndex + 1}: 元素已不在DOM中，无法点击`, 'error');
            renderQueue();
            if (callback) callback();
            return;
        }

        lockScroll();

        el.style.outline = '3px solid var(--a366-primary)';
        if (!state.noScroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
            let clicked = false;
            try {
                el.click();
                clicked = true;
                addLog(`队列 #${queueIndex + 1}: 原生.click() -> &lt;${info.tag}&gt; "${info.text.substring(0, 40)}"`, 'click');
            } catch(e) {
                addLog(`队列 #${queueIndex + 1}: 原生.click() 异常: ${e.message}`, 'error');
            }

            info._tested = true;
            info._success = clicked;
            info._clickMethod = clicked ? '原生.click()' : '点击失败';
            info._log = `原生.click()，成功: ${clicked ? '是' : '否'}`;

            setTimeout(() => { el.style.outline = ''; }, 600);
            renderQueue();
            if (callback) callback();
        }, 200);
    }

    function lockScroll() {
        if (state.noScroll) return;
        document.body.style.overflow = 'hidden';
    }

    function unlockScroll() {
        if (state.noScroll) return;
        document.body.style.overflow = '';
    }

    async function fetchAnswers() {
        const statusEl = document.getElementById('a366-answer-status');
        const fetchBtn = document.getElementById('a366-fetch-answers');
        statusEl.textContent = '正在获取...';
        fetchBtn.disabled = true;
        state.answerLoading = true;
        state.answerError = null;

        try {
            const resp = await fetch(BUCKET_URL + ANSWER_PATH);

            if (resp.status === 404) {
                let errorDetail = '答案尚未提取，请先在主程序中启动代理捕获答案';
                try {
                    const errData = await resp.json();
                    if (errData.error) errorDetail = errData.error;
                } catch(_) {}
                throw new Error(errorDetail);
            }

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const data = await resp.json();

            let rawAnswers = [];
            if (Array.isArray(data)) {
                rawAnswers = data;
            } else if (data && Array.isArray(data.answers)) {
                rawAnswers = data.answers;
            }

            const filtered = rawAnswers.filter(a => TARGET_PATTERNS.includes(a.pattern));
            state.answerList = filtered;

            const infoEl = document.getElementById('a366-answer-info');
            infoEl.style.display = 'block';
            infoEl.innerHTML = `原始答案 ${rawAnswers.length} 条 | 筛选「听后选择」${filtered.length} 条 | 端口: ${BUCKET_URL.replace('http://127.0.0.1:', '')}`;

            if (filtered.length > 0) {
                document.getElementById('a366-auto-fill-all').style.display = '';
                addLog(`获取答案成功：${filtered.length} 条听后选择题`, 'success');
            } else {
                document.getElementById('a366-auto-fill-all').style.display = 'none';
                addLog(`获取到 ${rawAnswers.length} 条答案，但无听后选择题`, 'warn');
            }

            renderAnswerList();
            statusEl.textContent = '';

        } catch(e) {
            state.answerError = e.message;
            statusEl.textContent = '';
            const isNetworkError = e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('fetch');
            if (isNetworkError) {
                addLog(`获取答案失败: 无法连接服务器，请确认代理服务器已启动`, 'error');
                answerListContainer.innerHTML = `<div style="color:var(--a366-danger);text-align:center;padding:20px;font-size:12px;">无法连接服务器<br><span style="color:var(--a366-text-muted);">请确认主程序代理服务器已启动 (${BUCKET_URL})</span></div>`;
            } else {
                addLog(`获取答案失败: ${e.message}`, 'error');
                answerListContainer.innerHTML = `<div style="color:var(--a366-danger);text-align:center;padding:20px;font-size:12px;">${escapeHtml(e.message)}<br><span style="color:var(--a366-text-muted);">请在主程序中启动代理捕获答案后重试</span></div>`;
            }
        } finally {
            state.answerLoading = false;
            fetchBtn.disabled = false;
        }
    }

    function renderAnswerList() {
        const list = state.answerList;
        if (list.length === 0) {
            answerListContainer.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;padding:20px;font-size:12px;">暂无答案数据</div>`;
            return;
        }

        let html = '';
        list.forEach((ans, i) => {
            const patternColor = ans.pattern === '听后选择-嵌套' ? 'var(--a366-info)' : 'var(--a366-primary)';
            const patternBg = 'var(--a366-primary-light)';
            const questionText = ans.questionText || ans.question || '未知题目';
            const answerText = ans.answer || '无答案';
            const fillStatus = ans._fillStatus || 'pending';

            let statusBadge = '';
            if (fillStatus === 'filling') statusBadge = `<span style="color:var(--a366-warning);font-size:10px;">填答中</span>`;
            else if (fillStatus === 'filled') statusBadge = `<span style="color:var(--a366-success);font-size:10px;">已填答</span>`;
            else if (fillStatus === 'failed') statusBadge = `<span style="color:var(--a366-danger);font-size:10px;">失败</span>`;

            html += `
            <div style="border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:8px 10px;background:var(--a366-bg);${fillStatus === 'filled' ? 'border-left:3px solid var(--a366-success);' : fillStatus === 'failed' ? 'border-left:3px solid var(--a366-danger);' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-weight:600;color:var(--a366-text);font-size:12px;">#${i + 1}</span>
                        <span style="background:${patternBg};color:${patternColor};padding:1px 6px;border-radius:var(--a366-radius-sm);font-size:10px;font-weight:500;">${escapeHtml(ans.pattern)}</span>
                        ${statusBadge}
                    </div>
                    <div style="display:flex;gap:4px;">
                        <button class="a366-fill-one" data-index="${i}" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:2px 8px;font-size:10px;cursor:pointer;">填答</button>
                        <button class="a366-copy-answer" data-index="${i}" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:2px 8px;font-size:10px;cursor:pointer;">复制</button>
                    </div>
                </div>
                <div style="font-size:12px;color:var(--a366-text);margin-bottom:2px;word-break:break-all;">${escapeHtml(questionText.substring(0, 80))}</div>
                <div style="font-size:12px;color:var(--a366-success);font-weight:500;word-break:break-all;">${escapeHtml(answerText.substring(0, 80))}</div>
            </div>`;
        });

        answerListContainer.innerHTML = html;

        answerListContainer.querySelectorAll('.a366-fill-one').forEach(btn => {
            btn.addEventListener('click', (e) => { fillOneAnswer(parseInt(btn.dataset.index)); e.stopPropagation(); });
        });
        answerListContainer.querySelectorAll('.a366-copy-answer').forEach(btn => {
            btn.addEventListener('click', (e) => { copyAnswerText(parseInt(btn.dataset.index)); e.stopPropagation(); });
        });
    }

    function copyAnswerText(idx) {
        const ans = state.answerList[idx];
        if (!ans) return;
        const text = ans.answer || '';
        try {
            navigator.clipboard.writeText(text).then(() => {
                addLog(`已复制答案 #${idx + 1}`, 'success');
            }).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                addLog(`已复制答案 #${idx + 1}`, 'success');
            });
        } catch(e) {
            addLog(`复制失败: ${e.message}`, 'error');
        }
    }

    function fillOneAnswer(idx) {
        const ans = state.answerList[idx];
        if (!ans) return;

        ans._fillStatus = 'filling';
        renderAnswerList();
        addLog(`开始填答 #${idx + 1}: ${escapeHtml((ans.questionText || '').substring(0, 40))}`, 'info');

        const answerText = ans.answer || '';
        const dotIndex = answerText.indexOf('.');
        const optionId = dotIndex > 0 ? answerText.substring(0, dotIndex).trim() : '';
        const optionContent = dotIndex >= 0 ? answerText.substring(dotIndex + 1).trim() : answerText.trim();

        addLog(`  匹配文本: "${escapeHtml(optionContent)}"`, 'info');

        const found = findAndClickOption(optionId, optionContent, ans);

        if (found) {
            ans._fillStatus = 'filled';
            addLog(`#${idx + 1} 填答成功`, 'success');
        } else {
            ans._fillStatus = 'failed';
            addLog(`#${idx + 1} 未找到匹配选项`, 'error');
        }
        renderAnswerList();
    }

    function findAndClickOption(optionId, optionContent, answerObj) {
        const allElements = document.querySelectorAll('body *');
        const pageWrap = document.getElementById('page-wrap');
        const candidates = [];

        for (const el of allElements) {
            if (el === container || container.contains(el) || el.contains(container)) continue;
            if (pageWrap && !pageWrap.contains(el)) continue;
            try {
                const text = (el.textContent || '').trim();
                if (normalizeQuotes(text) === normalizeQuotes(optionContent)) {
                    const tag = el.tagName.toLowerCase();
                    if (['div', 'span', 'li', 'label', 'button', 'a', 'p'].includes(tag)) {
                        const rect = el.getBoundingClientRect();
                        candidates.push({ element: el, height: Math.round(rect.height) });
                    }
                }
            } catch(e) {}
        }

        if (candidates.length === 0) return false;

        let target;
        const height24 = candidates.filter(c => c.height === 24);
        if (height24.length > 0) {
            target = height24[0].element;
            addLog(`  通过搜索匹配点击: 高度=${24} (${candidates.length}个候选)`, 'click');
        } else {
            candidates.sort((a, b) => a.height - b.height);
            target = candidates[0].element;
            addLog(`  通过搜索匹配点击: 最小高度=${candidates[0].height} (${candidates.length}个候选)`, 'click');
        }

        target.style.outline = '3px solid var(--a366-success)';
        if (!state.noScroll) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { target.style.outline = ''; }, 1500);
        target.click();
        return true;
    }

    function startAutoFillAll() {
        if (state.answerList.length === 0) return;
        state.autoFillRunning = true;
        state.autoFillIndex = 0;

        document.getElementById('a366-auto-fill-all').style.display = 'none';
        document.getElementById('a366-stop-auto-fill').style.display = '';

        addLog(`开始一键自动填答，共 ${state.answerList.length} 题`, 'info');
        autoFillNext();
    }

    function autoFillNext() {
        if (!state.autoFillRunning || state.autoFillIndex >= state.answerList.length) {
            stopAutoFill();
            if (state.autoFillIndex >= state.answerList.length) {
                addLog('一键自动填答完毕', 'success');
            }
            return;
        }

        const idx = state.autoFillIndex;
        fillOneAnswer(idx);
        state.autoFillIndex++;
        setTimeout(() => autoFillNext(), 50);
    }

    function stopAutoFill() {
        state.autoFillRunning = false;
        document.getElementById('a366-auto-fill-all').style.display = '';
        document.getElementById('a366-stop-auto-fill').style.display = 'none';
        addLog('自动填答已停止', 'warn');
    }

    function clickStartBtn() {
        // 点击"去做题"按钮
        // 方法1：通过 class 查找
        let btn = document.querySelector('.start-btn-text');
        if (btn) {
            btn.click();
            return true;
        }
        // 方法2：通过文本内容查找
        const allElements = document.querySelectorAll('button, span, div, a');
        for (const el of allElements) {
            if (el === container || container.contains(el)) continue;
            const text = (el.textContent || '').trim();
            if (text === '去做题') {
                el.click();
                return true;
            }
        }

        return false;
    }

    function clickConfirmSubmitBtn() {
        // 在弹窗中查找"交卷"按钮
        const popups = document.querySelectorAll('.u3compo-popup');
        for (const popup of popups) {
            const btnList = popup.querySelector('.u3-button-list.u3-button-double');
            if (!btnList) continue;

            const btns = btnList.querySelectorAll('.u3-button');
            for (const btn of btns) {
                if ((btn.textContent || '').trim() === '交卷') {
                    btn.click();
                    return true;
                }
            }
        }

        return false;
    }

    // 等待弹窗出现并点击确认交卷
    async function waitAndClickConfirmSubmit(maxWait = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWait) {
            if (clickConfirmSubmitBtn()) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    }

    async function executeAuto() {
        addLog('━━━━━━━━ 自动流程开始 ━━━━━━━', 'info');

        // 检查并点击"去做题"按钮（试题预览页）
        const startBtnClicked = clickStartBtn();
        if (startBtnClicked) {
            addLog('检测到试题预览页，已点击「去做题」', 'success');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (state.answerList.length === 0) {
            await fetchAnswers();
            if (state.answerList.length === 0) {
                addLog('获取答案失败，自动流程终止', 'error');
                return;
            }
        }

        document.getElementById('a366-auto-fill-all').style.display = '';

        await new Promise((resolve) => {
            state.autoFillRunning = true;
            state.autoFillIndex = 0;
            document.getElementById('a366-auto-fill-all').style.display = 'none';
            document.getElementById('a366-stop-auto-fill').style.display = '';

            addLog(`开始一键自动填答，共 ${state.answerList.length} 题`, 'info');

            function checkFillComplete() {
                if (!state.autoFillRunning || state.autoFillIndex >= state.answerList.length) {
                    state.autoFillRunning = false;
                    document.getElementById('a366-auto-fill-all').style.display = '';
                    document.getElementById('a366-stop-auto-fill').style.display = 'none';
                    addLog('一键自动填答完毕', 'success');
                    resolve();
                    return;
                }
                setTimeout(checkFillComplete, 200);
            }

            autoFillNext();
            checkFillComplete();
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        addLog('开始交卷流程', 'info');
        submitExam();

        await new Promise(resolve => setTimeout(resolve, 500));

        if (state.testQueue.length > 0) {
            addLog(`测试队列中有 ${state.testQueue.length} 个元素，开始逐个测试`, 'info');
            await testAll();

            // 等待弹窗出现并点击确认交卷
            addLog('等待交卷确认弹窗...', 'info');
            const confirmed = await waitAndClickConfirmSubmit(5000);
            if (confirmed) {
                addLog('已点击确认交卷按钮', 'success');
            } else {
                addLog('未检测到交卷确认弹窗', 'warn');
            }
        } else {
            addLog('未找到交卷按钮，流程结束', 'warn');
        }

        addLog('━━━━━━━━ 自动流程结束 ━━━━━━━━', 'info');
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
            match: 'var(--a366-info)',
            click: '#6f42c1',
            action: '#e67e22',
            queue: '#e67e22',
        };
        const color = colors[type] || colors.info;

        const div = document.createElement('div');
        div.style.cssText = `padding:1px 0;border-bottom:1px solid var(--a366-border);color:${color};word-break:break-all;`;
        div.innerHTML = `<span style="color:var(--a366-text-muted);">[${time}]</span> ${message}`;
        logContent.appendChild(div);
        logContent.scrollTop = logContent.scrollHeight;
    }

    function toggleCollapse() {
        const body = document.getElementById('a366-body');
        if (!body) return;
        state.collapsed = !state.collapsed;
        body.style.display = state.collapsed ? 'none' : 'flex';
        container.style.maxHeight = state.collapsed ? 'auto' : '680px';
    }

    function restoreScrollPref() {
        try {
            const val = localStorage.getItem('a366_noscroll');
            if (val === '1') {
                state.noScroll = true;
                const cb = document.getElementById('a366-no-scroll');
                const label = document.getElementById('a366-no-scroll-label');
                if (cb) cb.checked = true;
                if (label) { label.style.background = 'var(--a366-danger-light)'; label.style.borderColor = 'var(--a366-danger)'; }
            }
        } catch(e) {}
    }

    function makeDraggable() {
        const header = document.getElementById('a366-header');
        if (!header) return;
        let isDragging = false, startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = container.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            container.style.transition = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            container.style.right = 'auto';
            container.style.bottom = 'auto';
            container.style.left = (initialLeft + e.clientX - startX) + 'px';
            container.style.top = (initialTop + e.clientY - startY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) { isDragging = false; container.style.transition = ''; }
        });
    }

    function normalizeQuotes(str) {
        return String(str)
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"');
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
