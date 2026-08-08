/*
 * tts-clean.js —— TTS 预清洗
 *
 * 把答案提取器吐出来的原始条目，整理成「该念什么、按什么顺序念」。
 * 纯函数、无依赖，可离线跑测试。
 *
 * 之所以需要这一层，是因为原始答案有几处直接喂给 TTS 会念错：
 *   1. 听后回答的顶层 answer 存的是**问题**，真答案在 children 里
 *   2. 朗读文本带断句标记（// / 以及被转坏的全角逗号），念出来会多出停顿或杂音
 *   3. 听后转述的 answer 是三段拼在一起：听力原文 / 精简转述 / 完整转述
 *   4. page1.js 的扁平项与 questionData.js 的结构化项是同一批题的两种表示
 */

'use strict';

/* 不需要朗读的题型：选择题由规则集自己点选 */
const SILENT_PATTERNS = [/听后选择/, /^选择/, /单选/, /多选/, /判断/];

/* 无效占位答案 */
const PLACEHOLDER = ['参考', '略', '答案', '无', '待定'];

/* 备选答案至少要有几个词才算「完整句」。低于此数的多为短语碎片。 */
const MIN_WORDS_FOR_SENTENCE = 5;

// ---------------------------------------------------------------------------
// 文本清洗
// ---------------------------------------------------------------------------

/*
 * 断句标记说明：
 *   //  一级停顿，评分用，不该念
 *   /   二级停顿，同上
 *   ，  U+FF0C。英文朗读稿里出现的全角逗号，都是 // 在某一环节被转坏留下的，
 *       原位通常已经有半角逗号或句号，直接去掉即可
 *   　  U+3000 全角空格，来自 answer.json 的段首缩进
 */
function cleanText(raw) {
  if (raw == null) return '';
  let s = String(raw);

  s = s.replace(/[　﻿ ]/g, ' ');   // 全角空格 / BOM / 不换行空格
  s = s.replace(/，/g, ' ');                 // 断句用的全角逗号
  s = s.replace(/\/\//g, ' ');                   // 一级停顿
  s = s.replace(/(?<=\S)\/(?=\s|\S)/g, ' ');     // 二级停顿（词间单斜杠）
  s = s.replace(/[‘’]/g, "'");         // 弯撇号 → 直撇号
  s = s.replace(/[“”]/g, '"');
  s = s.replace(/[\r\n\t]+/g, ' ');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s+([,.;:!?])/g, '$1');         // 去掉标点前的空格
  s = s.replace(/([,.;:!?])(?=[A-Za-z])/g, '$1 ');
  return s.trim();
}

