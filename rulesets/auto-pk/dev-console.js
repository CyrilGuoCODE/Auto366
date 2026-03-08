// Auto366内部控制台
let devConsole = null;
let isConsoleOpen = false;
let isDragging = false;
let isResizing = false;
let dragOffset = { x: 0, y: 0 };
let resizeHandle = null;

let consoleLogs = [];
let maxLogs = 200;

let inspectorMode = false;
let highlightedElement = null;
let inspectorOverlay = null;

function openDevConsole() {
    if (devConsole) {
        devConsole.style.display = 'block';
        isConsoleOpen = true;
        return;
    }

    createDevConsole();
    isConsoleOpen = true;
    addConsoleLog('Auto366内部控制台已启动', 'info');
}

function closeDevConsole() {
    if (devConsole) {
        devConsole.style.display = 'none';
        isConsoleOpen = false;
        if (inspectorMode) {
            toggleInspector();
        }
    }
}

function createDevConsole() {
    devConsole = document.createElement('div');
    devConsole.id = 'dev-console';
    devConsole.style.cssText = `
        position: fixed;
        top: 100px;
        left: 100px;
        width: 800px;
        height: 600px;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 8px;
        z-index: 10000;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 12px;
        color: #fff;
        display: flex;
        flex-direction: column;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        min-width: 400px;
        min-height: 300px;
    `;

    // 创建标题栏
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
        height: 30px;
        background: #2d2d2d;
        border-bottom: 1px solid #333;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px;
        cursor: move;
        user-select: none;
        border-radius: 8px 8px 0 0;
    `;

    const title = document.createElement('span');
    title.textContent = 'Auto366内部控制台';
    title.style.fontWeight = 'bold';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '5px';

    const minimizeBtn = createControlButton('_', () => {
        devConsole.style.height = devConsole.style.height === '30px' ? '600px' : '30px';
    });

    const closeBtn = createControlButton('X', closeDevConsole);

    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    titleBar.appendChild(title);
    titleBar.appendChild(controls);

    // 创建标签页
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
        height: 35px;
        background: #252526;
        border-bottom: 1px solid #333;
        display: flex;
        align-items: center;
        padding: 0 10px;
        gap: 10px;
    `;

    const tabs = [
        { id: 'elements', name: '元素', enabled: true },
        { id: 'console', name: '控制台', enabled: true },
        { id: 'network', name: '网络', enabled: false },
        { id: 'sources', name: '源码', enabled: false }
    ];

    let activeTab = 'elements';
    const tabButtons = {};

    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.textContent = tab.name;
        btn.style.cssText = `
            background: ${tab.id === activeTab ? '#007acc' : 'transparent'};
            border: none;
            color: ${tab.enabled ? '#fff' : '#666'};
            padding: 5px 15px;
            cursor: ${tab.enabled ? 'pointer' : 'not-allowed'};
            border-radius: 3px;
            font-size: 11px;
            opacity: ${tab.enabled ? '1' : '0.5'};
        `;
        if (tab.enabled) {
            btn.addEventListener('click', () => switchTab(tab.id));
        }
        tabButtons[tab.id] = btn;
        tabBar.appendChild(btn);
    });

    const content = document.createElement('div');
    content.style.cssText = `
        flex: 1;
        display: flex;
        overflow: hidden;
    `;

    const elementsPanel = createElementsPanel();
    const consolePanel = createConsolePanel();
    const networkPanel = createNetworkPanel();
    const sourcesPanel = createSourcesPanel();

    const panels = {
        elements: elementsPanel,
        console: consolePanel,
        network: networkPanel,
        sources: sourcesPanel
    };

    content.appendChild(elementsPanel);
    content.appendChild(consolePanel);
    content.appendChild(networkPanel);
    content.appendChild(sourcesPanel);

    function switchTab(tabId) {
        activeTab = tabId;
        Object.keys(tabButtons).forEach(id => {
            tabButtons[id].style.background = id === tabId ? '#007acc' : 'transparent';
        });
        Object.keys(panels).forEach(id => {
            panels[id].style.display = id === tabId ? 'flex' : 'none';
        });
    }

    switchTab('elements');

    const resizeHandles = createResizeHandles();

    devConsole.appendChild(titleBar);
    devConsole.appendChild(tabBar);
    devConsole.appendChild(content);
    resizeHandles.forEach(handle => devConsole.appendChild(handle));

    document.body.appendChild(devConsole);

    setupDragAndResize(titleBar);
}

