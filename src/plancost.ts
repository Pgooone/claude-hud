/**
 * Plancost data collection for third-party model providers.
 *
 * Queries coding-plan usage or account balance directly from the provider
 * APIs (Kimi / DeepSeek / GLM), with a 5-minute disk cache so the statusline
 * process (spawned fresh on every refresh) does not hit the network each tick.
 *
 * Key design points:
 *  - `collectPlancost` NEVER throws: failures degrade to fewer/missing segments.
 *  - Cache is keyed by a hash of the apiKey — swapping keys invalidates old
 *    data immediately (no cross-provider / cross-key contamination).
 *  - Provider responses are untrusted terminal input: every displayed string
 *    passes through `sanitizeDisplayText` before being cached or rendered.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import type { PlancostConfig, PlancostProviderConfig } from './config.js';
import { sanitizeTranscriptModel } from './model-source.js';
import { getModelName } from './stdin.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import type { StdinData, TranscriptData } from './types.js';

export type PlancostProviderId = 'kimi' | 'deepseek' | 'glm' | 'minimax' | 'volcengine';

export interface PlancostWindow {
  label: '5h' | 'week' | 'month';
  /** 0-100 percentage of the window used. */
  percent: number;
  resetAt: Date | null;
}

export interface PlancostData {
  provider: PlancostProviderId;
  /** Plan level (kimi membership / glm data.level), e.g. "advanced", "lite". */
  level?: string;
  /** Windows present for coding-plan providers (kimi / glm). */
  windows?: PlancostWindow[];
  /** Balance present for pay-as-you-go providers (deepseek). */
  balance?: { amount: number; currency: string };
}

export type PlancostDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  cacheDir: () => string;
};

const TTL = 300_000; // 5 minutes
const TIMEOUT_MS = 2_000; // per-request timeout; keep the statusline refresh snappy

/**
 * Resolve the model the plancost segment should match against.
 *
 * Transcript `lastAssistantModel` reflects the model the API actually served
 * (proxy redirects included) and is preferred for 'auto'/'transcript'; stdin
 * model (what Claude Code thinks it is using) is the fallback, covering
 * sessions that have not produced an assistant message yet.
 */
export function resolvePlancostModel(
  stdin: StdinData,
  transcript: TranscriptData,
  modelSource: 'auto' | 'stdin' | 'transcript',
): string {
  const transcriptModel = sanitizeTranscriptModel(transcript?.lastAssistantModel);
  if (modelSource === 'stdin') return getModelName(stdin);
  return transcriptModel ?? getModelName(stdin);
}

/**
 * Select the providers to display.
 *  - "auto": the first provider (config key order) whose `models` prefix
 *    matches the current model; none when nothing matches.
 *  - "all": every provider with a non-empty apiKey, in config key order.
 */
export function matchPlancostProviders(cfg: PlancostConfig, model: string): PlancostProviderId[] {
  const withKey = Object.entries(cfg.providers)
    .filter(([, p]) => p.apiKey)
    .map(([name]) => name) as PlancostProviderId[];
  if (cfg.displayMode === 'all') return withKey;
  const low = model.toLowerCase();
  for (const name of withKey) {
    const p = cfg.providers[name];
    if (p.models.some(m => low.startsWith(m))) return [name];
  }
  return [];
}

// ---------- response parsers (pure functions) ----------

function clampPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseDate(value: unknown): Date | null {
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t);
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // GLM sends millisecond timestamps; seconds fallback via the >1e12 heuristic.
    return new Date(value > 1e12 ? value : value * 1000);
  }
  return null;
}

function windowFrom(o: Record<string, unknown>, label: PlancostWindow['label']): PlancostWindow | null {
  const limit = Number(o.limit);
  if (!(limit > 0)) return null;
  const used = Number(o.used);
  if (!Number.isFinite(used) || used < 0) return null;
  return { label, percent: clampPercent((used / limit) * 100), resetAt: parseDate(o.resetTime) };
}

/** Normalize a plan-level code ("LEVEL_ADVANCED" → "advanced"); '' when absent. */
function planLevelOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  return sanitizeDisplayText(value.replace(/^LEVEL_/i, '')).trim().toLowerCase().slice(0, 12);
}

