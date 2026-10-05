const moduleLog = require('../logging').create('规则');
const fs = require('fs-extra');

class RuleEngine {
  constructor(rulesManager, actions = {}) {
    this.rulesManager = rulesManager;
    this.actions = actions;
  }
  urlMatchesPattern(url, pattern) {
    if (!pattern || typeof pattern !== 'string') return false;
    // ZIP 规则通常以 .zip 结尾；签名查询参数不应阻止匹配下载路径。
    if (/\.zip$/i.test(pattern)) url = url.split(/[?#]/, 1)[0];
    // 将通配符模式转换为正则表达式
    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
      .replace(/\\\*\\\*/g, '.*') // 先处理 ** 替换为匹配任意字符（包括斜杠）
      .replace(/\\\*/g, '[^/]*'); // 再处理单个 * 替换为匹配非斜杠的任意字符

    const regex = new RegExp('^' + regexPattern + '$');
    return regex.test(url);
  }

  urlMentionedByEnabledRules(url) {
    try {
      for (const ruleset of this.rulesManager.getRules()) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (!rule.enabled) continue;
          const fields = [rule.urlPattern, rule.urlZip, rule.urlFileinfo, rule.urlUpload, rule.urlRequest];
          for (const field of fields) {
            if (!field || typeof field !== 'string' || field.trim().length < 3) continue;
            const trimmed = field.trim();
            // 兼容通配符模式与普通子串（域名/路径）两种写法
            if (this.urlMatchesPattern(url, trimmed)) return true;
            if (url.includes(trimmed)) return true;
          }
        }
      }
    } catch (error) {
      moduleLog.error('检查规则提及 URL 失败:', error);
    }
    return false;
  }

  isRuleEffective(rule, ruleset) {
    if (!rule.enabled) return false;
    if (ruleset && !ruleset.enabled) return false;
    if (rule.maxTriggers !== undefined && rule.maxTriggers > 0) {
      const currentTriggers = rule.currentTriggers || 0;
      if (currentTriggers >= rule.maxTriggers) {
        return false;
      }
    }
    return true;
  }

  _isFileInfoRequest(url) {
    return url.includes('/fileinfo/') ||
      (url.includes('/files/') && !url.endsWith('.zip')) ||
      (url.includes('.json') && (url.includes('/fileinfo/') || url.includes('/files/')));
  }

  _isFileDownloadRequest(url) {
    return /\.zip(?:[?#]|$)/i.test(url) ||
      url.includes('/download/') ||
      url.includes('/cn/files/');
  }

  haveRules(url, type) {
    let l = [];
    try {
      for (const ruleset of this.rulesManager.getRules()) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          // 已完成 fileinfo 的动态注入仍要交付 ZIP，触发次数不能切断后半程。
          if (!this.isRuleEffective(rule, ruleset) && !(rule.enabled && rule.type === 'zip-implant-dynamic' && this._isFileDownloadRequest(url))) continue;
          if (rule.type === 'content-change') {
            if (!url.includes(rule.urlPattern)) continue;
            if (type !== rule.changeType) continue;
            l.push(1)
          }
          if (type === 'response-body' && rule.type === 'zip-implant') {
            if (!fs.existsSync(rule.zipImplant)) {
              continue;
            }

            const zipUrlMatches = this.urlMatchesPattern(url, rule.urlZip);

            const fileinfoUrlMatches = rule.urlFileinfo ? this.urlMatchesPattern(url, rule.urlFileinfo) : true;

            const isFileInfoRequest = this._isFileInfoRequest(url);

            const isFileDownloadRequest = this._isFileDownloadRequest(url);

            if ((isFileInfoRequest && fileinfoUrlMatches) || (zipUrlMatches && isFileDownloadRequest)) {
              l.push(2)
            }
          }
          if (type === 'response-body' && rule.type === 'answer-upload') {
            if (!url.includes(rule.urlUpload)) continue;

            l.push(3)
          }
          // TTS 规则：只要有启用的 tts-generate 规则就触发答案处理流程
          if (type === 'response-body' && rule.type === 'tts-generate') {
            l.push(3);
          }
          if (type === 'response-body' && rule.type === 'zip-implant-dynamic') {
            const fileinfoUrlMatches = rule.urlFileinfo ? this.urlMatchesPattern(url, rule.urlFileinfo) : false;
            const isFileInfoRequest = this._isFileInfoRequest(url);

            const zipUrlMatches = rule.urlZip ? this.urlMatchesPattern(url, rule.urlZip) : false;
            const isFileDownloadRequest = this._isFileDownloadRequest(url);

            if ((isFileInfoRequest && fileinfoUrlMatches) || (zipUrlMatches && isFileDownloadRequest)) {
              l.push(4);
            }
          }
        }
      }
    } catch (error) {
      moduleLog.error('获取需要应用的规则失败:', error);
      return [];
    }
    return l;
  }

  fileNameMatchesPattern(fileName, pattern) {
    if (!pattern) return true;

    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*');

    const regex = new RegExp('^' + regexPattern + '$', 'i');
    return regex.test(fileName);
  }

  *matchingRules(url, type, changeType) {
    for (const ruleset of this.rulesManager.getRules()) {
      for (const rule of ruleset.rules) {
        if (!this.isRuleEffective(rule, ruleset) || rule.type !== type) continue;
        if (changeType && rule.changeType !== changeType) continue;
        if (rule.urlPattern && url.includes(rule.urlPattern)) yield rule;
      }
    }
  }

  dispatchAnswers(url, responseBody, extracted) {
    let handled = false;
    for (const ruleset of this.rulesManager.getRules()) {
      for (const rule of ruleset.rules) {
        if (!this.isRuleEffective(rule, ruleset)) continue;
        try {
          if (rule.type === 'answer-upload' && url.includes(rule.urlUpload)) {
            if (!this.actions.answer) continue;
            this.actions.answer(rule, url, responseBody, extracted);
            handled = true;
            if (rule.maxTriggers !== undefined) {
              rule.currentTriggers = (rule.currentTriggers || 0) + 1;
              this.rulesManager.saveRules();
            }
          } else if (rule.type === 'tts-generate') {
            this.actions.tts?.(rule, url, extracted);
          }
        } catch (error) {
          moduleLog.error('执行规则失败:', rule.name, error);
        }
      }
    }
    return handled;
  }
}
module.exports = RuleEngine;
