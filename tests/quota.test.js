import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CONFIG } from '../dist/config.js';
import {
  collectQuota,
  resolveQuotaModel,
  matchProviders,
  parseKimiResponse,
  parseDeepSeekResponse,
  parseGlmResponse,
} from '../dist/quota.js';

const KIMI_FIXTURE = {
  limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '200', used: '30', resetTime: '2026-08-12T03:44:00Z' } }],
  usage: { limit: '2048', used: '1413', resetTime: '2026-08-15T05:44:00Z' },
};

const DEEPSEEK_FIXTURE = {
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '40.955', granted_balance: '0.00', topped_up_balance: '40.96' }],
};

const GLM_FIXTURE = {
  code: 200,
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, percentage: 15, nextResetTime: 1786537440000 },
      { type: 'TOKENS_LIMIT', unit: 6, percentage: 69, nextResetTime: 1787137440000 },
      { type: 'CONCURRENCY_LIMIT', unit: 1, percentage: 5, nextResetTime: 0 },
    ],
  },
};

function makeQuotaConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    quota: {
      enabled: true,
      displayMode: 'auto',
      providers: {
        kimi: { apiKey: 'sk-kimi-test', models: ['k3'] },
        deepseek: { apiKey: 'sk-test-deepseek', models: ['deepseek'] },
      },
      ...overrides,
    },
  };
}

function okJson(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

// ---------- resolveQuotaModel ----------

test('resolveQuotaModel prefers transcript model on auto', () => {
  const stdin = { model: { display_name: 'k3[1M]' } };
  const transcript = { lastAssistantModel: 'deepseek-v4-flash' };
  assert.equal(resolveQuotaModel(stdin, transcript, 'auto'), 'deepseek-v4-flash');
});

test('resolveQuotaModel falls back to stdin model when transcript is empty', () => {
  const stdin = { model: { display_name: 'k3[1M]' } };
  assert.equal(resolveQuotaModel(stdin, {}, 'auto'), 'k3[1M]');
});

test('resolveQuotaModel honors explicit stdin mode', () => {
  const stdin = { model: { display_name: 'k3[1M]' } };
  const transcript = { lastAssistantModel: 'deepseek-v4-flash' };
  assert.equal(resolveQuotaModel(stdin, transcript, 'stdin'), 'k3[1M]');
});

test('resolveQuotaModel sanitizes transcript model', () => {
  const stdin = { model: { display_name: 'k3[1M]' } };
  const transcript = { lastAssistantModel: '\x1b[31mdeepseek\x1b[0m' };
  assert.equal(resolveQuotaModel(stdin, transcript, 'auto'), 'deepseek');
});

// ---------- matchProviders ----------

test('matchProviders auto matches k3 prefix to kimi', () => {
  const cfg = makeQuotaConfig().quota;
  assert.deepEqual(matchProviders(cfg, 'k3[1M]'), ['kimi']);
});

test('matchProviders auto returns [] when nothing matches', () => {
  const cfg = makeQuotaConfig().quota;
  assert.deepEqual(matchProviders(cfg, 'claude-opus'), []);
});

test('matchProviders auto is case-insensitive', () => {
  const cfg = makeQuotaConfig().quota;
  assert.deepEqual(matchProviders(cfg, 'K3-256'), ['kimi']);
});

test('matchProviders all returns every provider with a key', () => {
  const cfg = makeQuotaConfig({ displayMode: 'all' }).quota;
  assert.deepEqual(matchProviders(cfg, 'anything'), ['kimi', 'deepseek']);
});

test('matchProviders skips providers with empty apiKey', () => {
  const cfg = makeQuotaConfig({
    providers: { kimi: { apiKey: 'sk-kimi-test', models: ['k3'] }, glm: { apiKey: '', models: ['glm'] } },
    displayMode: 'all',
  }).quota;
  assert.deepEqual(matchProviders(cfg, 'anything'), ['kimi']);
});

// ---------- response parsers ----------

test('parseKimiResponse extracts 5h and week windows', () => {
  const d = parseKimiResponse(KIMI_FIXTURE);
  assert.ok(d);
  assert.equal(d.provider, 'kimi');
  assert.equal(d.windows.length, 2);
  assert.equal(d.windows[0].label, '5h');
  assert.equal(d.windows[0].percent, 15);
  assert.equal(d.windows[1].label, 'week');
  assert.equal(d.windows[1].percent, 69);
});

test('parseKimiResponse returns null without valid limits', () => {
  assert.equal(parseKimiResponse({ usage: {} }), null);
  assert.equal(parseKimiResponse({ limits: [{ detail: { limit: '0', used: '10' } }] }), null);
  assert.equal(parseKimiResponse(null), null);
});

test('parseDeepSeekResponse extracts CNY balance', () => {
  const d = parseDeepSeekResponse(DEEPSEEK_FIXTURE);
  assert.ok(d);
  assert.equal(d.provider, 'deepseek');
  assert.equal(d.balance.amount, 40.955);
  assert.equal(d.balance.currency, 'CNY');
});

test('parseDeepSeekResponse returns null without balance_infos', () => {
  assert.equal(parseDeepSeekResponse({ is_available: false, balance_infos: [] }), null);
  assert.equal(parseDeepSeekResponse({ balance_infos: [{ currency: 'CNY', total_balance: 'abc' }] }), null);
});

test('parseGlmResponse maps unit 3/6 and filters non-TOKENS_LIMIT', () => {
  const d = parseGlmResponse(GLM_FIXTURE);
  assert.ok(d);
  assert.equal(d.provider, 'glm');
  assert.equal(d.windows.length, 2);
  assert.equal(d.windows[0].label, '5h');
  assert.equal(d.windows[0].percent, 15);
  assert.equal(d.windows[1].label, 'week');
  assert.equal(d.windows[1].percent, 69);
});

test('parseGlmResponse fills missing slots from other units ordered by reset', () => {
  const raw = {
    data: {
      limits: [
        { type: 'TOKENS_LIMIT', unit: 6, percentage: 30, nextResetTime: 1787137440000 },
        { type: 'TOKENS_LIMIT', unit: 1, percentage: 10, nextResetTime: 1786537440000 },
      ],
    },
  };
  const d = parseGlmResponse(raw);
  assert.ok(d);
  const five = d.windows.find(w => w.label === '5h');
  assert.ok(five);
  assert.equal(five.percent, 10); // 最近的 reset 条目补进 5h 槽
});

test('parseGlmResponse clamps percentage to 0-100', () => {
  const raw = { data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, percentage: 250, nextResetTime: 0 }] } };
  const d = parseGlmResponse(raw);
  assert.equal(d.windows[0].percent, 100);
});

