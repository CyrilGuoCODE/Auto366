// Auto366内部控制台
// 适用于PK和填空模式的调试工具

let devConsole = null;
let isConsoleOpen = false;
let isDragging = false;
let isResizing = false;
let dragOffset = { x: 0, y: 0 };
let resizeHandle = null;

// 控制台日志存储
let consoleLogs = [];
let maxLogs = 100;

// 元素检查器状态
let inspectorMode = false;
let highlightedElement = null;
let inspectorOverlay = null;
let selectedElement = null;

// 开启开发者控制台
function openDevConsole() {
    if (devConsole) {
        // 如果控制台已存在，则关闭它
        closeDevConsole();
        return;
    }

    createDevConsole();
    isConsoleOpen = true;
    addConsoleLog('Auto366内部控制台已启动', 'info');
    // 首次创建时自动刷新元素树
    setTimeout(() => {
        refreshElementTree();
    }, 100);
}

// 关闭开发者控制台
function closeDevConsole() {
    if (devConsole) {
        devConsole.remove();
        devConsole = null;
        isConsoleOpen = false;
        if (inspectorMode) {
            toggleInspector();
        }
    }
}

// 创建开发者控制台界面
function createDevConsole() {
    devConsole = document.createElement('div');
    devConsole.id = 'dev-console';
    devConsole.style.cssText = `
        position: fixed;
        top: 100px;
        left: 100px;
        width: 900px;
        height: 650px;
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
        min-width: 600px;
        min-height: 400px;
    `;

    // 创建标题栏
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
        height: 32px;
        background: #2d2d2d;
        border-bottom: 1px solid #333;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px;
        cursor: move;
        user-select: none;
        border-radius: 8px 8px 0 0;
    `;

    const title = document.createElement('span');
    title.textContent = 'Auto366内部控制台';
    title.style.cssText = `
        font-weight: bold;
        font-size: 13px;
    `;

    const controls = document.createElement('div');
    controls.style.cssText = `
        display: flex;
        gap: 6px;
    `;

    const closeBtn = createControlButton('×', closeDevConsole);

    controls.appendChild(closeBtn);
    titleBar.appendChild(title);
    titleBar.appendChild(controls);

    // 创建标签页
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
        height: 36px;
        background: #252526;
        border-bottom: 1px solid #333;
        display: flex;
        align-items: center;
        padding: 0 12px;
        gap: 2px;
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
            padding: 6px 16px;
            cursor: ${tab.enabled ? 'pointer' : 'not-allowed'};
            border-radius: 4px 4px 0 0;
            font-size: 11px;
            opacity: ${tab.enabled ? '1' : '0.5'};
            transition: all 0.2s ease;
        `;

        if (tab.enabled) {
            btn.addEventListener('click', () => switchTab(tab.id));
            btn.addEventListener('mouseenter', () => {
                if (tab.id !== activeTab) {
                    btn.style.background = 'rgba(255,255,255,0.1)';
                }
            });
            btn.addEventListener('mouseleave', () => {
                if (tab.id !== activeTab) {
                    btn.style.background = 'transparent';
                }
            });
        }

        tabButtons[tab.id] = btn;
        tabBar.appendChild(btn);
    });

    // 创建内容区域
    const content = document.createElement('div');
    content.style.cssText = `
        flex: 1;
        display: flex;
        overflow: hidden;
    `;

    // 创建各个面板
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

    // 切换标签页函数
    function switchTab(tabId) {
        activeTab = tabId;
        Object.keys(tabButtons).forEach(id => {
            const isActive = id === tabId;
            tabButtons[id].style.background = isActive ? '#007acc' : 'transparent';
        });
        Object.keys(panels).forEach(id => {
            panels[id].style.display = id === tabId ? 'flex' : 'none';
        });
    }

    // 初始化显示
    switchTab('elements');

    // 创建调整大小手柄
    const resizeHandles = createResizeHandles();

    devConsole.appendChild(titleBar);
    devConsole.appendChild(tabBar);
    devConsole.appendChild(content);
    resizeHandles.forEach(handle => devConsole.appendChild(handle));

    document.body.appendChild(devConsole);

    // 添加拖拽功能
    setupDragAndResize(titleBar);
}

