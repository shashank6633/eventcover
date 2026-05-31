/**
 * Shared range-parsing helper for the analytics dashboard endpoints.
 *
 * Each chart route (revenue-by-event, funnel, affiliates, heatmap,
 * repeat-rate) accepts `?from=&to=` as UTC ms. When either is omitted the
 * caller falls back to the dashboard default (last 30 days ending now).
 *
 * Validation rules:
 *   • If both bounds are present they must parse as positive finite numbers.
 *   • from must be strictly less than to — otherwise we return an error so
 *     the UI can surface a clear message instead of silently empty data.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type AnalyticsRange = { from: number; to: number } | { error: string };

export function resolveAnalyticsRange(
  fromRaw: string | null,
  toRaw: string | null,
): AnalyticsRange {
  const now = Date.now();

  let to: number;
  if (toRaw != null && toRaw !== '') {
    const n = Number(toRaw);
    if (!Number.isFinite(n) || n <= 0) return { error: '`to` must be a positive timestamp' };
    to = n;
  } else {
    to = now;
  }

  let from: number;
  if (fromRaw != null && fromRaw !== '') {
    const n = Number(fromRaw);
    if (!Number.isFinite(n) || n <= 0) return { error: '`from` must be a positive timestamp' };
    from = n;
  } else {
    from = to - 30 * DAY_MS;
  }

  if (from >= to) return { error: '`from` must be earlier than `to`' };

  return { from, to };
}
