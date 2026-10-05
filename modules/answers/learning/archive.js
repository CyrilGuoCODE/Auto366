const fs = require('fs/promises');
const path = require('path');
const { TextDecoder } = require('util');
const { LIMITS, validEntry } = require('./policy');

// Reuse the legacy extractor's owned directory, including decrypted text. Never
// unpack a second time or follow a path supplied by an AI/cloud policy.
module.exports = async function collectArchive(result, accepts) {
  if (!result?.extractDir) return [];
  const root = path.resolve(result.extractDir);
  const known = new Set((result.processedFiles || [])
    .filter(file => file.success && (file.actualAnswerCount ?? file.answerCount) > 0 && result.sourceMode !== 'question-only')
    .map(file => file.file.replace(/\\/g, '/')));
  const samples = [];
  let visited = 0, readBytes = 0, retained = 0;
  const deadline = Date.now() + 1000;
  const exhausted = () => visited >= 1000 || readBytes >= 1048576 || samples.length >= 8 || Date.now() >= deadline;
  async function walk(directory, depth) {
    if (depth > 12 || exhausted()) return;
    const dir = await fs.opendir(directory);
    for await (const item of dir) {
      if (exhausted()) break;
      visited++;
      if (item.isSymbolicLink()) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) { await walk(file, depth + 1); continue; }
      const entry = path.relative(root, file).split(path.sep).join('/');
      if (!item.isFile() || !validEntry(entry) || !/\.(?:json|js|xml|txt)$/i.test(entry) || known.has(entry)) continue;
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size === 0 || stat.size > LIMITS.input || readBytes + stat.size > 1048576) continue;
      // Bound the actual read too; stat alone is not a memory limit.
      const handle = await fs.open(file, 'r');
      let buffer;
      try {
        buffer = Buffer.alloc(Math.min(stat.size + 1, LIMITS.input + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        readBytes += bytesRead;
        if (bytesRead !== stat.size) continue;
        buffer = buffer.subarray(0, bytesRead);
      } finally { await handle.close(); }
      let response;
      try {
        const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le'
          : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : 'utf-8';
        response = new TextDecoder(encoding, { fatal: true }).decode(buffer);
      } catch { continue; }
      const size = Buffer.byteLength(response);
      if (/[\x00-\x08\x0e-\x1f]/.test(response) || size > LIMITS.input || retained + size > 524288) continue;
      if (!accepts({ entry, response })) continue;
      samples.push({ entry, response }); retained += size;
    }
  }
  await walk(root, 0);
  return samples;
};
