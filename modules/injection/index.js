const moduleLog = require('../logging').create('注入');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class InjectionManager {
  constructor(options) {
    Object.assign(this, options);
    this.dynamicInjectTemp = new Map();
    this.workDirectories = new Set();
    this.queue = Promise.resolve();
    this.start();
  }
  start() { this.stopped = false; this.abortController = new AbortController(); }
  enqueue(operation) {
    const job = this.queue.then(() => this.stopped ? null : operation());
    this.queue = job.catch(() => {});
    return job;
  }
  async stop() {
    this.stopped = true;
    this.abortController.abort();
    clearTimeout(this.closeTimer);
    await this.queue.catch(() => {});
    clearTimeout(this.closeTimer);
    this.closeProgressWindow();
    this.dynamicInjectTemp.clear();
    if (require('../config').get('keep-cache-files') !== 'true') {
      for (const directory of this.workDirectories) await this.removeWorkDirectory(directory);
    }
    this.workDirectories.clear();
  }
  async removeWorkDirectory(directory) {
    const root = path.resolve(this.tempDir, 'dynamic-inject');
    if (path.dirname(path.resolve(directory)) !== root) throw new Error('无效注入缓存目录');
    await fs.remove(directory);
    this.workDirectories.delete(directory);
  }
  cacheKey(rule, url) {
    const parsed = new URL(url);
    return JSON.stringify([rule.id, parsed.host, this.downloadIdentity(url)]);
  }
  downloadIdentity(url) {
    const parsed = new URL(url);
    // 只去掉已知 CDN 鉴权字段；文件 ID、版本等业务参数仍参与关联。
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:signature|expires|key-pair-id|auth_key|token|x-amz-.+|x-oss-.+|x-cos-.+)$/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    return parsed.pathname + '?' + parsed.searchParams.toString();
  }
  cachedDownload(rule, url) {
    const exact = this.dynamicInjectTemp.get(this.cacheKey(rule, url));
    if (exact) return exact;
    const identity = this.downloadIdentity(url);
    const matches = [...this.dynamicInjectTemp.values()].filter(entry => entry.ruleId === rule.id
      && entry.urls?.some(candidate => this.downloadIdentity(candidate) === identity
        && (new URL(candidate).host === new URL(url).host || this.ruleEngine.urlMatchesPattern(url, rule.urlZip))));
    // CDN 域名变化可以关联同一路径；有多个候选时不返回任意一个包。
    return matches.length === 1 ? matches[0] : null;
  }
  scheduleClose(delay) {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.closeProgressWindow(), delay);
  }
  async pruneCache() {
    for (const [key, value] of this.dynamicInjectTemp) {
      if (Date.now() - value.timestamp <= 300000 && await fs.pathExists(value.zipPath)) continue;
      this.dynamicInjectTemp.delete(key);
      if (require('../config').get('keep-cache-files') !== 'true') await this.removeWorkDirectory(value.directory);
    }
  }
}
Object.assign(InjectionManager.prototype, require('./archive'), require('./window'), {
_replaceFileInfoFields(bodyStr, md5, fileSize) {
    bodyStr = bodyStr.replace(/"filemd5"\s*:\s*"[^"]*"/g, `"filemd5":"${md5}"`);
    bodyStr = bodyStr.replace(/"objectMD5"\s*:\s*"[^"]*"/g, `"objectMD5":"${md5}"`);
    bodyStr = bodyStr.replace(/"filesize"\s*:\s*\d+/g, `"filesize":${fileSize}`);
    bodyStr = bodyStr.replace(/"filesize"\s*:\s*"\d+"/g, `"filesize":"${fileSize}"`);
    bodyStr = bodyStr.replace(/"objectSize"\s*:\s*\d+/g, `"objectSize":${fileSize}`);
    bodyStr = bodyStr.replace(/"objectSize"\s*:\s*"\d+"/g, `"objectSize":"${fileSize}"`);
    return bodyStr;
  },


async applyZipImplantRules(url, responseBody) {
    try {
      for (const ruleset of this.rulesManager.getRules()) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (!this.ruleEngine.isRuleEffective(rule, ruleset)) continue;
          if (rule.type === 'zip-implant') {
            if (!await fs.pathExists(rule.zipImplant)) {
              continue;
            }

            const zipUrlMatches = this.ruleEngine.urlMatchesPattern(url, rule.urlZip);

            const fileinfoUrlMatches = rule.urlFileinfo ? this.ruleEngine.urlMatchesPattern(url, rule.urlFileinfo) : true;

            const isFileInfoRequest = this.ruleEngine._isFileInfoRequest(url);

            const isFileDownloadRequest = this.ruleEngine._isFileDownloadRequest(url);

            if (isFileInfoRequest && fileinfoUrlMatches) {
              if (rule.targetFileName) {
                const extractedFileName = this.extractFileNameFromResponse(responseBody, url);
                if (!extractedFileName || !this.ruleEngine.fileNameMatchesPattern(extractedFileName, rule.targetFileName)) {
                  continue;
                }
              }

              const { md5, size: fileSize } = await this.describeZip(rule.zipImplant);

              responseBody = this._replaceFileInfoFields(responseBody.toString(), md5, fileSize);

              if (this.analyticsManager) {
                this.analyticsManager.capture('zip_implant_applied', { rule_type: 'fileinfo' });
              }

              if (rule.maxTriggers !== undefined) {
                rule.currentTriggers = (rule.currentTriggers || 0) + 1;
                this.rulesManager.saveRules();
              }

              return Buffer.from(responseBody);
            }
            else if (zipUrlMatches && isFileDownloadRequest) {
              if (this.analyticsManager) {
                this.analyticsManager.capture('zip_implant_applied', { rule_type: 'download' });
              }

              if (rule.maxTriggers !== undefined) {
                rule.currentTriggers = (rule.currentTriggers || 0) + 1;
                this.rulesManager.saveRules();
              }

              return await fs.readFile(rule.zipImplant);
            }
          }
        }
      }
    } catch (error) {
      moduleLog.error('应用zip注入规则失败:', error);
    }

    return responseBody;
  },

