/**
 * Event Insights — per-event analytics aggregation + tracking writes.
 *
 * Data source: event_analytics_events (append-only log of funnel events
 * emitted from both client and server) joined with payments + wallets for
 * revenue / abandoned-cart counts.
 *
 * Privacy: never store raw IPs — only a SHA-256 hash keyed with a daily
 * salt derived from INTERNAL_TOKEN_SECRET + UTC date. Salt rotates lazily
 * on first read after midnight UTC; the previous day's salt is kept in
 * ANALYTICS_IP_SALT_PREV for short rolling-window joins.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getDb, getConfig, setConfig } from './db';
import { listAbandonedBookings } from './abandoned-bookings';

export type AnalyticsKind =
  | 'page_view'
  | 'book_click'
  | 'ticket_selected'
  | 'checkout_started'
  | 'payment_initiated'
  | 'checkout_success'
  | 'checkout_failed'
  | 'page_scroll_depth';

const VALID_KINDS: AnalyticsKind[] = [
  'page_view',
  'book_click',
  'ticket_selected',
  'checkout_started',
  'payment_initiated',
  'checkout_success',
  'checkout_failed',
  'page_scroll_depth',
];

export function isAnalyticsKind(v: unknown): v is AnalyticsKind {
  return typeof v === 'string' && (VALID_KINDS as string[]).includes(v);
}

// ─── In-memory rate limit (token bucket per session+kind+minute) ──────────
// Prevents a malicious or buggy client from pumping rows. Resets on process
// boot — that's intentional; SQLite rows are the source of truth.
const SESSION_RATE_LIMIT = 60; // events per session per minute (per kind)
const sessionBuckets = new Map<string, { count: number; resetAt: number }>();

function shouldRateLimit(sessionId: string, kind: AnalyticsKind): boolean {
  const key = `${sessionId}:${kind}`;
  const now = Date.now();
  const bucket = sessionBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    sessionBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  if (bucket.count > SESSION_RATE_LIMIT) return true;
  return false;
}

// Periodic prune so the Map can't grow without bound on long-lived processes.
function pruneBuckets() {
  const now = Date.now();
  if (sessionBuckets.size < 1000) return;
  for (const [key, bucket] of sessionBuckets) {
    if (bucket.resetAt <= now) sessionBuckets.delete(key);
  }
}

// ─── Daily IP salt rotation ───────────────────────────────────────────────
function utcDayString(ms = Date.now()): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDailySalt(): string {
  const today = utcDayString();
  const updatedAt = Number(getConfig('ANALYTICS_IP_SALT_UPDATED_AT', '0')) || 0;
  const lastDay = updatedAt ? utcDayString(updatedAt) : '';
  let salt = getConfig('ANALYTICS_IP_SALT_DAILY', '').trim();
  if (!salt || lastDay !== today) {
    salt = randomBytes(24).toString('base64url');
    setConfig('ANALYTICS_IP_SALT_DAILY', salt);
    setConfig('ANALYTICS_IP_SALT_UPDATED_AT', String(Date.now()));
  }
  return salt;
}

/** SHA-256(ip + ':' + salt) — irreversible, daily-rotating. */
export function hashIp(ip: string): string {
  if (!ip) return '';
  const salt = getDailySalt();
  // Mix in INTERNAL_TOKEN_SECRET so the salt is unguessable even if an
  // attacker pulled the daily salt from a logged config dump.
  const pepper = getConfig('INTERNAL_TOKEN_SECRET', '');
  return createHash('sha256').update(`${ip}:${salt}:${pepper}`).digest('hex');
}

// ─── Public: trackEvent (single-row insert with validation) ──────────────
export interface TrackEventInput {
  eventId: string;
  sessionId: string;
  kind: AnalyticsKind;
  metadata?: Record<string, unknown>;
  ip?: string;
  ua?: string;
}

/**
 * Persist one funnel-event row. Silently no-ops on invalid input or rate
 * limit — analytics is best-effort, never block the caller. The `eventId`
 * is validated against the events table to prevent landfill writes from
 * stale or malicious payloads.
 */