function createControlButton(text, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
        width: 20px;
        height: 20px;
        background: #444;
        border: none;
        color: #fff;
        cursor: pointer;
        border-radius: 3px;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => btn.style.background = '#666');
    btn.addEventListener('mouseleave', () => btn.style.background = '#444');
    return btn;
}

// 创建元素面板
function createElementsPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: row;
    `;

    const elementTree = document.createElement('div');
    elementTree.style.cssText = `
        width: 50%;
        background: #1e1e1e;
        border-right: 1px solid #333;
        overflow-y: auto;
        padding: 10px;
    `;

    const stylePanel = document.createElement('div');
    stylePanel.style.cssText = `
        width: 50%;
        background: #252526;
        overflow-y: auto;
        padding: 10px;
    `;

    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        position: absolute;
        top: 70px;
        left: 10px;
        z-index: 10001;
        display: flex;
        gap: 5px;
    `;

    const inspectorBtn = document.createElement('button');
    inspectorBtn.textContent = '选择元素';
    inspectorBtn.id = 'inspector-toggle-btn';
    inspectorBtn.style.cssText = `
        background: #007acc;
        border: none;
        color: #fff;
        padding: 5px 10px;
        cursor: pointer;
        border-radius: 3px;
        font-size: 11px;
    `;
    inspectorBtn.addEventListener('click', toggleInspector);

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '刷新';
    refreshBtn.style.cssText = `
        background: #444;
        border: none;
        color: #fff;
        padding: 5px 10px;
        cursor: pointer;
        border-radius: 3px;
        font-size: 11px;
    `;
    refreshBtn.addEventListener('click', refreshElementTree);

    toolbar.appendChild(inspectorBtn);
    toolbar.appendChild(refreshBtn);

    panel.appendChild(elementTree);
    panel.appendChild(stylePanel);
    panel.appendChild(toolbar);

    refreshElementTree();

    return panel;
}

function createConsolePanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #1e1e1e;
    `;

    const logArea = document.createElement('div');
    logArea.id = 'console-logs';
    logArea.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        font-family: 'Consolas', monospace;
        font-size: 11px;
        line-height: 1.4;
    `;

    const inputArea = document.createElement('div');
    inputArea.style.cssText = `
        height: 30px;
        border-top: 1px solid #333;
        display: flex;
        align-items: center;
        padding: 0 10px;
        background: #252526;
    `;

    const prompt = document.createElement('span');
    prompt.textContent = '> ';
    prompt.style.color = '#007acc';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '输入JavaScript代码...';
    input.style.cssText = `
        flex: 1;
        background: transparent;
        border: none;
        color: #fff;
        outline: none;
        font-family: 'Consolas', monospace;
        font-size: 11px;
        margin-left: 5px;
    `;

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            executeConsoleCommand(input.value);
            input.value = '';
        }
    });

    inputArea.appendChild(prompt);
    inputArea.appendChild(input);
    panel.appendChild(logArea);
    panel.appendChild(inputArea);

    return panel;
}

function createNetworkPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        width: 100%;
        height: 100%;
        background: #1e1e1e;
        padding: 10px;
        overflow-y: auto;
    `;

    const content = document.createElement('div');
    content.innerHTML = `
        <div style="color: #888; text-align: center; margin-top: 50px;">
            <div>网络监控面板</div>
            <div style="font-size: 10px; margin-top: 10px;">监控页面的网络请求</div>
        </div>
    `;

    panel.appendChild(content);
    return panel;
}

function createSourcesPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        width: 100%;
        height: 100%;
        background: #1e1e1e;
        padding: 10px;
        overflow-y: auto;
    `;

    const content = document.createElement('div');
    content.innerHTML = `
        <div style="color: #888; text-align: center; margin-top: 50px;">
            <div>源码调试面板</div>
            <div style="font-size: 10px; margin-top: 10px;">查看和调试JavaScript源码</div>
        </div>
    `;

    panel.appendChild(content);
    return panel;
}

