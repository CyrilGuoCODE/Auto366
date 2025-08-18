const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell } = require('electron')
const path = require('path')
const { mouse, straightTo, Point, Button, keyboard, Key, screen: nutScreen } = require('@nut-tree/nut-js');
const { spawn, kill } = require('child_process')
const http = require('http')
const https = require('https')
const net = require('net')
const url = require('url')
const fs = require('fs-extra')
const axios = require('axios')
const StreamZip = require('node-stream-zip')
const mitmproxy = require('node-mitmproxy')
const CRLF = '\r\n';

let mainWindow
let locationWindow
let locationWindowPk
let pos
let pos_pk = {}
let ans
let flag = 0;
let pythonProcess
let globalScale = 100

// URL处理工具函数
function isValidAndCompleteUrl(urlString) {
  try {
    // 检查是否是完整URL
    if (urlString.startsWith('http://') || urlString.startsWith('https://')) {
      new URL(urlString); // 验证URL格式
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// 构建完整URL
function buildCompleteUrl(rOptions, ssl) {
  try {
    return `${rOptions.protocol || 'http'}//${rOptions.hostname}:${rOptions.port || (ssl ? 443 : 80)}${rOptions.path || ''}`;
  } catch (e) {
    console.error('构建URL失败:', e);
    return null;
  }
}

// 答案获取相关变量
let proxyAgent = null
let isCapturing = false
let extractedAnswers = []
let downloadUrl = ''

// 根据缩放率调整坐标
function adjustCoordinates(x, y, scale) {
  const scaleFactor = scale / 100
  return {
    x: Math.round(x * scaleFactor),
    y: Math.round(y * scaleFactor)
  }
}

ipcMain.handle('get-scale-factor', () => {
  globalScale = screen.getPrimaryDisplay().scaleFactor * 100;
  console.log('全局缩放率设置为:', globalScale)
  return globalScale;
});

// 增强的点击函数
async function robustClick(x, y, retries = 3) {
  try {
    const adjustedCoords = adjustCoordinates(x, y, globalScale);
    await mouse.setPosition(new Point(adjustedCoords.x, adjustedCoords.y));
    await mouse.click(Button.LEFT);
    return true;
  } catch (error) {
    if (retries > 0) {
      console.warn(`点击失败，剩余重试次数: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, 500));
      return robustClick(x, y, retries - 1);
    }
    throw new Error(`点击操作失败: ${error.message}`);
  }
}

// 增强的窗口激活函数
async function robustActivateWindow(x, y, retries = 3) {
  try {
    const adjustedCoords = adjustCoordinates(x, y, globalScale);
    await mouse.setPosition(new Point(adjustedCoords.x, adjustedCoords.y));
    await mouse.click(Button.LEFT);
    await new Promise(resolve => setTimeout(resolve, 300)); // 等待窗口响应
    return true;
  } catch (error) {
    if (retries > 0) {
      console.warn(`窗口激活失败，剩余重试次数: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, 500));
      return robustActivateWindow(x, y, retries - 1);
    }
    throw new Error(`窗口激活失败: ${error.message}`);
  }
}

// 增强的输入函数
async function robustType(text, retries = 3) {
  try {
    await keyboard.type(text);
    return true;
  } catch (error) {
    if (retries > 0) {
      console.warn(`输入失败，剩余重试次数: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, 300));
      return robustType(text, retries - 1);
    }
    throw new Error(`输入操作失败: ${error.message}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 1010,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: true,
    }
  })

  mainWindow.setMenu(null);

  mainWindow.loadFile('index.html')

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key === 'F12') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
      event.preventDefault();
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 所有链接都在外部浏览器打开
    shell.openExternal(url);
    return { action: 'deny' }; // 阻止在Electron中打开
  });

  globalShortcut.register('Ctrl+Shift+Q', () => {
    flag = 0
    stopPythonScript()
  })
}

app.whenReady().then(async () => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})



app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('open-location-window', () => {
  if (locationWindow) return;
  if (mainWindow) mainWindow.minimize()

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  locationWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    modal: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: `${__dirname}/preload.js`
    },
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    type: 'panel',
    titleBarStyle: 'hidden',
    visualEffectState: 'active',
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
  });

  locationWindow.loadFile('location.html');
  locationWindow.setMenu(null);
  locationWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  locationWindow.on('closed', () => {
    locationWindow = null;
  });
});

