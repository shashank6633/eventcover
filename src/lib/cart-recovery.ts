/**
 * Cart Recovery — per-event WhatsApp follow-up for abandoned checkouts.
 *
 * Two data sources flow into the candidate set (same as abandoned-bookings):
 *   • payments rows with status='created' (Razorpay order minted, customer
 *     never completed) — the high-intent target. We have a phone, amount,
 *     and a reservation id we can deep-link back to.
 *   • reservations with status='pending' AND no payment row — the low-intent
 *     "form started but never reached checkout" target. We have a phone +
 *     event_id.
 *
 * Sweep rules:
 *   • Only events with event_cart_recovery_config.enabled=1
 *   • Only candidates older than config.delay_minutes
 *   • Only candidates with a phone
 *   • Only candidates not already in event_cart_recovery_attempts (UNIQUE
 *     index on (source, source_id) gates retries — we don't double-spam)
 *   • Cap CART_RECOVERY_MAX_PER_SWEEP per call (default 25) to respect
 *     Interakt's 40 req/min limit (sendInteraktTemplate sleeps 1500ms anyway)
 *
 * Recovery attribution: when a payment captures (/api/payments/verify), we
 * stamp recovered_at on the matching attempt row so the recovery rate KPI
 * is accurate.
 */
import { randomUUID } from 'crypto';
import { getDb, getConfig } from './db';
import { sendInteraktTemplate, splitPhone, isInteraktConfigured } from './providers/whatsapp/interakt';
import { logAudit } from './audit';

const ALLOWED_DELAYS = [30, 60, 120, 240] as const;
type AllowedDelay = (typeof ALLOWED_DELAYS)[number];

export interface CartRecoveryConfig {
  eventId: string;
  enabled: boolean;
  delayMinutes: AllowedDelay;
  templateName: string;
  templateLang: string;
  lastSweptAt: number;
  createdAt: number;
  updatedAt: number;
}

interface CartRecoveryConfigRow {
  event_id: string;
  enabled: number;
  delay_minutes: number;
  template_name: string;
  template_lang: string;
  last_swept_at: number;
  created_at: number;
  updated_at: number;
}

