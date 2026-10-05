const moduleLog = require('../../logging').create('答案');
module.exports = {
extractJsonFromPageConfig(content) {
    const match = content.match(/var\s+pageConfig\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (match && match[1]) return match[1];

    const startIndex = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (startIndex !== -1 && lastBrace !== -1 && lastBrace > startIndex) {
      return content.substring(startIndex, lastBrace + 1);
    }
    return null;
  },

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
          if (qtypeId === this.constructor.QTYPE_SPEAKING && question.record_speak && question.record_speak.length > 0) {
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
                  questionType: Number(question.question_type) || undefined,
                  qtypeId: this.constructor.QTYPE_SPEAKING,
                  mediaIndex: this.extractMediaIndexFromContent(question.media?.file || '')
                });
              }
            }
          }

          // 口语问答题（qtype_id = 531）
          if (qtypeId === this.constructor.QTYPE_ORAL_QUESTION && question.record_speak && question.record_speak.length > 0) {
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
                questionType: Number(question.question_type) || undefined,
                qtypeId: this.constructor.QTYPE_ORAL_QUESTION,
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

          // 朗读题。analysis 为空时题面在 question_text（本套卷模仿朗读就是这样）。
          if (qtypeId === this.constructor.QTYPE_READING) {
            const analysisText = this.cleanHtmlText(question.analysis || '').trim()
              || this.cleanHtmlText(question.question_text || '').trim();
            if (analysisText) {
              answers.push({
                question: '朗读短文',
                answer: analysisText,
                content: `请朗读: ${analysisText}`,
                questionText: analysisText,
                pattern: '朗读短文',
                questionType: Number(question.question_type) || 9,
                qtypeId: this.constructor.QTYPE_READING,
                mediaIndex: this.extractMediaIndexFromContent(question.media?.file || ''),
                elementId: question.question_id || undefined
              });
            }
          }

          // 故事复述题。record_speak 里是几段范文（work/show 为空，不能走口语筛选项）。
          // analysis 常把听力原文和参考答案拼在一起，优先用范文里最短的一段。
          if (qtypeId === this.constructor.QTYPE_RETELL) {
            const paragraphs = [];
            for (const item of question.record_speak || []) {
              for (const part of String(item.content || '').split(/\n+/)) {
                const cleaned = this.cleanHtmlText(part);
                if (cleaned.length >= 80) paragraphs.push(cleaned);
              }
            }
            let answerText = paragraphs.length
              ? paragraphs.reduce((a, b) => (b.length < a.length ? b : a))
              : '';
            if (!answerText && question.analysis && question.analysis.trim()) {
              let analysisText = question.analysis
                .replace(/<p[^>]*>答案[一二三四五六七八九十]+：<\/p>/g, '')
                .replace(/<[^>]+>/g, '')
                .trim();
              analysisText = analysisText.replace(/\s+/g, ' ').trim();
              answerText = (analysisText.split(/\s*答案[一二三四五六七八九十]+：\s*/)[0] || analysisText).trim();
            }
            if (answerText) {
              const questionText = this.cleanHtmlText(question.question_text || '故事复述');
              answers.push({
                question: questionText,
                answer: answerText,
                content: `请复述: ${answerText.substring(0, 100)}`,
                questionText: questionText,
                pattern: '故事复述',
                questionType: Number(question.question_type) || 13,
                qtypeId: this.constructor.QTYPE_RETELL,
                mediaIndex: this.extractMediaIndexFromContent(question.media?.file || ''),
                elementId: question.question_id || undefined
              });
            }
          }

          answers.push(...this.extractNestedSpeakAnswers(question));

          // 听力填空题
          if (qtypeId === this.constructor.QTYPE_FILL_BLANK) {
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

      moduleLog.log(`从 pageConfig 提取到 ${answers.length} 个答案`);
      return answers;
    } catch (error) {
      moduleLog.error('从 pageConfig 提取答案失败:', error);
      return [];
    }
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
            questionType: Number(question.question_type) || undefined,
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
        questionType: Number(questionObj.question_type) || undefined,
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
  },

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
          questionType: Number(questionObj.question_type) || 13,
          mediaIndex: mediaIndex
        });
      }
    }
    return results;
  },

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
          questionType: Number(questionObj.question_type) || undefined,
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
  },

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
  },

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
      moduleLog.error(error)
      return [];
    }
  },

extractNestedSpeakAnswers(question) {
    const results = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Number(node.question_type) === 12 && Array.isArray(node.record_speak)) {
        const usable = node.record_speak.filter(item => String(item.fake) !== '1');
        const answers = this.pickSpeakAnswers(usable);
        if (answers.length > 0) {
          let questionText = this.cleanHtmlText(node.question_text || '');
          const cut = questionText.search(/[（(]/);
          if (cut > 8 && questionText.slice(0, cut).trim().endsWith('?')) {
            questionText = questionText.slice(0, cut).trim();
          }
          if (!questionText) questionText = '听后回答';
          const elementId = String(node.question_id || node.element_id || '').toUpperCase();
          results.push({
            question: questionText,
            answer: questionText,
            content: '点击展开全部回答',
            questionText,
            pattern: '听后回答',
            questionType: Number(node.question_type) || 12,
            qtypeId: Number(node.qtype_id) || undefined,
            mediaIndex: this.extractMediaIndexFromContent(node.media?.file || question.media?.file || ''),
            elementId: elementId || undefined,
            children: answers.map((answer, index) => ({
              question: `第${index + 1}个答案`,
              answer,
              content: `请回答: ${answer}`,
              pattern: '听后回答'
            }))
          });
        }
      }
      for (const child of node.questions_list || []) visit(child);
    };
    visit(question);
    return results;
  },

extractFromJS(content, filePath) {
    try {
      let jsonData;
      try {
        jsonData = JSON.parse(content);
      } catch (e) {
        moduleLog.log('无法解析JS文件，可能该文件为不支持的格式');
        return [];
      }

      const mediaIndex = this.extractMediaIndexFromContent(content);
      return this.parseQuestionFile(jsonData, mediaIndex);
    } catch (error) {
      moduleLog.error(`解析JS文件失败: ${filePath}`, error);
      return [];
    }
  }
};
