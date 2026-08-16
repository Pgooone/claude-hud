import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CONFIG, mergeConfig } from '../dist/config.js';
import {
  collectPlancost,
  resolvePlancostModel,
  matchPlancostProviders,
  parseKimiResponse,
  parseDeepSeekResponse,
  parseGlmResponse,
  parseMiniMaxResponse,
  parseVolcAfpResponse,
  parseVolcCodingPlanResponse,
  signVolcRequest,
} from '../dist/plancost.js';

const KIMI_FIXTURE = {
  user: { membership: { level: 'LEVEL_ADVANCED' } },
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

const MINIMAX_FIXTURE = {
  base_resp: { status_code: 0, status_msg: '' },
  model_remains: [
    { model_name: 'general', current_interval_remaining_percent: 85, current_weekly_remaining_percent: 31, current_weekly_status: 1, end_time: 1786537440000, weekly_end_time: 1787137440000 },
    { model_name: 'abab6.5s-chat', current_interval_remaining_percent: 50, current_weekly_status: 0 },
  ],
};

const VOLC_AFP_FIXTURE = {
  ResponseMetadata: { RequestId: 'req-1', Action: 'GetAFPUsage', Version: '2024-01-01', Service: 'ark', Region: 'cn-beijing' },
  Result: {
    PlanType: 'agent_plan_pro',
    AFPFiveHour: { Quota: 100, Used: 25, ResetTime: 1786537440000 },
    AFPWeekly: { Quota: 700, Used: 483, ResetTime: 1787137440000 },
    AFPMonthly: { Quota: 2800, Used: 2100, ResetTime: 1787655840000 },
    AFPDaily: { Quota: 40, Used: 5, ResetTime: 1786451040000 },
  },
};

const VOLC_CODING_PLAN_FIXTURE = {
  ResponseMetadata: { RequestId: 'req-2', Action: 'GetCodingPlanUsage' },
  Result: {
    Status: 'ok',
    UpdateTimestamp: 1786451040,
    QuotaUsage: [
      { Level: 'session', Percent: 40, ResetTimestamp: 1786458640 },
      { Level: 'weekly', Percent: 72, ResetTimestamp: 1787137440 },
      { Level: 'monthly', Percent: 55, ResetTimestamp: -1 },
    ],
  },
};

function makePlancostConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    plancost: {
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

// ---------- resolvePlancostModel ----------

test('resolvePlancostModel prefers transcript model on auto', () => {
  const stdin = { model: { display_name: 'k3[1M]' } };
  const transcript = { lastAssistantModel: 'deepseek-v4-flash' };
  assert.equal(resolvePlancostModel(stdin, transcript, 'auto'), 'deepseek-v4-flash');
});

test('resolvePlancostModel falls back to stdin model when transcript is empty', () => {
  const stdin = { model: { display_name: 'k3[1M]' } };
  assert.equal(resolvePlancostModel(stdin, {}, 'auto'), 'k3[1M]');
});

test('resolvePlancostModel honors explicit stdin mode', () => {
  const stdin = { model: { display_name: 'k3[1M]' } };
  const transcript = { lastAssistantModel: 'deepseek-v4-flash' };
  assert.equal(resolvePlancostModel(stdin, transcript, 'stdin'), 'k3[1M]');
});

test('resolvePlancostModel sanitizes transcript model', () => {
  const stdin = { model: { display_name: 'k3[1M]' } };
  const transcript = { lastAssistantModel: '\x1b[31mdeepseek\x1b[0m' };
  assert.equal(resolvePlancostModel(stdin, transcript, 'auto'), 'deepseek');
});

// ---------- matchPlancostProviders ----------

test('matchPlancostProviders auto matches k3 prefix to kimi', () => {
  const cfg = makePlancostConfig().plancost;
  assert.deepEqual(matchPlancostProviders(cfg, 'k3[1M]'), ['kimi']);
});

test('matchPlancostProviders auto returns [] when nothing matches', () => {
  const cfg = makePlancostConfig().plancost;
  assert.deepEqual(matchPlancostProviders(cfg, 'claude-opus'), []);
});

test('matchPlancostProviders auto is case-insensitive', () => {
  const cfg = makePlancostConfig().plancost;
  assert.deepEqual(matchPlancostProviders(cfg, 'K3-256'), ['kimi']);
});

test('matchPlancostProviders all returns every provider with a key', () => {
  const cfg = makePlancostConfig({ displayMode: 'all' }).plancost;
  assert.deepEqual(matchPlancostProviders(cfg, 'anything'), ['kimi', 'deepseek']);
});

test('matchPlancostProviders skips providers with empty apiKey', () => {
  const cfg = makePlancostConfig({
    providers: { kimi: { apiKey: 'sk-kimi-test', models: ['k3'] }, glm: { apiKey: '', models: ['glm'] } },
    displayMode: 'all',
  }).plancost;
  assert.deepEqual(matchPlancostProviders(cfg, 'anything'), ['kimi']);
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

test('parseKimiResponse extracts membership plan level', () => {
  const d = parseKimiResponse(KIMI_FIXTURE);
  assert.ok(d);
  assert.equal(d.level, 'advanced'); // LEVEL_ADVANCED → advanced
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

test('parseGlmResponse accepts CREDIT_LIMIT windows (credit-plan keys)', () => {
  // Credit-plan keys (level: "lite") report CREDIT_LIMIT instead of TOKENS_LIMIT.
  const raw = {
    code: 200,
    data: {
      limits: [
        { type: 'CREDIT_LIMIT', unit: 3, percentage: 12, nextResetTime: 1786844859973 },
        { type: 'CREDIT_LIMIT', unit: 6, percentage: 2, nextResetTime: 1787297621998 },
      ],
      level: 'lite',
    },
  };
  const d = parseGlmResponse(raw);
  assert.ok(d);
  assert.equal(d.provider, 'glm');
  assert.equal(d.windows.length, 2);
  assert.equal(d.windows[0].label, '5h');
  assert.equal(d.windows[0].percent, 12);
  assert.equal(d.windows[1].label, 'week');
  assert.equal(d.windows[1].percent, 2);
  assert.equal(d.level, 'lite');
});

// ---------- collectPlancost: caching & degradation ----------

async function withTempDir() {
  return mkdtemp(path.join(tmpdir(), 'claude-hud-quota-test-'));
}

test('collectPlancost returns [] when plancost is disabled', async () => {
  const cfg = { ...DEFAULT_CONFIG, plancost: { ...DEFAULT_CONFIG.plancost, enabled: false } };
  const data = await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {});
  assert.deepEqual(data, []);
});

test('collectPlancost fetches and caches fresh data', async () => {
  const dir = await withTempDir();
  try {
    let calls = 0;
    const deps = { fetchImpl: async () => { calls += 1; return okJson(KIMI_FIXTURE); }, now: () => 1000000, cacheDir: () => dir };
    const cfg = makePlancostConfig();
    const first = await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, deps);
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

test('collectPlancost serves fresh cache without network', async () => {
  const dir = await withTempDir();
  try {
    let calls = 0;
    const deps = {
      fetchImpl: async () => { calls += 1; return okJson(KIMI_FIXTURE); },
      now: () => 1000000,
      cacheDir: () => dir,
    };
    const cfg = makePlancostConfig();
    await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, deps);
    // Cache is now fresh; second call within TTL must not hit the network.
    const second = await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, { ...deps, now: () => 1000000 + 60_000 });
    assert.equal(second.length, 1);
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectPlancost cache roundtrip restores Date resetAt', async () => {
  const dir = await withTempDir();
  try {
    const deps = { fetchImpl: async () => okJson(KIMI_FIXTURE), now: () => 1000000, cacheDir: () => dir };
    const cfg = makePlancostConfig();
    await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, deps);
    // Second call hits the cache written by the first; resetAt must be a Date
    // again after the JSON round-trip, otherwise rendering crashes.
    const second = await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, { ...deps, now: () => 1000000 + 60_000 });
    assert.equal(second.length, 1);
    assert.ok(second[0].windows[0].resetAt instanceof Date);
    assert.ok(second[0].windows[1].resetAt instanceof Date);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectPlancost refetches when cache is stale', async () => {
  const dir = await withTempDir();
  try {
    let calls = 0;
    const deps = {
      fetchImpl: async () => { calls += 1; return okJson(KIMI_FIXTURE); },
      now: () => 1000000,
      cacheDir: () => dir,
    };
    const cfg = makePlancostConfig();
    await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, deps);
    await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, { ...deps, now: () => 1000000 + 301_000 });
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectPlancost ignores cache when the key changed (keyHash mismatch)', async () => {
  const dir = await withTempDir();
  try {
    let calls = 0;
    const firstDeps = { fetchImpl: async () => { calls += 1; return okJson(KIMI_FIXTURE); }, now: () => 1000000, cacheDir: () => dir };
    const cfg1 = makePlancostConfig();
    await collectPlancost(cfg1, { model: { display_name: 'k3[1M]' } }, {}, firstDeps);
    // Same provider, different key: cached entry must be ignored.
    const cfg2 = makePlancostConfig({ providers: { kimi: { apiKey: 'sk-kimi-other-key', models: ['k3'] } } });
    await collectPlancost(cfg2, { model: { display_name: 'k3[1M]' } }, {}, { ...firstDeps, now: () => 1000000 + 60_000 });
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectPlancost falls back to stale cache when fetch fails', async () => {
  const dir = await withTempDir();
  try {
    const okDeps = { fetchImpl: async () => okJson(KIMI_FIXTURE), now: () => 1000000, cacheDir: () => dir };
    const cfg = makePlancostConfig();
    await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, okDeps);
    // Stale cache + failing fetch → stale data returned, no crash.
    const failDeps = {
      fetchImpl: async () => { throw new Error('network down'); },
      now: () => 1000000 + 10_000_000,
      cacheDir: () => dir,
    };
    const data = await collectPlancost(cfg, { model: { display_name: 'k3[1M]' } }, {}, failDeps);
    assert.equal(data.length, 1);
    assert.equal(data[0].provider, 'kimi');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectPlancost returns [] on fetch failure without cache', async () => {
  const dir = await withTempDir();
  try {
    const deps = {
      fetchImpl: async () => { throw new Error('network down'); },
      now: () => 1000000,
      cacheDir: () => dir,
    };
    const data = await collectPlancost(makePlancostConfig(), { model: { display_name: 'k3[1M]' } }, {}, deps);
    assert.deepEqual(data, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectPlancost sanitizes malicious strings from provider responses', async () => {
  const dir = await withTempDir();
  try {
    const poisoned = {
      is_available: true,
      balance_infos: [{ currency: '\x1b[31mCNY\x1b[0m', total_balance: '12.34' }],
    };
    const deps = { fetchImpl: async () => okJson(poisoned), now: () => 1000000, cacheDir: () => dir };
    const cfg = makePlancostConfig({
      providers: { deepseek: { apiKey: 'sk-ds-test', models: ['deepseek'] } },
    });
    const data = await collectPlancost(cfg, { model: { display_name: 'deepseek-v4-flash[1M]' } }, {}, deps);
    assert.equal(data.length, 1);
    assert.equal(data[0].balance.currency, 'CNY'); // ANSI stripped
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectPlancost all mode returns every provider concurrently', async () => {
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
    const cfg = makePlancostConfig({ displayMode: 'all' });
    const data = await collectPlancost(cfg, { model: { display_name: 'anything' } }, {}, deps);
    assert.deepEqual(data.map(d => d.provider).sort(), ['deepseek', 'kimi']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- MiniMax ----------

test('parseMiniMaxResponse inverts remaining percentages for the general entry', () => {
  const d = parseMiniMaxResponse(MINIMAX_FIXTURE);
  assert.ok(d);
  assert.equal(d.provider, 'minimax');
  assert.equal(d.windows.length, 2);
  assert.equal(d.windows[0].label, '5h');
  assert.equal(d.windows[0].percent, 15);   // 100 - 85 remaining
  assert.equal(d.windows[1].label, 'week');
  assert.equal(d.windows[1].percent, 69);   // 100 - 31 remaining
  assert.ok(d.windows[0].resetAt instanceof Date);
});

test('parseMiniMaxResponse omits weekly window when status != 1', () => {
  const raw = {
    base_resp: { status_code: 0 },
    model_remains: [{ model_name: 'general', current_interval_remaining_percent: 40, current_weekly_remaining_percent: 10, current_weekly_status: 0 }],
  };
  const d = parseMiniMaxResponse(raw);
  assert.ok(d);
  assert.equal(d.windows.length, 1);
  assert.equal(d.windows[0].label, '5h');
});

test('parseMiniMaxResponse returns null on base_resp error envelope', () => {
  assert.equal(parseMiniMaxResponse({ base_resp: { status_code: 1004, status_msg: 'invalid key' }, model_remains: [] }), null);
  assert.equal(parseMiniMaxResponse({ model_remains: [{ model_name: 'other' }] }), null);
});

// ---------- Volcengine ----------

test('parseVolcAfpResponse builds windows from absolute quotas, skipping AFPDaily', () => {
  const d = parseVolcAfpResponse(VOLC_AFP_FIXTURE);
  assert.ok(d);
  assert.equal(d.provider, 'volcengine');
  assert.equal(d.windows.length, 3); // 5h + week + month; daily intentionally skipped
  assert.equal(d.windows[0].label, '5h');
  assert.equal(d.windows[0].percent, 25);        // 25/100
  assert.equal(d.windows[1].label, 'week');
  assert.equal(d.windows[1].percent, 69);        // 483/700
  assert.equal(d.windows[2].label, 'month');
  assert.equal(d.windows[2].percent, 75);        // 2100/2800
});

test('parseVolcAfpResponse returns null when quota <= 0 (not subscribed) or on error envelope', () => {
  const noSub = { Result: { PlanType: '', AFPFiveHour: { Quota: 0, Used: 0 } } };
  assert.equal(parseVolcAfpResponse(noSub), null);
  const errEnvelope = { ResponseMetadata: { Error: { Code: 'InvalidAuthorization', Message: 'sig' } }, Result: {} };
  assert.equal(parseVolcAfpResponse(errEnvelope), null);
});

test('parseVolcCodingPlanResponse maps levels and treats ResetTimestamp -1 as no reset', () => {
  const d = parseVolcCodingPlanResponse(VOLC_CODING_PLAN_FIXTURE);
  assert.ok(d);
  assert.equal(d.windows.length, 3);
  assert.equal(d.windows[0].label, '5h');       // session
  assert.equal(d.windows[0].percent, 40);
  assert.equal(d.windows[1].label, 'week');     // weekly
  assert.equal(d.windows[2].label, 'month');    // monthly
  assert.equal(d.windows[2].resetAt, null);     // ResetTimestamp -1
  assert.equal(d.windows[0].resetAt instanceof Date, true); // seconds → Date
});

test('signVolcRequest follows the Volcengine SigV4 variant structure', () => {
  const fixedNow = Date.UTC(2026, 7, 12, 8, 30, 5); // 2026-08-12T08:30:05Z
  const { url, headers } = signVolcRequest('AKLT-test', 'sk-test', 'GetAFPUsage', fixedNow);
  // Same canonical query string is used for signing and the request URL (alphabetical).
  assert.equal(url, 'https://open.volcengineapi.com/?Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01');
  assert.equal(headers['X-Date'], '20260812T083005Z');
  assert.equal(headers.Host, 'open.volcengineapi.com');
  assert.equal(headers['Content-Type'], 'application/json; charset=utf-8');
  // sha256 of empty string
  assert.equal(headers['X-Content-Sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const auth = headers.Authorization;
  assert.ok(auth.startsWith('HMAC-SHA256 Credential=AKLT-test/20260812/cn-beijing/ark/request, '));
  assert.ok(auth.includes('SignedHeaders=host;x-date;x-content-sha256;content-type'));
  assert.ok(/Signature=[0-9a-f]{64}$/.test(auth));
});

test('collectPlancost volcengine falls back from AFP to Coding Plan', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-plancost-volc-'));
  try {
    const calls = [];
    const deps = {
      fetchImpl: async (url, init) => {
        calls.push(init.headers['X-Date'] ? url : url);
        if (url.includes('GetAFPUsage')) {
          return { ok: true, json: async () => ({ Result: { PlanType: '', AFPFiveHour: { Quota: 0, Used: 0 } } }) };
        }
        return { ok: true, json: async () => VOLC_CODING_PLAN_FIXTURE };
      },
      now: () => 1000000,
      cacheDir: () => dir,
    };
    const cfg = makePlancostConfig({
      providers: { volcengine: { apiKey: 'AKLT-test', secretKey: 'sk-test', models: ['doubao'] } },
    });
    const data = await collectPlancost(cfg, { model: { display_name: 'doubao-seed-2.0-code' } }, {}, deps);
    assert.equal(data.length, 1);
    assert.equal(data[0].provider, 'volcengine');
    assert.equal(data[0].windows.length, 3);
    assert.equal(calls.filter(u => u.includes('GetAFPUsage')).length, 1);
    assert.equal(calls.filter(u => u.includes('GetCodingPlanUsage')).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- config merge: new providers ----------

test('mergeConfig registers volcengine only when both AK and SK are present', () => {
  
  const withBoth = mergeConfig({
    plancost: { enabled: true, providers: { volcengine: { apiKey: 'AKLT-x', secretKey: 'sk-x', models: ['doubao'] } } },
  });
  assert.ok(withBoth.plancost.providers.volcengine);
  assert.equal(withBoth.plancost.providers.volcengine.secretKey, 'sk-x');
  const missingSk = mergeConfig({
    plancost: { enabled: true, providers: { volcengine: { apiKey: 'AKLT-x', models: ['doubao'] } } },
  });
  assert.equal(missingSk.plancost.providers.volcengine, undefined);
});

test('mergeConfig accepts minimax provider with endpoint override', () => {
  
  const cfg = mergeConfig({
    plancost: { enabled: true, providers: { minimax: { apiKey: 'eyJ-x', models: ['minimax'], endpoint: 'https://api.minimax.io' } } },
  });
  assert.equal(cfg.plancost.providers.minimax.endpoint, 'https://api.minimax.io');
});
