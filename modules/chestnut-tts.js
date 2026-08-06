/*
 * chestnut-tts.js —— 有道词典笔【智云 TTS】纯 Node 移植(零依赖, 只用内置 https/crypto)
 * /zhiyun/tts, 免 cookie / 免 VIP, 仅设备字段 + 签名。英文答案朗读用 'english' 音色, 出 mp3。
 *
 * ── 导出 ──
 *   synth(text, voice?, opts?)      单条(★自带低超时+自动重发) → { audio, format, mime, ms, tries }
 *   synthLong(text, voice?, opts?)  单条(自动切分超长文本, 多段并行合成后按序拼接)
 *   synthBatch(items[], voice?, opts?)  批量并发池 → [{ok, index, audio?/error?, ms, chunks}]
 *       opts: { concurrency=32, timeout=自适应, retries=4, backoff=300, onProgress(done,total) }
 *   chunkText(text, max=1500)       按句子边界切分
 *   VOICES / genSn / MAX_CHARS
 *
 * ── voice ──  'english'(youxiaomei, 读英文, 答案朗读用这个) / 'normal'/'taiyi'/'tianjin'(中文)
 *
 * ── 吞吐与稳定(实测结论) ──
 *   1) 有道【不限速】: 同SN/换SN/累计次数/突发并发都不触发封禁, 从不 429。
 *   2) 真实吞吐取决于【文本长度】(要逐条合成音频): 单个词~400条/秒, 整句答案(~90字符)约 15~23 条/秒,
 *      随服务器负载波动。合并多句成一条【无益反劣】(高并发下并行小请求更快), 故不做合并再切分。
 *   3) 偶发【慢尾】(个别请求卡几秒)会堵并发槽 → 对策=【超时自动重发(换新SN)】, 已焙进 synth;
 *      超时【自适应文本长度】(短句~2.5s、长段放宽), 避免误杀合法的长请求(1200ms 死超时对整句会 11% 白重试)。
 *   ⚠️ 接入方(tts.js)现把并发写死 3、且 chestnut 不重试 —— 建议并发调到 16~32(chestnut 是云端并发, 非本地串行)。
 *
 * ── 独立测试 ──  node chestnut-tts.js "Hello world, this is a test."   → 生成 out.mp3
 */
const https = require('https');
const { genSn, deviceForm } = require('./dictpen-sign');   // 设备字段+签名, 与 chatnut 共用

const TTS_URL = 'https://dictpen-server.youdao.com/zhiyun/tts';

// 友好名 -> [真实 voiceName, format]。英文答案朗读用 youxiaomei(英文专用)。
const VOICES = {
  english:  ['youxiaomei',     'mp3'],   // 英文发音(读中文无效)
  youxiaomei:['youxiaomei',    'mp3'],
  normal:   ['you_xiao_shi',   'wav'],   // 中文标准
  taiyi:    ['tai_yi_zhen_ren','wav'],
  tianjin:  ['you_xiao_jin',   'wav'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单次尝试(不重试)。timeout 默认随文本长度自适应(短句~2.5s, 长段自动放宽), 只砍真正的慢尾。 */
function _attempt(text, voice = 'english', opts = {}) {
  const [voiceName, fmt] = VOICES[voice] || VOICES.english;
  const sn = opts.sn || genSn();
  const timeout = opts.timeout || Math.max(2500, Math.ceil((text || '').length * 6));
  const t0 = Date.now();
  const { body, boundary } = deviceForm({ q: text, voiceName, format: fmt, volume: '1' }, sn);
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

/**
 * 合成语音(带重试)。★超时/出错自动重发(每次换新 SN), 这才是稳定拿高吞吐的关键。
 * 有道服务器偶发慢尾(单条可达数秒), 短超时(1200ms)放弃 + 重发, 平均比死等快得多。
 * opts: { timeout=1200, retries=4, backoff=300, sn }。返回 { audio, format, mime, ms, tries }。
 */
async function synth(text, voice = 'english', opts = {}) {
  const retries = opts.retries ?? 4;
  const backoff = opts.backoff ?? 300;
  let last;
  for (let a = 0; a <= retries; a++) {
    try {
      const r = await _attempt(text, voice, { ...opts, sn: opts.sn || genSn() });
      return { ...r, tries: a + 1 };
    } catch (e) {
      last = e;
      // 内容类错误(如英文音读中文=音频过短)重试无意义, 直接抛
      if (/suspiciously small/.test(e.message)) throw e;
      if (a < retries) await sleep(backoff * (a + 1) * (0.5 + Math.random()));  // 抖动退避
    }
  }
  throw last;
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

/** 合成(自动切分超长文本, 多段并行合成后按序拼接)。返回同 synth。
 *  注: mp3 帧可直接字节拼接; wav 音色(normal/taiyi/tianjin)多段拼接会因多个 RIFF 头而无效,
 *  故超长文本请用 mp3 音色(english/youxiaomei, 也是英文答案朗读的默认)。 */
async function synthLong(text, voice = 'english', opts = {}) {
  const chunks = chunkText(text);
  if (chunks.length === 1) return synth(text, voice, opts);
  const t0 = Date.now();
  const parts = await Promise.all(chunks.map((c) => synth(c, voice, opts).then((r) => r.audio)));  // 并行, 数组保序
  return { audio: Buffer.concat(parts), format: 'mp3', mime: 'audio/mpeg', ms: Date.now() - t0, chunks: chunks.length };
}

/** 并发池: items[] -> [{ok, audio?/error?, index}]。concurrency 默认 16。onProgress(done,total)。 */
async function synthBatch(items, voice = 'english', opts = {}) {
  const concurrency = opts.concurrency || 32;
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
