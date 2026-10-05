const { readBody, json } = require('../local-server/io');

module.exports = function createHandlers(proxy) {
  const time = field => async (req, res) => {
    if (req.method === 'GET') return json(res, proxy[field]);
    const data = JSON.parse(await readBody(req));
    const value = parseInt(data.seconds, 10);
    const seconds = Number.isFinite(value) ? Math.max(-2147483648, Math.min(2147483647, value)) : null;
    proxy[field] = { enabled: data.enabled === true, seconds };
    if (field === 'fillTimeMod') proxy[field].fillSubmitUrl = data.fillSubmitUrl || null;
    json(res, { success: true, [field]: proxy[field] });
  };
  return {
    forward: async (req, res) => proxy.forwardApiRequest(await readBody(req), res),
    pkTime: time('pkTimeMod'),
    listenTime: time('listenTime'),
    fillTime: time('fillTimeMod'),
    async listenPreset(_req, res) {
      try {
        if (!proxy.lastZipPath) return json(res, { success: false, error: 'no_zip', message: '尚未检测到套题 ZIP' });
        const cached = proxy.listenTimePresetCache[proxy.lastZipPath];
        const result = cached && Date.now() - cached.ts < 60000
          ? cached : await proxy.calcListenTimePresetFromZip(proxy.lastZipPath);
        json(res, result);
      } catch (error) {
        json(res, { success: false, error: 'calc_failed', message: error.message });
      }
    },
  };
};
