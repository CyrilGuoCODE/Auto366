// ==UserScript==
// @name         Beta 自动基础听力
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  自动获取答案与填答，开发者面板支持搜索测试与队列管理
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
        devPanelVisible: false,
        answerList: [],
        answerLoading: false,
        answerError: null,
        autoFillRunning: false,
        autoFillIndex: 0,
        completionRate: (function() { var v = parseInt(localStorage.getItem('a366_completion_rate')); return (!isNaN(v) && v >= 0 && v <= 100) ? v : 100; })(),
        accuracyRate: (function() { var v = parseInt(localStorage.getItem('a366_accuracy_rate')); return (!isNaN(v) && v >= 0 && v <= 100) ? v : 100; })(),
        _skipIndices: null,
        _wrongIndices: null,
        _fillPlan: null,
        // ===== 听力时间修改（"内置-自动基础听力"子规则）=====
        listenTimeEnabled: localStorage.getItem('a366_listentime_enabled') === 'true',
        listenTimeSeconds: (function() {
            var raw = localStorage.getItem('a366_listentime_seconds');
            if (raw === null || raw === '') return null;
            var v = parseInt(raw, 10);
            return Number.isFinite(v) ? v : null;
        })(),
    };

    let container = null;
    let devPanel = null;
    let inputEl = null;
    let resultsContainer = null;
    let answerListContainer = null;
    let logContent = null;

    // ==========================================
    // UI 创建
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
                <span style="font-weight:600;font-size:14px;color:var(--a366-primary);">Beta 自动基础听力</span>
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
                        <button id="a366-auto-fill-all" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;display:none;">一键填答</button>
                        <button id="a366-stop-auto-fill" style="background:var(--a366-danger);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;display:none;">停止</button>
                        <button id="a366-jiaojuan-btn" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">交卷</button>
                        <button id="a366-auto-btn" style="background:var(--a366-info);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 12px;font-size:13px;cursor:pointer;font-weight:500;">自动听力</button>
                        <button id="a366-auto-settings" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 12px;font-size:13px;cursor:pointer;font-weight:500;display:flex;align-items:center;gap:4px;" title="填答设置"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/></svg>设置</button>
                    </div>
                </div>
            </div>
            <div style="border-top:1px solid var(--a366-border);padding:8px 10px;display:flex;align-items:center;gap:4px;flex-shrink:0;">
                <span style="font-size:12px;font-weight:600;color:var(--a366-text);">时间修改</span>
                <input type="checkbox" id="a366-listentime-enable" style="margin:0 4px 0 2px;cursor:pointer;">
                <input type="number" id="a366-listentime-min" step="1" placeholder="-" style="width:50px;font-size:12px;text-align:center;padding:3px 4px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);background:var(--a366-bg);color:var(--a366-text);outline:none;" disabled>
                <span style="font-size:12px;color:var(--a366-text-secondary);">分</span>
                <input type="number" id="a366-listentime-sec" step="1" placeholder="-" style="width:50px;font-size:12px;text-align:center;padding:3px 4px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);background:var(--a366-bg);color:var(--a366-text);outline:none;" disabled>
                <span style="font-size:12px;color:var(--a366-text-secondary);">秒</span>
            </div>
            <div style="border-top:1px solid var(--a366-border);background:var(--a366-bg-secondary);display:flex;flex-direction:column;flex-shrink:0;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px;">
                    <span style="font-size:11px;font-weight:500;color:var(--a366-text-secondary);">操作日志</span>
                    <button id="a366-log-clear" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">清空</button>
                </div>
                <div id="a366-log-content" style="height:120px;overflow-y:auto;padding:4px 10px 6px;font-size:11px;font-family:'Consolas','Courier New','PingFang SC',monospace;background:var(--a366-bg);">
                    <div style="color:var(--a366-success);">自动基础听力已就绪</div>
                    <div style="color:var(--a366-text-secondary);">填答 | 交卷 | 自动</div>
                </div>
            </div>
        `;

        document.body.appendChild(container);
        createAccuracyModal();
        createDevPanel();

        logContent = document.getElementById('a366-log-content');

        document.getElementById('a366-dev-btn').addEventListener('click', toggleDevPanel);
        document.getElementById('a366-minimize').addEventListener('click', toggleCollapse);
        document.getElementById('a366-jiaojuan-btn').addEventListener('click', async () => {
            submitExam();
            await new Promise(resolve => setTimeout(resolve, 500));
            addLog('等待交卷确认弹窗...', 'info');
            const confirmed = await waitAndClickConfirmSubmit(5000);
            if (confirmed) {
                addLog('已点击确认交卷按钮', 'success');
            } else {
                addLog('未检测到交卷确认弹窗（可能无需确认或已超时）', 'warn');
            }
        });
        document.getElementById('a366-auto-btn').addEventListener('click', executeAuto);
        document.getElementById('a366-auto-settings').addEventListener('click', toggleAccuracySettings);
        document.getElementById('a366-auto-fill-all').addEventListener('click', startAutoFillAll);
        document.getElementById('a366-stop-auto-fill').addEventListener('click', stopAutoFill);
        document.getElementById('a366-log-clear').addEventListener('click', () => {
            state.logEntries = [];
            logContent.innerHTML = '';
        });

        // ===== 时间修改 UI 绑定（分+秒，换算成总秒数）=====
        const ltEnable = document.getElementById('a366-listentime-enable');
        const ltMin = document.getElementById('a366-listentime-min');
        const ltSec = document.getElementById('a366-listentime-sec');
        if (ltEnable && ltMin && ltSec) {
            const ltSetDisabled = (dis) => {
                ltMin.disabled = dis; ltSec.disabled = dis;
                ltMin.style.opacity = dis ? '0.5' : '1';
                ltSec.style.opacity = dis ? '0.5' : '1';
            };
            const ltFillFromTotal = () => {
                if (state.listenTimeSeconds === null || state.listenTimeSeconds === undefined) {
                    ltMin.value = ''; ltSec.value = ''; return;
                }
                const total = state.listenTimeSeconds;
                const sign = total < 0 ? -1 : 1;
                const abs = Math.abs(total);
                ltMin.value = String(Math.floor(abs / 60) * sign);
                ltSec.value = String((abs % 60) * sign);
            };
            const ltCommit = () => {
                const mRaw = ltMin.value.trim();
                const sRaw = ltSec.value.trim();
                if (mRaw === '' && sRaw === '') {
                    state.listenTimeSeconds = null;
                    localStorage.removeItem('a366_listentime_seconds');
                    addLog('[时间修改] 时间已清空（提交不会被修改）', 'info');
                    pushListenTime();
                    return;
                }
                let m = mRaw === '' ? 0 : parseInt(mRaw, 10);
                let s = sRaw === '' ? 0 : parseInt(sRaw, 10);
                if (!Number.isFinite(m)) m = 0;
                if (!Number.isFinite(s)) s = 0;
                let total = m * 60 + s;
                if (total < -2147483648) total = -2147483648;
                if (total > 2147483647) total = 2147483647;
                state.listenTimeSeconds = total;
                localStorage.setItem('a366_listentime_seconds', String(total));
                ltFillFromTotal();
                addLog('[时间修改] 听力提交用时设为 ' + m + '分' + s + '秒 = ' + total + '秒', 'info');
                pushListenTime();
            };

            ltEnable.checked = state.listenTimeEnabled;
            ltSetDisabled(!state.listenTimeEnabled);
            ltFillFromTotal();

            ltEnable.addEventListener('change', () => {
                state.listenTimeEnabled = ltEnable.checked;
                localStorage.setItem('a366_listentime_enabled', String(state.listenTimeEnabled));
                ltSetDisabled(!state.listenTimeEnabled);
                addLog('[时间修改] ' + (state.listenTimeEnabled ? '已启用' : '已禁用')
                    + (state.listenTimeEnabled && state.listenTimeSeconds === null ? '（时间未填，提交不会被修改）' : ''),
                    'info');
                pushListenTime();
            });
            ltMin.addEventListener('change', ltCommit);
            ltSec.addEventListener('change', ltCommit);
        }

        makeDraggable(container, document.getElementById('a366-header'));
        autoFetchAnswers();
        pushListenTime();
    }

    // 把"启用/秒数"状态经本地 bucket server 推给代理层（代理层据此改 tasksJson.seconds 并重算 ut）
    function pushListenTime() {
        const payload = {
            enabled: state.listenTimeEnabled === true,
            seconds: (state.listenTimeSeconds === null || state.listenTimeSeconds === undefined)
                ? null : state.listenTimeSeconds
        };
        try {
            fetch(BUCKET_URL + '/listen-time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                cache: 'no-cache'
            }).then(r => r.json())
              .then(res => {
                  if (res && res.success) {
                      addLog('[时间修改] 状态已同步到代理层 | 启用=' + payload.enabled
                          + ' 秒数=' + (payload.seconds === null ? '-' : payload.seconds), 'success');
                  } else {
                      addLog('[时间修改] 同步失败(代理层返回异常)', 'warning');
                  }
              })
              .catch(e => {
                  addLog('[时间修改] 同步失败：连不上本地服务(' + e.message + ')，确认代理已开启', 'warning');
              });
        } catch (e) {
            addLog('[时间修改] 同步异常：' + e.message, 'warning');
        }
    }

    function createDevPanel() {
        devPanel = document.createElement('div');
        devPanel.id = 'a366-dev-panel';
        devPanel.style.cssText = `
            display: none;
            position: fixed;
            bottom: 20px;
            left: 20px;
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
            display: none;
            flex-direction: column;
            overflow: hidden;
            ${CSS_VARS}
        `;

        devPanel.innerHTML = `
            <div id="a366-dev-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--a366-bg-secondary);border-radius:8px 8px 0 0;border-bottom:1px solid var(--a366-border);cursor:move;user-select:none;">
                <span style="font-weight:600;font-size:14px;color:var(--a366-info);"开发者面板</span>
                <button id="a366-dev-close" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:3px 8px;font-size:11px;cursor:pointer;">✕</button>
            </div>
            <div style="display:flex;border-bottom:1px solid var(--a366-border);background:var(--a366-bg-secondary);">
                <button class="a366-dev-tab active" data-tab="dev-search" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-primary);border-bottom:2px solid var(--a366-primary);transition:all 0.15s;">搜索测试</button>
                <button class="a366-dev-tab" data-tab="dev-answers" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-text-secondary);border-bottom:2px solid transparent;transition:all 0.15s;">答案列表</button>
            </div>
            <div id="a366-dev-body" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;">
                <div id="a366-dev-tab-search" style="padding:12px;display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;gap:6px;">
                        <input id="a366-search-input" type="text" placeholder="输入精确匹配的文本..." style="flex:1;padding:8px 10px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);background:var(--a366-bg);color:var(--a366-text);font-size:13px;outline:none;font-family:var(--a366-font);">
                        <button id="a366-search-btn" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">搜索</button>
                    </div>
                    <div style="font-size:11px;color:var(--a366-text-secondary);padding:2px 0;">匹配方式：文本精确 | 点击方式：原生 .click()</div>
                    <div id="a366-results" style="min-height:30px;max-height:200px;overflow-y:auto;border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:6px;background:var(--a366-bg);"></div>
                    <div id="a366-queue" style="min-height:30px;max-height:160px;overflow-y:auto;border:1px solid var(--a366-warning);border-radius:var(--a366-radius-md);padding:6px;background:var(--a366-bg);">
                        <div style="color:var(--a366-warning);font-size:11px;margin-bottom:4px;">待测试队列</div>
                        <div style="color:var(--a366-text-muted);text-align:center;padding:6px;font-size:11px;">队列为空</div>
                    </div>
                </div>
                <div id="a366-dev-tab-answers" style="padding:12px;display:none;flex-direction:column;gap:8px;">
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button id="a366-fetch-answers" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">获取答案</button>
                        <span id="a366-answer-status" style="font-size:11px;color:var(--a366-text-secondary);"></span>
                    </div>
                    <div id="a366-answer-info" style="font-size:11px;color:var(--a366-text-secondary);display:none;padding:6px 8px;background:var(--a366-primary-light);border-radius:var(--a366-radius-sm);border:1px solid var(--a366-primary);"></div>
                    <div id="a366-answer-list" style="flex:1;overflow-y:auto;max-height:320px;display:flex;flex-direction:column;gap:6px;">
                        <div style="color:var(--a366-text-muted);text-align:center;padding:20px;font-size:12px;">点击「获取答案」从本地服务器加载答案</div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(devPanel);

        inputEl = document.getElementById('a366-search-input');
        resultsContainer = document.getElementById('a366-results');
        answerListContainer = document.getElementById('a366-answer-list');

        document.getElementById('a366-dev-close').addEventListener('click', toggleDevPanel);
        document.getElementById('a366-search-btn').addEventListener('click', performSearch);
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') performSearch(); });
        document.getElementById('a366-fetch-answers').addEventListener('click', fetchAnswers);

        devPanel.querySelectorAll('.a366-dev-tab').forEach(tab => {
            tab.addEventListener('click', () => switchDevTab(tab.dataset.tab));
        });

        makeDraggable(devPanel, document.getElementById('a366-dev-header'));
    }

    // ==========================================
    // 面板切换
    // ==========================================

    function toggleDevPanel() {
        state.devPanelVisible = !state.devPanelVisible;
        devPanel.style.display = state.devPanelVisible ? 'flex' : 'none';
        if (state.devPanelVisible) {
            addLog('开发者面板已打开', 'info');
        }
    }

    function switchDevTab(tabName) {
        devPanel.querySelectorAll('.a366-dev-tab').forEach(t => {
            const isActive = t.dataset.tab === tabName;
            t.style.color = isActive ? 'var(--a366-primary)' : 'var(--a366-text-secondary)';
            t.style.borderBottom = isActive ? '2px solid var(--a366-primary)' : '2px solid transparent';
            t.style.fontWeight = isActive ? '500' : '400';
        });
        document.getElementById('a366-dev-tab-search').style.display = tabName === 'dev-search' ? 'flex' : 'none';
        document.getElementById('a366-dev-tab-answers').style.display = tabName === 'dev-answers' ? 'flex' : 'none';
    }

    function toggleCollapse() {
        const body = document.getElementById('a366-body');
        if (!body) return;
        state.collapsed = !state.collapsed;
        body.style.display = state.collapsed ? 'none' : 'flex';
        container.style.maxHeight = state.collapsed ? 'auto' : '480px';
    }

    // ==========================================
    // 主页填答状态
    // ==========================================

    function renderMainFillSection() {
        const fillStatus = document.getElementById('a366-fill-status');
        if (!fillStatus) return;

        const list = state.answerList;
        if (list.length === 0) {
            fillStatus.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;font-size:12px;">${state.answerError ? escapeHtml(state.answerError) : '未获取答案'}</div>`;
            document.getElementById('a366-auto-fill-all').style.display = 'none';
            document.getElementById('a366-stop-auto-fill').style.display = 'none';
            return;
        }

        // 状态显示只按真实执行状态，初始全为 pending；
        // 计划仅用于控制执行，不在获取答案/设置变更后预设显示。
        const filledCount = list.filter(a => a._fillStatus === 'filled').length;
        const skippedCount = list.filter(a => a._fillStatus === 'skipped').length;
        const correctCount = list.filter(a => a._fillStatus === 'filled' && a._fillMode !== 'wrong').length;
        const wrongCount = list.filter(a => a._fillStatus === 'filled' && a._fillMode === 'wrong').length;
        const pendingCount = list.filter(a => a._fillStatus !== 'filled' && a._fillStatus !== 'skipped').length;

        let badges = '';
        list.forEach((ans) => {
            const status = ans._fillStatus || 'pending';
            if (status === 'filled' && ans._fillMode === 'wrong') {
                badges += '<span style="color:var(--a366-danger);font-weight:600;">✗</span>';
            } else if (status === 'filled') {
                badges += '<span style="color:var(--a366-success);font-weight:600;">✓</span>';
            } else if (status === 'filling') {
                badges += '<span style="color:var(--a366-warning);font-weight:600;">●</span>';
            } else if (status === 'skipped') {
                badges += '<span style="color:var(--a366-text-muted);font-weight:600;">—</span>';
            } else {
                badges += '<span style="color:var(--a366-text-muted);">○</span>';
            }
        });

        fillStatus.innerHTML = `
            <div style="font-size:12px;color:var(--a366-text);margin-bottom:6px;">
                已获取 <b>${list.length}</b> 条答案 | 填答 <b style="color:var(--a366-success);">${filledCount}</b>/${list.length}${skippedCount > 0 ? ' | <span style="color:var(--a366-text-muted);">跳过 ' + skippedCount + '</span>' : ''}${wrongCount > 0 || correctCount > 0 ? ' | <span style="color:var(--a366-success);">答对 ' + correctCount + '</span> <span style="color:var(--a366-danger);">答错 ' + wrongCount + '</span>' : ''}${pendingCount > 0 ? ' | <span style="color:var(--a366-text-muted);">待填 ' + pendingCount + '</span>' : ''}
            </div>
            <div style="font-size:15px;letter-spacing:2px;word-break:break-all;line-height:1.8;">${badges}</div>
        `;

        const fillAllBtn = document.getElementById('a366-auto-fill-all');
        const stopBtn = document.getElementById('a366-stop-auto-fill');
        if (state.autoFillRunning) {
            fillAllBtn.style.display = 'none';
            stopBtn.style.display = '';
        } else {
            fillAllBtn.style.display = list.length > 0 ? '' : 'none';
            stopBtn.style.display = 'none';
        }
    }

    // ==========================================
    // 自动获取答案
    // ==========================================

    async function autoFetchAnswers() {
        addLog('正在自动获取答案...', 'info');
        await fetchAnswers();
    }

    // ==========================================
    // 搜索测试（开发者面板）
    // ==========================================

    function performSearch() {
        if (!inputEl) return;
        const keyword = inputEl.value.trim();
        if (!keyword) { addLog('请输入搜索内容', 'warn'); return; }

        addLog(`搜索: "${escapeHtml(keyword)}"（文本精确匹配）`, 'info');

        const allElements = document.querySelectorAll('body *');
        const matchedResults = [];

        allElements.forEach(el => {
            if (el === container || container.contains(el) || el.contains(container)) return;
            if (devPanel && (el === devPanel || devPanel.contains(el) || el.contains(devPanel))) return;
            try {
                if ((el.textContent || '').trim() === keyword) {
                    matchedResults.push(buildElementInfo(el, '文本精确匹配'));
                }
            } catch(e) {}
        });

        state.currentResults = matchedResults;

        if (matchedResults.length === 0) {
            addLog(`未找到文本精确匹配 "${escapeHtml(keyword)}" 的元素`, 'warn');
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
            if (resultsContainer) {
                resultsContainer.innerHTML = `<div style="color:var(--a366-warning);text-align:center;padding:12px;font-size:12px;">未找到提交按钮元素</div>`;
            }
            return;
        }

        addLog(`找到 ${submitBtns.length} 个 ${selectorName} 元素，准备点击`, 'success');

        submitBtns.forEach((el, i) => {
            el.style.outline = '3px solid var(--a366-success)';
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => { el.style.outline = ''; }, 1500);
            el.click();
            addLog(`${escapeHtml(selectorName)} #${i + 1} 已点击`, 'click');
        });
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
        if (!resultsContainer) return;
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
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

        addLog(`  标签: &lt;${escapeHtml(info.tag)}&gt;`, 'info');
        if (info.id) addLog(`  id: ${escapeHtml(info.id)}`, 'info');
        if (info.className) addLog(`  class: ${escapeHtml(info.className)}`, 'info');
        if (info.type) addLog(`  type: ${escapeHtml(info.type)}`, 'info');
        if (info.name) addLog(`  name: ${escapeHtml(info.name)}`, 'info');
        if (info.title) addLog(`  title: ${escapeHtml(info.title)}`, 'info');
        if (info.href) addLog(`  href: ${escapeHtml(info.href)}`, 'info');
        if (info.role) addLog(`  role: ${escapeHtml(info.role)}`, 'info');
        if (info.ariaLabel) addLog(`  aria-label: ${escapeHtml(info.ariaLabel)}`, 'info');
        addLog(`  可见: ${info.visible ? '是' : '否'} | 禁用: ${info.disabled ? '是' : '否'}`, 'info');
        addLog(`  尺寸: ${info.size} | 位置: ${info.position}`, 'info');
        if (info.zIndex) addLog(`  z-index: ${escapeHtml(info.zIndex)}`, 'info');

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
            addLog(`  关键样式: ${escapeHtml(styleParts.join('; '))}`, 'info');
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
            addLog(`  父级链(${parentChain.length}层): ${escapeHtml(parentChain.join(' -> '))}`, 'info');
        }

        addLog(`  子元素数: ${el.children.length}`, 'info');
        if (el.parentElement) {
            const siblings = Array.from(el.parentElement.children);
            const myIdx = siblings.indexOf(el);
            addLog(`  父级中第 ${myIdx + 1}/${siblings.length} 个子元素`, 'info');
        }

        addLog(`  CSS路径: ${escapeHtml(buildCSSPath(el))}`, 'info');
        addLog(`  XPath: ${escapeHtml(buildXPath(el))}`, 'info');
        addLog(`  匹配策略: ${escapeHtml(info.strategy)}`, 'info');
        addLog(`  innerHTML预览: ${escapeHtml((el.innerHTML || '').substring(0, 200))}`, 'info');
        addLog(`━━━━━━━━━━━━━━━━━━━━━━`, 'info');
    }

    // ==========================================
    // 测试队列（开发者面板）
    // ==========================================

    function addToQueue(resultIndex) {
        const info = state.currentResults[resultIndex];
        if (!info) return;
        state.testQueue.push(info);
        addLog(`元素 #${resultIndex + 1} (&lt;${escapeHtml(info.tag)}&gt;) 已加入测试队列 (队列共 ${state.testQueue.length} 项)`, 'queue');
        renderQueue();
    }

    function renderQueue() {
        const q = document.getElementById('a366-queue');
        if (!q) return;
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
                        ${tested ? `<span style="font-size:10px;color:${info._success ? 'var(--a366-success)' : 'var(--a366-danger)'};">${info._success ? '成功' : '失败'} ${escapeHtml(info._clickMethod || '')}</span>` : ''}
                        <button class="a366-test-one" data-queue="${i}" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">测试</button>
                        <button class="a366-remove-queue" data-queue="${i}" style="background:var(--a366-text-muted);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">x</button>
                    </span>
                </div>
                ${tested && info._log ? `<div style="color:var(--a366-text-secondary);font-size:10px;">${escapeHtml(info._log)}</div>` : ''}
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
                    addLog(`从队列移除: &lt;${escapeHtml(info.tag)}&gt; "${escapeHtml(info.text.substring(0, 30))}"`, 'info');
                    renderQueue();
                }
                e.stopPropagation();
            });
        });
    }

    // ==========================================
    // 测试执行
    // ==========================================

    function testAll() {
        return new Promise((resolve) => {
            addLog('开始逐个测试队列中的所有元素...', 'info');
            testNextInQueueWithResolve(0, resolve);
        });
    }

    function testNextInQueueWithResolve(index, resolve) {
        if (index >= state.testQueue.length) {
            addLog('队列中所有元素测试完毕', 'success');
            resolve();
            return;
        }
        testOne(index, () => {
            setTimeout(() => testNextInQueueWithResolve(index + 1, resolve), 400);
        });
    }

    function testOne(queueIndex, callback) {
        const info = state.testQueue[queueIndex];
        if (!info) { if (callback) callback(); return; }

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

        el.style.outline = '3px solid var(--a366-primary)';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
            let clicked = false;
            try {
                el.click();
                clicked = true;
                addLog(`队列 #${queueIndex + 1}: 原生.click() -> &lt;${escapeHtml(info.tag)}&gt; "${escapeHtml(info.text.substring(0, 40))}"`, 'click');
            } catch(e) {
                addLog(`队列 #${queueIndex + 1}: 原生.click() 异常: ${escapeHtml(e.message)}`, 'error');
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

    // ==========================================
    // 答案获取与列表（开发者面板）
    // ==========================================

    async function fetchAnswers() {
        const statusEl = document.getElementById('a366-answer-status');
        const fetchBtn = document.getElementById('a366-fetch-answers');
        if (statusEl) statusEl.textContent = '正在获取...';
        if (fetchBtn) fetchBtn.disabled = true;
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
            if (infoEl) {
                infoEl.style.display = 'block';
                infoEl.innerHTML = `原始答案 ${rawAnswers.length} 条 | 筛选「听后选择」${filtered.length} 条 | 端口: ${BUCKET_URL.replace('http://127.0.0.1:', '')}`;
            }

            if (filtered.length > 0) {
                addLog(`获取答案成功：${filtered.length} 条听后选择题`, 'success');
            } else {
                addLog(`获取到 ${rawAnswers.length} 条答案，但无听后选择题`, 'warn');
            }

            renderAnswerList();
            applyFillPlan();
            renderMainFillSection();
            if (statusEl) statusEl.textContent = '';

        } catch(e) {
            state.answerError = e.message;
            if (statusEl) statusEl.textContent = '';
            const isNetworkError = e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('fetch');
            if (isNetworkError) {
                addLog(`获取答案失败: 无法连接服务器，请确认代理服务器已启动`, 'error');
                if (answerListContainer) {
                    answerListContainer.innerHTML = `<div style="color:var(--a366-danger);text-align:center;padding:20px;font-size:12px;">无法连接服务器<br><span style="color:var(--a366-text-muted);">请确认主程序代理服务器已启动 (${escapeHtml(BUCKET_URL)})</span></div>`;
                }
            } else {
                addLog(`获取答案失败: ${escapeHtml(e.message)}`, 'error');
                if (answerListContainer) {
                    answerListContainer.innerHTML = `<div style="color:var(--a366-danger);text-align:center;padding:20px;font-size:12px;">${escapeHtml(e.message)}<br><span style="color:var(--a366-text-muted);">请在主程序中启动代理捕获答案后重试</span></div>`;
                }
            }
            renderMainFillSection();
        } finally {
            state.answerLoading = false;
            if (fetchBtn) fetchBtn.disabled = false;
        }
    }

    function renderAnswerList() {
        if (!answerListContainer) return;
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
            else if (fillStatus === 'filled' && ans._fillMode === 'wrong') statusBadge = `<span style="color:var(--a366-danger);font-size:10px;">故意错</span>`;
            else if (fillStatus === 'filled') statusBadge = `<span style="color:var(--a366-success);font-size:10px;">已填答</span>`;
            else if (fillStatus === 'skipped') statusBadge = `<span style="color:var(--a366-text-muted);font-size:10px;">已跳过</span>`;

            const borderLeft = fillStatus === 'filled' && ans._fillMode === 'wrong' ? 'border-left:3px solid var(--a366-danger);' : fillStatus === 'filled' ? 'border-left:3px solid var(--a366-success);' : fillStatus === 'skipped' ? 'border-left:3px solid var(--a366-text-muted);' : '';
            html += `
            <div style="border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:8px 10px;background:var(--a366-bg);${borderLeft}">
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
            addLog(`复制失败: ${escapeHtml(e.message)}`, 'error');
        }
    }

    // ==========================================
    // 填答逻辑
    // ==========================================

    function fillOneAnswer(idx, forceWrong = false) {
        const ans = state.answerList[idx];
        if (!ans) return;

        ans._fillStatus = 'filling';
        renderAnswerList();
        renderMainFillSection();

        const answerText = ans.answer || '';
        const dotIndex = answerText.indexOf('.');
        const optionId = dotIndex > 0 ? answerText.substring(0, dotIndex).trim() : '';
        const optionContent = dotIndex >= 0 ? answerText.substring(dotIndex + 1).trim() : answerText.trim();

        if (forceWrong) {
            addLog(`开始填答 #${idx + 1}（故意选错）: ${escapeHtml((ans.questionText || '').substring(0, 40))}`, 'info');
            addLog(`  正确答案: "${escapeHtml(optionContent)}"`, 'info');

            const found = findAndClickWrongOption(optionId, optionContent, ans);
            if (found) {
                ans._fillStatus = 'filled';
                ans._fillMode = 'wrong';
                addLog(`#${idx + 1} 已选择错误选项`, 'success');
            } else {
                ans._fillStatus = 'skipped';
                addLog(`#${idx + 1} 选择错误选项失败，已跳过`, 'warn');
            }
        } else {
            addLog(`开始填答 #${idx + 1}: ${escapeHtml((ans.questionText || '').substring(0, 40))}`, 'info');
            addLog(`  匹配文本: "${escapeHtml(optionContent)}"`, 'info');

            const found = findAndClickOption(optionId, optionContent, ans);
            if (found) {
                ans._fillStatus = 'filled';
                ans._fillMode = 'correct';
                addLog(`#${idx + 1} 填答成功`, 'success');
            } else {
                ans._fillStatus = 'skipped';
                addLog(`#${idx + 1} 未找到匹配选项，已跳过`, 'warn');
            }
        }
        renderAnswerList();
        renderMainFillSection();
    }

    function findAndClickOption(optionId, optionContent, answerObj) {
        const pageWrap = document.getElementById('page-wrap');
        const scope = pageWrap || document.body;
        const normalizedAnswer = normalizeText(optionContent);

        // 策略1：通过选项类名选择器精确匹配
        const optionSelectors = [
            '.option-item', '.option', '.choice-item', '.choice', '.answer-item', '.answer',
            '.question-option', '.exam-option', '.select-option', '.item-option'
        ];
        for (const selector of optionSelectors) {
            const items = scope.querySelectorAll(selector);
            for (const item of items) {
                if (isForeignElement(item)) continue;
                if (normalizeText(item.textContent) === normalizedAnswer) {
                    addLog(`  通过选项选择器 ${selector} 匹配点击`, 'click');
                    item.style.outline = '3px solid var(--a366-success)';
                    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => { item.style.outline = ''; }, 1500);
                    item.click();
                    return true;
                }
            }
        }

        // 策略2：全局文本搜索兜底
        const allElements = scope.querySelectorAll('*');
        const candidates = [];
        for (const el of allElements) {
            if (isForeignElement(el)) continue;
            try {
                const text = (el.textContent || '').trim();
                if (normalizeText(text) === normalizedAnswer) {
                    const tag = el.tagName.toLowerCase();
                    if (['div', 'span', 'li', 'label', 'button', 'a', 'p'].includes(tag)) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            candidates.push({ element: el, height: Math.round(rect.height) });
                        }
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
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { target.style.outline = ''; }, 1500);
        target.click();
        return true;
    }

    function findAndClickWrongOption(optionId, optionContent, answerObj) {
        const pageWrap = document.getElementById('page-wrap');
        const scope = pageWrap || document.body;
        const normalizedAnswer = normalizeText(optionContent);
        const optionSelectors = [
            '.option-item', '.option', '.choice-item', '.choice', '.answer-item', '.answer',
            '.question-option', '.exam-option', '.select-option', '.item-option'
        ];

        // 辅助：找元素内最合适的点击目标（radio/checkbox 优先，避免只点到字母标签）
        function getClickTarget(el) {
            if (!el) return null;
            const input = el.querySelector('input[type="radio"], input[type="checkbox"]');
            if (input) return input;
            const text = (el.textContent || '').trim();
            // 如果当前元素文本只是选项字母（如 "A" / "A."），向上找到完整选项元素
            if (/^[A-Da-d](\.|\))?$/.test(text)) {
                let parent = el.parentElement;
                while (parent && parent !== document.body) {
                    const parentInput = parent.querySelector('input[type="radio"], input[type="checkbox"]');
                    if (parentInput) return parentInput;
                    const parentText = (parent.textContent || '').trim();
                    if (isOptionElement(parent) && parentText.length > text.length + 1) {
                        return parent;
                    }
                    parent = parent.parentElement;
                }
            }
            return el;
        }

        // 辅助：判断元素是否属于选项元素
        function isOptionElement(el) {
            return optionSelectors.some(sel => el.matches && el.matches(sel));
        }

        // 辅助：向上找到完整选项元素（含 input 或文本包含当前元素且更长的选项祖先）
        function findOptionRoot(el) {
            // 方法1：找包含 input 的最小祖先
            let current = el;
            while (current && current !== document.body) {
                if (current.querySelector('input[type="radio"], input[type="checkbox"]')) {
                    return current;
                }
                current = current.parentElement;
            }

            // 方法2：向上找到文本包含 el.textContent 且更长、并匹配选项选择器的祖先
            let best = el;
            let bestText = (el.textContent || '').trim();
            let parent = el.parentElement;
            while (parent && parent !== document.body) {
                const parentText = (parent.textContent || '').trim();
                if (parentText.length > bestText.length && parentText.includes(bestText)) {
                    if (isOptionElement(parent)) {
                        best = parent;
                        bestText = parentText;
                    }
                }
                parent = parent.parentElement;
            }
            return best;
        }

        // ===== 第一步：定位文本匹配的元素 =====
        let textMatchEl = null;
        for (const selector of optionSelectors) {
            const items = scope.querySelectorAll(selector);
            for (const item of items) {
                if (isForeignElement(item)) continue;
                if (normalizeText(item.textContent) === normalizedAnswer) {
                    textMatchEl = item;
                    break;
                }
            }
            if (textMatchEl) break;
        }

        // 兜底：全局文本搜索
        if (!textMatchEl) {
            const allElements = scope.querySelectorAll('*');
            const correctCandidates = [];
            for (const el of allElements) {
                if (isForeignElement(el)) continue;
                const text = (el.textContent || '').trim();
                if (normalizeText(text) === normalizedAnswer) {
                    const tag = el.tagName.toLowerCase();
                    if (['div', 'span', 'li', 'label', 'button', 'a', 'p'].includes(tag)) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            correctCandidates.push(el);
                        }
                    }
                }
            }
            if (correctCandidates.length === 0) {
                addLog('  未找到正确选项元素，无法选择错误选项', 'warn');
                return false;
            }
            const height24 = correctCandidates.filter(c => Math.round(c.getBoundingClientRect().height) === 24);
            textMatchEl = height24.length > 0 ? height24[0] : correctCandidates.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
        }

        // ===== 第二步：将文本元素提升为完整选项元素 =====
        const correctOption = findOptionRoot(textMatchEl);
        addLog('  定位到正确答案选项元素', 'info');

        const correctRect = correctOption.getBoundingClientRect();
        const correctTag = correctOption.tagName;
        const correctHeight = Math.round(correctRect.height);
        const correctInput = correctOption.querySelector('input[type="radio"], input[type="checkbox"]');

        // ===== 第三步：收集同一道题目的其他选项元素 =====
        let wrongCandidates = [];

        // 策略 A：如果正确选项内部有 input，找同一选项组（同一父容器）内其他含 input 的兄弟
        if (correctInput) {
            let groupContainer = correctOption.parentElement;
            for (let i = 0; i < 4 && groupContainer; i++) {
                const siblings = Array.from(groupContainer.children).filter(child => {
                    if (child === correctOption || correctOption.contains(child) || child.contains(correctOption)) return false;
                    if (isForeignElement(child)) return false;
                    const input = child.querySelector('input[type="radio"], input[type="checkbox"]');
                    if (!input) return false;
                    const text = (child.textContent || '').trim();
                    if (text.length === 0) return false;
                    if (normalizeText(text) === normalizedAnswer) return false;
                    return true;
                });
                if (siblings.length > 0) {
                    wrongCandidates = siblings.map(el => {
                        const rect = el.getBoundingClientRect();
                        return {
                            element: el,
                            source: 'input-sibling',
                            hasInput: true,
                            distance: Math.abs(rect.top - correctRect.top) + Math.abs(rect.left - correctRect.left) * 0.3
                        };
                    });
                    addLog(`  通过 input 兄弟找到 ${siblings.length} 个其他选项`, 'info');
                    break;
                }
                groupContainer = groupContainer.parentElement;
            }
        }

        // 策略 B：在所有匹配选项选择器的元素中，按与正确答案的位置接近程度筛选
        if (wrongCandidates.length === 0) {
            let allOptions = [];
            for (const selector of optionSelectors) {
                scope.querySelectorAll(selector).forEach(el => {
                    if (!isForeignElement(el) && !allOptions.includes(el)) allOptions.push(el);
                });
            }

            wrongCandidates = allOptions
                .filter(el => {
                    if (el === correctOption || el.contains(correctOption) || correctOption.contains(el)) return false;
                    const text = (el.textContent || '').trim();
                    if (text.length === 0) return false;
                    if (normalizeText(text) === normalizedAnswer) return false;
                    const rect = el.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) return false;
                    const horizontalOverlap = rect.left < correctRect.right && rect.right > correctRect.left;
                    const verticalDist = Math.abs(rect.top - correctRect.top);
                    return horizontalOverlap && verticalDist < 250;
                })
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    return {
                        element: el,
                        source: 'option-list',
                        hasInput: !!el.querySelector('input[type="radio"], input[type="checkbox"]'),
                        distance: Math.abs(rect.top - correctRect.top) + Math.abs(rect.left - correctRect.left) * 0.3
                    };
                });

            if (wrongCandidates.length > 0) {
                addLog(`  从候选选项中筛选出 ${wrongCandidates.length} 个同题错误选项`, 'info');
            }
        }

        // 策略 C：基于 DOM 兄弟结构兜底（child 必须是完整选项元素）
        if (wrongCandidates.length === 0) {
            let parent = correctOption.parentElement;
            for (let i = 0; i < 4 && parent; i++) {
                const children = Array.from(parent.children);
                const others = children.filter(child => {
                    if (child === correctOption || correctOption.contains(child) || child.contains(correctOption)) return false;
                    if (isForeignElement(child)) return false;
                    const rect = child.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) return false;
                    const text = (child.textContent || '').trim();
                    if (text.length === 0) return false;
                    if (normalizeText(text) === normalizedAnswer) return false;
                    // 必须是完整选项元素：匹配选项选择器 或 包含 input
                    const isValidOption = isOptionElement(child) || child.querySelector('input[type="radio"], input[type="checkbox"]');
                    if (!isValidOption) return false;
                    return true;
                });
                if (others.length > 0) {
                    wrongCandidates = others.map(el => {
                        const rect = el.getBoundingClientRect();
                        return {
                            element: el,
                            source: 'sibling',
                            hasInput: !!el.querySelector('input[type="radio"], input[type="checkbox"]'),
                            distance: Math.abs(rect.top - correctRect.top) + Math.abs(rect.left - correctRect.left) * 0.3
                        };
                    });
                    addLog(`  通过兄弟结构找到 ${others.length} 个其他选项`, 'info');
                    break;
                }
                parent = parent.parentElement;
            }
        }

        // 策略 D：全局外观相似性兜底
        if (wrongCandidates.length === 0) {
            const allElements = scope.querySelectorAll('*');
            for (const el of allElements) {
                if (isForeignElement(el)) continue;
                if (el === correctOption || el.contains(correctOption) || correctOption.contains(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                const text = (el.textContent || '').trim();
                if (text.length === 0) continue;
                if (normalizeText(text) === normalizedAnswer) continue;

                const tag = el.tagName;
                if (tag !== correctTag && !['DIV', 'SPAN', 'LI', 'LABEL', 'BUTTON', 'A', 'P'].includes(tag)) continue;

                const heightDiff = Math.abs(Math.round(rect.height) - correctHeight);
                const hasOptionClass = optionSelectors.some(sel => el.matches && el.matches(sel));
                if (heightDiff > 8 && !hasOptionClass) continue;

                const horizontalOverlap = rect.left < correctRect.right && rect.right > correctRect.left;
                const verticalDist = Math.abs(rect.top - correctRect.top);
                if (!horizontalOverlap && verticalDist > 80) continue;
                if (verticalDist > 200) continue;

                wrongCandidates.push({
                    element: el,
                    source: 'similar',
                    hasInput: !!el.querySelector('input[type="radio"], input[type="checkbox"]'),
                    distance: verticalDist + Math.abs(rect.left - correctRect.left) * 0.3
                });
            }
            if (wrongCandidates.length > 0) {
                addLog(`  通过全局相似性找到 ${wrongCandidates.length} 个候选`, 'info');
            }
        }

        if (wrongCandidates.length === 0) {
            addLog('  未找到与正确选项相似的其他选项', 'warn');
            return false;
        }

        // 排序：优先含 input，再按 source 优先级，最后按距离
        const srcRank = { 'input-sibling': 0, 'option-list': 1, 'sibling': 2, 'similar': 3 };
        wrongCandidates.sort((a, b) => {
            if (a.hasInput && !b.hasInput) return -1;
            if (!a.hasInput && b.hasInput) return 1;
            if (srcRank[a.source] !== srcRank[b.source]) return srcRank[a.source] - srcRank[b.source];
            return a.distance - b.distance;
        });

        // 在最近的 1-3 个里随机选一个
        const poolSize = Math.min(3, wrongCandidates.length);
        const picked = wrongCandidates[Math.floor(Math.random() * poolSize)];
        const targetEl = picked.element;
        const clickTarget = getClickTarget(targetEl);
        const targetText = (targetEl.textContent || '').trim().substring(0, 30);
        addLog(`  选择错误选项: "${escapeHtml(targetText)}"`, 'click');

        targetEl.style.outline = '3px solid var(--a366-danger)';
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { targetEl.style.outline = ''; }, 1500);
        if (clickTarget && clickTarget !== targetEl) {
            addLog('  通过内部 input 触发选择', 'info');
        }
        clickTarget.click();
        return true;
    }

    function isForeignElement(el) {
        if (!el) return true;
        if (el === container || container.contains(el) || el.contains(container)) return true;
        if (devPanel && (el === devPanel || devPanel.contains(el) || el.contains(devPanel))) return true;
        return false;
    }

    function normalizeText(str) {
        return String(str || '')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ==========================================
    // 自动填答
    // ==========================================

    // 统一计算填答计划：哪些跳过、哪些答错，仅保证数量与设置一致，题号随机分布
    function buildFillPlan(total, completionRate, accuracyRate) {
        const totalNum = Math.max(0, parseInt(total) || 0);
        const compNum = Math.max(0, Math.min(100, parseInt(completionRate) || 0));
        const accNum = Math.max(0, Math.min(100, parseInt(accuracyRate) || 0));

        const fillCount = Math.max(0, Math.ceil(totalNum * compNum / 100));
        const skipCount = totalNum - fillCount;
        const correctCount = fillCount > 0 ? Math.max(0, Math.ceil(fillCount * accNum / 100)) : 0;
        const wrongCount = fillCount - correctCount;

        // 随机打乱所有题目索引
        const indices = Array.from({ length: totalNum }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        // 前 skipCount 个 → 跳过
        const skipSet = new Set(skipCount > 0 ? indices.slice(0, skipCount) : []);

        // 剩余的 → 填答，其中前 wrongCount 个 → 答错
        const fillIndices = indices.slice(skipCount);
        const wrongSet = new Set(wrongCount > 0 ? fillIndices.slice(0, wrongCount) : []);

        return { skipSet, wrongSet, fillCount, skipCount, correctCount, wrongCount };
    }

    // 根据当前答案列表和设置重新生成/同步填答计划，并预置每道题的期望状态
    function applyFillPlan() {
        const total = state.answerList.length;
        if (total === 0) {
            state._fillPlan = null;
            state._skipIndices = null;
            state._wrongIndices = null;
            return;
        }
        const plan = buildFillPlan(total, state.completionRate, state.accuracyRate);
        state._fillPlan = plan;
        state._skipIndices = plan.skipSet;
        state._wrongIndices = plan.wrongSet;

        // 重置所有答案的执行状态为 pending，避免旧数据干扰
        state.answerList.forEach(ans => {
            ans._fillStatus = 'pending';
            delete ans._fillMode;
        });

        addLog(`[计划] 完成率 ${state.completionRate}% / 正确率 ${state.accuracyRate}% | 跳过索引 [${Array.from(plan.skipSet).map(i => i + 1).join(',')}] | 答错索引 [${Array.from(plan.wrongSet).map(i => i + 1).join(',')}]`, 'info');
    }

    function startAutoFillAll() {
        if (state.answerList.length === 0) return;
        if (state.autoFillRunning) {
            addLog('自动填答已在运行，忽略重复启动', 'warn');
            return;
        }

        // 每次开始前重新同步计划，确保与当前设置和答案列表完全一致
        applyFillPlan();

        state.autoFillRunning = true;
        state.autoFillIndex = 0;

        const total = state.answerList.length;
        const plan = state._fillPlan;

        addLog(`开始一键自动填答，共 ${total} 题（完成率 ${state.completionRate}%：填答 ${plan.fillCount} 题，跳过 ${plan.skipCount} 题 | 正确率 ${state.accuracyRate}%：答对 ${plan.correctCount} 题，答错 ${plan.wrongCount} 题）`, 'info');

        document.getElementById('a366-auto-fill-all').style.display = 'none';
        document.getElementById('a366-stop-auto-fill').style.display = '';

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
        const isSkip = state._skipIndices && state._skipIndices.has(idx);
        const isWrong = state._wrongIndices && state._wrongIndices.has(idx);
        addLog(`[执行] #${idx + 1} 跳过=${isSkip} 故意错=${isWrong}`, 'info');

        // 完成率 < 100% 时跳过部分题目
        if (isSkip) {
            state.answerList[idx]._fillStatus = 'skipped';
            addLog(`#${idx + 1} 已跳过（完成率控制）`, 'info');
            state.autoFillIndex++;
            renderAnswerList();
            renderMainFillSection();
            setTimeout(() => autoFillNext(), 20);
            return;
        }
        fillOneAnswer(idx, isWrong);
        state.autoFillIndex++;
        setTimeout(() => autoFillNext(), 50);
    }

    function stopAutoFill() {
        state.autoFillRunning = false;
        document.getElementById('a366-auto-fill-all').style.display = '';
        document.getElementById('a366-stop-auto-fill').style.display = 'none';
        renderMainFillSection();
        addLog('自动填答已停止', 'warn');
    }

    // ==========================================
    // 交卷与自动流程
    // ==========================================

    function clickStartBtn() {
        let btn = document.querySelector('.start-btn-text');
        if (btn) {
            btn.click();
            return true;
        }
        const allElements = document.querySelectorAll('button, span, div, a');
        for (const el of allElements) {
            if (el === container || container.contains(el)) continue;
            if (devPanel && (el === devPanel || devPanel.contains(el))) continue;
            const text = (el.textContent || '').trim();
            if (text === '去做题') {
                el.click();
                return true;
            }
        }

        return false;
    }

    function clickConfirmSubmitBtn() {
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
        if (state.autoFillRunning) {
            addLog('自动流程已在运行，忽略重复启动', 'warn');
            return;
        }

        addLog('━━━━━━━━ 自动流程开始 ━━━━━━━', 'info');

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

        document.getElementById('a366-auto-fill-all').style.display = 'none';
        document.getElementById('a366-stop-auto-fill').style.display = '';

        await new Promise((resolve) => {
            state.autoFillRunning = true;
            state.autoFillIndex = 0;

            const total = state.answerList.length;
            applyFillPlan();
            const plan = state._fillPlan;

            addLog(`开始自动填答，共 ${total} 题（完成率 ${state.completionRate}%：填答 ${plan.fillCount} 题，跳过 ${plan.skipCount} 题 | 正确率 ${state.accuracyRate}%：答对 ${plan.correctCount} 题，答错 ${plan.wrongCount} 题）`, 'info');

            function checkFillComplete() {
                if (!state.autoFillRunning || state.autoFillIndex >= state.answerList.length) {
                    state.autoFillRunning = false;
                    document.getElementById('a366-auto-fill-all').style.display = '';
                    document.getElementById('a366-stop-auto-fill').style.display = 'none';
                    addLog('自动填答完毕', 'success');
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

        addLog('等待交卷确认弹窗...', 'info');
        const confirmed = await waitAndClickConfirmSubmit(5000);
        if (confirmed) {
            addLog('已点击确认交卷按钮', 'success');
        } else {
            addLog('未检测到交卷确认弹窗', 'warn');
        }

        addLog('━━━━━━━━ 自动流程结束 ━━━━━━━━', 'info');
    }

    // ==========================================
    // 日志
    // ==========================================

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

    // ==========================================
    // 正确率设置
    // ==========================================

    function restoreAccuracyRate() {
        try {
            const val = localStorage.getItem('a366_accuracy_rate');
            if (val !== null) {
                const rate = parseInt(val);
                if (!isNaN(rate) && rate >= 0 && rate <= 100) {
                    state.accuracyRate = rate;
                }
            }
        } catch(e) {}
        try {
            const val = localStorage.getItem('a366_completion_rate');
            if (val !== null) {
                const rate = parseInt(val);
                if (!isNaN(rate) && rate >= 0 && rate <= 100) {
                    state.completionRate = rate;
                }
            }
        } catch(e) {}
    }

    function saveAccuracyRate(rate) {
        state.accuracyRate = rate;
        try {
            localStorage.setItem('a366_accuracy_rate', rate.toString());
        } catch(e) {}
    }

    function saveCompletionRate(rate) {
        state.completionRate = rate;
        try {
            localStorage.setItem('a366_completion_rate', rate.toString());
        } catch(e) {}
    }

    function createAccuracyModal() {
        restoreAccuracyRate();

        const modal = document.createElement('div');
        modal.id = 'a366-accuracy-modal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1000001;
            background: rgba(0,0,0,0.5);
            font-family: var(--a366-font, sans-serif);
        `;

        modal.innerHTML = `
            <div id="a366-accuracy-panel" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#ffffff;border-radius:8px;border:1px solid #dee2e6;box-shadow:0 8px 32px rgba(0,0,0,0.2);width:400px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f8f9fa;border-bottom:1px solid #dee2e6;">
                    <span style="font-weight:600;font-size:14px;color:#212529;">填答设置</span>
                    <button id="a366-accuracy-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#6c757d;padding:0 4px;line-height:1;">✕</button>
                </div>
                <div style="padding:16px;display:flex;flex-direction:column;gap:14px;">
                    <div>
                        <div style="font-size:12px;color:#6c757d;margin-bottom:8px;">完成率 — 填答的题目占总题数的比例</div>
                        <div style="display:flex;gap:8px;">
                            <button class="a366-completion-quick" data-rate="60" style="flex:1;min-width:0;box-sizing:border-box;padding:10px 4px;background:#e9ecef;color:#212529;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:all 0.15s;text-align:center;">60%</button>
                            <button class="a366-completion-quick" data-rate="80" style="flex:1;min-width:0;box-sizing:border-box;padding:10px 4px;background:#e9ecef;color:#212529;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:all 0.15s;text-align:center;">80%</button>
                            <button class="a366-completion-quick" data-rate="90" style="flex:1;min-width:0;box-sizing:border-box;padding:10px 4px;background:#e9ecef;color:#212529;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:all 0.15s;text-align:center;">90%</button>
                            <button class="a366-completion-quick" data-rate="100" style="flex:1;min-width:0;box-sizing:border-box;padding:10px 4px;background:#e9ecef;color:#212529;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:all 0.15s;text-align:center;">100%</button>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                            <input id="a366-completion-input" type="number" min="0" max="100" value="${state.completionRate}" style="flex:1;padding:8px 10px;border:1px solid #dee2e6;border-radius:6px;background:#ffffff;color:#212529;font-size:13px;outline:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;text-align:center;box-sizing:border-box;">
                            <span style="font-size:14px;color:#6c757d;font-weight:500;">%</span>
                        </div>
                    </div>
                    <div style="border-top:1px solid #dee2e6;padding-top:14px;">
                        <div style="font-size:12px;color:#6c757d;margin-bottom:8px;">正确率 — 已填答题中答对的比例</div>
                        <div style="display:flex;gap:8px;">
                            <button class="a366-accuracy-quick" data-rate="70" style="flex:1;min-width:0;box-sizing:border-box;padding:10px 4px;background:#e9ecef;color:#212529;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:all 0.15s;text-align:center;">70%</button>
                            <button class="a366-accuracy-quick" data-rate="80" style="flex:1;min-width:0;box-sizing:border-box;padding:10px 4px;background:#e9ecef;color:#212529;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:all 0.15s;text-align:center;">80%</button>
                            <button class="a366-accuracy-quick" data-rate="90" style="flex:1;min-width:0;box-sizing:border-box;padding:10px 4px;background:#e9ecef;color:#212529;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:all 0.15s;text-align:center;">90%</button>
                            <button class="a366-accuracy-quick" data-rate="100" style="flex:1;min-width:0;box-sizing:border-box;padding:10px 4px;background:#e9ecef;color:#212529;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:all 0.15s;text-align:center;">100%</button>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                            <input id="a366-accuracy-input" type="number" min="0" max="100" value="${state.accuracyRate}" style="flex:1;padding:8px 10px;border:1px solid #dee2e6;border-radius:6px;background:#ffffff;color:#212529;font-size:13px;outline:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;text-align:center;box-sizing:border-box;">
                            <span style="font-size:14px;color:#6c757d;font-weight:500;">%</span>
                        </div>
                    </div>
                    <div id="a366-accuracy-preview" style="font-size:11px;color:#6c757d;padding:8px 10px;background:#e9ecef;border-radius:4px;line-height:1.6;">
                        完成率：${state.completionRate}% | 正确率：${state.accuracyRate}%<br>
                        <span style="color:#17a2b8;">获取答案后将自动计算填答/跳过/正确/错误题数</span>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button id="a366-accuracy-cancel" style="padding:8px 20px;background:#e9ecef;color:#6c757d;border:1px solid #dee2e6;border-radius:6px;font-size:13px;cursor:pointer;">取消</button>
                        <button id="a366-accuracy-save" style="padding:8px 20px;background:#007bff;color:#ffffff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;">确定</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const completionInput = document.getElementById('a366-completion-input');
        const accuracyInput = document.getElementById('a366-accuracy-input');

        // 完成率快捷按钮
        const completionQuickBtns = modal.querySelectorAll('.a366-completion-quick');
        completionQuickBtns.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#e7f1ff';
                btn.style.borderColor = '#007bff';
                btn.style.color = '#007bff';
            });
            btn.addEventListener('mouseleave', () => {
                if (parseInt(completionInput.value) !== parseInt(btn.dataset.rate)) {
                    btn.style.background = '#e9ecef';
                    btn.style.borderColor = '#dee2e6';
                    btn.style.color = '#212529';
                }
            });
            btn.addEventListener('click', () => {
                const rate = parseInt(btn.dataset.rate);
                completionInput.value = rate;
                updateAccuracyPreview(parseInt(completionInput.value), parseInt(accuracyInput.value));
                highlightCompletionBtn(rate);
            });
        });

        // 正确率快捷按钮
        const quickBtns = modal.querySelectorAll('.a366-accuracy-quick');
        quickBtns.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#e7f1ff';
                btn.style.borderColor = '#007bff';
                btn.style.color = '#007bff';
            });
            btn.addEventListener('mouseleave', () => {
                if (parseInt(accuracyInput.value) !== parseInt(btn.dataset.rate)) {
                    btn.style.background = '#e9ecef';
                    btn.style.borderColor = '#dee2e6';
                    btn.style.color = '#212529';
                }
            });
            btn.addEventListener('click', () => {
                const rate = parseInt(btn.dataset.rate);
                accuracyInput.value = rate;
                updateAccuracyPreview(parseInt(completionInput.value), rate);
                highlightQuickBtn(rate);
            });
        });

        completionInput.addEventListener('input', () => {
            let val = parseInt(completionInput.value);
            if (isNaN(val)) val = 100;
            val = Math.max(0, Math.min(100, val));
            updateAccuracyPreview(val, parseInt(accuracyInput.value));
            highlightCompletionBtn(val);
        });

        accuracyInput.addEventListener('input', () => {
            let val = parseInt(accuracyInput.value);
            if (isNaN(val)) val = 100;
            val = Math.max(0, Math.min(100, val));
            updateAccuracyPreview(parseInt(completionInput.value), val);
            highlightQuickBtn(val);
        });

        document.getElementById('a366-accuracy-close').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        document.getElementById('a366-accuracy-cancel').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        document.getElementById('a366-accuracy-save').addEventListener('click', () => {
            let compVal = parseInt(completionInput.value);
            if (isNaN(compVal)) compVal = 100;
            compVal = Math.max(0, Math.min(100, compVal));
            let accVal = parseInt(accuracyInput.value);
            if (isNaN(accVal)) accVal = 100;
            accVal = Math.max(0, Math.min(100, accVal));
            saveCompletionRate(compVal);
            saveAccuracyRate(accVal);
            applyFillPlan();
            renderMainFillSection();
            modal.style.display = 'none';
            addLog(`设置已更新：完成率 ${compVal}% | 正确率 ${accVal}%`, 'success');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });

        highlightCompletionBtn(state.completionRate);
        highlightQuickBtn(state.accuracyRate);
    }

    function updateAccuracyPreview(completionRate, accuracyRate) {
        const preview = document.getElementById('a366-accuracy-preview');
        if (!preview) return;
        const total = state.answerList.length;
        if (total === 0) {
            preview.innerHTML = `完成率：${completionRate}% | 正确率：${accuracyRate}%<br><span style="color:#17a2b8;">获取答案后将自动计算填答/跳过/正确/错误题数</span>`;
        } else {
            const plan = buildFillPlan(total, completionRate, accuracyRate);
            preview.innerHTML = `完成率：${completionRate}% | 正确率：${accuracyRate}%<br>总题数：${total} 题<br>填答：<span style="color:#007bff;">${plan.fillCount} 题</span> | 跳过：<span style="color:#6c757d;">${Math.max(0, plan.skipCount)} 题</span><br>答对：<span style="color:#28a745;">${plan.correctCount} 题</span> | 答错：<span style="color:#dc3545;">${plan.wrongCount} 题</span>`;
        }
    }

    function highlightQuickBtn(activeRate) {
        const quickBtns = document.querySelectorAll('.a366-accuracy-quick');
        quickBtns.forEach(btn => {
            const rate = parseInt(btn.dataset.rate);
            if (rate === activeRate) {
                btn.style.background = '#007bff';
                btn.style.borderColor = '#007bff';
                btn.style.color = '#ffffff';
            } else {
                btn.style.background = '#e9ecef';
                btn.style.borderColor = '#dee2e6';
                btn.style.color = '#212529';
            }
        });
    }

    function highlightCompletionBtn(activeRate) {
        const quickBtns = document.querySelectorAll('.a366-completion-quick');
        quickBtns.forEach(btn => {
            const rate = parseInt(btn.dataset.rate);
            if (rate === activeRate) {
                btn.style.background = '#007bff';
                btn.style.borderColor = '#007bff';
                btn.style.color = '#ffffff';
            } else {
                btn.style.background = '#e9ecef';
                btn.style.borderColor = '#dee2e6';
                btn.style.color = '#212529';
            }
        });
    }

    function toggleAccuracySettings() {
        const modal = document.getElementById('a366-accuracy-modal');
        if (!modal) return;
        const isVisible = modal.style.display !== 'none';
        if (isVisible) {
            modal.style.display = 'none';
        } else {
            const completionInput = document.getElementById('a366-completion-input');
            const accuracyInput = document.getElementById('a366-accuracy-input');
            if (completionInput) completionInput.value = state.completionRate;
            if (accuracyInput) accuracyInput.value = state.accuracyRate;
            updateAccuracyPreview(state.completionRate, state.accuracyRate);
            highlightCompletionBtn(state.completionRate);
            highlightQuickBtn(state.accuracyRate);
            modal.style.display = 'block';
        }
    }

    // ==========================================
    // 工具函数
    // ==========================================

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

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ==========================================
    // 初始化
    // ==========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