ipcMain.on('set-locations', (event, locations) => {
  //  console.log('Received locations:', locations);
  if (mainWindow) mainWindow.restore()
  pos = locations
  mainWindow.webContents.send('update-locations', locations);
});

ipcMain.on('start-point', async () => {
  if (mainWindow) mainWindow.minimize()
  //  console.log('开始执行，坐标信息:', pos);
  //  console.log('答案数组:', ans);
  flag = 1
  try {
    // 先激活目标窗口
    await robustActivateWindow(pos.pos1.x, pos.pos1.y, 3);

    for (let i = 0; i < ans.length; i++) {
      if (!flag) {
        mainWindow.webContents.send('operation-complete', { success: false, error: '填充被用户取消' });
        return
      }

      //      console.log(`处理第${i+1}个答案: ${ans[i]}`);

      // 再次确保窗口激活
      await robustClick(pos.pos1.x, pos.pos1.y);

      // 输入答案
      await robustType(ans[i]);

      // 点击提交或确认按钮
      await robustClick(pos.pos2.x, pos.pos2.y);

      // 添加操作间隔
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    mainWindow.webContents.send('operation-complete', { success: true });
  } catch (error) {
    console.error('执行过程中出错:', error);
    mainWindow.webContents.send('operation-complete', {
      success: false,
      error: error.message
    });
  }
})

ipcMain.on('set-answer', (event, answer) => {
  ans = answer
})

ipcMain.on('open-location-window-pk', () => {
  if (locationWindowPk) locationWindowPk.close();
  if (mainWindow) mainWindow.minimize()

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  locationWindowPk = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    modal: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: `${__dirname}/preload.js`
    },
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    type: 'panel',
    titleBarStyle: 'hidden',
    visualEffectState: 'active',
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
  });

  locationWindowPk.loadFile('selection1.html');
  locationWindowPk.setMenu(null);
  locationWindowPk.setAlwaysOnTop(true, 'screen-saver', 1);

  locationWindowPk.on('closed', () => {
    locationWindowPk = null;
  });
});

ipcMain.on('set-locations-pk-1', (event, pos1) => {
  pos_pk.pos1 = pos1

  if (locationWindowPk) locationWindowPk.close();

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  locationWindowPk = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    modal: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: `${__dirname}/preload.js`
    },
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    type: 'panel',
    titleBarStyle: 'hidden',
    visualEffectState: 'active',
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
  });

  locationWindowPk.loadFile('selection2.html');
  locationWindowPk.setMenu(null);
  locationWindowPk.setAlwaysOnTop(true, 'screen-saver', 1);

  locationWindowPk.on('closed', () => {
    locationWindowPk = null;
  });
})

ipcMain.on('set-locations-pk-2', (event, pos2) => {
  if (mainWindow) mainWindow.restore()
  pos_pk.pos2 = pos2
  mainWindow.webContents.send('update-locations-pk', pos_pk);
})

