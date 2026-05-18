export function formatMoney(n: number | null | undefined): string {
  const num = Number(n) || 0;
  return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Compact Indian rupee formatter — uses Indian abbreviation conventions:
 *   below 1k  → ₹847
 *   1k–99k   → ₹7.86k
 *   1L–99L   → ₹7.69L  (lakh = 100,000)
 *   ≥ 1Cr    → ₹1.23Cr (crore = 10,000,000)
 *
 * Designed for KPI tiles where horizontal space is tight. For exact amounts
 * (tables, receipts, payment confirmations) use formatMoney instead.
 */
export function formatCompactINR(n: number | null | undefined): string {
  const num = Math.abs(Number(n) || 0);
  const sign = (Number(n) || 0) < 0 ? '-' : '';
  if (num < 1000) return `${sign}₹${Math.round(num).toLocaleString('en-IN')}`;
  if (num < 100_000) return `${sign}₹${(num / 1000).toFixed(num < 10_000 ? 2 : 1)}k`;
  if (num < 10_000_000) return `${sign}₹${(num / 100_000).toFixed(2)}L`;
  return `${sign}₹${(num / 10_000_000).toFixed(2)}Cr`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}
