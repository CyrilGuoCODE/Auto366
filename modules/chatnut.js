/*
 * chatnut.js —— 免费在线 AI(纯 Node 移植, 零依赖, 只用内置 https/crypto)
 * 与 chestnut-tts.js 同源: 靠"设备号 + 时间戳 + md5 签名"直连, 不需要任何 API Key。
 *
 * ── 导出 ──
 *   ask(question, opts?)      → { text, reasoning, ms, why }   一问一答(内部走 SSE)
 *   askChoice(question, candidates, opts?) → { index, text, ms } 选择题, 返回 0-based 下标(-1=没解析出来)
 *   MODELS / genSn / parseChoice
 *
 * ── opts ──
 *   model    'chatnut' / 'qwen' / 'doubao' —— 三个平级的免费模型
 *   stopWhen (text)=>bool  命中即断流, 不等它说完(askChoice 已内置)
 *   timeout  默认 15000ms
 *
 * ── 实测(2026-08-05, 单词PK选择题场景) ──
 *   接口本身就是 SSE, 正文分 2~4 帧吐, 第一帧就含"正确答案是：2" → 命中即掐断能省时间。
 *   doubao 最快(约 1.0s), qwen 次之(掐断后 872ms, 比读完全文省 41%), chatnut 最慢(约 2.5s)。
 *   延迟来自服务端【生成】, 不是连接开销 —— 换 WebSocket 一秒都省不了。
 *
 *   ★服务端提示词过滤(实测, 别踩): 提问里只要【要求"只输出编号/只回复一个数字"】,
 *     服务端就【返回空正文】——前置、末尾、包在"【系统设定，必须严格遵守】"壳里都一样。
 *     推测是 dayiPracticeAsk 场景把"只要答案不要过程"当作弊请求掐了。
 *     但这【不是】"不能带指令": 普通人设是正常的, 只是别去限制输出成纯编号。
 *     故一律用自然问法("哪个是正确的?")让它正常作答, 再由 parseChoice 本地解析编号。
 *     ("不要解释" 能把回答压到 6 字, 但实测 doubao 会偶发返回空 1/3, 得不偿失, 已弃用。)
 *     仍有极偶发的空正文, askChoice 内置重发一次兜底。
 *
 * ── 独立测试 ──  node chatnut.js "apple 的中文意思是什么？"
 */
const https = require('https');
const { genSn, deviceForm } = require('./dictpen-sign');   // 设备字段+签名, 与 chestnut-tts 共用

const XP_URL = 'https://dictpen-server.youdao.com/teacherp/chat/ask/sse';

// 对外模型名 -> 底座开关(messageInfo.dayiModel)。
//   chatnut = 不填该字段, 用服务端自己挑的底座; qwen / doubao = 切到通义千问 / 豆包。
const MODELS = {
  'chatnut': null,
  'qwen': 'qianwen',
  'doubao': 'doubao',
};

function _buildBody(question, dayi) {
  const messageInfo = {
    stage: 'middle_school', subscribe: 'strategy,hit_tiku',
    modelPromptRateSchema: 'deepseek_model_prompt', sensitiveScope: 'message',
    responseStyle: 'official', languageStyle: 'official',
  };
  if (dayi) messageInfo.dayiModel = dayi;
  return deviceForm({
    messageContents: JSON.stringify([{ text: { content: question }, type: 'text' }]),
    messageInfo: JSON.stringify(messageInfo), languageStyle: 'official',
    messageScene: 'dayiPracticeAsk',
  });
}

/**
 * 提问。走 SSE 逐帧收, stopWhen 命中即断流(不等服务端说完)。
 * @returns {Promise<{text, reasoning, ms, why}>}  why: 'done'|'end'|'early-abort'
 */
function ask(question, opts = {}) {
  const dayi = Object.prototype.hasOwnProperty.call(MODELS, opts.model)
    ? MODELS[opts.model] : (opts.dayi || null);
  const timeout = opts.timeout || 15000;
  const { body, boundary } = _buildBody(question, dayi);
  const t0 = Date.now();

  return new Promise((resolve, reject) => {
    let text = '', reasoning = '', buf = '', settled = false;
    const finish = (why) => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch (e) { /* 已断开 */ }
      resolve({ text, reasoning, ms: Date.now() - t0, why });
    };
    const req = https.request(XP_URL, {
      method: 'POST',
      timeout,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'User-Agent': 'okhttp/3.12.1',
        'Content-Length': body.length,
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        settled = true;
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.on('data', (c) => {
        buf += c.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop();               // 末行可能不完整, 留到下一片
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5);
          if (d === '[DONE]') return finish('done');
          let j;
          try { j = JSON.parse(d); } catch (e) { continue; }
          for (const it of (j.data && j.data.list) || []) {
            if (it.type !== 'text') continue;
            const tx = it.text || {};
            const c2 = tx.content || '';
            if (!c2) continue;
            // 外层 type=text, 内层 text.type 才区分思维链(仅子曰3有)与正文
            if (tx.type === 'reasoningText') {
              reasoning += c2;
            } else {
              text += c2;
              if (opts.onChunk) opts.onChunk(c2);
              if (opts.stopWhen && opts.stopWhen(text)) return finish('early-abort');
            }
          }
        }
      });
      res.on('end', () => finish('end'));
    });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

