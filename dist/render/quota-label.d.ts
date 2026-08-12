/**
 * Render the quota segment label from collected QuotaData.
 *
 * Plain text + emoji health markers (claude-hud strips ANSI from external
 * data; emoji survive and read instantly). Thresholds:
 *   🟢 < 60%  🟡 60–84%  🔴 ≥ 85%
 */
import type { QuotaData } from '../quota.js';
import type { MessageKey } from '../i18n/types.js';
/** Reset time: same day → "(HH:MM)", later day → "(MM/DD)", unknown → "". */
export declare function fmtReset(resetAt: Date | null): string;
/** Join all providers into a single segment; null when there is nothing to show. */
export declare function formatQuotaLabel(data: QuotaData[], t: (k: MessageKey) => string): string | null;
//# sourceMappingURL=quota-label.d.ts.map