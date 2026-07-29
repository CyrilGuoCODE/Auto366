/*
 * ── 导出 ──
 *   synth(text, voice?, opts?)      单条 → { audio:Buffer, format, mime, ms }
 *   synthLong(text, voice?, opts?)  单条(自动切分超长文本, 多段 mp3 拼接)
 *   synthBatch(items[], voice?, opts?)  批量并发池 → [{ok, index, audio?/error?, ms, chunks}]
 *       opts: { concurrency=16, timeout=60000, onProgress(done,total) }
 *   chunkText(text, max=1500)       按句子边界切分
 *   VOICES / genSn / MAX_CHARS
 *
 * ── voice ──  'english'(youxiaomei, 读英文, 答案朗读用这个) / 'normal'/'taiyi'/'tianjin'(中文)
 *
 * ── 独立测试 ──  node chestnut-tts.js "Hello world, this is a test."   → 生成 out.mp3
 */
const https = require('https');
const crypto = require('crypto');

const TTS_URL = 'https://dictpen-server.youdao.com/zhiyun/tts';
const KEYID = 'dictpen_keyid';
const SECRET = 'K7H0@Mfi6h#68';

// 友好名 -> [真实 voiceName, format]。英文答案朗读用 youxiaomei(英文专用)。
const VOICES = {
  english:  ['youxiaomei',     'mp3'],   // 英文发音(读中文无效)
  youxiaomei:['youxiaomei',    'mp3'],
  normal:   ['you_xiao_shi',   'wav'],   // 中文标准
  taiyi:    ['tai_yi_zhen_ren','wav'],
  tianjin:  ['you_xiao_jin',   'wav'],
};

function genSn() {
  let s = 'MF';
  for (let i = 0; i < 14; i++) s += Math.floor(Math.random() * 10);
  return s;
}
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

function buildMultipart(fields) {
  const boundary = '----------------------------' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), boundary };
}

/**
 * 合成语音。text=文本, voice=friendly 名, opts.sn 可复用同一 SN, opts.timeout ms。
 * 返回 { audio:Buffer, format, mime, ms:耗时 }。失败 reject(Error)。
 */
function synth(text, voice = 'english', opts = {}) {
  const [voiceName, fmt] = VOICES[voice] || VOICES.english;
  const sn = opts.sn || genSn();
  const timeout = opts.timeout || 60000;
  const t0 = Date.now();
  const ms = String(Date.now());
  const sign = md5(`deviceSn=${sn}&keyid=${KEYID}&mysticTime=${ms}&key=${SECRET}`);
  const fields = {
    osAppVersion: '2.34.0', appVersion: '4.34.0', client: 'y02-1',
    deviceId: sn, deviceSku: 'OVERHEAD_Y02-1_SKU_CHN_PLUS', deviceSn: sn,
    imei: sn, keyid: KEYID, messageSource: 'yd_gpt_dictpen',
    mid: 'Linux5.10.160', model: 'YDPX7-6', mysticTime: ms,
    pointParam: 'deviceSn,keyid,mysticTime', product: 'dictpen', screen: '936x280',
    sign, q: text, voiceName, format: fmt, volume: '1',
  };
  const { body, boundary } = buildMultipart(fields);
  return new Promise((resolve, reject) => {
    const req = https.request(TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'User-Agent': 'okhttp/3.12.1',
        'Content-Length': body.length,
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = (res.headers['content-type'] || '').toLowerCase();
        // 成功=原始音频(wav 以 'RIFF'/mp3 以 0xFF 或 'ID3' 开头); 失败=JSON(以 '{')
        if (res.statusCode !== 200 || ct.includes('json') || (buf.length && buf[0] === 0x7b)) {
          return reject(new Error(`HTTP ${res.statusCode} ${buf.toString('utf8').slice(0, 200)}`));
        }
        if (buf.length < 1000) {  // 过短=多半没合成成功(如英文音读中文)
          return reject(new Error(`suspiciously small audio (${buf.length}B): ${buf.toString('utf8').slice(0,120)}`));
        }
        resolve({ audio: buf, format: fmt, mime: fmt === 'mp3' ? 'audio/mpeg' : 'audio/wav', ms: Date.now() - t0 });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

// ── 超长文本切分(智云上限≈2000字符, 这里按句子边界切到 ≤1500 稳妥) ──
const MAX_CHARS = 1500;
function chunkText(text, max = MAX_CHARS) {
  text = String(text).trim();
  if (text.length <= max) return [text];
  const sents = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [text];
  const chunks = []; let cur = '';
  for (const s of sents) {
    if (cur && (cur.length + s.length) > max) { chunks.push(cur.trim()); cur = ''; }
    if (s.length > max) {                      // 单句仍超长: 硬切
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
    } else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

/** 合成(自动切分超长文本, 多段 mp3 字节拼接; 复用同一 SN)。返回同 synth。 */
async function synthLong(text, voice = 'english', opts = {}) {
  const chunks = chunkText(text);
  if (chunks.length === 1) return synth(text, voice, opts);
  const sn = opts.sn || genSn();
  const t0 = Date.now();
  const parts = [];
  for (const c of chunks) parts.push((await synth(c, voice, { ...opts, sn })).audio);  // 串行保顺序
  return { audio: Buffer.concat(parts), format: 'mp3', mime: 'audio/mpeg', ms: Date.now() - t0, chunks: chunks.length };
}

/** 并发池: items[] -> [{ok, audio?/error?, index}]。concurrency 默认 16。onProgress(done,total)。 */
async function synthBatch(items, voice = 'english', opts = {}) {
  const concurrency = opts.concurrency || 16;
  const results = new Array(items.length);
  let idx = 0, done = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      try { const r = await synthLong(items[i], voice, opts); results[i] = { ok: true, index: i, audio: r.audio, format: r.format, ms: r.ms, chunks: r.chunks || 1 }; }
      catch (e) { results[i] = { ok: false, index: i, error: e.message }; }
      if (opts.onProgress) opts.onProgress(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

module.exports = { synth, synthLong, synthBatch, chunkText, VOICES, genSn, MAX_CHARS };

// ── CLI: node chestnut-tts.js "文本" [voice] → out.mp3 ──
if (require.main === module) {
  const text = process.argv[2] || 'Hello world, this is a chestnut TTS test.';
  const voice = process.argv[3] || 'english';
  synthLong(text, voice).then((r) => {
    require('fs').writeFileSync('out.mp3', r.audio);
    console.log(`✅ out.mp3 (${(r.audio.length / 1024).toFixed(0)}KB, ${r.format}, ${r.ms}ms${r.chunks > 1 ? ', ' + r.chunks + '段拼接' : ''})`);
  }).catch((e) => { console.error('❌', e.message); process.exit(1); });
}