// 创建控制按钮
function createControlButton(text, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
        width: 22px;
        height: 22px;
        background: #444;
        border: none;
        color: #fff;
        cursor: pointer;
        border-radius: 3px;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease;
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

    // 左侧元素树
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = `
        width: 50%;
        display: flex;
        flex-direction: column;
        border-right: 1px solid #333;
    `;

    // 工具栏
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        height: 40px;
        background: #2d2d2d;
        border-bottom: 1px solid #333;
        display: flex;
        align-items: center;
        padding: 0 12px;
        gap: 8px;
    `;

    const inspectorBtn = document.createElement('button');
    inspectorBtn.id = 'inspector-toggle-btn';
    inspectorBtn.textContent = '选择元素';
    inspectorBtn.style.cssText = `
        background: #007acc;
        border: none;
        color: #fff;
        padding: 6px 12px;
        cursor: pointer;
        border-radius: 4px;
        font-size: 11px;
        transition: background 0.2s ease;
    `;
    inspectorBtn.addEventListener('click', toggleInspector);

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '刷新';
    refreshBtn.style.cssText = `
        background: #444;
        border: none;
        color: #fff;
        padding: 6px 12px;
        cursor: pointer;
        border-radius: 4px;
        font-size: 11px;
        transition: background 0.2s ease;
    `;
    refreshBtn.addEventListener('click', refreshElementTree);
    refreshBtn.addEventListener('mouseenter', () => refreshBtn.style.background = '#555');
    refreshBtn.addEventListener('mouseleave', () => refreshBtn.style.background = '#444');

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清除选择';
    clearBtn.style.cssText = `
        background: #666;
        border: none;
        color: #fff;
        padding: 6px 12px;
        cursor: pointer;
        border-radius: 4px;
        font-size: 11px;
        transition: background 0.2s ease;
    `;
    clearBtn.addEventListener('click', clearSelection);
    clearBtn.addEventListener('mouseenter', () => clearBtn.style.background = '#777');
    clearBtn.addEventListener('mouseleave', () => clearBtn.style.background = '#666');

    toolbar.appendChild(inspectorBtn);
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(clearBtn);

    // 元素树容器
    const elementTree = document.createElement('div');
    elementTree.id = 'element-tree';
    elementTree.style.cssText = `
        flex: 1;
        background: #1e1e1e;
        overflow-y: auto;
        padding: 12px;
    `;

    leftPanel.appendChild(toolbar);
    leftPanel.appendChild(elementTree);

    // 右侧属性面板
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = `
        width: 50%;
        display: flex;
        flex-direction: column;
        background: #252526;
    `;

    // 属性面板标题
    const propHeader = document.createElement('div');
    propHeader.style.cssText = `
        height: 40px;
        background: #2d2d2d;
        border-bottom: 1px solid #333;
        display: flex;
        align-items: center;
        padding: 0 12px;
        font-weight: bold;
        font-size: 12px;
    `;
    propHeader.textContent = '元素属性';

    // 属性内容
    const propContent = document.createElement('div');
    propContent.id = 'element-properties';
    propContent.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 12px;
    `;

    rightPanel.appendChild(propHeader);
    rightPanel.appendChild(propContent);

    panel.appendChild(leftPanel);
    panel.appendChild(rightPanel);

    // 初始化元素树
    refreshElementTree();

    return panel;
}

// 创建控制台面板
function createConsolePanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #1e1e1e;
    `;

    // 日志区域
    const logArea = document.createElement('div');
    logArea.id = 'console-logs';
    logArea.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        font-family: 'Consolas', monospace;
        font-size: 11px;
        line-height: 1.5;
    `;

    // 输入区域
    const inputArea = document.createElement('div');
    inputArea.style.cssText = `
        height: 36px;
        border-top: 1px solid #333;
        display: flex;
        align-items: center;
        padding: 0 12px;
        background: #252526;
    `;

    const prompt = document.createElement('span');
    prompt.textContent = '> ';
    prompt.style.cssText = `
        color: #007acc;
        font-weight: bold;
    `;

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
        margin-left: 6px;
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

// 创建网络面板
function createNetworkPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        width: 100%;
        height: 100%;
        background: #1e1e1e;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        text-align: center;
        color: #888;
    `;
    content.innerHTML = `
        <div style="font-size: 16px; margin-bottom: 8px;">网络监控面板</div>
        <div style="font-size: 12px; margin-bottom: 4px;">监控页面的网络请求</div>
        <div style="font-size: 11px; color: #666;">功能暂未开放</div>
    `;

    panel.appendChild(content);
    return panel;
}

// 创建源码面板
function createSourcesPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        width: 100%;
        height: 100%;
        background: #1e1e1e;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        text-align: center;
        color: #888;
    `;
    content.innerHTML = `
        <div style="font-size: 16px; margin-bottom: 8px;">源码调试面板</div>
        <div style="font-size: 12px; margin-bottom: 4px;">查看和调试JavaScript源码</div>
        <div style="font-size: 11px; color: #666;">功能暂未开放</div>
    `;

    panel.appendChild(content);
    return panel;
}

