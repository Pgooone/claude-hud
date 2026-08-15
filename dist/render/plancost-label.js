const PROVIDER_LABELS = { kimi: 'Kimi', deepseek: 'DS', glm: 'GLM' };
const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$' };
function emojiOf(percent) {
    return percent >= 85 ? '🔴' : percent >= 60 ? '🟡' : '🟢';
}
/** Reset time: same day → "(HH:MM)", later day → "(MM/DD)", unknown → "". */
export function fmtReset(resetAt) {
    if (!resetAt || Number.isNaN(resetAt.getTime()))
        return '';
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    if (resetAt.toDateString() === now.toDateString()) {
        return ` (${pad(resetAt.getHours())}:${pad(resetAt.getMinutes())})`;
    }
    return ` (${pad(resetAt.getMonth() + 1)}/${pad(resetAt.getDate())})`;
}
function windowsLabel(data, t) {
    const windows = data.windows ?? [];
    if (windows.length === 0)
        return '';
    const max = Math.max(...windows.map(w => w.percent));
    const parts = windows.map(w => `${w.label === 'week' ? t('label.plancostWeek') : w.label} ${w.percent}%${fmtReset(w.resetAt)}`);
    const level = typeof data.level === 'string' && data.level ? `(${data.level})` : '';
    return `${emojiOf(max)} ${PROVIDER_LABELS[data.provider]}${level} ${parts.join(' · ')}`;
}
function balanceLabel(data) {
    const b = data.balance;
    if (!b)
        return '';
    const symbol = CURRENCY_SYMBOLS[b.currency] ?? `${b.currency} `;
    const amount = Number.isFinite(b.amount) ? b.amount.toFixed(2) : String(b.amount);
    return `💰 ${PROVIDER_LABELS[data.provider]} ${symbol}${amount}`;
}
/** Join all providers into a single segment; null when there is nothing to show. */
export function formatPlancostLabel(data, t) {
    const parts = [];
    for (const d of data) {
        const label = d.balance ? balanceLabel(d) : windowsLabel(d, t);
        if (label)
            parts.push(label);
    }
    return parts.length ? parts.join(' · ') : null;
}
//# sourceMappingURL=plancost-label.js.map