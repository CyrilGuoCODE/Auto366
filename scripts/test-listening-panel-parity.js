'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'rulesets', 'auto-listening', 'auto-listening.js'),
  'utf8',
);

assert.match(source, /function createUI\(mode\)/,
  '基础听力和听说必须共用一个可按模式切换的面板构造器');
assert.match(source, /createUI\(['"]speaking['"]\)/,
  '听说模式必须调用共享面板，不能再维护独立精简面板');
assert.match(source, /id="a366-dev-btn"/);
assert.match(source, /id="a366-score-btn"/);
assert.match(source, /id="a366-listentime-enable"/);
assert.doesNotMatch(source, /id="a366-spk-auto"/,
  '听说模式不能保留另一套按钮 ID 和独立控制台 UI');
assert.doesNotMatch(source, /id="a366-auto-btn"/,
  '主控制台只能保留一个自动听力按钮，不能与一键填答重复');
assert.match(source, /id="a366-auto-fill-all"[^>]*>自动听力<\/button>/,
  '原一键填答按钮必须改为统一的自动听力入口');
assert.match(source, /state\.uiMode\s*===\s*['"]speaking['"]/,
  '共享按钮必须按识别出的听力类型分派到对应执行器');

console.log('PASS listening panel parity: both listening types share the legacy full console');