/** Kimi For Coding: 5h window in limits[0].detail, weekly quota in usage; membership level as plan level. */
export function parseKimiResponse(raw: unknown): PlancostData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const windows: PlancostWindow[] = [];
  const limits = d.limits;
  const detail = Array.isArray(limits)
    ? (limits[0] as Record<string, unknown> | undefined)?.detail
    : undefined;
  if (detail && typeof detail === 'object') {
    const w = windowFrom(detail as Record<string, unknown>, '5h');
    if (w) windows.push(w);
  }
  if (d.usage && typeof d.usage === 'object') {
    const w = windowFrom(d.usage as Record<string, unknown>, 'week');
    if (w) windows.push(w);
  }
  const membership = (d.user as Record<string, unknown> | undefined)?.membership as Record<string, unknown> | undefined;
  const level = planLevelOf(membership?.level);
  return windows.length ? { provider: 'kimi', windows, ...(level ? { level } : {}) } : null;
}

/** DeepSeek: account balance. total_balance is a string; currency CNY/USD. */
export function parseDeepSeekResponse(raw: unknown): PlancostData | null {
  if (!raw || typeof raw !== 'object') return null;
  const infos = (raw as Record<string, unknown>).balance_infos;
  if (!Array.isArray(infos) || !infos[0] || typeof infos[0] !== 'object') return null;
  const b = infos[0] as Record<string, unknown>;
  const amount = Number(b.total_balance);
  if (!Number.isFinite(amount)) return null;
  const currency = typeof b.currency === 'string'
    ? sanitizeDisplayText(b.currency).trim().slice(0, 8)
    : '';
  return { provider: 'deepseek', balance: { amount, currency: currency || 'CNY' } };
}

/**
 * MiniMax coding plan: `model_remains[]` carries REMAINING percentages —
 * invert to used. Only the "general" entry is the plan quota; the weekly
 * bucket exists only when current_weekly_status === 1.
 */
export function parseMiniMaxResponse(raw: unknown): PlancostData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const baseResp = d.base_resp as Record<string, unknown> | undefined;
  if (baseResp && Number(baseResp.status_code) !== 0) return null;
  const remains = d.model_remains;
  if (!Array.isArray(remains)) return null;
  const general = remains.find(
    (m): m is Record<string, unknown> =>
      !!m && typeof m === 'object' && (m as Record<string, unknown>).model_name === 'general',
  );
  if (!general) return null;
  const windows: PlancostWindow[] = [];
  const intervalRemain = Number(general.current_interval_remaining_percent);
  if (Number.isFinite(intervalRemain)) {
    windows.push({ label: '5h', percent: clampPercent(100 - intervalRemain), resetAt: parseDate(general.end_time) });
  }
  if (general.current_weekly_status === 1) {
    const weeklyRemain = Number(general.current_weekly_remaining_percent);
    if (Number.isFinite(weeklyRemain)) {
      windows.push({ label: 'week', percent: clampPercent(100 - weeklyRemain), resetAt: parseDate(general.weekly_end_time) });
    }
  }
  return windows.length ? { provider: 'minimax', windows } : null;
}

/** Volcengine API responses carry errors in a 200 ResponseMetadata.Error envelope. */
function volcEnvelopeError(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return true;
  const meta = (raw as Record<string, unknown>).ResponseMetadata as Record<string, unknown> | undefined;
  return !!(meta && meta.Error && typeof meta.Error === 'object');
}

/**
 * Volcengine Agent Plan (AFP): absolute Quota/Used windows for 5h / weekly /
 * monthly. AFPDaily is intentionally skipped (hidden in the official console;
 * its quota is historically above the weekly cap). Returns null when no
 * window has Quota > 0 — the caller falls back to the Coding Plan API.
 */
export function parseVolcAfpResponse(raw: unknown): PlancostData | null {
  if (volcEnvelopeError(raw)) return null;
  const result = (raw as Record<string, unknown>).Result as Record<string, unknown> | undefined;
  if (!result) return null;
  const windows: PlancostWindow[] = [];
  const add = (key: string, label: PlancostWindow['label']) => {
    const w = result[key] as Record<string, unknown> | undefined;
    if (!w || typeof w !== 'object') return;
    const quota = Number(w.Quota);
    const used = Number(w.Used);
    if (!(quota > 0) || !Number.isFinite(used) || used < 0) return;
    windows.push({ label, percent: clampPercent((used / quota) * 100), resetAt: parseDate(w.ResetTime) });
  };
  add('AFPFiveHour', '5h');
  add('AFPWeekly', 'week');
  add('AFPMonthly', 'month');
  return windows.length ? { provider: 'volcengine', windows } : null;
}

