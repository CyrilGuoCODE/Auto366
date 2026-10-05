// This process interprets JSON only. Policies cannot supply executable code or paths.
const { validate, LIMITS } = require('./policy');
const { fingerprint, requestText } = require('./request');
process.once('message', ({ pair, sample }) => {
  try {
    validate(pair);
    // Ordinary HTTP rules cannot run on an archive member, or vice versa.
    if ((pair.response.entry || null) !== (sample.entry || null)) return process.send({ success: true, matched: false, answers: [] });
    if (typeof sample.response !== 'string' || Buffer.byteLength(sample.response) > LIMITS.input) throw new Error('响应超过解析上限');
    const fp = pair.version === 1 ? fingerprint(sample) : null;
    const rule = pair.request.regex;
    const inScope = pair.version === 1 ? pair.request.fingerprint === fp.id : pair.request.host === new URL(sample.url).host.toLowerCase();
    if (!inScope || !new RegExp(rule.pattern, rule.flags).test(fp ? fp.text : requestText(sample))) return process.send({ success: true, matched: false, answers: [] });
    const spec = pair.response.regex;
    const pattern = new RegExp(spec.pattern, spec.flags + 'g');
    const answers = [];
    let match;
    while ((match = pattern.exec(sample.response))) {
      if (!match[0].length) throw new Error('不允许空匹配');
      const answer = match.groups?.answer?.trim();
      if (!answer || answer.length > LIMITS.answer || answers.length >= LIMITS.results) throw new Error('答案数量或长度超限');
      answers.push({ answer, question: `第${answers.length + 1}题`, pattern: pair.questionType, file: sample.entry ? 'ZIP · ' + sample.entry : 'AI 答案获取', provenance: { request: sample.method + ' ' + new URL(sample.url).pathname, entry: sample.entry || null, policy: require('./request').digest(pair), offset: match.index } });
    }
    process.send({ success: true, matched: true, answers });
  } catch (error) { process.send({ success: false, error: error.message }); }
});
process.send({ ready: true });