async applyDynamicInjectRules(url, responseBody) {
    try {
      const isFileInfoRequest = this.ruleEngine._isFileInfoRequest(url);
      const isFileDownloadRequest = this.ruleEngine._isFileDownloadRequest(url);

      for (const ruleset of this.rulesManager.getRules()) {
        if (!ruleset.enabled) continue;
        for (const rule of ruleset.rules) {
          if (rule.type !== 'zip-implant-dynamic') continue;
          if (!this.ruleEngine.isRuleEffective(rule, ruleset) && !(rule.enabled && isFileDownloadRequest)) continue;

          const fileinfoUrlMatches = rule.urlFileinfo ? this.ruleEngine.urlMatchesPattern(url, rule.urlFileinfo) : false;
          const zipUrlMatches = rule.urlZip ? this.ruleEngine.urlMatchesPattern(url, rule.urlZip) : false;

          if (isFileInfoRequest && fileinfoUrlMatches) {
            if (this.analyticsManager) {
              this.analyticsManager.capture('dynamic_inject_applied', { phase: 'fileinfo' });
            }
            const job = this.enqueue(async () => {
              await this.pruneCache();
              clearTimeout(this.closeTimer);
              return this.handleDynamicInjectFileInfo(url, responseBody, rule);
            });
            return (await job) ?? responseBody;
          }

          if (zipUrlMatches && isFileDownloadRequest) {
            if (this.analyticsManager) {
              this.analyticsManager.capture('dynamic_inject_applied', { phase: 'download' });
            }
            const result = await this.enqueue(() => this.handleDynamicInjectZipDownload(url, rule));
            if (result !== null) return result;
          }
        }
      }
    } catch (error) {
      moduleLog.error('应用动态注入规则失败:', error);
      this.sendProgress('error', '动态注入失败: ' + error.message);
      this.closeProgressWindow();
    }
    return responseBody;
  },

