const fs = require('fs/promises');
const path = require('path');
const startedAt = new Date(Date.now() - process.uptime() * 1000);
const sessionName = /^auto366(?:-\d+)?_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3})\.log$/;
function timestamp(date) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

// One writer in the main process. Bounded queue, UTF-8 files, no synchronous I/O per log.
class LogWriter {
  constructor(directory, { maxBytes = 5 * 1024 * 1024, files = 5, queueBytes = 1024 * 1024, onError = () => {}, startTime = startedAt } = {}) {
    this.directory = directory;
    this.startedAt = new Date(startTime).toISOString();
    this.suffix = timestamp(new Date(startTime));
    this.file = path.join(directory, `auto366_${this.suffix}.log`);
    this.maxBytes = maxBytes;
    this.files = files;
    this.queueLimit = queueBytes;
    this.onError = onError;
    this.enabled = false;
    this.queue = [];
    this.bytes = 0;
    this.dropped = 0;
    this.error = null;
    this.running = null;
    this.timer = null;
  }
  async setEnabled(enabled) {
    if (enabled) {
      await this.ensureFile();
      if ((await fs.stat(this.file)).size >= this.maxBytes || this.full) throw this.capacityError();
      this.error = null;
    }
    this.enabled = enabled;
    if (!enabled) await this.flush();
  }
  append(text) {
    if (!this.enabled) return;
    let data = Buffer.from(text, 'utf8');
    if (data.length > this.maxBytes - 3) {
      const clipped = Buffer.alloc(Math.max(0, this.maxBytes - 32));
      const length = clipped.write(text, 'utf8'); // never split a UTF-8 code point
      data = Buffer.concat([clipped.subarray(0, length), Buffer.from(' …[日志过长]\n')]);
    }
    if (this.bytes + data.length > this.queueLimit) { this.dropped++; return; }
    this.queue.push(data);
    this.bytes += data.length;
    if (!this.timer && !this.running) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 40);
      this.timer.unref?.();
    }
  }
  capacityError() {
    return new Error(`本次启动日志达到 ${this.maxBytes / 1024 / 1024} MB 容量上限；已有日志保留，下次启动写入新文件`);
  }
  async ensureFile() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await fs.mkdir(this.directory, { recursive: true });
      // Exclusive creation prevents two launches with the same timestamp from
      // appending to one another. Toggling recording reuses this session file.
      for (let collision = 0; !this.reserved; collision++) {
        this.file = path.join(this.directory, `auto366${collision ? '-' + collision : ''}_${this.suffix}.log`);
        try { const handle = await fs.open(this.file, 'wx', 0o600); this.reserved = true; await handle.close(); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      const previous = (await fs.readdir(this.directory, { withFileTypes: true }))
        .filter(item => item.isFile() && sessionName.test(item.name) && item.name !== path.basename(this.file))
        .map(item => item.name)
        .sort((a, b) => sessionName.exec(b)[1].localeCompare(sessionName.exec(a)[1]) || b.localeCompare(a));
      // Leave legacy auto366.log(.N) and unrelated files untouched.
      for (const name of previous.slice(Math.max(0, this.files - 1))) await fs.rm(path.join(this.directory, name), { force: true });
    })();
    try { await this.ready; }
    catch (error) { this.ready = null; throw error; }
  }
  async drain() {
    try {
      await this.ensureFile();
      let size = 0;
      try { size = (await fs.stat(this.file)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      while (this.queue.length) {
        const batch = [];
        let bytes = 0;
        if (size && size + this.queue[0].length > this.maxBytes) { this.full = true; throw this.capacityError(); }
        if (!size) { batch.push(Buffer.from('\uFEFF')); bytes += 3; }
        while (this.queue.length && size + bytes + this.queue[0].length <= this.maxBytes) {
          const data = this.queue.shift(); batch.push(data); bytes += data.length; this.bytes -= data.length;
        }
        await fs.appendFile(this.file, Buffer.concat(batch), { mode: 0o600 });
        size += bytes;
      }
    } catch (error) {
      this.error = error.message;
      this.enabled = false;
      this.queue = []; this.bytes = 0;
      this.onError(error);
    }
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.running) { await this.running; return this.flush(); }
    if (!this.queue.length) return;
    this.running = this.drain();
    try { await this.running; } finally { this.running = null; }
    if (this.queue.length) await this.flush();
  }
}
module.exports = LogWriter;
