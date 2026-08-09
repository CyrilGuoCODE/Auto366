// ==UserScript==
// @name         自动基础听力RC
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  重建算法驱动的自动填答，开发者面板支持搜索测试与控分设置
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // bucket 端口用户可以改；代理层在注入脚本时把真实地址写进 window.__A366__。
    // 不能读 localStorage —— 注入脚本跑在 up366 页面的 origin 下，
    // 跟主程序窗口不是同一个存储区。
    const BUCKET_URL = (window.__A366__ && window.__A366__.bucket) || 'http://127.0.0.1:5290';
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
        targetWrongCount: 0,
        fullDisplay: false,
        rebuildResults: [],
        // 听力时间修改
        listenTimeEnabled: localStorage.getItem('a366_listentime_enabled') === 'true',
        listenTimeSeconds: (function() {
            var raw = localStorage.getItem('a366_listentime_seconds');
            if (raw === null || raw === '') return null;
            var v = parseInt(raw, 10);
            return Number.isFinite(v) ? v : null;
        })(),
        presetListenTimeSeconds: null, // 预设计算值（参考值）
    };

    let container = null;
    let devPanel = null;
    let inputEl = null;
    let resultsContainer = null;
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
                <span style="font-weight:600;font-size:14px;color:var(--a366-primary);">自动基础听力RC</span>
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
                        <button id="a366-jiaojuan-btn" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">交卷</button>
                        <button id="a366-auto-btn" style="background:var(--a366-info);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 12px;font-size:13px;cursor:pointer;font-weight:500;">自动听力</button>
                        <button id="a366-score-btn" style="background:#17a2b8;color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 12px;font-size:13px;cursor:pointer;font-weight:500;">控分</button>
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
                <button id="a366-listentime-restore" style="background:var(--a366-info);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:3px 8px;font-size:11px;cursor:pointer;margin-left:4px;" title="恢复为计算值">参考</button>
            </div>
            <div style="border-top:1px solid var(--a366-border);background:var(--a366-bg-secondary);display:flex;flex-direction:column;flex-shrink:0;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px;">
                    <span style="font-size:11px;font-weight:500;color:var(--a366-text-secondary);">操作日志</span>
                    <button id="a366-log-clear" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">清空</button>
                </div>
                <div id="a366-log-content" style="height:120px;overflow-y:auto;padding:4px 10px 6px;font-size:11px;font-family:'Consolas','Courier New','PingFang SC',monospace;background:var(--a366-bg);">
                    <div style="color:var(--a366-success);">自动基础听力RC 已就绪</div>
                    <div style="color:var(--a366-text-secondary);">填答 | 交卷 | 自动</div>
                </div>
            </div>
        `;

        document.body.appendChild(container);
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
        document.getElementById('a366-score-btn').addEventListener('click', () => {
            if (!state.devPanelVisible) toggleDevPanel();
            switchDevTab('dev-score');
        });
        document.getElementById('a366-auto-fill-all').addEventListener('click', rebuildFillAll);
        document.getElementById('a366-log-clear').addEventListener('click', () => {
            state.logEntries = [];
            logContent.innerHTML = '';
        });

        // 时间修改 UI 绑定
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

            // "参考"按钮：恢复为计算值
            const ltRestore = document.getElementById('a366-listentime-restore');
            if (ltRestore) {
                ltRestore.addEventListener('click', () => {
                    if (state.presetListenTimeSeconds === null) {
                        addLog('[时间修改] 无可用参考值', 'warn');
                        return;
                    }
                    state.listenTimeSeconds = state.presetListenTimeSeconds;
                    localStorage.setItem('a366_listentime_seconds', String(state.presetListenTimeSeconds));
                    const abs = Math.abs(state.presetListenTimeSeconds);
                    ltMin.value = String(Math.floor(abs / 60));
                    ltSec.value = String(Math.round(abs % 60));
                    addLog('[时间修改] 已恢复为参考值 ' + state.presetListenTimeSeconds + '秒', 'success');
                    pushListenTime();
                });
            }
        }

        makeDraggable(container, document.getElementById('a366-header'));
        autoFetchAnswers();

        // 注入阶段自动拉取预设时间（覆盖用户设置）
        fetchPresetListenTime();
    }

    // 从代理层拉取基于 zip 内 mp3 时长自动计算的预设听力用时
    async function fetchPresetListenTime() {
        try {
            const res = await fetch(BUCKET_URL + '/listen-time-preset', { cache: 'no-cache' });
            const data = await res.json();

            // 无论成功与否，保存计算值作为参考
            const refSeconds = data.seconds || data.calculatedSeconds;
            if (Number.isFinite(refSeconds) && refSeconds > 0) {
                state.presetListenTimeSeconds = refSeconds;
            }

            if (data.success && Number.isFinite(data.seconds) && data.seconds > 0) {
                // 应用到当前设置
                state.listenTimeSeconds = data.seconds;
                localStorage.setItem('a366_listentime_seconds', String(data.seconds));
                // 更新 UI 输入框
                const ltMin = document.getElementById('a366-listentime-min');
                const ltSec = document.getElementById('a366-listentime-sec');
                if (ltMin && ltSec) {
                    const abs = Math.abs(data.seconds);
                    ltMin.value = String(Math.floor(abs / 60));
                    ltSec.value = String(Math.round(abs % 60));
                }
                // 详细日志
                addLog('[时间预设] 已自动设为 ' + data.seconds + '秒', 'success');
                if (data.detail) {
                    addLog(`  计算公式：总时长×2+360（baseline）`, 'info');
                    addLog(`  共 ${data.detail.totalDirs} 个 questions 目录：`, 'info');
                    if (Array.isArray(data.detail.questionsDirs)) {
                        data.detail.questionsDirs.forEach(d => {
                            addLog(`    ${d.dir} → ${d.mp3Count}个mp3，总时长${d.sumDurations}秒，计算${d.calc}秒`, 'info');
                        });
                    }
                    addLog(`  选最小值：${data.detail.selectedDir}`, 'info');
                }
            } else {
                addLog('[时间预设] 无可用预设：' + (data.message || '未知原因'), 'warn');
                if (data.calculatedSeconds) {
                    addLog(`  计算值 ${data.calculatedSeconds}秒 < 阈值1080秒，可点击"参考"手动应用`, 'info');
                }
                if (data.detail && Array.isArray(data.detail.questionsDirs)) {
                    addLog(`  共 ${data.detail.totalDirs} 个 questions 目录：`, 'info');
                    data.detail.questionsDirs.forEach(d => {
                        addLog(`    ${d.dir} → ${d.mp3Count}个mp3，总时长${d.sumDurations}秒，计算${d.calc}秒`, 'info');
                    });
                }
            }
        } catch (e) {
            addLog('[时间预设] 拉取失败：' + e.message, 'warn');
        } finally {
            pushListenTime();
        }
    }

    // 把"启用/秒数"状态经本地 bucket server 推给代理层
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
            // 操作听力面板时，重置填空时间修改，防止两个功能同时启用导致冲突
            fetch(BUCKET_URL + '/fill-time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: false, seconds: null }),
                cache: 'no-cache'
            }).catch(() => {});
        } catch (e) {
            addLog('[时间修改] 同步异常：' + e.message, 'warning');
        }
    }

    // ==========================================
    // 开发者面板（3个tab）
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
                <span style="font-weight:600;font-size:14px;color:var(--a366-info);">自动基础听力RC</span>
                <button id="a366-dev-close" style="background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:3px 8px;font-size:11px;cursor:pointer;">✕</button>
            </div>
            <div style="display:flex;border-bottom:1px solid var(--a366-border);background:var(--a366-bg-secondary);">
                <button class="a366-dev-tab active" data-tab="dev-search" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-primary);border-bottom:2px solid var(--a366-primary);transition:all 0.15s;">搜索测试</button>
                <button class="a366-dev-tab" data-tab="dev-rebuild" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-text-secondary);border-bottom:2px solid transparent;transition:all 0.15s;">重建结果</button>
                <button class="a366-dev-tab" data-tab="dev-score" style="flex:1;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--a366-text-secondary);border-bottom:2px solid transparent;transition:all 0.15s;">控分设置</button>
            </div>
            <div id="a366-dev-body" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;">
                <div id="a366-dev-tab-search" style="padding:12px;display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;gap:6px;">
                        <input id="a366-search-input" type="text" placeholder="输入精确匹配的文本..." style="flex:1;padding:8px 10px;border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);background:var(--a366-bg);color:var(--a366-text);font-size:13px;outline:none;font-family:var(--a366-font);">
                        <button id="a366-search-btn" style="background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">搜索</button>
                        <button id="a366-search-h24-btn" style="background:var(--a366-info);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;">24</button>
                    </div>
                    <div style="font-size:11px;color:var(--a366-text-secondary);padding:2px 0;">匹配方式：文本精确 | 点击方式：原生 .click()</div>
                    <div id="a366-results" style="min-height:30px;max-height:200px;overflow-y:auto;border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);padding:6px;background:var(--a366-bg);"></div>
                    <div id="a366-queue" style="min-height:30px;max-height:160px;overflow-y:auto;border:1px solid var(--a366-warning);border-radius:var(--a366-radius-md);padding:6px;background:var(--a366-bg);">
                        <div style="color:var(--a366-warning);font-size:11px;margin-bottom:4px;">待测试队列</div>
                        <div style="color:var(--a366-text-muted);text-align:center;padding:6px;font-size:11px;">队列为空</div>
                    </div>
                </div>
                <div id="a366-dev-tab-rebuild" style="padding:12px;display:none;flex-direction:column;gap:8px;">
                    <div style="font-size:11px;color:var(--a366-text-muted);text-align:center;padding:20px;">获取答案后将自动执行重建</div>
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
                </div>
            </div>
        `;

        document.body.appendChild(devPanel);

        inputEl = document.getElementById('a366-search-input');
        resultsContainer = document.getElementById('a366-results');

        document.getElementById('a366-dev-close').addEventListener('click', toggleDevPanel);
        document.getElementById('a366-search-btn').addEventListener('click', performSearch);
        document.getElementById('a366-search-h24-btn').addEventListener('click', searchHeight24);
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') performSearch(); });

        devPanel.querySelectorAll('.a366-dev-tab').forEach(tab => {
            tab.addEventListener('click', () => switchDevTab(tab.dataset.tab));
        });

        bindScoreSlider();
        bindScoreTicks();
        updateScorePreview();

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
        document.getElementById('a366-dev-tab-rebuild').style.display = tabName === 'dev-rebuild' ? 'flex' : 'none';
        document.getElementById('a366-dev-tab-score').style.display = tabName === 'dev-score' ? 'flex' : 'none';
        if (tabName === 'dev-score') updateScorePreview();
    }

    function toggleCollapse() {
        const body = document.getElementById('a366-body');
        if (!body) return;
        state.collapsed = !state.collapsed;
        body.style.display = state.collapsed ? 'none' : 'flex';
        container.style.maxHeight = state.collapsed ? 'auto' : '480px';
    }

    // ==========================================
    // 主页填答状态（基于 rebuildResults）
    // ==========================================

    function renderMainFillSection() {
        const fillStatus = document.getElementById('a366-fill-status');
        if (!fillStatus) return;

        const questions = state.rebuildResults;
        const answers = state.answerList;

        if (answers.length === 0 && questions.length === 0) {
            fillStatus.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;font-size:12px;">${state.answerError ? escapeHtml(state.answerError) : '未获取答案'}</div>`;
            document.getElementById('a366-auto-fill-all').style.display = 'none';
            return;
        }

        if (questions.length === 0) {
            fillStatus.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;font-size:12px;">已获取 ${answers.length} 条答案，等待重建...</div>`;
            document.getElementById('a366-auto-fill-all').style.display = 'none';
            return;
        }

        const matchedCount = questions.filter(q => !!q._matchedAnswer).length;
        const correctOptCount = questions.reduce((sum, q) => sum + q.options.filter(o => o._isCorrect).length, 0);
        const filledCount = questions.filter(q => q._filled === true).length;
        const wrongFilledCount = questions.filter(q => q._filled === 'wrong').length;

        let badges = '';
        questions.forEach((q) => {
            if (q._filled === true) {
                badges += '<span style="color:var(--a366-success);font-weight:600;">✓</span>';
            } else if (q._filled === 'wrong') {
                badges += '<span style="color:var(--a366-danger);font-weight:600;">✗</span>';
            } else if (q._filled === 'skipped') {
                badges += '<span style="color:var(--a366-text-muted);font-weight:600;">—</span>';
            } else {
                badges += '<span style="color:var(--a366-text-muted);">○</span>';
            }
        });

        fillStatus.innerHTML = `
            <div style="font-size:12px;color:var(--a366-text);margin-bottom:6px;">
                重建 <b>${questions.length}</b> 题 | 匹配 <b style="color:var(--a366-success);">${matchedCount}</b> 题 | 正确选项 <b style="color:var(--a366-success);">${correctOptCount}</b> 个${filledCount > 0 ? ' | 已填 <b style="color:var(--a366-success);">' + filledCount + '</b>' : ''}${wrongFilledCount > 0 ? ' | <span style="color:var(--a366-danger);">答错 ' + wrongFilledCount + '</span>' : ''}
            </div>
            <div style="font-size:15px;letter-spacing:2px;word-break:break-all;line-height:1.8;">${badges}</div>
        `;

        const fillAllBtn = document.getElementById('a366-auto-fill-all');
        fillAllBtn.style.display = questions.length > 0 ? '' : 'none';
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

    function searchHeight24(silent = false) {
        if (!silent) {
            addLog('搜索所有高度为24的选项...', 'info');
        }

        const allElements = document.querySelectorAll('body *');
        const matchedResults = [];

        allElements.forEach(el => {
            if (el === container || container.contains(el) || el.contains(container)) return;
            if (devPanel && (el === devPanel || devPanel.contains(el) || el.contains(devPanel))) return;
            try {
                const rect = el.getBoundingClientRect();
                if (Math.round(rect.height) === 24 && rect.width > 0) {
                    matchedResults.push(buildElementInfo(el, '高度=24'));
                }
            } catch(e) {}
        });

        state.currentResults = matchedResults;

        if (!silent) {
            if (matchedResults.length === 0) {
                addLog('未找到高度为24的可见元素', 'warn');
                resultsContainer.innerHTML = `<div style="color:var(--a366-text-muted);text-align:center;padding:12px;font-size:12px;">未找到匹配元素</div>`;
            } else {
                addLog(`共找到 ${matchedResults.length} 个高度为24的元素`, 'success');
                renderResults(matchedResults);
            }
        }
    }

    function exportResults() {
        const results = state.currentResults;
        if (!results || results.length === 0) {
            addLog('没有搜索结果可导出', 'warn');
            return;
        }

        const lines = results.map((info, i) => {
            const parts = [
                `#${i + 1}`,
                `<${info.tag}>`,
                info.id ? `id=${info.id}` : '',
                info.className ? `class=${info.className}` : '',
                info.text ? `text="${info.text}"` : '',
                `visible=${info.visible}`,
                info.disabled ? 'disabled=true' : '',
                `size=${info.size}`,
                `position=${info.position}`,
                info.type ? `type=${info.type}` : '',
                info.name ? `name=${info.name}` : '',
                info.role ? `role=${info.role}` : '',
                info.ariaLabel ? `aria-label=${info.ariaLabel}` : '',
                `strategy=${info.strategy}`,
            ];
            return parts.filter(Boolean).join(' | ');
        });

        const header = `自动基础听力RC - 搜索结果导出 (${results.length} 条) - ${new Date().toLocaleString('zh-CN')}`;
        const content = header + '\n' + '='.repeat(header.length) + '\n\n' + lines.join('\n');

        addLog('正在导出搜索结果...', 'info');

        fetch(BUCKET_URL + '/save-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        })
        .then(res => res.json())
        .then(result => {
            if (result.success) {
                addLog('搜索结果已导出到: ' + result.path, 'success');
            } else {
                addLog('导出失败: ' + (result.error || '未知错误'), 'error');
            }
        })
        .catch(err => {
            addLog('导出失败: ' + err.message, 'error');
        });
    }

    // ==========================================
    // 题库重建算法（5阶段）
    // ==========================================

    function rebuildQuestions() {
        const results = state.currentResults;
        if (!results || results.length === 0) {
            addLog('请先执行搜索（如"高度24"）再点重建', 'warn');
            return;
        }

        addLog(`开始重建，输入元素 ${results.length} 个`, 'info');

        const elements = [];
        results.forEach((info, i) => {
            const el = info.element;
            if (!el || !document.contains(el)) return;
            const rect = el.getBoundingClientRect();
            const cls = (typeof el.className === 'string' ? el.className : '');
            if (!cls) return;
            elements.push({
                index: i,
                element: el,
                className: cls,
                text: (el.textContent || '').trim(),
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            });
        });

        addLog(`有效元素 ${elements.length} 个（有 className）`, 'info');

        // ===== 阶段一：X轴聚类，识别有效区域 =====
        const optMarkEls = elements.filter(e => e.className.includes('u3-opt-mark'));
        if (optMarkEls.length === 0) {
            addLog('未找到 u3-opt-mark 元素，无法重建', 'warn');
            return;
        }

        const xClusters = [];
        optMarkEls.forEach(e => {
            let found = false;
            for (const cluster of xClusters) {
                if (Math.abs(e.x - cluster.centerX) <= 50) {
                    cluster.xs.push(e.x);
                    cluster.centerX = cluster.xs.reduce((a, b) => a + b, 0) / cluster.xs.length;
                    found = true;
                    break;
                }
            }
            if (!found) xClusters.push({ centerX: e.x, xs: [e.x] });
        });
        xClusters.sort((a, b) => a.centerX - b.centerX);
        addLog(`阶段一：X轴聚类 ${xClusters.length} 个区域`, 'info');

        // ===== 阶段二：按区域分组，区域内按Y排序 =====
        const regionElements = [];
        xClusters.forEach(cluster => {
            const inRegion = elements.filter(e => {
                for (const cx of cluster.xs) {
                    if (Math.abs(e.x - cx) <= 50) return true;
                }
                return false;
            });
            inRegion.sort((a, b) => a.y - b.y || a.x - b.x);
            regionElements.push(...inRegion);
        });
        addLog(`阶段二：有效区域内元素 ${regionElements.length} 个`, 'info');

        // ===== 阶段三+四：题组分割 + 选项归组 =====
        const questions = [];
        let i = 0;
        while (i < regionElements.length) {
            const elem = regionElements[i];

            if (elem.className.includes('u3-qst-num')) {
                const qNum = parseInt(elem.text, 10);
                if (isNaN(qNum)) { i++; continue; }

                let qText = '';
                for (let j = i + 1; j < regionElements.length; j++) {
                    const candidate = regionElements[j];
                    if (candidate.className.includes('u3-qst-text') && Math.abs(candidate.y - elem.y) <= 5) {
                        qText = candidate.text;
                        break;
                    }
                }

                const q = { number: qNum, text: qText, options: [], _numElement: elem.element };
                i++;

                while (q.options.length < 3 && i < regionElements.length) {
                    const cur = regionElements[i];
                    if (cur.className.includes('u3-qst-num')) break;

                    if (cur.className.includes('u3-opt-mark')) {
                        const mark = cur.text;
                        let content = '';
                        let contentElement = null;
                        for (let j = i + 1; j < regionElements.length; j++) {
                            const cand = regionElements[j];
                            if (cand.className.includes('u3-opt-cont') && Math.abs(cand.y - cur.y) <= 5) {
                                content = cand.text;
                                contentElement = cand.element;
                                break;
                            }
                        }
                        q.options.push({
                            mark: mark,
                            content: content,
                            _markElement: cur.element,
                            _contentElement: contentElement,
                            _isCorrect: false,
                        });
                    }
                    i++;
                }
                questions.push(q);
            } else {
                i++;
            }
        }
        addLog(`阶段三/四：重建出 ${questions.length} 道题`, 'info');

        // ===== 阶段五：跨区域去重 =====
        const deduped = [];
        const seen = new Set();
        questions.forEach(q => {
            if (!seen.has(q.number)) {
                seen.add(q.number);
                deduped.push(q);
            } else {
                const existing = deduped.find(d => d.number === q.number);
                if (q.options.length > existing.options.length) {
                    deduped[deduped.indexOf(existing)] = q;
                }
            }
        });
        deduped.sort((a, b) => a.number - b.number);
        addLog(`阶段五：去重后 ${deduped.length} 道题`, 'info');

        // ===== 正确选项匹配 =====
        if (state.answerList.length > 0) {
            let matchCount = 0;
            deduped.forEach(q => {
                const match = state.answerList.find(a => {
                    const aqText = (a.questionText || a.question || '').trim();
                    return aqText && normalizeText(aqText) === normalizeText(q.text);
                });
                if (match) {
                    const answerContent = match.answer || '';
                    const dotIdx = answerContent.indexOf('.');
                    const correctContent = dotIdx >= 0 ? answerContent.substring(dotIdx + 1).trim() : answerContent.trim();
                    q.options.forEach(opt => {
                        if (normalizeText(opt.content) === normalizeText(correctContent)) {
                            opt._isCorrect = true;
                        }
                    });
                    q._matchedAnswer = match;
                    matchCount++;
                }
            });
            addLog(`正确选项匹配：${matchCount}/${deduped.length} 题`, matchCount > 0 ? 'success' : 'warn');
        } else {
            addLog('答案列表为空，无法标记正确选项', 'warn');
        }

        // ===== 页面DOM标记 =====
        deduped.forEach(q => {
            q.options.forEach(opt => {
                if (opt._isCorrect && opt._markElement && document.contains(opt._markElement)) {
                    opt._markElement.style.outline = '3px solid var(--a366-success)';
                    opt._markElement.style.background = 'var(--a366-success-light)';
                }
                if (opt._isCorrect && opt._contentElement && document.contains(opt._contentElement)) {
                    opt._contentElement.style.outline = '3px solid var(--a366-success)';
                    opt._contentElement.style.background = 'var(--a366-success-light)';
                }
            });
        });

        state.rebuildResults = deduped;
        renderRebuildResults();
        updateScorePreview();
        renderMainFillSection();
    }

    function renderRebuildResults() {
        const tabContainer = document.getElementById('a366-dev-tab-rebuild');
        if (!tabContainer) return;

        const questions = state.rebuildResults;
        if (questions.length === 0) {
            tabContainer.innerHTML = `<div style="font-size:11px;color:var(--a366-text-muted);text-align:center;padding:20px;">获取答案后将自动执行重建</div>`;
            return;
        }

        const matchedCount = questions.filter(q => !!q._matchedAnswer).length;
        const correctCount = questions.reduce((sum, q) => sum + q.options.filter(o => o._isCorrect).length, 0);
        let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:11px;color:var(--a366-primary);">重建结果：${questions.length} 道题 | 已匹配 ${matchedCount} 题 | 正确选项 ${correctCount} 个</span>
            <button id="a366-rebuild-fill-btn" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:3px 10px;font-size:11px;cursor:pointer;font-weight:500;">一键填答</button>
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

        const fillBtn = document.getElementById('a366-rebuild-fill-btn');
        if (fillBtn) fillBtn.addEventListener('click', rebuildFillAll);
    }

    // ==========================================
    // 控分设置 tab
    // ==========================================

    function updateScorePreview() {
        const total = state.rebuildResults.length || 20;
        const info = document.getElementById('a366-score-info');
        const slider = document.getElementById('a366-score-slider');
        const currentLabel = document.getElementById('a366-score-current');
        const preview = document.getElementById('a366-score-preview');

        const targetScore = parseFloat(slider ? slider.value : 0) || 0;
        if (currentLabel) currentLabel.textContent = targetScore.toFixed(1) + ' 分';

        const rebuilt = state.rebuildResults.length > 0;
        const mismatch = rebuilt && state.rebuildResults.length !== state.answerList.length;

        if (info) {
            if (!rebuilt) {
                info.textContent = '默认20题，满分30分（重建后生效）';
                info.style.color = '';
            } else if (mismatch) {
                info.innerHTML = `⚠ 答案${state.answerList.length}条 ≠ 题目${state.rebuildResults.length}题，控分可能不准确`;
                info.style.color = 'var(--a366-danger)';
            } else {
                info.textContent = `满分 ${(total * 1.5).toFixed(1)} 分（${total} 题 × 1.5）`;
                info.style.color = '';
            }
        }

        // 答案数≠题数时，主面板操作按钮背景变红警告
        const btnIds = ['a366-auto-fill-all', 'a366-jiaojuan-btn', 'a366-auto-btn', 'a366-score-btn'];
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

        const correctCount = Math.min(total, Math.round(targetScore / 1.5));
        const wrongCount = total - correctCount;

        if (preview) preview.innerHTML = `答对：<span style="color:#28a745;">${correctCount} 题</span> | 答错：<span style="color:#dc3545;">${wrongCount} 题</span>`;
    }

    function bindScoreSlider() {
        const scoreSlider = document.getElementById('a366-score-slider');
        if (scoreSlider) {
            scoreSlider.addEventListener('input', () => { updateScorePreview(); });
            scoreSlider.addEventListener('change', () => {
                const total = state.rebuildResults.length || 20;
                const targetScore = parseFloat(scoreSlider.value) || 0;
                const correctCount = Math.min(total, Math.round(targetScore / 1.5));
                const wrongCount = total - correctCount;
                state.targetWrongCount = wrongCount;
                addLog(`[控分] 目标得分 ${targetScore.toFixed(1)} 分 | 答对 ${correctCount} | 答错 ${wrongCount}`, 'success');
                renderMainFillSection();
            });
        }
    }

    function bindScoreTicks() {
        const scoreSlider = document.getElementById('a366-score-slider');
        devPanel.querySelectorAll('.a366-score-tick').forEach(tick => {
            tick.addEventListener('click', () => {
                if (!scoreSlider) return;
                const score = parseFloat(tick.dataset.score);
                scoreSlider.value = score;
                scoreSlider.dispatchEvent(new Event('input'));
                scoreSlider.dispatchEvent(new Event('change'));
            });
        });
    }

    // ==========================================
    // 基于重建结果的一键填答（新算法，含控分）
    // ==========================================

    function rebuildFillAll() {
        const questions = state.rebuildResults;
        if (questions.length === 0) {
            addLog('[重建填答] 无重建结果，请先获取答案', 'warn');
            return;
        }

        const total = questions.length;
        const wrongCount = state.targetWrongCount || 0;
        const plan = buildFillPlan(total, wrongCount);
        addLog(`[重建填答] 控分计划：答对 ${plan.correctCount} | 答错 ${plan.wrongCount}`, 'info');

        let filled = 0, wrongFilled = 0, failed = 0;

        questions.forEach((q, idx) => {
            const isWrong = plan.wrongSet.has(idx);

            const correctOpt = q.options.find(o => o._isCorrect);

            if (isWrong) {
                const wrongOpt = q.options.find(o => !o._isCorrect && o._markElement);
                if (wrongOpt) {
                    const result = clickOption(wrongOpt, q, 'wrong');
                    if (result) { wrongFilled++; q._filled = 'wrong'; } else { failed++; }
                } else {
                    failed++;
                    addLog(`[重建填答] #${q.number} 无可答错的选项`, 'warn');
                }
                return;
            }

            if (!correctOpt || !correctOpt._markElement) {
                failed++;
                addLog(`[重建填答] #${q.number} 无正确选项或元素不在DOM`, 'warn');
                return;
            }
            const result = clickOption(correctOpt, q, 'correct');
            if (result) { filled++; q._filled = true; } else { failed++; }
        });

        addLog(`[重建填答] 完成：答对 ${filled} / 答错 ${wrongFilled} / 失败 ${failed}`, (filled + wrongFilled) > 0 ? 'success' : 'error');
        renderMainFillSection();
        renderRebuildResults();
    }

    // 重建填答的点击选项逻辑
    function clickOption(opt, q, mode) {
        const markEl = opt._markElement;
        const contentEl = opt._contentElement;
        let clickTarget = null;
        let clickMethod = '';

        // 策略1：标记元素内找 input
        if (markEl && document.contains(markEl)) {
            const input = markEl.querySelector('input[type="radio"], input[type="checkbox"]');
            if (input) { clickTarget = input; clickMethod = 'mark$>input'; }
        }

        // 策略2：父级选项容器内找 input
        if (!clickTarget && markEl && document.contains(markEl)) {
            let parent = markEl.parentElement;
            for (let depth = 0; depth < 3 && parent; depth++) {
                const input = parent.querySelector('input[type="radio"], input[type="checkbox"]');
                if (input && !isForeignElement(input)) {
                    clickTarget = input; clickMethod = 'parent(' + depth + ')$>input'; break;
                }
                parent = parent.parentElement;
            }
        }

        // 策略3：直接点击 mark 元素
        if (!clickTarget && markEl && document.contains(markEl)) {
            clickTarget = markEl; clickMethod = 'mark.click';
        }

        // 策略4：点击 content 元素
        if (!clickTarget && contentEl && document.contains(contentEl)) {
            clickTarget = contentEl; clickMethod = 'content.click';
        }

        if (clickTarget) {
            try {
                const outlineColor = mode === 'correct' ? 'var(--a366-success)' : '#dc3545';
                if (markEl && document.contains(markEl)) {
                    markEl.style.outline = '3px solid ' + outlineColor;
                    markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                clickTarget.click();
                const modeLabel = mode === 'correct' ? '✓' : '✗';
                addLog(`[重建填答] #${q.number} ${modeLabel} ${opt.mark} ${escapeHtml(opt.content.substring(0, 30))} → ${clickMethod}`, mode === 'correct' ? 'click' : 'warn');
                setTimeout(() => {
                    if (markEl && document.contains(markEl)) markEl.style.outline = '';
                }, 1000);
                return true;
            } catch (e) {
                addLog(`[重建填答] #${q.number} 点击异常: ${e.message}`, 'error');
                return false;
            }
        } else {
            addLog(`[重建填答] #${q.number} 无可点击目标`, 'warn');
            return false;
        }
    }

    // ==========================================
    // 控分计划计算
    // ==========================================

    function buildFillPlan(total, wrongCount) {
        const totalNum = Math.max(0, parseInt(total) || 0);
        const wrongNum = Math.max(0, Math.min(totalNum, parseInt(wrongCount) || 0));
        const correctCount = totalNum - wrongNum;

        const indices = Array.from({ length: totalNum }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        const wrongSet = new Set(wrongNum > 0 ? indices.slice(0, wrongNum) : []);

        return { wrongSet, correctCount, wrongCount: wrongNum };
    }

    // ==========================================
    // 交卷与自动流程
    // ==========================================

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
        addLog('━━━━━━━━ 自动流程开始 ━━━━━━━', 'info');

        const startBtnClicked = clickStartBtn();
        if (startBtnClicked) {
            addLog('检测到试题预览页，已点击「去做题」', 'success');
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (state.answerList.length === 0) {
            await fetchAnswers();
            if (state.answerList.length === 0) {
                addLog('获取答案失败，自动流程终止', 'error');
                return;
            }
        }

        if (state.rebuildResults.length === 0) {
            addLog('重建结果为空，自动流程终止', 'error');
            return;
        }

        addLog('开始一键填答', 'info');
        rebuildFillAll();

        await new Promise(resolve => setTimeout(resolve, 100));

        addLog('开始交卷流程', 'info');
        submitExam();

        await new Promise(resolve => setTimeout(resolve, 100));

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
    // 答案获取（获取后自动触发 searchHeight24 → rebuildQuestions）
    // ==========================================

    async function fetchAnswers() {
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

            if (filtered.length > 0) {
                addLog(`获取答案成功：${filtered.length} 条听后选择题`, 'success');
            } else {
                addLog(`获取到 ${rawAnswers.length} 条答案，但无听后选择题`, 'warn');
            }

            renderMainFillSection();

            // 获取答案后轮询：每0.2s执行searchHeight24，结果>=240时自动重建
            if (filtered.length > 0) {
                updateWaitingLog('等待测试开始...', 'info', 'poll-waiting');
                const pollTimer = setInterval(() => {
                    searchHeight24(true); // 静默模式，不输出日志
                    const count = state.currentResults.length;
                    if (count >= 240) {
                        clearInterval(pollTimer);
                        updateWaitingLog(`已找到 ${count} 个元素，开始重建`, 'success', 'poll-waiting');
                        rebuildQuestions();
                    } else {
                        updateWaitingLog(`等待测试开始... (已找到 ${count} 个)`, 'info', 'poll-waiting');
                    }
                }, 200);
            }

        } catch(e) {
            state.answerError = e.message;
            const isNetworkError = e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('fetch');
            if (isNetworkError) {
                addLog(`获取答案失败: 无法连接服务器，请确认代理服务器已启动`, 'error');
            } else {
                addLog(`获取答案失败: ${escapeHtml(e.message)}`, 'error');
            }
            renderMainFillSection();
        } finally {
            state.answerLoading = false;
        }
    }

    // ==========================================
    // 搜索结果渲染
    // ==========================================

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
        const full = state.fullDisplay;
        const fullBtnStyle = full
            ? 'background:var(--a366-primary);color:#fff;'
            : 'background:var(--a366-bg-tertiary);color:var(--a366-text-secondary);border:1px solid var(--a366-border);';
        let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--a366-primary);">匹配结果 (${results.length})</span>
            <div style="display:flex;gap:4px;">
                <button id="a366-rebuild-btn" style="background:var(--a366-warning);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:1px 8px;font-size:10px;cursor:pointer;font-weight:500;">重建</button>
                <button id="a366-export-results-btn" style="background:var(--a366-success);color:#fff;border:none;border-radius:var(--a366-radius-sm);padding:1px 8px;font-size:10px;cursor:pointer;font-weight:500;">导出</button>
                <button id="a366-full-toggle" style="${fullBtnStyle}border:none;border-radius:var(--a366-radius-sm);padding:1px 8px;font-size:10px;cursor:pointer;font-weight:500;">${full ? '紧凑' : '全量'}</button>
            </div>
        </div>`;
        results.forEach((info, i) => {
            const visColor = info.visible ? 'var(--a366-success)' : 'var(--a366-danger)';
            const clsDisplay = full ? escapeHtml(info.className) : escapeHtml(info.className.substring(0, 50));
            const textDisplay = full ? escapeHtml(info.text) : escapeHtml(info.text.substring(0, 60));
            html += `
            <div style="border-left:3px solid ${visColor};margin:4px 0;padding:4px 8px;background:var(--a366-bg-secondary);border-radius:0 var(--a366-radius-sm) var(--a366-radius-sm) 0;font-size:11px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <b style="color:var(--a366-primary);">#${i + 1}</b>
                    <span style="color:var(--a366-text-muted);font-size:10px;">${escapeHtml(info.strategy)}</span>
                </div>
                <div>&lt;<b>${info.tag}</b>&gt; ${info.id ? '<span style="color:var(--a366-warning);">#' + escapeHtml(info.id) + '</span> ' : ''}<span style="color:var(--a366-text-secondary);word-break:break-all;">${clsDisplay}</span></div>
                <div style="color:var(--a366-text);word-break:break-all;">${textDisplay || '<span style="color:var(--a366-text-muted);">(无文本)</span>'}</div>
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

        const fullToggle = document.getElementById('a366-full-toggle');
        if (fullToggle) fullToggle.addEventListener('click', () => {
            state.fullDisplay = !state.fullDisplay;
            renderResults(state.currentResults);
        });

        const exportBtn = document.getElementById('a366-export-results-btn');
        if (exportBtn) exportBtn.addEventListener('click', exportResults);

        const rebuildBtn = document.getElementById('a366-rebuild-btn');
        if (rebuildBtn) rebuildBtn.addEventListener('click', () => {
            rebuildQuestions();
            switchDevTab('dev-rebuild');
        });

        updateScorePreview();

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
    // 测试队列
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
    // 工具函数
    // ==========================================

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
            warning: '#e67e22',
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
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });

        if (!logContent) return;

        // 尝试找到已有条目
        let div = logContent.querySelector(`[data-log-id="${id}"]`);

        const colors = {
            info: 'var(--a366-text-secondary)',
            success: 'var(--a366-success)',
            warn: '#e67e22',
            error: 'var(--a366-danger)',
        };
        const color = colors[type] || colors.info;

        if (div) {
            // 覆盖更新
            div.innerHTML = `<span style="color:var(--a366-text-muted);">[${time}]</span> ${message}`;
            div.style.color = color;
        } else {
            // 新建
            div = document.createElement('div');
            div.setAttribute('data-log-id', id);
            div.style.cssText = `padding:1px 0;border-bottom:1px solid var(--a366-border);color:${color};word-break:break-all;`;
            div.innerHTML = `<span style="color:var(--a366-text-muted);">[${time}]</span> ${message}`;
            logContent.appendChild(div);
        }
        logContent.scrollTop = logContent.scrollHeight;
    }

    // ==========================================
    // 初始化
    // ==========================================

    // ==========================================
    // 听说卷（北京中考听说考试）
    //
    // 跟基础听力是两种卷子，共用这一个规则集，开机按答案题型自动挑界面：
    //   基础听力 —— 整卷只有听后选择，走上面那套重建+填答
    //   听说     —— 6 道听后选择 + 十几道口语题，走下面这套
    //
    // 口语题这边有个关键结论：考试模式下页面上**没有录音按钮**。
    // 实测导出的结构里，partB 容器内可见的只有题干，
    // u3-sent-record / u3-qst-record / u3-myRecord 全部 visible=0（那是答完后的回放面板）。
    // 底部 examBar 显示「请听题」并自动播音——整场考试是线性自动流程，
    // 到点自己开录。所以不能靠点按钮。页面通常只 getUserMedia 一次、整场复用同一条流，
    // 真正逐题发生的是 MediaRecorder.start/stop；考试栏的「请答题」再作为兼容兜底。
    // ==========================================

    const SPK = {
        // 取自真机导出的结构
        subChoice: '.u3compo-singlechoice-zc',
        qText:     '.u3-qst-text-cont',   // 干净题干，不含得分/参考答案/听力原文
        opt:       '.u3-qst-opt',
        optCont:   '.u3-opt-cont',        // 选项正文，不含 A./B./C. 前缀
        optRadio:  '.u3-qst-opt-radio',
        selected:  'u3-selected',
        speakHost: '.u3compo-partB-zc, .u3compo-partC-zc, .u3compo-repeat-zc',
        slide:     '.swiper-slide-active',
        barTitle:  '.examBar-title',
    };

    const SPEAK_PATTERNS = ['听后回答', '朗读短文', '听后转述', 'JSON句子跟读模式', '口语跟读', '故事复述'];

    function spkVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    // swiper 会把非当前页横向移出屏幕，但它们仍有 width/height，spkVisible 会误判为可见。
    // 录音相位和当前题都必须按“与视口相交”判断，不能取 DOM 里的第一个。
    function spkOnScreen(el) {
        if (!spkVisible(el)) return false;
        const r = el.getBoundingClientRect();
        const w = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || Infinity;
        const h = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || Infinity;
        return r.right > 0 && r.bottom > 0 && r.left < w && r.top < h;
    }

    function spkText(el) {
        return ((el && (el.innerText || el.textContent)) || '').trim().replace(/\s+/g, ' ');
    }

    function spkClick(el) {
        if (!el) return;
        for (const t of ['mousedown', 'mouseup', 'click']) {
            el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        }
    }

    const Speaking = {
        answers: [], choices: [], manifest: [], used: new Set(),
        readyIndexes: new Set(), ttsGenerating: false,
        approvalPending: false, approvalWarned: false,
        audioCache: new Map(), audioFailures: new Set(),
        running: false, armed: false, micReady: false, recorderActive: false,
        gumCount: 0,
        recording: false, starting: false,
        source: null, currentIndex: null, recordSeq: 0,
        ctx: null, gain: null, dest: null, stream: null, tracks: null,
        origGUM: null, origStop: null,
        origRecorderStart: null, origRecorderStop: null, origRecorderPause: null,
        stopBlocked: 0, readyPromise: null,
        _barObs: null, _barTimer: null, _phaseTimer: null, _choiceTimer: null,

        /* ---------- 选择题 ---------- */

        norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); },

        /* 答案里的字母不可信：卷面写着「作答时选项随机乱序」，只比正文 */
        normOpt(s) {
            return this.norm(String(s || '').replace(/^\s*[A-D]\s*[.、．]\s*/, ''));
        },

        answerForQuestion(qText) {
            const q = this.norm(qText);
            if (!q) return null;
            let best = null, score0 = 0;
            for (const a of this.choices) {
                const c = this.norm(a.question || a.questionText);
                if (!c) continue;
                let s = 0;
                if (c === q) s = 100;
                else if (q.indexOf(c) >= 0 || c.indexOf(q) >= 0) {
                    s = Math.min(c.length, q.length) / Math.max(c.length, q.length) * 90;
                }
                if (s > score0) { score0 = s; best = a; }
            }
            return score0 >= 60 ? best : null;
        },

        fillChoices(quiet) {
            if (!this.choices.length) {
                if (!quiet) addLog('听说: 还没有听后选择的答案' + (this.answers.length ? '（这份卷子里没有）' : '（答案还没到）'), 'warn');
                return 0;
            }
            // 选择题的各页通常已经在 DOM 里，只是非当前页被 swiper 隐藏。
            // 这里不能 filter(spkVisible)，否则“一键答题”只会填当前屏的一题。
            const subs = [...document.querySelectorAll(SPK.subChoice)]
                .filter(sub => sub.querySelector(SPK.qText) && sub.querySelector(SPK.opt));
            if (!subs.length) {
                if (!quiet) addLog('听说: 页面上还没有选择题，进入对应部分后会自动重试', 'warn');
                return 0;
            }

            let done = 0, skip = 0, miss = 0;
            for (const sub of subs) {
                if (sub.querySelector('.' + SPK.selected)) { skip++; continue; }

                // 必须用 .u3-qst-text-cont。整块 innerText 会把隐藏的
                // 「得分/参考答案/听力原文」也带出来，题干就对不上答案了。
                const qEl = sub.querySelector(SPK.qText);
                const qText = qEl ? spkText(qEl) : spkText(sub).split(/[A-D]\s*[.、．]/)[0];
                const ans = this.answerForQuestion(qText);
                if (!ans) {
                    miss++;
                    if (!quiet) addLog('听说: 题干没对上答案「' + qText.slice(0, 36) + '」', 'warn');
                    continue;
                }

                const want = this.normOpt(ans.answer);
                const opts = [...sub.querySelectorAll(SPK.opt)];
                const textOfOpt = o => {
                    const c = o.querySelector(SPK.optCont);
                    return this.normOpt(c ? spkText(c) : spkText(o));
                };
                const target = opts.find(o => textOfOpt(o) === want)
                    || opts.find(o => { const t = textOfOpt(o); return t && (t.indexOf(want) >= 0 || want.indexOf(t) >= 0); });

                if (!target) {
                    miss++;
                    if (!quiet) {
                        addLog('听说: 选项没找到「' + ans.answer + '」，页面上是 ' +
                            opts.map(o => spkText(o.querySelector(SPK.optCont) || o)).join(' / '), 'warn');
                    }
                    continue;
                }

                spkClick(target.querySelector(SPK.optRadio) || target);
                const ok = !!sub.querySelector('.' + SPK.selected);
                done++;
                if (!quiet) addLog('听说: ' + (ok ? '已选 ' : '点了但无选中态 ') + spkText(target), ok ? 'success' : 'warn');
            }
            if (!quiet) {
                addLog('听说: 选择题 ' + done + ' 题' + (skip ? '，' + skip + ' 题已答' : '') +
                    (miss ? '，' + miss + ' 题未处理' : ''), done || skip ? 'success' : 'warn');
            }
            return done;
        },

        startChoiceWatcher() {
            if (this._choiceTimer) return;
            this._choiceTimer = setInterval(() => {
                if (this.running) this.fillChoices(true);
            }, 700);
        },

        stopChoiceWatcher() {
            if (this._choiceTimer) clearInterval(this._choiceTimer);
            this._choiceTimer = null;
        },

        /* ---------- 朗读清单 ---------- */

        acceptManifest(d, quiet) {
            if (!d || !(d.count > 0) || !Array.isArray(d.items) || !d.items.length) return false;
            this.manifest = d.items;
            this.ttsGenerating = !!d.generating;
            this.readyIndexes = new Set(Array.isArray(d.readyIndexes) ? d.readyIndexes : []);
            this.approvalPending = !!d.approvalPending;
            if (!this.approvalPending) this.approvalWarned = false;
            if (!quiet) {
                const generated = Number.isFinite(d.generatedCount) ? d.generatedCount : this.readyIndexes.size;
                addLog('听说: 朗读清单 ' + this.manifest.length + ' 条，当前已生成 ' + generated + ' 条' +
                    (this.ttsGenerating ? '（继续后台生成）' : ''), 'success');
                if (this.approvalPending) {
                    addLog('听说: TTS 尚未生成，请在 Auto366 的审批窗口确认；也可在设置中关闭“生成前审批朗读文本”', 'warn');
                    this.setStatus('等待 TTS 审批 · 确认生成后将自动接入');
                    this.approvalWarned = true;
                }
            }
            return true;
        },

        async refreshManifest(quiet) {
            try {
                const r = await fetch(BUCKET_URL + '/listening-tts/list', { cache: 'no-cache' });
                if (!r.ok) return false;
                return this.acceptManifest(await r.json(), quiet);
            } catch (e) { return false; }
        },

        async loadManifest() {
            for (let i = 0; i < 60; i++) {
                if (!this.running) return false;
                let d = null;
                try {
                    const r = await fetch(BUCKET_URL + '/listening-tts/list', { cache: 'no-cache' });
                    if (r.ok) d = await r.json();
                } catch (e) { /* 端点还没起 */ }
                // ready=false 只表示整批还没生成完；items 和已落盘 wav 已经可以使用。
                if (this.acceptManifest(d, false)) return true;
                if (d && d.generating) { if (i % 5 === 0) addLog('听说: TTS 生成中…', 'info'); }
                else if (d && d.count === 0) { if (i === 0) addLog('听说: TTS 清单为空，需先在审批弹窗确认', 'warn'); }
                else if (!d && i === 0) { addLog('听说: 连不上 ' + BUCKET_URL + '/listening-tts/list', 'warn'); }
                await new Promise(r => setTimeout(r, 1000));
            }
            addLog('听说: 等 TTS 清单超时', 'error');
            return false;
        },

        /* 当前这一页要说的内容：朗读题显示原文，听后回答显示问题 */
        currentTexts() {
            const slides = [...document.querySelectorAll(SPK.slide)];
            const roots = slides.length ? slides.filter(spkOnScreen) : [];
            const activeRoots = roots.length ? roots : (slides.length ? slides : [document]);
            const hosts = [];
            const seen = new Set();
            for (const root of activeRoots) {
                for (const host of [...root.querySelectorAll(SPK.speakHost)]) {
                    if (!seen.has(host)) { seen.add(host); hosts.push(host); }
                }
            }
            // 某些模板把 active 类挂在内层 swiper；找不到口语容器时退回全页的屏幕内节点。
            if (!hosts.length) {
                for (const host of [...document.querySelectorAll(SPK.speakHost)]) {
                    if (!seen.has(host)) { seen.add(host); hosts.push(host); }
                }
            }
            const onScreen = hosts.filter(spkOnScreen);
            const picked = onScreen.length ? onScreen : hosts;
            return [...new Set(picked.map(spkText).filter(Boolean))];
        },

        currentText() {
            return this.currentTexts()[0] || '';
        },

        matchCurrent(allowFallback) {
            const texts = this.currentTexts();
            // 组合题一页有两道 partB。第一题用完后，必须继续尝试第二个题干，
            // 不能永远拿 querySelector 返回的第一道题。
            for (const text of texts) {
                const found = this.match(text, false);
                if (found) return { ...found, pageText: text };
            }
            if (allowFallback) {
                for (const text of texts) {
                    const found = this.match(text, true);
                    if (found) return { ...found, pageText: text };
                }
            }
            return null;
        },

        match(pageText, allowFallback) {
            const p = this.norm(pageText);
            if (p) {
                let best = null, s0 = 0, len0 = 0;
                for (const it of this.manifest) {
                    if (this.used.has(it.index)) continue;
                    for (const cand of [it.text, it.meta && it.meta.question]) {
                        const c = this.norm(cand);
                        if (!c || c.length < 6) continue;
                        let s = 0;
                        if (c === p) s = 100;
                        else if (p.indexOf(c) >= 0) s = 95;
                        else if (c.indexOf(p) >= 0) s = p.length / c.length * 90;
                        // 同分取更长的：朗读短文整篇里含着每个单句
                        if (s > s0 || (s === s0 && s > 0 && c.length > len0)) { s0 = s; best = it; len0 = c.length; }
                    }
                }
                if (best && s0 >= 55) return { item: best, how: '文本匹配 ' + s0.toFixed(0) + '%' };
            }
            // 页面尚未切到口语题时绝不能盲取下一条，否则会把音频灌到等待页，
            // 并且让真正的问题永远被判成“已用”。只有已经拿到口语正文时才允许顺序兜底。
            if (allowFallback && p) {
                for (const it of this.manifest) if (!this.used.has(it.index)) return { item: it, how: '顺序兜底' };
            }
            return null;
        },

        async ensureAudioGraph(resume) {
            if (!this.ctx || this.ctx.state === 'closed') {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                this.gain = this.ctx.createGain();
                this.gain.gain.value = 1.0;
                this.dest = this.ctx.createMediaStreamDestination();
                this.gain.connect(this.dest);
                this.stream = this.dest.stream;
                this.tracks = new Set(this.stream.getAudioTracks());
            }
            // early hook 阶段可能还没有用户手势，只创建并交出稳定的 stream；
            // 真正点“自动答题”或开始播放时再 resume。
            if (resume !== false && this.ctx.state === 'suspended') await this.ctx.resume();
        },

        async fetchAudio(item) {
            if (this.audioCache.has(item.index)) return this.audioCache.get(item.index);
            const r = await fetch(BUCKET_URL + '/listening-tts/output/' + item.index + '.wav', { cache: 'no-cache' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const buf = await r.arrayBuffer();
            const audio = await this.ctx.decodeAudioData(buf);
            this.audioCache.set(item.index, audio);
            this.readyIndexes.add(item.index);
            this.audioFailures.delete(item.index);
            return audio;
        },

        async fetchAudioUntilReady(item, seq) {
            let attempts = 0;
            while (this.recording && seq === this.recordSeq) {
                try {
                    const audio = await this.fetchAudio(item);
                    if (attempts) addLog('听说: #' + item.index + ' 音频已生成，等待后成功接入', 'success');
                    return audio;
                } catch (e) {
                    attempts++;
                    const transient = /HTTP 404|Failed to fetch|fetch/i.test(e.message || '');
                    if (!transient) throw e;
                    if (attempts === 1) {
                        addLog('听说: #' + item.index + ' 仍在生成，本题录音窗口内持续等待…', 'info');
                    }
                    if (attempts % 4 === 0) await this.refreshManifest(true);
                    await new Promise(r => setTimeout(r, 250));
                }
            }
            return null;
        },

        async preloadAudio() {
            if (!this.manifest.length && !await this.loadManifest()) return false;
            if (this.approvalPending) return false;
            await this.ensureAudioGraph();

            const pending = this.manifest.filter(it => !this.audioCache.has(it.index) &&
                (!this.ttsGenerating || this.readyIndexes.has(it.index)));
            if (!pending.length) {
                if (this.ttsGenerating) addLog('听说: 清单已接收，音频将按生成进度逐题接入', 'info');
                return this.manifest.length > 0;
            }
            addLog('听说: 预载并解码 ' + pending.length + ' 条朗读音频…', 'info');
            this.setStatus('选择题已处理 · 正在预载朗读音频 0/' + pending.length);

            let cursor = 0, done = 0, failed = 0;
            const worker = async () => {
                while (cursor < pending.length && this.running) {
                    const item = pending[cursor++];
                    try {
                        await this.fetchAudio(item);
                        done++;
                    } catch (e) {
                        failed++;
                        this.audioFailures.add(item.index);
                        addLog('听说: 预载 #' + item.index + ' 失败 ' + e.message, 'warn');
                    }
                    this.setStatus('选择题已处理 · 正在预载朗读音频 ' + (done + failed) + '/' + pending.length);
                }
            };
            await Promise.all(Array.from({ length: Math.min(6, pending.length) }, worker));
            if (!this.running) return false;
            addLog('听说: 朗读音频已就绪 ' + done + ' 条' + (failed ? '，' + failed + ' 条将在开录时重试' : ''),
                failed ? 'warn' : 'success');
            return done > 0 || this.audioCache.size > 0;
        },

        prepareAudio() {
            if (!this.readyPromise) {
                this.readyPromise = (async () => {
                    if (!this.manifest.length && !await this.loadManifest()) return false;
                    return this.preloadAudio();
                })();
            }
            return this.readyPromise;
        },

        /* ---------- 假麦克风 ---------- */

        async arm(early) {
            if (this.armed) {
                if (!early) await this.ensureAudioGraph(true);
                if (this.running) this.watchBar();
                return true;
            }
            if (early) this.ensureAudioGraph(false);
            else await this.ensureAudioGraph(true);
            this.stopBlocked = 0;

            const self = this;
            this.origGUM = navigator.mediaDevices.getUserMedia;
            navigator.mediaDevices.getUserMedia = function(c) {
                if (c && c.audio) {
                    // 真页面通常整场只取一次流；这里只负责换成假麦克风，
                    // 每一题的开始必须看 MediaRecorder.start 或考试栏相位。
                    self.gumCount++;
                    if (!self.micReady) addLog('听说: 页面已接管假麦克风', 'success');
                    self.micReady = true;
                    return Promise.resolve(self.stream);
                }
                return self.origGUM.call(this, c);
            };

            // 有些实现会在每题结束时 stop track；挡住它，保证下一题还能复用。
            this.origStop = MediaStreamTrack.prototype.stop;
            MediaStreamTrack.prototype.stop = function() {
                if (self.tracks.has(this)) {
                    self.stopBlocked++;
                    // jquery.recordwave 会在内部重置时 stop track。这里只拦截，
                    // 不能把它当成本题录音结束，否则刚起播的答案会被立即掐掉。
                    addLog('听说: 已保护假麦克风轨道 #' + self.stopBlocked, 'info');
                    return;
                }
                return self.origStop.call(this);
            };

            // 关键修复：getUserMedia 可能整场只调一次，MediaRecorder.start/stop
            // 才会每道口语题各调一次。旧实现因此永远只能灌第一题。
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.prototype) {
                const proto = MediaRecorder.prototype;
                this.origRecorderStart = proto.start;
                this.origRecorderStop = proto.stop;
                this.origRecorderPause = proto.pause;

                proto.start = function(...args) {
                    const ours = self.ownsRecorder(this);
                    const result = self.origRecorderStart.apply(this, args);
                    if (ours) {
                        self.recorderActive = true;
                        setTimeout(() => {
                            const phase = self.currentBarText();
                            // 听后回答可能整组只 start 一次，而且 start 发生在“请听题”。
                            // 有明确相位时交给活动考试栏逐题触发；没有考试栏才直接兜底。
                            if (!phase || /请答题|开始作答|正在录音|录音中/.test(phase)) {
                                self.onRecordStart('MediaRecorder.start');
                            }
                        }, 0);
                    }
                    return result;
                };
                proto.stop = function(...args) {
                    const ours = self.ownsRecorder(this);
                    const result = self.origRecorderStop.apply(this, args);
                    if (ours) {
                        self.recorderActive = false;
                        setTimeout(() => self.onRecordStop('MediaRecorder.stop'), 0);
                    }
                    return result;
                };
                if (typeof this.origRecorderPause === 'function') {
                    proto.pause = function(...args) {
                        const ours = self.ownsRecorder(this);
                        const result = self.origRecorderPause.apply(this, args);
                        if (ours) {
                            self.recorderActive = false;
                            setTimeout(() => self.onRecordStop('MediaRecorder.pause'), 0);
                        }
                        return result;
                    };
                }
            } else {
                addLog('听说: 页面没有原生 MediaRecorder，将按考试栏相位灌音', 'warn');
            }

            this.armed = true;
            if (!early) addLog('听说: 已挂假麦克风，等待每题进入录音阶段', 'success');
            if (this.running) this.watchBar();
            return true;
        },

        ownsRecorder(recorder) {
            if (!recorder) return false;
            if (recorder.stream === this.stream) return true;
            const tracks = recorder.stream && recorder.stream.getAudioTracks && recorder.stream.getAudioTracks();
            return !!(tracks && tracks.some(t => this.tracks && this.tracks.has(t)));
        },

        disarm() {
            if (!this.armed) return;
            this.onRecordStop('停止自动答题');
            this.stopChoiceWatcher();
            if (this._phaseTimer) clearTimeout(this._phaseTimer);
            this._phaseTimer = null;
            if (this._barTimer) clearInterval(this._barTimer);
            this._barTimer = null;
            if (this._barObs) this._barObs.disconnect();
            this._barObs = null;

            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.prototype) {
                const proto = MediaRecorder.prototype;
                if (this.origRecorderStart) proto.start = this.origRecorderStart;
                if (this.origRecorderStop) proto.stop = this.origRecorderStop;
                if (this.origRecorderPause) proto.pause = this.origRecorderPause;
            }
            if (this.origStop) {
                MediaStreamTrack.prototype.stop = this.origStop;
                for (const t of (this.tracks || [])) { try { this.origStop.call(t); } catch (e) { /* 已 ended */ } }
            }
            if (this.origGUM) navigator.mediaDevices.getUserMedia = this.origGUM;
            if (this.ctx && this.ctx.state !== 'closed') { try { this.ctx.close(); } catch (e) { /* 已关 */ } }
            this.ctx = this.gain = this.dest = this.stream = null;
            this.tracks = null; this.origGUM = this.origStop = null;
            this.origRecorderStart = this.origRecorderStop = this.origRecorderPause = null;
            this.audioCache.clear();
            this.readyPromise = null;
            this.micReady = false;
            this.recorderActive = false;
            this.armed = false;
            addLog('听说: 已卸载假麦克风（挡下 ' + this.stopBlocked + ' 次 track.stop）', 'info');
            this.paintBtn();
        },

        stopPlaying(reason) {
            const oldSource = this.source;
            if (oldSource) {
                try { oldSource.stop(); } catch (e) { /* 已停 */ }
                try { oldSource.disconnect(); } catch (e) { /* 已断 */ }
            }
            this.source = null;
            if (this.currentIndex != null) {
                addLog('听说: #' + this.currentIndex + ' 灌音结束' + (reason ? '（' + reason + '）' : ''), 'info');
            }
            this.currentIndex = null;
        },

        async onRecordStart(reason) {
            if (!this.armed || !this.running || this.recording || this.starting || this.source) return;
            this.recording = true;
            this.starting = true;
            const seq = ++this.recordSeq;

            try {
                // 全批次预载在后台进行，当前录音窗口绝不能等待它全部结束。
                // 清单尚未到时只做一次即时刷新，随后按当前题逐项等待 wav。
                await this.refreshManifest(true);
                if (!this.recording || seq !== this.recordSeq) return;
                if (this.approvalPending) {
                    if (!this.approvalWarned) {
                        addLog('听说: 当前题无法灌音：TTS 仍在等待审批，请先确认生成', 'warn');
                        this.approvalWarned = true;
                    }
                    this.setStatus('等待 TTS 审批 · 当前口语题保持静音');
                    this.recording = false;
                    return;
                }

                // 题卡和“请答题”往往不是同一帧更新，最多等 1.5 秒让当前题稳定。
                let pageText = '', m = null;
                for (let i = 0; i < 15 && this.recording && seq === this.recordSeq; i++) {
                    m = this.matchCurrent(i >= 10);
                    pageText = m ? m.pageText : (this.currentTexts()[0] || '');
                    if (m) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                if (!this.recording || seq !== this.recordSeq) return;
                if (!m) {
                    // 选择题阶段也可能出现“请答题”，没有口语容器时保持静音即可。
                    if (pageText) addLog('听说: 当前口语题没有匹配到朗读清单，保持静音', 'warn');
                    this.recording = false;
                    return;
                }

                let audio;
                try {
                    audio = await this.fetchAudioUntilReady(m.item, seq);
                } catch (e) {
                    addLog('听说: 取/解码 #' + m.item.index + ' 失败 ' + e.message + '，本题不标记为已用', 'error');
                    this.recording = false;
                    return;
                }
                if (!audio || !this.recording || seq !== this.recordSeq) return;

                // 下载或解码期间如果题卡已经切走，不得把旧答案播到新题。
                const now = this.matchCurrent(false);
                if (now && now.item.index !== m.item.index) {
                    addLog('听说: 题卡已切换，取消即将播放的 #' + m.item.index, 'warn');
                    this.recording = false;
                    return;
                }

                // 考试的“请等待”阶段可能让 AudioContext 再次 suspended；每题开播前恢复。
                await this.ensureAudioGraph(true);
                if (!this.recording || seq !== this.recordSeq) return;
                const src = this.ctx.createBufferSource();
                src.buffer = audio;
                // 与已经验证可用的 auto-fill 保持一致：录音窗口内持续有信号，
                // 由考试栏/录音器结束事件负责 stop，避免时序偏差只录到静音。
                src.loop = true;
                src.connect(this.gain);
                this.source = src;
                this.currentIndex = m.item.index;
                src.start();
                // 只有真正 start 成功后才算已用。旧代码在 fetch 前就 add，翻页即永久漏题。
                this.used.add(m.item.index);
                const track = this.stream && this.stream.getAudioTracks()[0];
                addLog('听说: 开录 → #' + m.item.index + '（' + reason + '，' + m.how + '，' +
                    audio.duration.toFixed(1) + 's，取流 ' + this.gumCount + ' 次，AudioContext ' +
                    this.ctx.state + (track ? '，track ' + track.readyState : '') +
                    '）「' + m.item.text.slice(0, 46) + '」', 'success');
            } catch (e) {
                this.recording = false;
                addLog('听说: 启动灌音失败 ' + e.message, 'error');
            } finally {
                this.starting = false;
            }
        },

        onRecordStop(reason) {
            if (!this.recording && !this.starting && !this.source && this.currentIndex == null) return;
            this.recording = false;
            this.starting = false;
            this.recordSeq++;
            this.stopPlaying(reason);
        },

        handleBarPhase(text) {
            if (!this.running || !text) return;
            if (this._phaseTimer) clearTimeout(this._phaseTimer);
            this._phaseTimer = null;

            if (/请答题|开始作答|正在录音|录音中/.test(text)) {
                // MediaRecorder 被第三方库封装时的兜底。稍等 250ms，让题卡先完成切换。
                this._phaseTimer = setTimeout(() => {
                    if (this.currentTexts().length) this.onRecordStart('考试栏:' + text);
                }, 250);
            } else if (/请稍等|请等待|请听题|播放|准备|结束|完成/.test(text)) {
                this.onRecordStop('考试栏:' + text);
            }
        },

        currentBarText() {
            const bars = [...document.querySelectorAll(SPK.barTitle)].filter(b => spkText(b));
            if (!bars.length) return '';
            const onScreen = bars.filter(spkOnScreen);
            return spkText((onScreen.length ? onScreen : bars)[0]);
        },

        /*
         * 页面为每个大题各放一套 examBar，document.querySelector 取到的通常是屏幕外第一套。
         * 这里持续选择与视口相交的活动栏；同一栏内题干切换也重新触发一次。
         */
        watchBar() {
            if (this._barTimer) return;
            let last = '', lastQuestion = '';
            const poll = () => {
                if (!this.running) return;
                const t = this.currentBarText();
                const question = this.currentTexts().join(' || ');
                const answerPhase = /请答题|开始作答|正在录音|录音中/.test(t);

                if (t !== last) {
                    if (t) {
                        addLog('听说: 活动考试栏「' + t + '」', 'info');
                        this.handleBarPhase(t);
                    } else if (/请答题|开始作答|正在录音|录音中/.test(last)) {
                        this.onRecordStop('活动考试栏离开');
                    }
                } else if (answerPhase && question && question !== lastQuestion) {
                    // 某些组合题保持“请答题”不变，只替换内部题干。
                    this.onRecordStop('题卡切换');
                    this.handleBarPhase(t);
                }
                last = t;
                lastQuestion = question;
            };
            poll();
            this._barTimer = setInterval(poll, 100);
        },

        paintBtn() {
            const b = document.getElementById('a366-spk-auto');
            if (!b) return;
            b.textContent = this.running ? '停止自动答题' : '自动答题';
            b.style.background = this.running ? 'var(--a366-danger)' : 'var(--a366-primary)';
            b.setAttribute('aria-pressed', this.running ? 'true' : 'false');
        },

        setStatus(text) {
            const st = document.getElementById('a366-spk-status');
            if (st) st.textContent = text;
        },

        /* ---------- 界面 ---------- */

        createUI() {
            container = document.createElement('div');
            container.id = 'a366-panel';
            container.style.cssText = 'position:fixed;bottom:20px;right:20px;width:340px;z-index:999999;' +
                'background:var(--a366-bg);border:1px solid var(--a366-border);border-radius:var(--a366-radius-lg);' +
                'box-shadow:var(--a366-shadow);font-size:13px;font-family:var(--a366-font);color:var(--a366-text);' +
                'display:flex;flex-direction:column;' + CSS_VARS;

            container.innerHTML =
                '<div id="a366-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--a366-border);background:var(--a366-bg-secondary);cursor:move;border-radius:var(--a366-radius-lg) var(--a366-radius-lg) 0 0;">' +
                  '<span style="font-weight:600;color:var(--a366-primary);">自动听说</span>' +
                  '<button id="a366-minimize" style="background:var(--a366-bg-tertiary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:2px 8px;font-size:11px;cursor:pointer;">_</button>' +
                '</div>' +
                '<div id="a366-body" style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;">' +
                  '<div id="a366-spk-status" style="padding:6px 8px;background:var(--a366-bg-secondary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-md);font-size:12px;color:var(--a366-text-secondary);">—</div>' +
                  '<button id="a366-spk-auto" style="width:100%;background:var(--a366-primary);color:#fff;border:none;border-radius:var(--a366-radius-md);padding:8px 12px;font-size:13px;cursor:pointer;font-weight:600;">自动答题</button>' +
                  '<div style="font-size:11px;color:var(--a366-text-muted);line-height:1.5;">先填写全部听后选择，再预载朗读音频；页面真正进入每题录音阶段时才自动送入对应答案。</div>' +
                '</div>' +
                '<div style="border-top:1px solid var(--a366-border);background:var(--a366-bg-secondary);border-radius:0 0 var(--a366-radius-lg) var(--a366-radius-lg);">' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 12px;">' +
                    '<span style="font-size:11px;color:var(--a366-text-secondary);">操作日志</span>' +
                    '<button id="a366-log-clear" style="background:var(--a366-bg-tertiary);border:1px solid var(--a366-border);border-radius:var(--a366-radius-sm);padding:1px 6px;font-size:10px;cursor:pointer;">清空</button>' +
                  '</div>' +
                  '<div id="a366-log-content" style="height:150px;overflow-y:auto;padding:4px 12px 8px;font-size:11px;font-family:Consolas,monospace;background:var(--a366-bg);"></div>' +
                '</div>';

            document.body.appendChild(container);
            logContent = document.getElementById('a366-log-content');

            document.getElementById('a366-spk-auto').addEventListener('click', () => {
                if (this.running) this.stopAuto();
                else this.runAuto();
            });
            document.getElementById('a366-log-clear').addEventListener('click', () => { logContent.innerHTML = ''; });
            document.getElementById('a366-minimize').addEventListener('click', () => {
                const b = document.getElementById('a366-body');
                b.style.display = b.style.display === 'none' ? 'flex' : 'none';
            });
            makeDraggable(container, document.getElementById('a366-header'));

            this.setAnswers(this.answers);
            addLog('规则集 v8（听说界面，' + (this.detectedBy || '答案题型') + '）· bucket ' + BUCKET_URL +
                (window.__A366__ ? '（代理注入）' : '（默认端口）'), 'info');
            if (this.answers.length) {
                const kinds = {};
                this.answers.forEach(a => { kinds[a.pattern] = (kinds[a.pattern] || 0) + 1; });
                addLog('题型: ' + Object.keys(kinds).map(k => k + ' ' + kinds[k]).join(' / '), 'info');
            } else {
                addLog('听说: 答案还没解出来，后台继续拉…', 'info');
            }
        },

        setAnswers(answers) {
            this.answers = Array.isArray(answers) ? answers : [];
            this.choices = this.answers.filter(a => /听后选择/.test(a.pattern || ''));
            if (!this.running) this.setStatus('听说卷 · 共 ' + this.answers.length + ' 条 · 选择题 ' + this.choices.length + ' 道');
        },

        /* 靠页面结构进来的时候答案还没解出来，后台接着拉 */
        async waitAnswers(maxMs) {
            const deadline = Date.now() + (maxMs || 60000);
            while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 1000));
                const a = await probeAnswers();
                if (a.length) {
                    this.setAnswers(a);
                    const kinds = {};
                    a.forEach(x => { kinds[x.pattern] = (kinds[x.pattern] || 0) + 1; });
                    addLog('听说: 答案已到 ' + a.length + ' 条 —— ' +
                        Object.keys(kinds).map(k => k + ' ' + kinds[k]).join(' / '), 'success');
                    return true;
                }
            }
            addLog('听说: 一直没拿到答案，选择题填不了（灌音不受影响）', 'warn');
            return false;
        },

        async runAuto() {
            if (this.running) return;
            this.running = true;
            this.paintBtn();
            this.setStatus('正在启动自动答题…');
            addLog('听说: 自动答题启动，先处理选择题，再准备口语音频', 'info');

            try {
                // 先接管麦克风，避免用户点下按钮后页面恰好申请真麦克风。
                await this.arm();
                if (!this.answers.length) await this.waitAnswers(15000);
                if (!this.running) return;

                const filled = this.fillChoices(false);
                this.startChoiceWatcher();
                this.setStatus('选择题已处理' + (filled ? ' ' + filled + ' 道' : '') + ' · 等待朗读音频');

                const ready = await this.prepareAudio();
                if (!this.running) return;
                if (ready) {
                    this.setStatus('自动答题运行中 · 朗读清单已接收 · 已缓存 ' + this.audioCache.size + ' 条');
                    addLog('听说: 自动答题已就绪；整批未完成也会按题接入，当前 wav 晚到会在录音窗口内追赶', 'success');
                } else {
                    if (this.approvalPending) {
                        this.setStatus('选择题自动处理正常 · TTS 等待审批');
                        addLog('听说: 尚未确认生成 TTS；请处理审批窗口，选择题仍会继续自动填写', 'warn');
                    } else {
                        this.setStatus('选择题自动处理正常 · 朗读音频尚未就绪');
                        addLog('听说: 朗读音频未就绪；选择题仍会继续自动填写', 'warn');
                    }
                }
            } catch (e) {
                addLog('听说: 自动答题启动失败 ' + e.message, 'error');
                this.stopAuto();
            }
        },

        stopAuto() {
            if (!this.running && !this.armed) return;
            this.running = false;
            this.recordSeq++;
            this.stopChoiceWatcher();
            if (this.armed) this.disarm();
            this.setStatus('自动答题已停止 · 已完成口语 ' + this.used.size + ' 条');
            this.paintBtn();
        },

        init(answers, by) {
            this.detectedBy = by || '';
            this.setAnswers(answers);
            const earlyMic = this.arm(true);
            this.createUI();
            earlyMic.then(() => addLog('听说: 已提前接管麦克风，页面已取流 ' + this.gumCount + ' 次，等待自动答题启动', 'success'))
                .catch(e => addLog('听说: 提前接管麦克风失败 ' + e.message, 'error'));
            if (!this.answers.length) this.waitAnswers(60000);
        },
    };

    // 页面在 DOMContentLoaded 前就开始异步加载 jquery.recordwave.js，它可能先缓存麦克风。
    // 因此不能等用户点击按钮或模式识别完成；脚本一执行就先交出稳定的假流。
    Speaking.arm(true).catch(() => { /* init/runAuto 会再次尝试并显示错误 */ });

    // ==========================================
    // 初始化：先看这份卷子是什么，再决定挂哪套界面
    // ==========================================

    async function probeAnswers() {
        try {
            const r = await fetch(BUCKET_URL + ANSWER_PATH, { cache: 'no-cache' });
            if (!r.ok) return [];
            const d = await r.json();
            const list = (d && (d.answers || d.data || d)) || [];
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function isSpeakingPaper(answers) {
        const kinds = new Set(answers.map(a => a.pattern || ''));
        // 听说卷必然包含「听后转述」；答案里没有转述就一律按听力面板处理，
        // 即使混入了听后回答/朗读短文等口语题型，也不进听说界面。
        if (![...kinds].some(k => k.indexOf('转述') >= 0)) return false;
        return SPEAK_PATTERNS.some(p => [...kinds].some(k => k.indexOf(p) >= 0));
    }

    /* 页面上有口语题容器 —— 答案接口还没准备好时的第二个判据 */
    function domLooksSpeaking() {
        return [...document.querySelectorAll(SPK.speakHost)].some(spkVisible);
    }

    // 注入时机比页面渲染早，答案也要等代理层把试卷 zip 解完，
    // 所以两个判据都轮询：谁先给出肯定答复就按它挑界面。
    // 都没结果时退回基础听力界面（原本的行为）。
    async function detectMode(maxMs) {
        const deadline = Date.now() + maxMs;
        let answers = [];
        while (Date.now() < deadline) {
            answers = await probeAnswers();
            if (answers.length) {
                return { mode: isSpeakingPaper(answers) ? 'speaking' : 'listening', answers, by: '答案题型' };
            }
            if (domLooksSpeaking()) return { mode: 'speaking', answers: [], by: '页面结构' };
            await new Promise(r => setTimeout(r, 500));
        }
        return { mode: 'listening', answers: [], by: '超时兜底' };
    }

    async function boot() {
        const d = await detectMode(8000);
        if (d.mode === 'speaking') {
            // 结构判出来的情况下答案可能还在路上，Speaking 自己会再补拉一次
            Speaking.init(d.answers, d.by);
        } else {
            createUI();
            addLog('规则集 v8（基础听力界面，' + d.by + '）· bucket ' + BUCKET_URL +
                (window.__A366__ ? '（代理注入）' : '（默认端口）'), 'info');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