async handleDynamicInjectFileInfo(url, responseBody, rule) {
    let injectDir, cached = false;
    try {
      let bodyStr = responseBody.toString();
      let jsonData;
      try {
        jsonData = JSON.parse(bodyStr);
      } catch (e) {
        return responseBody;
      }

      let objectName = jsonData.objectName || jsonData.object_name || '';
      if (jsonData.data) {
        objectName = objectName || jsonData.data.objectName || jsonData.data.object_name || '';
      }

      if (rule.targetFileName && !this.ruleEngine.fileNameMatchesPattern(objectName, rule.targetFileName)) {
        return responseBody;
      }

      let downloadUrl = jsonData.downloadUrl || jsonData.download_url || '';
      if (jsonData.data) {
        downloadUrl = downloadUrl || jsonData.data.downloadUrl || jsonData.data.download_url || '';
      }

      if (!downloadUrl) {
        this.safeIpcSend('rule-log', moduleLog.event({ type: 'error', message: `动态注入: 未找到downloadUrl` }));
        return responseBody;
      }

      this.showProgressWindow();

      const requestKey = this.cacheKey(rule, downloadUrl);
      this.sendProgress('downloading', '正在下载原始ZIP...', 10);

      const timeout = rule.downloadTimeout || 30000;
      injectDir = path.join(this.tempDir, 'dynamic-inject', crypto.randomUUID());
      this.workDirectories.add(injectDir);
      await fs.ensureDir(injectDir);

      const originalZipPath = path.join(injectDir, 'original.zip');
      const urls = [downloadUrl];
      await this.downloadWithTimeout(downloadUrl, originalZipPath, timeout, 0, Date.now() + timeout, this.abortController.signal, redirected => urls.push(redirected));

      this.sendProgress('extracting', '正在解压ZIP...', 30);
      const extractDir = path.join(injectDir, 'extracted');
      await fs.ensureDir(extractDir);

      await this.extractZip(originalZipPath, extractDir);

      this.sendProgress('injecting', '正在注入脚本...', 50);
      const injectScriptPaths = await this.resolveInjectScripts(rule);
      if (!injectScriptPaths || injectScriptPaths.length === 0) {
        this.safeIpcSend('rule-log', moduleLog.event({ type: 'error', message: `动态注入: 未找到有效注入脚本` }));
        this.closeProgressWindow();
        return responseBody;
      }

      const htmlFiles = await this.findAllHtmlFiles(extractDir);
      if (htmlFiles.length === 0) {
        this.safeIpcSend('rule-log', moduleLog.event({ type: 'warning', message: '动态注入: 未找到HTML文件' }));
        this.closeProgressWindow();
        return responseBody;
      }

      // 注入的脚本跑在页面里，拿不到主进程的配置。bucket 端口是可以改的
      // （见 setBucketPort），脚本里写死端口一旦用户改过就全链路失联，
      // 所以在脚本头部塞一段运行时配置，让它自己读。
      const runtimePrelude =
        '/* Auto366 注入运行时配置（由代理层在注入时写入） */\n' +
        'window.__A366__ = ' + JSON.stringify({
          bucket: 'http://127.0.0.1:' + this.getPort(),
          bucketPort: this.getPort(),
        }) + ';\n';

      const scripts = [];
      for (const scriptPath of injectScriptPaths) {
        scripts.push({ name: path.basename(scriptPath), content: runtimePrelude + await fs.readFile(scriptPath, 'utf8') });
      }
      for (const htmlFile of htmlFiles) {
        if (this.stopped) return responseBody;
        for (const script of scripts) {
          await this.injectScriptIntoHtml(htmlFile, script.name);
          await fs.writeFile(path.join(path.dirname(htmlFile), script.name), script.content, 'utf8');
        }
      }

      this.sendProgress('packing', '正在重新打包...', 70);
      const injectedZipPath = path.join(injectDir, 'injected.zip');
      await this.repackZip(extractDir, injectedZipPath);

      this.sendProgress('modifying', '正在修改响应...', 90);
      const { md5: injectedMd5, size: injectedSize } = await this.describeZip(injectedZipPath);
      if (this.stopped) return responseBody;
      const previous = this.dynamicInjectTemp.get(requestKey);
      this.dynamicInjectTemp.set(requestKey, {
        zipPath: injectedZipPath, directory: injectDir, md5: injectedMd5,
        size: injectedSize, timestamp: Date.now(), downloadUrl, objectName, ruleId: rule.id, urls,
      });
      cached = true;
      if (previous && require('../config').get('keep-cache-files') !== 'true') await this.removeWorkDirectory(previous.directory);

      bodyStr = this._replaceFileInfoFields(bodyStr, injectedMd5, injectedSize);

      if (rule.maxTriggers !== undefined) {
        rule.currentTriggers = (rule.currentTriggers || 0) + 1;
        this.rulesManager.saveRules();
      }

      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'success',
        message: `动态注入完成: ${objectName} → ${htmlFiles.length}个HTML已注入`,
        ruleId: rule.id,
        ruleName: rule.name
      }));

      this.sendProgress('done', '动态注入完成', 100);
      this.scheduleClose(1500);

      return Buffer.from(bodyStr);
    } catch (error) {
      moduleLog.error('处理动态注入fileinfo失败:', error);
      this.safeIpcSend('rule-log', moduleLog.event({ type: 'error', message: `动态注入失败: ${error.message}` }));
      this.sendProgress('error', '失败: ' + error.message);
      this.scheduleClose(3000);
      return responseBody;
    } finally {
      if (injectDir && !cached) await this.removeWorkDirectory(injectDir).catch(error => moduleLog.warn('清理注入缓存失败：', error));
    }
  },

async handleDynamicInjectZipDownload(url, rule) {
    // 同一规则可对应多个下载，不能只按规则 ID 返回最后一个 ZIP。
    await this.pruneCache();
    const entry = this.cachedDownload(rule, url);
    if (entry) {
      this.safeIpcSend('rule-log', moduleLog.event({
        type: 'success',
        message: `动态注入: 返回已注入的ZIP (${entry.md5})`,
        ruleId: rule.id,
        ruleName: rule.name
      }));
      return await fs.readFile(entry.zipPath);
    }

    this.safeIpcSend('rule-log', moduleLog.event({
      type: 'warning',
      message: '动态注入: 未找到已处理的ZIP，返回原始响应'
    }));
    return null;
  },

async resolveInjectScripts(rule) {
    const scripts = Array.isArray(rule.injectScripts) && rule.injectScripts.length
      ? rule.injectScripts : [rule.injectScript || path.join('rulesets', 'auto-listening', 'auto-listening.js')];
    const paths = [];
    for (const script of scripts) {
      const resolved = path.resolve(this.appPath, script);
      if (await fs.pathExists(resolved)) paths.push(resolved);
      else if (await fs.pathExists(script)) paths.push(script);
    }
    return paths;
  },
});
module.exports = InjectionManager;
