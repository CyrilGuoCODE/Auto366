const assert = require('node:assert/strict');
const test = require('node:test');

const { generateTunConfig } = require('../modules/tun-config');

test('uses the slim system stack without GeoIP-dependent DNS fallback', () => {
  const config = generateTunConfig(5291, ['up366.exe']);

  assert.match(config, /\n  stack: system\n/);
  assert.doesNotMatch(config, /\n  stack: gvisor\n/);
  assert.doesNotMatch(config, /\n  fallback:/);
  assert.doesNotMatch(config, /\nmixed-port:/);
  assert.doesNotMatch(config, /\nproxy-groups:/);
});

test('writes the current proxy port and sanitised process rules', () => {
  const config = generateTunConfig(6123, [' up366.exe ', '', null]);

  assert.match(config, /\n    port: 6123\n/);
  assert.match(config, /\n  - PROCESS-NAME,up366\.exe,Auto366Proxy\n/);
});
