const moduleLog = require('../logging').create('答案');
const mergeMethods = require('./merge');
const parsersJsonMethods = require('./parsers/json');
const parsersXmlMethods = require('./parsers/xml');
const parsersPageMethods = require('./parsers/page');
const parsersTextMethods = require('./parsers/text');
const parsersEncryptedMethods = require('./parsers/encrypted');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const StreamZip = require('node-stream-zip');
const CryptoManager = require('./crypto');

class AnswerExtractor {
  // 题型ID常量定义（避免魔法数字）
  static get QTYPE_CHOICE() { return 133; }      // 选择题
  static get QTYPE_SPEAKING() { return 237; }     // 口语跟读题
  static get QTYPE_READING() { return 449; }      // 朗读题
  static get QTYPE_FILL_BLANK() { return 503; }   // 听力填空题
  static get QTYPE_ORAL_QUESTION() { return 531; } // 口语问答题
  static get QTYPE_RETELL() { return 554; }       // 故事复述题

  constructor(logCallback = null) {
    this.cacheDir = path.join(os.homedir(), '.Auto366', 'cache');
    this.extractDir = path.join(this.cacheDir, 'extracted');
    this.appPath = process.cwd();
    this.tempDir = path.join(this.appPath, 'temp');
    this.ansDir = path.join(this.appPath, 'answers');
    this.fileDir = path.join(this.appPath, 'file');
    this.logCallback = logCallback;
    this.cryptoManager = new CryptoManager();
  }

  emitLog(type, message, details = null) {
    const data = moduleLog.event({ type, message, details });
    if (this.logCallback) {
      this.logCallback(data);
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
      const extractPath = path.join(this.extractDir, crypto.randomUUID());
      await fs.ensureDir(extractPath);
      const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
      try { await this.extractZipEntries(zip, await zip.entries(), extractPath); }
      finally { await zip.close(); }
      return extractPath;
    } catch (error) {
      moduleLog.error('解压ZIP文件失败:', error);
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
      moduleLog.error('提取答案失败:', error);
      throw new Error('提取答案失败');
    }
  }

