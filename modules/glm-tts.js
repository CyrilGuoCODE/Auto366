/*
 * GLM-TTS 引擎模块 —— 智谱AI云端语音合成
 * ------------------------------------------------------------
 * API: POST https://open.bigmodel.cn/api/paas/v4/audio/speech
 * 返回 WAV 音频，自动裁剪开头 1.8 秒（去除云端提示音）
 *
 * ── 导出 ──
 *   synth(text, voice?, opts?)      单条 → { audio:Buffer, format, mime, ms }
 *   synthLong(text, voice?, opts?)  单条(自动切分超长文本)
 *   VOICES                          音色映射表
 *   MAX_CHARS                       4096
 *
 * ── 独立测试 ──  node glm-tts.js "你好，欢迎使用智谱语音合成"
 */

const https = require('https');

const API_URL = 'https://open.bigmodel.cn/api/paas/v4/audio/speech';
const MAX_CHARS = 4096;
const TRIM_SECONDS = 1.8; // 裁剪开头秒数，去除云端提示音

// 音色映射：友好名 → [voice参数, 说明]
const VOICES = {
  tongtong:    ['female',   '彤彤（默认女声）'],
  female:      ['female',   '彤彤（女声）'],
  xiaochen:    ['xiaochen', '小陈'],
  chuichui:    ['chuichui', '锤锤'],
  jam:         ['jam',      'jam'],
  kazi:        ['kazi',     'kazi'],
  douji:       ['douji',    'douji'],
  luodo:       ['luodo',    'luodo'],
};

let _apiKey = null; // 由外部 setApiKey() 设置，优先级高于环境变量

function setApiKey(key) {
  _apiKey = key || null;
}

function getApiKey() {
  return _apiKey || process.env.ZHIPU_API_KEY || '';
}

/**
 * 裁剪 WAV 音频开头指定秒数（正确处理 WAV chunk 结构）
 * @param {Buffer} wavBuffer - 原始 WAV 数据
 * @param {number} seconds - 裁剪秒数
 * @returns {Buffer} 裁剪后的 WAV 数据
 */
function trimWavStart(wavBuffer, seconds) {
  if (seconds <= 0 || wavBuffer.length < 44) return wavBuffer;

  // 解析 WAV 头
  const riff = wavBuffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') return wavBuffer;

  // 查找 fmt chunk（偏移 12 开始遍历子 chunk）
  let offset = 12;
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      fmtOffset = offset + 8;
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
    // 对齐到偶数边界
    if (chunkSize % 2 !== 0) offset += 1;
  }

  if (fmtOffset < 0 || dataOffset < 0 || dataSize === 0) return wavBuffer;

  // 从 fmt chunk 读取音频参数
  const audioFormat = wavBuffer.readUInt16LE(fmtOffset);
  const numChannels = wavBuffer.readUInt16LE(fmtOffset + 2);
  const sampleRate = wavBuffer.readUInt32LE(fmtOffset + 4);
  const bitsPerSample = wavBuffer.readUInt16LE(fmtOffset + 14);

  if (audioFormat !== 1) return wavBuffer; // 仅支持 PCM

  const bytesPerSample = bitsPerSample / 8;
  const bytesToTrim = Math.floor(sampleRate * numChannels * bytesPerSample * seconds);
  const blockAlign = numChannels * bytesPerSample;
  const alignedTrim = Math.floor(bytesToTrim / blockAlign) * blockAlign;

  if (alignedTrim <= 0 || alignedTrim >= dataSize) return wavBuffer;

  const newDataStart = dataOffset + alignedTrim;
  const newDataSize = dataSize - alignedTrim;

  // 构建新 WAV：复制头部分（到 data chunk 之前）+ data chunk 头 + 裁剪后的数据
  const headerSize = dataOffset - 8; // RIFF 头 + 所有非 data chunk 的内容
  const newWav = Buffer.alloc(dataOffset + newDataSize);

  // 复制 RIFF 头到 data chunk size 字段之前
  wavBuffer.copy(newWav, 0, 0, dataOffset);
  // 复制裁剪后的音频数据
  wavBuffer.copy(newWav, dataOffset, newDataStart, newDataStart + newDataSize);

  // 更新 RIFF chunk size（偏移 4）
  newWav.writeUInt32LE(dataOffset + newDataSize - 8, 4);
  // 更新 data chunk size（偏移 dataOffset - 4）
  newWav.writeUInt32LE(newDataSize, dataOffset - 4);

  return newWav;
}