ipcMain.on('start-choose', () => {
  if (mainWindow) mainWindow.minimize()
  //const pythonProcess = spawn('backend.exe', [JSON.stringify(pos_pk)])
  pythonProcess = spawn('python', ['backend.py', JSON.stringify(pos_pk)])

  let buffer = '';

  pythonProcess.stdout.on('data', (data) => {
    buffer += data.toString();

    // 尝试解析完整的JSON
    try {
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留最后一个可能不完整的行

      for (const line of lines) {
        if (line.trim()) {
          const result = JSON.parse(line);
          console.log('Received result:', result);

          if (result.error) {
            console.log('Python error:', result.error);
            mainWindow.webContents.send('choose-error', `Python error: ${result.error}`);
          } else if (result.matched_position) {
            let x = result.matched_position.x + result.matched_position.width / 2
            let y = result.matched_position.y + result.matched_position.height / 2
            robustClick(x, y)
          } else {
            console.log('定位失败，请手动选择')
            mainWindow.webContents.send('choose-error', '定位失败，请手动选择');
          }
        }
      }
    } catch (e) {
      console.log('JSON parsing error:', e);
    }
  })

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python error: ${data}`)
    mainWindow.webContents.send('choose-error', `Python error: ${data}`);
  })
})

// 添加全局缩放率设置事件
ipcMain.on('set-global-scale', (event, scale) => {
  globalScale = scale;
  console.log('全局缩放率设置为:', scale)
});

function stopPythonScript() {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM'); // 或 'SIGKILL' 强制终止
    pythonProcess = null;
  }
}

// 答案获取功能
function startAnswerProxy() {
  if (proxyAgent) {
    stopAnswerProxy()
  }

  // 创建MITM代理实例
  proxyAgent = mitmproxy.createProxy({
    port: 5291,
    ssl: {
      rejectUnauthorized: false
    },
    // 添加错误处理
    onError: (err, req, res) => {
      console.error('代理错误:', err);
      mainWindow.webContents.send('proxy-error', {
        message: `代理错误: ${err.message}`,
        timestamp: new Date().toISOString()
      });
      // 如果发生严重错误，尝试重新启动代理
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        console.log('代理端口被占用或无权限访问，尝试重新启动...');
        setTimeout(() => {
          stopAnswerProxy();
          startAnswerProxy();
        }, 2000);
      }
    },
    sslConnectInterceptor: (req, cltSocket, head) => {
      try {
        console.log('SSL连接请求:', req.url);
        // 检查是否为合法的HTTPS请求
        if (req && req.url && typeof req.url === 'string') {
          return true; // 返回true表示拦截此连接
        }
        return false;
      } catch (error) {
        console.error('SSL连接拦截器错误:', error);
        return false;
      }
    },
    requestInterceptor: (rOptions, req, res, ssl, next) => {
      try {
        // 处理HTTP请求
        if (rOptions && rOptions.hostname) {
          // 构建并验证URL
          const fullUrl = buildCompleteUrl(rOptions, ssl);
          if (!fullUrl || !isValidAndCompleteUrl(fullUrl)) {
            console.warn('无效的URL格式，跳过处理:', fullUrl);
            next();
            return;
          }

          const requestInfo = {
            method: req.method,
            url: fullUrl,
            host: rOptions.hostname,
            path: rOptions.path || '',
            timestamp: new Date().toISOString(),
            isHttps: ssl
          };
          mainWindow.webContents.send('traffic-log', requestInfo);

        // 检查是否是答案下载链接
        if (isCapturing && rOptions.hostname && rOptions.hostname.includes('fs.') && rOptions.path && rOptions.path.includes('/download/')) {
          try {
            downloadUrl = buildCompleteUrl(rOptions, ssl);
            if (downloadUrl && isValidAndCompleteUrl(downloadUrl)) {
              console.log('发现答案下载链接:', downloadUrl);
              mainWindow.webContents.send('download-found', { url: downloadUrl });
              downloadAndProcessFile(downloadUrl);
            } else {
              console.warn('构建的下载链接无效，跳过处理:', downloadUrl);
            }
          } catch (e) {
            console.error('处理答案下载链接时出错:', e);
          }
        }

        // 处理POST请求体
        if (req.method === 'POST' && req.body) {
          try {
            if (typeof req.body === 'string' && req.body.includes('downloadUrl')) {
              processRequestBody(req.body, rOptions.hostname, rOptions.path);
            }
          } catch (e) {
            console.error('处理POST请求体错误:', e);
          }
        }
      }

      // 必须调用next()才能继续请求
      next();

      // 处理响应
      if (res && res.response) {
        const response = res.response;

        // 监听响应内容
        if (isCapturing && req.url) {
          const parsedUrl = new URL(req.url);

          if (parsedUrl.hostname.includes('fs.') && (
            parsedUrl.pathname.includes('/download/') || 
            req.url.includes('fileinfo') ||
            req.url.includes('downloadUrl')
          )) {
            let body = '';

            response.on('data', (chunk) => {
              body += chunk;
              res.write(chunk);
            });

            response.on('end', () => {
              try {
                // 尝试解析JSON响应
                const jsonData = JSON.parse(body);
                if (jsonData && typeof jsonData === 'string' && jsonData.includes('fs.') && jsonData.includes('/download/')) {
                  downloadUrl = jsonData;
                  console.log('发现JSON中的答案下载链接:', jsonData);
                  mainWindow.webContents.send('download-found', { url: downloadUrl });
                  downloadAndProcessFile(downloadUrl);
                }
              } catch (e) {
                // 如果不是JSON，尝试直接提取下载链接
                if (body.includes('downloadUrl') || body.includes('download')) {
                  extractDownloadUrl(body);
                }
              }
              res.end();
            });
          } else {
            response.pipe(res);
          }
        } else {
          response.pipe(res);
        }
      }
    } catch (error) {
      console.error('请求拦截器错误:', error);
      next();
    }
    },
    responseInterceptor: (req, res, proxyReq, proxyRes, ssl, next) => {
      try {
        // 监听响应内容
        if (isCapturing && req && req.url) {
          // 使用工具函数验证URL
          if (!isValidAndCompleteUrl(req.url)) {
            console.log('跳过非完整URL处理:', req.url);
            proxyRes.pipe(res);
            next();
            return;
          }

          const parsedUrl = new URL(req.url);

          if (parsedUrl.hostname.includes('fs.') && (
            parsedUrl.pathname.includes('/download/') ||
            req.url.includes('fileinfo') ||
            req.url.includes('downloadUrl')
          )) {
            let body = '';

            proxyRes.on('data', (chunk) => {
              body += chunk;
              res.write(chunk);
            });

            proxyRes.on('end', () => {
              try {
                // 尝试解析JSON响应
                const jsonData = JSON.parse(body);
                if (jsonData && typeof jsonData === 'string' && jsonData.includes('fs.') && jsonData.includes('/download/')) {
                  // 验证JSON中的URL是否有效
                  if (isValidAndCompleteUrl(jsonData)) {
                    downloadUrl = jsonData;
                    console.log('发现JSON中的答案下载链接:', jsonData);
                    mainWindow.webContents.send('download-found', { url: downloadUrl });
                    downloadAndProcessFile(downloadUrl);
                  } else {
                    console.warn('JSON中的URL无效，跳过处理:', jsonData);
                  }
                }
              } catch (e) {
                // 如果不是JSON，尝试直接提取下载链接
                if (body.includes('downloadUrl') || body.includes('download')) {
                  try {
                    extractDownloadUrl(body);
                  } catch (extractError) {
                    console.error('提取下载链接失败:', extractError);
                  }
                }
              }
              res.end();
            });
          } else {
            proxyRes.pipe(res);
          }
        } else {
          proxyRes.pipe(res);
        }
      } catch (error) {
        console.error('响应拦截器错误:', error);
      }

      // 必须调用next()才能继续响应
      next();
    }
  });

  console.log('万能答案获取代理服务器已启动: 127.0.0.1:5291');
  mainWindow.webContents.send('proxy-status', {
    running: true,
    message: '代理服务器已启动，请设置天学网客户端代理为 127.0.0.1:5291'
  });
}

function processRequestBody(body, hostname, path) {
    if (body.includes('downloadUrl') || body.includes('download') || body.includes('fileinfo')) {
        mainWindow.webContents.send('important-request', {
            url: `https://${hostname}${path}`,
            body: body.substring(0, 500),
            isHttps: true
        });

        if (body.includes('fs.') && body.includes('/download/')) {
            console.log('HTTPS请求体包含答案下载信息');
            extractDownloadUrl(body);
        }
    }
}

