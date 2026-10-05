const moduleLog = require('../logging').create('响应替换');
const fs = require('fs-extra');
const path = require('path');

class ContentChange {
  constructor({ ruleEngine, appPath, getPort, isTextualContentType, safeIpcSend }) {
    Object.assign(this, { ruleEngine, appPath, getPort, isTextualContentType, safeIpcSend });
  }
  resolveContentChangeFile(rule) {
    if (!rule.newContentFile) return null;
    if (path.isAbsolute(rule.newContentFile)) return rule.newContentFile;
    if (rule.rulesetDir) {
      const p = path.join(rule.rulesetDir, rule.newContentFile);
      if (fs.existsSync(p)) return p;
    }
    const appPathFile = path.resolve(this.appPath, rule.newContentFile);
    return fs.existsSync(appPathFile) ? appPathFile : null;
  }

  applyContentChangeRules(url, responseBody, contentType) {
    try {
      if (!this.isTextualContentType(contentType || '')) return responseBody;
      let text = responseBody.toString('utf-8');
      let changed = false;

      for (const rule of this.ruleEngine.matchingRules(url, 'content-change', 'response-body')) {
        // 文件型替换源：动态读取文件内容，文件不存在则跳过该规则（避免把响应清空）
        let newContent = rule.newContent;
        if (rule.newContentFile) {
          const ccFile = this.resolveContentChangeFile(rule);
          if (ccFile && fs.existsSync(ccFile)) {
            newContent = fs.readFileSync(ccFile, 'utf-8');
          } else {
            moduleLog.warn('内容替换文件不存在，跳过规则:', rule.newContentFile);
            continue;
          }
        }

        const modifyRules = Array.isArray(rule.modifyRules) && rule.modifyRules.length
          ? rule.modifyRules
          : [{ find: rule.originalContent, replace: newContent }];

        // 整页替换（find 为空）只对 HTML 文档生效：避免 urlPattern 匹配到的该域下
        // js/css 等资源也被整页替换成 HTML 页面，导致 "Unexpected token '<'"。
        const ct = String(contentType || '').toLowerCase();
        const isHtmlDoc = ct.includes('text/html') || ct.includes('application/xhtml+xml');

        let applied = false;
        for (const mr of modifyRules) {
          if (!mr || mr.find === undefined) continue;
          const find = String(mr.find);
          const replace = mr.replace === undefined ? '' : String(mr.replace);
          if (find === '' && !isHtmlDoc) continue;
          if (find === '') {
            text = replace; // 空 find = 整页替换
          } else {
            text = text.split(find).join(replace);
          }
          applied = true;
        }
        if (applied) {
          changed = true;
        } else {
          continue;
        }

        this.safeIpcSend('rule-log', moduleLog.event({
          type: 'success',
          message: `响应替换: "${rule.name}"`,
          ruleId: rule.id,
          ruleName: rule.name,
          url: url
        }));
      }

      // 运行时配置注入：把占位符替换为当前 bucket 端口，让页面内联桥用的转发地址与用户设置一致
      if (text.indexOf('__A366_BUCKET_PORT__') !== -1) {
        text = text.split('__A366_BUCKET_PORT__').join(String(this.getPort() || 5290));
        changed = true;
      }

      return changed ? Buffer.from(text, 'utf-8') : responseBody;
    } catch (error) {
      moduleLog.error('应用响应替换规则失败:', error);
      return responseBody;
    }
  }
}
module.exports = ContentChange;
