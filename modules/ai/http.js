const { readBody, json } = require('../local-server/io');

module.exports = function createHandlers(ai) {
  return {
    config(_req, res) { json(res, ai.getAiConfig()); },
    async ask(req, res) {
      const { question, candidates, timeout } = JSON.parse(await readBody(req) || '{}');
      if (!question || !Array.isArray(candidates) || !candidates.length) {
        return json(res, { success: false, error: 'question/candidates 缺失' }, 400);
      }
      const result = await ai.askChoice(question, candidates, { timeout });
      json(res, { success: true, index: result.index, text: result.text, ms: result.ms });
    },
  };
};
