// 只筛选被动捕获的候选；不发请求，不决定答案是否正确。
const { digest } = require('./request');

module.exports = function discover(sample, heuristic = true) {
  const url = new URL(sample.url);
  const route = sample.method + ' ' + url.origin + url.pathname + (sample.entry ? ' ZIP:' + sample.entry : '');
  if ((!sample.entry && /\.(?:js|css|map|svg|woff2?|png|jpe?g|gif|zip)$/i.test(url.pathname))
      || /(?:^|\/)(?:login|logout|oauth|token|telemetry|analytics|heartbeat)(?:\/|$)/i.test(url.pathname)
      || /^\s*(?:<!doctype\s+html|<html\b)/i.test(sample.response)) return null;
  let answer = false, question = false, options = false, verdict = false;
  const types = new Set();
  let remaining = 1600;
  function walk(value, depth = 0, request = false) {
    if (!value || typeof value !== 'object' || depth > 10 || remaining-- <= 0) return;
    for (const [key, child] of Object.entries(value)) {
      if (remaining-- <= 0) break;
      if (!request) {
        if (/^(?:(?:right|correct|standard|reference|model)?answers?|solutions?|答案|正确答案)$/i.test(key) && child != null && child !== '' && typeof child !== 'boolean' && (!Array.isArray(child) || child.length > 0)) answer = true;
        if (/^(?:question\w*|stem|exercise\w*|题目|题干)$/i.test(key)) question = true;
        if (/^(?:options?|choices?|选项)$/i.test(key) && child && typeof child === 'object') options = true;
        if (/^(?:is_?right|is_?correct|right|correct|expected)$/i.test(key) && child != null) verdict = true;
      }
      if (/^(?:question_?type|exercise_?type|item_?type|题型)$/i.test(key) && ['string','number'].includes(typeof child) && types.size < 8) types.add(String(child).slice(0, 40));
      if (child && typeof child === 'object') walk(child, depth + 1, request);
    }
  }
  let structured = false;
  try { const data = JSON.parse(sample.response); structured = !!data && typeof data === 'object'; walk(data); } catch {}
  if (!structured) {
    answer = /<(?:answer|solution)\b|(?:答案|正确答案)\s*[:：]|\b(?:answer|solution)["']?\s*[:=]/i.test(sample.response);
    question = /<(?:question|stem|exercise)\b/i.test(sample.response);
    options = /<(?:option|choice)\b/i.test(sample.response);
    verdict = /\b(?:isRight|isCorrect|correct)\s*=\s*["']?(?:true|1)/i.test(sample.response);
  }
  try { walk(JSON.parse(sample.requestBody), 0, true); } catch {
    for (const [key, value] of new URLSearchParams(sample.requestBody)) if (/^(?:question_?type|exercise_?type)$/i.test(key) && types.size < 8) types.add(value.slice(0, 40));
  }
  for (const [key, value] of url.searchParams) if (/^(?:question_?type|exercise_?type|type)$/i.test(key) && types.size < 8) types.add(value.slice(0, 40));
  const pathHint = /(?:question|exercise|paper|quiz|homework|exam|practice)/i.test(url.pathname);
  const reasons = [];
  if (answer) reasons.push('响应含答案字段');
  if (question) reasons.push('响应含题目结构');
  if (options && verdict) reasons.push('选项包含判定标记');
  if (pathHint) reasons.push('请求路径与题目有关');
  if (types.size) reasons.push('发现题型字段');
  if (!answer && !(heuristic && ((options && verdict) || (question && (options || verdict || types.size || pathHint))))) return null;
  // 此键只用于候选去重/限频；规则匹配仍由请求正则完成。
  return { route: route + ' ' + digest([...types].sort()).slice(0, 12), reasons,
    confidence: answer || options && verdict ? '较高' : '待判断' };
};
