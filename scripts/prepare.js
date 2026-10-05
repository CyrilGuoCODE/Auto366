const moduleLog = require('../modules/logging').create('准备');
require('../modules/app/process-text').ensureConsoleUtf8();
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build');
fs.mkdirSync(out, { recursive: true });
// A tiny deterministic bundle: preload has two source files and no external dependencies.
const bridge = fs.readFileSync(path.join(root, 'preload/bridge.js'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'preload/index.js'), 'utf8')
  .replace("require('./bridge')", '__bridge');
fs.writeFileSync(path.join(out, 'preload.js'), `const __bridge = (() => { const module = { exports: {} };\n${bridge}\nreturn module.exports; })();\n${entry}`);
// Rulesets are intentionally neither rewritten nor copied by this refactor.
for (const file of ['rulesets/auto-boat/auto-boat.zip', 'resources/init.mp3']) {
  if (!fs.existsSync(path.join(root, file))) moduleLog.warn(`[准备] 缺少可选功能所需资源: ${file}`);
}
moduleLog.log('Preload 已准备；规则集保持原样。');