function wordCount(s) {
  const m = String(s).trim().match(/[A-Za-z0-9'’-]+/g);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------
// 备选答案挑选
// ---------------------------------------------------------------------------

/*
 * 听后回答给出多个等价答案，只念一个。
 *
 * 取「最短的完整句」：短语碎片（"Pop." "An umbrella."）关键词覆盖少，
 * 过长的又拖时间、增加语音识别出错的机会。用词数下限把碎片筛掉，
 * 再在剩下的里面取最短的。全是碎片时退回最长的那条。
 */
function pickAnswer(children) {
  const texts = (children || [])
    .map(c => (typeof c === 'string' ? c : (c && c.answer) || ''))
    .map(t => cleanText(t))
    .filter(t => t && !isPlaceholder(t));

  if (!texts.length) return '';

  const full = texts.filter(t => wordCount(t) >= MIN_WORDS_FOR_SENTENCE);
  if (full.length) {
    return full.reduce((a, b) => (b.length < a.length ? b : a));
  }
  return texts.reduce((a, b) => (b.length > a.length ? b : a));
}

/*
 * 听后转述的 answer 由换行分成三段：
 *   段1 听力原文（是放给学生听的，不该念）
 *   段2 精简转述范例  ← 念这段
 *   段3 完整转述范例（基本是原文加个开头，太长）
 * 只有一段时说明格式变了，原样返回。
 */
function pickRetell(answer) {
  const parts = String(answer || '')
    .split(/\r?\n/)
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return parts[0] || '';
}

function isPlaceholder(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return PLACEHOLDER.indexOf(t) >= 0;
}

function isSilent(pattern) {
  const p = String(pattern || '');
  return SILENT_PATTERNS.some(re => re.test(p));
}

// ---------------------------------------------------------------------------
// 取出单条要朗读的文本
// ---------------------------------------------------------------------------

function textOf(item) {
  if (!item) return '';

  /* children 里才是真答案，顶层 answer 是问题 */
  if (Array.isArray(item.children) && item.children.length) {
    return pickAnswer(item.children);
  }

  const pattern = String(item.pattern || '');
  if (/转述|复述/.test(pattern)) {
    return cleanText(pickRetell(item.answer));
  }

  return cleanText(item.answer || item.content || item.text || '');
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/*
 * 页面上显示的题面文本。规则集拿它把页面元素跟队列里的条目对上号：
 * 朗读类题目页面显示的就是要念的内容，听后回答页面显示的是问题
 * （也就是条目的顶层 answer，真答案在 children 里）。
 */
function questionOf(item) {
  if (Array.isArray(item.children) && item.children.length) {
    return cleanText(item.answer || item.questionText || '');
  }
  return cleanText(item.questionText || item.question || '');
}

function metaOf(item, origIndex) {
  return {
    origIndex,
    question: questionOf(item),
    questionNo: item.questionNo != null ? item.questionNo : null,
    paperSeq: item.paperSeq != null ? item.paperSeq : null,
    pattern: item.pattern || '',
    mediaIndex: item.mediaIndex != null ? item.mediaIndex : null,
    elementId: item.elementId || null,
    sourceFile: item.sourceFile || null,
    choices: Array.isArray(item.children) ? item.children.length : 0,
  };
}

/*
 * answers      答案提取器的输出数组
 * opts.compact 是否压缩队列：过滤选择题、去重、按卷面顺序重排（默认 false）
 *
 * compact 默认关闭是有原因的：作业跟读那条链路里，页面按 {answerIndex}.wav 取音频，
 * answerIndex 就是答案在原数组中的下标。一旦删条目或重排，序号就对不上了。
 * 听说这条链路按 meta.questionNo / elementId 定位题目，不依赖下标，才可以开。
 *
 * 无论是否 compact，文本清洗、children 取答案、转述取段都会执行 ——
 * 这三项只改内容不改条数，对哪条链路都是纯修正。
 *
 * 返回 [{ index, text, meta }]，index 从 1 起，对应 TTS 输出的 {index}.wav；
 * meta.origIndex 是它在入参数组中的原始下标，用于反查。
 */
function cleanAnswersForTts(answers, opts) {
  opts = opts || {};
  if (!Array.isArray(answers)) return [];

  let pool = answers.map((a, i) => ({ item: a, origIndex: i })).filter(x => x.item);

  if (opts.compact) {
    pool = pool.filter(x => !isSilent(x.item.pattern));

    /*
     * page1.js 把每道口语题的全部备选答案摊平成独立条目，
     * questionData.js / answer.json 则给出带题号和 children 的结构化条目。
     * 两者内容重叠。只要有结构化条目，就以它为准 —— 它带题号、顺序和 elementId，
     * 是后续定位页面元素的唯一依据。
     */
    const structured = pool.filter(x => x.item.questionNo != null);
    if (structured.length) pool = structured;
  }

  const out = [];
  const seen = new Set();

  for (const { item, origIndex } of pool) {
    const text = textOf(item);

    if (opts.compact) {
      if (!text || isPlaceholder(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }

    out.push({ text, meta: metaOf(item, origIndex) });
  }

  /* 按卷面顺序排，没有顺序信息的保持原有相对次序 */
  if (opts.compact) {
    out.sort((a, b) => {
      const sa = a.meta.paperSeq, sb = b.meta.paperSeq;
      if (sa != null && sb != null && sa !== sb) return sa - sb;
      const qa = a.meta.questionNo, qb = b.meta.questionNo;
      if (qa != null && qb != null && qa !== qb) return qa - qb;
      return a.meta.origIndex - b.meta.origIndex;
    });
  }

  out.forEach((it, i) => { it.index = i + 1; });
  return out;
}

module.exports = {
  cleanAnswersForTts,
  cleanText,
  questionOf,
  pickAnswer,
  pickRetell,
  isSilent,
  isPlaceholder,
  wordCount,
};
