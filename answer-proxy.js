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
const { v4: uuidv4 } = require('uuid')
const appPath = app.isPackaged ? process.resourcesPath : __dirname;
const tempDir = path.join(appPath, 'temp');
const ansDir = path.join(appPath, 'answers');

class AnswerProxy {
  constructor() {
    this.proxyAgent = null;
    this.extractedAnswers = [];
    this.downloadUrl = '';
    this.mainWindow = null;
    this.trafficCache = new Map();
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
          const isJson = /application\/json/.test(contentType);
          const isFile = /application\/octet-stream|image/.test(contentType);
          const contentLengthIsZero = proxyRes.headers['content-length'] == 0;
          const isCompressed = Boolean(contentEncoding) && !isFile;

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
            let uuid = uuidv4()
            requestInfo.uuid = uuid;
            
            this.safeIpcSend('traffic-log', requestInfo);
            
            this.trafficCache.set(uuid, requestInfo)
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
                } else {
                  requestInfo.responseBody = responseBody;
                }

                requestInfo.contentType = contentType;
                requestInfo.contentEncoding = contentEncoding;
                requestInfo.bodySize = responseBody.length;
                requestInfo.originalBodySize = responseBuffer.length;
                requestInfo.isCompressed = isCompressed;
                let uuid = uuidv4()
                requestInfo.uuid = uuid;
                
                this.safeIpcSend('traffic-log', requestInfo);
                
                requestInfo.originalResponse = responseBuffer;
                this.trafficCache.set(uuid, requestInfo)

