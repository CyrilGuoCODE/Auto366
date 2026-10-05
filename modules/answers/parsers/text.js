const moduleLog = require('../../logging').create('答案');
module.exports = {
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
  },

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
  },

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
  },

expandAnswerTemplate(text) {
    if (!text) return '';
    let s = String(text);
    for (let i = 0; i < 4; i++) {
      const next = s.replace(/[\[{]([^\[\]{}]*)[\]}]/g, (_, inner) => {
        const parts = inner.split('/').map(part => part.trim()).filter(Boolean);
        return parts[0] || '';
      });
      if (next === s) break;
      s = next;
    }
    return this.cleanHtmlText(s);
  },

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
      moduleLog.error(`解析文本文件失败: ${filePath}`, error);
      return [];
    }
  }
};
