const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
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

  // ========== Page1.u3enc 处理方法 ==========

  // 从 JS 内容中提取 pageConfig JSON
  extractJsonFromPageConfig(content) {
    const match = content.match(/var\s+pageConfig\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (match && match[1]) return match[1];

    const startIndex = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (startIndex !== -1 && lastBrace !== -1 && lastBrace > startIndex) {
      return content.substring(startIndex, lastBrace + 1);
    }
    return null;
  }

  // 递归查找目录中的 page1.js.u3enc 文件
  findU3encFiles(dirPath) {
    const results = [];
    try {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          results.push(...this.findU3encFiles(itemPath));
        } else if (item.toLowerCase() === 'page1.js.u3enc') {
          results.push(itemPath);
        }
      }
    } catch (error) {
      console.error(`搜索 u3enc 文件失败: ${dirPath}`, error);
    }
    return results;
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
      console.error(`搜索 未加密page1.js 文件失败: ${dirPath}`, error);
    }
    return results;
  }

  // 从 pageConfig 提取所有题型答案（选择题、口语、朗读、复述、填空等）
  extractFromPage1(pageConfig) {
    const answers = [];
    try {
      if (!pageConfig) return answers;

      // 收集所有题目列表（兼容两种数据结构）
      const allQuestionLists = [];

      // 结构1: pageConfig.questionList（直接层级，如口语问答题型）
      if (pageConfig.questionList && Array.isArray(pageConfig.questionList)) {
        allQuestionLists.push(...pageConfig.questionList);
      }

      // 结构2: slides[].questionList（嵌套层级，如选择题题型）
      // 实测真实 pageConfig 里这个字段叫 sliders，只找 slides 会整段落空，两个名字都收
      for (const key of ['slides', 'sliders']) {
        const group = pageConfig[key];
        if (!Array.isArray(group)) continue;
        for (const slide of group) {
          if (slide && Array.isArray(slide.questionList)) {
            allQuestionLists.push(...slide.questionList);
          }
        }
      }

      for (const question of allQuestionLists) {
          const qtypeId = question.qtype_id;

          // 选择题（已有逻辑）
          if (question.answer_text && question.options && question.options.length > 0) {
            const correctOption = question.options.find(opt => opt.id === question.answer_text);
            if (correctOption) {
              const questionText = this.cleanHtmlText(question.question_text || '');
              const answerContent = this.cleanHtmlText(correctOption.content?.trim() || '');
              answers.push({
                question: questionText || '未知问题',
                answer: `${question.answer_text}. ${answerContent}`,
                content: `请回答: ${question.answer_text}. ${answerContent}`,
                questionText: questionText,
                pattern: '听后选择-整体',
                mediaIndex: this.extractMediaIndexFromContent(question.media?.file || '')
              });
            }
          }

          // 嵌套选择题
          if (question.questions_list && question.questions_list.length > 0) {
            for (const q of question.questions_list) {
              if (q.answer_text && q.options && q.options.length > 0) {
                const correctOption = q.options.find(opt => opt.id === q.answer_text);
                if (correctOption) {
                  const questionText = this.cleanHtmlText(q.question_text || '');
                  const answerContent = this.cleanHtmlText(correctOption.content?.trim() || '');
                  answers.push({
                    question: questionText || '未知问题',
                    answer: `${q.answer_text}. ${answerContent}`,
                    content: `请回答: ${q.answer_text}. ${answerContent}`,
                    questionText: questionText,
                    pattern: '听后选择-嵌套',
                    mediaIndex: this.extractMediaIndexFromContent(q.media?.file || '')
                  });
                }
              }
            }
          }

          // 口语跟读题
          if (qtypeId === AnswerExtractor.QTYPE_SPEAKING && question.record_speak && question.record_speak.length > 0) {
            const speakList = question.record_speak;
            const correctAnswers = speakList.filter(item => item.work === "1" && item.show === "1");
            for (const item of correctAnswers) {
              if (item.content && item.content.trim()) {
                const questionText = this.cleanHtmlText(question.question_text || '口语跟读');
                const answerContent = this.cleanHtmlText(item.content.trim());
                answers.push({
                  question: questionText,
                  answer: answerContent,
                  content: `请回答: ${answerContent}`,
                  questionText: questionText,
                  pattern: '口语跟读',
                  mediaIndex: this.extractMediaIndexFromContent(question.media?.file || '')
                });
              }
            }
          }

          // 口语问答题（qtype_id = 531）
          if (qtypeId === AnswerExtractor.QTYPE_ORAL_QUESTION && question.record_speak && question.record_speak.length > 0) {
            const speakList = question.record_speak;
            const validAnswers = speakList
              .filter(item => item.work === "1" && item.show === "1")
              .map(item => this.cleanHtmlText(item.content?.trim() || ''))
              .filter(Boolean);

            if (validAnswers.length > 0) {
              const rawQuestion = question.analysis || question.question_text || '';
              const questionText = this.cleanHtmlText(rawQuestion);

              // 使用 children 格式，与 parseAnswerQuestions 一致，UI 可展示"展开全部答案"
              answers.push({
                question: questionText || '口语问答',
                answer: validAnswers[0],
                content: `点击展开全部回答 (共${validAnswers.length}种)`,
                questionText: questionText || '口语问答',
                pattern: '口语问答',
                mediaIndex: this.extractMediaIndexFromContent(question.media?.file || ''),
                children: validAnswers.map((ans, i) => ({
                  question: `第${i + 1}个答案`,
                  answer: ans,
                  content: `请回答: ${ans}`,
                  pattern: '口语问答'
                }))
              });
            }
          }

          // 朗读题
          if (qtypeId === AnswerExtractor.QTYPE_READING && question.analysis && question.analysis.trim()) {
            const analysisText = this.cleanHtmlText(question.analysis).trim();
            if (analysisText) {
              answers.push({
                question: '朗读文本',
                answer: analysisText,
                content: `请朗读: ${analysisText}`,
                questionText: analysisText.substring(0, 50) + (analysisText.length > 50 ? '...' : ''),
                pattern: '朗读',
                mediaIndex: this.extractMediaIndexFromContent(question.media?.file || '')
              });
            }
          }

          // 故事复述题
          if (qtypeId === AnswerExtractor.QTYPE_RETELL && question.analysis && question.analysis.trim()) {
            let analysisText = question.analysis
              .replace(/<p[^>]*>答案[一二三四五六七八九十]+：<\/p>/g, '')
              .replace(/<[^>]+>/g, '')
              .trim();
            analysisText = analysisText.replace(/\s+/g, ' ').trim();
            if (analysisText) {
              const firstAnswer = analysisText.split(/\s*答案[一二三四五六七八九十]+：\s*/)[0] || analysisText;
              const questionText = this.cleanHtmlText(question.question_text || '故事复述');
              answers.push({
                question: questionText,
                answer: firstAnswer.trim(),
                content: `请复述: ${firstAnswer.trim()}`,
                questionText: questionText,
                pattern: '故事复述',
                mediaIndex: this.extractMediaIndexFromContent(question.media?.file || '')
              });
            }
          }

          // 听力填空题
          if (qtypeId === AnswerExtractor.QTYPE_FILL_BLANK) {
            if (question.analysis && question.analysis.trim()) {
              const analysisText = this.cleanHtmlText(question.analysis).trim();
              if (analysisText) {
                answers.push({
                  question: this.cleanHtmlText(question.question_text || '听力填空'),
                  answer: analysisText,
                  content: `请回答: ${analysisText}`,
                  questionText: this.cleanHtmlText(question.question_text || '听力填空'),
                  pattern: '听力填空',
                  mediaIndex: this.extractMediaIndexFromContent(question.media?.file || '')
                });
              }
            } else if (question.record_follow_read?.paragraph_list) {
              for (const para of question.record_follow_read.paragraph_list) {
                const sentences = para.sentences || [];
                for (const sent of sentences) {
                  if (sent.keyNo && sent.content_en) {
                    const boldMatch = sent.content_en.match(/<b>([^<]+)<\/b>/);
                    const answerText = boldMatch ? boldMatch[1] : this.cleanHtmlText(sent.content_en);
                    if (answerText.trim()) {
                      answers.push({
                        question: `问题 ${sent.keyNo}`,
                        answer: answerText.trim(),
                        content: `请回答: ${answerText.trim()}`,
                        questionText: answerText.trim(),
                        pattern: '听力填空',
                        mediaIndex: this.extractMediaIndexFromContent(question.media?.file || '')
                      });
                    }
                  }
                }
              }
          }
        }
      }

      console.log(`从 pageConfig 提取到 ${answers.length} 个答案`);
      return answers;
    } catch (error) {
      console.error('从 pageConfig 提取答案失败:', error);
      return [];
    }
  }

  // 查找并处理所有 page1 文件（优先已解密的 page1.js，其次 page1.js.u3enc），提取答案
  processU3encFiles(dirPath) {
    const page1JsFiles = this.findPage1JsFiles(dirPath);
    const u3encFiles = this.findU3encFiles(dirPath);

    const jsDirs = new Set(page1JsFiles.map(f => path.dirname(f)));
    const filteredU3encFiles = u3encFiles.filter(f => !jsDirs.has(path.dirname(f)));

    let answers = [];

    if (page1JsFiles.length === 0 && filteredU3encFiles.length === 0) return answers;

    for (const jsFile of page1JsFiles) {
      console.log(`处理 page1.js 文件: ${jsFile}`);
      try {
        const content = fs.readFileSync(jsFile, 'utf-8');
        const jsonStr = this.extractJsonFromPageConfig(content);

        if (jsonStr) {
          const pageConfig = JSON.parse(jsonStr);
          const fileAnswers = this.extractFromPage1(pageConfig);
          answers = answers.concat(fileAnswers);
          console.log(`从 ${path.basename(path.dirname(jsFile))}/page1.js(已解密) 提取到 ${fileAnswers.length} 个答案`);
        }
      } catch (error) {
        console.error(`解析 page1.js 失败 (${jsFile}):`, error);
      }
    }

    if (filteredU3encFiles.length > 0) {
      console.log(`找到 ${filteredU3encFiles.length} 个 page1.js.u3enc 文件`);

      for (const u3encFile of filteredU3encFiles) {
        console.log(`处理 page1.js.u3enc 文件: ${u3encFile}`);
        try {
          const encryptedData = fs.readFileSync(u3encFile);
          const decryptedData = this.cryptoManager.decryptU3enc(encryptedData);

          if (decryptedData) {
            const content = decryptedData.toString('utf-8');
            const jsonStr = this.extractJsonFromPageConfig(content);

            if (jsonStr) {
              const pageConfig = JSON.parse(jsonStr);
              const fileAnswers = this.extractFromPage1(pageConfig);
              answers = answers.concat(fileAnswers);
              console.log(`从 ${path.basename(path.dirname(u3encFile))}/page1.js 提取到 ${fileAnswers.length} 个答案`);
            }
          } else {
            console.log(`解密 page1.js.u3enc 失败: ${u3encFile}`);
          }
        } catch (error) {
          console.error(`解析 page1.js.u3enc 失败 (${u3encFile}):`, error);
        }
      }
    }

    return answers;
  }

  async processZipAnswer(zipPath, ansDir) {
    // 按扩展名去掉后缀；文件名不带 .zip 时另起目录，
    // 否则 extractDir 会等于 zipPath，下一步就把待解压的文件本身删掉了
    const zipExt = path.extname(zipPath);
    let extractDir = zipExt
      ? path.join(path.dirname(zipPath), path.basename(zipPath, zipExt))
      : `${zipPath}_extracted`;

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

    if (dirExtractResult.success && dirExtractResult.answers.length > 0) {
      // 使用 questionText 字段进行去重（与 sortAndDeduplicateAnswers 保持一致）
      const existingKeys = new Set(allAnswers.map(a => `${a.questionText || a.question}|${a.answer}`));
      const newAnswers = dirExtractResult.answers.filter(a => !existingKeys.has(`${a.questionText || a.question}|${a.answer}`));

      if (newAnswers.length > 0) {
        dirAnswerCount = newAnswers.length;
        allAnswers = allAnswers.concat(newAnswers);
        processedFiles = processedFiles.concat(dirExtractResult.processedFiles);
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
        processedFiles = processedFiles.concat(dirExtractResult.processedFiles || []);
        this.emitLog('warning', `未找到答案数据，改为展示 ${finalAnswers.length} 道题目信息（该题型可能本就不含答案）`);
      }
    }

    // 保存结果
    const answerFile = finalAnswers.length > 0
      ? path.join(ansDir, `answers_${Date.now()}.json`)
      : null;

    if (answerFile) {
      fs.writeFileSync(answerFile, JSON.stringify({
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
      fs.writeFileSync(allContentFile, allContentText, 'utf-8');
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

  // record_speak 里既有参考答案也有干扰项，只有 work=1 且 show=1 的才是可用答案
  // （extractFromPage1 用的就是这个判定）。严格筛完为空时逐级放宽，避免反过来漏答案。
  pickSpeakAnswers(recordSpeak) {
    if (!Array.isArray(recordSpeak) || recordSpeak.length === 0) return [];

    const textOf = item => this.cleanHtmlText(item.content?.trim() || '');
    const isValid = text => text && text !== '<answers/>';
    const is1 = value => value === "1" || value === 1;

    const strict = recordSpeak.filter(item => is1(item.work) && is1(item.show)).map(textOf).filter(isValid);
    if (strict.length > 0) return strict;

    const shown = recordSpeak.filter(item => is1(item.show)).map(textOf).filter(isValid);
    if (shown.length > 0) return shown;

    return recordSpeak.map(textOf).filter(isValid);
  }

  parseAnswerQuestions(questionObj, mediaIndex) {
    const results = [];

    if (questionObj.questions_list) {
      questionObj.questions_list.forEach((question, qIndex) => {
        if (question.record_speak) {
          const answers = this.pickSpeakAnswers(question.record_speak);

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
      const answers = this.pickSpeakAnswers(questionObj.record_speak);

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
      // 之前这里把 record_speak 全量倒出来，干扰项也当成答案了
      this.pickSpeakAnswers(questionObj.record_speak).forEach((cleanContent, index) => {
        results.push({
          question: `第${index + 1}项`,
          answer: cleanContent,
          content: `请回答: ${cleanContent}`,
          pattern: '未知题型',
          mediaIndex: mediaIndex
        });
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

  // ========== XML 解析辅助方法 ==========
  // 天学网的 paper.xml / correctAnswer.xml 里 element 的属性顺序、CDATA 内容、嵌套层级
  // 都不固定，单条正则很容易漏匹配或跨节点误匹配，这里用扫描器代替。

  // paper.xml 的 <attachment> 是用 JS escape() 编码的：非 ASCII 编成 %uXXXX，
  // decodeURIComponent 遇到它必抛 "URI malformed"（实测真实试卷 100% 触发），
  // 之前整段 attachment 就此丢失。这里按 escape 的规则兜底解码。
  decodeAttachment(text) {
    if (typeof text !== 'string' || !text.includes('%')) return text || '';

    try {
      return decodeURIComponent(text);
    } catch (e) {
      // 落到下面按 escape() 解码
    }

    // 先还原 %uXXXX，再尝试把剩下的 %XX 当 UTF-8 解，失败则按 Latin-1 逐字节还原
    const unicodeDecoded = text.replace(/%u([0-9a-fA-F]{4})/g,
      (all, hex) => String.fromCharCode(parseInt(hex, 16)));
    try {
      return decodeURIComponent(unicodeDecoded);
    } catch (e) {
      return unicodeDecoded.replace(/%([0-9a-fA-F]{2})/g,
        (all, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
  }

  // 书面表达题（question_type=14）的内容在 attachment 的 question_extended JSON 里：
  // modelEssays 是范文（真答案），mainPoints 是要点。没有范文时要点也得带出来，
  // 不然这类卷子提取结果为空，用户会以为答案获取坏了。
  parseWritingExtended(decodedAttachment) {
    const raw = this.readXmlTag(decodedAttachment, 'question_extended');
    if (raw === null) return null;

    let data;
    try {
      data = JSON.parse(raw.trim());
    } catch (e) {
      return null;
    }
    if (!data || typeof data !== 'object') return null;

    const toText = value => {
      if (typeof value === 'string') return this.cleanHtmlText(value).trim();
      if (value && typeof value === 'object') {
        return this.cleanHtmlText(value.cont || value.content || value.text || '').trim();
      }
      return '';
    };

    const mainPoints = Array.isArray(data.mainPoints) ? data.mainPoints.map(toText).filter(Boolean) : [];
    const modelEssays = Array.isArray(data.modelEssays) ? data.modelEssays.map(toText).filter(Boolean) : [];
    const title = (data.letterFormat && toText(data.letterFormat.title)) ||
      (data.letterFormatV2 && toText(data.letterFormatV2.title)) || '';

    if (!mainPoints.length && !modelEssays.length && !title) return null;
    return { title, mainPoints, modelEssays };
  }

  // 解开 CDATA 包裹，返回内部原始文本
  cleanCdata(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  }

  // 扫描出所有带 id 的 <element>，inner 已剔除嵌套的子 element，避免把子节点的答案算到父节点头上
  matchXmlElements(content) {
    const nodes = [];
    const stack = [];
    const tagRegex = /<(\/?)element\b([^>]*)>/g;
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
      const isClosing = match[1] === '/';
      const attrs = match[2] || '';
      const selfClosing = /\/\s*$/.test(attrs);

      if (isClosing) {
        const open = stack.pop();
        if (open) {
          open.innerEnd = match.index;
          nodes.push(open);
        }
        continue;
      }
      if (selfClosing) continue;

      const idMatch = attrs.match(/\bid\s*=\s*"([^"]*)"/) || attrs.match(/\bid\s*=\s*'([^']*)'/);
      const node = {
        id: idMatch ? idMatch[1] : '',
        start: match.index,
        innerStart: tagRegex.lastIndex,
        innerEnd: content.length,
        children: []
      };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      stack.push(node);
    }

    // 未闭合的节点也收下，损坏的 XML 至少还能取到部分答案
    while (stack.length > 0) nodes.push(stack.pop());

    return nodes
      .filter(node => node.id)
      .sort((a, b) => a.start - b.start)
      .map(node => {
        let inner = '';
        let cursor = node.innerStart;
        for (const child of node.children.sort((a, b) => a.start - b.start)) {
          inner += content.slice(cursor, child.start);
          cursor = Math.max(cursor, child.innerEnd);
          const closeEnd = content.indexOf('>', cursor);
          cursor = closeEnd === -1 ? cursor : closeEnd + 1;
        }
        inner += content.slice(cursor, node.innerEnd);
        return { id: node.id, inner };
      });
  }

  // 读取首个 <tag>...</tag> 的内容，找不到返回 null（区别于"内容为空字符串"）
  readXmlTag(content, tagName, options = {}) {
    if (typeof content !== 'string') return null;
    const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = content.match(re);
    if (!match) return null;
    return options.raw ? match[1] : this.cleanCdata(match[1]);
  }

  // 读取所有 <tag>...</tag> 的文本内容（按文档顺序），已清洗并过滤空项
  readXmlTagList(content, tagNames) {
    if (typeof content !== 'string') return [];
    const names = Array.isArray(tagNames) ? tagNames : [tagNames];
    const results = [];
    for (const name of names) {
      const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi');
      let match;
      while ((match = re.exec(content)) !== null) {
        const text = this.cleanHtmlText(this.cleanCdata(match[1])).trim();
        if (text) results.push({ index: match.index, text });
      }
      if (results.length > 0) break;  // 优先用排在前面的标签名，避免 answer/item 混取
    }
    return results.sort((a, b) => a.index - b.index).map(item => item.text);
  }

  extractFromXML(content, filePath) {
    const answers = [];

    try {
      // 只看文件名：解压目录名里若带 paper/answer 字样，用整路径判断会把每个 xml 都走错分支
      const fileName = path.basename(filePath).toLowerCase();

      if (fileName.includes('correctanswer')) {
        console.log('开始解析correctAnswer.xml文件');
        const elementMatches = this.matchXmlElements(content);
        console.log(`找到 ${elementMatches.length} 个element元素`);

        elementMatches.forEach((elementMatch, index) => {
          const elementId = elementMatch.id;
          const elementContent = elementMatch.inner;

          console.log(`处理correctAnswer element ${index + 1}, ID: "${elementId}" (长度: ${elementId.length})`);

          if (!elementContent.trim()) {
            console.log(`element ${elementId} 内容为空，跳过`);
            return;
          }

          const rawAnalysis = this.readXmlTag(elementContent, 'analysis');
          const analysisText = rawAnalysis
            ? this.cleanHtmlText(rawAnalysis).replace(/\s+/g, ' ').trim()
            : '';

          // 按可靠性从高到低取答案：
          // 1. <answers> 下的 <answer>/<item> 子节点（多空题，每空一个答案）
          // 2. <answers> 的直接文本
          // 3. element 下任意位置的 <answer> 节点
          // 4. 都没有时才退回 <analysis>（解析文本，不是标准答案）
          const answersBlock = this.readXmlTag(elementContent, 'answers', { raw: true });
          let allAnswers = [];
          let usedAnalysisFallback = false;

          if (answersBlock !== null) {
            allAnswers = this.readXmlTagList(answersBlock, ['answer', 'item']);
            if (allAnswers.length === 0) {
              const directText = this.cleanCdata(answersBlock).trim();
              if (directText) allAnswers = [directText];
            }
          }

          if (allAnswers.length === 0) {
            allAnswers = this.readXmlTagList(elementContent, ['answer', 'item']);
          }

          if (allAnswers.length === 0 && analysisText) {
            allAnswers = [analysisText];
            usedAnalysisFallback = true;
          }

          if (allAnswers.length === 0) {
            console.log(`element ${elementId} 没有找到有效的答案数据`);
            return;
          }

          const combinedAnswer = allAnswers.join(' / ');
          const answerItem = {
            question: `第${index + 1}题`,
            answer: combinedAnswer,
            content: analysisText && !usedAnalysisFallback
              ? `解析: ${analysisText}\n答案: ${combinedAnswer}`
              : (usedAnalysisFallback ? `解析: ${analysisText}` : `答案: ${combinedAnswer}`),
            questionText: combinedAnswer,
            pattern: 'XML正确答案模式',
            elementId: elementId,
            answerIndex: 1,
            elementOrder: index
          };
          if (allAnswers.length > 1) {
            answerItem.multipleAnswers = allAnswers;
          }
          if (usedAnalysisFallback) {
            answerItem.fromAnalysis = true;
          }
          answers.push(answerItem);
          console.log(`添加答案项 (${allAnswers.length} 空):`, answerItem.answer);
        });
      }

      else if (fileName.includes('paper')) {
        console.log('开始解析paper.xml文件');
        const elementMatches = this.matchXmlElements(content);
        console.log(`找到 ${elementMatches.length} 个element元素`);

        let fallbackNo = 0;
        elementMatches.forEach((elementMatch) => {
          const elementId = elementMatch.id;
          const elementContent = elementMatch.inner;

          const questionNoText = this.readXmlTag(elementContent, 'question_no');
          const rawQuestionText = this.readXmlTag(elementContent, 'question_text');

          // question_text 缺失时也要留下题序信息，后面合并答案还要靠它排序
          if (rawQuestionText === null && questionNoText === null) {
            console.log(`跳过element ${elementId}: 既无题目编号也无题目文本`);
            return;
          }

          fallbackNo++;
          const parsedNo = questionNoText !== null ? parseInt(questionNoText.trim(), 10) : NaN;
          const questionNo = Number.isFinite(parsedNo) && parsedNo > 0 ? parsedNo : fallbackNo;

          const questionText = this.cleanHtmlText(rawQuestionText || '')
            .replace(/\{\{\d+\}\}/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          // attachment 里的 <item> 才是真答案；knowledge 是知识点标签，不能当答案用
          const attachmentRaw = this.readXmlTag(elementContent, 'attachment');
          let attachmentAnswers = [];
          let writing = null;
          if (attachmentRaw) {
            try {
              const decodedAttachment = this.decodeAttachment(attachmentRaw);
              const answersInAttachment = this.readXmlTag(decodedAttachment, 'answers', { raw: true });
              if (answersInAttachment !== null) {
                attachmentAnswers = this.readXmlTagList(answersInAttachment, ['item', 'answer']);
              }
              // 书面表达题的范文/要点藏在 question_extended 里
              writing = this.parseWritingExtended(decodedAttachment);
              if (attachmentAnswers.length === 0 && writing && writing.modelEssays.length > 0) {
                attachmentAnswers = writing.modelEssays;
              }
            } catch (e) {
              console.log('解析attachment失败:', e);
            }
          }

          const optionMatches = [...elementContent.matchAll(/<option\b[^>]*\bid\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)];
          const options = optionMatches.map(optionMatch => ({
            id: optionMatch[1],
            text: this.cleanHtmlText(this.cleanCdata(optionMatch[2])).trim()
          }));

          const answerInfo = {
            question: `第${questionNo}题`,
            answer: attachmentAnswers.join('\n'),
            content: `题目: ${questionText}`,
            questionText: questionText,
            pattern: 'XML题目模式',
            elementId: elementId,
            questionNo: questionNo,
            // 没有 attachment 答案时这条只是题面信息，不是答案，合并阶段会剔除
            isQuestionMeta: attachmentAnswers.length === 0
          };

          if (attachmentAnswers.length > 0) {
            answerInfo.pattern = 'XML题目附件模式';
            answerInfo.attachmentAnswers = attachmentAnswers;
            if (attachmentAnswers.length > 1) {
              answerInfo.multipleAnswers = attachmentAnswers;
            }
          }

          if (options.length > 0) {
            const optionsText = options.map(opt => `${opt.id}. ${opt.text}`).join('\n');
            answerInfo.content = `题目: ${questionText}\n\n选项:\n${optionsText}`;
            answerInfo.options = options;
            if (attachmentAnswers.length === 0) {
              answerInfo.pattern = 'XML题目选项模式';
            }
          }

          // 书面表达：有范文就是答案；没范文时至少把标题和要点带出来，
          // 否则这类卷子整份提取结果为空，面板上什么都看不到
          if (writing) {
            answerInfo.writing = writing;
            if (writing.modelEssays.length > 0) {
              answerInfo.pattern = '书面表达范文';
              if (writing.modelEssays.length > 1) {
                answerInfo.multipleAnswers = writing.modelEssays;
              }
            } else if (writing.mainPoints.length > 0) {
              answerInfo.pattern = '书面表达要点';
              answerInfo.metaAnswer = writing.mainPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');
            }
            const head = [
              writing.title ? `标题: ${writing.title}` : '',
              `题目: ${questionText}`,
              writing.mainPoints.length > 0
                ? '要点:\n' + writing.mainPoints.map((p, i) => `  ${i + 1}. ${p}`).join('\n') : ''
            ].filter(Boolean).join('\n');
            answerInfo.content = head;
          }

          answers.push(answerInfo);
        });
      }

      return answers;
    } catch (error) {
      console.error(`解析XML文件失败: ${filePath}`, error);
      return [];
    }
  }

  // 解析 JSON 响应体内嵌的 answerData/paperData XML，复用现有 XML 解析与合并逻辑
  extractFromJsonResponse(jsonText) {
    try {
      const jsonObj = JSON.parse(jsonText);
      if (!jsonObj.data || !jsonObj.data.answerData) return [];

      const answerXml = jsonObj.data.answerData;
      const paperXml = jsonObj.data.paperData || '';

      // 复用 extractFromXML，模拟文件名触发 correctAnswer/paper 分支
      const answerItems = this.extractFromXML(answerXml, 'correctAnswer.xml');
      const paperItems = paperXml ? this.extractFromXML(paperXml, 'paper.xml') : [];

      // 合并并设置 sourceFile（mergeAnswerData 依赖此字段筛选）
      const combined = [
        ...answerItems.map(a => ({ ...a, sourceFile: 'correctAnswer.xml' })),
        ...paperItems.map(a => ({ ...a, sourceFile: 'paper.xml' }))
      ];

      if (combined.length === 0) return [];
      return this.mergeAnswerData(combined);
    } catch (e) {
      console.error('解析JSON内嵌XML响应失败:', e);
      return [];
    }
  }

  extractFromText(content, filePath) {
    const answers = [];

    try {
      // 合成一条正则：原来"答案/标准答案/正确答案/参考答案"四条会同时命中同一行，
      // 一行"正确答案：B"被重复收录多次
      const answerPattern = /(?:标准|正确|参考)?答案\s*[:：]\s*([^\n]+)/g;

      const lines = content.split('\n');
      let lineNum = 0;

      for (const line of lines) {
        lineNum++;

        const matches = [...line.matchAll(answerPattern)];
        matches.forEach((match, index) => {
          const text = match[1] && match[1].trim();
          if (text) {
            answers.push({
              question: `文本-${lineNum}-${index + 1}`,
              answer: text,
              content: `答案: ${text} (行: ${lineNum})`,
              questionText: text,
              pattern: '文本答案模式'
            });
          }
        });

        // 原先还会把每行里孤立出现的 A-D 字母凑成一条"选项"答案，
        // 它既对不上题号、auto-fill 也不消费，只是在列表里刷屏，这里去掉
      }

      return answers;
    } catch (error) {
      console.error(`解析文本文件失败: ${filePath}`, error);
      return [];
    }
  }

  mergeAnswerData(allAnswers) {
    try {
      const paperQuestions = allAnswers.filter(ans => ans.sourceFile === 'paper.xml');
      const correctAnswers = allAnswers.filter(ans => ans.sourceFile === 'correctAnswer.xml');
      // paper.xml 里没带答案的条目只是题面，不参与作答，但要留着做题序和题干来源
      const otherAnswers = allAnswers.filter(ans =>
        ans.sourceFile !== 'correctAnswer.xml' &&
        !(ans.sourceFile === 'paper.xml' && ans.isQuestionMeta)
      );

      // elementId -> 题目信息，大小写不敏感（目录名与 xml 里的写法不总是一致）
      const paperByElement = new Map();
      const paperByNo = new Map();
      paperQuestions.forEach((q, order) => {
        if (q.elementId) paperByElement.set(String(q.elementId).toUpperCase(), { ...q, order });
        if (Number.isFinite(q.questionNo)) paperByNo.set(q.questionNo, { ...q, order });
      });

      const lookupPaper = (ans, fallbackIndex) => {
        if (ans.elementId) {
          const hit = paperByElement.get(String(ans.elementId).toUpperCase());
          if (hit) return hit;
        }
        if (Number.isFinite(ans.questionNo) && paperByNo.has(ans.questionNo)) {
          return paperByNo.get(ans.questionNo);
        }
        // 最后才按出现次序对齐，容易错位，仅作兜底
        if (Number.isFinite(fallbackIndex) && paperByNo.has(fallbackIndex + 1)) {
          return paperByNo.get(fallbackIndex + 1);
        }
        return null;
      };

      let successfulMerges = 0;

      // 1) correctAnswer.xml 的答案配上 paper.xml 的题干、选项和真实题号
      const mergedCorrect = correctAnswers.map((correctAns, index) => {
        const matchingQuestion = lookupPaper(correctAns, index);
        if (!matchingQuestion) {
          console.log(`未找到匹配题目，保持原样: elementId="${correctAns.elementId}"`);
          return { ...correctAns, paperOrder: Number.MAX_SAFE_INTEGER, tieIndex: index };
        }

        successfulMerges++;

        // 答案是选项字母（如 "A" 或 "ACD"）时换成选项正文，填空题答案原样保留
        let answerContent = correctAns.answer;
        const options = matchingQuestion.options || [];
        if (options.length > 0 && /^[A-Za-z\s]+$/.test(String(correctAns.answer).trim())) {
          const answerLetters = String(correctAns.answer).trim().toUpperCase().split('').filter(ch => /[A-Z]/.test(ch));
          const matchedTexts = answerLetters
            .map(letter => {
              const opt = options.find(o => String(o.id).toUpperCase() === letter);
              return opt ? this.cleanHtmlText(opt.text) : null;
            })
            .filter(Boolean);
          if (matchedTexts.length === answerLetters.length && matchedTexts.length > 0) {
            answerContent = matchedTexts.join(' / ');
          }
        }

        return {
          ...correctAns,
          answer: answerContent,
          content: `答案: ${answerContent}`,
          questionText: matchingQuestion.questionText || correctAns.questionText,
          options: options.length > 0 ? options : correctAns.options,
          // 采用试卷的真实题号，而不是 correctAnswer.xml 里的数组下标
          questionNo: matchingQuestion.questionNo,
          question: `第${matchingQuestion.questionNo}题`,
          paperOrder: matchingQuestion.order,
          tieIndex: index
        };
      });

      // 2) 其余答案（各题目录下的 answer.json、questionData.js 等）按试卷顺序归位
      const mergedOthers = otherAnswers.map((ans, index) => {
        const matchingQuestion = lookupPaper(ans, null);
        return {
          ...ans,
          questionText: ans.questionText || (matchingQuestion ? matchingQuestion.questionText : ''),
          paperOrder: matchingQuestion ? matchingQuestion.order : Number.MAX_SAFE_INTEGER,
          tieIndex: index
        };
      });

      console.log(`合并完成: 成功合并 ${successfulMerges}/${correctAnswers.length} 个答案`);

      const combined = [...mergedCorrect, ...mergedOthers].sort((a, b) => {
        if (a.paperOrder !== b.paperOrder) return a.paperOrder - b.paperOrder;
        const localA = Number.isFinite(a.localIndex) ? a.localIndex : 0;
        const localB = Number.isFinite(b.localIndex) ? b.localIndex : 0;
        if (localA !== localB) return localA - localB;
        return a.tieIndex - b.tieIndex;
      });

      const deduplicated = this.sortAndDeduplicateAnswers(combined, 'fallback');
      return this.assignQuestionNumbers(deduplicated);
    } catch (error) {
      console.error('合并答案数据失败:', error);
      return allAnswers;
    }
  }

  // 统一编号：correctAnswer 已经拿到试卷真实题号就沿用，其余（跟读句子等）按试卷顺序连续编号。
  // 编号必须全局唯一——auto-fill 用「第N题」建索引，重号会让后面的答案被直接丢弃。
  assignQuestionNumbers(answers) {
    if (!Array.isArray(answers) || answers.length === 0) return answers;

    const usedNumbers = new Set();
    for (const ans of answers) {
      if (ans.sourceFile === 'correctAnswer.xml' && Number.isFinite(ans.questionNo) && !usedNumbers.has(ans.questionNo)) {
        usedNumbers.add(ans.questionNo);
      }
    }

    let nextNumber = 1;
    const takeNextNumber = () => {
      while (usedNumbers.has(nextNumber)) nextNumber++;
      usedNumbers.add(nextNumber);
      return nextNumber;
    };

    // 同一道题的多个空/多个答案共用题号，用 answerIndex 区分先后
    const seenPerQuestion = new Map();

    return answers.map(ans => {
      let questionNo;
      if (ans.sourceFile === 'correctAnswer.xml' && Number.isFinite(ans.questionNo)) {
        questionNo = ans.questionNo;
      } else {
        questionNo = takeNextNumber();
      }

      const seen = (seenPerQuestion.get(questionNo) || 0) + 1;
      seenPerQuestion.set(questionNo, seen);

      const result = {
        ...ans,
        questionNo,
        question: `第${questionNo}题`,
        answerIndex: Number.isFinite(ans.answerIndex) && ans.answerIndex > 0 ? ans.answerIndex : seen
      };
      delete result.paperOrder;
      delete result.tieIndex;
      delete result.localIndex;
      return result;
    }).map((ans, idx) => ({ ...ans, paperSeq: idx }));
  }

  sortAndDeduplicateAnswers(answers, sourceMode = 'page1') {
    if (!answers || answers.length === 0) return answers;

    // 先剔除没有答案内容的条目：paper.xml 的题面、空的 knowledge 标签等
    // 之前它们会以空答案进入结果，既虚高了答案数，也让用户看到一堆空白项
    const meaningful = answers.filter(ans => {
      if (ans.isQuestionMeta) return false;
      const text = typeof ans.answer === 'string' ? ans.answer.trim() : ans.answer;
      return !!text && text !== '未找到答案';
    });
    const droppedEmpty = answers.length - meaningful.length;

    let sortedAnswers;

    if (sourceMode === 'page1' || sourceMode === 'mixed') {
      // 有 page1 数据时：保持原始顺序（pageConfig 的 slides 数组已有序）
      sortedAnswers = [...meaningful];
    } else if (meaningful.some(ans => Number.isFinite(ans.paperSeq) || Number.isFinite(ans.paperOrder))) {
      // 已按 paper.xml 的题目顺序排好，不要再按媒体索引打乱
      sortedAnswers = [...meaningful];
    } else {
      // 没有试卷顺序可用时：按媒体索引排序（T1, T2, T3...）
      sortedAnswers = [...meaningful].sort((a, b) => {
        const indexA = a.mediaIndex ?? Infinity;
        const indexB = b.mediaIndex ?? Infinity;
        return indexA - indexB;
      });
    }

    // 去重键带上 elementId / 题号 / 空序号：
    // 不同题目的相同短答案（两个空都填 "the"）不能被当成重复删掉
    const seen = new Set();
    const deduplicated = [];

    for (const ans of sortedAnswers) {
      const key = [
        ans.elementId || '',
        Number.isFinite(ans.questionNo) ? ans.questionNo : '',
        Number.isFinite(ans.answerIndex) ? ans.answerIndex : '',
        ans.questionText || '',
        ans.answer
      ].join('|');
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(ans);
      }
    }

    this.emitLog('info',
      `排序去重完成: 原始 ${answers.length} 条 -> 去重后 ${deduplicated.length} 条` +
      (droppedEmpty > 0 ? ` (剔除 ${droppedEmpty} 条空答案)` : '') +
      ` (来源: ${sourceMode})`);

    return deduplicated;
  }
}

module.exports = AnswerExtractor;
