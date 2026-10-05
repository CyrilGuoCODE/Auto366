const { digest } = require('./request');
const LIMITS = Object.freeze({ input: 262144, policy: 16384, pattern: 1024, results: 200, answer: 4096 });
function object(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !keys.includes(k))) throw new Error('规则包含未知字段');
}
function regex(spec) {
  object(spec, ['pattern', 'flags']);
  if (typeof spec.pattern !== 'string' || !spec.pattern || spec.pattern.length > LIMITS.pattern || typeof spec.flags !== 'string' || !/^(?:i?m?s?u?)$/.test(spec.flags)) throw new Error('正则格式无效');
  // Construction only. Potentially expensive matching is always delegated to the worker.
  new RegExp(spec.pattern, spec.flags);
}
function validEntry(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && !/[\\:\x00-\x1f\x7f]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}
function validate(pair) {
  // Bound nested data before hashing or compiling; input may come from AI or the network.
  const pending = [[pair, 0]];
  let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++nodes > 2048 || depth > 16) throw new Error('规则结构过于复杂');
    if (value === null || ['string', 'boolean'].includes(typeof value)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (typeof value !== 'object') throw new Error('规则必须是有效 JSON 数据');
    const entries = Object.entries(value);
    if (entries.length > 256) throw new Error('规则字段数量超限');
    for (const [key, item] of entries) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('规则包含保留字段');
      pending.push([item, depth + 1]);
    }
  }
  if (Buffer.byteLength(JSON.stringify(pair), 'utf8') > LIMITS.policy) throw new Error('规则过大');
  object(pair, ['version', 'questionType', 'request', 'response']);
  if (![1, 2].includes(pair.version) || !['choice', 'fill', 'speaking', 'reading', 'oral', 'retell', 'mixed'].includes(pair.questionType)) throw new Error('不支持的规则版本或题型');
  object(pair.request, pair.version === 2 ? ['kind', 'host', 'regex'] : ['kind', 'gate', 'fingerprint', 'regex']);
  object(pair.response, pair.version === 2 ? ['kind', 'regex', 'entry'] : ['kind', 'regex']);
  // This is an exact archive-member scope, never a filesystem read capability.
  if (Object.hasOwn(pair.response, 'entry') && !validEntry(pair.response.entry)) throw new Error('ZIP 条目范围无效');
  if (pair.request.kind !== 'question-match' || pair.response.kind !== 'answer-extract') throw new Error('必须分别提供请求匹配和答案提取规则');
  if (pair.version === 2) {
    if (typeof pair.request.host !== 'string' || !pair.request.host || pair.request.host.length > 300 || /[\s*\/?#@\\]/.test(pair.request.host)) throw new Error('请求主机范围无效');
  } else {
  const gate = pair.request.gate;
  object(gate, ['version', 'host', 'method', 'path', 'contentType', 'query', 'bodyShape', 'types']);
  if (gate.version !== 1 || typeof gate.host !== 'string' || !gate.host || typeof gate.path !== 'string' || !gate.path.startsWith('/') || !['GET', 'POST', 'PUT', 'PATCH'].includes(gate.method) || typeof gate.contentType !== 'string' || !Array.isArray(gate.query) || !Array.isArray(gate.types) || !Object.hasOwn(gate, 'bodyShape') || digest(gate) !== pair.request.fingerprint) throw new Error('请求指纹无效');
  if (gate.host.length > 300 || /[\s*\/?#@\\]/.test(gate.host) || gate.path.length > 2048 || gate.contentType.length > 128) throw new Error('请求范围无效');
  if (gate.query.some(item => !Array.isArray(item) || item.length !== 2 || item.some(value => typeof value !== 'string'))) throw new Error('查询指纹无效');
  if (gate.types.some(item => !Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || !(typeof item[1] === 'string' || typeof item[1] === 'number' || typeof item[1] === 'boolean' || Array.isArray(item[1]) && item[1].every(value => typeof value === 'string')))) throw new Error('题型指纹无效');
  }
  regex(pair.request.regex);
  regex(pair.response.regex);
  if (!pair.response.regex.pattern.includes('(?<answer>')) throw new Error('答案正则必须包含命名捕获组 answer');
  return pair;
}
module.exports = { validate, LIMITS, validEntry };
