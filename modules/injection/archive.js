const http = require('http');
const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const StreamZip = require('node-stream-zip');
const archiver = require('archiver');

module.exports = {
async describeZip(file) {
    const hash = require('crypto').createHash('md5');
    let size = 0;
    for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); size += chunk.length; }
    return { md5: hash.digest('hex'), size };
  },
async downloadWithTimeout(downloadUrl, savePath, timeout = 30000, redirects = 0, deadline = Date.now() + timeout, signal, onRedirect) {
    const url = new URL(downloadUrl);
    if (!['http:', 'https:'].includes(url.protocol) || redirects > 5) throw new Error('下载地址无效或重定向过多');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('下载超时');
    let request, response, created = false;
    const timer = setTimeout(() => {
      const error = new Error('下载超时');
      request?.destroy(error);
      response?.destroy(error);
    }, remaining);
    try {
      response = await new Promise((resolve, reject) => {
        request = (url.protocol === 'https:' ? https : http).get(url, { signal }, resolve);
        request.once('error', reject);
      });
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.destroy();
        request.destroy();
        clearTimeout(timer);
        const next = new URL(response.headers.location, url).href;
        onRedirect?.(next);
        return await this.downloadWithTimeout(next, savePath, timeout, redirects + 1, deadline, signal, onRedirect);
      }
      if (response.statusCode !== 200) { response.resume(); throw new Error('下载失败: HTTP ' + response.statusCode); }
      created = true;
      await require('stream/promises').pipeline(response, fs.createWriteStream(savePath));
      // Checking four bytes must not load an entire archive into the main process.
      const file = await fs.promises.open(savePath, 'r');
      try {
        const header = Buffer.alloc(4);
        const { bytesRead } = await file.read(header, 0, 4, 0);
        if (bytesRead !== 4 || header.readUInt32LE(0) !== 0x04034b50) throw new Error('下载的文件不是有效的ZIP格式');
      } finally { await file.close(); }
      return savePath;
    } catch (error) {
      request?.destroy(); response?.destroy();
      if (created) await fs.remove(savePath).catch(() => {});
      throw error;
    } finally { clearTimeout(timer); }
  },

extractZip(zipPath, extractDir) {
    return new Promise((resolve, reject) => {
      try {
        const zip = new StreamZip({ file: zipPath, storeEntries: true });
        zip.on('ready', () => {
          zip.extract(null, extractDir, (err, count) => {
            zip.close();
            if (err) reject(err);
            else resolve(count);
          });
        });
        zip.on('error', (err) => {
          zip.close();
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  },

async findAllHtmlFiles(dir) {
    const results = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        results.push(...await this.findAllHtmlFiles(fullPath));
      } else if (entry.name.endsWith('.html') || entry.name.endsWith('.htm')) {
        results.push(fullPath);
      }
    }
    return results;
  },

async injectScriptIntoHtml(htmlFilePath, scriptFileName) {
    let content = await fs.readFile(htmlFilePath, 'utf-8');

    // 听说页会在正文脚本里立刻加载 jquery.recordwave.js / exam-pc-v1.js。
    // 若仍用 createElement 异步追加，录音库可能先缓存真实 getUserMedia，
    // 后续再替换 navigator.mediaDevices 已经来不及。直接放到 body 起始处，
    // 利用普通 script 的解析阻塞语义保证假麦克风先完成接管。
    if (scriptFileName === 'auto-listening.js') {
      const directTag = `<script src="./${scriptFileName}"></script>`;
      if (!content.includes(directTag)) {
        content = content.replace(/<body(\s[^>]*)?>/i, (bodyTag) => bodyTag + directTag);
      }
      await fs.writeFile(htmlFilePath, content, 'utf-8');
      return;
    }

    const injectCode = `var s = document.createElement('script');s.src='./${scriptFileName}';document.body.appendChild(s);`;

    if (content.includes('loadFile.load()')) {
      content = content.replace(
        /\.then\s*\(\s*function\s*\(\s*\)\s*\{/g,
        '.then(function(){' + injectCode
      );
    } else {
      content = content.replace(
        /<\/body>/i,
        '<script>' + injectCode + '</script></body>'
      );
    }

    await fs.writeFile(htmlFilePath, content, 'utf-8');
  },

repackZip(sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve(outputPath);
      });

      output.on('error', error => { archive.abort(); reject(error); });
      archive.on('error', error => { output.destroy(); reject(error); });

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize().catch(error => { output.destroy(); reject(error); });
    });
  }
};
