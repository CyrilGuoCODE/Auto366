const fs = require('fs-extra');
const path = require('path');
const { readBody } = require('../local-server/io');

module.exports = function createHandlers(tts) {
  return {
    output(_req, res, { index }) {
      const filePath = tts.fileIndex.get(index);

      if (filePath && fs.existsSync(filePath)) {
        try {
          const stat = fs.statSync(filePath);
          const ext = path.extname(filePath).slice(1);
          const mime = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav';
          res.writeHead(200, {
            'Content-Type': mime,
            'Access-Control-Allow-Origin': '*',
            'Content-Length': stat.size,
          });
          fs.createReadStream(filePath).on('error', error => res.destroy(error)).pipe(res);
          return true;
        } catch (e) { /* 读取失败走 404 */ }
      }

      // 兼容：客户端请求 .wav 但实际文件是 .mp3（或反之），按 index 查找任何格式
      if (!filePath) {
        for (const ext of ['mp3', 'wav']) {
          const altPath = path.join(tts.cacheDir, `${index}.${ext}`);
          if (fs.existsSync(altPath)) {
            try {
              const stat = fs.statSync(altPath);
              const mime = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav';
              res.writeHead(200, {
                'Content-Type': mime,
                'Access-Control-Allow-Origin': '*',
                'Content-Length': stat.size,
              });
              fs.createReadStream(altPath).on('error', error => res.destroy(error)).pipe(res);
              // 同时更新 fileIndex 以便后续请求直接命中
              tts.fileIndex.set(index, altPath);
              return true;
            } catch (e) { /* 读取失败走 404 */ }
          }
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'TTS audio not found', index }));
      return true;
    },

    async setting(req, res, { basePath }) {

      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          voice: tts.config.voice, speed: tts.config.speed, basePath,
          availableVoices: Object.keys(tts.constructor.voices), voiceMap: tts.constructor.voices,
          generatedCount: tts.fileIndex.size,
          engine: tts.engine, activeEngine: tts.activeEngine, availableEngines: tts.constructor.engines,
          chestnutVoice: tts.config.chestnutVoice || null,
          glmVoice: tts.config.glmVoice || null }));
        return true;
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        try {
          const data = JSON.parse(body);
          const needRegenerate = tts.updateConfig(data);
          tts._saveConfig();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, voice: tts.config.voice, speed: tts.config.speed, basePath, needRegenerate }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return true;
      }

      return false;
    },

    status(_req, res) {

      const progress = tts.generationProgress;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        generating: tts.isGenerating,
        total: progress.total,
        generated: progress.generated,
        skipped: progress.skipped,
        generatedCount: tts.fileIndex.size,
        voice: tts.config.voice,
        speed: tts.config.speed,
        engine: tts.engine,
        activeEngine: tts.activeEngine,
        chestnutVoice: tts.config.chestnutVoice || null,
        glmVoice: tts.config.glmVoice || null,
      }));
      return true;
    },

    /*
     * {basePath}/list —— 朗读清单
     * 规则集用它把页面上的题目跟 {index}.wav 对上号：朗读类按 text 匹配页面文本，
     * 听后回答按 meta.question 匹配，两者都不中时按 meta.paperSeq 顺序兜底。
     */
    manifest(_req, res, { basePath }) {

      // 整批 TTS 可能要生成几十秒，但前面的题通常早已落盘。
      // 把逐题就绪状态交给规则集，不能用全局 ready 把已生成音频一起封住。
      const readyIndexes = Array.from(tts.fileIndex.keys())
        .filter(index => Number.isInteger(index))
        .sort((a, b) => a - b);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        basePath,
        generating: tts.isGenerating,
        ready: !tts.isGenerating && tts.fileIndex.size > 0,
        partialReady: readyIndexes.length > 0,
        generatedCount: readyIndexes.length,
        readyIndexes,
        approvalEnabled: tts.config.approvalEnabled !== false,
        approvalPending: tts.pendingApprovalQueue.length > 0 &&
          !tts.isGenerating && readyIndexes.length === 0,
        count: Array.isArray(tts.manifest) ? tts.manifest.length : 0,
        items: Array.isArray(tts.manifest) ? tts.manifest : [],
      }));
      return true;
    },

  };
};
