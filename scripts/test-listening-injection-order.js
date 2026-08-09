'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const proxyPath = path.join(__dirname, '..', 'modules', 'proxy.js');
const proxySource = fs.readFileSync(proxyPath, 'utf8');
const method = proxySource.match(/\n  (injectScriptIntoHtml\([\s\S]*?)\n  repackZip\(/);
assert.ok(method, '无法从 modules/proxy.js 提取 injectScriptIntoHtml');

// 直接执行仓库里实际发布的方法，避免测试一份手抄实现。
const holder = Function('fs', `return ({${method[1]}});`)(fs);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a366-inject-'));
const htmlPath = path.join(dir, 'index.html');
const html = [
  '<!doctype html><html><body>',
  '<script>',
  "loadFile.load('./page1.js').load('../lib/jquery.recordwave.js').then(function(){});",
  '</script>',
  '</body></html>',
].join('\n');

try {
  fs.writeFileSync(htmlPath, html, 'utf8');
  holder.injectScriptIntoHtml(htmlPath, 'auto-listening.js');
  const out = fs.readFileSync(htmlPath, 'utf8');
  const injectedAt = out.indexOf('auto-listening.js');
  const recorderLoadAt = out.indexOf('loadFile.load(');
  assert.ok(injectedAt >= 0, '没有注入 auto-listening.js');
  assert.ok(
    injectedAt < recorderLoadAt,
    '自动听说必须在试卷加载录音依赖前接管 getUserMedia',
  );
  assert.match(
    out,
    /<script\s+src=["']\.\/auto-listening\.js["']><\/script>/i,
    '自动听说必须使用解析阻塞的直接 script 标签，不能异步 createElement',
  );
  console.log('PASS listening injection order: fake mic loads before recorder dependencies');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