/** Volcengine Coding Plan: percentage-only windows keyed by Level. ResetTimestamp is SECONDS; <= 0 means no active window. */
export function parseVolcCodingPlanResponse(raw: unknown): PlancostData | null {
  if (volcEnvelopeError(raw)) return null;
  const result = (raw as Record<string, unknown>).Result as Record<string, unknown> | undefined;
  const usage = result?.QuotaUsage;
  if (!Array.isArray(usage)) return null;
  const LEVEL_MAP: Record<string, PlancostWindow['label']> = { session: '5h', weekly: 'week', monthly: 'month' };
  const windows: PlancostWindow[] = [];
  for (const item of usage) {
    if (!item || typeof item !== 'object') continue;
    const u = item as Record<string, unknown>;
    const label = LEVEL_MAP[String(u.Level)];
    if (!label) continue;
    const resetRaw = Number(u.ResetTimestamp);
    windows.push({
      label,
      percent: clampPercent(u.Percent),
      resetAt: Number.isFinite(resetRaw) && resetRaw > 0 ? new Date(resetRaw * 1000) : null,
    });
  }
  return windows.length ? { provider: 'volcengine', windows } : null;
}

/**
 * GLM (Zhipu): TOKENS_LIMIT / CREDIT_LIMIT windows. unit 3 → 5h window,
 * unit 6 → weekly; other units fill the missing slots ordered by next reset
 * time. `data.level` (e.g. "lite") is surfaced as the plan level.
 */
export function parseGlmResponse(raw: unknown): PlancostData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = (raw as Record<string, unknown>).data;
  const limits = data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).limits)
    ? (data as Record<string, unknown>).limits as unknown[]
    : [];
  const slots: PlancostWindow[] = [];
  const others: { percent: number; resetAt: Date | null }[] = [];
  for (const item of limits) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const type = String(l.type ?? '').toUpperCase();
    if (type !== 'TOKENS_LIMIT' && type !== 'CREDIT_LIMIT') continue;
    const percent = clampPercent(l.percentage);
    const resetAt = parseDate(l.nextResetTime);
    if (l.unit === 3) slots.push({ label: '5h', percent, resetAt });
    else if (l.unit === 6) slots.push({ label: 'week', percent, resetAt });
    else others.push({ percent, resetAt });
  }
  others.sort((a, b) => (a.resetAt?.getTime() ?? Infinity) - (b.resetAt?.getTime() ?? Infinity));
  if (!slots.some(s => s.label === '5h') && others.length) slots.push({ label: '5h', ...others.shift()! });
  if (!slots.some(s => s.label === 'week') && others.length) slots.push({ label: 'week', ...others.shift()! });
  slots.sort((a, b) => (a.label === '5h' ? 0 : 1) - (b.label === '5h' ? 0 : 1));
  const level = planLevelOf(data && typeof data === 'object' ? (data as Record<string, unknown>).level : undefined);
  return slots.length ? { provider: 'glm', windows: slots, ...(level ? { level } : {}) } : null;
}

// ---------- fetch ----------

