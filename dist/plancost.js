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
import { sanitizeTranscriptModel } from './model-source.js';
import { getModelName } from './stdin.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
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
export function resolvePlancostModel(stdin, transcript, modelSource) {
    const transcriptModel = sanitizeTranscriptModel(transcript?.lastAssistantModel);
    if (modelSource === 'stdin')
        return getModelName(stdin);
    return transcriptModel ?? getModelName(stdin);
}
/**
 * Select the providers to display.
 *  - "auto": the first provider (config key order) whose `models` prefix
 *    matches the current model; none when nothing matches.
 *  - "all": every provider with a non-empty apiKey, in config key order.
 */
export function matchPlancostProviders(cfg, model) {
    const withKey = Object.entries(cfg.providers)
        .filter(([, p]) => p.apiKey)
        .map(([name]) => name);
    if (cfg.displayMode === 'all')
        return withKey;
    const low = model.toLowerCase();
    for (const name of withKey) {
        const p = cfg.providers[name];
        if (p.models.some(m => low.startsWith(m)))
            return [name];
    }
    return [];
}
// ---------- response parsers (pure functions) ----------
function clampPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}
function parseDate(value) {
    if (typeof value === 'string') {
        const t = Date.parse(value);
        if (!Number.isNaN(t))
            return new Date(t);
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        // GLM sends millisecond timestamps; seconds fallback via the >1e12 heuristic.
        return new Date(value > 1e12 ? value : value * 1000);
    }
    return null;
}
function windowFrom(o, label) {
    const limit = Number(o.limit);
    if (!(limit > 0))
        return null;
    // Kimi's 5h window (limits[].detail) carries `used`; the weekly quota
    // (`usage`) sometimes only carries `remaining` — derive used = limit - remaining
    // when the direct field is absent (cc-switch does the same).
    const used = o.used !== undefined && o.used !== null
        ? Number(o.used)
        : limit - Number(o.remaining);
    if (!Number.isFinite(used) || used < 0)
        return null;
    return { label, percent: clampPercent((used / limit) * 100), resetAt: parseDate(o.resetTime) };
}
/** Normalize a plan-level code ("LEVEL_ADVANCED" → "advanced"); '' when absent. */
function planLevelOf(value) {
    if (typeof value !== 'string')
        return '';
    return sanitizeDisplayText(value.replace(/^LEVEL_/i, '')).trim().toLowerCase().slice(0, 12);
}
/** Kimi For Coding: 5h window in limits[0].detail, weekly quota in usage; membership level as plan level. */
export function parseKimiResponse(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const d = raw;
    const windows = [];
    const limits = d.limits;
    const detail = Array.isArray(limits)
        ? limits[0]?.detail
        : undefined;
    if (detail && typeof detail === 'object') {
        const w = windowFrom(detail, '5h');
        if (w)
            windows.push(w);
    }
    if (d.usage && typeof d.usage === 'object') {
        const w = windowFrom(d.usage, 'week');
        if (w)
            windows.push(w);
    }
    const membership = d.user?.membership;
    const level = planLevelOf(membership?.level);
    return windows.length ? { provider: 'kimi', windows, ...(level ? { level } : {}) } : null;
}
/** DeepSeek: account balance. total_balance is a string; currency CNY/USD. */
export function parseDeepSeekResponse(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const infos = raw.balance_infos;
    if (!Array.isArray(infos) || !infos[0] || typeof infos[0] !== 'object')
        return null;
    const b = infos[0];
    const amount = Number(b.total_balance);
    if (!Number.isFinite(amount))
        return null;
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
export function parseMiniMaxResponse(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const d = raw;
    const baseResp = d.base_resp;
    if (baseResp && Number(baseResp.status_code) !== 0)
        return null;
    const remains = d.model_remains;
    if (!Array.isArray(remains))
        return null;
    const general = remains.find((m) => !!m && typeof m === 'object' && m.model_name === 'general');
    if (!general)
        return null;
    const windows = [];
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
function volcEnvelopeError(raw) {
    if (!raw || typeof raw !== 'object')
        return true;
    const meta = raw.ResponseMetadata;
    return !!(meta && meta.Error && typeof meta.Error === 'object');
}
/**
 * Volcengine Agent Plan (AFP): absolute Quota/Used windows for 5h / weekly /
 * monthly. AFPDaily is intentionally skipped (hidden in the official console;
 * its quota is historically above the weekly cap). Returns null when no
 * window has Quota > 0 — the caller falls back to the Coding Plan API.
 */
export function parseVolcAfpResponse(raw) {
    if (volcEnvelopeError(raw))
        return null;
    const result = raw.Result;
    if (!result)
        return null;
    const windows = [];
    const add = (key, label) => {
        const w = result[key];
        if (!w || typeof w !== 'object')
            return;
        const quota = Number(w.Quota);
        const used = Number(w.Used);
        if (!(quota > 0) || !Number.isFinite(used) || used < 0)
            return;
        windows.push({ label, percent: clampPercent((used / quota) * 100), resetAt: parseDate(w.ResetTime) });
    };
    add('AFPFiveHour', '5h');
    add('AFPWeekly', 'week');
    add('AFPMonthly', 'month');
    return windows.length ? { provider: 'volcengine', windows } : null;
}
/** Volcengine Coding Plan: percentage-only windows keyed by Level. ResetTimestamp is SECONDS; <= 0 means no active window. */
export function parseVolcCodingPlanResponse(raw) {
    if (volcEnvelopeError(raw))
        return null;
    const result = raw.Result;
    const usage = result?.QuotaUsage;
    if (!Array.isArray(usage))
        return null;
    const LEVEL_MAP = { session: '5h', weekly: 'week', monthly: 'month' };
    const windows = [];
    for (const item of usage) {
        if (!item || typeof item !== 'object')
            continue;
        const u = item;
        const label = LEVEL_MAP[String(u.Level)];
        if (!label)
            continue;
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
export function parseGlmResponse(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const data = raw.data;
    const limits = data && typeof data === 'object' && Array.isArray(data.limits)
        ? data.limits
        : [];
    const slots = [];
    const others = [];
    for (const item of limits) {
        if (!item || typeof item !== 'object')
            continue;
        const l = item;
        const type = String(l.type ?? '').toUpperCase();
        if (type !== 'TOKENS_LIMIT' && type !== 'CREDIT_LIMIT')
            continue;
        const percent = clampPercent(l.percentage);
        const resetAt = parseDate(l.nextResetTime);
        if (l.unit === 3)
            slots.push({ label: '5h', percent, resetAt });
        else if (l.unit === 6)
            slots.push({ label: 'week', percent, resetAt });
        else
            others.push({ percent, resetAt });
    }
    others.sort((a, b) => (a.resetAt?.getTime() ?? Infinity) - (b.resetAt?.getTime() ?? Infinity));
    if (!slots.some(s => s.label === '5h') && others.length)
        slots.push({ label: '5h', ...others.shift() });
    if (!slots.some(s => s.label === 'week') && others.length)
        slots.push({ label: 'week', ...others.shift() });
    slots.sort((a, b) => (a.label === '5h' ? 0 : 1) - (b.label === '5h' ? 0 : 1));
    const level = planLevelOf(data && typeof data === 'object' ? data.level : undefined);
    return slots.length ? { provider: 'glm', windows: slots, ...(level ? { level } : {}) } : null;
}
// ---------- fetch ----------
async function getJson(url, headers, fetchImpl) {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    return res.json();
}
async function fetchKimi(key, fetchImpl) {
    const raw = await getJson('https://api.kimi.com/coding/v1/usages', { Authorization: `Bearer ${key}`, Accept: 'application/json' }, fetchImpl);
    const data = parseKimiResponse(raw);
    if (!data)
        throw new Error('invalid kimi payload');
    return data;
}
async function fetchDeepSeek(key, fetchImpl) {
    const raw = await getJson('https://api.deepseek.com/user/balance', { Authorization: `Bearer ${key}`, Accept: 'application/json' }, fetchImpl);
    const data = parseDeepSeekResponse(raw);
    if (!data)
        throw new Error('invalid deepseek payload');
    return data;
}
async function fetchGlm(key, endpoint, fetchImpl) {
    const base = endpoint || 'https://open.bigmodel.cn';
    const raw = await getJson(`${base}/api/monitor/usage/quota/limit`, 
    // GLM authenticates with the bare key — no Bearer prefix (auth fails with one).
    { Authorization: key, 'Accept-Language': 'en-US,en' }, fetchImpl);
    const data = parseGlmResponse(raw);
    if (!data)
        throw new Error('invalid glm payload');
    return data;
}
async function fetchMiniMax(key, endpoint, fetchImpl) {
    const base = endpoint || 'https://api.minimaxi.com';
    const raw = await getJson(`${base}/v1/api/openplatform/coding_plan/remains`, { Authorization: `Bearer ${key}`, Accept: 'application/json' }, fetchImpl);
    const data = parseMiniMaxResponse(raw);
    if (!data)
        throw new Error('invalid minimax payload');
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
function hmacHex(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest('hex');
}
/**
 * Sign a Volcengine ark gateway request (POST with empty body).
 * The canonical query string is reused verbatim in the request URL — any
 * difference between the signed and sent query breaks the signature.
 */
export function signVolcRequest(accessKey, secretKey, action, nowMs) {
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date(nowMs);
    const xDate = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
        `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const shortDate = xDate.slice(0, 8);
    const contentType = 'application/json; charset=utf-8';
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');
    const canonicalQuery = `Action=${action}&Region=${VOLC_REGION}&Version=2024-01-01`;
    // Header lines follow Volcengine's fixed order, not alphabetical order.
    const canonicalHeaders = `host:${VOLC_HOST}\n` +
        `x-date:${xDate}\n` +
        `x-content-sha256:${payloadHash}\n` +
        `content-type:${contentType}\n`;
    const canonicalRequest = `POST\n/\n${canonicalQuery}\n${canonicalHeaders}\n${VOLC_SIGNED_HEADERS}\n${payloadHash}`;
    const scope = `${shortDate}/${VOLC_REGION}/${VOLC_SERVICE}/request`;
    const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n` +
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
async function postVolcJson(signed, fetchImpl) {
    const res = await fetchImpl(signed.url, {
        method: 'POST',
        headers: signed.headers,
        body: '',
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // The gateway often returns signature errors as HTTP 400 with a
    // ResponseMetadata.Error envelope; surface the body so the parser sees it.
    const raw = (await res.json().catch(() => null));
    if (!res.ok && !raw)
        throw new Error(`HTTP ${res.status}`);
    return raw;
}
/**
 * Volcengine dual probe: try the Agent Plan (AFP) first; when it reports no
 * subscribed window (or fails), fall back to the Coding Plan API.
 */
async function fetchVolcengine(ak, sk, fetchImpl, now) {
    try {
        const afp = await postVolcJson(signVolcRequest(ak, sk, 'GetAFPUsage', now()), fetchImpl);
        const afpData = parseVolcAfpResponse(afp);
        if (afpData)
            return afpData;
    }
    catch { /* fall through to the Coding Plan probe */ }
    const cpRaw = await postVolcJson(signVolcRequest(ak, sk, 'GetCodingPlanUsage', now()), fetchImpl);
    const data = parseVolcCodingPlanResponse(cpRaw);
    if (!data)
        throw new Error('invalid volcengine payload');
    return data;
}
function keyHashOf(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}
function cachePathFor(cacheDir, provider) {
    return path.join(cacheDir, `${provider}.json`);
}
/** JSON round-trips Date to an ISO string; restore it on cache read. */
function revivePlancostData(data) {
    if (!data.windows)
        return data;
    return {
        ...data,
        windows: data.windows.map(w => ({
            ...w,
            resetAt: typeof w.resetAt === 'string' ? new Date(w.resetAt) : w.resetAt,
        })),
    };
}
function readCache(cacheDir, provider, keyHash) {
    try {
        const entry = JSON.parse(fs.readFileSync(cachePathFor(cacheDir, provider), 'utf8'));
        if (entry.keyHash !== keyHash || !entry.data)
            return null;
        return { data: revivePlancostData(entry.data), updatedAt: entry.updatedAt };
    }
    catch {
        return null;
    }
}
function writeCache(cacheDir, provider, keyHash, updatedAt, data) {
    try {
        fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
        const target = cachePathFor(cacheDir, provider);
        const tmp = `${target}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ keyHash, updatedAt, data }), { mode: 0o600 });
        fs.renameSync(tmp, target);
    }
    catch { /* cache write failures must not break the segment */ }
}
// ---------- collect ----------
async function fetchOrCache(provider, cfg, deps) {
    // Volcengine signs with AK + SK; hash both so swapping either invalidates cache.
    const keyHash = keyHashOf(cfg.apiKey + (cfg.secretKey ? `\n${cfg.secretKey}` : ''));
    const dir = deps.cacheDir();
    const cached = readCache(dir, provider, keyHash);
    if (cached && deps.now() - cached.updatedAt <= TTL)
        return cached.data;
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
    }
    catch {
        // Network failure: fall back to stale cache for the same key, if any.
        if (cached)
            return cached.data;
        throw new Error(`plancost fetch failed: ${provider}`);
    }
}
export async function collectPlancost(config, stdin, transcript, deps) {
    const d = {
        fetchImpl: globalThis.fetch,
        now: () => Date.now(),
        cacheDir: () => path.join(getHudPluginDir(os.homedir()), 'plancost-cache'),
        ...deps,
    };
    try {
        const plancostCfg = config.plancost;
        if (!plancostCfg?.enabled)
            return [];
        const model = resolvePlancostModel(stdin, transcript, config.display?.modelSource ?? 'auto');
        const providers = matchPlancostProviders(plancostCfg, model);
        if (providers.length === 0)
            return [];
        const settled = await Promise.allSettled(providers.map(p => fetchOrCache(p, plancostCfg.providers[p], d)));
        return settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=plancost.js.map