/**
 * 合成语音
 * @param {string} text - 待合成文本（≤4096字符）
 * @param {string} voice - 音色友好名
 * @param {object} opts - { speed, volume, timeout }
 * @returns {Promise<{audio:Buffer, format:'wav', mime:'audio/wav', ms:number}>}
 */
function synth(text, voice = 'tongtong', opts = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Promise.reject(new Error('ZHIPU_API_KEY 未设置，请在环境变量中配置智谱API密钥'));
  }

  // 如果 voice 在内置音色表中则取其参数名，否则作为原始 voice ID 透传（支持克隆音色）
  const voiceParam = VOICES[voice] ? VOICES[voice][0] : voice;
  const speed = opts.speed !== undefined ? Math.max(0.5, Math.min(2.0, Number(opts.speed))) : 1.0;
  const volume = opts.volume !== undefined ? Math.max(0.5, Math.min(2.0, Number(opts.volume))) : 1.0;
  const timeout = opts.timeout || 60000;
  const t0 = Date.now();

  const body = JSON.stringify({
    model: 'glm-tts',
    input: text,
    voice: voiceParam,
    response_format: 'wav',
    speed,
    volume,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const ct = (res.headers['content-type'] || '').toLowerCase();

        // 失败时返回 JSON 错误
        if (res.statusCode !== 200 || ct.includes('json') || (buf.length > 0 && buf[0] === 0x7b)) {
          return reject(new Error(`GLM-TTS HTTP ${res.statusCode}: ${buf.toString('utf8').slice(0, 300)}`));
        }

        if (buf.length < 100) {
          return reject(new Error(`GLM-TTS 返回音频过短 (${buf.length}B)`));
        }

        // 裁剪开头提示音
        if (TRIM_SECONDS > 0) {
          const trimmed = trimWavStart(buf, TRIM_SECONDS);
          if (trimmed.length > 100) buf = trimmed;
        }

        resolve({
          audio: buf,
          format: 'wav',
          mime: 'audio/wav',
          ms: Date.now() - t0,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

// ── 超长文本切分（按句子边界切到 ≤MAX_CHARS） ──
function chunkText(text, max = MAX_CHARS) {
  text = String(text).trim();
  if (text.length <= max) return [text];
  const sents = text.match(/[^。！？.!?\n]+[。！？.!?\n]*/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sents) {
    if (cur && (cur.length + s.length) > max) { chunks.push(cur.trim()); cur = ''; }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
    } else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

/**
 * 合成(自动切分超长文本，多段 WAV 拼接)
 */
async function synthLong(text, voice = 'tongtong', opts = {}) {
  const chunks = chunkText(text);
  if (chunks.length === 1) return synth(text, voice, opts);

  const t0 = Date.now();
  const parts = [];
  for (const c of chunks) {
    const r = await synth(c, voice, opts);
    parts.push(r.audio);
  }
  return {
    audio: Buffer.concat(parts),
    format: 'wav',
    mime: 'audio/wav',
    ms: Date.now() - t0,
    chunks: chunks.length,
  };
}

/**
 * 获取音色列表（包含官方音色和账号下克隆的私有音色）
 * @param {string} voiceType - 音色类型: 'OFFICIAL' | 'PRIVATE' | 不传=全部
 * @returns {Promise<Array<{voice:string, voice_name:string, voice_type:string, create_time:string}>>}
 */
function listVoices(voiceType) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Promise.reject(new Error('GLM-TTS API Key 未设置'));
  }

  const params = new URLSearchParams();
  if (voiceType) params.append('voiceType', voiceType);

  const path = '/api/paas/v4/voice/list' + (params.toString() ? '?' + params.toString() : '');

  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (data.error) {
            return reject(new Error(`GLM-TTS 获取音色列表失败: ${data.error.message || JSON.stringify(data.error)}`));
          }
          resolve(data.voice_list || []);
        } catch (e) {
          reject(new Error(`GLM-TTS 解析音色列表失败: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

module.exports = { synth, synthLong, chunkText, VOICES, MAX_CHARS, setApiKey, listVoices };

// ── CLI 测试 ──
if (require.main === module) {
  const text = process.argv[2] || '你好，欢迎使用智谱语音合成测试。';
  const voice = process.argv[3] || 'tongtong';
  synthLong(text, voice)
    .then((r) => {
      require('fs').writeFileSync('out.wav', r.audio);
      console.log(`out.wav (${(r.audio.length / 1024).toFixed(0)}KB, ${r.format}, ${r.ms}ms${r.chunks > 1 ? ', ' + r.chunks + '段拼接' : ''})`);
    })
    .catch((e) => { console.error('Error:', e.message); process.exit(1); });
}