function stopAnswerProxy() {
  if (proxyAgent) {
    try {
      // 尝试多种方式关闭代理
      if (typeof proxyAgent.close === 'function') {
        proxyAgent.close()
      } else if (typeof proxyAgent.destroy === 'function') {
        proxyAgent.destroy()
      } else if (typeof proxyAgent.abort === 'function') {
        proxyAgent.abort()
      }

      // 清理所有相关资源
      proxyAgent.removeAllListeners && proxyAgent.removeAllListeners()
      proxyAgent = null
      isCapturing = false
      downloadUrl = ''
      console.log('万能答案获取代理服务器已停止')
      mainWindow.webContents.send('proxy-status', { running: false, message: '代理服务器已停止' })
    } catch (error) {
      console.error('停止代理时出错:', error)
      mainWindow.webContents.send('proxy-error', { 
        message: `停止代理时出错: ${error.message}`,
        timestamp: new Date().toISOString()
      })
      // 即使出错，也尝试重置状态
      proxyAgent = null
      isCapturing = false
    }
  }
}

function parseUrl(urlStr) {
  const parts = urlStr.split(':')
  return {
    hostname: parts[0],
    port: parseInt(parts[1]) || 80
  }
}

function handleProxyRequest(req, res) {
  const isHttps = req.connection.encrypted || req.headers['x-forwarded-proto'] === 'https'
  const protocol = isHttps ? 'https:' : 'http:'
  const targetUrl = req.url.startsWith('http') ? req.url : `${protocol}//${req.headers.host}${req.url}`

  // 在这里正确定义 parsedUrl
  const parsedUrl = url.parse(targetUrl)

  // 记录请求信息（包含协议信息）
  const requestInfo = {
    method: req.method,
    url: targetUrl,
    host: req.headers.host,
    timestamp: new Date().toISOString(),
    isHttps: isHttps
  }

  // 发送流量信息到渲染进程
  mainWindow.webContents.send('traffic-log', requestInfo)

  if (isCapturing) {
    const isDownloadUrl = parsedUrl.hostname.includes('fs.') && parsedUrl.path.includes('/download/')

    if (isDownloadUrl) {
      downloadUrl = targetUrl
      console.log('发现答案下载链接:', targetUrl)
      mainWindow.webContents.send('download-found', { url: downloadUrl })
      downloadAndProcessFile(downloadUrl)
    }
  }

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.path,
    method: req.method,
    headers: { ...req.headers }
  }

  delete options.headers.host
  delete options.headers['proxy-connection']

  const protocolModule = isHttps ? https : http

  const proxyReq = protocolModule.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)

    // 检查是否需要监听响应内容
    const shouldMonitor = isCapturing && (
      req.url.includes('fileinfo') ||
      (req.url.includes('fs.') && req.url.includes('/download/'))
    )

    if (shouldMonitor) {
      let body = ''
      proxyRes.on('data', (chunk) => {
        body += chunk
        res.write(chunk)
      })

      proxyRes.on('end', () => {
        try {
          const responseData = JSON.parse(body)
          const url = responseData

          if (url.includes('fs.') && url.includes('/download/')) {
            downloadUrl = url
            console.log('发现JSON中的答案下载链接:', url)
            mainWindow.webContents.send('download-found', { url: downloadUrl })
            downloadAndProcessFile(downloadUrl)
          }
        }
        catch (e) {
          if (body.includes('downloadUrl') || body.includes('download')) {
            if (body.includes('fs.') && body.includes('/download/')) {
              console.log('响应体包含答案下载信息')
              extractDownloadUrl(body)
            }
          }
        }
        res.end()
      })
    } else {
      proxyRes.pipe(res)
    }
  })

  proxyReq.on('error', (err) => {
    console.error('代理请求错误:', err.message)
    if (!res.headersSent) {
      res.writeHead(502)
      res.end('Proxy Error')
    }
  })

  // 监听POST请求体
  if (isCapturing && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => {
      const chunkStr = chunk.toString()
      body += chunkStr
      proxyReq.write(chunk)
    })

    req.on('end', () => {
      if (body.includes('downloadUrl') || body.includes('download') || body.includes('fileinfo')) {
        mainWindow.webContents.send('important-request', {
          url: targetUrl,
          body: body.substring(0, 500),
          isHttps: isHttps
        })

        if (body.includes('fs.') && body.includes('/download/')) {
          console.log('请求体包含答案下载信息')
          extractDownloadUrl(body)
        }
      }
      proxyReq.end()
    })
  } else {
    req.pipe(proxyReq)
  }
}