// 创建调整大小手柄
function createResizeHandles() {
    const handles = [];
    const positions = [
        { pos: 'se', cursor: 'se-resize', right: '0', bottom: '0', width: '12px', height: '12px' },
        { pos: 's', cursor: 's-resize', left: '50%', bottom: '0', width: '100px', height: '4px', transform: 'translateX(-50%)' },
        { pos: 'e', cursor: 'e-resize', right: '0', top: '50%', width: '4px', height: '100px', transform: 'translateY(-50%)' }
    ];

    positions.forEach(({ pos, cursor, width, height, ...style }) => {
        const handle = document.createElement('div');
        handle.className = `resize-handle-${pos}`;
        handle.style.cssText = `
            position: absolute;
            width: ${width};
            height: ${height};
            cursor: ${cursor};
            z-index: 10001;
            ${Object.entries(style).map(([k, v]) => `${k}: ${v}`).join('; ')};
        `;

        handle.addEventListener('mousedown', (e) => startResize(e, pos));
        handles.push(handle);
    });

    return handles;
}

// 设置拖拽和调整大小
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

// 开始拖拽
function startDrag(e) {
    isDragging = true;
    const rect = devConsole.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
}

// 开始调整大小
function startResize(e, position) {
    isResizing = true;
    resizeHandle = position;
    e.stopPropagation();
}

// 处理调整大小
function handleResize(e) {
    if (!isResizing || !resizeHandle) return;

    const rect = devConsole.getBoundingClientRect();
    const minWidth = 600;
    const minHeight = 400;

    if (resizeHandle.includes('e')) {
        const newWidth = Math.max(minWidth, e.clientX - rect.left);
        devConsole.style.width = newWidth + 'px';
    }

    if (resizeHandle.includes('s')) {
        const newHeight = Math.max(minHeight, e.clientY - rect.top);
        devConsole.style.height = newHeight + 'px';
    }
}

// 切换元素检查器
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

