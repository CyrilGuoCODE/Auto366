const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveExtractedRoot } = require('../modules/archive-layout');

function withTempDir(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto366-archive-'));
  try {
    run(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('unwraps a duplicated resource root from legacy archives', () => {
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, 'tun'));
    fs.writeFileSync(path.join(tempDir, 'tun', 'mihomo.exe'), 'fixture');

    assert.equal(resolveExtractedRoot(tempDir, 'tun'), path.join(tempDir, 'tun'));
  });
});

test('keeps a flat archive root unchanged', () => {
  withTempDir((tempDir) => {
    fs.writeFileSync(path.join(tempDir, 'mihomo.exe'), 'fixture');
    fs.writeFileSync(path.join(tempDir, 'wintun.dll'), 'fixture');

    assert.equal(resolveExtractedRoot(tempDir, 'tun'), tempDir);
  });
});

test('does not unwrap an unrelated single directory', () => {
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, 'unexpected'));

    assert.equal(resolveExtractedRoot(tempDir, 'tun'), tempDir);
  });
});