function extractDownloadUrl(data) {
  try {
    const patterns = [
      /"downloadUrl":"(.*?)"/,
      /"downloadUrl":\s*"(.*?)"/,
      /downloadUrl['"]\s*:\s*['"]([^'"]+)['"]/
    ]

    for (const pattern of patterns) {
      const match = data.match(pattern)
      if (match && match[1]) {
        const url = match[1].replace(/\"/g, '"').replace(/\\//g, '/')

        // 只处理 fs.域名/download/ 格式的链接（不要求.zip后缀）
        if (url.includes('fs.') && url.includes('/download/')) {
          downloadUrl = url
          console.log('发现答案下载链接:', url)
          mainWindow.webContents.send('download-found', { url: downloadUrl })
          downloadAndProcessFile(downloadUrl)
          return
        } else {
          console.log('跳过非答案下载链接:', url)
          mainWindow.webContents.send('traffic-log', {
            method: 'INFO',
            url: `跳过链接: ${url} (不符合 fs.域名/download/ 格式)`,
            timestamp: new Date().toISOString()
          })
        }
      }
    }
  } catch (error) {
    console.error('提取下载链接失败:', error)
  }
}

async function downloadAndProcessFile(url) {
  try {
    mainWindow.webContents.send('process-status', { status: 'downloading', message: '正在下载文件...' })

    // 使用更可靠的路径处理方式，确保在打包后也能正确创建目录
    const appPath = app.isPackaged ? process.resourcesPath : __dirname
    const tempDir = path.join(appPath, 'temp')
    const ansDir = path.join(appPath, 'answers')

    let finalTempDir = tempDir
    let finalAnsDir = ansDir

    try {
      fs.ensureDirSync(tempDir)
      fs.ensureDirSync(ansDir)
    } catch (dirError) {
      console.error('创建目录失败，尝试使用用户目录:', dirError)
      // 如果在应用目录创建失败，尝试使用用户目录
      const userDataPath = app.getPath('userData')
      const tempDirAlt = path.join(userDataPath, 'temp')
      const ansDirAlt = path.join(userDataPath, 'answers')
      fs.ensureDirSync(tempDirAlt)
      fs.ensureDirSync(ansDirAlt)
      // 使用备用目录
      finalTempDir = tempDirAlt
      finalAnsDir = ansDirAlt
    }

    const timestamp = Date.now()
    const zipPath = path.join(finalTempDir, `exam_${timestamp}.zip`)

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000
    })

    const writer = fs.createWriteStream(zipPath)
    response.data.pipe(writer)

    writer.on('finish', () => {
      mainWindow.webContents.send('process-status', { status: 'extracting', message: '正在解压文件...' })
      extractZipFile(zipPath, finalAnsDir)
    })

    writer.on('error', (err) => {
      mainWindow.webContents.send('process-error', { error: `文件下载失败: ${err.message}` })
    })

  } catch (error) {
    mainWindow.webContents.send('process-error', { error: `下载失败: ${error.message}` })
  }
}

