(function() {
'use strict';

var BUCKET_SERVER = 'http://127.0.0.1:5290';

var State = {
    collecting: false,
    autoRefresh: true,
    refreshInterval: 3000,
    refreshTimerId: null,
    collectedData: {
        metadata: {},
        questions: [],
        audioResources: [],
        mediaResources: [],
        networkRequests: [],
        domStructure: {},
        globalVars: {},
        localStorage: {},
        pageConfig: {},
        rawHTML: '',
        allText: ''
    },
    logMessages: [],
    networkLog: [],
    originalXHROpen: null,
    originalXHRSend: null,
    originalFetch: null
};

var UI = {
    mainPanel: null,
    logPanel: null,
    dataPanel: null,
    activeTab: 'overview',
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    isResizing: false,
    resizeStart: { x: 0, y: 0, w: 0, h: 0 },

    addLog: function(message, type) {
        type = type || 'info';
        var timestamp = new Date().toLocaleTimeString();
        State.logMessages.unshift({ timestamp: timestamp, message: message, type: type });
        if (State.logMessages.length > 500) {
            State.logMessages = State.logMessages.slice(0, 500);
        }
        UI.updateLogPanel();
    },

    updateLogPanel: function() {
        if (!UI.logPanel) return;
        var logContent = UI.logPanel.querySelector('.al-log-content');
        if (!logContent) return;
        var html = '';
        var msgs = State.logMessages.slice(0, 200);
        for (var i = msgs.length - 1; i >= 0; i--) {
            var msg = msgs[i];
            var color = '#ccc';
            if (msg.type === 'success') color = '#4caf50';
            if (msg.type === 'error') color = '#f44336';
            if (msg.type === 'warning') color = '#ff9800';
            if (msg.type === 'match') color = '#2196f3';
            html += '<div style="color:' + color + ';font-size:11px;line-height:1.4;padding:1px 0;word-break:break-all;">' +
                '<span style="color:#888">[' + msg.timestamp + ']</span> ' + msg.message + '</div>';
        }
        logContent.innerHTML = html;
    },

    createMainPanel: function() {
        if (UI.mainPanel) return;

        var panel = document.createElement('div');
        panel.id = 'al-main-panel';
        panel.style.cssText = 'position:fixed;right:10px;bottom:10px;width:520px;height:480px;' +
            'background:rgba(20,20,30,0.96);color:#e0e0e0;border-radius:10px;' +
            'z-index:99999;font-family:"Microsoft YaHei","Segoe UI",sans-serif;font-size:13px;' +
            'box-shadow:0 4px 24px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;' +
            'border:1px solid rgba(100,100,255,0.3);user-select:text;';

        var header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;' +
            'padding:8px 12px;background:linear-gradient(135deg,#1a237e,#283593);cursor:move;' +
            'border-bottom:1px solid rgba(100,100,255,0.3);';
        header.innerHTML = '<span style="font-weight:bold;font-size:14px;color:#fff;">🔍 基础听力信息收集器</span>';

        var headerBtns = document.createElement('div');
        headerBtns.style.cssText = 'display:flex;gap:4px;align-items:center;';

        var collectBtn = document.createElement('button');
        collectBtn.id = 'al-collect-btn';
        collectBtn.textContent = '开始收集';
        collectBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;background:#4caf50;color:#fff;' +
            'border:none;border-radius:3px;';
        collectBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (State.collecting) {
                Collector.stop();
            } else {
                Collector.start();
            }
        });
        headerBtns.appendChild(collectBtn);

        var exportBtn = document.createElement('button');
        exportBtn.textContent = '导出';
        exportBtn.title = '导出收集的数据到本地';
        exportBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;background:#2196f3;color:#fff;' +
            'border:none;border-radius:3px;';
        exportBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            Exporter.exportJSON();
        });
        headerBtns.appendChild(exportBtn);

        var exportFullBtn = document.createElement('button');
        exportFullBtn.textContent = '全量导出';
        exportFullBtn.title = '导出包含完整HTML的详细数据';
        exportFullBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;background:#9c27b0;color:#fff;' +
            'border:none;border-radius:3px;';
        exportFullBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            Exporter.exportFull();
        });
        headerBtns.appendChild(exportFullBtn);

        var copyBtn = document.createElement('button');
        copyBtn.textContent = '复制';
        copyBtn.title = '复制收集的数据到剪贴板';
        copyBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;background:#ff9800;color:#fff;' +
            'border:none;border-radius:3px;';
        copyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            Exporter.copyToClipboard();
        });
        headerBtns.appendChild(copyBtn);

        var minimizeBtn = document.createElement('button');
        minimizeBtn.textContent = '—';
        minimizeBtn.style.cssText = 'font-size:14px;padding:0 6px;cursor:pointer;background:transparent;' +
            'color:#fff;border:none;';
        minimizeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var body = panel.querySelector('.al-panel-body');
            if (body) {
                body.style.display = body.style.display === 'none' ? 'flex' : 'none';
            }
        });
        headerBtns.appendChild(minimizeBtn);

        var closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'font-size:16px;padding:0 6px;cursor:pointer;background:transparent;' +
            'color:#fff;border:none;';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            Collector.stop();
            panel.style.display = 'none';
        });
        headerBtns.appendChild(closeBtn);

        header.appendChild(headerBtns);
        panel.appendChild(header);

        header.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            UI.isDragging = true;
            UI.dragOffset.x = e.clientX - panel.offsetLeft;
            UI.dragOffset.y = e.clientY - panel.offsetTop;
            e.preventDefault();
        });

        var body = document.createElement('div');
        body.className = 'al-panel-body';
        body.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';

        var tabBar = document.createElement('div');
        tabBar.style.cssText = 'display:flex;background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(100,100,255,0.2);';

        var tabs = [
            { id: 'overview', label: '概览' },
            { id: 'questions', label: '题目' },
            { id: 'audio', label: '音频' },
            { id: 'network', label: '网络' },
            { id: 'structure', label: '结构' },
            { id: 'raw', label: '原始数据' },
            { id: 'log', label: '日志' }
        ];

        tabs.forEach(function(tab) {
            var tabBtn = document.createElement('button');
            tabBtn.textContent = tab.label;
            tabBtn.dataset.tab = tab.id;
            tabBtn.style.cssText = 'flex:1;padding:6px 4px;font-size:11px;cursor:pointer;' +
                'background:transparent;color:#aaa;border:none;border-bottom:2px solid transparent;' +
                'transition:all 0.2s;';
            tabBtn.addEventListener('click', function() {
                UI.switchTab(tab.id);
            });
            tabBar.appendChild(tabBtn);
        });

        body.appendChild(tabBar);

        var contentArea = document.createElement('div');
        contentArea.className = 'al-content-area';
        contentArea.style.cssText = 'flex:1;overflow-y:auto;padding:8px;font-size:12px;line-height:1.5;';

        body.appendChild(contentArea);
        panel.appendChild(body);

        var resizeHandle = document.createElement('div');
        resizeHandle.style.cssText = 'position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize;' +
            'background:linear-gradient(135deg,transparent 50%,rgba(100,100,255,0.3) 50%);';
        resizeHandle.addEventListener('mousedown', function(e) {
            UI.isResizing = true;
            UI.resizeStart = { x: e.clientX, y: e.clientY, w: panel.offsetWidth, h: panel.offsetHeight };
            e.preventDefault();
            e.stopPropagation();
        });
        panel.appendChild(resizeHandle);

        document.addEventListener('mousemove', function(e) {
            if (UI.isDragging) {
                panel.style.left = (e.clientX - UI.dragOffset.x) + 'px';
                panel.style.top = (e.clientY - UI.dragOffset.y) + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
            }
            if (UI.isResizing) {
                var newW = Math.max(350, UI.resizeStart.w + (e.clientX - UI.resizeStart.x));
                var newH = Math.max(250, UI.resizeStart.h + (e.clientY - UI.resizeStart.y));
                panel.style.width = newW + 'px';
                panel.style.height = newH + 'px';
            }
        });

        document.addEventListener('mouseup', function() {
            UI.isDragging = false;
            UI.isResizing = false;
        });

        document.body.appendChild(panel);
        UI.mainPanel = panel;
        UI.dataPanel = contentArea;

        UI.switchTab('overview');
    },

    switchTab: function(tabId) {
        UI.activeTab = tabId;
        var tabBar = UI.mainPanel.querySelector('.al-panel-body > div:first-child');
        if (tabBar) {
            var btns = tabBar.querySelectorAll('button');
            btns.forEach(function(btn) {
                if (btn.dataset.tab === tabId) {
                    btn.style.color = '#fff';
                    btn.style.borderBottomColor = '#448aff';
                    btn.style.background = 'rgba(68,138,255,0.15)';
                } else {
                    btn.style.color = '#aaa';
                    btn.style.borderBottomColor = 'transparent';
                    btn.style.background = 'transparent';
                }
            });
        }
        UI.renderContent();
    },

    renderContent: function() {
        if (!UI.dataPanel) return;
        var html = '';
        switch (UI.activeTab) {
            case 'overview':
                html = UI.renderOverview();
                break;
            case 'questions':
                html = UI.renderQuestions();
                break;
            case 'audio':
                html = UI.renderAudio();
                break;
            case 'network':
                html = UI.renderNetwork();
                break;
            case 'structure':
                html = UI.renderStructure();
                break;
            case 'raw':
                html = UI.renderRaw();
                break;
            case 'log':
                html = UI.renderLog();
                break;
        }
        UI.dataPanel.innerHTML = html;
    },

    escHtml: function(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    renderOverview: function() {
        var d = State.collectedData;
        var h = '<div style="margin-bottom:8px;padding:6px 8px;background:rgba(68,138,255,0.1);border-radius:4px;border-left:3px solid #448aff;">';
        h += '<div style="font-weight:bold;font-size:13px;margin-bottom:4px;">📊 收集概览</div>';
        h += '</div>';

        h += '<table style="width:100%;border-collapse:collapse;">';
        var rows = [
            ['页面标题', d.metadata.title || '未获取'],
            ['页面URL', d.metadata.url || '未获取'],
            ['收集状态', State.collecting ? '<span style="color:#4caf50">● 收集中</span>' : '<span style="color:#f44336">○ 已停止</span>'],
            ['题目数量', d.questions.length + ' 个'],
            ['音频资源', d.audioResources.length + ' 个'],
            ['媒体资源', d.mediaResources.length + ' 个'],
            ['网络请求', d.networkRequests.length + ' 条'],
            ['全局变量', Object.keys(d.globalVars).length + ' 个'],
            ['localStorage', Object.keys(d.localStorage).length + ' 项'],
            ['页面配置', Object.keys(d.pageConfig).length + ' 项'],
            ['HTML长度', d.rawHTML.length + ' 字符'],
            ['文本长度', d.allText.length + ' 字符']
        ];
        rows.forEach(function(row) {
            h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                '<td style="padding:4px 8px;color:#aaa;white-space:nowrap;">' + row[0] + '</td>' +
                '<td style="padding:4px 8px;word-break:break-all;">' + row[1] + '</td></tr>';
        });
        h += '</table>';

        if (d.metadata.title) {
            h += '<div style="margin-top:10px;padding:6px 8px;background:rgba(0,0,0,0.2);border-radius:4px;">';
            h += '<div style="font-weight:bold;margin-bottom:4px;color:#448aff;">页面元数据</div>';
            h += '<pre style="font-size:11px;white-space:pre-wrap;word-break:break-all;margin:0;color:#ccc;">' +
                UI.escHtml(JSON.stringify(d.metadata, null, 2)) + '</pre></div>';
        }

        return h;
    },

    renderQuestions: function() {
        var qs = State.collectedData.questions;
        var h = '<div style="margin-bottom:8px;padding:6px 8px;background:rgba(76,175,80,0.1);border-radius:4px;border-left:3px solid #4caf50;">';
        h += '<div style="font-weight:bold;font-size:13px;">📝 题目数据 <span style="color:#aaa;font-weight:normal;">(' + qs.length + ' 个)</span></div>';
        h += '</div>';

        if (qs.length === 0) {
            h += '<div style="color:#888;text-align:center;padding:20px;">暂无题目数据，请先开始收集</div>';
            return h;
        }

        qs.forEach(function(q, idx) {
            h += '<div style="margin-bottom:8px;padding:6px 8px;background:rgba(0,0,0,0.2);border-radius:4px;">';
            h += '<div style="color:#4caf50;font-weight:bold;margin-bottom:3px;">题目 #' + (idx + 1) +
                ' <span style="color:#888;font-weight:normal;">[' + UI.escHtml(q.type || '未知类型') + ']</span></div>';

            if (q.text) {
                h += '<div style="margin-bottom:3px;"><span style="color:#aaa;">题干:</span> ' + UI.escHtml(q.text) + '</div>';
            }
            if (q.options && q.options.length > 0) {
                h += '<div style="margin-bottom:3px;"><span style="color:#aaa;">选项:</span></div>';
                q.options.forEach(function(opt, oi) {
                    var isAnswer = q.answer && (q.answer === opt || q.answer === String.fromCharCode(65 + oi));
                    h += '<div style="padding-left:12px;' + (isAnswer ? 'color:#4caf50;font-weight:bold;' : '') + '">' +
                        String.fromCharCode(65 + oi) + '. ' + UI.escHtml(opt) + (isAnswer ? ' ✓' : '') + '</div>';
                });
            }
            if (q.answer) {
                h += '<div style="margin-top:3px;"><span style="color:#aaa;">答案:</span> <span style="color:#4caf50;">' + UI.escHtml(q.answer) + '</span></div>';
            }
            if (q.audioUrl) {
                h += '<div style="margin-top:3px;"><span style="color:#aaa;">音频:</span> <span style="color:#2196f3;font-size:11px;word-break:break-all;">' + UI.escHtml(q.audioUrl) + '</span></div>';
            }
            if (q.elementId) {
                h += '<div style="color:#888;font-size:10px;">ID: ' + UI.escHtml(q.elementId) + '</div>';
            }
            if (q.cssClass) {
                h += '<div style="color:#888;font-size:10px;">Class: ' + UI.escHtml(q.cssClass) + '</div>';
            }
            h += '</div>';
        });

        return h;
    },

    renderAudio: function() {
        var audios = State.collectedData.audioResources;
        var h = '<div style="margin-bottom:8px;padding:6px 8px;background:rgba(33,150,243,0.1);border-radius:4px;border-left:3px solid #2196f3;">';
        h += '<div style="font-weight:bold;font-size:13px;">🔊 音频资源 <span style="color:#aaa;font-weight:normal;">(' + audios.length + ' 个)</span></div>';
        h += '</div>';

        if (audios.length === 0) {
            h += '<div style="color:#888;text-align:center;padding:20px;">暂无音频资源</div>';
            return h;
        }

        audios.forEach(function(audio, idx) {
            h += '<div style="margin-bottom:6px;padding:6px 8px;background:rgba(0,0,0,0.2);border-radius:4px;">';
            h += '<div style="color:#2196f3;font-weight:bold;">音频 #' + (idx + 1) + '</div>';
            if (audio.src) {
                h += '<div style="font-size:11px;word-break:break-all;color:#ccc;">URL: ' + UI.escHtml(audio.src) + '</div>';
            }
            if (audio.type) {
                h += '<div style="font-size:11px;color:#888;">类型: ' + UI.escHtml(audio.type) + '</div>';
            }
            if (audio.duration) {
                h += '<div style="font-size:11px;color:#888;">时长: ' + audio.duration.toFixed(2) + 's</div>';
            }
            if (audio.tagName) {
                h += '<div style="font-size:11px;color:#888;">标签: ' + UI.escHtml(audio.tagName) + '</div>';
            }
            if (audio.parentInfo) {
                h += '<div style="font-size:11px;color:#888;">父元素: ' + UI.escHtml(audio.parentInfo) + '</div>';
            }
            h += '</div>';
        });

        return h;
    },

    renderNetwork: function() {
        var nets = State.collectedData.networkRequests;
        var h = '<div style="margin-bottom:8px;padding:6px 8px;background:rgba(255,152,0,0.1);border-radius:4px;border-left:3px solid #ff9800;">';
        h += '<div style="font-weight:bold;font-size:13px;">🌐 网络请求 <span style="color:#aaa;font-weight:normal;">(' + nets.length + ' 条)</span></div>';
        h += '</div>';

        if (nets.length === 0) {
            h += '<div style="color:#888;text-align:center;padding:20px;">暂无网络请求数据</div>';
            return h;
        }

        nets.forEach(function(net, idx) {
            var statusColor = net.status >= 200 && net.status < 300 ? '#4caf50' : '#f44336';
            h += '<div style="margin-bottom:4px;padding:4px 8px;background:rgba(0,0,0,0.2);border-radius:3px;">';
            h += '<div style="display:flex;justify-content:space-between;">' +
                '<span style="color:#ff9800;font-size:11px;">' + UI.escHtml(net.method || 'GET') + '</span>' +
                '<span style="color:' + statusColor + ';font-size:11px;">' + (net.status || '...') + '</span></div>';
            h += '<div style="font-size:11px;word-break:break-all;color:#ccc;">' + UI.escHtml(net.url || '') + '</div>';
            if (net.responseType) {
                h += '<div style="font-size:10px;color:#888;">响应类型: ' + UI.escHtml(net.responseType) + '</div>';
            }
            if (net.responseSize) {
                h += '<div style="font-size:10px;color:#888;">响应大小: ' + net.responseSize + ' 字节</div>';
            }
            h += '</div>';
        });

        return h;
    },

    renderStructure: function() {
        var d = State.collectedData;
        var h = '<div style="margin-bottom:8px;padding:6px 8px;background:rgba(156,39,176,0.1);border-radius:4px;border-left:3px solid #9c27b0;">';
        h += '<div style="font-weight:bold;font-size:13px;">🏗️ 页面结构</div>';
        h += '</div>';

        if (d.domStructure && d.domStructure.children) {
            h += '<div style="margin-bottom:8px;">';
            h += '<div style="color:#9c27b0;font-weight:bold;margin-bottom:4px;">DOM 树摘要</div>';
            h += '<div style="font-size:11px;color:#aaa;">总元素数: ' + (d.domStructure.totalElements || 0) + '</div>';
            h += '<div style="font-size:11px;color:#aaa;">最大深度: ' + (d.domStructure.maxDepth || 0) + '</div>';
            h += '</div>';
            h += '<div style="max-height:300px;overflow-y:auto;background:rgba(0,0,0,0.2);border-radius:4px;padding:6px;">';
            h += UI.renderDomTree(d.domStructure, 0);
            h += '</div>';
        }

        if (Object.keys(d.globalVars).length > 0) {
            h += '<div style="margin-top:8px;">';
            h += '<div style="color:#9c27b0;font-weight:bold;margin-bottom:4px;">全局变量</div>';
            h += '<pre style="font-size:11px;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,0.2);padding:6px;border-radius:4px;margin:0;color:#ccc;">' +
                UI.escHtml(JSON.stringify(d.globalVars, null, 2)) + '</pre></div>';
        }

        if (Object.keys(d.pageConfig).length > 0) {
            h += '<div style="margin-top:8px;">';
            h += '<div style="color:#9c27b0;font-weight:bold;margin-bottom:4px;">页面配置</div>';
            h += '<pre style="font-size:11px;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,0.2);padding:6px;border-radius:4px;margin:0;color:#ccc;">' +
                UI.escHtml(JSON.stringify(d.pageConfig, null, 2)) + '</pre></div>';
        }

        return h;
    },

    renderDomTree: function(node, depth) {
        if (!node || depth > 6) return '';
        var indent = depth * 16;
        var h = '<div style="padding-left:' + indent + 'px;font-size:11px;line-height:1.6;">';
        var tagColor = '#9c27b0';
        h += '<span style="color:' + tagColor + ';">&lt;' + UI.escHtml(node.tag || 'unknown');
        if (node.id) h += ' <span style="color:#ff9800;">id="' + UI.escHtml(node.id) + '"</span>';
        if (node.classes && node.classes.length > 0) {
            h += ' <span style="color:#4caf50;">class="' + UI.escHtml(node.classes.join(' ')) + '"</span>';
        }
        if (node.text && node.text.length > 0 && node.text.length < 100) {
            h += ' <span style="color:#888;">→ ' + UI.escHtml(node.text.substring(0, 80)) + (node.text.length > 80 ? '...' : '') + '</span>';
        }
        h += '&gt;</span>';
        h += '</div>';
        if (node.children && node.children.length > 0) {
            var limit = depth < 2 ? 20 : 5;
            var shown = node.children.slice(0, limit);
            shown.forEach(function(child) {
                h += UI.renderDomTree(child, depth + 1);
            });
            if (node.children.length > limit) {
                h += '<div style="padding-left:' + (indent + 16) + 'px;font-size:11px;color:#888;">... 还有 ' + (node.children.length - limit) + ' 个子元素</div>';
            }
        }
        return h;
    },

    renderRaw: function() {
        var d = State.collectedData;
        var h = '<div style="margin-bottom:8px;padding:6px 8px;background:rgba(244,67,54,0.1);border-radius:4px;border-left:3px solid #f44336;">';
        h += '<div style="font-weight:bold;font-size:13px;">📄 原始数据</div>';
        h += '</div>';
        h += '<pre style="font-size:10px;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,0.3);' +
            'padding:8px;border-radius:4px;max-height:380px;overflow-y:auto;color:#ccc;margin:0;">' +
            UI.escHtml(JSON.stringify(d, null, 2)) + '</pre>';
        return h;
    },

    renderLog: function() {
        var h = '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">';
        h += '<div style="font-weight:bold;font-size:13px;color:#fff;">📋 运行日志</div>';
        h += '<button onclick="document.querySelector(\'#al-main-panel\').__alExportLogs()" style="font-size:10px;padding:2px 8px;cursor:pointer;background:#2196f3;color:#fff;border:none;border-radius:3px;">导出日志</button>';
        h += '</div>';
        h += '<div class="al-log-content" style="max-height:360px;overflow-y:auto;background:rgba(0,0,0,0.2);padding:6px;border-radius:4px;">';
        var msgs = State.logMessages.slice(0, 200);
        for (var i = msgs.length - 1; i >= 0; i--) {
            var msg = msgs[i];
            var color = '#ccc';
            if (msg.type === 'success') color = '#4caf50';
            if (msg.type === 'error') color = '#f44336';
            if (msg.type === 'warning') color = '#ff9800';
            if (msg.type === 'match') color = '#2196f3';
            h += '<div style="color:' + color + ';font-size:11px;line-height:1.4;padding:1px 0;word-break:break-all;">' +
                '<span style="color:#888">[' + msg.timestamp + ']</span> ' + UI.escHtml(msg.message) + '</div>';
        }
        h += '</div>';
        return h;
    }
};