// 创建检查器覆盖层
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
        box-shadow: 0 0 0 1px rgba(0, 122, 204, 0.3);
    `;
    document.body.appendChild(inspectorOverlay);
}

// 移除检查器覆盖层
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
}

// 检查元素
function inspectElement(element) {
    selectedElement = element;

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

    // 更新属性面板
    updatePropertiesPanel(element);

    // 在元素树中高亮选中的元素
    highlightInElementTree(element);

    addConsoleLog(`已检查元素: ${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${element.className ? '.' + element.className.split(' ').join('.') : ''}`, 'info');
}

// 更新属性面板
function updatePropertiesPanel(element) {
    const propContent = document.getElementById('element-properties');
    if (!propContent) return;

    const computedStyles = window.getComputedStyle(element);
    const importantStyles = [
        'display', 'position', 'width', 'height', 'margin', 'padding',
        'background-color', 'color', 'font-size', 'border', 'z-index', 'opacity'
    ];

    let html = `
        <div style="margin-bottom: 16px;">
            <div style="color: #007acc; font-weight: bold; font-size: 13px; margin-bottom: 8px;">基本信息</div>
            <div style="margin-bottom: 4px;"><span style="color: #f92672;">标签:</span> <span style="color: #a6e22e;">${element.tagName.toLowerCase()}</span></div>
            <div style="margin-bottom: 4px;"><span style="color: #f92672;">ID:</span> <span style="color: #a6e22e;">${element.id || '无'}</span></div>
            <div style="margin-bottom: 4px;"><span style="color: #f92672;">类名:</span> <span style="color: #66d9ef;">${element.className || '无'}</span></div>
            <div style="margin-bottom: 8px;"><span style="color: #f92672;">文本:</span> <span style="color: #e6db74;">${element.textContent.substring(0, 100)}${element.textContent.length > 100 ? '...' : ''}</span></div>
        </div>
        
        <div style="margin-bottom: 16px;">
            <div style="color: #007acc; font-weight: bold; font-size: 13px; margin-bottom: 8px;">计算样式</div>
    `;

    importantStyles.forEach(prop => {
        const value = computedStyles.getPropertyValue(prop);
        if (value) {
            html += `<div style="margin-bottom: 3px; font-size: 11px;">
                <span style="color: #f92672;">${prop}:</span> 
                <span style="color: #a6e22e;">${value}</span>
            </div>`;
        }
    });

    html += `
        </div>
        
        <div style="margin-bottom: 16px;">
            <div style="color: #007acc; font-weight: bold; font-size: 13px; margin-bottom: 8px;">操作</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button onclick="focusElement()" style="background: #007acc; border: none; color: #fff; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px;">重新聚焦</button>
                <button onclick="copyElementInfo()" style="background: #4caf50; border: none; color: #fff; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px;">复制HTML</button>
            </div>
        </div>
        
        <div>
            <div style="color: #007acc; font-weight: bold; font-size: 13px; margin-bottom: 8px;">HTML代码</div>
            <pre style="background: #2d2d2d; padding: 12px; border-radius: 4px; font-size: 10px; overflow-x: auto; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(element.outerHTML.substring(0, 1000))}${element.outerHTML.length > 1000 ? '\n...' : ''}</pre>
        </div>
    `;

    propContent.innerHTML = html;
}

// 刷新元素树
function refreshElementTree() {
    const elementTree = document.getElementById('element-tree');
    if (!elementTree) return;

    // 获取所有可见元素
    const allElements = document.querySelectorAll('*');
    const visibleElements = Array.from(allElements).filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            el.offsetWidth > 0 &&
            el.offsetHeight > 0 &&
            !devConsole.contains(el);
    });

    // 按标签名分组
    const elementsByTag = {};
    visibleElements.forEach(el => {
        const tagName = el.tagName.toLowerCase();
        if (!elementsByTag[tagName]) {
            elementsByTag[tagName] = [];
        }
        elementsByTag[tagName].push(el);
    });

    let html = `<div style="color: #007acc; font-weight: bold; font-size: 13px; margin-bottom: 12px;">页面元素 (共${visibleElements.length}个)</div>`;

    // 显示每个标签类型
    Object.keys(elementsByTag).sort().forEach(tagName => {
        const elements = elementsByTag[tagName];
        const groupId = `group-${tagName}`;
        const toggleId = `toggle-${tagName}`;

        html += `
            <div style="margin-bottom: 8px;">
                <div style="color: #f92672; font-size: 12px; margin-bottom: 4px; cursor: pointer; padding: 4px; border-radius: 3px; transition: background 0.2s ease;" 
                     onclick="toggleElementGroup('${tagName}')" 
                     onmouseover="this.style.background='rgba(255,255,255,0.1)'" 
                     onmouseout="this.style.background='transparent'">
                    <span id="${toggleId}">▼</span> ${tagName} (${elements.length}个)
                </div>
                <div id="${groupId}" style="margin-left: 16px; border-left: 1px solid #333; padding-left: 8px;">
        `;

        elements.forEach((el, index) => {
            if (index < 15) {
                const elementId = `element-${tagName}-${index}`;
                const displayText = el.textContent ? el.textContent.substring(0, 40) + (el.textContent.length > 40 ? '...' : '') : '';

                html += `
                    <div style="font-size: 11px; color: #ccc; cursor: pointer; padding: 3px 6px; margin-bottom: 2px; border-radius: 3px; transition: all 0.2s ease;" 
                         onclick="inspectElementById('${elementId}')" 
                         onmouseover="highlightElementById('${elementId}'); this.style.background='rgba(0,122,204,0.2)'; this.style.color='#fff';"
                         onmouseout="removeHighlight(); this.style.background='transparent'; this.style.color='#ccc';">
                        <span style="color: #66d9ef;">${el.tagName.toLowerCase()}</span>${el.id ? `<span style="color: #a6e22e;">#${el.id}</span>` : ''}${el.className ? `<span style="color: #f92672;">.${el.className.split(' ').slice(0, 2).join('.')}</span>` : ''}
                        ${displayText ? `<span style="color: #888; margin-left: 8px;">- ${displayText}</span>` : ''}
                    </div>
                `;

                // 存储元素引用
                window[`elementRef_${elementId}`] = el;
            }
        });

        if (elements.length > 15) {
            html += `<div style="font-size: 11px; color: #666; padding: 3px 6px; font-style: italic;">...还有${elements.length - 15}个元素</div>`;
        }

        html += '</div></div>';
    });

    elementTree.innerHTML = html;
}

// 在元素树中高亮选中的元素
function highlightInElementTree(element) {
    // 移除之前的高亮
    const prevHighlighted = document.querySelector('.element-tree-selected');
    if (prevHighlighted) {
        prevHighlighted.classList.remove('element-tree-selected');
        prevHighlighted.style.background = 'transparent';
        prevHighlighted.style.color = '#ccc';
    }

    // 查找对应的元素项并高亮
    const tagName = element.tagName.toLowerCase();
    const elements = document.querySelectorAll(tagName);
    const index = Array.from(elements).indexOf(element);

    if (index !== -1 && index < 15) {
        const elementId = `element-${tagName}-${index}`;
        const treeItem = document.querySelector(`[onclick="inspectElementById('${elementId}')"]`);
        if (treeItem) {
            treeItem.classList.add('element-tree-selected');
            treeItem.style.background = 'rgba(0,122,204,0.3)';
            treeItem.style.color = '#fff';
            treeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

// 清除选择
function clearSelection() {
    selectedElement = null;
    const propContent = document.getElementById('element-properties');
    if (propContent) {
        propContent.innerHTML = `
            <div style="color: #888; text-align: center; margin-top: 50px;">
                <div style="font-size: 14px; margin-bottom: 8px;">未选择元素</div>
                <div style="font-size: 11px;">点击"选择元素"按钮或在元素树中选择一个元素</div>
            </div>
        `;
    }

    // 移除元素树中的高亮
    const prevHighlighted = document.querySelector('.element-tree-selected');
    if (prevHighlighted) {
        prevHighlighted.classList.remove('element-tree-selected');
        prevHighlighted.style.background = 'transparent';
        prevHighlighted.style.color = '#ccc';
    }

    addConsoleLog('已清除元素选择', 'info');
}

// 执行控制台命令
function executeConsoleCommand(command) {
    addConsoleLog('> ' + command, 'command');

    try {
        const result = eval(command);
        addConsoleLog(result, 'result');
    } catch (error) {
        addConsoleLog('Error: ' + error.message, 'error');
    }
}

// 添加控制台日志
function addConsoleLog(message, type = 'log') {
    const timestamp = new Date().toLocaleTimeString();
    consoleLogs.unshift({ timestamp, message, type });

    if (consoleLogs.length > maxLogs) {
        consoleLogs = consoleLogs.slice(0, maxLogs);
    }

    updateConsoleDisplay();
}

// 更新控制台显示
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
        <div style="margin-bottom: 4px; color: ${colors[log.type] || colors.log}; padding: 2px 0;">
            <span style="color: #666; font-size: 10px;">[${log.timestamp}]</span> ${escapeHtml(String(log.message))}
        </div>
    `).join('');

    logArea.scrollTop = 0;
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 初始化
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

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDevConsole);
} else {
    initDevConsole();
}

