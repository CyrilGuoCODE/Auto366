const moduleLog = require('../logging').create('代理');
const fs = require('fs-extra');
const crypto = require('crypto');
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

module.exports = {
getPostChangeTimeRules(url, method) {
    const rules = [];
    for (const ruleset of this.rulesManager.getRules()) {
      if (!ruleset.enabled) continue;
      for (const rule of ruleset.rules) {
        if (!this.ruleEngine.isRuleEffective(rule, ruleset)) continue;
        if (rule.type !== 'post-change-time') continue;
        if (rule.method && rule.method !== method) continue;
        if (!this.ruleEngine.urlMatchesPattern(url, rule.urlRequest)) continue;
        rules.push(rule);
      }
    }
    return rules;
  },

applyPostChangeTime(bodyText, rule, url, contentType) {
    if (!contentType || !contentType.includes('application/x-www-form-urlencoded')) {
      return bodyText;
    }

    const formFields = [];
    let tasksJsonRaw = null;

    for (const pair of bodyText.split('&')) {
      if (!pair.includes('=')) continue;
      const eqIndex = pair.indexOf('=');
      const key = pair.substring(0, eqIndex);
      const value = pair.substring(eqIndex + 1);
      if (key === 'tasksJson') {
        tasksJsonRaw = decodeURIComponent(value);
      } else if (key === 'ut') {
      } else {
        formFields.push([key, value]);
      }
    }

    if (tasksJsonRaw === null) return bodyText;

    const secondsMatch = tasksJsonRaw.match(/"seconds":(\d+)/);
    const originalSeconds = secondsMatch ? secondsMatch[1] : '未找到';

    const modifiedTasksJson = tasksJsonRaw.replace(
      /"seconds":\d+/g,
      `"seconds":${rule.targetSeconds}`
    );
    const newUt = this.calculateUt(modifiedTasksJson, rule.salt);

    const parts = ['tasksJson=' + encodeURIComponent(modifiedTasksJson)];
    for (const [k, v] of formFields) {
      parts.push(k + '=' + v);
    }
    parts.push('ut=' + newUt);

    this.safeIpcSend('rule-log', moduleLog.event({
      type: 'success',
      message: `规则 "${rule.name}" 修改任务提交时间`,
      ruleId: rule.id,
      url,
      details: `seconds: ${originalSeconds} → ${rule.targetSeconds}`
    }));

    return parts.join('&');
  },

calculateUt(tasksJsonRaw, salt) {
    const timestampMs = String(Date.now());
    const r = crypto.createHash('md5').update(timestampMs).digest('hex');
    const i = crypto.createHash('md5').update(tasksJsonRaw).digest('hex');
    const n = crypto.createHash('md5').update(i + salt + r).digest('hex');
    return r.slice(0, 10) + n + r.slice(10);
  },

shouldApplyListenTime(url, method) {
    if (!this.listenTime || this.listenTime.enabled !== true) return false;
    if (this.listenTime.seconds === null || this.listenTime.seconds === undefined) return false;
    if (method && method !== 'POST') return false;
    return url.indexOf('task/score/submit') !== -1;
  },

shouldApplyFillTime(url, method) {
    if (!this.fillTimeMod || this.fillTimeMod.enabled !== true) return false;
    if (this.fillTimeMod.seconds === null || this.fillTimeMod.seconds === undefined) return false;
    if (method && method !== 'POST') return false;
    // 听力时间修改已启用时不重复处理（听力有独立salt，优先级更高）
    if (this.listenTime && this.listenTime.enabled === true && this.listenTime.seconds !== null) return false;
    if (url.includes('task/score/gzip/submit')) return true;
    if (this.activeFillSubmitUrl && url.includes(this.activeFillSubmitUrl)) return true;
    if (this.fillTimeMod.fillSubmitUrl && url.includes(this.fillTimeMod.fillSubmitUrl)) return true;
    return false;
  },

applyFillTimeMod(bodyText, url, contentType) {
    const isJson = contentType && contentType.includes('application/json');
    const isForm = contentType && contentType.includes('application/x-www-form-urlencoded');
    if (!isJson && !isForm) {
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'warning',
        message: `[填空时间] 命中提交，但content-type不支持(${contentType || '无'})，原样放行`,
        url
      }));
      return bodyText;
    }

    let targetSeconds = this.fillTimeMod.seconds;
    targetSeconds = Math.max(INT32_MIN, Math.min(INT32_MAX, targetSeconds));

    let tasksJsonRaw = null;
    let otherFields = {}; // for JSON: other top-level keys; for form: other form fields

    if (isJson) {
      // JSON body: {"tasksJson":"<url-encoded>","ut":"...","submitType":8}
      let jsonObj;
      try {
        jsonObj = JSON.parse(bodyText);
      } catch (e) {
        this.safeIpcSend('rule-log', moduleLog.event({
          type: 'warning',
          message: `[填空时间] JSON解析失败，原样放行: ` + e.message,
          url
        }));
        return bodyText;
      }
      if (!jsonObj.tasksJson) {
        this.safeIpcSend('rule-log', moduleLog.event({
          type: 'warning',
          message: `[填空时间] JSON body无tasksJson字段，原样放行`,
          url
        }));
        return bodyText;
      }
      tasksJsonRaw = jsonObj.tasksJson;
      // 保存其他字段（ut 要重新计算，其他字段保留）
      const { tasksJson, ut, ...rest } = jsonObj;
      otherFields = rest;
    } else {
      // Form body: tasksJson=<url-encoded>&ut=...&other=...
      const formFields = [];
      for (const pair of bodyText.split('&')) {
        if (!pair.includes('=')) continue;
        const eqIndex = pair.indexOf('=');
        const key = pair.substring(0, eqIndex);
        const value = pair.substring(eqIndex + 1);
        if (key === 'tasksJson') {
          tasksJsonRaw = decodeURIComponent(value);
        } else if (key === 'ut') {
          // 忽略旧ut，下面重算
        } else {
          formFields.push([key, value]);
        }
      }
      otherFields = { _formFields: formFields };
    }

    if (tasksJsonRaw === null) {
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'warning',
        message: `[填空时间] body无tasksJson字段，原样放行`,
        url
      }));
      return bodyText;
    }

    const secondsMatch = tasksJsonRaw.match(/"seconds":(\d+)/);
    const originalSeconds = secondsMatch ? parseInt(secondsMatch[1], 10) : null;

    let modifiedTasksJson = tasksJsonRaw.replace(
      /"seconds":\d+/g,
      `"seconds":${targetSeconds}`
    );

    // 同步修改 studyDate，让时间差与 seconds 一致（服务器以此校验实际用时）
    let studyDateDelta = 0;
    if (originalSeconds !== null) {
      const studyDateMatch = modifiedTasksJson.match(/"studyDate":(\d+)/);
      if (studyDateMatch) {
        const originalStudyDate = parseInt(studyDateMatch[1], 10);
        studyDateDelta = (targetSeconds - originalSeconds) * 1000;
        const newStudyDate = originalStudyDate + studyDateDelta;
        modifiedTasksJson = modifiedTasksJson.replace(
          /"studyDate":\d+/,
          `"studyDate":${newStudyDate}`
        );
      }
    }

    const newUt = this.calculateUt(modifiedTasksJson, this.FILL_TIME_SALT);

    this.safeIpcSend('rule-log', moduleLog.event({
      type: 'success',
      message: `[填空时间] 填空提交时间已修改 ✓`,
      url,
      details: `seconds: ${originalSeconds !== null ? originalSeconds : '?'} → ${targetSeconds} | studyDate${studyDateDelta >= 0 ? '+' : ''}${studyDateDelta}ms | ut已重算`
    }));

    if (isJson) {
      // 重新拼 JSON body
      const newJsonObj = {
        tasksJson: modifiedTasksJson,
        ut: newUt,
        ...otherFields
      };
      return JSON.stringify(newJsonObj);
    } else {
      // 重新拼 form body
      const parts = ['tasksJson=' + encodeURIComponent(modifiedTasksJson)];
      for (const [k, v] of otherFields._formFields) {
        parts.push(k + '=' + v);
      }
      parts.push('ut=' + newUt);
      return parts.join('&');
    }
  },