// ── 从自然语言回答里解析出选项编号(1-based) ──
// 覆盖实测出现过的措辞: "正确答案是：2. 苹果" / "正确答案是选项2" / "正确选项编号：2。" / "1. 放弃" / "2。"
// [*\s（(\[]* 是为了吃掉 markdown 粗体和括号, 实测出现过 "正确答案是 **1. 放弃**。"
const _CHOICE_RE = [
  /(?:正确答案|正确选项|答案|编号|应该?选|选择|选项)[是为：:\s]*(?:编号)?[是为：:\s]*(?:选项)?[*\s（(\[]*(\d{1,2})/,
  /^[*\s（(\[]*(\d{1,2})\s*[）)\].。、,，:：]/,
  /^\s*(\d{1,2})\s*[。.]?\s*$/,
];
function parseChoice(text, max) {
  if (!text) return -1;
  const s = String(text).trim();
  for (const re of _CHOICE_RE) {
    const m = s.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && (!max || n <= max)) return n - 1;   // 转 0-based
    }
  }
  return -1;
}

// 回退: 模型只说释义不给编号时(实测 qwen 常这样, 如"abandon 的意思是：放弃。"), 拿候选项文本去回答里找。
// ★按【在回答里出现的位置】取最靠前的那个 —— 模型一般先说答案、后面才逐条对比其它选项,
//   若按候选顺序取会选错(实测 "ancient" 回答里三个选项都出现过)。同位置时取更长的, 防短串误判。
function matchCandidate(text, candidates) {
  if (!text || !candidates || !candidates.length) return -1;
  const s = String(text);
  let best = -1, bestPos = Infinity, bestLen = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = String(candidates[i] || '').trim();
    if (!c) continue;
    const pos = s.indexOf(c);
    if (pos < 0) continue;
    if (pos < bestPos || (pos === bestPos && c.length > bestLen)) {
      best = i; bestPos = pos; bestLen = c.length;
    }
  }
  return best;
}

/**
 * 选择题。用自然问法提问(★不要求它"只输出编号", 否则服务端返回空正文, 见文件头),
 * 让它正常作答, 首次解析出编号即断流; 解析不出再按候选文本回退。
 * @returns {Promise<{index, text, ms, why}>}  index 为 0-based, -1 = 未解析出
 */
async function askChoice(question, candidates, opts = {}) {
  const model = Object.prototype.hasOwnProperty.call(MODELS, opts.model) ? opts.model : 'doubao';
  let q = '题目: ' + question + '\n选项:\n';
  for (let i = 0; i < candidates.length; i++) q += (i + 1) + '. ' + candidates[i] + '\n';
  q += '哪个是正确的?';
  const max = candidates.length;
  // 偶发空正文(服务端过滤/抽风), 重发一次即可 —— 每次都是新 SN, 等于换一台"设备"重问。
  const retries = opts.retries == null ? 1 : opts.retries;
  let r;
  for (let a = 0; a <= retries; a++) {
    r = await ask(q, {
      model,
      timeout: opts.timeout,
      stopWhen: (t) => parseChoice(t, max) >= 0,  // 一解析出编号就掐断
    });
    if (r.text) break;
  }
  let index = parseChoice(r.text, max);
  if (index < 0) index = matchCandidate(r.text, candidates);   // 没给编号 → 按候选文本回退
  return { index, text: r.text, ms: r.ms, why: r.why };
}

module.exports = { ask, askChoice, parseChoice, matchCandidate, MODELS, genSn };

// ── CLI: node chatnut.js "问题" [model] ──
if (require.main === module) {
  const q = process.argv[2] || 'apple 的中文意思是什么？';
  const model = process.argv[3] || 'doubao';
  ask(q, { model }).then((r) => {
    console.log(`[${model}] ${r.ms}ms (${r.why})`);
    if (r.reasoning) console.log('--- 思维链 ---\n' + r.reasoning);
    console.log('--- 正文 ---\n' + (r.text || '(空)'));
  }).catch((e) => { console.error('❌', e.message); process.exit(1); });
}
