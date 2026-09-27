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

const ruleset = fs.readFileSync(path.join(__dirname, '../rulesets/auto-fill/auto-fill.js'), 'utf8');
const fns = new Function(
  extractFunction(ruleset, 'optionImageName') + '\n' +
  extractFunction(ruleset, 'splitChoiceLetters') + '\n' +
  extractFunction(ruleset, 'pickImageLetterIndex') + '\n' +
  'return { optionImageName, splitChoiceLetters, pickImageLetterIndex };'
)();

function option(imageName, letterLabel) {
  return {
    imageName,
    letterLabel,
    element: { classList: { contains: () => false } }
  };
}

test('image option filename ignores the literal null folder', () => {
  const src = '/872B7CE00B69AE0B502E8687064DDB5D/null/1_index_html_99e366e9.png';
  assert.equal(fns.optionImageName(src), '1_index_html_99e366e9.png');
  assert.equal(fns.optionImageName('https://cdn.example/a%2Fb.png?x=1'), 'a/b.png'.split('/').pop());
});

test('single letters and pure letter runs split, words with other letters do not', () => {
  assert.deepEqual(fns.splitChoiceLetters('B'), ['B']);
  assert.deepEqual(fns.splitChoiceLetters('acd'), ['A', 'C', 'D']);
  assert.deepEqual(fns.splitChoiceLetters('largest'), []);
  assert.deepEqual(fns.splitChoiceLetters('face'), ['F', 'A', 'C', 'E']);
});

test('picture option is chosen by filename, not by the first empty text', () => {
  const optionsData = [
    option('0_index_html_475796ef.png', 'A'),
    option('1_index_html_99e366e9.png', 'B'),
    option('2_index_html_ef4f76d5.png', 'C'),
    option('3_index_html_874ba0dd.png', 'D')
  ];
  const bank = [
    { id: 'A', text: '', image: '/872B7CE00B69AE0B502E8687064DDB5D/null/0_index_html_475796ef.png' },
    { id: 'B', text: '', image: '/872B7CE00B69AE0B502E8687064DDB5D/null/1_index_html_99e366e9.png' },
    { id: 'C', text: '', image: '/872B7CE00B69AE0B502E8687064DDB5D/null/2_index_html_ef4f76d5.png' },
    { id: 'D', text: '', image: '/872B7CE00B69AE0B502E8687064DDB5D/null/3_index_html_874ba0dd.png' }
  ];
  assert.equal(fns.pickImageLetterIndex('B', optionsData, bank), 1);
});

test('picture option falls back to letter order when the page src has no filename', () => {
  const optionsData = [
    option('', 'A'),
    option('', 'B'),
    option('', 'C'),
    option('', 'D')
  ];
  assert.equal(fns.pickImageLetterIndex('B', optionsData, null), 1);
});