function rowToConfig(r: CartRecoveryConfigRow): CartRecoveryConfig {
  const dm = (ALLOWED_DELAYS as readonly number[]).includes(r.delay_minutes)
    ? (r.delay_minutes as AllowedDelay)
    : 60;
  return {
    eventId: r.event_id,
    enabled: !!r.enabled,
    delayMinutes: dm,
    templateName: r.template_name,
    templateLang: r.template_lang,
    lastSweptAt: r.last_swept_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getCartRecoveryConfig(eventId: string): CartRecoveryConfig {
  const db = getDb();
  const row = db.prepare(`
    SELECT event_id, enabled, delay_minutes, template_name, template_lang,
           last_swept_at, created_at, updated_at
    FROM event_cart_recovery_config
    WHERE event_id = ?
  `).get(eventId) as CartRecoveryConfigRow | undefined;

  if (row) return rowToConfig(row);

  // Synthesize a default-disabled config so the UI can render the toggle
  // without first requiring an upsert. Persistence happens on first PUT.
  const defaultTemplate = getConfig('CART_RECOVERY_DEFAULT_TEMPLATE', 'akan_cart_recovery');
  return {
    eventId,
    enabled: false,
    delayMinutes: 60,
    templateName: defaultTemplate || 'akan_cart_recovery',
    templateLang: 'en',
    lastSweptAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

export interface CartRecoveryPatch {
  enabled?: boolean;
  delayMinutes?: number;
  templateName?: string;
  templateLang?: string;
}

export function upsertCartRecoveryConfig(eventId: string, patch: CartRecoveryPatch): CartRecoveryConfig {
  const db = getDb();
  const now = Date.now();
  const existing = db.prepare(`
    SELECT event_id, enabled, delay_minutes, template_name, template_lang,
           last_swept_at, created_at, updated_at
    FROM event_cart_recovery_config WHERE event_id = ?
  `).get(eventId) as CartRecoveryConfigRow | undefined;

  // Normalise + clamp inputs.
  const delay = (() => {
    if (patch.delayMinutes === undefined) return existing?.delay_minutes ?? 60;
    return (ALLOWED_DELAYS as readonly number[]).includes(patch.delayMinutes) ? patch.delayMinutes : 60;
  })();
  const enabled = patch.enabled === undefined
    ? (existing?.enabled ?? 0)
    : (patch.enabled ? 1 : 0);
  const templateName = (patch.templateName ?? existing?.template_name ?? 'akan_cart_recovery').trim().slice(0, 80) || 'akan_cart_recovery';
  const templateLang = (patch.templateLang ?? existing?.template_lang ?? 'en').trim().slice(0, 12) || 'en';

  if (existing) {
    db.prepare(`
      UPDATE event_cart_recovery_config
      SET enabled = ?, delay_minutes = ?, template_name = ?, template_lang = ?, updated_at = ?
      WHERE event_id = ?
    `).run(enabled, delay, templateName, templateLang, now, eventId);
  } else {
    db.prepare(`
      INSERT INTO event_cart_recovery_config
        (event_id, enabled, delay_minutes, template_name, template_lang, last_swept_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(eventId, enabled, delay, templateName, templateLang, now, now);
  }

  return getCartRecoveryConfig(eventId);
}

function touchSweptAt(eventId: string) {
  const db = getDb();
  db.prepare(`
    UPDATE event_cart_recovery_config
    SET last_swept_at = ?, updated_at = ?
    WHERE event_id = ?
  `).run(Date.now(), Date.now(), eventId);
}

interface CandidateRow {
  source: 'payment' | 'reservation';
  source_id: string;
  phone: string | null;
  name: string | null;
  amount: number;
  abandonedAt: number;
}

/**
 * Pull abandoned payments + reservations for this event that:
 *   • are older than config.delay_minutes
 *   • have a phone
 *   • don't already have an event_cart_recovery_attempts row
 *
 * Per-source LIMIT keeps each sweep bounded; the caller further slices to
 * CART_RECOVERY_MAX_PER_SWEEP.
 */
function findCandidates(eventId: string, delayMinutes: number, max: number): CandidateRow[] {
  const db = getDb();
  const cutoff = Date.now() - delayMinutes * 60 * 1000;

  const payments = db.prepare(`
    SELECT p.id, p.payer_phone, p.payer_name, p.amount, p.created_at, p.updated_at
    FROM payments p
    LEFT JOIN event_cart_recovery_attempts a
      ON a.source = 'payment' AND a.source_id = p.id
    WHERE p.event_id = ?
      AND p.status = 'created'
      AND p.created_at < ?
      AND p.payer_phone IS NOT NULL AND TRIM(p.payer_phone) != ''
      AND a.id IS NULL
      AND (p.notes IS NULL OR p.notes NOT LIKE '%"kind":"wallet_topup"%')
    ORDER BY p.created_at DESC
    LIMIT ?
  `).all(eventId, cutoff, max) as Array<{
    id: string; payer_phone: string | null; payer_name: string | null;
    amount: number; created_at: number; updated_at: number | null;
  }>;

  const reservations = db.prepare(`
    SELECT r.id, r.phone, r.name, r.synced_at
    FROM reservations r
    LEFT JOIN event_cart_recovery_attempts a
      ON a.source = 'reservation' AND a.source_id = r.id
    WHERE r.event_id = ?
      AND r.status = 'pending'
      AND r.synced_at < ?
      AND r.phone IS NOT NULL AND TRIM(r.phone) != ''
      AND a.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM payments p2
        WHERE p2.reservation_id = r.id
          AND p2.status IN ('created', 'failed', 'captured')
      )
    ORDER BY r.synced_at DESC
    LIMIT ?
  `).all(eventId, cutoff, max) as Array<{ id: string; phone: string; name: string; synced_at: number }>;

  const out: CandidateRow[] = [];
  for (const p of payments) {
    out.push({
      source: 'payment',
      source_id: p.id,
      phone: p.payer_phone,
      name: p.payer_name,
      amount: Number(p.amount) || 0,
      abandonedAt: p.updated_at ?? p.created_at,
    });
  }
  for (const r of reservations) {
    out.push({
      source: 'reservation',
      source_id: r.id,
      phone: r.phone,
      name: r.name,
      amount: 0,
      abandonedAt: r.synced_at,
    });
  }
  // Newest first, then slice to max.
  out.sort((a, b) => b.abandonedAt - a.abandonedAt);
  return out.slice(0, max);
}

export interface SweepResult {
  ok: boolean;
  attempts: number;
  sent: number;
  skipped: number;
  errors: number;
  reason?: string;
}

/**
 * Build a deep-link back into the public event page. We don't HMAC-sign
 * here because the resume URL just lands on /event/[slug] — no privileged
 * action is taken; the customer still has to re-enter the booking form.
 * Future: short-token resume that prefills the form.
 */
function buildResumeUrl(eventSlug: string | null, eventId: string): string {
  const origin = (getConfig('PUBLIC_ORIGIN', '').trim() || 'https://wallet.akanhyd.com').replace(/\/+$/, '');
  const slug = eventSlug && eventSlug.trim() ? eventSlug : eventId;
  return `${origin}/event/${slug}`;
}

/**
 * Sweep one event. Safe to call from a GET handler — returns quickly on
 * the no-candidates path and never throws (Interakt failures are
 * recorded into the attempts row's `error` column).
 *
 * Returns {ok, attempts, sent, skipped, errors}.
 */
export async function sweepCartRecovery(
  eventId: string,
  opts: { force?: boolean; max?: number } = {},
): Promise<SweepResult> {
  const db = getDb();
  const config = getCartRecoveryConfig(eventId);

  if (!config.enabled && !opts.force) {
    return { ok: false, attempts: 0, sent: 0, skipped: 0, errors: 0, reason: 'disabled' };
  }

  if (!isInteraktConfigured()) {
    return { ok: false, attempts: 0, sent: 0, skipped: 0, errors: 0, reason: 'interakt_not_configured' };
  }

  // Pull the event name + slug for the template body variables.
  const ev = db.prepare(`SELECT id, name, slug FROM events WHERE id = ?`).get(eventId) as
    | { id: string; name: string; slug: string | null }
    | undefined;
  if (!ev) {
    return { ok: false, attempts: 0, sent: 0, skipped: 0, errors: 0, reason: 'unknown_event' };
  }

  const maxConfigured = Number(getConfig('CART_RECOVERY_MAX_PER_SWEEP', '25')) || 25;
  const max = Math.max(1, Math.min(opts.max ?? maxConfigured, 100));

  const candidates = findCandidates(eventId, config.delayMinutes, max);
  if (candidates.length === 0) {
    touchSweptAt(eventId);
    return { ok: true, attempts: 0, sent: 0, skipped: 0, errors: 0 };
  }

  const resumeUrl = buildResumeUrl(ev.slug, ev.id);
  let sent = 0;
  let errors = 0;
  let skipped = 0;

  for (const c of candidates) {
    const phone = (c.phone || '').trim();
    if (!phone) { skipped += 1; continue; }

    const { countryCode, phoneNumber } = splitPhone(phone);
    const name = (c.name || 'Guest').trim();
    const attemptId = randomUUID();
    const now = Date.now();

    // Insert the attempt row UP FRONT so a concurrent sweep can't double-fire
    // the same source. UNIQUE(source, source_id) guarantees we get a single
    // winner on race. If the insert fails, another sweep already claimed it.
    try {
      db.prepare(`
        INSERT INTO event_cart_recovery_attempts
          (id, event_id, source, source_id, phone, customer_name, template_name, sent_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(attemptId, eventId, c.source, c.source_id, phone, name, config.templateName, now, now);
    } catch {
      skipped += 1;
      continue;
    }

    // Re-check status inside this tick to avoid sending a recovery message
    // to a customer who just captured between candidate select and now.
    if (c.source === 'payment') {
      const fresh = db.prepare(`SELECT status FROM payments WHERE id = ?`).get(c.source_id) as { status: string } | undefined;
      if (!fresh || fresh.status !== 'created') {
        db.prepare(`UPDATE event_cart_recovery_attempts SET error = ?, sent_at = ? WHERE id = ?`)
          .run('skipped_status_changed', Date.now(), attemptId);
        skipped += 1;
        continue;
      }
    } else if (c.source === 'reservation') {
      const fresh = db.prepare(`SELECT status FROM reservations WHERE id = ?`).get(c.source_id) as { status: string } | undefined;
      if (!fresh || fresh.status !== 'pending') {
        db.prepare(`UPDATE event_cart_recovery_attempts SET error = ?, sent_at = ? WHERE id = ?`)
          .run('skipped_status_changed', Date.now(), attemptId);
        skipped += 1;
        continue;
      }
    }

    try {
      const result = await sendInteraktTemplate({
        countryCode,
        phoneNumber,
        templateName: config.templateName,
        languageCode: config.templateLang,
        bodyValues: [name, ev.name, resumeUrl],
        callbackData: `cart_recovery:${attemptId}`,
      });

      if (result.ok) {
        db.prepare(`
          UPDATE event_cart_recovery_attempts
          SET interakt_message_id = ?, sent_at = ?
          WHERE id = ?
        `).run(result.messageId || null, Date.now(), attemptId);
        sent += 1;
      } else {
        db.prepare(`
          UPDATE event_cart_recovery_attempts
          SET error = ?, sent_at = ?
          WHERE id = ?
        `).run((result.error || 'send_failed').slice(0, 500), Date.now(), attemptId);
        errors += 1;
      }
    } catch (err) {
      // Defensive — sendInteraktTemplate is already non-throwing, but a
      // bad config / network panic could surface. Never let the sweep die.
      const msg = err instanceof Error ? err.message : 'unknown';
      db.prepare(`
        UPDATE event_cart_recovery_attempts
        SET error = ?, sent_at = ?
        WHERE id = ?
      `).run(msg.slice(0, 500), Date.now(), attemptId);
      errors += 1;
    }
  }

  touchSweptAt(eventId);
  logAudit({
    actor: 'system',
    action: 'cart_recovery_sweep',
    entityType: 'event',
    entityId: eventId,
    details: { attempts: candidates.length, sent, skipped, errors },
  });

  return { ok: true, attempts: candidates.length, sent, skipped, errors };
}

export interface RecoveryAttempt {
  id: string;
  eventId: string;
  source: 'payment' | 'reservation';
  sourceId: string;
  phone: string | null;
  customerName: string | null;
  templateName: string;
  interaktMessageId: string | null;
  sentAt: number;
  recoveredAt: number | null;
  recoveredPaymentId: string | null;
  error: string | null;
}

interface RecoveryAttemptRow {
  id: string;
  event_id: string;
  source: 'payment' | 'reservation';
  source_id: string;
  phone: string | null;
  customer_name: string | null;
  template_name: string;
  interakt_message_id: string | null;
  sent_at: number;
  recovered_at: number | null;
  recovered_payment_id: string | null;
  error: string | null;
}

function rowToAttempt(r: RecoveryAttemptRow): RecoveryAttempt {
  return {
    id: r.id,
    eventId: r.event_id,
    source: r.source,
    sourceId: r.source_id,
    phone: r.phone,
    customerName: r.customer_name,
    templateName: r.template_name,
    interaktMessageId: r.interakt_message_id,
    sentAt: r.sent_at,
    recoveredAt: r.recovered_at,
    recoveredPaymentId: r.recovered_payment_id,
    error: r.error,
  };
}

export function listRecoveryAttempts(eventId: string, limit = 20): RecoveryAttempt[] {
  const db = getDb();
  const cap = Math.min(Math.max(1, limit), 200);
  const rows = db.prepare(`
    SELECT id, event_id, source, source_id, phone, customer_name, template_name,
           interakt_message_id, sent_at, recovered_at, recovered_payment_id, error
    FROM event_cart_recovery_attempts
    WHERE event_id = ?
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(eventId, cap) as RecoveryAttemptRow[];
  return rows.map(rowToAttempt);
}

export interface RecoveryRate {
  sent: number;
  recovered: number;
  /** recovered / sent × 100, 2 decimals. 0 when sent=0. */
  rate: number;
}

/**
 * Recovery rate = (attempts recovered within `windowHours`) / attempts sent.
 * windowHours defaults to 48h — long enough to cover Sunday-night events
 * with Saturday-afternoon abandons but tight enough to reject "accidentally
 * happened to pay 2 months later" from inflating the rate.
 */
export function getRecoveryRate(eventId: string, windowHours = 48): RecoveryRate {
  const db = getDb();
  const windowMs = windowHours * 60 * 60 * 1000;
  const row = db.prepare(`
    SELECT
      COUNT(*) AS sent,
      SUM(CASE
            WHEN recovered_at IS NOT NULL
             AND recovered_at - sent_at <= ?
            THEN 1 ELSE 0 END) AS recovered
    FROM event_cart_recovery_attempts
    WHERE event_id = ? AND (error IS NULL OR error = '')
  `).get(windowMs, eventId) as { sent: number; recovered: number };

  const sent = Number(row.sent) || 0;
  const recovered = Number(row.recovered) || 0;
  const rate = sent > 0 ? Math.round((recovered / sent) * 10000) / 100 : 0;
  return { sent, recovered, rate };
}

/**
 * Mark a recovery attempt as recovered. Called from /api/payments/verify
 * after a captured payment is confirmed. We match by (source='payment',
 * source_id=paymentId) AND ALSO by reservation_id where the original
 * abandoned row was a reservation_only stage.
 *
 * Idempotent: if there's no matching attempt, no-op. If already marked,
 * no-op.
 */
export function markRecovered(
  paymentId: string,
  reservationId: string | null,
): { ok: boolean; marked: number } {
  const db = getDb();
  const now = Date.now();
  let marked = 0;

  // 1) Payment-sourced attempt — direct match.
  const pRes = db.prepare(`
    UPDATE event_cart_recovery_attempts
    SET recovered_at = ?, recovered_payment_id = ?
    WHERE source = 'payment' AND source_id = ? AND recovered_at IS NULL
  `).run(now, paymentId, paymentId);
  marked += pRes.changes;

  // 2) Reservation-sourced attempt — match by reservation_id when present.
  if (reservationId) {
    const rRes = db.prepare(`
      UPDATE event_cart_recovery_attempts
      SET recovered_at = ?, recovered_payment_id = ?
      WHERE source = 'reservation' AND source_id = ? AND recovered_at IS NULL
    `).run(now, paymentId, reservationId);
    marked += rRes.changes;
  }

  return { ok: true, marked };
}

/**
 * "Is it time to auto-sweep this event?" — gates the side-effect on
 * /api/events/[id]/insights GET. Compares last_swept_at against
 * CART_RECOVERY_SWEEP_INTERVAL_SECONDS.
 */
export function shouldAutoSweep(eventId: string): boolean {
  const cfg = getCartRecoveryConfig(eventId);
  if (!cfg.enabled) return false;
  const interval = Number(getConfig('CART_RECOVERY_SWEEP_INTERVAL_SECONDS', '300')) || 300;
  return (Date.now() - cfg.lastSweptAt) >= interval * 1000;
}

// ─── Insights v2: Cart Recovery dashboard KPIs + activity ─────────────────

export interface RecoveryKpis {
  /** Total abandoned cart attempts (payment_created + reservation_only). */
  totalCarts: number;
  /** Attempts still in_progress — message either pending or sent but not yet recovered/failed. */
  inProgress: number;
  /** Attempts where recovered_at IS NOT NULL. */
  recovered: number;
  /** recovered / max(1, attemptsWithOutcome) × 100, 2 decimals. */
  recoveryRatePct: number;
  /** Sum of payments.amount for the recovered_payment_id rows. */
  revenueRecovered: number;
  /** Attempts where sent_at IS NOT NULL AND (error IS NULL OR error = ''). */
  messagesSent: number;
  /** Subset of messagesSent that interakt reports as opened/read. We don't
   *  currently persist read receipts, so this returns 0 until that lands —
   *  exposed in the shape so the UI doesn't conditionally render. */
  messagesOpened: number;
}

export function getRecoveryKpis(eventId: string): RecoveryKpis {
  const db = getDb();

  // Total carts + outcome buckets. We include attempts with errors in
  // totalCarts (they're still attempted carts) but recovery rate is gauged
  // only against attempts with a terminal outcome (recovered OR failed) so
  // an event that's mostly in-progress doesn't read as 0% recovery.
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN recovered_at IS NOT NULL THEN 1 ELSE 0 END) AS recovered,
      SUM(CASE WHEN (error IS NOT NULL AND error != '') AND recovered_at IS NULL THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN sent_at IS NOT NULL AND (error IS NULL OR error = '') THEN 1 ELSE 0 END) AS sent
    FROM event_cart_recovery_attempts
    WHERE event_id = ?
  `).get(eventId) as { total: number; recovered: number; failed: number; sent: number };

  const totalCarts = Number(row.total) || 0;
  const recovered = Number(row.recovered) || 0;
  const failed = Number(row.failed) || 0;
  const messagesSent = Number(row.sent) || 0;
  const inProgress = Math.max(0, totalCarts - recovered - failed);

  // Recovery rate denominator = recovered + failed (terminal outcomes only).
  // Falls back to messagesSent if no terminal outcomes yet, then to 0.
  const denom = (recovered + failed) > 0 ? (recovered + failed) : 0;
  const recoveryRatePct = denom > 0
    ? Math.round((recovered / denom) * 10000) / 100
    : 0;

  const revRow = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS r
    FROM event_cart_recovery_attempts a
    JOIN payments p ON p.id = a.recovered_payment_id
    WHERE a.event_id = ? AND a.recovered_at IS NOT NULL
      AND p.status = 'captured'
  `).get(eventId) as { r: number };

  return {
    totalCarts,
    inProgress,
    recovered,
    recoveryRatePct,
    revenueRecovered: Number(revRow.r) || 0,
    messagesSent,
    messagesOpened: 0,
  };
}

export type RecoveryOutcome = 'in_progress' | 'recovered' | 'failed';

export interface RecoveryActivityRow {
  id: string;
  outcome: RecoveryOutcome;
  customerName: string | null;
  customerPhone: string | null;
  /** Cart amount in INR. 0 for reservation-only attempts (no payment row). */
  amount: number;
  /** Human items string, e.g. "EARLY BIRD SINGLE ENTRY x2". Empty when unknown. */
  items: string;
  /** Short progress string for the table cell — see spec. */
  progress: string;
  /** When the cart was abandoned (payment.updated_at or reservation.synced_at). */
  abandonedAt: number;
  /** When the recovery WA was sent (null when still queued). */
  sentAt: number | null;
  /** When the recovery captured the matching payment (null unless recovered). */
  recoveredAt: number | null;
}

/**
 * Friendly relative-time formatter used in the progress + when columns.
 * Keeps a small string library local — analytics rows are short-lived
 * dashboard data so we don't need full ICU date math.
 */
function relTime(ms: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - ms);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Insights v2: Recovery Activity table — joins attempts with payments (for
 * amount + items via payments.notes) and reservations (for name/phone
 * fallback when the payment row is reservation_only).
 *
 * Output is normalized so the UI doesn't need to know about the dual-source
 * (payment vs reservation) shape: customerName/customerPhone always
 * populated when available, amount falls back to 0 for reservation-only.
 */
export function getRecoveryActivity(eventId: string, limit = 50): RecoveryActivityRow[] {
  const db = getDb();
  const cap = Math.min(Math.max(1, limit), 200);

  // LEFT JOINs because reservation-sourced attempts won't have a payments
  // row (source_id is a reservation id). Conversely payment-sourced attempts
  // won't necessarily have a reservation row joined here; we read the
  // reservation_id off the payment in the next step.
  const rows = db.prepare(`
    SELECT
      a.id AS id,
      a.source AS source,
      a.source_id AS source_id,
      a.phone AS attempt_phone,
      a.customer_name AS attempt_name,
      a.sent_at AS sent_at,
      a.recovered_at AS recovered_at,
      a.recovered_payment_id AS recovered_payment_id,
      a.error AS error,
      a.created_at AS created_at,
      pp.amount AS pay_amount,
      pp.notes AS pay_notes,
      pp.reservation_id AS pay_reservation_id,
      pp.created_at AS pay_created_at,
      pp.updated_at AS pay_updated_at,
      rr.name AS res_name,
      rr.phone AS res_phone,
      rr.synced_at AS res_synced_at,
      rr.pax AS res_pax
    FROM event_cart_recovery_attempts a
    LEFT JOIN payments pp
      ON a.source = 'payment' AND pp.id = a.source_id
    LEFT JOIN reservations rr
      ON (a.source = 'reservation' AND rr.id = a.source_id)
         OR (a.source = 'payment' AND rr.id = pp.reservation_id)
    WHERE a.event_id = ?
    ORDER BY COALESCE(a.sent_at, a.created_at) DESC
    LIMIT ?
  `).all(eventId, cap) as Array<{
    id: string;
    source: 'payment' | 'reservation';
    source_id: string;
    attempt_phone: string | null;
    attempt_name: string | null;
    sent_at: number | null;
    recovered_at: number | null;
    recovered_payment_id: string | null;
    error: string | null;
    created_at: number;
    pay_amount: number | null;
    pay_notes: string | null;
    pay_reservation_id: string | null;
    pay_created_at: number | null;
    pay_updated_at: number | null;
    res_name: string | null;
    res_phone: string | null;
    res_synced_at: number | null;
    res_pax: number | null;
  }>;

  const now = Date.now();

  return rows.map((r): RecoveryActivityRow => {
    // ── outcome derivation ──
    // Recovered wins over failed (an attempt that errored on send but later
    // converted is still a recovery — the operator cares about $ in the
    // door more than the message-status nit).
    let outcome: RecoveryOutcome;
    if (r.recovered_at) outcome = 'recovered';
    else if (r.error && r.error.trim()) outcome = 'failed';
    else outcome = 'in_progress';

    // ── items derivation ──
    // Prefer the ticket type stamped into payments.notes by /api/payments/order
    // (Insights v2 enhancement). Fall back to zone name. Always append "xN"
    // when pax > 1 so the cell reads like "EARLY BIRD SINGLE ENTRY x2".
    let items = '';
    let pax = 1;
    if (r.res_pax && r.res_pax > 1) pax = r.res_pax;
    if (r.pay_notes) {
      try {
        const n = JSON.parse(r.pay_notes) as Record<string, unknown>;
        const tt = typeof n.ticketType === 'string' ? n.ticketType.trim() : '';
        const zn = typeof n.zoneName === 'string' ? n.zoneName.trim() : '';
        if (tt) items = tt;
        else if (zn) items = zn;
      } catch { /* malformed notes — leave items blank */ }
    }
    if (items && pax > 1) items = `${items} x${pax}`;

    // ── abandonedAt ──
    // For payment-sourced rows: the payment's last update is the best
    // proxy for "when the customer walked away". For reservation-only:
    // reservation.synced_at. Fall back to attempt.created_at.
    const abandonedAt =
      r.source === 'payment'
        ? (r.pay_updated_at ?? r.pay_created_at ?? r.created_at)
        : (r.res_synced_at ?? r.created_at);

    // ── progress copy ──
    let progress: string;
    if (outcome === 'recovered') {
      progress = 'Recovered';
    } else if (outcome === 'failed') {
      progress = 'Failed';
    } else if (!r.sent_at) {
      progress = 'Awaiting 1st message';
    } else {
      progress = `Reminder sent ${relTime(r.sent_at, now)}`;
    }

    return {
      id: r.id,
      outcome,
      customerName: r.attempt_name ?? r.res_name ?? null,
      customerPhone: r.attempt_phone ?? r.res_phone ?? null,
      amount: Number(r.pay_amount) || 0,
      items,
      progress,
      abandonedAt,
      sentAt: r.sent_at,
      recoveredAt: r.recovered_at,
    };
  });
}
