/*
 * dictpen-sign.js —— chestnut-tts.js / chatnut.js 共用的签名与请求体构造(零依赖)
 *
 * 两个模块打的是同一套接口体系, 鉴权方式完全一致:
 *   sign = md5("deviceSn={SN}&keyid={KEYID}&mysticTime={毫秒}&key={SECRET}")
 * 随机 SN 即可, 不需要真机、不需要 cookie、不需要 API Key。
 * 抽到这里的好处: 设备字段和密钥只有一份, 改一处两边同时生效。
 *
 * ── 导出 ──
 *   genSn()                        随机设备号
 *   md5(str)
 *   baseFields(sn, ms)             公共设备字段(不含 sign, 调用方再合并自己的业务字段)
 *   sign(sn, ms)                   算签名
 *   buildMultipart(fields)         → { body:Buffer, boundary }
 *   deviceForm(extra)              一步到位: 设备字段 + 签名 + extra → { body, boundary }
 *   KEYID / SECRET
 */
const crypto = require('crypto');

const KEYID = 'dictpen_keyid';
const SECRET = 'K7H0@Mfi6h#68';

function genSn() {
  let s = 'MF';
  for (let i = 0; i < 14; i++) s += Math.floor(Math.random() * 10);
  return s;
}

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const sign = (sn, ms) => md5(`deviceSn=${sn}&keyid=${KEYID}&mysticTime=${ms}&key=${SECRET}`);

function baseFields(sn, ms) {
  return {
    osAppVersion: '2.34.0', appVersion: '4.34.0', client: 'y02-1',
    deviceId: sn, deviceSku: 'OVERHEAD_Y02-1_SKU_CHN_PLUS', deviceSn: sn,
    imei: sn, keyid: KEYID, messageSource: 'yd_gpt_dictpen',
    mid: 'Linux5.10.160', model: 'YDPX7-6', mysticTime: ms,
    pointParam: 'deviceSn,keyid,mysticTime', product: 'dictpen', screen: '936x280',
  };
}

function buildMultipart(fields) {
  const boundary = '----------------------------' + crypto.randomBytes(8).toString('hex');
  const parts = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), boundary };
}

/** 设备字段 + 签名 + 业务字段 → multipart。sn 不传则随机生成。 */
function deviceForm(extra, sn) {
  sn = sn || genSn();
  const ms = String(Date.now());
  return buildMultipart(Object.assign(baseFields(sn, ms), { sign: sign(sn, ms) }, extra || {}));
}

module.exports = { genSn, md5, sign, baseFields, buildMultipart, deviceForm, KEYID, SECRET };
