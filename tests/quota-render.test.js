import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatQuotaLabel, fmtReset } from '../dist/render/quota-label.js';
import { setLanguage, t } from '../dist/i18n/index.js';

function kimiData(overrides = {}) {
  return [{
    provider: 'kimi',
    windows: [
      { label: '5h', percent: 15, resetAt: todayAt(3, 44) },
      { label: 'week', percent: 69, resetAt: tomorrow() },
    ],
    ...overrides,
  }];
}

function todayAt(hours, minutes) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

test('formatQuotaLabel matches the Kimi example verbatim', () => {
  setLanguage('en');
  const label = formatQuotaLabel(kimiData(), t);
  // week 69% falls in the 60-84 band, so the health marker is 🟡 (not 🟢).
  assert.equal(label, `🟡 Kimi 5h 15% (03:44) · week 69%${fmtReset(tomorrow())}`);
});

test('formatQuotaLabel renders DeepSeek balance', () => {
  setLanguage('en');
  const label = formatQuotaLabel([
    { provider: 'deepseek', balance: { amount: 40.96, currency: 'CNY' } },
  ], t);
  assert.equal(label, '💰 DS ¥40.96');
});

test('formatQuotaLabel renders USD balance with $ symbol', () => {
  setLanguage('en');
  const label = formatQuotaLabel([
    { provider: 'deepseek', balance: { amount: 5.5, currency: 'USD' } },
  ], t);
  assert.equal(label, '💰 DS $5.50');
});

test('formatQuotaLabel renders GLM windows with the GLM brand', () => {
  setLanguage('en');
  const label = formatQuotaLabel([{
    provider: 'glm',
    windows: [
      { label: '5h', percent: 15, resetAt: todayAt(3, 44) },
      { label: 'week', percent: 69, resetAt: tomorrow() },
    ],
  }], t);
  assert.equal(label.startsWith('🟡 GLM 5h 15% (03:44)'), true);
});

test('formatQuotaLabel joins multiple providers with separator', () => {
  setLanguage('en');
  const label = formatQuotaLabel([
    ...kimiData(),
    { provider: 'deepseek', balance: { amount: 40.96, currency: 'CNY' } },
  ], t);
  assert.equal(label.includes(' · 💰 DS ¥40.96'), true);
});

test('formatQuotaLabel emoji thresholds at 59/60/84/85', () => {
  setLanguage('en');
  const at = p => formatQuotaLabel([{ provider: 'kimi', windows: [{ label: '5h', percent: p, resetAt: null }] }], t);
  assert.equal(at(59).startsWith('🟢'), true);
  assert.equal(at(60).startsWith('🟡'), true);
  assert.equal(at(84).startsWith('🟡'), true);
  assert.equal(at(85).startsWith('🔴'), true);
});

test('formatQuotaLabel returns null for empty data', () => {
  setLanguage('en');
  assert.equal(formatQuotaLabel([], t), null);
});

test('formatQuotaLabel uses localized week label in zh-Hans', () => {
  setLanguage('zh-Hans');
  const label = formatQuotaLabel([{
    provider: 'kimi',
    windows: [
      { label: '5h', percent: 10, resetAt: null },
      { label: 'week', percent: 20, resetAt: null },
    ],
  }], t);
  assert.equal(label, '🟢 Kimi 5h 10% · 周 20%');
});

test('fmtReset same-day shows HH:MM, later day shows MM/DD, null shows empty', () => {
  const same = fmtReset(todayAt(3, 44));
  assert.equal(same, ' (03:44)');
  const later = fmtReset(tomorrow());
  const m = /^ \((\d{2})\/(\d{2})\)$/.exec(later);
  assert.ok(m, `expected (MM/DD), got: ${later}`);
  assert.equal(fmtReset(null), '');
});
