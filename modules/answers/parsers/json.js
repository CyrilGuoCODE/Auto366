const moduleLog = require('../../logging').create('答案');
module.exports = {
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
  },

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
  },

extractPartbAnswerJson(jsonData, mediaIndex) {
    const data = jsonData && jsonData.Data;
    if (!data || !Array.isArray(data.Answers)) return [];
    const looksLikePartb = jsonData.Type === 'partb'
      || jsonData.QuestionType === 'AnswerQuestion'
      || jsonData.QuestionType === 'AskQuestion'
      || typeof data.Question === 'string';
    if (!looksLikePartb) return [];

    const texts = [];
    const pushText = (raw) => {
      const speakable = this.expandAnswerTemplate(raw);
      if (speakable && speakable.length > 1) texts.push(speakable);
    };
    const items = data.Answers.filter(item => item && typeof item.text === 'string');
    for (const item of items) {
      if (item.rephrase === 1) continue;
      pushText(item.text);
    }
    if (texts.length === 0) items.forEach(item => pushText(item.text));
    if (texts.length === 0) return [];

    const unique = [];
    const seen = new Set();
    for (const itemText of texts) {
      const key = itemText.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(itemText);
    }

    let questionText = this.cleanHtmlText(data.Question || '') || '听后回答';
    if (/^(why|what|how|when|where)\?$/i.test(questionText) && unique.some(item => item.trim().endsWith('?'))) {
      questionText = unique.find(item => item.trim().endsWith('?')) || questionText;
    }
    return [{
      question: questionText,
      answer: questionText,
      content: '点击展开全部回答',
      questionText,
      pattern: '听后回答',
      mediaIndex: mediaIndex,
      children: unique.map((answer, index) => ({
        question: `第${index + 1}个答案`,
        answer,
        content: `请回答: ${answer}`,
        pattern: '听后回答'
      }))
    }];
  },

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

      const partbAnswers = this.extractPartbAnswerJson(jsonData, mediaIndex);
      if (partbAnswers.length > 0) answers.push(...partbAnswers);
    } catch (e) {
      return [];
    }
    return answers;
  },

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
      moduleLog.error('解析JSON内嵌XML响应失败:', e);
      return [];
    }
  }
};
