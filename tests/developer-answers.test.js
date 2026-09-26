const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

const ruleset = fs.readFileSync(path.join(__dirname, '../rulesets/auto-listening/auto-listening.js'), 'utf8');
const prelude = extractFunction(ruleset, 'isChoiceAnswer') + '\n' +
  'const SPEAKING_QUESTION_TYPES = new Set([9, 12, 13]);\n' +
  'const SPEAKING_QTYPE_IDS = new Set([149, 237, 449, 529, 531, 554]);\n' +
  extractFunction(ruleset, 'isSpeakingPaper');
const fns = new Function(prelude + '\nreturn { isChoiceAnswer, isSpeakingPaper };')();

function loadAnswers(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).answers;
}

const samples = [
  '/home/user/uploads/answers_1790337087920.json',
  '/home/user/uploads/answers_1790337071863.json'
].filter(file => fs.existsSync(file));

test('questionData extracts without questionType still enter speaking mode', () => {
  const fixture = [
    { pattern: '听后选择', questionText: '<p>What is the girl worried about?</p>', answer: 'B. Her schoolwork.' },
    { pattern: '听后回答', answer: '<p>What does the man suggest?</p>', children: [{ answer: 'Bread and yogurt.' }] },
    { pattern: '听后转述', questionText: '请根据听力内容进行转述', answer: 'Hello, everyone. I want to tell you about Beijing Hutongs.' },
    { pattern: 'JSON句子跟读模式', answer: 'Beijing Hutongs are old lanes.' }
  ];
  assert.equal(fns.isSpeakingPaper(fixture), true);
  assert.equal(fixture.filter(fns.isChoiceAnswer).length, 1);

  for (const file of samples) {
    const answers = loadAnswers(file);
    assert.equal(answers.some(a => a.questionType != null), false, file);
    assert.equal(fns.isSpeakingPaper(answers), true, file);
    assert.equal(answers.filter(fns.isChoiceAnswer).length, 6, file);
  }
});

test('numbered choices alone stay on the listening panel', () => {
  assert.equal(fns.isSpeakingPaper([
    { pattern: '听后选择', questionType: 1 },
    { pattern: '听后回答' }
  ]), false);
  assert.equal(fns.isSpeakingPaper([
    { pattern: '朗读短文', questionType: 9 }
  ]), true);
});