applyListenTime(bodyText, url, contentType) {
    if (!contentType || !contentType.includes('application/x-www-form-urlencoded')) {
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'warning',
        message: `[听力时间] 命中提交，但content-type非表单(${contentType || '无'})，原样放行`,
        url
      }));
      return bodyText;
    }

    let targetSeconds = this.listenTime.seconds;
    targetSeconds = Math.max(INT32_MIN, Math.min(INT32_MAX, targetSeconds));

    const formFields = [];
    let tasksJsonRaw = null;
    for (const pair of bodyText.split('&')) {
      if (!pair.includes('=')) continue;
      const eqIndex = pair.indexOf('=');
      const key = pair.substring(0, eqIndex);
      const value = pair.substring(eqIndex + 1);
      if (key === 'tasksJson') {
        tasksJsonRaw = decodeURIComponent(value);
      } else if (key === 'ut') {
        // 丢弃旧 ut，下面重算
      } else {
        formFields.push([key, value]);
      }
    }

    if (tasksJsonRaw === null) {
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'warning',
        message: `[听力时间] body无tasksJson字段，原样放行`,
        url
      }));
      return bodyText;
    }

    const secondsMatch = tasksJsonRaw.match(/"seconds":(\d+)/);
    const originalSeconds = secondsMatch ? secondsMatch[1] : '未找到';

    const modifiedTasksJson = tasksJsonRaw.replace(
      /"seconds":\d+/g,
      `"seconds":${targetSeconds}`
    );
    const newUt = this.calculateUt(modifiedTasksJson, this.LISTEN_TIME_SALT);

    const parts = ['tasksJson=' + encodeURIComponent(modifiedTasksJson)];
    for (const [k, v] of formFields) {
      parts.push(k + '=' + v);
    }
    parts.push('ut=' + newUt);

    this.safeIpcSend('rule-log', moduleLog.event({
      type: 'success',
      message: `[听力时间] 听力提交时间已修改 ✓`,
      url,
      details: `seconds: ${originalSeconds} → ${targetSeconds} | ut已重算`
    }));

    return parts.join('&');
  },