async function getJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchKimi(key: string, fetchImpl: typeof fetch): Promise<PlancostData> {
  const raw = await getJson(
    'https://api.kimi.com/coding/v1/usages',
    { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    fetchImpl,
  );
  const data = parseKimiResponse(raw);
  if (!data) throw new Error('invalid kimi payload');
  return data;
}

async function fetchDeepSeek(key: string, fetchImpl: typeof fetch): Promise<PlancostData> {
  const raw = await getJson(
    'https://api.deepseek.com/user/balance',
    { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    fetchImpl,
  );
  const data = parseDeepSeekResponse(raw);
  if (!data) throw new Error('invalid deepseek payload');
  return data;
}

async function fetchGlm(key: string, endpoint: string | undefined, fetchImpl: typeof fetch): Promise<PlancostData> {
  const base = endpoint || 'https://open.bigmodel.cn';
  const raw = await getJson(
    `${base}/api/monitor/usage/quota/limit`,
    // GLM authenticates with the bare key — no Bearer prefix (auth fails with one).
    { Authorization: key, 'Accept-Language': 'en-US,en' },
    fetchImpl,
  );
  const data = parseGlmResponse(raw);
  if (!data) throw new Error('invalid glm payload');
  return data;
}

async function fetchMiniMax(key: string, endpoint: string | undefined, fetchImpl: typeof fetch): Promise<PlancostData> {
  const base = endpoint || 'https://api.minimaxi.com';
  const raw = await getJson(
    `${base}/v1/api/openplatform/coding_plan/remains`,
    { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    fetchImpl,
  );
  const data = parseMiniMaxResponse(raw);
  if (!data) throw new Error('invalid minimax payload');
  return data;
}

// ---------- Volcengine Signature V4 (per cc-switch coding_plan.rs) ----------

const VOLC_HOST = 'open.volcengineapi.com';
const VOLC_REGION = 'cn-beijing';
const VOLC_SERVICE = 'ark';
// Volcengine's variant deviates from standard AWS SigV4: this exact header
// order (NOT alphabetical), algorithm "HMAC-SHA256" (no AWS4 prefix), scope
// suffix "request" (not aws4_request), and the secret is used raw.
const VOLC_SIGNED_HEADERS = 'host;x-date;x-content-sha256;content-type';

function hmacHex(key: crypto.BinaryLike | crypto.KeyObject, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Sign a Volcengine ark gateway request (POST with empty body).
 * The canonical query string is reused verbatim in the request URL — any
 * difference between the signed and sent query breaks the signature.
 */
export function signVolcRequest(
  accessKey: string,
  secretKey: string,
  action: string,
  nowMs: number,
): { url: string; headers: Record<string, string> } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date(nowMs);
  const xDate = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const shortDate = xDate.slice(0, 8);
  const contentType = 'application/json; charset=utf-8';
  const payloadHash = crypto.createHash('sha256').update('').digest('hex');
  const canonicalQuery = `Action=${action}&Region=${VOLC_REGION}&Version=2024-01-01`;
  // Header lines follow Volcengine's fixed order, not alphabetical order.
  const canonicalHeaders =
    `host:${VOLC_HOST}\n` +
    `x-date:${xDate}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `content-type:${contentType}\n`;
  const canonicalRequest =
    `POST\n/\n${canonicalQuery}\n${canonicalHeaders}\n${VOLC_SIGNED_HEADERS}\n${payloadHash}`;
  const scope = `${shortDate}/${VOLC_REGION}/${VOLC_SERVICE}/request`;
  const stringToSign =
    `HMAC-SHA256\n${xDate}\n${scope}\n` +
    crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const kDate = crypto.createHmac('sha256', secretKey).update(shortDate).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(VOLC_REGION).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(VOLC_SERVICE).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    url: `https://${VOLC_HOST}/?${canonicalQuery}`,
    headers: {
      Host: VOLC_HOST,
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      'Content-Type': contentType,
      Authorization: `HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${VOLC_SIGNED_HEADERS}, Signature=${signature}`,
    },
  };
}

async function postVolcJson(
  signed: { url: string; headers: Record<string, string> },
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: '',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // The gateway often returns signature errors as HTTP 400 with a
  // ResponseMetadata.Error envelope; surface the body so the parser sees it.
  const raw = (await res.json().catch(() => null)) as unknown;
  if (!res.ok && !raw) throw new Error(`HTTP ${res.status}`);
  return raw;
}

/**
 * Volcengine dual probe: try the Agent Plan (AFP) first; when it reports no
 * subscribed window (or fails), fall back to the Coding Plan API.
 */
async function fetchVolcengine(
  ak: string,
  sk: string,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<PlancostData> {
  try {
    const afp = await postVolcJson(signVolcRequest(ak, sk, 'GetAFPUsage', now()), fetchImpl);
    const afpData = parseVolcAfpResponse(afp);
    if (afpData) return afpData;
  } catch { /* fall through to the Coding Plan probe */ }
  const cpRaw = await postVolcJson(signVolcRequest(ak, sk, 'GetCodingPlanUsage', now()), fetchImpl);
  const data = parseVolcCodingPlanResponse(cpRaw);
  if (!data) throw new Error('invalid volcengine payload');
  return data;
}

// ---------- disk cache ----------

interface CacheEntry {
  keyHash: string;
  updatedAt: number;
  data: PlancostData;
}

interface CacheRead {
  data: PlancostData;
  updatedAt: number;
}

function keyHashOf(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

function cachePathFor(cacheDir: string, provider: string): string {
  return path.join(cacheDir, `${provider}.json`);
}

/** JSON round-trips Date to an ISO string; restore it on cache read. */
function revivePlancostData(data: PlancostData): PlancostData {
  if (!data.windows) return data;
  return {
    ...data,
    windows: data.windows.map(w => ({
      ...w,
      resetAt: typeof w.resetAt === 'string' ? new Date(w.resetAt) : w.resetAt,
    })),
  };
}

function readCache(cacheDir: string, provider: string, keyHash: string): CacheRead | null {
  try {
    const entry = JSON.parse(fs.readFileSync(cachePathFor(cacheDir, provider), 'utf8')) as CacheEntry;
    if (entry.keyHash !== keyHash || !entry.data) return null;
    return { data: revivePlancostData(entry.data), updatedAt: entry.updatedAt };
  } catch {
    return null;
  }
}

function writeCache(cacheDir: string, provider: string, keyHash: string, updatedAt: number, data: PlancostData): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const target = cachePathFor(cacheDir, provider);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ keyHash, updatedAt, data } satisfies CacheEntry), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch { /* cache write failures must not break the segment */ }
}

// ---------- collect ----------

async function fetchOrCache(provider: PlancostProviderId, cfg: PlancostProviderConfig, deps: PlancostDeps): Promise<PlancostData> {
  // Volcengine signs with AK + SK; hash both so swapping either invalidates cache.
  const keyHash = keyHashOf(cfg.apiKey + (cfg.secretKey ? `\n${cfg.secretKey}` : ''));
  const dir = deps.cacheDir();
  const cached = readCache(dir, provider, keyHash);
  if (cached && deps.now() - cached.updatedAt <= TTL) return cached.data;
  try {
    const data = provider === 'kimi'
      ? await fetchKimi(cfg.apiKey, deps.fetchImpl)
      : provider === 'deepseek'
        ? await fetchDeepSeek(cfg.apiKey, deps.fetchImpl)
        : provider === 'glm'
          ? await fetchGlm(cfg.apiKey, cfg.endpoint, deps.fetchImpl)
          : provider === 'minimax'
            ? await fetchMiniMax(cfg.apiKey, cfg.endpoint, deps.fetchImpl)
            : await fetchVolcengine(cfg.apiKey, cfg.secretKey ?? '', deps.fetchImpl, deps.now);
    writeCache(dir, provider, keyHash, deps.now(), data);
    return data;
  } catch {
    // Network failure: fall back to stale cache for the same key, if any.
    if (cached) return cached.data;
    throw new Error(`plancost fetch failed: ${provider}`);
  }
}

export async function collectPlancost(
  config: HudConfigLike,
  stdin: StdinData,
  transcript: TranscriptData,
  deps?: Partial<PlancostDeps>,
): Promise<PlancostData[]> {
  const d: PlancostDeps = {
    fetchImpl: globalThis.fetch,
    now: () => Date.now(),
    cacheDir: () => path.join(getHudPluginDir(os.homedir()), 'plancost-cache'),
    ...deps,
  };
  try {
    const plancostCfg = config.plancost;
    if (!plancostCfg?.enabled) return [];
    const model = resolvePlancostModel(stdin, transcript, config.display?.modelSource ?? 'auto');
    const providers = matchPlancostProviders(plancostCfg, model);
    if (providers.length === 0) return [];
    const settled = await Promise.allSettled(providers.map(p => fetchOrCache(p, plancostCfg.providers[p], d)));
    return settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
  } catch {
    return [];
  }
}

// Type-only shape so the module does not import the whole config module
// (avoids any import cycle through types.ts).
type HudConfigLike = {
  plancost?: PlancostConfig;
  display?: { modelSource?: 'auto' | 'stdin' | 'transcript' };
};
