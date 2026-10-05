const moduleLog = require('../logging').create('答案输出');

class AnswerOutput {
  constructor({ answerExtractor, analyticsManager, safeIpcSend }) {
    Object.assign(this, { answerExtractor, analyticsManager, safeIpcSend });
    this.data = Object.create(null);
  }
  has(pathname) { return Object.hasOwn(this.data, pathname); }
  get(pathname) { return this.data[pathname]; }
  paths() { return Object.keys(this.data); }
  publish(rule, url, responseBody, extracted_answers) {
    if (this.analyticsManager) {
      this.analyticsManager.capture('answer_upload_applied', { upload_type: rule.uploadType });
    }

    if (rule.uploadType === 'original') {
      try {
        const newData = JSON.parse(responseBody.toString());
        const existingData = this.data[rule.serverLocate];
        
        if (rule.serverLocate === '/word-pk-answer' && 
            existingData && 
            Array.isArray(existingData.data) && 
            Array.isArray(newData.data) &&
            Array.isArray(existingData.data[0]?.entryList)) {
          const existingEntryIds = new Set();
          for (const dict of existingData.data) {
            if (Array.isArray(dict.entryList)) {
              for (const entry of dict.entryList) {
                existingEntryIds.add(entry.entryId);
              }
            }
          }
          let newCount = 0;
          for (const dict of newData.data) {
            if (Array.isArray(dict.entryList)) {
              for (const entry of dict.entryList) {
                if (!existingEntryIds.has(entry.entryId)) {
                  existingData.data[0].entryList.push(entry);
                  existingEntryIds.add(entry.entryId);
                  newCount++;
                }
              }
            }
          }
          const totalCount = existingData.data[0].entryList.length;
          this.safeIpcSend('rule-log', moduleLog.event({ type: 'success', message: `[词库合并] 新增 ${newCount} 个词条，总计 ${totalCount} 个` }));
        } else {
          this.data[rule.serverLocate] = newData;
          this.safeIpcSend('rule-log', moduleLog.event({ type: 'info', message: `[词库存储] 存储数据到 ${rule.serverLocate}` }));
        }
      }
      catch (error) {
        this.data[rule.serverLocate] = responseBody;
      }
    }
    else if (rule.uploadType === 'json-xml-extracted') {
      const extracted = this.answerExtractor.extractFromJsonResponse(responseBody.toString());
      this.data[rule.serverLocate] = extracted;
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'success',
        message: `规则 "${rule.name}" 解析JSON内嵌XML答案: ${extracted.length} 个`,
        url
      }));
    }
    else {
      this.data[rule.serverLocate] = extracted_answers.answers;
    }

  }
}
module.exports = AnswerOutput;