                // 检查是否包含答案下载链接
                if (isFile && requestInfo.responseBody.includes('zip')){
                  fs.mkdirSync(tempDir, { recursive: true });
                  fs.mkdirSync(ansDir, { recursive: true });
                  const filePath = path.join(tempDir, requestInfo.responseBody)
                  await this.downloadFileByUuid(uuid, filePath)
                  await this.extractZipFile(filePath, ansDir)
                  fs.unlink(filePath)
                  fs.rm(filePath.replace('.zip', ''), { recursive: true, force: true })
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

  stopProxy() {
    if (this.proxyAgent) {
      this.safeIpcSend('capture-status', { capturing: false });
      this.proxyAgent.close();
      this.proxyAgent = null;
      this.safeIpcSend('proxy-status', {
        running: false,
        message: '代理服务器已停止'
      });
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

            // 处理 XML、JSON、JS 和 TXT 文件
            if (ext === '.xml' || ext === '.json' || ext === '.js' || ext === '.txt') {
              // 特别关注包含 answer、paper、question 等关键词的文件
              if (name.includes('answer') || name.includes('paper') || name.includes('question') || name.includes('questionData')) {
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
      if (ext === '.json' || ext === '.js') {
        // JS文件可能是变量赋值形式，需要尝试提取变量内容
        let jsonContent = content;
        if (ext === '.js') {
          // 尝试提取变量赋值语句
          const varMatch = content.match(/var\s+pageConfig\s*=\s*({.+?});?$/s);
          if (varMatch && varMatch[1]) {
            jsonContent = varMatch[1];
          }
        }
        return this.extractFromJSON(jsonContent, filePath);
      } else if (ext === '.xml') {
        return this.extractFromXML(content, filePath);
      } else if (ext === '.txt') {
        // 尝试从文本文件中提取答案
        return this.extractFromText(content, filePath);
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

      // 处理听后回答题型（展示答案）
      if (jsonData.Data && jsonData.Data.questions_list) {
        jsonData.Data.questions_list.forEach((question, index) => {
          if (question.answer_text && question.question_text) {
            answers.push({
              question: index + 1,
              answer: question.answer_text,
              content: `题目: ${question.question_text}\n答案: ${question.answer_text}`,
              pattern: '听后回答模式'
            });
          }
        });
      }

      // 处理听后转述题型（展示答案和原题）
      if (jsonData.Data && jsonData.Data.OriginalStandard) {
        jsonData.Data.OriginalStandard.forEach((answer, index) => {
          if (answer && answer.length > 2) {
            answers.push({
              question: index + 1,
              answer: answer,
              content: `转述参考答案: ${answer}`,
              pattern: '听后转述模式'
            });
          }
        });
      }

      // 处理听后选择题型（展示答案）
      if (jsonData.Data && jsonData.Data.questions_list) {
        jsonData.Data.questions_list.forEach((question, index) => {
          if (question.answer_text && question.options) {
            const optionsText = question.options.map(opt => `${opt.id}: ${opt.content}`).join("；");
            answers.push({
              question: index + 1,
              answer: question.answer_text,
              content: `题目: ${question.question_text}\n选项: ${optionsText}\n答案: ${question.answer_text}`,
              pattern: '听后选择模式'
            });
          }
        });
      }

      // 处理页面配置中的题目类型（如 questionData.js）
      if (jsonData.questionObj) {
        const qObj = jsonData.questionObj;
        
        // 处理听后回答题目
        if (qObj.question_type === 12 && qObj.answer_text) {
          answers.push({
            question: "听后回答",
            answer: qObj.answer_text,
            content: `题目: ${qObj.question_text}\n答案: ${qObj.answer_text}`,
            pattern: '听后回答模式'
          });
        }
        
        // 处理听后选择题目
        if (qObj.question_type === 1 && qObj.questions_list) {
          qObj.questions_list.forEach((q, index) => {
            if (q.answer_text && q.options) {
              const optionsText = q.options.map(opt => `${opt.id}: ${opt.content}`).join("；");
              answers.push({
                question: `听后选择-${index + 1}`,
                answer: q.answer_text,
                content: `题目: ${q.question_text}\n选项: ${optionsText}\n答案: ${q.answer_text}`,
                pattern: '听后选择模式'
              });
            }
          });
        }
        
        // 处理朗读句子题目
        if (qObj.record_speak && qObj.record_speak.length > 0) {
          qObj.record_speak.forEach((item, index) => {
            if (item.content && item.content.length > 2) {
              answers.push({
                question: `朗读句子-${index + 1}`,
                answer: item.content,
                content: `请朗读: ${item.content}`,
                pattern: '朗读句子模式'
              });
            }
          });
        }
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

  // 从文本文件提取答案
  extractFromText(content, filePath) {
    const answers = [];
    
    try {
      // 尝试匹配常见的答案格式
      const answerPatterns = [
        /答案\s*[:：]\s*([^\n]+)/g,  // 答案: xxx
        /标准答案\s*[:：]\s*([^\n]+)/g, // 标准答案: xxx
        /正确答案\s*[:：]\s*([^\n]+)/g, // 正确答案: xxx
        /参考答案\s*[:：]\s*([^\n]+)/g, // 参考答案: xxx
        /\b[A-D]\b/g  // 单独的选项字母
      ];
      
      // 按行处理文本
      const lines = content.split('\n');
      let lineNum = 0;
      
      for (const line of lines) {
        lineNum++;
        
        // 尝试每个答案模式
        for (const pattern of answerPatterns) {
          const matches = [...line.matchAll(pattern)];
          
          if (matches.length > 0) {
            matches.forEach((match, index) => {
              if (match[1]) {
                answers.push({
                  question: `文本-${lineNum}-${index + 1}`,
                  answer: match[1].trim(),
                  content: `答案: ${match[1].trim()} (行: ${lineNum})`,
                  pattern: '文本答案模式'
                });
              }
            });
          }
        }
        
        // 处理单独的选项字母
        const optionMatches = [...line.matchAll(/\b([A-D])\b/g)];
        if (optionMatches.length > 0) {
          answers.push({
            question: `选项-${lineNum}`,
            answer: optionMatches.map(m => m[1]).join(''),
            content: `选项: ${optionMatches.map(m => m[1]).join('')} (行: ${lineNum})`,
            pattern: '文本选项模式'
          });
        }
      }
      
      return answers;
    } catch (error) {
      console.error(`解析文本文件失败: ${filePath}`, error);
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
  async downloadFileByUuid(uuid, filePath) {
    const fileInfo = this.trafficCache.get(uuid);
    if (!fileInfo) {
      throw new Error('数据不存在');
    }
    
    let content = fileInfo.responseBody
    if (fileInfo.contentType && (fileInfo.contentType.includes('image') || fileInfo.contentType.includes('octet-stream'))) content = fileInfo.originalResponse

    // 使用 fs.promises.writeFile 的异步版本
    await fs.promises.writeFile(filePath, fileInfo.originalResponse);
  }
  clearCache(){
    this.trafficCache.clear()
	fs.rm(tempDir, { recursive: true, force: true });
  }
  getTrafficByUuid(uuid){
    return this.trafficCache.get(uuid)
  }
}

module.exports = AnswerProxy;