function createResizeHandles() {
    const handles = [];
    const positions = [
        { pos: 'se', cursor: 'se-resize', right: '0', bottom: '0' },
        { pos: 's', cursor: 's-resize', left: '50%', bottom: '0', transform: 'translateX(-50%)' },
        { pos: 'e', cursor: 'e-resize', right: '0', top: '50%', transform: 'translateY(-50%)' }
    ];

    positions.forEach(({ pos, cursor, ...style }) => {
        const handle = document.createElement('div');
        handle.className = `resize-handle-${pos}`;
        handle.style.cssText = `
            position: absolute;
            width: ${pos === 's' ? '100px' : '10px'};
            height: ${pos === 'e' ? '100px' : '10px'};
            cursor: ${cursor};
            z-index: 10001;
            ${Object.entries(style).map(([k, v]) => `${k}: ${v}`).join('; ')};
        `;

        handle.addEventListener('mousedown', (e) => startResize(e, pos));
        handles.push(handle);
    });

    return handles;
}

function setupDragAndResize(titleBar) {
    titleBar.addEventListener('mousedown', startDrag);

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            devConsole.style.left = (e.clientX - dragOffset.x) + 'px';
            devConsole.style.top = (e.clientY - dragOffset.y) + 'px';
        } else if (isResizing) {
            handleResize(e);
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        resizeHandle = null;
    });
}

function startDrag(e) {
    isDragging = true;
    const rect = devConsole.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
}

function startResize(e, position) {
    isResizing = true;
    resizeHandle = position;
    e.stopPropagation();
}

function handleResize(e) {
    if (!isResizing || !resizeHandle) return;

    const rect = devConsole.getBoundingClientRect();
    const minWidth = 400;
    const minHeight = 300;

    if (resizeHandle.includes('e')) {
        const newWidth = Math.max(minWidth, e.clientX - rect.left);
        devConsole.style.width = newWidth + 'px';
    }

    if (resizeHandle.includes('s')) {
        const newHeight = Math.max(minHeight, e.clientY - rect.top);
        devConsole.style.height = newHeight + 'px';
    }
}

function toggleInspector() {
    inspectorMode = !inspectorMode;
    const btn = document.getElementById('inspector-toggle-btn');

    if (inspectorMode) {
        createInspectorOverlay();
        document.addEventListener('mouseover', highlightElement);
        document.addEventListener('click', selectElement);
        document.body.style.cursor = 'crosshair';
        if (btn) {
            btn.textContent = '停止选择';
            btn.style.background = '#f44336';
        }
        addConsoleLog('元素检查器已启用，点击页面元素进行检查', 'info');
    } else {
        removeInspectorOverlay();
        document.removeEventListener('mouseover', highlightElement);
        document.removeEventListener('click', selectElement);
        document.body.style.cursor = 'default';
        if (btn) {
            btn.textContent = '选择元素';
            btn.style.background = '#007acc';
        }
        addConsoleLog('元素检查器已禁用', 'info');
    }
}

function createInspectorOverlay() {
    if (inspectorOverlay) return;

    inspectorOverlay = document.createElement('div');
    inspectorOverlay.style.cssText = `
        position: absolute;
        pointer-events: none;
        border: 2px solid #007acc;
        background: rgba(0, 122, 204, 0.1);
        z-index: 9999;
        display: none;
    `;
    document.body.appendChild(inspectorOverlay);
}

function removeInspectorOverlay() {
    if (inspectorOverlay) {
        inspectorOverlay.remove();
        inspectorOverlay = null;
    }
    highlightedElement = null;
}

// 高亮元素
function highlightElement(e) {
    if (!inspectorMode || !inspectorOverlay) return;
    if (e.target === devConsole || devConsole.contains(e.target)) return;

    highlightedElement = e.target;
    const rect = e.target.getBoundingClientRect();

    inspectorOverlay.style.display = 'block';
    inspectorOverlay.style.left = (rect.left + window.scrollX) + 'px';
    inspectorOverlay.style.top = (rect.top + window.scrollY) + 'px';
    inspectorOverlay.style.width = rect.width + 'px';
    inspectorOverlay.style.height = rect.height + 'px';
}

