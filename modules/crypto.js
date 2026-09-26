const crypto = require('crypto');

class CryptoManager {
  constructor() {
    this.key = Buffer.from('QJBNiBmV55PDrewyne3GsA==', 'base64');
  }

  // AES-128-CBC 加密为 u3enc 格式（IV + PKCS7填充密文）
  encryptU3enc(data) {
    const blockSize = 16;
    const padLen = blockSize - (data.length % blockSize);
    const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-128-cbc', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return Buffer.concat([iv, encrypted]);
  }

  // 解密 u3enc 格式数据（前16字节IV，剩余为密文）
  // Node.js createDecipheriv 默认 autoPadding=true，自动处理 PKCS7
  decryptU3enc(encryptedData) {
    if (encryptedData.length < 16) return null;

    const iv = encryptedData.slice(0, 16);
    const ciphertext = encryptedData.slice(16);

    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', this.key, iv);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      console.error('解密 u3enc 数据失败:', error.message);
      return null;
    }
  }

  // psdata_partb/answer.json 实测格式（Pc.zip，12 个文件全部命中）：
  //   魔数 "encr" + 4 字节头（各文件不同，如 a7 67 00 00 / 27 2b 00 00，不参与运算）
  //   + 载荷按 01 02 03 04 05 06 07 08 循环异或。
  // 解出来不是 JSON 就返回 null，明文文件不受影响。
  decryptEncr(encryptedData) {
    if (!Buffer.isBuffer(encryptedData) || encryptedData.length < 8) return null;
    if (encryptedData.slice(0, 4).toString('latin1') !== 'encr') return null;

    const payload = encryptedData.slice(8);
    const key = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i % 8];

    const text = out.toString('utf-8');
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    return text;
  }
}

module.exports = CryptoManager;