async function extractZipFile(zipPath, ansDir) {
  try {
    const extractDir = zipPath.replace('.zip', '')

    if (fs.existsSync(extractDir)) {
      fs.removeSync(extractDir)
    }

    fs.ensureDirSync(extractDir)

    const zip = new StreamZip.async({ file: zipPath })
    await zip.extract(null, extractDir)
    await zip.close()

    mainWindow.webContents.send('process-status', { status: 'processing', message: '正在分析文件结构...' })

    // 扫描所有解压的文件
    const fileStructure = scanDirectory(extractDir)

    // 发送文件结构到前端
    mainWindow.webContents.send('file-structure', {
      structure: fileStructure,
      extractDir: extractDir
    })

    // 查找并处理所有可能的答案文件
    const answerFiles = findAnswerFiles(extractDir)

    if (answerFiles.length > 0) {
      mainWindow.webContents.send('process-status', { status: 'processing', message: `找到 ${answerFiles.length} 个可能的答案文件，正在提取...` })

      let allAnswers = []
      let processedFiles = []
      let allFilesContent = [] // 存储所有文件内容

      for (const filePath of answerFiles) {
        try {
          // 读取文件内容
          const content = fs.readFileSync(filePath, 'utf-8')
          const relativePath = path.relative(extractDir, filePath)

          // 存储文件内容
          allFilesContent.push({
            file: relativePath,
            content: content
          })

          const answers = extractAnswersFromFile(filePath)
          if (answers.length > 0) {
            allAnswers = allAnswers.concat(answers.map(ans => ({
              ...ans,
              sourceFile: relativePath
            })))
            processedFiles.push({
              file: relativePath,
              answerCount: answers.length,
              success: true
            })
          } else {
            processedFiles.push({
              file: relativePath,
              answerCount: 0,
              success: false,
              error: '未找到答案数据'
            })
          }
        } catch (error) {
          processedFiles.push({
            file: path.relative(extractDir, filePath),
            answerCount: 0,
            success: false,
            error: error.message
          })
        }
      }

      // 发送处理结果
      mainWindow.webContents.send('files-processed', {
        processedFiles: processedFiles,
        totalAnswers: allAnswers.length
      })

      if (allAnswers.length > 0) {
        // 保存所有答案到文件
        const answerFile = path.join(ansDir, `answers_${Date.now()}.txt`)
        const answerText = allAnswers.map((item, index) =>
          `${index + 1}. [${item.sourceFile}] ${item.answer}: ${item.content}`
        ).join('\n\n')

        fs.writeFileSync(answerFile, answerText, 'utf-8')

        mainWindow.webContents.send('answers-extracted', {
          answers: allAnswers,
          count: allAnswers.length,
          file: answerFile,
          processedFiles: processedFiles
        })
      } else {
        // 未找到有效答案数据时，展示所有文件内容
        const allContentFile = path.join(ansDir, `all_content_${Date.now()}.txt`)
        const allContentText = allFilesContent.map(item =>
          `文件: ${item.file}\n内容:\n${item.content}\n\n${'='.repeat(50)}\n\n`
        ).join('\n')

        fs.writeFileSync(allContentFile, allContentText, 'utf-8')

        mainWindow.webContents.send('no-answers-found', {
          message: '所有文件中都未找到有效的答案数据，已显示所有文件内容',
          file: allContentFile,
          filesContent: allFilesContent,
          processedFiles: processedFiles
        })
      }
    } else {
      mainWindow.webContents.send('process-error', { error: '未找到可能包含答案的文件' })
    }

  } catch (error) {
    mainWindow.webContents.send('process-error', { error: `解压失败: ${error.message}` })
  }
}

