// OS command execution and output encoding only; no business process or service configuration.
const cp = require('child_process');
const { StringDecoder } = require('string_decoder');

const PS_UTF8 = "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ";
let consoleReady = false;
function ensureConsoleUtf8() {
  if (consoleReady) return;
  consoleReady = true;
  process.stdout.setDefaultEncoding?.('utf8');
  process.stderr.setDefaultEncoding?.('utf8');
  if (process.platform === 'win32') {
    try { cp.execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'chcp 65001 >nul'], { windowsHide: true, stdio: 'ignore', timeout: 3000 }); }
    catch { /* A packaged GUI may not have an attached console. UTF-8 file output still works. */ }
  }
}
function powershellArgs(script) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS_UTF8 + script, 'utf16le').toString('base64')];
}
function spawnPowerShell(script, options = {}) {
  return cp.spawn('powershell.exe', powershellArgs(script), { ...options, windowsHide: true });
}
function decode(buffer) {
  if (typeof buffer === 'string') return buffer;
  if (!buffer) return '';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('gb18030').decode(buffer); }
}
function commandText(command) {
  if (process.platform !== 'win32') return command;
  // Legacy commands remain otherwise unchanged; each PowerShell producer also sets its output encoding.
  const prepared = command.replace(/(-Command\s+")/i, (_match, prefix) => prefix + PS_UTF8);
  return 'chcp 65001 >nul & ' + prepared;
}
function decodedError(error) {
  if (!error) return error;
  if (error.stdout) error.stdout = decode(error.stdout);
  if (error.stderr) error.stderr = decode(error.stderr);
  if (error.stderr || error.stdout) error.message = `命令执行失败 (${error.code ?? error.status ?? 'unknown'}): ${error.stderr || error.stdout}`;
  return error;
}
function execText(command, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  return cp.exec(commandText(command), { ...options, windowsHide: true, encoding: 'buffer' }, (error, stdout, stderr) => {
    if (error) { error.stdout = stdout; error.stderr = stderr; }
    callback(decodedError(error), decode(stdout), decode(stderr));
  });
}
function execTextSync(command, options = {}) {
  try { return decode(cp.execSync(commandText(command), { ...options, windowsHide: true, encoding: 'buffer' })); }
  catch (error) { throw decodedError(error); }
}
function execPowerShellSync(script, options = {}) {
  try { return decode(cp.execFileSync('powershell.exe', powershellArgs(script), { ...options, windowsHide: true, encoding: 'buffer' })); }
  catch (error) { throw decodedError(error); }
}
// Decode across chunks AND frame complete lines. A chunk boundary is neither a character nor a log boundary.
function readLines(stream, onLine, maxLength = 32768) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const consume = text => {
    pending += text;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
      if (line.trim()) onLine(line);
    }
    if (pending.length > maxLength) { onLine(pending.slice(0, maxLength) + ' …[输出过长]'); pending = ''; }
  };
  stream.on('data', chunk => consume(typeof chunk === 'string' ? chunk : decoder.write(chunk)));
  stream.once('end', () => { consume(decoder.end()); if (pending.trim()) onLine(pending.replace(/\r$/, '')); pending = ''; });
}
module.exports = { ensureConsoleUtf8, powershellArgs, spawnPowerShell, execText, execTextSync, execPowerShellSync, readLines, decode };
