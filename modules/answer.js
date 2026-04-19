const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const StreamZip = require('node-stream-zip');

class AnswerExtractor {
  constructor() {
    this.cacheDir = path.join(os.homedir(), '.Auto366', 'cache');
    this.extractDir = path.join(this.cacheDir, 'extracted');
    this.appPath = process.cwd();
    this.tempDir = path.join(this.appPath, 'temp');
    this.ansDir = path.join(this.appPath, 'answers');
    this.fileDir = path.join(this.appPath, 'file');
  }

  // 确保目录存在
  ensureDirectories() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    if (!fs.existsSync(this.extractDir)) {
      fs.mkdirSync(this.extractDir, { recursive: true });
    }
  }

  // 解压ZIP文件
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

  // 提取答案
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

  // 扫描目录
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

  // 处理文件
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

  // 从JSON提取答案
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

  // 从TXT提取答案
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

  // 保存答案到文件
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

  // 清理临时文件
  cleanup() {
    try {
      if (fs.existsSync(this.extractDir)) {
        this.deleteDirectory(this.extractDir);
      }
    } catch (error) {
      console.error('清理临时文件失败:', error);
    }
  }

  // 删除目录
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

  // === 以下为从旧代码中恢复的答案提取方法 ===

  // 检查是否为JSON
  isJsonString(str) {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  // 检查是否为XML
  isXmlString(str) {
    return str.trim().startsWith('<') && str.includes('</') && !str.trim().startsWith('{') && !str.trim().startsWith('[');
  }

  // 检查是否为JS代码
  isJsString(str) {
    const hasJSKeywords = ['function', 'const', 'let', 'var', 'import', 'export', 'class', '=>', 'new ', 'return ', 'if ', 'else ', 'for ', 'while '];
    return str.includes('(') && str.includes(')') && str.includes('{') && str.includes('}') && hasJSKeywords.some(keyword => str.includes(keyword));
  }

  // 从JSON中提取答案
  extractFromJSON(jsonStr, fileName, questionFile = null) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        const answers = [];
        parsed.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            const extracted = this.extractFromObject(item, null, index, questionFile);
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
        return this.extractFromObject(parsed, null, null, questionFile);
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

  // 从对象中提取答案
  extractFromObject(obj, parentKey = null, index = null, questionFile = null) {
    const answers = [];
    const answerFields = ['答案', 'answer', 'answers', 'solution', 'solutions', '正确答案', 'correct_answer', 'correctAnswer', '参考答案', 'reference_answer', 'referenceAnswer', '标准答案', 'standard_answer', 'standardAnswer', '解析', 'explanation', 'analysis', '详解', 'content', 'text', 'value', 'result'];
    const skipFields = ['question', '题目', 'stem', '题干', 'id', 'name', 'type', 'index', 'options', 'choices', '选项'];

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          const extracted = this.extractFromObject(item, parentKey, i, questionFile);
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
                const extracted = this.extractFromObject(item, key, i, questionFile);
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
            const extracted = this.extractFromObject(value, key, null, questionFile);
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
            const extracted = this.extractFromObject(value, key, null, questionFile);
            if (extracted && extracted.length > 0) {
              answers.push(...extracted);
            }
          }
        }
      }
    }
    return answers;
  }

  // 从XML中提取答案
  extractFromXML(xmlStr, fileName, questionFile = null) {
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

  // 从JS中提取答案
  extractFromJS(jsStr, fileName, questionFile = null) {
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

  // 从文本中提取答案
  extractFromText(textStr, fileName, questionFile = null) {
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

  // 解析问题文件
  async parseQuestionFile(filePath) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      console.error('读取问题文件失败:', error);
      return null;
    }
  }

  // 从内容中提取媒体索引
  extractMediaIndexFromContent(content) {
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

  // 合并答案数据
  mergeAnswerData(allAnswers) {
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

  // 对答案进行排序和去重
  sortAndDeduplicateAnswers(answers) {
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

  // 查找本地文件
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

  // 导入ZIP到目录
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

  // 从ZIP文件中提取答案
  async extractZipFile(zipPath, answersDir) {
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
                  extracted = this.extractFromJSON(content, path.basename(filePath), filePath);
                } else if (this.isXmlString(content)) {
                  extracted = this.extractFromXML(content, path.basename(filePath), filePath);
                } else if (this.isJsString(content)) {
                  extracted = this.extractFromJS(content, path.basename(filePath), filePath);
                } else {
                  extracted = this.extractFromText(content, path.basename(filePath), filePath);
                }
                answers.push(...extracted);
              } catch (error) {
                console.error(`处理文件 ${filePath} 失败:`, error);
              }
            }
            const sortedAnswers = this.sortAndDeduplicateAnswers(answers);
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

  // 保存答案为ZIP格式
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

  // 保存答案为JSON格式
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

  // 清理HTML文本
  cleanHtmlText(text) {
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

  // 检测精确类型
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

  // 检查是否有回答属性
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

  // 解析听后选择题
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

  // 解析听后回答题
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

  // 解析听后转述
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

  // 解析朗读短文
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

  // 备用解析方法
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

  // 解析问题文件
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
}

module.exports = AnswerExtractor;
