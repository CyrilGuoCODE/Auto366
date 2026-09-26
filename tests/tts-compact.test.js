const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanAnswersForTts } = require('../modules/tts-clean');

test('compact keeps page1 speaking items that have no questionNo', () => {
  const answers = [
    {
      pattern: '朗读短文',
      answer: 'Archimedes was a famous scientist in ancient Greece. He solved the crown problem.',
      questionText: 'Archimedes was a famous scientist in ancient Greece. He solved the crown problem.',
      elementId: 'READ1',
      questionNo: null
    },
    {
      pattern: '听后回答',
      answer: '莱特兄弟的第一架飞机有名字吗？',
      questionText: '莱特兄弟的第一架飞机有名字吗？',
      elementId: 'ASK1',
      questionNo: null,
      children: ['Did the Wright brothers\' first plane have a name?', 'Why?']
    },
    {
      pattern: 'JSON句子跟读模式',
      answer: 'Archimedes was a famous scientist in ancient Greece.',
      questionText: '请朗读: Archimedes was a famous scientist in ancient Greece.',
      elementId: 'READ1',
      questionNo: 2,
      sourceFile: 'answer.json'
    }
  ];

  const cleaned = cleanAnswersForTts(answers, { compact: true });
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].meta.pattern, '朗读短文');
  assert.equal(cleaned[1].text, 'Did the Wright brothers\' first plane have a name?');
  assert.equal(cleaned[1].meta.question, '莱特兄弟的第一架飞机有名字吗？');
});