// 选择元素
function selectElement(e) {
    if (!inspectorMode) return;
    if (e.target === devConsole || devConsole.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    const element = e.target;
    inspectElement(element);
    // 不自动关闭检查器模式，让用户可以继续选择其他元素
}

function inspectElement(element) {
    const elementTree = devConsole.querySelector('#dev-console > div:nth-child(3) > div:first-child');
    const stylePanel = devConsole.querySelector('#dev-console > div:nth-child(3) > div:nth-child(2)');

    if (!elementTree || !stylePanel) return;

    // 聚焦到选中的元素
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 高亮显示选中的元素
    const originalOutline = element.style.outline;
    const originalBackground = element.style.backgroundColor;
    element.style.outline = '3px solid #007acc';
    element.style.backgroundColor = 'rgba(0, 122, 204, 0.1)';

    // 3秒后恢复原样
    setTimeout(() => {
        element.style.outline = originalOutline;
        element.style.backgroundColor = originalBackground;
    }, 3000);

    elementTree.innerHTML = `
        <div style="color: #007acc; font-weight: bold; margin-bottom: 10px;">选中元素</div>
        <div style="margin-bottom: 5px;">标签: <span style="color: #f92672;">${element.tagName.toLowerCase()}</span></div>
        <div style="margin-bottom: 5px;">ID: <span style="color: #a6e22e;">${element.id || '无'}</span></div>
        <div style="margin-bottom: 5px;">类名: <span style="color: #66d9ef;">${element.className || '无'}</span></div>
        <div style="margin-bottom: 10px;">文本: <span style="color: #e6db74;">${element.textContent.substring(0, 50)}${element.textContent.length > 50 ? '...' : ''}</span></div>
        <div style="color: #888; font-size: 10px;">HTML:</div>
        <pre style="background: #2d2d2d; padding: 10px; border-radius: 3px; font-size: 10px; overflow-x: auto; white-space: pre-wrap;">${escapeHtml(element.outerHTML.substring(0, 500))}${element.outerHTML.length > 500 ? '...' : ''}</pre>
        <div style="margin-top: 10px;">
            <button onclick="focusElement()" style="background: #007acc; border: none; color: #fff; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px; margin-right: 5px;">重新聚焦</button>
            <button onclick="copyElementInfo()" style="background: #4caf50; border: none; color: #fff; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px;">复制信息</button>
        </div>
    `;

    // 显示样式信息
    const computedStyles = window.getComputedStyle(element);
    const importantStyles = [
        'display', 'position', 'width', 'height', 'margin', 'padding',
        'background-color', 'color', 'font-size', 'border', 'z-index'
    ];

    let styleHtml = '<div style="color: #007acc; font-weight: bold; margin-bottom: 10px;">计算样式</div>';
    importantStyles.forEach(prop => {
        const value = computedStyles.getPropertyValue(prop);
        if (value) {
            styleHtml += `<div style="margin-bottom: 3px; font-size: 10px;">
                <span style="color: #f92672;">${prop}:</span> 
                <span style="color: #a6e22e;">${value}</span>
            </div>`;
        }
    });

    stylePanel.innerHTML = styleHtml;

    // 存储当前选中的元素
    window.currentSelectedElement = element;

    addConsoleLog(`已检查元素: ${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${element.className ? '.' + element.className.split(' ').join('.') : ''}`, 'info');
}

function refreshElementTree() {
    const elementTree = devConsole.querySelector('#dev-console > div:nth-child(3) > div:first-child');
    if (!elementTree) return;

    // 获取所有可见元素
    const allElements = document.querySelectorAll('*');
    const visibleElements = Array.from(allElements).filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            el.offsetWidth > 0 &&
            el.offsetHeight > 0 &&
            !devConsole.contains(el); // 排除控制台自身的元素
    });

    let html = '<div style="color: #007acc; font-weight: bold; margin-bottom: 10px;">页面元素 (共' + visibleElements.length + '个)</div>';

    // 按标签名分组
    const elementsByTag = {};
    visibleElements.forEach(el => {
        const tagName = el.tagName.toLowerCase();
        if (!elementsByTag[tagName]) {
            elementsByTag[tagName] = [];
        }
        elementsByTag[tagName].push(el);
    });

    // 显示每个标签类型
    Object.keys(elementsByTag).sort().forEach(tagName => {
        const elements = elementsByTag[tagName];
        html += `<div style="margin-bottom: 8px;">
            <div style="color: #f92672; font-size: 11px; margin-bottom: 3px; cursor: pointer;" onclick="toggleElementGroup('${tagName}')">${tagName} (${elements.length}个) <span id="toggle-${tagName}">▼</span></div>
            <div id="group-${tagName}" style="margin-left: 15px;">`;

        elements.forEach((el, index) => {
            if (index < 10) { // 默认只显示前10个
                const elementId = 'element-' + tagName + '-' + index;
                html += `<div style="font-size: 10px; color: #888; cursor: pointer; padding: 2px; margin-bottom: 1px;" 
                         onclick="inspectElementById('${elementId}')" 
                         onmouseover="highlightElementById('${elementId}')"
                         onmouseout="removeHighlight()">
                    ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''} ${el.textContent ? '- ' + el.textContent.substring(0, 30) + (el.textContent.length > 30 ? '...' : '') : ''}
                </div>`;
                // 存储元素引用
                window['elementRef_' + elementId] = el;
            }
        });

        if (elements.length > 10) {
            html += `<div style="font-size: 10px; color: #666; cursor: pointer;" onclick="showMoreElements('${tagName}')">...显示更多 (还有${elements.length - 10}个)</div>`;
        }
        html += '</div></div>';
    });

    elementTree.innerHTML = html;
}