export function trackEvent(input: TrackEventInput): { ok: boolean; reason?: string } {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'invalid' };
  if (!isAnalyticsKind(input.kind)) return { ok: false, reason: 'bad_kind' };
  if (typeof input.eventId !== 'string' || input.eventId.length < 3) return { ok: false, reason: 'bad_event_id' };
  if (typeof input.sessionId !== 'string' || input.sessionId.length < 8 || input.sessionId.length > 64) {
    return { ok: false, reason: 'bad_session' };
  }

  if (shouldRateLimit(input.sessionId, input.kind)) return { ok: false, reason: 'rate_limited' };
  pruneBuckets();

  const db = getDb();
  // Validate event_id exists — cheap PK lookup keeps the analytics table
  // from accumulating orphan rows for events that were deleted.
  const evRow = db.prepare('SELECT id FROM events WHERE id = ?').get(input.eventId) as { id: string } | undefined;
  if (!evRow) return { ok: false, reason: 'unknown_event' };

  const ipHash = input.ip ? hashIp(input.ip) : null;
  const ua = input.ua ? String(input.ua).slice(0, 500) : null;
  const metaJson = input.metadata ? safeStringify(input.metadata) : null;

  try {
    db.prepare(`
      INSERT INTO event_analytics_events
        (id, event_id, session_id, kind, metadata_json, ip_hash, user_agent, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), input.eventId, input.sessionId, input.kind, metaJson, ipHash, ua, Date.now());
    return { ok: true };
  } catch {
    return { ok: false, reason: 'insert_failed' };
  }
}

function safeStringify(obj: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > 4000 ? s.slice(0, 4000) : s;
  } catch {
    return '{}';
  }
}

// ─── KPI / Funnel / Series aggregation ────────────────────────────────────

export interface EventKpis {
  pageViews: number;
  bookClicks: number;
  ticketSelected: number;
  checkoutStarted: number;
  /** New in v2: Razorpay checkout modal actually opened. */
  paymentInitiated: number;
  checkoutSuccess: number;
  checkoutFailed: number;
  /** checkoutSuccess / pageViews × 100 (2 decimals). 0 when pageViews=0. */
  conversionRate: number;
  /** sum of payments.amount captured for this event in the window. */
  revenue: number;
  /** Currently-pending payment_created rows for this event (not time-bounded). */
  activeCarts: number;
  /** Same as activeCarts but worth surfacing for the KPI subtitle copy. */
  activePending: number;
  /** payment_created rows older than 24h — likely lost. */
  expired: number;
  /** ₹ value of expired carts. */
  expiredLost: number;
}

export function getEventKpis(eventId: string, fromMs: number, toMs: number): EventKpis {
  const db = getDb();
  const counts = db.prepare(`
    SELECT kind, COUNT(*) AS c
    FROM event_analytics_events
    WHERE event_id = ? AND timestamp >= ? AND timestamp < ?
    GROUP BY kind
  `).all(eventId, fromMs, toMs) as Array<{ kind: AnalyticsKind; c: number }>;

  const get = (k: AnalyticsKind) => counts.find((r) => r.kind === k)?.c ?? 0;
  const pageViews = get('page_view');
  const bookClicks = get('book_click');
  const ticketSelected = get('ticket_selected');
  const checkoutStarted = get('checkout_started');
  const paymentInitiated = get('payment_initiated');
  const checkoutSuccess = get('checkout_success');
  const checkoutFailed = get('checkout_failed');

  const conversionRate = pageViews > 0
    ? Math.round((checkoutSuccess / pageViews) * 10000) / 100
    : 0;

  const revenueRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS r
    FROM payments
    WHERE event_id = ? AND status = 'captured'
      AND verified_at >= ? AND verified_at < ?
  `).get(eventId, fromMs, toMs) as { r: number };

  const active = getActiveCarts(eventId);
  const expiredObj = getExpiredCarts(eventId);

  return {
    pageViews,
    bookClicks,
    ticketSelected,
    checkoutStarted,
    paymentInitiated,
    checkoutSuccess,
    checkoutFailed,
    conversionRate,
    revenue: Number(revenueRow.r) || 0,
    activeCarts: active.count,
    activePending: active.count,
    expired: expiredObj.count,
    expiredLost: expiredObj.amount,
  };
}

/** payment_created rows for this event — currently stuck checkouts. */
export function getActiveCarts(eventId: string): { count: number; amount: number } {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s
    FROM payments
    WHERE event_id = ? AND status = 'created'
  `).get(eventId) as { c: number; s: number };
  return { count: row.c, amount: Number(row.s) || 0 };
}

/** payment_created older than 24h — considered lost. */
export function getExpiredCarts(eventId: string): { count: number; amount: number } {
  const db = getDb();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const row = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s
    FROM payments
    WHERE event_id = ? AND status = 'created' AND created_at < ?
  `).get(eventId, cutoff) as { c: number; s: number };
  return { count: row.c, amount: Number(row.s) || 0 };
}

