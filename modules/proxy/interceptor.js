const moduleLog = require('../logging').create('代理');
const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');
const Proxy = require('http-mitm-proxy').Proxy;
const CaptureBody = require('./capture');

module.exports = {
  async finishStreamedCapture(capture, info, url, learningInfo) {
    const name = this._resolveDownloadFileName(info, url);
    const isFile = /application\/octet-stream|application\/(x-)?zip|binary\/octet-stream|image/.test(info.contentType || '');
    info.responseBody = isFile ? name : this.isTextualContentType(info.contentType)
      ? capture.preview().toString('utf8') + '\n[大响应仅显示前 256 KiB，可下载完整原文]'
      : '[二进制响应，' + capture.size + ' 字节]';
    info.bodySize = capture.size;
    info.ruleMatched = this.ruleEngine.urlMentionedByEnabledRules(url);
    this.safeIpcSend('traffic-log', info);
    // 仅主进程保存磁盘引用，不传给 renderer。
    this.trafficCache.set(info.uuid, { ...info, captureBody: capture });
    if (this._looksLikeZip(capture.preview()) && (isFile || this.ruleEngine._isFileDownloadRequest(url))) {
      let extracted;
      const keep = require('../config').get('keep-cache-files') === 'true';
      let zipPath = capture.file;
      if (keep) {
        await fs.ensureDir(this.tempDir);
        zipPath = path.join(this.tempDir, info.uuid + '-' + this._safeFileName(name));
        await fs.copyFile(capture.file, zipPath);
      }
      try {
        extracted = await this.extractZipFile(zipPath, this.ansDir, info.uuid);
        if (learningInfo) await this.learnArchive(learningInfo, extracted);
      }
      finally {
        if (!keep && extracted?.extractDir) await fs.remove(extracted.extractDir);
      }
    }
  },
  async learnArchive(info, extracted) {
    try { await this.answerLearning?.observeArchive?.(info, extracted); }
    catch (error) { moduleLog.warn('ZIP AI 候选读取失败：', error.message); }
  },
startProxyPromise() {
    return new Promise((resolve, reject) => {
      // 执行maxTriggers数据迁移（幂等，仅首次生效）
      this.rulesManager.migrateMaxTriggers(this.appPath);

      // 创建新的代理实例
      this.proxy = new Proxy();

      this.proxy.onError((ctx, err) => {
        ctx?._releaseCapture?.().catch(() => {});
        this._speedRelease(ctx);  // 网络保护: 请求出错也要恢复加速, 防止卡在 1×
        moduleLog.error('代理出错:', err);
      });

      this.proxy.onRequest((ctx, callback) => {
        // Keep the legacy URL used by existing rule patterns; captures retain the actual scheme.
        const protocol = "http";
        const fullUrl = `${protocol}://${ctx.clientToProxyRequest.headers.host}${ctx.clientToProxyRequest.url}`;
        const captureUrl = `${ctx.isSSL ? 'https' : 'http'}://${ctx.clientToProxyRequest.headers.host}${ctx.clientToProxyRequest.url}`;

        const isAnswerCaptureEnabled = this.answerCaptureEnabled;

        let requestInfo = {
          method: ctx.clientToProxyRequest.method,
          url: captureUrl,
          host: ctx.clientToProxyRequest.headers.host,
          timestamp: new Date().toISOString(),
          isHttps: !!ctx.isSSL,
          requestHeaders: ctx.clientToProxyRequest.headers,
          uuid: uuidv4(),
        }

        if (!isAnswerCaptureEnabled) {
          return callback();
        }

        // 进程加速网络保护: 该 up366 请求在飞期间把倍率瞬时压回 1×, 响应结束再恢复,
        // 避免加速把 renderer 请求超时掐断(题目进不去/交卷失败)。与下方 onResponseEnd 配对。
        this._speedHold(ctx);

        let requestBody = [], responseBody = [], learningRequestBody = '';
        let requestBytes = 0, requestTruncated = false, captureBody = null, captureReleased = false, processingResponse = false;
        const releaseCapture = async () => {
          if (!captureBody || captureReleased) return;
          captureReleased = true;
          await captureBody.release();
        };
        ctx._releaseCapture = () => processingResponse ? Promise.resolve() : releaseCapture();
        ctx.clientToProxyRequest.once?.('aborted', () => ctx._releaseCapture().catch(() => {}));
        ctx.proxyToClientResponse.once?.('close', () => {
          if (!processingResponse) releaseCapture().catch(() => {});
        });
        const hasPostChangeTimeRule = this.getPostChangeTimeRules(fullUrl, ctx.clientToProxyRequest.method).length > 0;
        const hasPkTimeMod = this.shouldApplyPkTimeMod(fullUrl, ctx.clientToProxyRequest.method);
        const hasListenTime = this.shouldApplyListenTime(fullUrl, ctx.clientToProxyRequest.method);
        const hasFillTime = this.shouldApplyFillTime(fullUrl, ctx.clientToProxyRequest.method);
        // 需要拦截改写 body 的任一情形：post-change-time 规则 或 PK时间修改 或 听力时间修改 或 填空时间修改
        const needBufferBody = hasPostChangeTimeRule || hasPkTimeMod || hasListenTime || hasFillTime;

        ctx.onRequestData((ctx, chunk, callback) => {
          requestBytes += chunk.length;
          if (needBufferBody || requestBytes <= 2 * 1024 * 1024) requestBody.push(chunk);
          else requestTruncated = true;
          if (needBufferBody) return callback(null, null);
          return callback(null, chunk);
        })
        ctx.onRequestEnd(async (ctx, callback) => {
          try {
            if (requestTruncated) {
              requestInfo.requestBody = '[请求正文超过 2 MiB，已原样转发，省略正文记录]';
              requestBody = [];
              return callback();
            }
            let bodyBuffer = Buffer.concat(requestBody);
            requestBody = [];
            const reqEncoding = ctx.clientToProxyRequest.headers['content-encoding'];

            // 解压请求体（如果客户端发送了压缩数据）
            let body;
            if (reqEncoding) {
              const { text, decompressFailed } = await this.decompressBuffer(bodyBuffer, reqEncoding);
              if (decompressFailed) {
                requestInfo.requestBody = text;
                if (needBufferBody) ctx.proxyToServerRequest.write(bodyBuffer);
                return callback();
              }
              body = text;
            } else {
              body = bodyBuffer.toString();
            }
            // Preserve the original form/JSON shape for fingerprinting before display formatting.
            learningRequestBody = body;

            if (hasPostChangeTimeRule) {
              const rules = this.getPostChangeTimeRules(fullUrl, ctx.clientToProxyRequest.method);
              const rule = rules[0];
              const modifiedBody = this.applyPostChangeTime(body, rule, fullUrl, ctx.clientToProxyRequest.headers['content-type']);
              this.writeModifiedFormBody(ctx, modifiedBody, requestInfo);
              return callback();
            }

            // ===== 时间修改：改写 submit 提交用时 =====
            if (hasPkTimeMod) {
              const modifiedBody = this.applyPkTimeMod(body, fullUrl, ctx.clientToProxyRequest.headers['content-type']);
              this.writeModifiedFormBody(ctx, modifiedBody, requestInfo);
              return callback();
            }

            // ===== 听力时间修改：改写听力作业提交用时 =====
            if (hasListenTime) {
              const modifiedBody = this.applyListenTime(body, fullUrl, ctx.clientToProxyRequest.headers['content-type']);
              this.writeModifiedFormBody(ctx, modifiedBody, requestInfo);
              return callback();
            }

            // ===== 填空时间修改：改写填空作业提交用时 =====
            if (hasFillTime) {
              const isGzipFillSubmit = fullUrl.includes('task/score/gzip/submit');
              if (isGzipFillSubmit) {
                // gzip/submit 的请求体是应用层 gzip 压缩的二进制流（无 content-encoding 头），
                // 需要先 gunzip 得到明文，才能交给 applyFillTimeMod 解析改写。
                const fillTimeProcess = (plainBody) => {
                  const modifiedBody = this.applyFillTimeMod(plainBody, fullUrl, ctx.clientToProxyRequest.headers['content-type']);
                  zlib.gzip(Buffer.from(modifiedBody, 'utf-8'), (err, compressed) => {
                    if (err) {
                      this.safeIpcSend('rule-log', moduleLog.event({ type: 'error', message: `[填空时间] gzip压缩失败: ` + err.message, url: fullUrl }));
                      this.writeModifiedFormBody(ctx, modifiedBody, requestInfo);
                    } else {
                      ctx.proxyToServerRequest.removeHeader('transfer-encoding');
                      ctx.proxyToServerRequest.setHeader('content-encoding', 'gzip');
                      ctx.proxyToServerRequest.setHeader('content-length', compressed.length);
                      ctx.proxyToServerRequest.write(compressed);
                      if (requestInfo) {
                        try { requestInfo.requestBody = JSON.stringify(JSON.parse(modifiedBody), null, 2); }
                        catch (e) { requestInfo.requestBody = modifiedBody; }
                      }
                    }
                    return callback();
                  });
                };
                // 先尝试 gunzip 解压请求体；若失败则按明文处理（兼容非压缩提交）
                zlib.gunzip(bodyBuffer, (gzErr, decompressed) => {
                  if (!gzErr && decompressed) {
                    fillTimeProcess(decompressed.toString('utf-8'));
                  } else {
                    fillTimeProcess(body);
                  }
                });
                return;
              } else {
                // 特殊提交接口（如 /submit/v2）：普通请求体，直接改写后写回，不做 gzip 解压/重压缩
                const modifiedBody = this.applyFillTimeMod(body, fullUrl, ctx.clientToProxyRequest.headers['content-type']);
                this.writeModifiedFormBody(ctx, modifiedBody, requestInfo);
                return callback();
              }
            }

            if (ctx.clientToProxyRequest.headers['content-type'] && ctx.clientToProxyRequest.headers['content-type'].includes('application/json')) {
              try {
                body = JSON.stringify(JSON.parse(body), null, 2);
              } catch (error) {
                moduleLog.error('解析请求体失败:', error)
              }
            }
            else if (ctx.clientToProxyRequest.headers['content-type'] && ctx.clientToProxyRequest.headers['content-type'].includes('application/x-www-form-urlencoded')) {
              try {
                const params = new URLSearchParams(body);
                const result = Object.fromEntries(params.entries());
                body = JSON.stringify(result, null, 2);
              } catch (error) {
                moduleLog.error('解析请求体失败:', error)
              }
            }
            else if (ctx.clientToProxyRequest.headers['content-type']) {
              moduleLog.log('未知请求体类型', ctx.clientToProxyRequest.headers['content-type'])
            }
            requestInfo.requestBody = body
            return callback();
          } catch (error) {
            moduleLog.error('处理请求体失败:', error);
            return callback();
          }
        })
        let responseBodyRules = this.ruleEngine.haveRules(fullUrl, 'response-body');
        ctx.onResponse(async (ctx, callback) => {
          try {
          ctx.serverToProxyResponse.once?.('aborted', () => ctx._releaseCapture().catch(() => {}));
          // 先记录响应类型与原始编码：下面内容替换会删除 content-encoding 头，
          // 但 onResponseEnd 解压 buffered 数据时仍需要原始编码，故提前保存。
          requestInfo.contentType = ctx.serverToProxyResponse.headers['content-type'];
          requestInfo.contentEncoding = ctx.serverToProxyResponse.headers['content-encoding'];
          requestInfo.isCompressed = !!requestInfo.contentEncoding;

          // 客户端可能续传原 ZIP；有已生成的完整注入包时按完整响应交付。
          if (responseBodyRules.includes(4) && ctx.serverToProxyResponse.statusCode === 206
              && this.ruleEngine._isFileDownloadRequest(fullUrl)) {
            await this.injection.pruneCache();
            const ready = this.rulesManager.getRules().some(group => group.enabled && group.rules.some(rule =>
              rule.enabled && rule.type === 'zip-implant-dynamic'
              && this.ruleEngine.urlMatchesPattern(fullUrl, rule.urlZip) && this.injection.cachedDownload(rule, fullUrl)));
            if (ready) { ctx.serverToProxyResponse.statusCode = 200; ctx.serverToProxyResponse.statusMessage = 'OK'; }
          }

          if (responseBodyRules.includes(2) && ctx.serverToProxyResponse.statusCode !== 200) {
            ctx.serverToProxyResponse.statusCode = 200;
            ctx.serverToProxyResponse.headers['content-type'] = 'application/octet-stream'
            delete ctx.serverToProxyResponse.headers['content-range'];
            delete ctx.serverToProxyResponse.headers['accept-ranges'];
          }

          // 如果是文件下载请求且需要应用规则，修改响应头
          if (responseBodyRules.includes(2)) {
            const isFileDownloadRequest = this.ruleEngine._isFileDownloadRequest(fullUrl);

            if (isFileDownloadRequest) {
              for (const ruleset of this.rulesManager.getRules()) {
                if (!ruleset.enabled) continue;
                for (const rule of ruleset.rules) {
                  if (!this.ruleEngine.isRuleEffective(rule, ruleset) || rule.type !== 'zip-implant') continue;

                  const urlMatches = this.ruleEngine.urlMatchesPattern(fullUrl, rule.urlZip);
                  if (urlMatches && await fs.pathExists(rule.zipImplant)) {
                    const { md5, size } = await this.injection.describeZip(rule.zipImplant);
                    const md5Base64 = Buffer.from(md5, 'hex').toString('base64');

                    ctx.serverToProxyResponse.headers['etag'] = md5;
                    ctx.serverToProxyResponse.headers['content-md5'] = md5Base64;
                    ctx.serverToProxyResponse.headers['content-length'] = size.toString();

                    this.safeIpcSend('rule-log', moduleLog.event({
                      type: 'success',
                      message: `规则 "${rule.name}" 修改响应头`,
                      ruleId: rule.id,
                      ruleName: rule.name,
                      url: fullUrl,
                      details: `ETag: ${md5}, Content-MD5: ${md5Base64}`
                    }));

                    break;
                  }
                }
              }
            }
          }

          // 响应替换(内容修改)：只对文本类响应(html/js/css/json/xml等)应用整包替换，
          // 二进制(wasm/图片/音视频/zip等)直接放行——既避免 utf-8 字符串替换损坏二进制，
          // 也避免对二进制做无谓的解压重写；文本类替换后内容已解压为明文，去掉压缩与长度头
          if (responseBodyRules.includes(1)) {
            const _ct = String(ctx.serverToProxyResponse.headers['content-type'] || '');
            if (!this.isTextualContentType(_ct)) {
              responseBodyRules = responseBodyRules.filter(x => x !== 1);
            } else {
              delete ctx.serverToProxyResponse.headers['content-encoding'];
              delete ctx.serverToProxyResponse.headers['content-length'];
              delete ctx.serverToProxyResponse.headers['content-range'];
              delete ctx.serverToProxyResponse.headers['accept-ranges'];
            }
          }

          if (!requestInfo.contentEncoding && !responseBodyRules.some(type => [1, 2, 3, 4].includes(type))) captureBody = new CaptureBody();
          requestInfo.statusCode = ctx.serverToProxyResponse.statusCode;
          if (responseBodyRules.some(type => [1, 2, 4].includes(type))) {
            for (const header of ['content-encoding', 'content-length', 'content-range', 'accept-ranges', 'etag', 'content-md5', 'digest']) delete ctx.serverToProxyResponse.headers[header];
          }
          requestInfo.statusMessage = ctx.serverToProxyResponse.statusMessage;
          requestInfo.responseHeaders = ctx.serverToProxyResponse.headers;
          return callback();
          } catch (error) { callback(error); }
        })
        ctx.onResponseData((ctx, chunk, callback) => {
          if (captureBody) {
            captureBody.append(chunk).then(() => callback(null, chunk), error => { releaseCapture().catch(() => {}); callback(error); });
            return;
          }
          responseBody.push(chunk)
          if (responseBodyRules.includes(2) || responseBodyRules.includes(4) || responseBodyRules.includes(1)) return callback(null, Buffer.from(''));
          else return callback(null, chunk);
        })
        ctx.onResponseEnd(async (ctx, callback) => {
          processingResponse = true;
          this._speedRelease(ctx);  // 网络保护: 响应结束, 恢复加速
          try {
            if (captureBody) {
              await captureBody.finish();
              if (captureBody.file) {
                await this.finishStreamedCapture(captureBody, requestInfo, fullUrl, requestTruncated ? null : { ...requestInfo, requestBody: learningRequestBody });
                return callback();
              }
            }
            const textual = this.isTextualContentType(requestInfo.contentType);
            let { buffer, text, decompressFailed } = await this.decompressBuffer(captureBody ? captureBody.buffer() : Buffer.concat(responseBody), requestInfo.contentEncoding, textual);
            responseBody = [];
            if (decompressFailed && responseBodyRules.some(type => [1, 2, 4].includes(type))) throw new Error('响应解压失败，无法安全改写');
            if (responseBodyRules.includes(2)) {
              buffer = await this.injection.applyZipImplantRules(fullUrl, buffer);
            }
            if (responseBodyRules.includes(4)) {
              buffer = await this.injection.applyDynamicInjectRules(fullUrl, buffer);
            }
            if (responseBodyRules.includes(1)) {
              buffer = this.contentChange.applyContentChangeRules(fullUrl, buffer, requestInfo.contentType);
            }
            if (responseBodyRules.some(type => [1, 2, 4].includes(type))) {
              ctx.proxyToClientResponse.write(buffer);
              if (textual) text = buffer.toString('utf8');
            }
            const isJson = /application\/json/.test(requestInfo.contentType);
            const isFile = /application\/octet-stream|application\/(x-)?zip|binary\/octet-stream|image/.test(requestInfo.contentType || '');
            const downloadName = this._resolveDownloadFileName(requestInfo, fullUrl);
            if (decompressFailed) {
              requestInfo.responseBody = text;
            }
            else if (isJson) {
              try {
                requestInfo.responseBody = JSON.stringify(JSON.parse(text), null, 2);
              } catch (e) {
                requestInfo.responseBody = text;
              }
            }
            else if (isFile) {
              requestInfo.responseBody = downloadName;
            }
            else {
              requestInfo.responseBody = textual ? text : `[二进制响应，${buffer.length} 字节]`;
            }
            requestInfo.bodySize = buffer.length;
            requestInfo.ruleMatched = this.ruleEngine.urlMentionedByEnabledRules(fullUrl);
            this.safeIpcSend('traffic-log', requestInfo);
            requestInfo.originalResponse = buffer
            this.trafficCache.set(requestInfo.uuid, requestInfo);

            let extracted_answers = {};

            // 答案提取：以 ZIP 魔数为准，不再要求文件名里必须带 "zip"
            // （Content-Type 和文件名都会变，魔数不会；再用下载请求特征挡掉无关的 zip 类文件）
            if (this._looksLikeZip(buffer) && (isFile || this.ruleEngine._isFileDownloadRequest(fullUrl))) {
              let filePath = null;
              try {
                await fs.ensureDir(this.tempDir);
                await fs.ensureDir(this.ansDir);
                filePath = path.join(this.tempDir, requestInfo.uuid + '-' + this._safeFileName(downloadName));
                // Extraction must not depend on the history entry surviving concurrent requests.
                await fs.writeFile(filePath, buffer);
                extracted_answers = await this.extractZipFile(filePath, this.ansDir, requestInfo.uuid);
                if (!requestTruncated && !decompressFailed) await this.learnArchive({ ...requestInfo, requestBody: learningRequestBody }, extracted_answers);
              } catch (error) {
                moduleLog.error('答案提取失败:', error);
                this.safeIpcSend('process-error', { error: `答案提取失败: ${error.message}` });
                extracted_answers = {};
              }

              if (filePath) {
                let shouldKeepCache = false;
                try {
                  shouldKeepCache = (require('../config').get('keep-cache-files') === 'true');
                } catch (error) {
                  shouldKeepCache = false;
                }

                if (!shouldKeepCache) {
                  // 用提取器实际使用的解压目录，避免这里自行推断路径导致残留
                  const extractDir = extracted_answers && extracted_answers.extractDir;
                  await fs.rm(filePath, { force: true }).catch(() => { });
                  if (extractDir && extractDir !== filePath) {
                    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => { });
                  }
                }
              }
            }

            const handledByAnswerRule = responseBodyRules.includes(3)
              && this.ruleEngine.dispatchAnswers(fullUrl, buffer, extracted_answers) === true;

            // Existing parsers/rules keep priority. Learning never delays the intercepted response.
            if (!requestTruncated && !decompressFailed && !extracted_answers.answers?.length && !handledByAnswerRule && this.answerLearning) {
              this.answerLearning.observe({ ...requestInfo, requestBody: learningRequestBody }).catch(error => {
                this.safeIpcSend('rule-log', moduleLog.event({ type: 'warning', message: '[AI 答案获取] ' + error.message }));
              });
            }

            return callback()
          } catch (error) {
            moduleLog.error('处理响应失败:', error);
            return callback(error);
          } finally {
            await releaseCapture().catch(error => moduleLog.warn('清理响应捕获失败：', error));
          }
        })
        return callback();
      });

      this.proxy.listen({ host: '127.0.0.1', port: this.proxyPort }, error => error ? reject(error) : resolve());
    });
  }
};
