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
}

module.exports = CryptoManager;