export interface FunnelStage {
  stage:
    | 'page_view'
    | 'book_click'
    | 'ticket_selected'
    | 'checkout_started'
    | 'payment_initiated'
    | 'checkout_success';
  label: string;
  count: number;
  /** Drop-off % from the previous stage. 0 for the first stage. */
  dropOffPct: number;
}

/**
 * Funnel counts are taken from the same row counts as the KPIs. Drop-off
 * math uses MAX(0, prev - curr) so quirks like client-side debouncing on
 * ticket_selected can't show negative drop-off.
 *
 * Insights v2 inserts a "Payment Initiated" stage between Checkout Started
 * and Successful — it fires when the Razorpay modal opens, so the gap
 * between Checkout Started → Payment Initiated reflects order-creation
 * failures and the gap between Payment Initiated → Successful reflects
 * customers who saw the modal but never completed payment.
 */
export function getEventFunnel(eventId: string, fromMs: number, toMs: number): FunnelStage[] {
  const k = getEventKpis(eventId, fromMs, toMs);
  const stages: Array<{ stage: FunnelStage['stage']; label: string; count: number }> = [
    { stage: 'page_view',         label: 'Page Viewed',       count: k.pageViews },
    { stage: 'book_click',        label: 'Book Clicked',      count: k.bookClicks },
    { stage: 'ticket_selected',   label: 'Ticket Selected',   count: k.ticketSelected },
    { stage: 'checkout_started',  label: 'Checkout Started',  count: k.checkoutStarted },
    { stage: 'payment_initiated', label: 'Payment Initiated', count: k.paymentInitiated },
    { stage: 'checkout_success',  label: 'Successful',        count: k.checkoutSuccess },
  ];

  const out: FunnelStage[] = [];
  let prev = 0;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    let drop = 0;
    if (i === 0) {
      drop = 0;
    } else if (prev <= 0) {
      drop = 0;
    } else {
      const lost = Math.max(0, prev - s.count);
      drop = Math.round((lost / prev) * 10000) / 100;
    }
    out.push({ stage: s.stage, label: s.label, count: s.count, dropOffPct: drop });
    prev = s.count;
  }
  return out;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  pageViews: number;
  success: number;
}

/**
 * Daily series in the [fromMs, toMs) window — page_view and checkout_success
 * counts per UTC day. Days with zero activity are still emitted so the
 * chart x-axis renders a continuous line.
 */
