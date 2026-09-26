const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AnswerExtractor = require('../modules/answer');
const CryptoManager = require('../modules/crypto');

function encryptEncr(text, header) {
  const payload = Buffer.from(text, 'utf-8');
  const key = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i % 8];
  return Buffer.concat([
    Buffer.from('encr'),
    Buffer.from(header || [0xa7, 0x67, 0x00, 0x00]),
    out
  ]);
}

test('decryptEncr ignores the varying 4-byte header and rejects plaintext', () => {
  const crypto = new CryptoManager();
  const body = '{"ok":true}';
  assert.equal(crypto.decryptEncr(encryptEncr(body, [0xa7, 0x67, 0x00, 0x00])), body);
  assert.equal(crypto.decryptEncr(encryptEncr(body, [0x27, 0x2b, 0x00, 0x00])), body);
  assert.equal(crypto.decryptEncr(Buffer.from(body)), null);
});

test('page1 nested record_speak becomes 听后回答 with the real stem', () => {
  const extractor = new AnswerExtractor();
  const answers = extractor.extractFromPage1({
    slides: [{
      questionList: [{
        qtype_id: 529,
        question_type: 99,
        question_id: 'PARENT',
        question_text: '<p>section</p>',
        questions_list: [{
          qtype_id: 529,
          question_type: 12,
          question_id: 'C34F0AA845369C8B168F44F5A526A69F',
          question_text: '<p>Who are the smart glasses made for?(They are made for people who cannot see things.)</p>',
          record_speak: [
            { work: '1', show: '1', fake: '0', content: 'They are made for people who cannot see things.' },
            { work: '1', show: '0', fake: '1', content: 'They are made for people who design street signs.' }
          ]
        }]
      }]
    }]
  });
  const spoken = answers.filter(item => item.pattern === '听后回答');
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].questionText, 'Who are the smart glasses made for?');
  assert.equal(spoken[0].answer, spoken[0].questionText);
  assert.deepEqual(spoken[0].children.map(child => child.answer), [
    'They are made for people who cannot see things.'
  ]);
  assert.equal(spoken[0].elementId, 'C34F0AA845369C8B168F44F5A526A69F');
  assert.equal(spoken[0].questionType, 12);
  assert.equal(spoken[0].qtypeId, 529);
});

test('reading without analysis and retell model paragraph are extracted', () => {
  const extractor = new AnswerExtractor();
  const answers = extractor.extractFromPage1({
    slides: [{
      questionList: [
        {
          qtype_id: 449,
          question_type: 9,
          question_id: 'READ1',
          question_text: '<p>Archimedes was a famous scientist.</p>',
          analysis: ''
        },
        {
          qtype_id: 554,
          question_type: 13,
          question_id: 'RETELL1',
          question_text: '请复述',
          analysis: '<p>听力原文：should not be spoken</p>',
          record_speak: [{
            content: 'Short model answer that is long enough to be a retell paragraph for the speaking task.\nA much longer model answer that should not be preferred because it takes more time to speak and adds recognition risk for the student.'
          }]
        }
      ]
    }]
  });
  const reading = answers.find(item => item.pattern === '朗读短文');
  const retell = answers.find(item => item.pattern === '故事复述');
  assert.equal(reading.answer, 'Archimedes was a famous scientist.');
  assert.equal(reading.questionType, 9);
  assert.equal(reading.qtypeId, 449);
  assert.match(retell.answer, /^Short model answer/);
  assert.equal(retell.questionType, 13);
  assert.equal(retell.qtypeId, 554);
  assert.equal(retell.answer.includes('听力原文'), false);
});

test('encrypted partb answer.json is readable and does not break plaintext sentences', () => {
  const extractor = new AnswerExtractor();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'listen-'));
  const encrypted = path.join(dir, 'answer.json');
  fs.writeFileSync(encrypted, encryptEncr(JSON.stringify({
    Type: 'partb',
    QuestionType: 'AnswerQuestion',
    Data: {
      Question: 'Where can people see models of great inventions?',
      Answers: [
        { text: 'people can see them on the third floor.', rephrase: 0 },
        { text: 'on the third floor {of the museum/of the science museum}.', rephrase: 2 },
        { text: 'people human folk person crowd', rephrase: 1 }
      ]
    }
  })));
  const spoken = extractor.extractAnswersFromFile(encrypted);
  assert.equal(spoken[0].pattern, '听后回答');
  assert.equal(spoken[0].questionText, 'Where can people see models of great inventions?');
  assert.equal(spoken[0].children.some(child => child.answer.includes('{') || child.answer.includes('folk')), false);
  assert.ok(spoken[0].children.some(child => child.answer === 'on the third floor of the museum.'));

  const plain = path.join(dir, 'sentences.json');
  fs.writeFileSync(plain, JSON.stringify({
    Data: { sentences: [{ text: 'Ada Lovelace wrote the first program.' }] }
  }));
  const sentences = extractor.extractAnswersFromFile(plain);
  assert.equal(sentences[0].pattern, 'JSON句子跟读模式');
});
