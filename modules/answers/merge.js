const moduleLog = require('../logging').create('答案');
module.exports = {
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
  },

mergeAnswerData(allAnswers) {
    try {
      const paperQuestions = allAnswers.filter(ans => ans.sourceFile === 'paper.xml');
      const correctAnswers = allAnswers.filter(ans => ans.sourceFile === 'correctAnswer.xml');
      // paper.xml 里没带答案的条目只是题面，不参与作答，但要留着做题序和题干来源
      const otherAnswers = allAnswers.filter(ans =>
        ans.sourceFile !== 'correctAnswer.xml' &&
        !(ans.sourceFile === 'paper.xml' && ans.isQuestionMeta)
      );
      // paper.xml 已从 attachment 提取到答案的题，同 elementId 的 answer.json
      // 是同一题的重复来源，去掉以免同一题出现两条、题号错位
      const paperAnswerElementIds = new Set(
        otherAnswers
          .filter(ans => ans.sourceFile === 'paper.xml')
          .map(ans => String(ans.elementId || '').toUpperCase())
      );
      const dedupedOthers = otherAnswers.filter(ans =>
        ans.sourceFile === 'paper.xml' ||
        !paperAnswerElementIds.has(String(ans.elementId || '').toUpperCase())
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
          moduleLog.log(`未找到匹配题目，保持原样: elementId="${correctAns.elementId}"`);
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
      const mergedOthers = dedupedOthers.map((ans, index) => {
        const matchingQuestion = lookupPaper(ans, null);
        return {
          ...ans,
          questionText: ans.questionText || (matchingQuestion ? matchingQuestion.questionText : ''),
          paperOrder: matchingQuestion ? matchingQuestion.order : Number.MAX_SAFE_INTEGER,
          tieIndex: index
        };
      });

      moduleLog.log(`合并完成: 成功合并 ${successfulMerges}/${correctAnswers.length} 个答案`);

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
      moduleLog.error('合并答案数据失败:', error);
      return allAnswers;
    }
  },

assignQuestionNumbers(answers) {
    if (!Array.isArray(answers) || answers.length === 0) return answers;

    const usedNumbers = new Set();
    for (const ans of answers) {
      if ((ans.sourceFile === 'correctAnswer.xml' || ans.sourceFile === 'paper.xml') &&
          Number.isFinite(ans.questionNo) && !usedNumbers.has(ans.questionNo)) {
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
      if ((ans.sourceFile === 'correctAnswer.xml' || ans.sourceFile === 'paper.xml') &&
          Number.isFinite(ans.questionNo)) {
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
  },

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
};
