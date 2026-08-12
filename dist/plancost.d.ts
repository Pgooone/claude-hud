import type { PlancostConfig } from './config.js';
import type { StdinData, TranscriptData } from './types.js';
export type PlancostProviderId = 'kimi' | 'deepseek' | 'glm';
export interface PlancostWindow {
    label: '5h' | 'week';
    /** 0-100 percentage of the window used. */
    percent: number;
    resetAt: Date | null;
}
export interface PlancostData {
    provider: PlancostProviderId;
    /** Windows present for coding-plan providers (kimi / glm). */
    windows?: PlancostWindow[];
    /** Balance present for pay-as-you-go providers (deepseek). */
    balance?: {
        amount: number;
        currency: string;
    };
}
export type PlancostDeps = {
    fetchImpl: typeof fetch;
    now: () => number;
    cacheDir: () => string;
};
/**
 * Resolve the model the plancost segment should match against.
 *
 * Transcript `lastAssistantModel` reflects the model the API actually served
 * (proxy redirects included) and is preferred for 'auto'/'transcript'; stdin
 * model (what Claude Code thinks it is using) is the fallback, covering
 * sessions that have not produced an assistant message yet.
 */
export declare function resolvePlancostModel(stdin: StdinData, transcript: TranscriptData, modelSource: 'auto' | 'stdin' | 'transcript'): string;
/**
 * Select the providers to display.
 *  - "auto": the first provider (config key order) whose `models` prefix
 *    matches the current model; none when nothing matches.
 *  - "all": every provider with a non-empty apiKey, in config key order.
 */
export declare function matchPlancostProviders(cfg: PlancostConfig, model: string): PlancostProviderId[];
/** Kimi For Coding: 5h window in limits[0].detail, weekly quota in usage. */
export declare function parseKimiResponse(raw: unknown): PlancostData | null;
/** DeepSeek: account balance. total_balance is a string; currency CNY/USD. */
export declare function parseDeepSeekResponse(raw: unknown): PlancostData | null;
/**
 * GLM (Zhipu): TOKENS_LIMIT windows. unit 3 → 5h window, unit 6 → weekly;
 * other units fill the missing slots ordered by next reset time.
 */
export declare function parseGlmResponse(raw: unknown): PlancostData | null;
export declare function collectPlancost(config: HudConfigLike, stdin: StdinData, transcript: TranscriptData, deps?: Partial<PlancostDeps>): Promise<PlancostData[]>;
type HudConfigLike = {
    plancost?: PlancostConfig;
    display?: {
        modelSource?: 'auto' | 'stdin' | 'transcript';
    };
};
export {};
//# sourceMappingURL=plancost.d.ts.map