writeModifiedFormBody(ctx, modifiedBody, requestInfo) {
    ctx.proxyToServerRequest.removeHeader('transfer-encoding');
    ctx.proxyToServerRequest.removeHeader('content-encoding');
    ctx.proxyToServerRequest.setHeader('content-length', Buffer.byteLength(modifiedBody));
    ctx.proxyToServerRequest.write(modifiedBody);
    if (requestInfo) {
      try {
        const params = new URLSearchParams(modifiedBody);
        requestInfo.requestBody = JSON.stringify(Object.fromEntries(params.entries()), null, 2);
      } catch (e) {
        requestInfo.requestBody = modifiedBody;
      }
    }
  },

shouldApplyPkTimeMod(url, method) {
    if (!this.pkTimeMod || this.pkTimeMod.enabled !== true) return false;
    if (this.pkTimeMod.seconds === null || this.pkTimeMod.seconds === undefined) return false;
    if (method && method !== 'POST') return false;
    if (url.indexOf('word-king/submit') !== -1) return true;
    // 普通PK submit，排除 submit/practice 等非PK提交
    if (url.indexOf('wordsbtl/student/submit') !== -1
        && url.indexOf('/submit/practice') === -1) return true;
    return false;
  },

pkTimeModKindOf(url) {
    return url.indexOf('word-king/submit') !== -1 ? '词王争霸' : '普通PK';
  },

applyPkTimeMod(bodyText, url, contentType) {
    if (!contentType || !contentType.includes('application/x-www-form-urlencoded')) {
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'warning',
        message: `[时间修改] 命中${this.pkTimeModKindOf(url)}，但content-type非表单(${contentType||'无'})，原样放行`,
        url
      }));
      return bodyText;
    }

    let targetSeconds = this.pkTimeMod.seconds;
    targetSeconds = Math.max(INT32_MIN, Math.min(INT32_MAX, targetSeconds));
    const targetMs = targetSeconds * 1000;

    let params;
    try {
      params = new URLSearchParams(bodyText);
    } catch (e) {
      this.safeIpcSend('rule-log', moduleLog.event({ type: 'warning', message: `[时间修改] body解析失败，原样放行`, url }));
      return bodyText;
    }
    if (!params.has('submitJson')) {
      const keys = [];
      for (const k of params.keys()) keys.push(k);
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'warning',
        message: `[时间修改] body无submitJson字段，原样放行 | 实际字段:[${keys.join(', ')}]`,
        url
      }));
      return bodyText;
    }

    const rawSj = params.get('submitJson');
    let decoded = false;
    let sj;
    try {
      sj = JSON.parse(rawSj);
    } catch (e1) {
      try {
        sj = JSON.parse(decodeURIComponent(rawSj));
        decoded = true;
      } catch (e2) {
        this.safeIpcSend('rule-log', moduleLog.event({ type: 'warning', message: `[时间修改] submitJson解析失败，原样放行`, url }));
        return bodyText;
      }
    }

    const oldDuration = sj.duration;
    sj.duration = targetMs;

    const n = Array.isArray(sj.wordInfos) ? sj.wordInfos.length : 0;
    if (n > 0) {
      const spanMs = targetMs > 0 ? targetMs : 0;
      const baseStart = Date.now() - spanMs;
      const gap = n > 1 ? spanMs / (n - 1) : 0;
      let prev = -Infinity;
      for (let i = 0; i < n; i++) {
        const wi = sj.wordInfos[i];
        if (!wi || typeof wi !== 'object') continue;
        let t = Math.round(baseStart + gap * i);
        if (gap > 40) t += Math.floor((Math.random() - 0.5) * Math.min(gap * 0.3, 200));
        if (t <= prev) t = prev + 1;
        prev = t;
        if (typeof wi.answerTime !== 'undefined') wi.answerTime = t;
      }
    }

    const newSj = JSON.stringify(sj);
    params.set('submitJson', decoded ? encodeURIComponent(newSj) : newSj);

    this.safeIpcSend('rule-log', moduleLog.event({
      type: 'success',
      message: `[时间修改] ${this.pkTimeModKindOf(url)} 提交时间已修改 ✓`,
      url,
      details: `duration: ${oldDuration} → ${targetMs}ms (${targetSeconds}s) | 题数:${n}${decoded ? ' | IOS编码' : ''}`
    }));

    return params.toString();
  },

