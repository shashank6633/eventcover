/**
 * Wallet expiry rules.
 *
 * A wallet is issued for an EVENT_DATE (a calendar date in the venue's timezone)
 * and expires at EVENT_CUTOFF_HOUR of the *next* calendar day, in the same timezone.
 *
 * Example: event date = 2026-04-24, cutoff = 2
 *   → wallet valid until 2026-04-25 at 02:00 IST (covers the full Saturday-night party)
 *
 * Timezone: hardcoded to Asia/Kolkata (IST, UTC+5:30, no DST).
 * For multi-region SaaS, move this to per-tenant config.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

export function computeExpiresAt(eventDateISO: string, cutoffHour = 2): number {
  const [y, m, d] = eventDateISO.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid EVENT_DATE: ${eventDateISO}`);
  // Build as if UTC at next day + cutoffHour, then shift by IST offset.
  const asIfUtc = Date.UTC(y, m - 1, d + 1, cutoffHour, 0, 0);
  return asIfUtc - IST_OFFSET_MS;
}

/**
 * Smart default for EVENT_DATE when the admin hasn't set one.
 * If it's currently before the cutoff hour in IST, use *yesterday* — we're still
 * inside last night's event window. Otherwise use today.
 */
export function defaultEventDate(cutoffHour = 2, now: Date = new Date()): string {
  const ist = istParts(now);
  if (ist.hour < cutoffHour) {
    // rewind one calendar day in IST
    const yesterdayIstMs = Date.UTC(ist.year, ist.month - 1, ist.day, 12, 0, 0) - 24 * 3600 * 1000;
    const y = istParts(new Date(yesterdayIstMs));
    return `${y.year}-${pad(y.month)}-${pad(y.day)}`;
  }
  return `${ist.year}-${pad(ist.month)}-${pad(ist.day)}`;
}

export function formatExpiry(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

export function expiryCountdown(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'no expiry';
  const diff = ts - now;
  if (diff <= 0) return 'expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) {
    const days = Math.floor(h / 24);
    return `${days}d ${h % 24}h left`;
  }
  if (h >= 1) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

export function isExpired(expiresAt: number | null | undefined, now = Date.now()): boolean {
  return !!(expiresAt && expiresAt <= now);
}

function istParts(d: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
