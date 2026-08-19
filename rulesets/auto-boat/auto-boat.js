// ==UserScript==
// @name         百舸争流(龙舟)桌面桥接 + 自动答题
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  在电脑端把 Android/iOS 原生 WebViewJavascriptBridge 转成浏览器实现，
//              让 jc-regatta 大厅页(百舸争流)能在桌面浏览器正常运行；openWebView 打开
//              regatta 游戏页；游戏页由 Auto366 代理层替换为内置自动答题 HTML。
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 无论页面里是否已存在原生桥（天学网桌面客户端 WebView 会注入一个
    // WebViewJavascriptBridge，但桌面端只实现少数接口，其余返回
    // "调用方法出错:xxx"，导致 SDK 调用被拒绝、大厅按钮失效），
    // 这里都强制安装桌面桥接。保留原生桥引用便于排查/兜底。
    var NATIVE_BRIDGE = window.WebViewJavascriptBridge;

    // ---------- 配置（可用 window.__A366_REGATTA__ 覆盖） ----------
    var CFG = (window.__A366_REGATTA__ && typeof window.__A366_REGATTA__ === 'object') ? window.__A366_REGATTA__ : {};
    var ENV = CFG.env || 'PRODUCT';       // PRODUCT / DEMO / TEST
    var CLIENT = CFG.client || 'UP366';   // UP366 / TXAI
    // bucket 端口用户可以改；占位符 __A366_BUCKET_PORT__ 会被替换为真实端口：
    // 大厅包静态注入时由构建脚本替换，游戏页响应替换时由代理层替换。
    var BUCKET = (window.__A366__ && window.__A366__.bucket) || CFG.bucket || 'http://127.0.0.1:__A366_BUCKET_PORT__';
    // 防御：占位符若未被替换（大厅包忘记重建 zip 时），回退到默认 bucket 端口，
    // 避免 XHR.open 因端口含非法字符而抛 "Invalid URL"。
    if (BUCKET.indexOf('__A366_BUCKET_PORT__') !== -1) {
        BUCKET = 'http://127.0.0.1:' + ((window.__A366__ && window.__A366__.bucketPort) || 5290);
    }

    var jsHandlers = {}; // registerHandler 注册的 JS 侧回调（JS→JS 自发自收）

    // ======================= 工具 =======================

    // 屏显诊断：天学网客户端 WebView 屏蔽了控制台，用一个常驻小浮层把桥的活动
    // 直接显示在页面上，方便排查"点了没反应"的问题；不影响页面正常交互。
    function diag(msg) {
        try { console.log('[Auto366:diag] ' + msg); } catch (e) {}
        try {
            var el = document.getElementById('a366-diag');
            if (!el) {
                el = document.createElement('div');
                el.id = 'a366-diag';
                el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483646;max-width:92%;max-height:42%;overflow:auto;background:rgba(0,0,0,.78);color:#0f0;font:11px/1.5 monospace;padding:6px 8px;border-radius:6px;white-space:pre-wrap;word-break:break-all;';
                (document.body || document.documentElement).appendChild(el);
            }
            var line = document.createElement('div');
            line.textContent = msg;
            el.appendChild(line);
            while (el.childNodes.length > 60) el.removeChild(el.firstChild);
            el.scrollTop = el.scrollHeight;
        } catch (e) {}
    }

    function ok(data) { return { result: { code: 0, msg: '' }, data: data }; }
    function fail(msg, code) {
        return { result: { code: (code === undefined ? -2000 : code), msg: String(msg || '未知错误') }, data: null };
    }

    function getAppInfoData() {
        return {
            platform: 'web',
            os: 'web',
            systemOS: 'web',
            client: CLIENT,
            versions: '1.0.0',
            version: '1.0.0',
            clientId: '',
            env: ENV,
            extraData: {},
            SDKVersion: '',
            osVersion: '',
            mobileModel: '',
            domain: undefined,
            scene: undefined
        };
    }

    // ======================= 桥方法实现 =======================

    // openWebView：桌面端 WebView 无多窗口能力(原生 openWebView 未实现)，
    // window.open 会返回不可见空窗口、看起来"点了没反应"。因此优先当前窗口跳转游戏页；
    // 若 WebView 拦截了跨 scheme 导航(local://→https)，1s 内仍停留在本页(可见)时，
    // 自动降级为全屏 iframe 加载游戏页(代理 content-change 会把 regatta 页替换成内置答题页)。
    function loadGameInFrame(url) {
        try {
            var oldEl = document.getElementById('a366-game-frame');
            if (oldEl) oldEl.remove();
            var frame = document.createElement('iframe');
            frame.id = 'a366-game-frame';
            frame.src = url;
            frame.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:#fff;';
            (document.body || document.documentElement).appendChild(frame);
            console.log('[Auto366:bridge] 导航被拦截，已用全屏 iframe 加载: ' + url);
            diag('导航被拦截 → 已用全屏 iframe 加载: ' + url);
        } catch (e) {
            try { console.log('[Auto366:bridge] iframe 兜底失败: ' + e); } catch (e2) {}
        }
    }

    function openWebView(params) {
        var url = params && params.url;
        try {
            console.log('[Auto366:bridge] openWebView url=' + url + ', openNewWebView=' + (params && params.openNewWebView));
        } catch (e) {}
        if (url) {
            diag('openWebView → 尝试跳转: ' + url);
            // 导航成功会销毁本页 JS 上下文，此定时器不会再执行；
            // 若 1s 后仍可见地停留本页，说明导航被拦截 → iframe 兜底
            setTimeout(function () {
                if (document && document.visibilityState !== 'hidden') {
                    loadGameInFrame(url);
                }
            }, 1000);
            try { window.location.href = url; } catch (e) { loadGameInFrame(url); }
        }
        return {};
    }

    function closeWebView() {
        if (window.history.length > 1) {
            window.history.back();
        } else {
            try { window.close(); } catch (e) {}
        }
        return {};
    }

    // 通过本地 bucket 转发 SDK 请求，规避浏览器跨域(CORS)限制；
    // 转发时带上页面 cookie，若大厅挂在 up366 域下即可继承登录态。
    function requestViaBucket(params) {
        return new Promise(function (resolve) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', BUCKET + '/a366-forward', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = params.timeout || 30000;
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                try {
                    var r = JSON.parse(xhr.responseText || '{}');
                    // bucket 转发层失败（success:false）时按失败处理，回退直连/报错
                    if (r && r.success === false) {
                        resolve({ raw: null, status: xhr.status, err: r.error || ('HTTP ' + xhr.status) });
                        return;
                    }
                    // bucket 转发返回 { status, headers, body }，body 即真实接口响应
                    resolve({ raw: (r && r.body !== undefined) ? r.body : r, status: xhr.status });
                } catch (e) {
                    resolve({ raw: null, status: xhr.status, err: String(e) });
                }
            };
            xhr.onerror = function () { resolve({ raw: null, status: 0, err: 'network-error' }); };
            xhr.ontimeout = function () { resolve({ raw: null, status: 0, err: 'timeout' }); };
            xhr.send(JSON.stringify({
                url: params.url,
                method: 'POST',
                headers: params.header || {},
                body: params.data || '',
                cookie: document.cookie || ''
            }));
        });
    }

    // 兜底：直接 fetch（同域/服务端已放开 CORS 时可用）
    function requestDirect(params) {
        return new Promise(function (resolve) {
            var header = params.header || {};
            var contentType = header['content-type'] || header['Content-Type'] || 'application/x-www-form-urlencoded';
            var h = { 'Content-Type': contentType };
            Object.keys(header).forEach(function (k) {
                if (/^content-type$/i.test(k)) return;
                h[k] = header[k];
            });
            var timer = setTimeout(function () { resolve({ raw: null, status: 0, err: 'timeout' }); }, params.timeout || 30000);
            fetch(params.url, {
                method: 'POST',
                headers: h,
                body: params.data || '',
                credentials: 'include'
            }).then(function (res) {
                return res.text();
            }).then(function (text) {
                clearTimeout(timer);
                var body = null;
                try { body = JSON.parse(text); } catch (e) { body = text; }
                resolve({ raw: body, status: 200 });
            }).catch(function (e) {
                clearTimeout(timer);
                resolve({ raw: null, status: 0, err: String(e && e.message || e) });
            });
        });
    }

    // request(handlerName="request")：SDK 请求 → 归一化成 { result, data } 返回
    function doRequest(params) {
        var attempt = function (mode) {
            var p = mode === 'direct' ? requestDirect(params) : requestViaBucket(params);
            return p.then(function (res) {
                if (res.raw !== null && res.raw !== undefined) return normalizeRequestResult(res.raw);
                // bucket 不可达(服务未开/端口变动)时降级为直连
                if (mode !== 'direct') return requestDirect(params).then(function (r2) {
                    return normalizeRequestResult(r2.raw);
                });
                return fail(res.err || ('HTTP ' + res.status), -10001);
            });
        };
        return attempt('bucket');
    }

    function normalizeRequestResult(body) {
        if (body !== null && typeof body === 'object' && body.result) {
            // 接口本来就返回 { result, data }，原样透传给调用方解析
            return body;
        }
        if (body !== null && typeof body === 'object' && typeof body.code === 'number') {
            // up366 标准接口响应 { code, msg, data } → 映射成 { result, data }
            // 保证 v() 的 { result:{code}, data } 解构拿到正确 payload
            return { result: { code: body.code, msg: body.msg || '' }, data: body.data };
        }
        // 其它结构统一包一层
        return ok(body);
    }

    // ======================= 分发入口 =======================

    function dispatch(name, params, callback) {
        var p = params || {};
        var resp;
        switch (name) {
            case 'getAppInfo':
                resp = ok(getAppInfoData());
                break;
            case 'getNTPTimestamp':
                resp = ok(Date.now());
                break;
            case 'getLaunchOptions':
                // 返回与原生一致的 referrerInfo.extraData 结构
                resp = ok({ referrerInfo: { extraData: {} }, extraData: {} });
                break;
            case 'showLoading':
            case 'setBackgroundColor':
            case 'log':
            case 'share':
            case 'openDictionary':
            case 'doContinue':
                resp = ok({});
                break;
            case 'openWebView':
                resp = ok(openWebView(p));
                break;
            case 'closeWebView':
                resp = ok(closeWebView());
                break;
            case 'request':
            case 'sdkRequest':
                try {
                    console.log('[Auto366:bridge] request url=' + (p.url || '') + ' data=' + String(p.data || '').slice(0, 120));
                } catch (e) {}
                diag('请求 ' + (p.url || '') + '  data=' + String(p.data || '').slice(0, 100));
                doRequest(p).then(function (r) {
                    try {
                        var __code = (r && r.result) ? r.result.code : '?';
                        var __d = '';
                        try { __d = JSON.stringify(r && r.data); } catch (e2) { __d = String(r && r.data); }
                        console.log('[Auto366:bridge] request ok code=' + __code + ' data=' + String(__d).slice(0, 220));
                    } catch (e) {}
                    diag('请求完成 code=' + __code + ' data=' + String(__d).slice(0, 160));
                    if (typeof callback === 'function') callback(r);
                }, function (e) {
                    try { console.log('[Auto366:bridge] request fail: ' + String(e && e.message || e)); } catch (e2) {}
                    diag('请求失败: ' + String(e && e.message || e));
                    if (typeof callback === 'function') callback(fail(e));
                });
                return;
            case 'exists':
                resp = ok(false);
                break;
            case 'getRootPath':
                resp = ok('');
                break;
            case 'mkdir':
            case 'writeFile':
            case 'readFile':
            case 'readDir':
                resp = ok('');
                break;
            default:
                // 未实现的桥方法返回空成功，避免上层抛错
                resp = ok({});
        }
        callback(resp);
    }

    // ======================= 暴露桥 =======================

    var bridge = {
        init: function (cb) {
            if (typeof cb === 'function') { try { cb(bridge); } catch (e) {} }
        },
        callHandler: function (name, params, callback) {
            if (typeof params === 'function') { callback = params; params = {}; }
            params = params || {};
            dispatch(name, params, function (resp) {
                if (typeof callback === 'function') {
                    try { callback(resp); } catch (e) {}
                }
            });
        },
        registerHandler: function (name, cb) {
            if (name) jsHandlers[name] = cb;
        }
    };

    // 桌面客户端(天学网)可能用 Object.defineProperty 以 configurable:false 注入原生桥，
    // 普通赋值/重新 defineProperty 都无法覆盖 window.WebViewJavascriptBridge。
    // 这里用「双保险」：
    //   1) 属性级覆盖 —— getter 返回我们的桥，setter 吞掉普通赋值；
    //   2) 对象级补丁 —— 把已存在的原生桥对象的 callHandler/registerHandler/init
    //      方法改造成转发到我们的桥（页面即使持有原生桥引用也走我们的逻辑）。
    function installGetter() {
        try {
            Object.defineProperty(window, 'WebViewJavascriptBridge', {
                get: function () { return bridge; },
                set: function () { /* 桌面端始终使用我们的桥，忽略普通覆盖 */ },
                configurable: true,
                enumerable: true
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    function patchNativeBridge(nb) {
        if (!nb || typeof nb !== 'object') return;
        if (nb === bridge) return;
        if (nb.__a366patched) return;
        try {
            nb.__a366patched = true;
            if (typeof nb.__a366OrigCall === 'undefined') nb.__a366OrigCall = nb.callHandler;
            nb.callHandler = function (name, params, callback) {
                if (typeof params === 'function') { callback = params; params = {}; }
                return bridge.callHandler(name, params || {}, callback);
            };
            nb.registerHandler = function (name, cb) {
                return bridge.registerHandler(name, cb);
            };
            nb.init = function (cb) {
                return bridge.init(cb);
            };
            if (window.console) console.log('%c[Auto366] 已接管原生桥对象(callHandler→桌面桥)', 'color:#f5a623');
        } catch (e) { /* 对象冻结/只读时放弃，不破坏页面 */ }
    }

    function ensureBridgeActive() {
        installGetter();
        // 当前 window.WebViewJavascriptBridge 拿到的对象若不是我们的桥，补丁它
        var cur = null;
        try { cur = window.WebViewJavascriptBridge; } catch (e) {}
        if (cur && cur !== bridge) patchNativeBridge(cur);
        // 脚本开始时捕获到的原生桥引用（页面可能早已持有）一并补丁
        if (NATIVE_BRIDGE && NATIVE_BRIDGE !== bridge && NATIVE_BRIDGE !== cur) {
            patchNativeBridge(NATIVE_BRIDGE);
        }
    }
    ensureBridgeActive();

    // 兼容 iOS 检测路径：非 iOS 的检测函数用 WebViewJavascriptBridge；这里是纯浏览器兜底
    if (window.__up366_client_info__ === undefined) {
        window.__up366_client_info__ = getAppInfoData();
    }

    // 让等待中的 WVJBCallbacks 拿到实例（桥模块 ei() 走到该分支时）
    var pending = window.WVJBCallbacks;
    if (pending && pending.length) {
        pending.forEach(function (cb) { try { cb(bridge); } catch (e) {} });
    }
    window.WVJBCallbacks = [];

    // 宿主可能到页面加载完成才注入原生桥：轮询兜底，快速抢回/补丁（最多 ~60s）
    var reassertCount = 0;
    var reassertTimer = setInterval(function () {
        ensureBridgeActive();
        if (++reassertCount >= 120) clearInterval(reassertTimer);
    }, 500);

    // 便于调试：可手动触发 JS 侧 registerHandler 注册的事件
    bridge.__emit = function (name) {
        var args = Array.prototype.slice.call(arguments, 1);
        var h = jsHandlers[name];
        if (typeof h === 'function') { try { h.apply(null, args); } catch (e) {} }
    };

    console.log('%c[Auto366] 桌面桥接已注入: env=' + ENV + ', client=' + CLIENT, 'color:#f5a623;font-weight:bold');
    diag('桥已注入 env=' + ENV + ' client=' + CLIENT + ' | 点“参加本期比赛”后此处会显示请求/跳转过程');

    // 诊断：输出当前 window.WebViewJavascriptBridge 的接管状态，便于排查是否原生桥仍在生效
    try {
        var __desc = Object.getOwnPropertyDescriptor(window, 'WebViewJavascriptBridge');
        var __cur = window.WebViewJavascriptBridge;
        var __info = '无';
        if (__desc) {
            if (__desc.get) __info = 'getter(我们的桥)';
            else if (__desc.value) __info = (__desc.value === bridge ? '我们的桥' : '原生桥') + ', configurable=' + __desc.configurable;
        }
        console.log('%c[Auto366] 桥接管状态: ' + __info + (__cur === bridge ? ' [生效:桌面桥]' : ' [生效:' + (typeof __cur) + ']'), 'color:#f5a623');
    } catch (e) {
        console.log('%c[Auto366] 桥接管状态读取失败: ' + e, 'color:#f5a623');
    }
})();
