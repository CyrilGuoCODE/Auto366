'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'tts.js'), 'utf8');
const match = source.match(/\n  (handleTtsManifestRequest\([\s\S]*?)\n  async _pushConfigToRenderer\(/);
assert.ok(match, '无法从 modules/tts.js 提取 handleTtsManifestRequest');

// 直接执行仓库中发布的方法；不要求源码目录安装 Electron 依赖。
const method = Function(`return ({${match[1]}});`)().handleTtsManifestRequest;
const manager = {
  isGenerating: true,
  fileIndex: new Map([[3, '3.wav'], [1, '1.wav']]),
  pendingApprovalQueue: [],
  config: { approvalEnabled: true },
  manifest: [
    { index: 1, text: 'first' },
    { index: 2, text: 'second' },
    { index: 3, text: 'third' },
  ],
  _matchTtsPath(pathname, suffix) {
    return pathname === '/listening-tts' + suffix ? '/listening-tts' : null;
  },
};
let status = 0;
let body = '';
const response = {
  writeHead(code) { status = code; },
  end(value) { body = value; },
};

assert.strictEqual(method.call(manager, '/listening-tts/list', response), true);
assert.strictEqual(status, 200);
const data = JSON.parse(body);
assert.strictEqual(data.ready, false, '整批仍在生成时全局 ready 应保持 false');
assert.strictEqual(data.partialReady, true, '已有单题落盘时必须报告部分就绪');
assert.strictEqual(data.generatedCount, 2);
assert.deepStrictEqual(data.readyIndexes, [1, 3], '必须精确暴露已经落盘的题号');
assert.strictEqual(data.items.length, 3, '生成期间仍必须返回完整题目映射');

manager.isGenerating = false;
manager.fileIndex = new Map();
manager.pendingApprovalQueue = [{ index: 1, edited: 'first' }];
body = '';
assert.strictEqual(method.call(manager, '/listening-tts/list', response), true);
const pending = JSON.parse(body);
assert.strictEqual(pending.approvalPending, true, '有清单但尚未确认生成时必须明确报告等待审批');
console.log('PASS TTS manifest progress: partial files are exposed while batch is generating');
