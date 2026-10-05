const { fork } = require('child_process');
const path = require('path');
const { LIMITS, validate } = require('./policy');
let active = 0;
module.exports = function execute(pair, sample) {
  validate(pair);
  if (Buffer.byteLength(JSON.stringify(sample)) > LIMITS.input * 2) return Promise.reject(new Error('样本过大'));
  if (active >= 2) return Promise.reject(Object.assign(new Error('规则执行繁忙，请稍后重试'), { code: 'BUSY' }));
  active++;
  return new Promise((resolve, reject) => {
    let child, timer, settled = false, ready = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active--;
      if (child) child.kill();
      error ? reject(error) : resolve(result);
    };
    try {
      child = fork(path.join(__dirname, 'worker.js'), [], {
        execArgv: ['--max-old-space-size=64'], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: process.env.SystemRoot || '', TEMP: process.env.TEMP || '' }
      });
      timer = setTimeout(() => finish(new Error('规则进程启动超时')), 5000);
      child.on('message', result => {
        if (result.ready) {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => finish(Object.assign(new Error('规则执行超时，已终止'), { code: 'POLICY_TIMEOUT' })), 300);
          child.send({ pair, sample }, error => { if (error) finish(error); });
        } else if (result.success) finish(null, result);
        else finish(Object.assign(new Error(result.error || '规则执行失败'), { code: 'POLICY_INVALID' }));
      });
      child.once('error', finish);
      child.once('exit', () => finish(Object.assign(new Error('规则进程意外退出'), { code: ready ? 'POLICY_INVALID' : 'WORKER_START_FAILED' })));
    } catch (error) { finish(error); }
  });
};