// 扫描目录结构
function scanDirectory(dirPath, maxDepth = 3, currentDepth = 0) {
  const result = {
    name: path.basename(dirPath),
    type: 'directory',
    path: dirPath,
    children: []
  }

  if (currentDepth >= maxDepth) {
    return result
  }

  try {
    const items = fs.readdirSync(dirPath)

    for (const item of items) {
      const itemPath = path.join(dirPath, item)
      const stats = fs.statSync(itemPath)

      if (stats.isDirectory()) {
        result.children.push(scanDirectory(itemPath, maxDepth, currentDepth + 1))
      } else {
        result.children.push({
          name: item,
          type: 'file',
          path: itemPath,
          size: stats.size,
          ext: path.extname(item).toLowerCase()
        })
      }
    }
  } catch (error) {
    console.error(`扫描目录失败: ${dirPath}`, error)
  }

  return result
}

// 查找可能包含答案的文件
function findAnswerFiles(dirPath) {
  const answerFiles = []

  function searchFiles(dir) {
    try {
      const items = fs.readdirSync(dir)

      for (const item of items) {
        const itemPath = path.join(dir, item)
        const stats = fs.statSync(itemPath)

        if (stats.isDirectory()) {
          searchFiles(itemPath)
        } else {
          const ext = path.extname(item).toLowerCase()
          const name = item.toLowerCase()

          // 只处理 XML 和 JSON 文件
          if (ext === '.xml' || ext === '.json') {
            // 特别关注包含 answer、paper、question 等关键词的文件
            if (name.includes('answer') || name.includes('paper') || name.includes('question')) {
              answerFiles.push(itemPath)
            }
          }
        }
      }
    } catch (error) {
      console.error(`搜索文件失败: ${dir}`, error)
    }
  }

  searchFiles(dirPath)
  return answerFiles
}

// 从单个文件提取答案
function extractAnswersFromFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase()
    const content = fs.readFileSync(filePath, 'utf-8')

    // 根据文件类型选择不同的处理方法
    if (ext === '.json') {
      return extractFromJSON(content, filePath)
    } else if (ext === '.xml') {
      return extractFromXML(content, filePath)
    }

    return []
  } catch (error) {
    console.error(`读取文件失败: ${filePath}`, error)
    return []
  }
}