export function getEventDailySeries(eventId: string, fromMs: number, toMs: number): DailyPoint[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') AS d, kind, COUNT(*) AS c
    FROM event_analytics_events
    WHERE event_id = ? AND timestamp >= ? AND timestamp < ?
      AND kind IN ('page_view', 'checkout_success')
    GROUP BY d, kind
    ORDER BY d ASC
  `).all(eventId, fromMs, toMs) as Array<{ d: string; kind: AnalyticsKind; c: number }>;

  const byDay = new Map<string, { pageViews: number; success: number }>();
  for (const r of rows) {
    if (!byDay.has(r.d)) byDay.set(r.d, { pageViews: 0, success: 0 });
    const slot = byDay.get(r.d)!;
    if (r.kind === 'page_view') slot.pageViews = r.c;
    if (r.kind === 'checkout_success') slot.success = r.c;
  }

  // Backfill every day in the window so the chart x-axis is continuous.
  const out: DailyPoint[] = [];
  const startDay = new Date(fromMs);
  startDay.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(toMs);
  for (let t = startDay.getTime(); t < endDay.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = utcDayString(t);
    const slot = byDay.get(d) || { pageViews: 0, success: 0 };
    out.push({ date: d, pageViews: slot.pageViews, success: slot.success });
  }
  return out;
}

/**
 * Event-scoped abandoned-cart list. Delegates to abandoned-bookings.ts
 * after a SQL-level event_id filter is impossible (the helper is a JS
 * union); we filter the result in JS instead. Keeps a single source of
 * truth for "what counts as abandoned".
 */
export function listEventAbandonedCarts(
  eventId: string,
  opts: { stage?: 'all' | 'payment_created' | 'payment_failed' | 'reservation_only'; minAgeMinutes?: number; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 200, 500);
  const all = listAbandonedBookings({
    stage: opts.stage ?? 'all',
    minAgeMinutes: opts.minAgeMinutes ?? 60,
    limit: 500, // pull wide, filter, then slice
  });
  return all.filter((b) => b.eventId === eventId).slice(0, limit);
}

// ─── Insights v2: Traffic Sources / Ticket Popularity / Scroll Depth ──────

export interface TrafficSourceRow {
  /** Display label — UTM source if present, else referrer host, else 'Direct'. */
  source: string;
  count: number;
}

/**
 * Aggregates page_view events by their captured referrerHost / UTM source.
 * Priority order per row: metadata.utmSource → metadata.referrerHost → 'Direct'.
 * Bucketing in JS (not SQL) because metadata is a JSON blob; the page_view
 * volume per event is bounded by the index on (event_id, kind, timestamp).
 * Returns top 10 sorted desc by count.
 */
export function getEventTrafficSources(
  eventId: string,
  fromMs: number,
  toMs: number,
): TrafficSourceRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT metadata_json
    FROM event_analytics_events
    WHERE event_id = ? AND kind = 'page_view'
      AND timestamp >= ? AND timestamp < ?
  `).all(eventId, fromMs, toMs) as Array<{ metadata_json: string | null }>;

  const tally = new Map<string, number>();
  for (const r of rows) {
    let source = 'Direct';
    if (r.metadata_json) {
      try {
        const m = JSON.parse(r.metadata_json) as Record<string, unknown>;
        const utm = typeof m.utmSource === 'string' ? m.utmSource.trim() : '';
        const host = typeof m.referrerHost === 'string' ? m.referrerHost.trim() : '';
        if (utm) source = utm;
        else if (host) source = host;
      } catch { /* malformed metadata — bucket as Direct */ }
    }
    tally.set(source, (tally.get(source) || 0) + 1);
  }

  return Array.from(tally.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export interface TicketPopularityRow {
  label: string;
  count: number;
}

/**
 * Aggregates ticket_selected events by metadata.ticketType (or zoneName for
 * seating events). Rows without either are bucketed as "Unspecified" so the
 * total reconciles with the funnel's Ticket Selected count.
 */
export function getEventTicketPopularity(
  eventId: string,
  fromMs: number,
  toMs: number,
): TicketPopularityRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT metadata_json
    FROM event_analytics_events
    WHERE event_id = ? AND kind = 'ticket_selected'
      AND timestamp >= ? AND timestamp < ?
  `).all(eventId, fromMs, toMs) as Array<{ metadata_json: string | null }>;

  const tally = new Map<string, number>();
  for (const r of rows) {
    let label = 'Unspecified';
    if (r.metadata_json) {
      try {
        const m = JSON.parse(r.metadata_json) as Record<string, unknown>;
        const tt = typeof m.ticketType === 'string' ? m.ticketType.trim() : '';
        const zn = typeof m.zoneName === 'string' ? m.zoneName.trim() : '';
        if (tt) label = tt;
        else if (zn) label = zn;
      } catch { /* malformed — bucket as Unspecified */ }
    }
    tally.set(label, (tally.get(label) || 0) + 1);
  }

  return Array.from(tally.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export interface ScrollDepthCounts {
  25: number;
  50: number;
  75: number;
  100: number;
}

/**
 * Unique sessions that reached each depth threshold. We dedupe by session_id
 * at the SQL layer — the client guarantees at-most-once per (session,
 * threshold) but a defensive DISTINCT here keeps the count honest if a
 * misbehaving client re-fires.
 */
export function getEventScrollDepth(
  eventId: string,
  fromMs: number,
  toMs: number,
): ScrollDepthCounts {
  const db = getDb();
  const rows = db.prepare(`
    SELECT session_id, metadata_json
    FROM event_analytics_events
    WHERE event_id = ? AND kind = 'page_scroll_depth'
      AND timestamp >= ? AND timestamp < ?
  `).all(eventId, fromMs, toMs) as Array<{ session_id: string; metadata_json: string | null }>;

  const seen: Record<25 | 50 | 75 | 100, Set<string>> = {
    25: new Set(),
    50: new Set(),
    75: new Set(),
    100: new Set(),
  };

  for (const r of rows) {
    if (!r.metadata_json) continue;
    let depth: number | undefined;
    try {
      const m = JSON.parse(r.metadata_json) as Record<string, unknown>;
      const d = m.depthPct;
      if (typeof d === 'number') depth = d;
      else if (typeof d === 'string') depth = Number(d);
    } catch { /* malformed — skip */ }
    if (depth === 25 || depth === 50 || depth === 75 || depth === 100) {
      seen[depth].add(r.session_id);
    }
  }

  return {
    25: seen[25].size,
    50: seen[50].size,
    75: seen[75].size,
    100: seen[100].size,
  };
}