// ---------- collectQuota: caching & degradation ----------

async function withTempDir() {
  return mkdtemp(path.join(tmpdir(), 'claude-hud-quota-test-'));
}

test('collectQuota returns [] when quota is disabled', async () => {
  const cfg = { ...DEFAULT_CONFIG, quota: { ...DEFAULT_CONFIG.quota, enabled: false } };
  const data = await collectQuota(cfg, { model: { display_name: 'k3[1M]' } }, {});
  assert.deepEqual(data, []);
});

test('collectQuota fetches and caches fresh data', async () => {
  const dir = await withTempDir();
  try {
    let calls = 0;
    const deps = { fetchImpl: async () => { calls += 1; return okJson(KIMI_FIXTURE); }, now: () => 1000000, cacheDir: () => dir };
    const cfg = makeQuotaConfig();
    const first = await collectQuota(cfg, { model: { display_name: 'k3[1M]' } }, {}, deps);
    assert.equal(first.length, 1);
    assert.equal(first[0].provider, 'kimi');
    assert.equal(calls, 1);
    const cacheRaw = await readFile(path.join(dir, 'kimi.json'), 'utf8');
    const cacheEntry = JSON.parse(cacheRaw);
    assert.ok(cacheEntry.keyHash);
    assert.equal(cacheEntry.data.provider, 'kimi');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectQuota serves fresh cache without network', async () => {
  const dir = await withTempDir();
  try {
    let calls = 0;
    const deps = {
      fetchImpl: async () => { calls += 1; return okJson(KIMI_FIXTURE); },
      now: () => 1000000,
      cacheDir: () => dir,
    };
    const cfg = makeQuotaConfig();
    await collectQuota(cfg, { model: { display_name: 'k3[1M]' } }, {}, deps);
    // Cache is now fresh; second call within TTL must not hit the network.
    const second = await collectQuota(cfg, { model: { display_name: 'k3[1M]' } }, {}, { ...deps, now: () => 1000000 + 60_000 });
    assert.equal(second.length, 1);
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectQuota refetches when cache is stale', async () => {
  const dir = await withTempDir();
  try {
    let calls = 0;
    const deps = {
      fetchImpl: async () => { calls += 1; return okJson(KIMI_FIXTURE); },
      now: () => 1000000,
      cacheDir: () => dir,
    };
    const cfg = makeQuotaConfig();
    await collectQuota(cfg, { model: { display_name: 'k3[1M]' } }, {}, deps);
    await collectQuota(cfg, { model: { display_name: 'k3[1M]' } }, {}, { ...deps, now: () => 1000000 + 301_000 });
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectQuota ignores cache when the key changed (keyHash mismatch)', async () => {
  const dir = await withTempDir();
  try {
    let calls = 0;
    const firstDeps = { fetchImpl: async () => { calls += 1; return okJson(KIMI_FIXTURE); }, now: () => 1000000, cacheDir: () => dir };
    const cfg1 = makeQuotaConfig();
    await collectQuota(cfg1, { model: { display_name: 'k3[1M]' } }, {}, firstDeps);
    // Same provider, different key: cached entry must be ignored.
    const cfg2 = makeQuotaConfig({ providers: { kimi: { apiKey: 'sk-kimi-other-key', models: ['k3'] } } });
    await collectQuota(cfg2, { model: { display_name: 'k3[1M]' } }, {}, { ...firstDeps, now: () => 1000000 + 60_000 });
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectQuota falls back to stale cache when fetch fails', async () => {
  const dir = await withTempDir();
  try {
    const okDeps = { fetchImpl: async () => okJson(KIMI_FIXTURE), now: () => 1000000, cacheDir: () => dir };
    const cfg = makeQuotaConfig();
    await collectQuota(cfg, { model: { display_name: 'k3[1M]' } }, {}, okDeps);
    // Stale cache + failing fetch → stale data returned, no crash.
    const failDeps = {
      fetchImpl: async () => { throw new Error('network down'); },
      now: () => 1000000 + 10_000_000,
      cacheDir: () => dir,
    };
    const data = await collectQuota(cfg, { model: { display_name: 'k3[1M]' } }, {}, failDeps);
    assert.equal(data.length, 1);
    assert.equal(data[0].provider, 'kimi');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectQuota returns [] on fetch failure without cache', async () => {
  const dir = await withTempDir();
  try {
    const deps = {
      fetchImpl: async () => { throw new Error('network down'); },
      now: () => 1000000,
      cacheDir: () => dir,
    };
    const data = await collectQuota(makeQuotaConfig(), { model: { display_name: 'k3[1M]' } }, {}, deps);
    assert.deepEqual(data, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectQuota sanitizes malicious strings from provider responses', async () => {
  const dir = await withTempDir();
  try {
    const poisoned = {
      is_available: true,
      balance_infos: [{ currency: '\x1b[31mCNY\x1b[0m', total_balance: '12.34' }],
    };
    const deps = { fetchImpl: async () => okJson(poisoned), now: () => 1000000, cacheDir: () => dir };
    const cfg = makeQuotaConfig({
      providers: { deepseek: { apiKey: 'sk-ds-test', models: ['deepseek'] } },
    });
    const data = await collectQuota(cfg, { model: { display_name: 'deepseek-v4-flash[1M]' } }, {}, deps);
    assert.equal(data.length, 1);
    assert.equal(data[0].balance.currency, 'CNY'); // ANSI stripped
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectQuota all mode returns every provider concurrently', async () => {
  const dir = await withTempDir();
  try {
    const deps = {
      fetchImpl: async (url) => {
        if (url.includes('kimi.com')) return okJson(KIMI_FIXTURE);
        if (url.includes('deepseek.com')) return okJson(DEEPSEEK_FIXTURE);
        throw new Error('unexpected url');
      },
      now: () => 1000000,
      cacheDir: () => dir,
    };
    const cfg = makeQuotaConfig({ displayMode: 'all' });
    const data = await collectQuota(cfg, { model: { display_name: 'anything' } }, {}, deps);
    assert.deepEqual(data.map(d => d.provider).sort(), ['deepseek', 'kimi']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
