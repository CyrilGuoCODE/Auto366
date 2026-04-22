const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const crypto = require('crypto');
const StreamZip = require('node-stream-zip');

class AnswerExtractor {
  constructor(logCallback = null) {
    this.cacheDir = path.join(os.homedir(), '.Auto366', 'cache');
    this.extractDir = path.join(this.cacheDir, 'extracted');
    this.appPath = process.cwd();
    this.tempDir = path.join(this.appPath, 'temp');
    this.ansDir = path.join(this.appPath, 'answers');
    this.fileDir = path.join(this.appPath, 'file');
    this.logCallback = logCallback;
  }

  emitLog(type, message, details = null) {
    if (this.logCallback) {
      this.logCallback({ type, message, details });
    }
  }

  ensureDirectories() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    if (!fs.existsSync(this.extractDir)) {
      fs.mkdirSync(this.extractDir, { recursive: true });
    }
  }

  async extractZip(zipPath) {
    try {
      this.ensureDirectories();
      const extractPath = path.join(this.extractDir, crypto.randomUUID());
      fs.mkdirSync(extractPath, { recursive: true });
      const platform = os.platform();
      if (platform === 'win32') {
        execSync(`Expand-Archive -Path "${zipPath}" -DestinationPath "${extractPath}"`, {
          shell: 'powershell.exe'
        });
      } else {
        execSync(`unzip -o "${zipPath}" -d "${extractPath}"`);
      }
      return extractPath;
    } catch (error) {
      console.error('解压ZIP文件失败:', error);
      throw new Error('解压ZIP文件失败');
    }
  }

  async extractAnswers(extractPath) {
    try {
      const answers = [];
      const processedFiles = [];
      await this.scanDirectory(extractPath, answers, processedFiles);
      return {
        answers,
        processedFiles,
        totalAnswers: answers.length
      };
    } catch (error) {
      console.error('提取答案失败:', error);
      throw new Error('提取答案失败');
    }
  }

  async scanDirectory(dir, answers, processedFiles) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        await this.scanDirectory(filePath, answers, processedFiles);
      } else if (stat.isFile() && (file.endsWith('.json') || file.endsWith('.txt'))) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          await this.processFile(file, content, answers, processedFiles);
        } catch (error) {
          console.error(`处理文件 ${file} 失败:`, error);
        }
      }
    }
  }

  async processFile(file, content, answers, processedFiles) {
    try {
      let fileAnswers = [];
      if (file.endsWith('.json')) {
        const data = JSON.parse(content);
        fileAnswers = this.extractFromJson(data, file);
      } else if (file.endsWith('.txt')) {
        fileAnswers = this.extractFromTxt(content, file);
      }
      if (fileAnswers.length > 0) {
        answers.push(...fileAnswers);
        processedFiles.push({
          file,
          answerCount: fileAnswers.length
        });
      }
    } catch (error) {
      console.error(`处理文件 ${file} 失败:`, error);
    }
  }

  extractFromJson(data, file) {
    const answers = [];
    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        if (item.question && item.answer) {
          answers.push({
            question: item.question,
            answer: item.answer,
            pattern: item.pattern || '未知题型',
            file
          });
        }
      });
    } else if (data.answers) {
      if (Array.isArray(data.answers)) {
        data.answers.forEach((item, index) => {
          if (item.question && item.answer) {
            answers.push({
              question: item.question,
              answer: item.answer,
              pattern: item.pattern || '未知题型',
              file
            });
          }
        });
      }
    } else if (data.content) {
      if (data.question && data.answer) {
        answers.push({
          question: data.question,
          answer: data.answer,
          pattern: data.pattern || '未知题型',
          file
        });
      }
    }
    return answers;
  }

  extractFromTxt(content, file) {
    const answers = [];
    const lines = content.split('\n');
    let currentQuestion = '';
    let currentAnswer = '';
    let inQuestion = false;
    let inAnswer = false;
    lines.forEach(line => {
      line = line.trim();
      if (line.startsWith('题目:')) {
        if (currentQuestion && currentAnswer) {
          answers.push({
            question: currentQuestion,
            answer: currentAnswer,
            pattern: '未知题型',
            file
          });
        }
        currentQuestion = line.substring(3).trim();
        currentAnswer = '';
        inQuestion = true;
        inAnswer = false;
      } else if (line.startsWith('答案:')) {
        currentAnswer = line.substring(3).trim();
        inQuestion = false;
        inAnswer = true;
      } else if (inAnswer) {
        currentAnswer += ' ' + line;
      }
    });
    if (currentQuestion && currentAnswer) {
      answers.push({
        question: currentQuestion,
        answer: currentAnswer,
        pattern: '未知题型',
        file
      });
    }
    return answers;
  }

  async processZipAnswer(zipPath, ansDir) {
    let extractDir = zipPath.replace('.zip', '');

    if (fs.existsSync(extractDir)) {
      fs.removeSync(extractDir);
    }
    fs.ensureDirSync(extractDir);

    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();
    if (Object.keys(entries).length === 0) {
      await zip.close();
      throw new Error('ZIP文件为空或损坏');
    }
    await zip.extract(null, extractDir);
    await zip.close();

    const extCount = this.scanFileExtensions(extractDir);

    const extractResult = await this.extractFromDirectory(extractDir);

    const answerFile = extractResult.success && extractResult.answers.length > 0
      ? path.join(ansDir, `answers_${Date.now()}.json`)
      : null;

    if (answerFile) {
      const answerText = JSON.stringify({
        answers: extractResult.answers,
        count: extractResult.count,
        file: answerFile,
        processedFiles: extractResult.processedFiles,
        fileStructure: extCount
      }, null, 2);
      fs.writeFileSync(answerFile, answerText, 'utf-8');
    } else if (extractResult.success && extractResult.answers.length === 0) {
      const allContentFile = path.join(ansDir, `all_content_${Date.now()}.txt`);
      const allContentText = extractResult.allFilesContent.map(item =>
        `文件: ${item.file}\n内容:\n${item.content}\n\n${'='.repeat(50)}\n\n`
      ).join('\n');
      fs.writeFileSync(allContentFile, allContentText, 'utf-8');
    }

    return {
      extractDir: extractDir,
      fileStructure: extCount,
      answers: extractResult.answers,
      count: extractResult.count,
      processedFiles: extractResult.processedFiles,
      allFilesContent: extractResult.allFilesContent,
      success: extractResult.success,
      message: extractResult.message,
      answerFile: answerFile
    };
  }

  scanFileExtensions(dir) {
    const extCount = {};
    const traverse = (currentDir) => {
      try {
        const entries = fs.readdirSync(currentDir);
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry);
          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) {
            traverse(fullPath);
          } else {
            const ext = path.extname(entry).toLowerCase() || '(无后缀)';
            extCount[ext] = (extCount[ext] || 0) + 1;
          }
        }
      } catch (error) {
        console.error('扫描目录失败:', error);
      }
    };
    traverse(dir);
    return extCount;
  }

  async extractFromDirectory(extractDir) {
    const allAnswers = [];
    const processedFiles = [];
    const allFilesContent = [];

    const answerFiles = this.findAnswerFiles(extractDir);

    if (answerFiles.length === 0) {
      this.emitLog('warning', '未找到可能包含答案的文件');
      return { success: false, message: '未找到可能包含答案的文件', processedFiles: [], allAnswers: [], allFilesContent: [] };
    }

    this.emitLog('info', `找到 ${answerFiles.length} 个答案文件`);

    for (const filePath of answerFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const relativePath = path.relative(extractDir, filePath);

        allFilesContent.push({
          file: relativePath,
          content: content
        });

        const answers = this.extractAnswersFromFile(filePath);
        const fileName = path.basename(relativePath);
        if (answers.length > 0) {
          allAnswers.push(...answers.map(ans => ({
            ...ans,
            sourceFile: fileName
          })));
          processedFiles.push({
            file: relativePath,
            answerCount: answers.length,
            success: true
          });
          this.emitLog('success', `${fileName}: 提取 ${answers.length} 个答案`);
        } else {
          processedFiles.push({
            file: relativePath,
            answerCount: 0,
            success: false,
            error: '未找到答案数据'
          });
          this.emitLog('info', `${fileName}: 未找到答案`);
        }
      } catch (error) {
        processedFiles.push({
          file: path.relative(extractDir, filePath),
          answerCount: 0,
          success: false,
          error: error.message
        });
        this.emitLog('error', `${path.basename(filePath)}: 提取失败 - ${error.message}`);
      }
    }

    const mergedAnswers = allAnswers.length > 0 ? this.mergeAnswerData(allAnswers) : [];
    this.emitLog('success', `答案提取完成: 共找到 ${mergedAnswers.length} 个答案`);

    return {
      success: true,
      answers: mergedAnswers,
      count: mergedAnswers.length,
      processedFiles: processedFiles,
      allFilesContent: allFilesContent
    };
  }

  findAnswerFiles(dir) {
    const answerFiles = [];
    const traverse = (currentDir) => {
      try {
        const entries = fs.readdirSync(currentDir);
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            traverse(fullPath);
          } else if (stat.isFile()) {
            const ext = path.extname(entry).toLowerCase();
            const name = entry.toLowerCase();
            if (['.json', '.js', '.xml', '.txt'].includes(ext)) {
              if (name.includes('answer') || name.includes('paper') || name.includes('question') || name.includes('questiondata')) {
                answerFiles.push(fullPath);
              }
            }
          }
        }
      } catch (error) {
        console.error('查找答案文件失败:', error);
      }
    };
    traverse(dir);
    return answerFiles;
  }

  saveAnswers(answers) {
    try {
      this.ensureDirectories();
      const answerFile = path.join(this.cacheDir, `answers_${Date.now()}.json`);
      const answerData = {
        timestamp: new Date().toISOString(),
        totalAnswers: answers.length,
        answers
      };
      fs.writeFileSync(answerFile, JSON.stringify(answerData, null, 2));
      return answerFile;
    } catch (error) {
      console.error('保存答案失败:', error);
      throw new Error('保存答案失败');
    }
  }

  cleanup() {
    try {
      if (fs.existsSync(this.extractDir)) {
        this.deleteDirectory(this.extractDir);
      }
    } catch (error) {
      console.error('清理临时文件失败:', error);
    }
  }

  deleteDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        this.deleteDirectory(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    }
    fs.rmdirSync(dir);
  }

  isJsonString(str) {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  isXmlString(str) {
    return str.trim().startsWith('<') && str.includes('</') && !str.trim().startsWith('{') && !str.trim().startsWith('[');
  }

  isJsString(str) {
    const hasJSKeywords = ['function', 'const', 'let', 'var', 'import', 'export', 'class', '=>', 'new ', 'return ', 'if ', 'else ', 'for ', 'while '];
    return str.includes('(') && str.includes(')') && str.includes('{') && str.includes('}') && hasJSKeywords.some(keyword => str.includes(keyword));
  }

  extractFromObjectJson(obj, parentKey = null, index = null, questionFile = null) {
    const answers = [];
    const answerFields = ['答案', 'answer', 'answers', 'solution', 'solutions', '正确答案', 'correct_answer', 'correctAnswer', '参考答案', 'reference_answer', 'referenceAnswer', '标准答案', 'standard_answer', 'standardAnswer', '解析', 'explanation', 'analysis', '详解', 'content', 'text', 'value', 'result'];
    const skipFields = ['question', '题目', 'stem', '题干', 'id', 'name', 'type', 'index', 'options', 'choices', '选项'];

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          const extracted = this.extractFromObjectJson(item, parentKey, i, questionFile);
          if (extracted && extracted.length > 0) {
            answers.push(...extracted);
          }
        } else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          answers.push({
            title: parentKey ? `${parentKey}[${i}]` : `条目 ${i + 1}`,
            content: String(item),
            type: 'text',
            index: i,
            file: questionFile
          });
        }
      });
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        const normalizedKey = key.trim().toLowerCase();
        if (answerFields.some(field => normalizedKey.includes(field.toLowerCase()))) {
          if (Array.isArray(value)) {
            value.forEach((item, i) => {
              if (typeof item === 'object' && item !== null) {
                const extracted = this.extractFromObjectJson(item, key, i, questionFile);
                if (extracted && extracted.length > 0) {
                  answers.push(...extracted);
                }
              } else {
                answers.push({
                  title: key,
                  content: String(item),
                  type: 'text',
                  index: i,
                  file: questionFile
                });
              }
            });
          } else if (typeof value === 'object' && value !== null) {
            const extracted = this.extractFromObjectJson(value, key, null, questionFile);
            if (extracted && extracted.length > 0) {
              answers.push(...extracted);
            }
          } else {
            answers.push({
              title: key,
              content: String(value),
              type: 'text',
              index: index,
              file: questionFile
            });
          }
        } else if (!skipFields.some(field => normalizedKey.includes(field.toLowerCase()))) {
          if (typeof value === 'object' && value !== null) {
            const extracted = this.extractFromObjectJson(value, key, null, questionFile);
            if (extracted && extracted.length > 0) {
              answers.push(...extracted);
            }
          }
        }
      }
    }
    return answers;
  }

  extractFromXMLJson(jsonStr, fileName, questionFile = null) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        const answers = [];
        parsed.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            const extracted = this.extractFromObjectJson(item, null, index, questionFile);
            if (extracted && extracted.length > 0) {
              answers.push(...extracted);
            }
          } else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
            answers.push({
              title: fileName || `条目 ${index + 1}`,
              content: String(item),
              type: 'text',
              index: index,
              file: fileName
            });
          }
        });
        return answers;
      } else if (typeof parsed === 'object' && parsed !== null) {
        return this.extractFromObjectJson(parsed, null, null, questionFile);
      } else {
        return [{
          title: fileName || '内容',
          content: String(parsed),
          type: 'text',
          index: 0,
          file: fileName
        }];
      }
    } catch (error) {
      console.error('JSON解析失败:', error);
      return [];
    }
  }

  extractFromXMLRaw(xmlStr, fileName, questionFile = null) {
    const answers = [];
    const answerRegex = /<(answer|answers|solution|solutions|explanation|analysis)[^>]*>(.*?)<\/\1>/gs;
    let match;
    while ((match = answerRegex.exec(xmlStr)) !== null) {
      if (match[2] && match[2].trim()) {
        answers.push({
          title: match[1],
          content: match[2].trim(),
          type: 'text',
          index: answers.length,
          file: questionFile
        });
      }
    }
    return answers;
  }

  extractFromJSRaw(jsStr, fileName, questionFile = null) {
    const answers = [];
    const answerPatterns = [
      /(?:答案|answer|solution|explanation)[\s:：=]+["']([^"']+)["']/gi,
      /["'](?:答案|answer|solution|explanation)["'][\s:：=]+["']([^"']+)["']/gi,
      /var\s+(?:答案|answer|solution|explanation)[\s=]+["']([^"']+)["']/gi,
      /let\s+(?:答案|answer|solution|explanation)[\s=]+["']([^"']+)["']/gi,
      /const\s+(?:答案|answer|solution|explanation)[\s=]+["']([^"']+)["']/gi,
      /(?:答案|answer|solution|explanation)\s*[:：=]\s*["']([^"']+)["']/gi
    ];
    answerPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(jsStr)) !== null) {
        if (match[1] && match[1].trim()) {
          answers.push({
            title: match[0].split('=')[0].split(':')[0].trim() || 'JS答案',
            content: match[1].trim(),
            type: 'text',
            index: answers.length,
            file: questionFile
          });
        }
      }
    });
    return answers;
  }

  extractFromTextRaw(textStr, fileName, questionFile = null) {
    const answers = [];
    const answerPatterns = [
      /答案[：:\s]*([^\n\r]+)/g,
      /正确答案[：:\s]*([^\n\r]+)/g,
      /参考答案[：:\s]*([^\n\r]+)/g,
      /标准答案[：:\s]*([^\n\r]+)/g,
      /解析[：:\s]*([^\n\r]+)/g,
      /详解[：:\s]*([^\n\r]+)/g
    ];
    answerPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(textStr)) !== null) {
        if (match[1] && match[1].trim()) {
          answers.push({
            title: match[0].split('：')[0].split(':')[0].trim(),
            content: match[1].trim(),
            type: 'text',
            index: answers.length,
            file: questionFile
          });
        }
      }
    });
    return answers;
  }

  async parseQuestionFileRaw(filePath) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      console.error('读取问题文件失败:', error);
      return null;
    }
  }

  extractMediaIndexFromContentRaw(content) {
    const mediaIndices = [];
    const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      mediaIndices.push({
        type: 'image',
        src: match[1],
        index: mediaIndices.length
      });
    }
    const videoRegex = /<video[^>]*src=["']([^"']+)["'][^>]*>/gi;
    while ((match = videoRegex.exec(content)) !== null) {
      mediaIndices.push({
        type: 'video',
        src: match[1],
        index: mediaIndices.length
      });
    }
    return mediaIndices;
  }

  mergeAnswerDataRaw(allAnswers) {
    const mergedAnswers = [];
    const answerMap = new Map();
    for (const answerGroup of allAnswers) {
      for (const answer of answerGroup) {
        const key = `${answer.title}-${answer.content.substring(0, 50)}`;
        if (!answerMap.has(key)) {
          answerMap.set(key, {
            ...answer,
            sources: [answer.file],
            count: 1
          });
        } else {
          const existing = answerMap.get(key);
          existing.count += 1;
          if (answer.file && !existing.sources.includes(answer.file)) {
            existing.sources.push(answer.file);
          }
        }
      }
    }
    return Array.from(answerMap.values());
  }

  sortAndDeduplicateAnswersRaw(answers) {
    if (!answers || answers.length === 0) return [];
    const uniqueAnswers = [];
    const seenContent = new Set();
    answers.forEach(answer => {
      const contentHash = `${answer.title}:${answer.content}`;
      if (!seenContent.has(contentHash)) {
        seenContent.add(contentHash);
        uniqueAnswers.push(answer);
      }
    });
    return uniqueAnswers.sort((a, b) => {
      if (a.index !== undefined && b.index !== undefined) {
        return a.index - b.index;
      }
      return 0;
    });
  }

  async findLocalFile(fileDir, fileName) {
    try {
      const searchInDir = async (dirPath) => {
        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dirPath, item.name);
          if (item.isDirectory()) {
            const found = await searchInDir(fullPath);
            if (found) return found;
          } else if (item.name === fileName || item.name.includes(fileName)) {
            return fullPath;
          }
        }
        return null;
      };
      return await searchInDir(fileDir);
    } catch (error) {
      console.error('查找本地文件失败:', error);
      return null;
    }
  }

  async importZipToDir(zipPath, targetDir) {
    try {
      await fs.ensureDir(targetDir);
      const zip = new StreamZip({
        file: zipPath,
        storeEntries: true
      });
      zip.on('ready', async () => {
        const entries = zip.entries();
        for (const entry of Object.values(entries)) {
          const targetPath = path.join(targetDir, entry.name);
          if (entry.isDirectory) {
            await fs.ensureDir(targetPath);
          } else {
            await fs.ensureDir(path.dirname(targetPath));
            zip.extract(entry.name, targetPath);
          }
        }
        zip.close();
        console.log(`ZIP文件已解压到: ${targetDir}`);
      });
      zip.on('error', (error) => {
        console.error('解压ZIP文件失败:', error);
      });
    } catch (error) {
      console.error('导入ZIP文件失败:', error);
    }
  }

  async extractZipFileRaw(zipPath, answersDir) {
    try {
      await fs.ensureDir(answersDir);
      const zipFileName = path.basename(zipPath, '.zip');
      const answerDir = path.join(answersDir, zipFileName);
      await fs.ensureDir(answerDir);
      const zip = new StreamZip({
        file: zipPath,
        storeEntries: true
      });
      return new Promise((resolve, reject) => {
        zip.on('ready', async () => {
          try {
            const entries = zip.entries();
            const extractedFiles = [];
            for (const entry of Object.values(entries)) {
              if (!entry.isDirectory) {
                const targetPath = path.join(answerDir, entry.name);
                await fs.ensureDir(path.dirname(targetPath));
                await new Promise((res, rej) => {
                  zip.extract(entry.name, targetPath, (err) => {
                    if (err) rej(err);
                    else res();
                  });
                });
                extractedFiles.push(targetPath);
              }
            }
            zip.close();
            const answers = [];
            for (const filePath of extractedFiles) {
              try {
                const content = await fs.promises.readFile(filePath, 'utf8');
                let extracted = [];
                if (this.isJsonString(content)) {
                  extracted = this.extractFromXMLJson(content, path.basename(filePath), filePath);
                } else if (this.isXmlString(content)) {
                  extracted = this.extractFromXMLRaw(content, path.basename(filePath), filePath);
                } else if (this.isJsString(content)) {
                  extracted = this.extractFromJSRaw(content, path.basename(filePath), filePath);
                } else {
                  extracted = this.extractFromTextRaw(content, path.basename(filePath), filePath);
                }
                answers.push(...extracted);
              } catch (error) {
                console.error(`处理文件 ${filePath} 失败:`, error);
              }
            }
            const sortedAnswers = this.sortAndDeduplicateAnswersRaw(answers);
            resolve({
              success: true,
              answers: sortedAnswers,
              directory: answerDir,
              totalFiles: extractedFiles.length
            });
          } catch (error) {
            reject(error);
          }
        });
        zip.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      console.error('提取ZIP文件失败:', error);
      return { success: false, error: error.message, answers: [] };
    }
  }

  async saveAnswersAsZip(answers, outputDir) {
    try {
      await fs.ensureDir(outputDir);
      console.log('保存答案为ZIP功能待实现');
      return {
        success: true,
        path: outputDir
      };
    } catch (error) {
      console.error('保存答案为ZIP失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async saveAnswersAsJson(answers, outputDir) {
    try {
      await fs.ensureDir(outputDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `answers_${timestamp}.json`;
      const filePath = path.join(outputDir, fileName);
      await fs.promises.writeFile(filePath, JSON.stringify(answers, null, 2));
      return {
        success: true,
        path: filePath
      };
    } catch (error) {
      console.error('保存答案为JSON失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  cleanHtmlText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\\/g, '')
      .trim();
  }

  detectExactType(questionObj) {
    if ((questionObj.questions_list && questionObj.questions_list.length > 0 &&
      questionObj.questions_list[0].options && questionObj.questions_list[0].options.length > 0) ||
      (questionObj.options && questionObj.options.length > 0 && questionObj.answer_text)) {
      return '听后选择';
    }

    if (this.hasAnswerAttributes(questionObj)) {
      return '听后回答';
    }

    if (questionObj.record_speak && questionObj.record_speak.length > 0) {
      const firstItem = questionObj.record_speak[0];
      if (firstItem && !firstItem.work && !firstItem.show &&
        firstItem.content && firstItem.content.length > 100) {
        return '听后转述';
      }
    }

    if (questionObj.record_follow_read ||
      (questionObj.analysis && /\/\//.test(questionObj.analysis))) {
      return '朗读短文';
    }

    return '未知';
  }

  hasAnswerAttributes(questionObj) {
    if (questionObj.record_speak && questionObj.record_speak.length > 0) {
      const firstItem = questionObj.record_speak[0];
      if (firstItem && (firstItem.work === "1" || firstItem.work === 1 ||
        firstItem.show === "1" || firstItem.show === 1)) {
        return true;
      }
    }

    if (questionObj.questions_list && questionObj.questions_list.length > 0) {
      for (const question of questionObj.questions_list) {
        if (question.record_speak && question.record_speak.length > 0) {
          const firstRecord = question.record_speak[0];
          if (firstRecord && (firstRecord.work === "1" || firstRecord.work === 1 ||
            firstRecord.show === "1" || firstRecord.show === 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  parseChoiceQuestions(questionObj, mediaIndex) {
    const results = [];
    if (questionObj.questions_list) {
      questionObj.questions_list.forEach((question, index) => {
        if (question.answer_text && question.options) {
          const correctOption = question.options.find(opt => opt.id === question.answer_text);
          if (correctOption) {
            const questionText = question.question_text || '未知问题';
            results.push({
              question: `第${index + 1}题: ${questionText}`,
              answer: `${question.answer_text}. ${correctOption.content?.trim() || ''}`,
              content: `请回答: ${question.answer_text}. ${correctOption.content?.trim() || ''}`,
              questionText: questionText,
              pattern: '听后选择',
              mediaIndex: mediaIndex
            });
          }
        }
      });
    }

    if (results.length === 0 && questionObj.options && questionObj.options.length > 0 && questionObj.answer_text) {
      const correctOption = questionObj.options.find(opt => opt.id === questionObj.answer_text);
      if (correctOption) {
        const cleanQuestionText = questionObj.question_text ? this.cleanHtmlText(questionObj.question_text) : '未知问题';
        results.push({
          question: `第1题: ${cleanQuestionText}`,
          answer: `${questionObj.answer_text}. ${correctOption.content?.trim() || ''}`,
          content: `请回答: ${questionObj.answer_text}. ${correctOption.content?.trim() || ''}`,
          questionText: cleanQuestionText,
          pattern: '听后选择',
          mediaIndex: mediaIndex
        });
      }
    }
    return results;
  }

  parseAnswerQuestions(questionObj, mediaIndex) {
    const results = [];

    if (questionObj.questions_list) {
      questionObj.questions_list.forEach((question, qIndex) => {
        if (question.record_speak) {
          const answers = question.record_speak
            .filter(item => item.show === "1" || item.show === 1)
            .map(item => item.content?.trim() || '')
            .filter(content => content && content !== '<answers/>');

          let messageInfo = {
            question: `第${qIndex + 1}题`,
            answer: question.question_text || '未知',
            content: `点击展开全部回答`,
            pattern: '听后回答',
            mediaIndex: mediaIndex,
            children: []
          }
          answers.forEach((answer, aIndex) => {
            messageInfo.children.push({
              question: `第${aIndex + 1}个答案`,
              answer: answer,
              content: `请回答: ${answer}`,
              pattern: '听后回答'
            });
          });
          results.push(messageInfo)
        }
      });
    }

    if (questionObj.record_speak && results.length === 0) {
      const answers = questionObj.record_speak
        .filter(item => item.show === "1" || item.show === 1)
        .map(item => item.content?.trim() || '')
        .filter(content => content && content !== '<answers/>');

      let messageInfo = {
        question: `第1题`,
        answer: questionObj.question_text || '未知',
        content: `点击展开全部回答`,
        pattern: '听后回答',
        mediaIndex: mediaIndex,
        children: []
      }
      answers.forEach((answer, index) => {
        messageInfo.children.push({
          question: `第${index + 1}个答案`,
          answer: answer,
          content: `请回答: ${answer}`,
          pattern: '听后回答'
        });
      });
      results.push(messageInfo)
    }

    return results;
  }

  parseRetellContent(questionObj, mediaIndex) {
    const results = [];
    if (questionObj.record_speak && questionObj.record_speak.length > 0) {
      const items = questionObj.record_speak
        .filter(item => item.content && item.content.length > 100)
        .map(item => this.cleanHtmlText(item.content));

      if (items.length > 0) {
        const fullContent = items.join('\n\n');
        results.push({
          question: `转述内容`,
          answer: fullContent,
          content: `请转述: ${fullContent.substring(0, 100)}...`,
          questionText: '请根据听力内容进行转述',
          pattern: '听后转述',
          mediaIndex: mediaIndex
        });
      }
    }
    return results;
  }

  parseReadingContent(questionObj, mediaIndex) {
    const results = [];
    if (questionObj.record_follow_read) {
      const content = this.cleanHtmlText(questionObj.record_follow_read);
      if (content) {
        results.push({
          question: `朗读短文`,
          answer: content,
          content: `请朗读: ${content}`,
          questionText: '请朗读以下短文',
          pattern: '朗读短文',
          mediaIndex: mediaIndex
        });
      }
    }

    if (results.length === 0 && questionObj.analysis) {
      const content = this.cleanHtmlText(questionObj.analysis);
      if (content && /\/\//.test(content)) {
        results.push({
          question: `朗读短文`,
          answer: content.replace(/\/\//g, '，'),
          content: `请朗读: ${content.replace(/\/\//g, '，')}`,
          questionText: '请朗读以下短文',
          pattern: '朗读短文',
          mediaIndex: mediaIndex
        });
      }
    }
    return results;
  }

  parseFallback(questionObj, mediaIndex) {
    const results = [];

    if (questionObj.answer_text) {
      results.push({
        question: `问题`,
        answer: questionObj.answer_text,
        content: `答案: ${questionObj.answer_text}`,
        pattern: '未知题型',
        mediaIndex: mediaIndex
      });
    }

    if (questionObj.record_speak && questionObj.record_speak.length > 0) {
      questionObj.record_speak.forEach((item, index) => {
        if (item.content && item.content !== '<answers/>') {
          const cleanContent = this.cleanHtmlText(item.content);
          results.push({
            question: `第${index + 1}项`,
            answer: cleanContent,
            content: `请回答: ${cleanContent}`,
            pattern: '未知题型',
            mediaIndex: mediaIndex
          });
        }
      });
    }

    return results;
  }

  parseQuestionFile(fileContent, mediaIndex) {
    try {
      const config = typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent;
      const questionObj = config.questionObj || {};

      const detectedType = this.detectExactType(questionObj);

      switch (detectedType) {
        case '听后选择':
          return this.parseChoiceQuestions(questionObj, mediaIndex);
        case '听后回答':
          return this.parseAnswerQuestions(questionObj, mediaIndex);
        case '听后转述':
          return this.parseRetellContent(questionObj, mediaIndex);
        case '朗读短文':
          return this.parseReadingContent(questionObj, mediaIndex);
        default:
          return this.parseFallback(questionObj, mediaIndex);
      }

    } catch (error) {
      console.error(error)
      return [];
    }
  }

  extractAnswersFromFile(filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const content = fs.readFileSync(filePath, 'utf-8');

      if (ext === '.json') {
        return this.extractFromJSON(content, filePath);
      } else if (ext === '.js') {
        let jsonContent = content;
        const varMatch = content.match(/var\s+pageConfig\s*=\s*({.+?});?$/s);
        if (varMatch && varMatch[1]) {
          jsonContent = varMatch[1];
        }
        return this.extractFromJS(jsonContent, filePath);
      } else if (ext === '.xml') {
        return this.extractFromXML(content, filePath);
      } else if (ext === '.txt') {
        return this.extractFromText(content, filePath);
      }

      return [];
    } catch (error) {
      console.error(`读取文件失败: ${filePath}`, error);
      return [];
    }
  }

  extractMediaIndexFromContent(content) {
    try {
      const match = content.match(/media\/(?:[A-Za-z0-9]+-)?([TAQ])?(\d+)(?:\.(\d+))?(?:-[^.]*)?\.mp3/i);
      if (match && match[2]) {
        const prefix = match[1] ? match[1].toUpperCase() : 'T';
        const mainIndex = parseInt(match[2]);
        const subIndex = match[3] ? parseInt(match[3]) : 0;
        const prefixPriority = { 'T': 1, 'A': 2, 'Q': 3 };
        return (prefixPriority[prefix] || 1) * 10000 + mainIndex * 10 + subIndex;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  extractFromJSON(content, filePath) {
    const answers = [];
    const mediaIndex = this.extractMediaIndexFromContent(content);

    try {
      let jsonData;
      try {
        jsonData = JSON.parse(content);
      } catch (e) {
        return [];
      }

      if (jsonData.Data && jsonData.Data.sentences) {
        jsonData.Data.sentences.forEach((sentence, index) => {
          if (sentence.text && sentence.text.length > 2) {
            answers.push({
              question: `第${index + 1}题`,
              answer: sentence.text,
              content: `请朗读: ${sentence.text}`,
              questionText: `请朗读: ${sentence.text}`,
              pattern: 'JSON句子跟读模式',
              mediaIndex: mediaIndex
            });
          }
        });
      }

      if (jsonData.Data && jsonData.Data.words) {
        jsonData.Data.words.forEach((word, index) => {
          if (word && word.length > 1) {
            answers.push({
              question: `第${index + 1}题`,
              answer: word,
              content: `请朗读单词: ${word}`,
              questionText: `请朗读单词: ${word}`,
              pattern: 'JSON单词发音模式',
              mediaIndex: mediaIndex
            });
          }
        });
      }

      if (jsonData.questionObj) {
        const questionAnswers = this.parseQuestionFile(jsonData, mediaIndex);
        answers.push(...questionAnswers);
      }

      if (Array.isArray(jsonData.answers)) {
        jsonData.answers.forEach((answer, index) => {
          if (answer && (typeof answer === 'string' || (typeof answer === 'object' && answer.content))) {
            const answerText = typeof answer === 'string' ? answer : (answer.content || answer.answer || '');
            answers.push({
              question: `第${index + 1}题`,
              answer: answerText,
              content: answerText,
              questionText: answerText,
              pattern: 'JSON答案数组模式',
              mediaIndex: mediaIndex
            });
          }
        });
      }

      if (jsonData.questions) {
        jsonData.questions.forEach((question, index) => {
          if (question && question.answer) {
            const questionText = question.question || '未知题目';
            answers.push({
              question: `第${index + 1}题`,
              answer: question.answer,
              content: `题目: ${questionText}\n答案: ${question.answer}`,
              questionText: questionText,
              pattern: 'JSON题目模式',
              mediaIndex: mediaIndex
            });
          }
        });
      }
    } catch (e) {
      return [];
    }
    return answers;
  }

  extractFromJS(content, filePath) {
    try {
      let jsonData;
      try {
        jsonData = JSON.parse(content);
      } catch (e) {
        console.log('无法解析JS文件，可能该文件为不支持的格式');
        return [];
      }

      const mediaIndex = this.extractMediaIndexFromContent(content);
      return this.parseQuestionFile(jsonData, mediaIndex);
    } catch (error) {
      console.error(`解析JS文件失败: ${filePath}`, error);
      return [];
    }
  }

  extractFromXML(content, filePath) {
    const answers = [];

    try {
      if (filePath.includes('correctAnswer')) {
        console.log('开始解析correctAnswer.xml文件');
        const elementMatches = [...content.matchAll(/<element\s+id="([^"]+)"[^>]*>(.*?)<\/element>/gs)];
        console.log(`找到 ${elementMatches.length} 个element元素`);

        elementMatches.forEach((elementMatch, index) => {
          const elementId = elementMatch[1];
          const elementContent = elementMatch[2];

          console.log(`处理correctAnswer element ${index + 1}, ID: "${elementId}" (长度: ${elementId.length})`);

          if (!elementContent.trim()) {
            console.log(`element ${elementId} 内容为空，跳过`);
            return;
          }

          let analysisText = '';

          const analysisMatch = elementContent.match(/<analysis>\s*<!\[CDATA\[(.*?)]]>\s*<\/analysis>/s);
          if (analysisMatch && analysisMatch[1]) {
            analysisText = this.cleanHtmlText(analysisMatch[1]);
            analysisText = analysisText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
          }

          const answersMatch = elementContent.match(/<answers>\s*<!\[CDATA\[([^\]]+)]]>\s*<\/answers>/);
          if (answersMatch && answersMatch[1]) {
            const answerText = answersMatch[1].trim();
            const answerItem = {
              question: `第${index + 1}题`,
              answer: answerText,
              content: analysisText ? `解析: ${analysisText}\n答案: ${answerText}` : `答案: ${answerText}`,
              questionText: answerText,
              pattern: 'XML正确答案模式',
              elementId: elementId
            };
            answers.push(answerItem);
            console.log(`添加答案项:`, answerItem);
          } else if (analysisText) {
            const answerItem = {
              question: `第${index + 1}题`,
              answer: analysisText,
              content: `解析: ${analysisText}`,
              questionText: analysisText,
              pattern: 'XML正确答案模式',
              elementId: elementId
            };
            answers.push(answerItem);
            console.log(`添加答案项（使用analysis）:`, answerItem);
          } else {
            const answerMatches = [...elementContent.matchAll(/<answer[^>]*>\s*<!\[CDATA\[([^\]]+)]]>\s*<\/answer>/g)];

            if (answerMatches.length > 0) {
              const allAnswers = answerMatches.map(match => match[1].trim()).filter(text => text);

              if (allAnswers.length === 1) {
                const answerItem = {
                  question: `第${index + 1}题`,
                  answer: allAnswers[0],
                  content: analysisText ? `解析: ${analysisText}\n答案: ${allAnswers[0]}` : `答案: ${allAnswers[0]}`,
                  questionText: allAnswers[0],
                  pattern: 'XML正确答案模式',
                  elementId: elementId,
                  answerIndex: 1
                };
                answers.push(answerItem);
                console.log(`添加单答案项:`, answerItem);
              } else {
                const combinedAnswer = allAnswers.join(' / ');
                const answerItem = {
                  question: `第${index + 1}题`,
                  answer: combinedAnswer,
                  content: analysisText ? `解析: ${analysisText}\n答案: ${combinedAnswer}` : `答案: ${combinedAnswer}`,
                  questionText: combinedAnswer,
                  pattern: 'XML正确答案模式',
                  elementId: elementId,
                  answerIndex: 1,
                  multipleAnswers: allAnswers
                };
                answers.push(answerItem);
                console.log(`添加多空题答案项:`, answerItem);
              }
            } else {
              console.log(`element ${elementId} 没有找到有效的答案数据`);
            }
          }
        });
      }

      if (filePath.includes('paper')) {
        console.log('开始解析paper.xml文件');
        const elementMatches = [...content.matchAll(/<element[^>]*id="([^"]+)"[^>]*>(.*?)<\/element>/gs)];
        console.log(`找到 ${elementMatches.length} 个element元素`);

        elementMatches.forEach((elementMatch) => {
          const elementId = elementMatch[1];
          const elementContent = elementMatch[2];

          console.log(`处理paper element, ID: "${elementId}" (长度: ${elementId.length})`);

          const questionNoMatch = elementContent.match(/<question_no>(\d+)<\/question_no>/);
          const questionTextMatch = elementContent.match(/<question_text>\s*<!\[CDATA\[(.*?)]]>\s*<\/question_text>/s);

          console.log(`处理element ${elementId}, 题目编号: ${questionNoMatch ? questionNoMatch[1] : '未找到'}, 题目文本匹配: ${!!questionTextMatch}`);

          const knowledgeMatch = elementContent.match(/<knowledge>\s*<!\[CDATA\[([^\]]+)]]>\s*<\/knowledge>/);

          const attachmentMatch = elementContent.match(/<attachment>\s*<!\[CDATA\[(.*?)]]>\s*<\/attachment>/s);
          let attachmentAnswers = [];
          if (attachmentMatch && attachmentMatch[1]) {
            try {
              const decodedAttachment = decodeURIComponent(attachmentMatch[1]);
              const answersInAttachment = decodedAttachment.match(/<answers>([\s\S]*?)<\/answers>/);
              if (answersInAttachment) {
                const itemMatches = [...answersInAttachment[0].matchAll(/<item[^>]*>\s*<!\[CDATA\[([\s\S]*?)]]>\s*<\/item>/g)];
                attachmentAnswers = itemMatches.map(match => this.cleanHtmlText(match[1].trim())).filter(text => text);
              }
            } catch (e) {
              console.log('解析attachment失败:', e);
            }
          }

          if (questionNoMatch && questionTextMatch) {
            const questionNo = parseInt(questionNoMatch[1]);
            let questionText = questionTextMatch[1];

            console.log(`原始题目文本: "${questionText}"`);

            questionText = this.cleanHtmlText(questionText)
              .replace(/\{\{\d+\}\}/g, ' ');

            console.log(`清理后题目文本: "${questionText}"`);

            const optionsMatches = [...elementContent.matchAll(/<option\s+id="([^"]+)"\s*[^>]*>\s*<!\[CDATA\[(.*?)]]>\s*<\/option>/gs)];

            let answerInfo = {
              question: `第${questionNo}题`,
              answer: attachmentAnswers.length > 0 ? attachmentAnswers.join('\n') : (knowledgeMatch ? knowledgeMatch[1].trim() : '未找到答案'),
              content: `题目: ${questionText}`,
              questionText: questionText,
              pattern: 'XML题目模式',
              elementId: elementId,
              questionNo: questionNo
            };

            if (attachmentAnswers.length > 0) {
              answerInfo.pattern = 'XML题目附件模式';
              answerInfo.attachmentAnswers = attachmentAnswers;
            }

            if (optionsMatches.length > 0) {
              const optionsText = optionsMatches.map(optionMatch =>
                `${optionMatch[1]}. ${optionMatch[2].trim()}`
              ).join('\n');

              answerInfo.content = `题目: ${questionText}\n\n选项:\n${optionsText}`;
              answerInfo.pattern = 'XML题目选项模式';
              answerInfo.options = optionsMatches.map(optionMatch => ({
                id: optionMatch[1],
                text: optionMatch[2].trim()
              }));
            }

            answers.push(answerInfo);
            console.log(`添加题目信息: elementId="${elementId}", questionNo=${questionNo}, questionText="${questionText}"`);
          } else {
            console.log(`跳过element ${elementId}: 缺少题目编号或题目文本`);
          }
        });
      }

      return answers;
    } catch (error) {
      console.error(`解析XML文件失败: ${filePath}`, error);
      return [];
    }
  }

  extractFromText(content, filePath) {
    const answers = [];

    try {
      const answerPatterns = [
        /答案\s*[:：]\s*([^\n]+)/g,
        /标准答案\s*[:：]\s*([^\n]+)/g,
        /正确答案\s*[:：]\s*([^\n]+)/g,
        /参考答案\s*[:：]\s*([^\n]+)/g,
        /\b[A-D]\b/g
      ];

      const lines = content.split('\n');
      let lineNum = 0;

      for (const line of lines) {
        lineNum++;

        for (const pattern of answerPatterns) {
          const matches = [...line.matchAll(pattern)];

          if (matches.length > 0) {
            matches.forEach((match, index) => {
              if (match[1]) {
                answers.push({
                  question: `文本-${lineNum}-${index + 1}`,
                  answer: match[1].trim(),
                  content: `答案: ${match[1].trim()} (行: ${lineNum})`,
                  questionText: match[1].trim(),
                  pattern: '文本答案模式'
                });
              }
            });
          }
        }

        const optionMatches = [...line.matchAll(/\b([A-D])\b/g)];
        if (optionMatches.length > 0) {
          answers.push({
            question: `选项-${lineNum}`,
            answer: optionMatches.map(m => m[1]).join(''),
            content: `选项: ${optionMatches.map(m => m[1]).join('')} (行: ${lineNum})`,
            questionText: optionMatches.map(m => m[1]).join(''),
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

  mergeAnswerData(allAnswers) {
    try {
      const correctAnswers = allAnswers.filter(ans => ans.sourceFile === 'correctAnswer.xml');
      const paperQuestions = allAnswers.filter(ans => ans.sourceFile === 'paper.xml');

      if (correctAnswers.length > 0 && paperQuestions.length > 0) {
        const mergedAnswers = [];
        let successfulMerges = 0;

        correctAnswers.forEach((correctAns, index) => {
          let matchingQuestion = paperQuestions.find(q => q.elementId === correctAns.elementId);

          console.log(`尝试匹配答案: elementId="${correctAns.elementId}", 找到匹配题目: ${!!matchingQuestion}`);

          if (!matchingQuestion) {
            const questionNumber = index + 1;
            matchingQuestion = paperQuestions.find(q => q.questionNo === questionNumber);
            console.log(`elementId匹配失败，尝试按题目编号匹配: 第${questionNumber}题, 找到匹配: ${!!matchingQuestion}`);
          }

          if (matchingQuestion) {
            console.log(`匹配成功 - 题目文本: "${matchingQuestion.questionText}"`);
            mergedAnswers.push({
              ...correctAns,
              questionText: matchingQuestion.questionText
            });
            successfulMerges++;
          } else {
            console.log(`未找到匹配题目，保持原样: elementId="${correctAns.elementId}", 题目编号: 第${index + 1}题`);
            mergedAnswers.push(correctAns);
          }
        });

        console.log(`合并完成: 成功合并 ${successfulMerges}/${correctAnswers.length} 个答案`);

        if (successfulMerges > 0) {
          return this.sortAndDeduplicateAnswers(mergedAnswers);
        }

        console.log('合并成功率过低，回退到普通模式');
        return this.sortAndDeduplicateAnswers(allAnswers);
      }

      return this.sortAndDeduplicateAnswers(allAnswers);
    } catch (error) {
      console.error('合并答案数据失败:', error);
      return allAnswers;
    }
  }

  sortAndDeduplicateAnswers(answers) {
    if (!answers || answers.length === 0) return answers;

    const patternPriority = {
      '听后选择': 1,
      '听后回答': 2,
      '听后转述': 3,
      '朗读短文': 4
    };

    const sortedByMedia = [...answers].sort((a, b) => {
      const priorityA = patternPriority[a.pattern] || 999;
      const priorityB = patternPriority[b.pattern] || 999;

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      const indexA = a.mediaIndex ?? Infinity;
      const indexB = b.mediaIndex ?? Infinity;
      return indexA - indexB;
    });

    const seen = new Map();
    const deduplicated = [];

    for (const ans of sortedByMedia) {
      const key = `${ans.questionText}|${ans.answer}`;
      if (!seen.has(key)) {
        seen.set(key, true);
        deduplicated.push(ans);
      }
    }

    this.emitLog('info', `排序去重完成: 原始 ${answers.length} 条 -> 去重后 ${deduplicated.length} 条`);

    return deduplicated;
  }
}

module.exports = AnswerExtractor;
