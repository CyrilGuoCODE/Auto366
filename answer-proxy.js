const { ipcMain } = require('electron')
const http = require('http')
const https = require('https')
const net = require('net')
const url = require('url')
const fs = require('fs-extra')
const axios = require('axios')
const StreamZip = require('node-stream-zip')
const mitmproxy = require('node-mitmproxy')
const zlib = require('zlib')
const { pipeline } = require('stream')
const { Transform } = require('stream')
const path = require('path')
const { app } = require('electron')

class AnswerProxy {
  constructor() {
    this.proxyAgent = null;
    this.isCapturing = false;
    this.extractedAnswers = [];
    this.downloadUrl = '';
    this.mainWindow = null;
  }

  // 设置主窗口引用
  setMainWindow(window) {
    this.mainWindow = window;
  }

  // 安全的IPC发送函数
  safeIpcSend(channel, data) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data);
      }
    } catch (error) {
      console.error(`发送IPC消息失败 [${channel}]:`, error);
    }
  }

  // 响应体解压缩工具函数
  decompressResponse(buffer, encoding) {
    return new Promise((resolve, reject) => {
      try {
        if (!encoding || encoding === 'identity') {
          console.log('无压缩');
          // 无压缩
          resolve(buffer.toString());
          return;
        }

        if (encoding.includes('gzip')) {
          zlib.gunzip(buffer, (err, result) => {
            if (err) {
              console.error('Gzip解压失败:', err);
              // 解压失败时返回原始内容
              resolve(buffer.toString());
            } else {
              console.log('Gzip解压成功');
              resolve(result.toString());
            }
          });
        } else if (encoding.includes('deflate')) {
          zlib.inflate(buffer, (err, result) => {
            if (err) {
              console.error('Deflate解压失败:', err);
              resolve(buffer.toString());
            } else {
              console.log('Deflate解压成功');
              resolve(result.toString());
            }
          });
        } else if (encoding.includes('br')) {
          // Brotli压缩
          zlib.brotliDecompress(buffer, (err, result) => {
            if (err) {
              console.error('Brotli解压失败:', err);
              resolve(buffer.toString());
            } else {
              console.log('Brotli解压成功');
              resolve(result.toString());
            }
          });
        } else {
          // 未知压缩格式，直接返回
		  console.log('未知压缩格式:', encoding)
          resolve(buffer.toString());
        }
      } catch (error) {
        console.error('解压缩过程中出错:', error);
        resolve(buffer.toString());
      }
    });
  }

  // 启动抓包代理
  startProxy(mainWindow) {
    this.mainWindow = mainWindow;
    this.isCapturing = true;

    if (this.proxyAgent) {
      this.stopProxy();
    }

    // 创建MITM代理实例
    this.proxyAgent = mitmproxy.createProxy({
      port: 5291,
      ssl: {
        rejectUnauthorized: false
      },
      sslConnectInterceptor: (req, cltSocket, head) => {
        try {
          // 只拦截浏览器的https请求
          if (req.headers && req.headers['user-agent'] && /^Mozilla/.test(req.headers['user-agent'])) {
            return true;
          } else {
            return false;
          }
        } catch (error) {
          console.error('SSL连接拦截器错误:', error);
          return false;
        }
      },
      responseInterceptor: (req, res, proxyReq, proxyRes, ssl, next) => {
        try {
          // 构建请求信息
          const protocol = ssl ? "https" : "http";
          let urlPath = req.url;
          let fullUrl;
          if (urlPath.startsWith(protocol + "://")) {
            fullUrl = urlPath;
          } else {
            fullUrl = protocol + "://" + (req.headers.host || "") + urlPath;
          }

          const requestInfo = {
            method: req.method,
            url: fullUrl,
            host: req.headers.host,
            timestamp: new Date().toISOString(),
            isHttps: ssl,
            requestHeaders: req.headers
          };

          // 检查内容类型和编码
          const contentType = proxyRes.headers['content-type'] || '';
          const contentEncoding = proxyRes.headers['content-encoding'] || '';
          const isHtml = /text\/html|application\/xhtml\+xml/.test(contentType);
          const isJson = /application\/json/.test(contentType);
          const isFile = /application\/octet-stream/.test(contentType);
          const contentLengthIsZero = proxyRes.headers['content-length'] == 0;
          const isCompressed = Boolean(contentEncoding);

          console.log(`请求: ${fullUrl}, 内容类型: ${contentType}, 是否压缩: ${isCompressed}`);

          if (contentLengthIsZero) {
            // 非HTML内容或空内容，直接转发
            Object.keys(proxyRes.headers).forEach(function (key) {
              if (proxyRes.headers[key] != undefined) {
                res.setHeader(key, proxyRes.headers[key]);
              }
            });
            res.writeHead(proxyRes.statusCode);
            proxyRes.pipe(res);

            // 发送请求信息
            requestInfo.statusCode = proxyRes.statusCode;
            requestInfo.statusMessage = proxyRes.statusMessage;
            requestInfo.responseHeaders = proxyRes.headers;
            requestInfo.contentType = contentType;
            this.safeIpcSend('traffic-log', requestInfo);
          } else {
            // 捕获响应体并处理压缩
            Object.keys(proxyRes.headers).forEach(function (key) {
              if (proxyRes.headers[key] != undefined) {
                if (key === 'content-length') {
                  // 不设置content-length，因为我们可能会修改内容
                } else {
                  res.setHeader(key, proxyRes.headers[key]);
                }
              }
            });
            res.writeHead(proxyRes.statusCode);

            // 收集响应数据
            const chunks = [];
            let totalLength = 0;

            proxyRes.on('data', (chunk) => {
              chunks.push(chunk);
              totalLength += chunk.length;
              res.write(chunk);
            });

            proxyRes.on('end', async () => {
              try {
                // 合并所有chunks
                const responseBuffer = Buffer.concat(chunks, totalLength);

                // 解压缩响应体
                let responseBody = '';
                if (isCompressed) {
                  console.log(`开始解压缩响应 (${contentEncoding})`);
                  responseBody = await this.decompressResponse(responseBuffer, contentEncoding);
                } else {
                  responseBody = responseBuffer.toString();
                }

                // 发送完整的请求响应信息
                requestInfo.statusCode = proxyRes.statusCode;
                requestInfo.statusMessage = proxyRes.statusMessage;
                requestInfo.responseHeaders = proxyRes.headers;

                // 根据内容类型格式化响应体
                if (isJson && responseBody) {
                  try {
                    requestInfo.responseBody = JSON.stringify(JSON.parse(responseBody), null, 2);
                  } catch (e) {
                    requestInfo.responseBody = responseBody;
                  }
                } else if (isFile) {
				  if (proxyRes.headers["Content-Disposition"]){
					requestInfo.responseBody = proxyRes.headers["Content-Disposition"].replaceAll('filename=', '').replaceAll('"', '')
				  } else {
					requestInfo.responseBody = decodeURIComponent(fullUrl.match(/https?:\/\/[^\/]+\/(?:[^\/]+\/)*([^\/?]+)(?=\?|$)/)[1])
				  }
				} else if (isHtml){
				  requestInfo.responseBody = responseBody.replaceAll('<', '&lt;').replaceAll('>', '&gt')
				} else {
                  requestInfo.responseBody = responseBody;
                }

                requestInfo.contentType = contentType;
                requestInfo.contentEncoding = contentEncoding;
                requestInfo.bodySize = responseBody.length;
                requestInfo.originalBodySize = responseBuffer.length;
                requestInfo.isCompressed = isCompressed;

                this.safeIpcSend('traffic-log', requestInfo);

                // 检查是否包含答案下载链接
                if (this.isCapturing && responseBody) {
                  if (responseBody.includes('downloadUrl') || responseBody.includes('download')) {
                    this.extractDownloadUrl(responseBody);
                  }
                }

                res.end();
              } catch (error) {
                console.error('处理响应数据时出错:', error);
                res.end();
              }
            });

            proxyRes.on('error', (error) => {
              console.error('响应流错误:', error);
              res.end();
            });
          }

        } catch (error) {
          console.error('响应拦截器错误:', error);
          proxyRes.pipe(res);
        }

        next();
      }
    });

    console.log('万能答案获取代理服务器已启动: 127.0.0.1:5291');
    this.safeIpcSend('proxy-status', {
      running: true,
      message: '代理服务器已启动，请设置天学网客户端代理为 127.0.0.1:5291'
    });
  }

  // 停止抓包代理
  stopProxy() {
    if (this.proxyAgent) {
      try {
        // 尝试多种方式关闭代理
        if (typeof this.proxyAgent.close === 'function') {
          this.proxyAgent.close();
        } else if (typeof this.proxyAgent.destroy === 'function') {
          this.proxyAgent.destroy();
        } else if (typeof this.proxyAgent.abort === 'function') {
          this.proxyAgent.abort();
        }

        // 清理所有相关资源
        this.proxyAgent.removeAllListeners && this.proxyAgent.removeAllListeners();
        this.proxyAgent = null;
        this.isCapturing = false;
        this.downloadUrl = '';
        console.log('万能答案获取代理服务器已停止');
        this.safeIpcSend('proxy-status', { running: false, message: '代理服务器已停止' });
      } catch (error) {
        console.error('停止代理时出错:', error);
        this.safeIpcSend('proxy-error', {
          message: `停止代理时出错: ${error.message}`,
          timestamp: new Date().toISOString()
        });
        // 即使出错，也尝试重置状态
        this.proxyAgent = null;
        this.isCapturing = false;
      }
    }
  }

  // 设置捕获状态
  setCapturing(capturing) {
    this.isCapturing = capturing;
  }

  // 处理请求体
  processRequestBody(body, hostname, path) {
    if (body.includes('downloadUrl') || body.includes('download') || body.includes('fileinfo')) {
      try {
        this.safeIpcSend('important-request', {
          url: `https://${hostname}${path}`,
          body: body.substring(0, 500),
          isHttps: true
        });
      } catch (sendError) {
        console.error('发送重要请求信息失败:', sendError);
      }

      if (body.includes('fs.') && body.includes('/download/')) {
        console.log('HTTPS请求体包含答案下载信息');
        this.extractDownloadUrl(body);
      }
    }
  }

  // 提取下载链接
  extractDownloadUrl(data) {
    try {
      const patterns = [
        /"downloadUrl":"(.*?)"/,
        /"downloadUrl":\s*"(.*?)"/,
        /downloadUrl['"]\s*:\s*['"]([^'"]+)['"]/
      ];

      for (const pattern of patterns) {
        const match = data.match(pattern);
        if (match && match[1]) {
          const url = match[1].replace(/\"/g, '"').replace(/\\/ / g, '/');

          // 只处理 fs.域名/download/ 格式的链接
          if (url.includes('fs.') && url.includes('/download/')) {
            this.downloadUrl = url;
            console.log('发现答案下载链接:', url);
            this.safeIpcSend('download-found', { url: this.downloadUrl });
            this.downloadAndProcessFile(this.downloadUrl);
            return;
          } else {
            console.log('跳过非答案下载链接:', url);
            this.safeIpcSend('traffic-log', {
              method: 'INFO',
              url: `跳过链接: ${url} (不符合 fs.域名/download/ 格式)`,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    } catch (error) {
      console.error('提取下载链接失败:', error);
    }
  }

  // 下载并处理文件
  async downloadAndProcessFile(url) {
    try {
      this.safeIpcSend('process-status', { status: 'downloading', message: '正在下载文件...' });

      // 使用更可靠的路径处理方式
      const appPath = app.isPackaged ? process.resourcesPath : __dirname;
      const tempDir = path.join(appPath, 'temp');
      const ansDir = path.join(appPath, 'answers');

      let finalTempDir = tempDir;
      let finalAnsDir = ansDir;

      try {
        fs.ensureDirSync(tempDir);
        fs.ensureDirSync(ansDir);
      } catch (dirError) {
        console.error('创建目录失败，尝试使用用户目录:', dirError);
        const userDataPath = app.getPath('userData');
        const tempDirAlt = path.join(userDataPath, 'temp');
        const ansDirAlt = path.join(userDataPath, 'answers');
        fs.ensureDirSync(tempDirAlt);
        fs.ensureDirSync(ansDirAlt);
        finalTempDir = tempDirAlt;
        finalAnsDir = ansDirAlt;
      }

      const timestamp = Date.now();
      const zipPath = path.join(finalTempDir, `exam_${timestamp}.zip`);

      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 30000
      });

      const writer = fs.createWriteStream(zipPath);
      response.data.pipe(writer);

      writer.on('finish', () => {
        this.safeIpcSend('process-status', { status: 'extracting', message: '正在解压文件...' });
        this.extractZipFile(zipPath, finalAnsDir);
      });

      writer.on('error', (err) => {
        this.safeIpcSend('process-error', { error: `文件下载失败: ${err.message}` });
      });

    } catch (error) {
      this.safeIpcSend('process-error', { error: `下载失败: ${error.message}` });
    }
  }

  // 解压ZIP文件
  async extractZipFile(zipPath, ansDir) {
    try {
      const extractDir = zipPath.replace('.zip', '');

      if (fs.existsSync(extractDir)) {
        fs.removeSync(extractDir);
      }

      fs.ensureDirSync(extractDir);

      const zip = new StreamZip.async({ file: zipPath });
      await zip.extract(null, extractDir);
      await zip.close();

      this.safeIpcSend('process-status', { status: 'processing', message: '正在分析文件结构...' });

      // 扫描所有解压的文件
      const fileStructure = this.scanDirectory(extractDir);

      // 发送文件结构到前端
      this.safeIpcSend('file-structure', {
        structure: fileStructure,
        extractDir: extractDir
      });

      // 查找并处理所有可能的答案文件
      const answerFiles = this.findAnswerFiles(extractDir);

      if (answerFiles.length > 0) {
        this.safeIpcSend('process-status', { status: 'processing', message: `找到 ${answerFiles.length} 个可能的答案文件，正在提取...` });

        let allAnswers = [];
        let processedFiles = [];
        let allFilesContent = []; // 存储所有文件内容

        for (const filePath of answerFiles) {
          try {
            // 读取文件内容
            const content = fs.readFileSync(filePath, 'utf-8');
            const relativePath = path.relative(extractDir, filePath);

            // 存储文件内容
            allFilesContent.push({
              file: relativePath,
              content: content
            });

            const answers = this.extractAnswersFromFile(filePath);
            if (answers.length > 0) {
              allAnswers = allAnswers.concat(answers.map(ans => ({
                ...ans,
                sourceFile: relativePath
              })));
              processedFiles.push({
                file: relativePath,
                answerCount: answers.length,
                success: true
              });
            } else {
              processedFiles.push({
                file: relativePath,
                answerCount: 0,
                success: false,
                error: '未找到答案数据'
              });
            }
          } catch (error) {
            processedFiles.push({
              file: path.relative(extractDir, filePath),
              answerCount: 0,
              success: false,
              error: error.message
            });
          }
        }

        // 发送处理结果
        this.safeIpcSend('files-processed', {
          processedFiles: processedFiles,
          totalAnswers: allAnswers.length
        });

        if (allAnswers.length > 0) {
          // 保存所有答案到文件
          const answerFile = path.join(ansDir, `answers_${Date.now()}.txt`);
          const answerText = allAnswers.map((item, index) =>
            `${index + 1}. [${item.sourceFile}] ${item.answer}: ${item.content}`
          ).join('\n\n');

          fs.writeFileSync(answerFile, answerText, 'utf-8');

          this.safeIpcSend('answers-extracted', {
            answers: allAnswers,
            count: allAnswers.length,
            file: answerFile,
            processedFiles: processedFiles
          });
        } else {
          // 未找到有效答案数据时，展示所有文件内容
          const allContentFile = path.join(ansDir, `all_content_${Date.now()}.txt`);
          const allContentText = allFilesContent.map(item =>
            `文件: ${item.file}\n内容:\n${item.content}\n\n${'='.repeat(50)}\n\n`
          ).join('\n');

          fs.writeFileSync(allContentFile, allContentText, 'utf-8');

          this.safeIpcSend('no-answers-found', {
            message: '所有文件中都未找到有效的答案数据，已显示所有文件内容',
            file: allContentFile,
            filesContent: allFilesContent,
            processedFiles: processedFiles
          });
        }
      } else {
        this.safeIpcSend('process-error', { error: '未找到可能包含答案的文件' });
      }

    } catch (error) {
      this.safeIpcSend('process-error', { error: `解压失败: ${error.message}` });
    }
  }

  // 扫描目录结构
  scanDirectory(dirPath, maxDepth = 3, currentDepth = 0) {
    const result = {
      name: path.basename(dirPath),
      type: 'directory',
      path: dirPath,
      children: []
    };

    if (currentDepth >= maxDepth) {
      return result;
    }

    try {
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          result.children.push(this.scanDirectory(itemPath, maxDepth, currentDepth + 1));
        } else {
          result.children.push({
            name: item,
            type: 'file',
            path: itemPath,
            size: stats.size,
            ext: path.extname(item).toLowerCase()
          });
        }
      }
    } catch (error) {
      console.error(`扫描目录失败: ${dirPath}`, error);
    }

    return result;
  }

  // 查找可能包含答案的文件
  findAnswerFiles(dirPath) {
    const answerFiles = [];

    function searchFiles(dir) {
      try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stats = fs.statSync(itemPath);

          if (stats.isDirectory()) {
            searchFiles(itemPath);
          } else {
            const ext = path.extname(item).toLowerCase();
            const name = item.toLowerCase();

            // 只处理 XML 和 JSON 文件
            if (ext === '.xml' || ext === '.json') {
              // 特别关注包含 answer、paper、question 等关键词的文件
              if (name.includes('answer') || name.includes('paper') || name.includes('question')) {
                answerFiles.push(itemPath);
              }
            }
          }
        }
      } catch (error) {
        console.error(`搜索文件失败: ${dir}`, error);
      }
    }

    searchFiles(dirPath);
    return answerFiles;
  }

  // 从单个文件提取答案
  extractAnswersFromFile(filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const content = fs.readFileSync(filePath, 'utf-8');

      // 根据文件类型选择不同的处理方法
      if (ext === '.json') {
        return this.extractFromJSON(content, filePath);
      } else if (ext === '.xml') {
        return this.extractFromXML(content, filePath);
      }

      return [];
    } catch (error) {
      console.error(`读取文件失败: ${filePath}`, error);
      return [];
    }
  }

  // 从JSON文件提取答案
  extractFromJSON(content, filePath) {
    const answers = [];

    try {
      const jsonData = JSON.parse(content);

      // 处理句子跟读题型
      if (jsonData.Data && jsonData.Data.sentences) {
        jsonData.Data.sentences.forEach((sentence, index) => {
          if (sentence.text && sentence.text.length > 2) {
            answers.push({
              question: index + 1,
              answer: sentence.text,
              content: `请朗读: ${sentence.text}`,
              pattern: 'JSON句子跟读模式'
            });
          }
        });
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
            });
          }
        });
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
            });
          }
        });
      }

      // 尝试通用JSON答案提取
      const jsonAnswerMatches = [...content.matchAll(/"answer"\s*:\s*"([^"]+)"/g)];
      jsonAnswerMatches.forEach((match, index) => {
        if (match[1]) {
          answers.push({
            question: index + 1,
            answer: match[1],
            content: `答案: ${match[1]}`,
            pattern: '通用JSON答案模式'
          });
        }
      });

      return answers;
    } catch (error) {
      console.error(`解析JSON文件失败: ${filePath}`, error);
      return [];
    }
  }

  // 从XML文件提取答案
  extractFromXML(content, filePath) {
    const answers = [];

    try {
      // 处理correctAnswer.xml文件
      if (filePath.includes('correctAnswer')) {
        // 使用正则表达式提取所有<answer>标签中的内容
        const answerMatches = content.match(/<answer[^>]*>\s*<!\[CDATA\[([^\]]+)\]\]>\s*<\/answer>/g);

        if (answerMatches) {
          answerMatches.forEach((match, index) => {
            const answerText = match.replace(/<answer[^>]*>\s*<!\[CDATA\[([^\]]+)\]\]>\s*<\/answer>/, '$1');
            if (answerText && answerText.trim().length > 0) {
              answers.push({
                question: index + 1,
                answer: answerText.trim(),
                content: `答案: ${answerText.trim()}`,
                pattern: 'XML正确答案模式'
              });
            }
          });
        }
      }

      // 处理paper.xml文件
      if (filePath.includes('paper')) {
        // 提取所有<element>标签中的题目和答案
        const elementMatches = content.match(/<element[^>]*id="([^"]+)".*?<question_no>(\d+)<\/question_no>.*?<question_text>(.*?)<\/question_text>.*?<knowledge>(.*?)<\/knowledge>/gs);

        if (elementMatches) {
          elementMatches.forEach((match, index) => {
            const idMatch = match.match(/id="([^"]+)"/);
            const questionNoMatch = match.match(/<question_no>(\d+)<\/question_no>/);
            const questionTextMatch = match.match(/<question_text>(.*?)<\/question_text>/);
            const knowledgeMatch = match.match(/<knowledge>(.*?)<\/knowledge>/);

            if (idMatch && questionNoMatch && questionTextMatch && knowledgeMatch) {
              answers.push({
                question: parseInt(questionNoMatch[1]),
                answer: knowledgeMatch[1].trim(),
                content: `题目: ${questionTextMatch[1].trim()}\n答案: ${knowledgeMatch[1].trim()}`,
                pattern: 'XML题目答案模式'
              });
            }
          });
        }
      }

      // 尝试通用XML答案提取
      const xmlAnswerMatches = [...content.matchAll(/<answer[^>]*>\s*<!\[CDATA\[([^\]]+)\]\]>/g)];
      xmlAnswerMatches.forEach((match, index) => {
        if (match[1]) {
          answers.push({
            question: index + 1,
            answer: match[1].trim(),
            content: `答案: ${match[1].trim()}`,
            pattern: '通用XML答案模式'
          });
        }
      });

      return answers;
    } catch (error) {
      console.error(`解析XML文件失败: ${filePath}`, error);
      return [];
    }
  }
}

module.exports = AnswerProxy;