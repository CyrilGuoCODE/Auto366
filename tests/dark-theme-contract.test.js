const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['styles', 'renderer'];
const SCAN_FILES = ['index.html'];
const EXCLUDED = new Set([
  path.join('styles', 'global', 'tokens.css'),
  path.join('styles', 'global', 'theme.css')
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function toRgb(token) {
  const hex = token.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let value = hex[1];
    if (value.length === 3) value = value.split('').map((c) => c + c).join('');
    if (value.length === 8) value = value.slice(0, 6);
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  }

  const rgb = token.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgb ? rgb.slice(1, 4).map(Number) : null;
}

function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = luminance(toRgb(foreground));
  const b = luminance(toRgb(background));
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

function darkThemeTokens() {
  const theme = fs.readFileSync(path.join(ROOT, 'styles', 'global', 'theme.css'), 'utf8');
  return Object.fromEntries(
    [...theme.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1], match[2]])
  );
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function findLeaks(file) {
  const relative = path.relative(ROOT, file);
  if (EXCLUDED.has(relative)) return [];

  const source = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Standalone printable reports intentionally use a white paper palette and do not inherit app theme.
    .replace(/return\s+`<!DOCTYPE html[\s\S]*?<\/html>`;/g, '');
  const leaks = [];
  const declaration = /(?:^|[;{\n`])\s*([\w-]+)\s*:\s*([^;\n}`]+)/g;
  const assignment = /\.style\.(background(?:Color)?|border(?:Color)?|color|fill|stroke)\s*=\s*(['"])(.*?)\2/g;
  const colorToken = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;

  function inspect(property, value, index) {
    if (property.startsWith('--')) return;
    const normalized = property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    const isSurface = /^(background|background-color|border|border-color|border-(top|right|bottom|left)(-color)?|box-shadow)$/.test(normalized);
    const isForeground = /^(color|fill|stroke)$/.test(normalized);
    if (!isSurface && !isForeground) return;

    for (const token of value.match(colorToken) || []) {
      const rgb = toRgb(token);
      if (!rgb) continue;
      const luma = luminance(rgb);
      const brightSurface = isSurface && luma >= 0.72;
      const darkForeground = isForeground && luma <= 0.16;
      if (brightSurface || darkForeground) {
        leaks.push(`${relative}:${lineNumber(source, index)} ${property}: ${value.trim()}`);
      }
    }
  }

  for (const match of source.matchAll(declaration)) inspect(match[1], match[2], match.index);
  for (const match of source.matchAll(assignment)) inspect(match[1], match[3], match.index);
  return [...new Set(leaks)];
}

test('answer UI uses theme-aware semantic colors', () => {
  const leaks = [
    ...findLeaks(path.join(ROOT, 'renderer', 'answers-ui.js')),
    ...findLeaks(path.join(ROOT, 'styles', 'features', 'answers.css'))
  ];
  assert.deepEqual(
    leaks,
    [],
    `Answer details must not hard-code light surfaces or dark text:\n${leaks.join('\n')}`
  );
});

test('dark theme supplies dark palette surfaces without redefining physical white or black', () => {
  const theme = fs.readFileSync(path.join(ROOT, 'styles', 'global', 'theme.css'), 'utf8');
  const required = [
    '--color-primary-50', '--color-primary-100',
    '--color-danger-50', '--color-success-50', '--color-warn-50', '--color-info-50',
    '--color-bg-page', '--color-bg-panel', '--color-bg-elevated', '--color-bg-hover',
    '--color-text', '--color-text-heading', '--color-text-inverse'
  ];

  for (const token of required) {
    assert.match(theme, new RegExp(`${token}\\s*:`), `dark theme must override ${token}`);
  }
  assert.doesNotMatch(theme, /--color-(?:white|black)\s*:/, 'physical white/black must not change meaning');
});

test('dark theme core text and action colors meet readable contrast', () => {
  const tokens = darkThemeTokens();
  const pairs = [
    ['--color-text', '--color-bg-page'],
    ['--color-text-heading', '--color-bg-panel'],
    ['--color-text-muted', '--color-bg-panel'],
    ['--color-text-link', '--color-bg-panel'],
    ['--color-success-text', '--color-success-bg'],
    ['--color-error-text', '--color-error-bg'],
    ['--color-warn-text', '--color-warn-bg'],
    ['--color-info-text', '--color-info-bg'],
    ['#ffffff', '--color-primary'],
    ['#ffffff', '--color-danger'],
    ['#ffffff', '--color-success'],
    ['#ffffff', '--color-warn'],
    ['#ffffff', '--color-info'],
    ['#ffffff', '--color-orange']
  ];

  for (const [foregroundToken, backgroundToken] of pairs) {
    const foreground = foregroundToken.startsWith('#') ? foregroundToken : tokens[foregroundToken];
    const background = tokens[backgroundToken];
    assert.ok(foreground && background, `missing contrast token ${foregroundToken}/${backgroundToken}`);
    assert.ok(
      contrast(foreground, background) >= 4.5,
      `${foregroundToken} on ${backgroundToken} must meet 4.5:1 contrast`
    );
  }
});

test('dark theme has no hard-coded bright surfaces or dark foregrounds', () => {
  const files = [
    ...SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root))),
    ...SCAN_FILES.map((file) => path.join(ROOT, file))
  ].filter((file) => /\.(css|js|html)$/i.test(file));

  const leaks = files.flatMap(findLeaks);
  assert.deepEqual(
    leaks,
    [],
    `Theme-neutral colors must use semantic CSS variables so dark mode can override them:\n${leaks.join('\n')}`
  );
});
