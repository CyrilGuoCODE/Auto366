const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const net = require('net');
const axios = require('axios');
const StreamZip = require('node-stream-zip');
const fs = require('fs-extra');
const path = require('path');
const url = require('url');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// 全局变量
let isCapturing = false;
let downloadUrl = '';
let extractedAnswers = [];

// 确保临时目录存在
const tempDir = path.join(__dirname, 'temp');
const ansDir = path.join(__dirname, 'answers');
fs.ensureDirSync(tempDir);
fs.ensureDirSync(ansDir);

// WebSocket连接管理
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('客户端已连接');

  // 发送当前状态
  ws.send(JSON.stringify({
    type: 'status',
    data: {
      isCapturing,
      downloadUrl,
      answers: extractedAnswers
    }
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log('客户端已断开');
  });
});

// 广播消息到所有客户端
function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// 提取下载链接
function extractDownloadUrl(data) {
  try {
    // 尝试多种模式提取下载链接
    const patterns = [
      /"downloadUrl":"(.*?)"/,
      /"downloadUrl":\s*"(.*?)"/,
      /downloadUrl['"]\s*:\s*['"]([^'"]+)['"]/
    ];

    for (const pattern of patterns) {
      const match = data.match(pattern);
      if (match && match[1]) {
        downloadUrl = match[1].replace(/\\"/g, '"').replace(/\\\//g, '/');
        broadcast({
          type: 'log',
          message: `提取到下载链接: ${downloadUrl}`
        });
        broadcast({
          type: 'downloadUrl',
          url: downloadUrl
        });
        downloadAndProcess(downloadUrl);
        return;
      }
    }

    broadcast({
      type: 'log',
      message: '未能从请求数据中提取到下载链接'
    });
  } catch (error) {
    broadcast({
      type: 'error',
      message: `提取下载链接失败: ${error.message}`
    });
  }
}

// 下载和处理文件
async function downloadAndProcess(url) {
  try {
    broadcast({
      type: 'log',
      message: '开始下载文件...'
    });

    broadcast({
      type: 'status',
      data: { isProcessing: true }
    });

    // 下载文件
    const timestamp = Date.now();
    const zipPath = path.join(tempDir, `exam_${timestamp}.zip`);

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000
    });

    const writer = fs.createWriteStream(zipPath);
    response.data.pipe(writer);

    writer.on('finish', () => {
      broadcast({
        type: 'log',
        message: '文件下载完成，开始解压...'
      });
      extractZipFile(zipPath);
    });

    writer.on('error', (err) => {
      console.error('文件写入错误:', err);
      broadcast({
        type: 'error',
        message: `文件下载失败: ${err.message}`
      });
    });

  } catch (error) {
    console.error('下载失败:', error.message);
    broadcast({
      type: 'error',
      message: `下载失败: ${error.message}`
    });
  }
}

// 解压ZIP文件
async function extractZipFile(zipPath) {
  try {
    const extractDir = zipPath.replace('.zip', '');

    // 如果目录存在则删除
    if (fs.existsSync(extractDir)) {
      fs.removeSync(extractDir);
    }

    fs.ensureDirSync(extractDir);

    const zip = new StreamZip.async({ file: zipPath });
    await zip.extract(null, extractDir);
    await zip.close();

    broadcast({
      type: 'log',
      message: '文件解压完成，开始提取答案...'
    });

    // 查找 page1.js 文件
    const page1Path = path.join(extractDir, '1', 'page1.js');
    if (fs.existsSync(page1Path)) {
      extractAnswers(page1Path);
    } else {
      throw new Error('找不到 page1.js 文件');
    }

  } catch (error) {
    console.error('解压失败:', error.message);
    broadcast({
      type: 'error',
      message: `解压失败: ${error.message}`
    });
  }
}