parseMp3Duration(buffer) {
    let offset = 0;

    // 跳过 ID3v2 头
    if (buffer.length >= 10 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      const id3Size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) |
                      ((buffer[8] & 0x7f) << 7)  | (buffer[9] & 0x7f);
      offset = 10 + id3Size;
    }

    // MPEG 比特率表 [version][layer][bitrateIndex]（单位 kbps）
    const bitrateTable = {
      1: { 1: [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448,0],
           2: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384,0],
           3: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0] },
      2: { 1: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256,0],
           2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
           3: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0] },
      2.5: { 1: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256,0],
             2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
             3: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0] }
    };
    const sampleRateTable = {
      1: [44100, 48000, 32000],
      2: [22050, 24000, 16000],
      2.5: [11025, 12000, 8000]
    };
    const samplesPerFrame = {
      1: { 1: 384, 2: 1152, 3: 1152 },
      2: { 1: 384, 2: 1152, 3: 1152 },
      2.5: { 1: 384, 2: 1152, 3: 1152 }
    };

    // 找第一个有效 MPEG 同步字
    let found = false;
    let version, layer, bitrateIndex, sampleRateIndex, padding;
    while (offset < buffer.length - 4) {
      if (buffer[offset] === 0xFF && (buffer[offset + 1] & 0xE0) === 0xE0) {
        const b1 = buffer[offset + 1];
        const b2 = buffer[offset + 2];
        const verBits = (b1 >> 3) & 0x03;
        const layerBits = (b1 >> 1) & 0x03;
        bitrateIndex = (b2 >> 4) & 0x0F;
        sampleRateIndex = (b2 >> 2) & 0x03;
        padding = (b2 >> 1) & 0x01;

        if (verBits === 3) version = 1;
        else if (verBits === 2) version = 2;
        else if (verBits === 0) version = 2.5;
        else { offset++; continue; }

        if (layerBits === 3) layer = 1;
        else if (layerBits === 2) layer = 2;
        else if (layerBits === 1) layer = 3;
        else { offset++; continue; }

        if (bitrateIndex === 0 || bitrateIndex === 15) { offset++; continue; }
        if (sampleRateIndex === 3) { offset++; continue; }

        found = true;
        break;
      }
      offset++;
    }
    if (!found) return null;

    // 检查 Xing/VBR 头
    const vbrOffset = offset + (version === 1 ? (layer === 3 ? 36 : 32) : (layer === 3 ? 21 : 17));
    if (vbrOffset + 12 < buffer.length) {
      const xingId = buffer.toString('ascii', vbrOffset, vbrOffset + 4);
      if (xingId === 'Xing' || xingId === 'Info') {
        const frameCount = buffer.readUInt32BE(vbrOffset + 8);
        if (frameCount > 0) {
          const sr = sampleRateTable[version]?.[sampleRateIndex];
          const spf = samplesPerFrame[version]?.[layer];
          if (sr && spf) {
            return frameCount * spf / sr;
          }
        }
      }
    }

    // CBR 回退：文件大小 / 比特率
    const bitrate = bitrateTable[version]?.[layer]?.[bitrateIndex];
    const sr = sampleRateTable[version]?.[sampleRateIndex];
    const spf = samplesPerFrame[version]?.[layer];
    if (!bitrate || !sr || !spf) return null;

    const frameSize = Math.floor(spf / 8 * bitrate * 1000 / sr + padding);
    const dataSize = buffer.length - offset;
    const frameCount = Math.floor(dataSize / frameSize);
    return frameCount * spf / sr;
  },

