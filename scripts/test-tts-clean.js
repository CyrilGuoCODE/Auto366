'use strict';

const assert = require('assert');
const { cleanAnswersForTts } = require('../modules/tts-clean');

const original = 'This is the complete listening passage and it is intentionally much longer than the answer.';
const concise = 'I have got the key information. The activity is on April fifteenth and students can improve their cooking skills.';
const detailed = 'I have got the detailed information. The school will hold the activity on April fifteenth, all grades can join it, and the students will cook and sell several kinds of food before buying books.';

const cleaned = cleanAnswersForTts([{
    pattern: '听后转述',
    question: '第8题',
    questionText: '请根据听力内容进行转述',
    answer: [original, concise, detailed].join('\n'),
    questionNo: 8,
    paperSeq: 7,
}], { compact: true });

assert.strictEqual(cleaned.length, 1, '听后转述只能生成一条音频');
assert.strictEqual(cleaned[0].text, concise, '必须只取第二段简洁转述');
assert.ok(!cleaned[0].text.includes(original), '不能拼入原听力全文');
assert.ok(!cleaned[0].text.includes(detailed), '不能拼入复杂转述');

console.log('PASS retell cleaner: full + concise + detailed -> concise only');
