const moduleLog = require('../logging').create('代理');
const path = require('path');
const zlib = require('zlib');

module.exports = {
extractFileNameFromResponse(responseBody, url) {
    try {
      if (typeof responseBody === 'string' || Buffer.isBuffer(responseBody)) {
        const bodyStr = responseBody.toString();

        try {
          const jsonData = JSON.parse(bodyStr);

          let objectName = jsonData.objectName || jsonData.object_name;
          let fileName = jsonData.fileName || jsonData.filename || jsonData.file_name;

          if (!objectName && !fileName && jsonData.data) {
            objectName = jsonData.data.objectName || jsonData.data.object_name;
            fileName = jsonData.data.fileName || jsonData.data.filename || jsonData.data.file_name;
          }

          if (objectName && fileName) {
            if (objectName === fileName) {
              return fileName;
            } else {
              return null;
            }
          }

          if (objectName) {
            return objectName;
          }
          if (fileName) {
            return fileName;
          }
        } catch (e) {
          moduleLog.error('解析JSON响应体失败:', e);
        }
      }

      return null;
    } catch (error) {
      moduleLog.error('提取文件名失败:', error);
      return null;
    }
  },

isTextualContentType(contentType) {
    const s = String(contentType || '').toLowerCase();
    if (!s) return true;
    if (s.includes('text/')) return true;              // text/html text/css text/plain text/javascript ...
    if (s.includes('json')) return true;               // application/json application/ld+json ...
    if (s.includes('javascript')) return true;         // application/javascript
    if (s.includes('ecmascript')) return true;
    if (s.includes('xml')) return true;                // application/xml ...
    if (s.includes('svg')) return true;                // image/svg+xml
    if (s.includes('xhtml')) return true;
    if (s.includes('x-www-form-urlencoded')) return true;
    return false;
  },

decompressBuffer(buffer, encoding, decodeText = true) {
    return new Promise((resolve, reject) => {
      try {
        if (!encoding || encoding === 'identity') {
          // 无压缩，返回buffer和字符串
          resolve({
            buffer: buffer,
            text: decodeText ? buffer.toString('utf8') : ''
          });
          return;
        }

        if (encoding.includes('gzip')) {
          zlib.gunzip(buffer, (err, result) => {
            if (err) {
              moduleLog.error('Gzip解压失败:', err);
              resolve({
                buffer: buffer,
                text: `[压缩数据 - gzip解压失败，原始大小: ${buffer.length}字节]`,
                decompressFailed: true
              });
            } else {
              resolve({
                buffer: result,
                text: decodeText ? result.toString('utf8') : ''
              });
            }
          });
        } else if (encoding.includes('deflate')) {
          zlib.inflate(buffer, (err, result) => {
            if (err) {
              moduleLog.error('Deflate解压失败:', err);
              resolve({
                buffer: buffer,
                text: `[压缩数据 - deflate解压失败，原始大小: ${buffer.length}字节]`,
                decompressFailed: true
              });
            } else {
              resolve({
                buffer: result,
                text: decodeText ? result.toString('utf8') : ''
              });
            }
          });
        } else if (encoding.includes('br')) {
          // Brotli压缩
          zlib.brotliDecompress(buffer, (err, result) => {
            if (err) {
              moduleLog.error('Brotli解压失败:', err);
              resolve({
                buffer: buffer,
                text: `[压缩数据 - brotli解压失败，原始大小: ${buffer.length}字节]`,
                decompressFailed: true
              });
            } else {
              resolve({
                buffer: result,
                text: decodeText ? result.toString('utf8') : ''
              });
            }
          });
        } else {
          // 未知压缩格式
          moduleLog.log('未知压缩格式:', encoding)
          resolve({
            buffer: buffer,
            text: `[压缩数据 - 未知编码: ${encoding}，原始大小: ${buffer.length}字节]`,
            decompressFailed: true
          });
        }
      } catch (error) {
        moduleLog.error('解压缩过程中出错:', error);
        resolve({
          buffer: buffer,
          text: `[压缩数据 - 解压异常，原始大小: ${buffer.length}字节]`,
          decompressFailed: true
        });
      }
    });
  },

_looksLikeZip(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    const sig = buffer.readUInt32LE(0);
    // 0x04034b50 普通条目, 0x06054b50 空压缩包, 0x08074b50 跨卷
    return sig === 0x04034b50 || sig === 0x06054b50 || sig === 0x08074b50;
  },

_resolveDownloadFileName(requestInfo, fullUrl) {
    const headers = requestInfo.responseHeaders || {};
    const disposition = headers['content-disposition'] || headers['Content-Disposition'];

    if (disposition) {
      // RFC 5987: filename*=UTF-8''xxx 优先于 filename="xxx"
      const extended = disposition.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
      if (extended) {
        try {
          return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
        } catch (e) { /* 编码有问题就继续走普通 filename */ }
      }
      const plain = disposition.match(/filename\s*=\s*"([^"]*)"/i) || disposition.match(/filename\s*=\s*([^;]+)/i);
      if (plain && plain[1].trim()) {
        return plain[1].trim();
      }
    }

    try {
      const pathname = new URL(fullUrl).pathname;
      const base = pathname.split('/').filter(Boolean).pop();
      if (base) return decodeURIComponent(base);
    } catch (e) { /* URL 解析失败时用兜底名 */ }

    return `download_${Date.now()}.zip`;
  },

_safeFileName(name) {
    const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    if (!base || base === '.' || base === '..') return `download_${Date.now()}.zip`;
    return base.length > 120 ? base.slice(-120) : base;
  }
};