// 提取答案 (使用原Python代码的逻辑)
function extractAnswers(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // 使用原Python代码中的正则模式
    const pattern = /"answer_text"(.*?)"knowledge"/gs;
    const matches = content.match(pattern) || [];

    const answers = [];
    let questionNum = 1;

    for (const match of matches) {
      try {
        // 提取选项 A-D
        const optionMatch = match.match(/[A-D]/);
        if (optionMatch) {
          const option = optionMatch[0];

          // 构建模式来提取对应选项的内容
          const contentPattern = new RegExp(`"id":"${option}".*?"content":"(.*?)"`, 's');
          const contentMatch = match.match(contentPattern);

          if (contentMatch) {
            answers.push({
              question: questionNum,
              answer: option,
              content: contentMatch[1].replace(/\\"/g, '"')
            });
            questionNum++;
          }
        }
      } catch (e) {
        console.log(`处理第${questionNum}题时出错:`, e.message);
      }
    }

    extractedAnswers = answers;

    // 保存答案到文件
    const answerFile = path.join(ansDir, `answers_${Date.now()}.txt`);
    const answerText = answers.map((item, index) =>
      `${index + 1}. ${item.answer}: ${item.content}`
    ).join('\n\n');

    fs.writeFileSync(answerFile, answerText, 'utf-8');

    broadcast({
      type: 'log',
      message: `答案提取完成！共提取 ${answers.length} 道题目的答案`
    });

    broadcast({
      type: 'answers',
      data: answers
    });

    broadcast({
      type: 'status',
      data: { isProcessing: false, isComplete: true }
    });

  } catch (error) {
    console.error('提取答案失败:', error.message);
    broadcast({
      type: 'error',
      message: `提取答案失败: ${error.message}`
    });
  }
}

// 处理HTTP请求的代理逻辑
server.on('request', (req, res) => {
  // 添加CORS头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // 处理OPTIONS预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 处理本地管理界面请求
  if (req.headers.host && (req.headers.host.includes('localhost') || req.headers.host.includes('127.0.0.1'))) {
    handleLocalRequest(req, res);
    return;
  }

  // 处理代理请求
  handleProxyRequest(req, res);
});