// 全局辅助函数
window.inspectElementById = function (elementId) {
    const element = window[`elementRef_${elementId}`];
    if (element) {
        inspectElement(element);
    }
};

window.highlightElementById = function (elementId) {
    const element = window[`elementRef_${elementId}`];
    if (element && inspectorOverlay) {
        const rect = element.getBoundingClientRect();
        inspectorOverlay.style.display = 'block';
        inspectorOverlay.style.left = (rect.left + window.scrollX) + 'px';
        inspectorOverlay.style.top = (rect.top + window.scrollY) + 'px';
        inspectorOverlay.style.width = rect.width + 'px';
        inspectorOverlay.style.height = rect.height + 'px';
    }
};

window.removeHighlight = function () {
    if (inspectorOverlay) {
        inspectorOverlay.style.display = 'none';
    }
};

window.toggleElementGroup = function (tagName) {
    const group = document.getElementById(`group-${tagName}`);
    const toggle = document.getElementById(`toggle-${tagName}`);
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

window.focusElement = function () {
    if (selectedElement) {
        inspectElement(selectedElement);
    }
};

window.copyElementInfo = function () {
    if (selectedElement) {
        // 复制完整的HTML代码，包括所有子元素
        const htmlCode = selectedElement.outerHTML;

        navigator.clipboard.writeText(htmlCode).then(() => {
            addConsoleLog('完整HTML代码已复制到剪贴板', 'info');
        }).catch(() => {
            addConsoleLog('复制失败', 'error');
        });
    }
};

// 暴露全局函数
window.openDevConsole = openDevConsole;
window.closeDevConsole = closeDevConsole;