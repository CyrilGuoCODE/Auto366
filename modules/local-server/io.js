// Shared HTTP mechanics, without business paths or parameters.
async function readBody(req, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
module.exports = { readBody, json };