// 处理本地请求（管理界面）
function handleLocalRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);

  // API路由
  if (parsedUrl.pathname.startsWith('/api/')) {
    handleApiRequest(req, res, parsedUrl);
    return;
  }

  // 静态文件服务
  let filePath = path.join(__dirname, 'public', parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);

  // 安全检查
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error('文件读取错误:', err);
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    }[ext] || 'text/plain; charset=utf-8';

    res.writeHead(200, { 
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

// 处理API请求
function handleApiRequest(req, res, parsedUrl) {
  res.setHeader('Content-Type', 'application/json');

  if (parsedUrl.pathname === '/api/start-capture' && req.method === 'POST') {
    isCapturing = true;
    extractedAnswers = [];
    downloadUrl = '';

    broadcast({
      type: 'status',
      data: { isCapturing: true, isComplete: false }
    });

    broadcast({
      type: 'log',
      message: '开始监听网络请求...'
    });

    res.end(JSON.stringify({ success: true, message: '开始抓包' }));
  } else if (parsedUrl.pathname === '/api/stop-capture' && req.method === 'POST') {
    isCapturing = false;

    broadcast({
      type: 'status',
      data: { isCapturing: false }
    });

    broadcast({
      type: 'log',
      message: '停止监听网络请求'
    });

    res.end(JSON.stringify({ success: true, message: '停止抓包' }));
  } else if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    res.end(JSON.stringify({
      isCapturing,
      downloadUrl,
      answers: extractedAnswers
    }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}

// 处理代理请求
function handleProxyRequest(req, res) {
  const targetUrl = req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`;
  const parsedUrl = url.parse(targetUrl);

  // 记录所有请求详情
  const requestInfo = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    host: req.headers.host,
    targetUrl: targetUrl,
    userAgent: req.headers['user-agent'] || 'Unknown',
    contentType: req.headers['content-type'] || 'None',
    contentLength: req.headers['content-length'] || '0'
  };

  // 广播请求详情到前端
  broadcast({
    type: 'traffic',
    data: requestInfo
  });

  console.log(`[${requestInfo.timestamp}] ${req.method} ${targetUrl}`);

  // 构建代理请求选项
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.path,
    method: req.method,
    headers: { ...req.headers }
  };

  // 删除可能导致问题的头部
  delete options.headers.host;
  delete options.headers['proxy-connection'];

  const protocol = parsedUrl.protocol === 'https:' ? https : http;

  const proxyReq = protocol.request(options, (proxyRes) => {
    // 记录响应信息
    const responseInfo = {
      statusCode: proxyRes.statusCode,
      statusMessage: proxyRes.statusMessage,
      contentType: proxyRes.headers['content-type'] || 'Unknown',
      contentLength: proxyRes.headers['content-length'] || 'Unknown'
    };

    broadcast({
      type: 'response',
      data: {
        request: requestInfo,
        response: responseInfo
      }
    });

    // 设置响应头
    res.writeHead(proxyRes.statusCode, proxyRes.headers);

    // 检查是否需要监听响应内容
    const shouldMonitorResponse = isCapturing && (
      req.url.includes('fileinfo') ||
      req.url.includes('download') ||
      req.url.includes('.zip') ||
      req.url.includes('page1') ||
      req.url.includes('exam') ||
      req.url.includes('question') ||
      (proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('application/json'))
    );

    if (shouldMonitorResponse) {
      let body = '';
      proxyRes.on('data', (chunk) => {
        body += chunk;
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        // 记录响应内容
        broadcast({
          type: 'responseBody',
          data: {
            url: req.url,
            body: body.substring(0, 1000), // 只显示前1000字符
            fullLength: body.length
          }
        });

        try {
          // 尝试解析JSON响应
          const responseData = JSON.parse(body);
          
          // 查找下载链接的多种模式
          const downloadPatterns = [
            'downloadUrl',
            'download_url',
            'fileUrl',
            'file_url',
            'zipUrl',
            'zip_url',
            'resourceUrl',
            'resource_url'
          ];

          for (const pattern of downloadPatterns) {
            if (responseData[pattern]) {
              downloadUrl = responseData[pattern];
              broadcast({
                type: 'log',
                message: `从响应中发现下载链接 (${pattern}): ${downloadUrl}`
              });
              downloadAndProcess(downloadUrl);
              break;
            }
          }

          // 递归查找嵌套对象中的下载链接
          function findDownloadUrl(obj, path = '') {
            if (typeof obj !== 'object' || obj === null) return;
            
            for (const [key, value] of Object.entries(obj)) {
              const currentPath = path ? `${path}.${key}` : key;
              
              if (typeof value === 'string' && (
                value.includes('.zip') || 
                value.includes('download') ||
                value.includes('file')
              )) {
                broadcast({
                  type: 'log',
                  message: `发现可能的文件链接 (${currentPath}): ${value}`
                });
                
                if (value.includes('.zip')) {
                  downloadUrl = value;
                  downloadAndProcess(downloadUrl);
                  return;
                }
              }
              
              if (typeof value === 'object') {
                findDownloadUrl(value, currentPath);
              }
            }
          }

          findDownloadUrl(responseData);

        } catch (e) {
          // 如果不是JSON，检查是否包含下载链接
          if (body.includes('downloadUrl') || body.includes('.zip')) {
            broadcast({
              type: 'log',
              message: `响应内容包含潜在下载信息: ${body.substring(0, 200)}...`
            });
            extractDownloadUrl(body);
          }
        }
        res.end();
      });
    } else {
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error('代理请求错误:', err.message);
    broadcast({
      type: 'error',
      message: `代理请求错误: ${err.message} - ${targetUrl}`
    });
    
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy Error: ' + err.message);
    }
  });

  // 监听请求体内容
  const shouldMonitorRequest = isCapturing && (
    req.method === 'POST' || 
    req.method === 'PUT' ||
    req.url.includes('fileinfo') ||
    req.url.includes('download') ||
    req.url.includes('exam') ||
    req.url.includes('question')
  );

  if (shouldMonitorRequest) {
    let body = '';
    req.on('data', chunk => {
      const chunkStr = chunk.toString();
      body += chunkStr;
      proxyReq.write(chunk);
    });

    req.on('end', () => {
      // 记录请求体内容
      broadcast({
        type: 'requestBody',
        data: {
          url: req.url,
          method: req.method,
          body: body.substring(0, 1000), // 只显示前1000字符
          fullLength: body.length
        }
      });

      console.log(`[POST数据] ${req.url}: ${body.substring(0, 200)}...`);
      
      // 检查请求体中的下载链接
      if (body.includes('downloadUrl') || body.includes('.zip') || body.includes('fileinfo')) {
        broadcast({
          type: 'log',
          message: `请求体包含潜在下载信息: ${req.url}`
        });
        extractDownloadUrl(body);
      }
      
      proxyReq.end();
    });
  } else {
    req.pipe(proxyReq);
  }
}

// 处理CONNECT方法（HTTPS代理）
server.on('connect', (req, clientSocket, head) => {
  const { hostname, port } = url.parse(`http://${req.url}`);

  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error('CONNECT代理错误:', err.message);
    clientSocket.end();
  });

  clientSocket.on('error', (err) => {
    console.error('客户端Socket错误:', err.message);
    serverSocket.end();
  });
});

const PORT = process.env.PORT || 5291;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`天学网透明代理服务器启动成功！`);
  console.log(`请将天学网客户端代理设置为: 127.0.0.1:${PORT}`);
  console.log(`管理界面访问地址: http://localhost:${PORT}`);
});