'use strict';

const assert = require('assert');
const path = require('path');
const Module = require('module');

// 源码目录不保存 node_modules；复用可运行测试副本的依赖。
process.env.NODE_PATH = path.join('C:\\Project', 'Auto366-main for test', 'node_modules');
Module._initPaths();

const TtsManager = require('../modules/tts');

async function main() {
  const createManager = () => {
    const manager = new TtsManager();
    manager._log = () => {};
    let generated = null;
    manager.generateForApprovedTexts = async (texts, basePath) => {
      generated = { texts, basePath };
    };
    return { manager, getGenerated: () => generated };
  };

  const approvalOn = createManager();
  approvalOn.manager.queueForApproval([
    { pattern: '短文朗读', answer: 'Hello everyone. Welcome to our school.' },
  ], '/listening-tts', '口语朗读TTS', { compact: true, autoApprove: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(approvalOn.getGenerated(), null, '审批设置默认开启时必须等待用户确认');
  assert.strictEqual(approvalOn.manager.pendingApprovalQueue.length, 1, '等待审批时必须保留清洗后的队列');

  const approvalOff = createManager();
  approvalOff.manager.config.approvalEnabled = false;
  approvalOff.manager.queueForApproval([
    { pattern: '短文朗读', answer: 'Hello everyone. Welcome to our school.' },
  ], '/listening-tts', '口语朗读TTS', { compact: true, autoApprove: true });
  await new Promise(resolve => setImmediate(resolve));
  const generated = approvalOff.getGenerated();
  assert.ok(generated, '关闭审批后自动听说必须立即启动 TTS');
  assert.strictEqual(generated.basePath, '/listening-tts');
  assert.deepStrictEqual(generated.texts, ['Hello everyone. Welcome to our school.']);
  console.log('PASS listening TTS approval setting: on waits for approval, off starts automatically');
}

main().catch(error => {
  console.error('FAIL listening auto TTS:', error.message);
  process.exitCode = 1;
});
