const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');

class AnswerExtractor {
  constructor() {
    this.cacheDir = path.join(os.homedir(), '.Auto366', 'cache');
    this.extractDir = path.join(this.cacheDir, 'extracted');
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

      // 生成唯一的提取目录
      const extractPath = path.join(this.extractDir, crypto.randomUUID());
      fs.mkdirSync(extractPath, { recursive: true });

      // 使用7zip或unzip解压
      const platform = os.platform();
      if (platform === 'win32') {
        // Windows使用PowerShell
        execSync(`Expand-Archive -Path "${zipPath}" -DestinationPath "${extractPath}"`, {
          shell: 'powershell.exe'
        });
      } else {
        // macOS和Linux使用unzip
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

      // 递归扫描提取目录
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
        // 递归扫描子目录
        await this.scanDirectory(filePath, answers, processedFiles);
      } else if (stat.isFile() && (file.endsWith('.json') || file.endsWith('.txt'))) {
        // 处理JSON或TXT文件
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
        // 处理JSON文件
        const data = JSON.parse(content);
        fileAnswers = this.extractFromJson(data, file);
      } else if (file.endsWith('.txt')) {
        // 处理TXT文件
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

    // 处理不同格式的JSON数据
    if (Array.isArray(data)) {
      // 直接是答案数组
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
      // 包含answers字段
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
      // 单个答案对象
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
        // 保存上一个答案
        if (currentQuestion && currentAnswer) {
          answers.push({
            question: currentQuestion,
            answer: currentAnswer,
            pattern: '未知题型',
            file
          });
        }

        // 开始新的题目
        currentQuestion = line.substring(3).trim();
        currentAnswer = '';
        inQuestion = true;
        inAnswer = false;
      } else if (line.startsWith('答案:')) {
        currentAnswer = line.substring(3).trim();
        inQuestion = false;
        inAnswer = true;
      } else if (inAnswer) {
        // 答案可能多行
        currentAnswer += ' ' + line;
      }
    });

    // 保存最后一个答案
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
        // 递归删除提取目录
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
}

module.exports = AnswerExtractor;
