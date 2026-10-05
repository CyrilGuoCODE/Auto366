const moduleLog = require('../../logging').create('答案');
const path = require('path');

module.exports = {
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
      moduleLog.error('JSON解析失败:', error);
      return [];
    }
  },

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
  },

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
  },

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
  },

cleanCdata(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  },

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
  },

readXmlTag(content, tagName, options = {}) {
    if (typeof content !== 'string') return null;
    const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = content.match(re);
    if (!match) return null;
    return options.raw ? match[1] : this.cleanCdata(match[1]);
  },

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
  },

extractFromXML(content, filePath) {
    const answers = [];

    try {
      // 只看文件名：解压目录名里若带 paper/answer 字样，用整路径判断会把每个 xml 都走错分支
      const fileName = path.basename(filePath).toLowerCase();

      if (fileName.includes('correctanswer')) {
        moduleLog.log('开始解析correctAnswer.xml文件');
        const elementMatches = this.matchXmlElements(content);
        moduleLog.log(`找到 ${elementMatches.length} 个element元素`);

        elementMatches.forEach((elementMatch, index) => {
          const elementId = elementMatch.id;
          const elementContent = elementMatch.inner;

          moduleLog.log(`处理correctAnswer element ${index + 1}, ID: "${elementId}" (长度: ${elementId.length})`);

          if (!elementContent.trim()) {
            moduleLog.log(`element ${elementId} 内容为空，跳过`);
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
            moduleLog.log(`element ${elementId} 没有找到有效的答案数据`);
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
          moduleLog.log(`添加答案项 (${allAnswers.length} 空):`, answerItem.answer);
        });
      }

      else if (fileName.includes('paper')) {
        moduleLog.log('开始解析paper.xml文件');
        const elementMatches = this.matchXmlElements(content);
        moduleLog.log(`找到 ${elementMatches.length} 个element元素`);

        let fallbackNo = 0;
        elementMatches.forEach((elementMatch) => {
          const elementId = elementMatch.id;
          const elementContent = elementMatch.inner;

          const questionNoText = this.readXmlTag(elementContent, 'question_no');
          const rawQuestionText = this.readXmlTag(elementContent, 'question_text');

          // question_text 缺失时也要留下题序信息，后面合并答案还要靠它排序
          if (rawQuestionText === null && questionNoText === null) {
            moduleLog.log(`跳过element ${elementId}: 既无题目编号也无题目文本`);
            return;
          }

          fallbackNo++;
          const parsedNo = questionNoText !== null ? parseInt(questionNoText.trim(), 10) : NaN;
          const questionNo = Number.isFinite(parsedNo) && parsedNo > 0 ? parsedNo : fallbackNo;

          let questionText = this.cleanHtmlText(rawQuestionText || '')
            .replace(/\{\{\d+\}\}/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          // 半句批改的 question_text 只有 {{n}}，问句在同题 directions。
          // 只在清掉空之后题干为空、且题型是 16 时采用，不覆盖完形和五选五。
          if (!questionText) {
            const questionType = parseInt(this.readXmlTag(elementContent, 'question_type') || '', 10);
            if (questionType === 16) {
              const directionsText = this.cleanHtmlText(this.readXmlTag(elementContent, 'directions') || '')
                .replace(/\{\{\d+\}\}/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              if (directionsText) questionText = directionsText;
            }
          }

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
              // 听读类题目（单词/语块/句子听读）：attachment 里通常没有 <answers>，
              // 要朗读的文本在 <text><paragraph><sentences><content> 中，
              // 不补上这段，这类卷子的答案会大面积缺失
              if (attachmentAnswers.length === 0) {
                attachmentAnswers = this.readXmlTagList(decodedAttachment, ['content']);
              }
            } catch (e) {
              moduleLog.log('解析attachment失败:', e);
            }
          }

          const optionMatches = [...elementContent.matchAll(/<option\b[^>]*\bid\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)];
          const options = optionMatches.map(optionMatch => {
            const raw = this.cleanCdata(optionMatch[2]);
            const imgMatch = raw.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
            return {
              id: optionMatch[1],
              text: this.cleanHtmlText(raw).trim(),
              // 结构图这类选项没有文字，只留 src。后面按文件名点选，不能把字母答案换成空文本
              image: imgMatch ? imgMatch[1] : ''
            };
          });

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
            const optionsText = options.map(opt => {
              const imageName = opt.image ? opt.image.split('/').pop().split('?')[0] : '';
              return `${opt.id}. ${opt.text || imageName}`;
            }).join('\n');
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
      moduleLog.error(`解析XML文件失败: ${filePath}`, error);
      return [];
    }
  }
};