async calcListenTimePresetFromZip(zipPath) {
    const now = Date.now();
    for (const [key, value] of Object.entries(this.listenTimePresetCache)) {
      if (now - value.ts >= 60000) delete this.listenTimePresetCache[key];
    }
    // 检查缓存（1 分钟有效期）
    if (this.listenTimePresetCache[zipPath]) {
      const cached = this.listenTimePresetCache[zipPath];
      if (Date.now() - cached.ts < 60 * 1000) {
        return cached;
      }
    }

    // zip 文件不存在时直接返回失败
    if (!fs.existsSync(zipPath)) {
      return { success: false, error: 'zip_missing', message: 'ZIP 文件不存在: ' + zipPath };
    }
    while (Object.keys(this.listenTimePresetCache).length >= 32) {
      delete this.listenTimePresetCache[Object.keys(this.listenTimePresetCache)[0]];
    }

    const StreamZip = require('node-stream-zip');
    // skipEntryNameValidation: 兼容条目名以 / 开头的合法 ZIP（如 /0/res/xxx.mp3）
    const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
    try {
      const entries = await zip.entries();

      // 1. 获取 ZIP 内所有 mp3 文件（不限目录）
      // 2. 按 mp3 文件所在目录的"上三级目录"分组
      const questionsGroups = new Map();
      for (const entry of Object.values(entries)) {
        if (entry.isDirectory) continue;
        const name = entry.name;
        if (!/\.mp3$/i.test(name)) continue;
        // 取 mp3 所在目录
        const lastSlash = name.lastIndexOf('/');
        const fileDir = lastSlash >= 0 ? name.substring(0, lastSlash + 1) : '';
        // 上三级目录：去掉最后两级
        const parts = fileDir.split('/').filter(Boolean);
        // parts.length - 2 表示从文件所在目录向上两级
        const parentParts = parts.length > 2 ? parts.slice(0, parts.length - 2) : parts;
        const groupKey = parentParts.length > 0 ? parentParts.join('/') + '/' : '';
        if (!questionsGroups.has(groupKey)) questionsGroups.set(groupKey, []);
        questionsGroups.get(groupKey).push(entry);
      }

      const LISTEN_TIME_BASELINE = 360;
      const LISTEN_TIME_FILTER_THRESHOLD = 1000;
      const LISTEN_TIME_FILTER_MAX = 1380;
      const dirResults = [];

      for (const [dirKey, mp3Entries] of questionsGroups) {
        const durations = [];
        for (const entry of mp3Entries) {
          try {
            const data = await zip.entryData(entry.name);
            const dur = this.parseMp3Duration(data);
            if (dur !== null && dur > 0) durations.push(dur);
          } catch (e) {
            // 跳过无法解析的 mp3
          }
        }
        if (durations.length === 0) continue;
        const sumDurations = durations.reduce((a, b) => a + b, 0);
        const calc = Math.round(sumDurations * 2 + LISTEN_TIME_BASELINE);
        // 过滤不在 [1000, 1380] 区间内的分组（过小或过大都不采用）
        if (calc < LISTEN_TIME_FILTER_THRESHOLD || calc > LISTEN_TIME_FILTER_MAX) continue;
        dirResults.push({
          dir: dirKey,
          mp3Count: durations.length,
          sumDurations: Math.round(sumDurations * 10) / 10,
          calc
        });
      }

      if (dirResults.length === 0) {
        const result = { success: false, error: 'no_mp3_found', message: 'ZIP 内未找到 mp3 文件', ts: Date.now() };
        this.listenTimePresetCache[zipPath] = result;
        return result;
      }

      const minResult = dirResults.reduce((a, b) => a.calc < b.calc ? a : b);

      const result = {
        success: true,
        seconds: minResult.calc,
        source: 'zip:' + zipPath,
        detail: {
          questionsDirs: dirResults,
          baseline: LISTEN_TIME_BASELINE,
          selectedDir: minResult.dir,
          totalDirs: dirResults.length
        },
        ts: Date.now()
      };

      this.listenTimePresetCache[zipPath] = result;
      return result;
    } finally {
      await zip.close();
    }
  }
};
