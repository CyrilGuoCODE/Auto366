const moduleLog = require('../../logging').create('答案');
const fs = require('fs-extra');
const path = require('path');

module.exports = {
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
      moduleLog.error(`搜索 u3enc 文件失败: ${dirPath}`, error);
    }
    return results;
  },

processU3encFiles(dirPath) {
    const page1JsFiles = this.findPage1JsFiles(dirPath);
    const u3encFiles = this.findU3encFiles(dirPath);

    const jsDirs = new Set(page1JsFiles.map(f => path.dirname(f)));
    const filteredU3encFiles = u3encFiles.filter(f => !jsDirs.has(path.dirname(f)));

    let answers = [];

    if (page1JsFiles.length === 0 && filteredU3encFiles.length === 0) return answers;

    for (const jsFile of page1JsFiles) {
      moduleLog.log(`处理 page1.js 文件: ${jsFile}`);
      try {
        const content = fs.readFileSync(jsFile, 'utf-8');
        const jsonStr = this.extractJsonFromPageConfig(content);

        if (jsonStr) {
          const pageConfig = JSON.parse(jsonStr);
          const fileAnswers = this.extractFromPage1(pageConfig);
          answers = answers.concat(fileAnswers);
          moduleLog.log(`从 ${path.basename(path.dirname(jsFile))}/page1.js(已解密) 提取到 ${fileAnswers.length} 个答案`);
        }
      } catch (error) {
        moduleLog.error(`解析 page1.js 失败 (${jsFile}):`, error);
      }
    }

    if (filteredU3encFiles.length > 0) {
      moduleLog.log(`找到 ${filteredU3encFiles.length} 个 page1.js.u3enc 文件`);

      for (const u3encFile of filteredU3encFiles) {
        moduleLog.log(`处理 page1.js.u3enc 文件: ${u3encFile}`);
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
              moduleLog.log(`从 ${path.basename(path.dirname(u3encFile))}/page1.js 提取到 ${fileAnswers.length} 个答案`);
            }
          } else {
            moduleLog.log(`解密 page1.js.u3enc 失败: ${u3encFile}`);
          }
        } catch (error) {
          moduleLog.error(`解析 page1.js.u3enc 失败 (${u3encFile}):`, error);
        }
      }
    }

    return answers;
  },

findXmlAnswerU3encFiles(dirPath) {
    const targets = ['correctanswer.xml.u3enc', 'paper.xml.u3enc'];
    const results = [];
    try {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          results.push(...this.findXmlAnswerU3encFiles(itemPath));
        } else if (targets.includes(item.toLowerCase())) {
          results.push(itemPath);
        }
      }
    } catch (error) {
      moduleLog.error(`搜索 XML u3enc 文件失败: ${dirPath}`, error);
    }
    return results;
  },

processXmlU3encFiles(dirPath) {
    const u3encFiles = this.findXmlAnswerU3encFiles(dirPath);
    const allAnswers = [];
    const processedFiles = [];
    const allFilesContent = [];

    for (const u3encFile of u3encFiles) {
      const baseName = path.basename(u3encFile).replace(/\.u3enc$/i, '');
      const dirName = path.dirname(u3encFile);
      const relativePath = path.relative(dirPath, u3encFile);

      // 同目录已存在解密版本时跳过，避免重复处理
      if (fs.existsSync(path.join(dirName, baseName))) {
        moduleLog.log(`同目录已存在 ${baseName}，跳过 ${path.basename(u3encFile)}`);
        continue;
      }

      moduleLog.log(`处理 ${path.basename(u3encFile)} 文件`);
      try {
        const encryptedData = fs.readFileSync(u3encFile);
        const decryptedData = this.cryptoManager.decryptU3enc(encryptedData);
        if (!decryptedData) {
          moduleLog.log(`解密 ${path.basename(u3encFile)} 失败`);
          processedFiles.push({ file: relativePath, answerCount: 0, success: false, error: '解密失败' });
          this.emitLog('error', `${path.basename(u3encFile)}: 解密失败`);
          continue;
        }
        const content = decryptedData.toString('utf-8');
        allFilesContent.push({ file: relativePath, content });

        // 复用 extractFromXML，传入模拟文件名以触发 correctAnswer/paper 分支
        const answers = this.extractFromXML(content, baseName);
        const elementId = this.elementIdFromRelativePath(relativePath);
        answers.forEach((ans, idx) => {
          ans.sourceFile = baseName;
          if (!ans.elementId && elementId) ans.elementId = elementId;
          if (!Number.isFinite(ans.localIndex)) ans.localIndex = idx;
        });
        allAnswers.push(...answers);
        processedFiles.push({ file: relativePath, answerCount: answers.length, success: true });
        moduleLog.log(`从 ${path.basename(u3encFile)} 解密提取到 ${answers.length} 个答案`);
        this.emitLog('success', `${path.basename(u3encFile)}: 解密提取 ${answers.length} 个答案`);
      } catch (error) {
        moduleLog.error(`解析 ${path.basename(u3encFile)} 失败:`, error);
        processedFiles.push({ file: relativePath, answerCount: 0, success: false, error: error.message });
        this.emitLog('error', `${path.basename(u3encFile)}: 提取失败 - ${error.message}`);
      }
    }

    return { allAnswers, processedFiles, allFilesContent };
  }
};
