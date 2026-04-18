const { app, BrowserWindow, screen, ipcMain, nativeTheme, Menu, protocol, dialog, shell } = require('electron');
const path = require('path');

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.isAlwaysOnTop = false;
  }

  // 创建主窗口
  createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    this.mainWindow = new BrowserWindow({
      width: Math.min(width * 0.9, 1200),
      height: Math.min(height * 0.9, 800),
      minWidth: 800,
      minHeight: 600,
      frame: false, // 无边框窗口
      titleBarStyle: 'customButtonsOnHover',
      trafficLightPosition: { x: 15, y: 13 },
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        nodeIntegration: true,
        contextIsolation: true,
        enableRemoteModule: false,
        webSecurity: true,
        sandbox: false
      }
    });

    // 打开开发者工具
    this.mainWindow.webContents.openDevTools();

    // 加载HTML文件
    this.mainWindow.loadFile('index.html');

    // 窗口事件
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    this.mainWindow.on('maximize', () => {
      this.mainWindow.webContents.send('window-maximized');
    });

    this.mainWindow.on('unmaximize', () => {
      this.mainWindow.webContents.send('window-unmaximized');
    });

    // 禁用默认的菜单
    Menu.setApplicationMenu(null);
  }

  // 切换窗口置顶
  async toggleAlwaysOnTop() {
    if (!this.mainWindow) return { success: false, error: '窗口未初始化' };

    this.isAlwaysOnTop = !this.isAlwaysOnTop;
    this.mainWindow.setAlwaysOnTop(this.isAlwaysOnTop);

    return {
      success: true,
      isAlwaysOnTop: this.isAlwaysOnTop
    };
  }

  // 获取窗口置顶状态
  getAlwaysOnTop() {
    return this.isAlwaysOnTop;
  }

  // 检查窗口是否最大化
  async windowIsMaximized() {
    if (!this.mainWindow) return false;
    return this.mainWindow.isMaximized();
  }

  // 切换窗口最大化
  async windowToggleMaximize() {
    if (!this.mainWindow) return;

    if (this.mainWindow.isMaximized()) {
      this.mainWindow.unmaximize();
    } else {
      this.mainWindow.maximize();
    }
  }

  // 最小化窗口
  windowMinimize() {
    if (this.mainWindow) {
      this.mainWindow.minimize();
    }
  }

  // 关闭窗口
  windowClose() {
    if (this.mainWindow) {
      this.mainWindow.close();
    }
  }

  // 显示窗口
  showWindow() {
    if (this.mainWindow) {
      this.mainWindow.show();
    }
  }

  // 隐藏窗口
  hideWindow() {
    if (this.mainWindow) {
      this.mainWindow.hide();
    }
  }

  // 聚焦窗口
  focusWindow() {
    if (this.mainWindow) {
      this.mainWindow.focus();
    }
  }

  // 发送消息到渲染进程
  sendToRenderer(channel, data) {
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  // 获取应用版本
  getAppVersion() {
    return app.getVersion();
  }
}

module.exports = WindowManager;