window.inspectElementByIndex = function (selector, index) {
    const elements = document.querySelectorAll(selector);
    if (elements[index]) {
        inspectElement(elements[index]);
    }
};

function executeConsoleCommand(command) {
    addConsoleLog('> ' + command, 'command');

    try {
        const result = eval(command);
        addConsoleLog(result, 'result');
    } catch (error) {
        addConsoleLog('Error: ' + error.message, 'error');
    }
}

function addConsoleLog(message, type = 'log') {
    const timestamp = new Date().toLocaleTimeString();
    consoleLogs.unshift({ timestamp, message, type });

    if (consoleLogs.length > maxLogs) {
        consoleLogs = consoleLogs.slice(0, maxLogs);
    }

    updateConsoleDisplay();
}

function updateConsoleDisplay() {
    const logArea = document.getElementById('console-logs');
    if (!logArea) return;

    const colors = {
        log: '#fff',
        info: '#007acc',
        warn: '#ff9800',
        error: '#f44336',
        command: '#a6e22e',
        result: '#66d9ef'
    };

    logArea.innerHTML = consoleLogs.map(log => `
        <div style="margin-bottom: 3px; color: ${colors[log.type] || colors.log};">
            <span style="color: #666; font-size: 10px;">[${log.timestamp}]</span> ${escapeHtml(String(log.message))}
        </div>
    `).join('');

    logArea.scrollTop = 0;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function initDevConsole() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F12') {
            e.preventDefault();
            if (isConsoleOpen) {
                closeDevConsole();
            } else {
                openDevConsole();
            }
        }
    });

    addConsoleLog('Auto366内部控制台工具已加载，按F12打开/关闭', 'info');
    console.log('Auto366内部控制台工具已加载，使用 openDevConsole() 和 closeDevConsole() 控制显示');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDevConsole);
} else {
    initDevConsole();
}

// 辅助函数
// 通过ID检查元素
window.inspectElementById = function (elementId) {
    const element = window['elementRef_' + elementId];
    if (element) {
        inspectElement(element);
    }
};

// 通过ID高亮元素
window.highlightElementById = function (elementId) {
    const element = window['elementRef_' + elementId];
    if (element && inspectorOverlay) {
        const rect = element.getBoundingClientRect();
        inspectorOverlay.style.display = 'block';
        inspectorOverlay.style.left = (rect.left + window.scrollX) + 'px';
        inspectorOverlay.style.top = (rect.top + window.scrollY) + 'px';
        inspectorOverlay.style.width = rect.width + 'px';
        inspectorOverlay.style.height = rect.height + 'px';
    }
};

// 移除高亮
window.removeHighlight = function () {
    if (inspectorOverlay) {
        inspectorOverlay.style.display = 'none';
    }
};

// 切换元素组显示
window.toggleElementGroup = function (tagName) {
    const group = document.getElementById('group-' + tagName);
    const toggle = document.getElementById('toggle-' + tagName);
    if (group && toggle) {
        if (group.style.display === 'none') {
            group.style.display = 'block';
            toggle.textContent = '▼';
        } else {
            group.style.display = 'none';
            toggle.textContent = '▶';
        }
    }
};

// 聚焦到当前选中的元素
window.focusElement = function () {
    if (window.currentSelectedElement) {
        inspectElement(window.currentSelectedElement);
    }
};

// 复制元素信息
window.copyElementInfo = function () {
    if (window.currentSelectedElement) {
        const el = window.currentSelectedElement;
        const info = `标签: ${el.tagName.toLowerCase()}\nID: ${el.id || '无'}\n类名: ${el.className || '无'}\n文本: ${el.textContent.substring(0, 100)}\nHTML: ${el.outerHTML}`;
        navigator.clipboard.writeText(info).then(() => {
            addConsoleLog('元素信息已复制到剪贴板', 'info');
        }).catch(() => {
            addConsoleLog('复制失败', 'error');
        });
    }
};

window.openDevConsole = openDevConsole;
window.closeDevConsole = closeDevConsole;