var Collector = {
    start: function() {
        State.collecting = true;
        var btn = document.getElementById('al-collect-btn');
        if (btn) {
            btn.textContent = '停止收集';
            btn.style.background = '#f44336';
        }
        UI.addLog('开始收集页面信息...', 'success');
        Collector.collectAll();
        if (State.autoRefresh) {
            State.refreshTimerId = setInterval(function() {
                if (State.collecting) {
                    Collector.collectAll();
                }
            }, State.refreshInterval);
        }
    },

    stop: function() {
        State.collecting = false;
        if (State.refreshTimerId) {
            clearInterval(State.refreshTimerId);
            State.refreshTimerId = null;
        }
        var btn = document.getElementById('al-collect-btn');
        if (btn) {
            btn.textContent = '开始收集';
            btn.style.background = '#4caf50';
        }
        UI.addLog('停止收集', 'warning');
    },

    collectAll: function() {
        try {
            Collector.collectMetadata();
            Collector.collectQuestions();
            Collector.collectAudioResources();
            Collector.collectMediaResources();
            Collector.collectDomStructure();
            Collector.collectGlobalVars();
            Collector.collectLocalStorage();
            Collector.collectPageConfig();
            Collector.collectRawHTML();
            Collector.collectAllText();
            UI.renderContent();
        } catch (e) {
            UI.addLog('收集出错: ' + e.message, 'error');
        }
    },

    collectMetadata: function() {
        State.collectedData.metadata = {
            title: document.title || '',
            url: window.location.href || '',
            domain: window.location.hostname || '',
            pathname: window.location.pathname || '',
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent || '',
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            documentHeight: document.documentElement.scrollHeight,
            charset: document.characterSet || '',
            contentType: document.contentType || '',
            referrer: document.referrer || '',
            cookie: document.cookie || ''
        };
    },

    collectQuestions: function() {
        var questions = [];
        var seenTexts = {};

        var questionSelectors = [
            '[class*="question"]',
            '[class*="Question"]',
            '[class*="topic"]',
            '[class*="Topic"]',
            '[class*="item-"]',
            '[class*="slide"]',
            '[class*="Slide"]',
            '.u3-question',
            '.u3-topic',
            '.question-item',
            '.question-content',
            '.topic-item',
            '.topic-content',
            '[data-question]',
            '[data-topic]',
            '[data-index]',
            '.el-question',
            '.el-topic'
        ];

        var questionElements = [];
        questionSelectors.forEach(function(sel) {
            try {
                var els = document.querySelectorAll(sel);
                els.forEach(function(el) {
                    if (questionElements.indexOf(el) === -1) {
                        questionElements.push(el);
                    }
                });
            } catch (e) {}
        });

        if (questionElements.length === 0) {
            var potentialContainers = document.querySelectorAll('div, section, article, li');
            potentialContainers.forEach(function(el) {
                var hasInput = el.querySelector('input, textarea, select, [contenteditable]');
                var hasOptions = el.querySelectorAll('[class*="option"], [class*="Option"], [class*="choice"], [class*="Choice"]').length > 0;
                var hasAudio = el.querySelector('audio, video, [class*="audio"], [class*="Audio"]');
                var text = (el.textContent || '').trim();
                if ((hasInput || hasOptions || hasAudio) && text.length > 5 && text.length < 2000) {
                    if (questionElements.indexOf(el) === -1) {
                        questionElements.push(el);
                    }
                }
            });
        }

        questionElements.forEach(function(el, idx) {
            var text = Collector.extractQuestionText(el);
            if (!text || text.length < 1) return;

            var key = text.substring(0, 100);
            if (seenTexts[key]) return;
            seenTexts[key] = true;

            var q = {
                index: idx,
                text: text,
                type: Collector.detectQuestionType(el),
                options: Collector.extractOptions(el),
                answer: Collector.extractAnswer(el),
                audioUrl: Collector.extractAudioUrl(el),
                elementId: el.id || '',
                cssClass: el.className || '',
                childCount: el.children.length,
                innerHTML: el.innerHTML.substring(0, 500)
            };

            questions.push(q);
        });

        if (questions.length === 0) {
            var allInputs = document.querySelectorAll('input, textarea, select');
            var inputGroups = {};
            allInputs.forEach(function(input) {
                var parent = input.closest('div, li, section');
                if (parent) {
                    var pid = parent.id || parent.className || 'group_' + Object.keys(inputGroups).length;
                    if (!inputGroups[pid]) {
                        inputGroups[pid] = { element: parent, inputs: [] };
                    }
                    inputGroups[pid].inputs.push(input);
                }
            });

            Object.keys(inputGroups).forEach(function(key, idx) {
                var group = inputGroups[key];
                var text = Collector.extractQuestionText(group.element);
                if (!text || text.length < 1) return;

                var q = {
                    index: idx,
                    text: text,
                    type: 'input-group',
                    options: [],
                    answer: '',
                    audioUrl: Collector.extractAudioUrl(group.element),
                    elementId: group.element.id || '',
                    cssClass: group.element.className || '',
                    inputCount: group.inputs.length,
                    inputTypes: group.inputs.map(function(i) { return i.type || i.tagName.toLowerCase(); }),
                    innerHTML: group.element.innerHTML.substring(0, 500)
                };

                questions.push(q);
            });
        }

        State.collectedData.questions = questions;
        if (questions.length > 0) {
            UI.addLog('收集到 ' + questions.length + ' 个题目', 'success');
        }
    },

    extractQuestionText: function(el) {
        var textSelectors = [
            '[class*="stem"]', '[class*="Stem"]',
            '[class*="title"]', '[class*="Title"]',
            '[class*="text"]', '[class*="Text"]',
            '[class*="content"]', '[class*="Content"]',
            '[class*="desc"]', '[class*="Desc"]',
            '.question-text', '.topic-text',
            'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
        ];

        for (var i = 0; i < textSelectors.length; i++) {
            try {
                var textEl = el.querySelector(textSelectors[i]);
                if (textEl) {
                    var t = (textEl.textContent || '').trim();
                    if (t.length > 2) return t.substring(0, 1000);
                }
            } catch (e) {}
        }

        var directText = '';
        for (var j = 0; j < el.childNodes.length; j++) {
            var node = el.childNodes[j];
            if (node.nodeType === 3) {
                directText += node.textContent.trim() + ' ';
            }
        }
        if (directText.trim().length > 2) return directText.trim().substring(0, 1000);

        var fullText = (el.textContent || '').trim();
        if (fullText.length > 2) return fullText.substring(0, 1000);

        return '';
    },

    detectQuestionType: function(el) {
        var html = el.innerHTML || '';
        var cls = el.className || '';

        if (html.indexOf('radio') !== -1 || html.indexOf('checkbox') !== -1 ||
            cls.indexOf('choice') !== -1 || cls.indexOf('select') !== -1) {
            return '选择题';
        }
        if (el.querySelector('input[type="text"], textarea, [contenteditable]')) {
            return '填空题';
        }
        if (el.querySelector('audio, video, [class*="audio"]')) {
            return '听力题';
        }
        if (html.indexOf('record') !== -1 || html.indexOf('speak') !== -1 ||
            cls.indexOf('speak') !== -1 || cls.indexOf('record') !== -1) {
            return '口语题';
        }
        if (el.querySelector('select')) {
            return '下拉选择题';
        }
        if (html.indexOf('drag') !== -1 || html.indexOf('sort') !== -1) {
            return '排序/拖拽题';
        }
        return '未知类型';
    },

    extractOptions: function(el) {
        var options = [];
        var optionSelectors = [
            '[class*="option"]', '[class*="Option"]',
            '[class*="choice"]', '[class*="Choice"]',
            '[class*="answer"]', '[class*="Answer"]',
            'li', '.item', '[role="option"]',
            'label', 'button[class*="select"]'
        ];

        for (var i = 0; i < optionSelectors.length; i++) {
            try {
                var optEls = el.querySelectorAll(optionSelectors[i]);
                if (optEls.length >= 2) {
                    optEls.forEach(function(optEl) {
                        var text = (optEl.textContent || '').trim();
                        if (text.length > 0 && text.length < 500 && options.indexOf(text) === -1) {
                            options.push(text);
                        }
                    });
                    if (options.length >= 2) return options;
                    options = [];
                }
            } catch (e) {}
        }

        return options;
    },

    extractAnswer: function(el) {
        var answerSelectors = [
            '[class*="correct"]', '[class*="Correct"]',
            '[class*="answer"]', '[class*="Answer"]',
            '[class*="right"]', '[class*="Right"]',
            '[class*="result"]', '[class*="Result"]',
            '[data-answer]', '[data-correct]'
        ];

        for (var i = 0; i < answerSelectors.length; i++) {
            try {
                var ansEl = el.querySelector(answerSelectors[i]);
                if (ansEl) {
                    var text = (ansEl.textContent || '').trim();
                    if (text.length > 0 && text.length < 500) return text;
                    if (ansEl.dataset.answer) return ansEl.dataset.answer;
                    if (ansEl.dataset.correct) return ansEl.dataset.correct;
                }
            } catch (e) {}
        }

        var selectedEl = el.querySelector('.selected, .active, .checked, [aria-checked="true"]');
        if (selectedEl) {
            var selText = (selectedEl.textContent || '').trim();
            if (selText.length > 0) return selText;
        }

        return '';
    },

    extractAudioUrl: function(el) {
        var audioEl = el.querySelector('audio, video');
        if (audioEl) {
            if (audioEl.src) return audioEl.src;
            var source = audioEl.querySelector('source');
            if (source && source.src) return source.src;
        }

        var audioClass = el.querySelector('[class*="audio"], [class*="Audio"], [class*="play"], [class*="Play"]');
        if (audioClass) {
            var dataSrc = audioClass.dataset.src || audioClass.dataset.url || audioClass.dataset.audio;
            if (dataSrc) return dataSrc;
        }

        return '';
    },

    collectAudioResources: function() {
        var audios = [];
        var seen = {};

        document.querySelectorAll('audio, video').forEach(function(el) {
            var src = el.src || '';
            var sources = el.querySelectorAll('source');
            if (!src && sources.length > 0) {
                src = sources[0].src || '';
            }
            if (src && !seen[src]) {
                seen[src] = true;
                audios.push({
                    src: src,
                    type: el.tagName.toLowerCase(),
                    duration: el.duration || 0,
                    currentTime: el.currentTime || 0,
                    paused: el.paused,
                    autoplay: el.autoplay,
                    loop: el.loop,
                    parentInfo: el.parentElement ? (el.parentElement.tagName + (el.parentElement.className ? '.' + el.parentElement.className.split(' ')[0] : '')) : ''
                });
            }
        });

        document.querySelectorAll('[class*="audio"], [class*="Audio"], [class*="play"], [class*="Play"], [class*="media"], [class*="Media"]').forEach(function(el) {
            var dataSrc = el.dataset.src || el.dataset.url || el.dataset.audio || '';
            if (dataSrc && !seen[dataSrc]) {
                seen[dataSrc] = true;
                audios.push({
                    src: dataSrc,
                    type: 'media-container',
                    tagName: el.tagName,
                    cssClass: el.className,
                    parentInfo: el.parentElement ? (el.parentElement.tagName + (el.parentElement.className ? '.' + el.parentElement.className.split(' ')[0] : '')) : ''
                });
            }
        });

        State.collectedData.audioResources = audios;
    },

    collectMediaResources: function() {
        var media = [];
        var seen = {};

        document.querySelectorAll('img, svg, iframe, embed, object').forEach(function(el) {
            var src = el.src || el.data || el.href || '';
            if (src && !seen[src]) {
                seen[src] = true;
                media.push({
                    src: src,
                    type: el.tagName.toLowerCase(),
                    width: el.width || el.naturalWidth || 0,
                    height: el.height || el.naturalHeight || 0,
                    alt: el.alt || '',
                    parentInfo: el.parentElement ? (el.parentElement.tagName + (el.parentElement.className ? '.' + el.parentElement.className.split(' ')[0] : '')) : ''
                });
            }
        });

        State.collectedData.mediaResources = media;
    },

    collectDomStructure: function() {
        var stats = { totalElements: 0, maxDepth: 0 };

        function buildTree(el, depth) {
            if (!el || depth > 8) return null;
            stats.totalElements++;
            if (depth > stats.maxDepth) stats.maxDepth = depth;

            var node = {
                tag: el.tagName ? el.tagName.toLowerCase() : 'text',
                id: el.id || '',
                classes: el.className ? (typeof el.className === 'string' ? el.className.split(' ').filter(function(c) { return c; }) : []) : [],
                text: ''
            };

            if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
                node.text = (el.childNodes[0].textContent || '').trim().substring(0, 100);
            }

            var children = [];
            var childLimit = depth < 1 ? 30 : (depth < 3 ? 15 : 8);
            var count = 0;
            for (var i = 0; i < el.children.length && count < childLimit; i++) {
                var child = buildTree(el.children[i], depth + 1);
                if (child) {
                    children.push(child);
                    count++;
                }
            }
            if (children.length > 0) {
                node.children = children;
            }

            return node;
        }

        var tree = buildTree(document.body, 0);
        if (tree) {
            tree.totalElements = stats.totalElements;
            tree.maxDepth = stats.maxDepth;
        }
        State.collectedData.domStructure = tree || {};
    },

    collectGlobalVars: function() {
        var vars = {};
        var interestingKeys = [
            'pageConfig', 'questionData', 'answerData', 'questions', 'answers',
            'slideData', 'slides', 'config', 'options', 'data', 'pageData',
            'courseData', 'lessonData', 'unitData', 'moduleData', 'activityData',
            'resourceData', 'mediaData', 'audioData', 'videoData',
            'wordData', 'vocabularyData', 'bucketData', 'questionList',
            'answerList', 'correctAnswers', 'userAnswers',
            'App', 'app', 'Vue', 'vue', 'React', 'react',
            'store', 'Store', 'state', 'State', 'router', 'Router',
            'API', 'api', 'BASE_URL', 'apiUrl',
            'userInfo', 'user', 'studentInfo', 'classInfo',
            'bookInfo', 'unitInfo', 'lessonInfo'
        ];

        interestingKeys.forEach(function(key) {
            try {
                if (window[key] !== undefined) {
                    var val = window[key];
                    if (typeof val === 'function') {
                        vars[key] = '[Function: ' + (val.name || 'anonymous') + ']';
                    } else if (typeof val === 'object' && val !== null) {
                        try {
                            var str = JSON.stringify(val);
                            if (str && str.length < 50000) {
                                vars[key] = JSON.parse(str);
                            } else {
                                vars[key] = '[Object, size=' + str.length + ']';
                            }
                        } catch (e) {
                            vars[key] = '[Object, circular or non-serializable]';
                        }
                    } else {
                        vars[key] = val;
                    }
                }
            } catch (e) {
                vars[key] = '[Error: ' + e.message + ']';
            }
        });

        for (var k in window) {
            try {
                if (window.hasOwnProperty(k) && !vars.hasOwnProperty(k)) {
                    var v = window[k];
                    if (typeof v === 'object' && v !== null && !(v instanceof HTMLElement) &&
                        !(v instanceof HTMLDocument) && !(v instanceof Window)) {
                        try {
                            var s = JSON.stringify(v);
                            if (s && s.length > 10 && s.length < 50000) {
                                vars[k] = JSON.parse(s);
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) {}
        }

        State.collectedData.globalVars = vars;
    },

    collectLocalStorage: function() {
        var storage = {};
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                var val = localStorage.getItem(key);
                try {
                    storage[key] = JSON.parse(val);
                } catch (e) {
                    if (val && val.length < 1000) {
                        storage[key] = val;
                    } else if (val) {
                        storage[key] = val.substring(0, 500) + '...[truncated]';
                    }
                }
            }
        } catch (e) {}
        State.collectedData.localStorage = storage;
    },

    collectPageConfig: function() {
        var configs = {};

        var scriptEls = document.querySelectorAll('script:not([src])');
        scriptEls.forEach(function(script) {
            var text = script.textContent || '';
            var configPatterns = [
                /var\s+pageConfig\s*=\s*(\{[\s\S]*?\});/m,
                /var\s+config\s*=\s*(\{[\s\S]*?\});/m,
                /var\s+questionData\s*=\s*(\{[\s\S]*?\});/m,
                /var\s+slideData\s*=\s*(\{[\s\S]*?\});/m,
                /var\s+appConfig\s*=\s*(\{[\s\S]*?\});/m,
                /window\.__CONFIG__\s*=\s*(\{[\s\S]*?\});/m,
                /window\.__DATA__\s*=\s*(\{[\s\S]*?\});/m,
                /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/m,
                /pageConfig\s*[:=]\s*(\{[\s\S]*?\})\s*[;,]/m,
                /questionList\s*[:=]\s*(\[[\s\S]*?\])\s*[;,]/m
            ];
            configPatterns.forEach(function(pattern) {
                var match = text.match(pattern);
                if (match && match[1]) {
                    try {
                        var parsed = JSON.parse(match[1]);
                        for (var k in parsed) {
                            configs[k] = parsed[k];
                        }
                    } catch (e) {
                        try {
                            var cleaned = match[1].replace(/'/g, '"').replace(/(\w+)\s*:/g, '"$1":');
                            var parsed2 = JSON.parse(cleaned);
                            for (var k2 in parsed2) {
                                configs[k2] = parsed2[k2];
                            }
                        } catch (e2) {}
                    }
                }
            });
        });

        var metaEls = document.querySelectorAll('meta');
        metaEls.forEach(function(meta) {
            var name = meta.name || meta.getAttribute('property') || meta.httpEquiv;
            if (name) {
                configs['meta_' + name] = meta.content || '';
            }
        });

        State.collectedData.pageConfig = configs;
    },

    collectRawHTML: function() {
        try {
            State.collectedData.rawHTML = document.documentElement.outerHTML || '';
        } catch (e) {
            State.collectedData.rawHTML = '';
        }
    },

    collectAllText: function() {
        try {
            State.collectedData.allText = document.body ? document.body.innerText || '' : '';
        } catch (e) {
            State.collectedData.allText = '';
        }
    },

    hookNetwork: function() {
        State.originalXHROpen = XMLHttpRequest.prototype.open;
        State.originalXHRSend = XMLHttpRequest.prototype.send;
        State.originalFetch = window.fetch;

        XMLHttpRequest.prototype.open = function(method, url) {
            this._alMethod = method;
            this._alUrl = url;
            return State.originalXHROpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function() {
            var xhr = this;
            var url = xhr._alUrl || '';
            var method = xhr._alMethod || 'GET';

            xhr.addEventListener('load', function() {
                var entry = {
                    method: method,
                    url: url,
                    status: xhr.status,
                    responseType: xhr.responseType || 'text',
                    responseSize: (xhr.responseText || '').length,
                    timestamp: new Date().toISOString()
                };

                if (url.indexOf('127.0.0.1:5290') === -1 && url.indexOf('localhost') === -1) {
                    State.collectedData.networkRequests.push(entry);
                    if (State.collectedData.networkRequests.length > 200) {
                        State.collectedData.networkRequests = State.collectedData.networkRequests.slice(-200);
                    }
                    UI.addLog('[网络] ' + method + ' ' + url.substring(0, 80) + ' → ' + xhr.status, 'info');

                    Collector.tryExtractAnswerFromResponse(url, xhr.responseText);
                }
            });

            xhr.addEventListener('error', function() {
                if (url.indexOf('127.0.0.1:5290') === -1) {
                    State.collectedData.networkRequests.push({
                        method: method, url: url, status: 'error',
                        timestamp: new Date().toISOString()
                    });
                }
            });

            return State.originalXHRSend.apply(this, arguments);
        };

        window.fetch = function(input, init) {
            var url = typeof input === 'string' ? input : (input.url || '');
            var method = (init && init.method) || 'GET';

            return State.originalFetch.apply(this, arguments).then(function(response) {
                if (url.indexOf('127.0.0.1:5290') === -1 && url.indexOf('localhost') === -1) {
                    var entry = {
                        method: method,
                        url: url,
                        status: response.status,
                        responseType: 'fetch',
                        timestamp: new Date().toISOString()
                    };

                    var clone = response.clone();
                    clone.text().then(function(text) {
                        entry.responseSize = text.length;
                        State.collectedData.networkRequests.push(entry);
                        if (State.collectedData.networkRequests.length > 200) {
                            State.collectedData.networkRequests = State.collectedData.networkRequests.slice(-200);
                        }
                        UI.addLog('[网络] ' + method + ' ' + url.substring(0, 80) + ' → ' + response.status, 'info');
                        Collector.tryExtractAnswerFromResponse(url, text);
                    }).catch(function() {
                        State.collectedData.networkRequests.push(entry);
                    });
                }
                return response;
            });
        };

        UI.addLog('网络请求拦截已启动', 'success');
    },

    tryExtractAnswerFromResponse: function(url, responseText) {
        if (!responseText) return;

        try {
            var data = JSON.parse(responseText);
            if (data && typeof data === 'object') {
                var answerKeys = ['answer', 'correctAnswer', 'correct_answer', 'rightAnswer', 'right_answer',
                    'standardAnswer', 'standard_answer', 'result', 'solution'];
                answerKeys.forEach(function(key) {
                    if (data[key] !== undefined) {
                        UI.addLog('[答案发现] URL=' + url.substring(0, 60) + ' | key=' + key + ' | value=' + JSON.stringify(data[key]).substring(0, 100), 'match');
                    }
                });

                if (data.questionList || data.questions || data.slides) {
                    var qList = data.questionList || data.questions || data.slides;
                    if (Array.isArray(qList)) {
                        UI.addLog('[题目数据] 发现题目列表，共 ' + qList.length + ' 项 | URL=' + url.substring(0, 60), 'match');
                    }
                }
            }
        } catch (e) {}
    }
};

var Exporter = {
    exportJSON: function() {
        var exportData = JSON.parse(JSON.stringify(State.collectedData));
        delete exportData.rawHTML;

        var content = JSON.stringify(exportData, null, 2);
        var timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

        UI.addLog('正在导出数据...', 'info');

        fetch(BUCKET_SERVER + '/save-collected-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: content,
                filename: 'listening-data-' + timestamp + '.json'
            })
        })
        .then(function(res) { return res.json(); })
        .then(function(result) {
            if (result.success) {
                UI.addLog('数据已导出到: ' + result.path, 'success');
            } else {
                UI.addLog('导出失败: ' + result.error, 'error');
            }
        })
        .catch(function(err) {
            UI.addLog('导出失败(回退到save-log): ' + err.message, 'warning');
            fetch(BUCKET_SERVER + '/save-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
            })
            .then(function(res) { return res.json(); })
            .then(function(result) {
                if (result.success) {
                    UI.addLog('数据已保存到: ' + result.path, 'success');
                } else {
                    UI.addLog('保存失败: ' + result.error, 'error');
                }
            })
            .catch(function(err2) {
                UI.addLog('保存失败: ' + err2.message, 'error');
            });
        });
    },

    exportFull: function() {
        var content = JSON.stringify(State.collectedData, null, 2);
        var timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

        UI.addLog('正在全量导出(含HTML)...', 'info');

        fetch(BUCKET_SERVER + '/save-collected-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: content,
                filename: 'listening-full-' + timestamp + '.json'
            })
        })
        .then(function(res) { return res.json(); })
        .then(function(result) {
            if (result.success) {
                UI.addLog('全量数据已导出到: ' + result.path, 'success');
            } else {
                UI.addLog('导出失败: ' + result.error, 'error');
            }
        })
        .catch(function(err) {
            UI.addLog('导出失败: ' + err.message, 'error');
        });
    },

    copyToClipboard: function() {
        var exportData = JSON.parse(JSON.stringify(State.collectedData));
        delete exportData.rawHTML;
        var content = JSON.stringify(exportData, null, 2);

        try {
            navigator.clipboard.writeText(content).then(function() {
                UI.addLog('数据已复制到剪贴板', 'success');
            }).catch(function() {
                var textarea = document.createElement('textarea');
                textarea.value = content;
                textarea.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                UI.addLog('数据已复制到剪贴板(回退方式)', 'success');
            });
        } catch (e) {
            UI.addLog('复制失败: ' + e.message, 'error');
        }
    },

    exportLogs: function() {
        if (State.logMessages.length === 0) {
            UI.addLog('没有日志可导出', 'warning');
            return;
        }

        var logText = State.logMessages.slice().reverse().map(function(msg) {
            var typePrefix = '';
            if (msg.type === 'success') typePrefix = '[成功] ';
            if (msg.type === 'error') typePrefix = '[错误] ';
            if (msg.type === 'warning') typePrefix = '[警告] ';
            if (msg.type === 'match') typePrefix = '[匹配] ';
            return '[' + msg.timestamp + '] ' + typePrefix + msg.message;
        }).join('\n');

        UI.addLog('正在保存日志...', 'info');

        fetch(BUCKET_SERVER + '/save-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: logText })
        })
        .then(function(res) { return res.json(); })
        .then(function(result) {
            if (result.success) {
                UI.addLog('日志已保存到: ' + result.path, 'success');
            } else {
                UI.addLog('保存失败: ' + result.error, 'error');
            }
        })
        .catch(function(err) {
            UI.addLog('保存失败: ' + err.message, 'error');
        });
    }
};

function initAutoListening() {
    UI.addLog('基础听力信息收集器初始化...', 'info');

    UI.createMainPanel();

    var panel = document.getElementById('al-main-panel');
    if (panel) {
        panel.__alExportLogs = Exporter.exportLogs;
    }

    Collector.hookNetwork();

    UI.addLog('信息收集器就绪，点击"开始收集"启动', 'success');

    setTimeout(function() {
        Collector.start();
    }, 1500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(initAutoListening, 500);
    });
} else {
    setTimeout(initAutoListening, 500);
}

})();
