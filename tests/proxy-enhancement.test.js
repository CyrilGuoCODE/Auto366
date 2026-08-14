const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'renderer', 'proxy-enhancement.mjs')).href;

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

async function createFixture({ proxyRunning = false, tunRunning = false, startResult, stopResult } = {}) {
  const { default: ProxyEnhancement } = await import(moduleUrl);
  const calls = [];
  const state = { proxyRunning, tunRunning };
  const api = {
    async getTunStatus() {
      calls.push('status');
      return { running: state.tunRunning };
    },
    async startTun() {
      calls.push('start');
      const result = startResult || { success: true, message: 'started' };
      if (result.success) state.tunRunning = true;
      return result;
    },
    async stopTun() {
      calls.push('stop');
      const result = stopResult || { success: true, message: 'stopped' };
      if (result.success) state.tunRunning = false;
      return result;
    },
  };
  const storage = createStorage();
  const enhancement = new ProxyEnhancement({
    getProxyRunning: () => state.proxyRunning,
    api,
    storage,
  });
  return { calls, enhancement, state, storage };
}

test('enabling enhancement while proxy is stopped stores a deferred preference', async () => {
  const fixture = await createFixture();

  const result = await fixture.enhancement.setEnabled(true);

  assert.equal(result.success, true);
  assert.equal(result.deferred, true);
  assert.equal(fixture.enhancement.isEnabled(), true);
  assert.deepEqual(fixture.calls, []);
});

test('starting the proxy activates the stored TUN enhancement once', async () => {
  const fixture = await createFixture();
  await fixture.enhancement.setEnabled(true);
  fixture.state.proxyRunning = true;

  const first = await fixture.enhancement.onProxyStarted();
  const second = await fixture.enhancement.onProxyStarted();

  assert.equal(first.running, true);
  assert.equal(second.alreadyRunning, true);
  assert.deepEqual(fixture.calls, ['status', 'start', 'status']);
});

test('stopping the proxy always stops a running TUN enhancement', async () => {
  const fixture = await createFixture({ proxyRunning: true, tunRunning: true });

  const result = await fixture.enhancement.onProxyStopping();

  assert.equal(result.success, true);
  assert.equal(result.running, false);
  assert.deepEqual(fixture.calls, ['stop']);
});

test('disabling enhancement stops TUN and keeps the preference off', async () => {
  const fixture = await createFixture({ proxyRunning: true, tunRunning: true });
  await fixture.enhancement.setEnabled(true);

  const result = await fixture.enhancement.setEnabled(false);

  assert.equal(result.success, true);
  assert.equal(result.running, false);
  assert.equal(fixture.enhancement.isEnabled(), false);
  assert.equal(fixture.calls.at(-1), 'stop');
});

test('a failed immediate activation rolls the preference back', async () => {
  const fixture = await createFixture({
    proxyRunning: true,
    startResult: { success: false, message: 'missing runtime' },
  });

  const result = await fixture.enhancement.setEnabled(true);

  assert.equal(result.success, false);
  assert.equal(fixture.enhancement.isEnabled(), false);
  assert.deepEqual(fixture.calls, ['status', 'start']);
});