  async scanDirectory(dir, answers, processedFiles) {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await this.scanDirectory(filePath, answers, processedFiles);
      } else if (stat.isFile() && (file.endsWith('.json') || file.endsWith('.txt'))) {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          await this.processFile(file, content, answers, processedFiles);
          await new Promise(resolve => setImmediate(resolve));
        } catch (error) {
          moduleLog.error(`处理文件 ${file} 失败:`, error);
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
      moduleLog.error(`处理文件 ${file} 失败:`, error);
    }
  }

  // 递归查找目录中的 page1.js 文件（已解密的）
  findPage1JsFiles(dirPath) {
    const results = [];
    try {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          results.push(...this.findPage1JsFiles(itemPath));
        } else if (item.toLowerCase() === 'page1.js') {
          results.push(itemPath);
        }
      }
    } catch (error) {
      moduleLog.error(`搜索 未加密page1.js 文件失败: ${dirPath}`, error);
    }
    return results;
  }

  // 解压 ZIP 内全部条目：兼容条目名以 / 开头的绝对路径（如 /0/res/xxx.mp3），
  // 这类路径会被 StreamZip 默认的恶意条目校验拦下，因此关闭该校验后在这里自行做安全处理
  async extractZipEntries(zip, entries, extractDir) {
    for (const entry of Object.values(entries)) {
      if (entry.isDirectory) continue;
      // 去掉前导 / 或 \，拆分后过滤空段与 . 段，并检查 .. 段防止逃逸解压目录
      const relPath = entry.name
        .replace(/^[/\\]+/, '')
        .split(/[/\\]+/)
        .filter((seg) => seg && seg !== '.')
        .join(path.sep);
      if (relPath.split(path.sep).includes('..')) {
        throw new Error('Malicious entry: ' + entry.name);
      }
      const targetPath = path.resolve(extractDir, relPath);
      if (!targetPath.startsWith(path.resolve(extractDir) + path.sep) || /:/.test(relPath)) throw new Error('Malicious entry: ' + entry.name);
      await fs.ensureDir(path.dirname(targetPath));
      await zip.extract(entry.name, targetPath);
    }
  }

  async processZipAnswer(zipPath, ansDir) {
    // 按扩展名去掉后缀；文件名不带 .zip 时另起目录，
    // 否则 extractDir 会等于 zipPath，下一步就把待解压的文件本身删掉了
    const zipExt = path.extname(zipPath);
    let extractDir = zipExt
      ? path.join(path.dirname(zipPath), path.basename(zipPath, zipExt))
      : `${zipPath}_extracted`;

    if (!path.resolve(extractDir).startsWith(path.resolve(path.dirname(zipPath)) + path.sep)) throw new Error('无效解压目录');
    await fs.remove(extractDir);
    await fs.ensureDir(extractDir);

    // skipEntryNameValidation: 兼容条目名以 / 开头（如 /0/res/xxx.mp3）的合法 ZIP，
    // 安全性由 extractZipEntries 自行保证
    const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
    try {
      const entries = await zip.entries();
      if (Object.keys(entries).length === 0) throw new Error('ZIP文件为空或损坏');
      await this.extractZipEntries(zip, entries, extractDir);
    } finally { await zip.close(); }

    const extCount = this.scanFileExtensions(extractDir);

    // 查找并处理 page1 文件提取答案（选择题），优先使用已解密的 page1.js
    let allAnswers = [];
    let processedFiles = [];
    let page1AnswerCount = 0;
    let dirAnswerCount = 0;

    const rawPage1Answers = this.processU3encFiles(extractDir);

    if (rawPage1Answers.length > 0) {
      const page1Answers = this.sortAndDeduplicateAnswers(rawPage1Answers, 'page1');
      page1AnswerCount = page1Answers.length;
      allAnswers = allAnswers.concat(page1Answers);
      processedFiles.push({
        file: 'page1.js',
        answerCount: page1Answers.length,
        sourceType: 'page1',
        success: true,
        details: `提取 ${page1Answers.length} 个选择题`
      });
      this.emitLog('success', `page1 选择题提取完成: ${page1Answers.length} 个`);
    } else {
      this.emitLog('info', '未从 page1 文件中提取到答案，将尝试从 questionData.js 提取其他题型');
    }

    // 始终执行目录扫描，提取其他题型（口语、朗读、复述等）
    const dirExtractResult = await this.extractFromDirectory(extractDir);
    processedFiles = processedFiles.concat(dirExtractResult.processedFiles || []);

    if (dirExtractResult.success && dirExtractResult.answers.length > 0) {
      // 使用 questionText 字段进行去重（与 sortAndDeduplicateAnswers 保持一致）
      const existingKeys = new Set(allAnswers.map(a => `${a.questionText || a.question}|${a.answer}`));
      // 只去掉和 page1 听后回答同一题的加密 answer.json。
      // 朗读/转述目录里的 answer.json 题号相同，但不能一起丢掉。
      const pageSpeakIds = new Set(
        allAnswers
          .filter(a => a.pattern === '听后回答')
          .map(a => String(a.elementId || '').toUpperCase())
          .filter(Boolean)
      );
      const newAnswers = dirExtractResult.answers.filter(a => {
        const elementId = String(a.elementId || '').toUpperCase();
        if (a.pattern === '听后回答' && elementId && pageSpeakIds.has(elementId)) return false;
        return !existingKeys.has(`${a.questionText || a.question}|${a.answer}`);
      });

      if (newAnswers.length > 0) {
        dirAnswerCount = newAnswers.length;
        allAnswers = allAnswers.concat(newAnswers);
        this.emitLog('success', `目录扫描补充提取: ${newAnswers.length} 个新答案`);
      }
    }

    // 根据实际提取结果动态设置来源模式
    let sourceMode;
    if (page1AnswerCount > 0 && dirAnswerCount > 0) {
      sourceMode = 'mixed';
    } else if (page1AnswerCount > 0) {
      sourceMode = 'page1';
    } else if (dirAnswerCount > 0) {
      sourceMode = 'fallback';
    } else {
      sourceMode = 'none';
    }

    // 最终去重和排序（根据数据来源选择排序策略）
    let finalAnswers = this.sortAndDeduplicateAnswers(allAnswers, sourceMode);

    // 一条答案都没提到，但试卷里确实有题（书面表达等本就不含答案的题型）：
    // 退而展示题面/要点，而不是返回空结果
    if (finalAnswers.length === 0 && dirExtractResult.questionMeta && dirExtractResult.questionMeta.length > 0) {
      finalAnswers = this.sortAndDeduplicateAnswers(dirExtractResult.questionMeta, 'fallback');
      if (finalAnswers.length > 0) {
        sourceMode = 'question-only';
        this.emitLog('warning', `未找到答案数据，改为展示 ${finalAnswers.length} 道题目信息（该题型可能本就不含答案）`);
      }
    }

    // 保存结果
    const answerFile = finalAnswers.length > 0
      ? path.join(ansDir, `answers_${Date.now()}.json`)
      : null;

    if (answerFile) {
      await fs.writeFile(answerFile, JSON.stringify({
        answers: finalAnswers,
        count: finalAnswers.length,
        file: answerFile,
        processedFiles: processedFiles,
        sourceMode: sourceMode,
        fileStructure: extCount
      }, null, 2), 'utf-8');

      this.emitLog('success', `答案提取完成: 共 ${finalAnswers.length} 个答案 (来源: ${sourceMode})`);
    } else if (dirExtractResult.success && dirExtractResult.allFilesContent && dirExtractResult.allFilesContent.length > 0) {
      const allContentFile = path.join(ansDir, `all_content_${Date.now()}.txt`);
      const allContentText = dirExtractResult.allFilesContent.map(item =>
        `文件: ${item.file}\n内容:\n${item.content}\n\n${'='.repeat(50)}\n\n`
      ).join('\n');
      await fs.writeFile(allContentFile, allContentText, 'utf-8');
    }

    return {
      extractDir: extractDir,
      fileStructure: extCount,
      answers: finalAnswers,
      count: finalAnswers.length,
      processedFiles: processedFiles,
      allFilesContent: dirExtractResult.allFilesContent || [],
      success: finalAnswers.length > 0,
      message: finalAnswers.length > 0 ? `提取完成，共 ${finalAnswers.length} 个答案` : '未找到答案',
      answerFile: answerFile,
      sourceMode: sourceMode
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
        moduleLog.error('扫描目录失败:', error);
      }
    };
    traverse(dir);
    return extCount;
  }

  async extractFromDirectory(extractDir) {
    const allAnswers = [];
    const processedFiles = [];
    const allFilesContent = [];

    // 先处理加密的 XML 答案文件（correctAnswer.xml.u3enc / paper.xml.u3enc）
    // 同目录若已有解密版本，processXmlU3encFiles 内部会跳过，避免重复
    const xmlU3encResult = this.processXmlU3encFiles(extractDir);
    allAnswers.push(...xmlU3encResult.allAnswers);
    processedFiles.push(...xmlU3encResult.processedFiles);
    allFilesContent.push(...xmlU3encResult.allFilesContent);

    const answerFiles = this.findAnswerFiles(extractDir);

    if (answerFiles.length === 0 && allAnswers.length === 0) {
      this.emitLog('warning', '未找到可能包含答案的文件');
      return { success: false, message: '未找到可能包含答案的文件', processedFiles: [], allAnswers: [], allFilesContent: [] };
    }

    this.emitLog('info', `找到 ${answerFiles.length} 个答案文件`);

    for (const filePath of answerFiles) {
      try {
        const buffer = await fs.readFile(filePath);
        const content = buffer.toString('utf-8');
        const relativePath = path.relative(extractDir, filePath);

        allFilesContent.push({
          file: relativePath,
          content: content
        });

        const answers = this.extractAnswersFromFile(filePath, buffer);
        await new Promise(resolve => setImmediate(resolve));
        const fileName = path.basename(relativePath);
        // 试卷把每道题的资料放在以 element id 命名的目录里（如 F53C.../net/psdata/answer.json），
        // 借这个 id 才能把答案还原成 paper.xml 里的题目顺序
        const elementIdFromPath = this.elementIdFromRelativePath(relativePath);
        if (answers.length > 0) {
          allAnswers.push(...answers.map((ans, idx) => ({
            ...ans,
            elementId: ans.elementId || elementIdFromPath || undefined,
            localIndex: Number.isFinite(ans.localIndex) ? ans.localIndex : idx,
            sourceFile: fileName
          })));
          processedFiles.push({
            file: relativePath,
            answerCount: answers.length,
            actualAnswerCount: answers.filter(answer => !answer.isQuestionMeta && String(answer.answer || '').trim()).length,
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

    return {
      success: true,
      answers: mergedAnswers,
      count: mergedAnswers.length,
      processedFiles: processedFiles,
      allFilesContent: allFilesContent,
      // 一条答案都没提到时的兜底展示素材（题面/要点），见 processZipAnswer
      questionMeta: this.buildQuestionMetaAnswers(allAnswers)
    };
  }

  // paper.xml 里没有答案的题目行平时会被剔除（否则满屏空白项），
  // 但整份卷子一条答案都没有时（如书面表达），要把题面/要点顶上来，
  // 不然面板全空，看起来就像答案获取彻底坏了
  buildQuestionMetaAnswers(allAnswers) {
    if (!Array.isArray(allAnswers)) return [];
    return allAnswers
      .filter(ans => ans.sourceFile === 'paper.xml' && ans.isQuestionMeta)
      .map(ans => {
        const text = ans.metaAnswer || ans.questionText || '';
        return {
          ...ans,
          isQuestionMeta: false,
          answer: text,
          pattern: ans.pattern === 'XML题目模式' ? '题目信息(无答案)' : ans.pattern
        };
      })
      .filter(ans => String(ans.answer).trim());
  }

  // 从解压目录内的相对路径里取出 element id（形如 <32位十六进制>/net/psdata/answer.json）
  elementIdFromRelativePath(relativePath) {
    if (!relativePath) return null;
    const segments = relativePath.split(/[\\/]/);
    for (const segment of segments) {
      if (/^[0-9A-Fa-f]{32}$/.test(segment)) return segment.toUpperCase();
    }
    return null;
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
        moduleLog.error('查找答案文件失败:', error);
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
      moduleLog.error('保存答案失败:', error);
      throw new Error('保存答案失败');
    }
  }

  cleanup() {
    try {
      if (fs.existsSync(this.extractDir)) {
        this.deleteDirectory(this.extractDir);
      }
    } catch (error) {
      moduleLog.error('清理临时文件失败:', error);
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
                moduleLog.error(`处理文件 ${filePath} 失败:`, error);
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
      moduleLog.error('提取ZIP文件失败:', error);
      return { success: false, error: error.message, answers: [] };
    }
  }

  readAnswerFileContent(filePath, buffer = null) {
    const buf = buffer || fs.readFileSync(filePath);
    if (buf.length >= 4 && buf.slice(0, 4).toString('latin1') === 'encr') {
      const decrypted = this.cryptoManager.decryptEncr(buf);
      if (decrypted) return decrypted;
    }
    return buf.toString('utf-8');
  }

  extractAnswersFromFile(filePath, buffer = null) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const content = this.readAnswerFileContent(filePath, buffer);

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
      moduleLog.error(`读取文件失败: ${filePath}`, error);
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
}

// Submodules share this feature's instance; existing method contracts stay unchanged.
Object.assign(AnswerExtractor.prototype, mergeMethods, parsersJsonMethods, parsersXmlMethods, parsersPageMethods, parsersTextMethods, parsersEncryptedMethods);
module.exports = AnswerExtractor;