// 从JSON文件提取答案
function extractFromJSON(content, filePath) {
  const answers = []

  try {
    const jsonData = JSON.parse(content)

    // 处理句子跟读题型
    if (jsonData.Data && jsonData.Data.sentences) {
      jsonData.Data.sentences.forEach((sentence, index) => {
        if (sentence.text && sentence.text.length > 2) {
          answers.push({
            question: index + 1,
            answer: sentence.text,
            content: `请朗读: ${sentence.text}`,
            pattern: 'JSON句子跟读模式'
          })
        }
      })
    }

    // 处理答案字段
    if (jsonData.answers) {
      jsonData.answers.forEach((answerObj, index) => {
        if (answerObj.id && answerObj.answer) {
          answers.push({
            question: index + 1,
            answer: answerObj.answer,
            content: `答案: ${answerObj.answer}`,
            pattern: 'JSON答案模式'
          })
        }
      })
    }

    // 处理单词发音题型
    if (jsonData.Data && jsonData.Data.words) {
      jsonData.Data.words.forEach((word, index) => {
        if (word && word.length > 1) {
          answers.push({
            question: index + 1,
            answer: word,
            content: `请朗读单词: ${word}`,
            pattern: 'JSON单词发音模式'
          })
        }
      })
    }

    // 尝试通用JSON答案提取
    const jsonAnswerMatches = [...content.matchAll(/"answer"\s*:\s*"([^"]+)"/g)]
    jsonAnswerMatches.forEach((match, index) => {
      if (match[1]) {
        answers.push({
          question: index + 1,
          answer: match[1],
          content: `答案: ${match[1]}`,
          pattern: '通用JSON答案模式'
        })
      }
    })

    return answers
  } catch (error) {
    console.error(`解析JSON文件失败: ${filePath}`, error)
    return []
  }
}

// 从XML文件提取答案
function extractFromXML(content, filePath) {
  const answers = []

  try {
    // 处理correctAnswer.xml文件
    if (filePath.includes('correctAnswer')) {
      // 使用正则表达式提取所有<answer>标签中的内容
      const answerMatches = content.match(/<answer[^>]*>\s*<!\[CDATA\[([^\]]+)\]\]>\s*<\/answer>/g)

      if (answerMatches) {
        answerMatches.forEach((match, index) => {
          const answerText = match.replace(/<answer[^>]*>\s*<!\[CDATA\[([^\]]+)\]\]>\s*<\/answer>/, '$1')
          if (answerText && answerText.trim().length > 0) {
            answers.push({
              question: index + 1,
              answer: answerText.trim(),
              content: `答案: ${answerText.trim()}`,
              pattern: 'XML正确答案模式'
            })
          }
        })
      }
    }

    // 处理paper.xml文件
    if (filePath.includes('paper')) {
      // 提取所有<element>标签中的题目和答案
      const elementMatches = content.match(/<element[^>]*id="([^"]+)".*?<question_no>(\d+)<\/question_no>.*?<question_text>(.*?)<\/question_text>.*?<knowledge>(.*?)<\/knowledge>/gs)

      if (elementMatches) {
        elementMatches.forEach((match, index) => {
          const idMatch = match.match(/id="([^"]+)"/)
          const questionNoMatch = match.match(/<question_no>(\d+)<\/question_no>/)
          const questionTextMatch = match.match(/<question_text>(.*?)<\/question_text>/)
          const knowledgeMatch = match.match(/<knowledge>(.*?)<\/knowledge>/)

          if (idMatch && questionNoMatch && questionTextMatch && knowledgeMatch) {
            answers.push({
              question: parseInt(questionNoMatch[1]),
              answer: knowledgeMatch[1].trim(),
              content: `题目: ${questionTextMatch[1].trim()}\n答案: ${knowledgeMatch[1].trim()}`,
              pattern: 'XML题目答案模式'
            })
          }
        })
      }
    }

    // 尝试通用XML答案提取
    const xmlAnswerMatches = [...content.matchAll(/<answer[^>]*>\s*<!\[CDATA\[([^\]]+)\]\]>/g)]
    xmlAnswerMatches.forEach((match, index) => {
      if (match[1]) {
        answers.push({
          question: index + 1,
          answer: match[1].trim(),
          content: `答案: ${match[1].trim()}`,
          pattern: '通用XML答案模式'
        })
      }
    })

    return answers
  } catch (error) {
    console.error(`解析XML文件失败: ${filePath}`, error)
    return []
  }
}

// IPC事件处理
ipcMain.on('start-answer-proxy', () => {
  isCapturing = true
  startAnswerProxy()
})

ipcMain.on('stop-answer-proxy', () => {
  stopAnswerProxy()
})

ipcMain.on('start-capturing', () => {
  isCapturing = true
  mainWindow.webContents.send('capture-status', { capturing: true })
})

ipcMain.on('stop-capturing', () => {
  isCapturing = false
  mainWindow.webContents.send('capture-status', { capturing: false })
})
