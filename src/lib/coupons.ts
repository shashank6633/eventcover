/**
 * Coupons — discount codes redeemable on the public booking flow.
 *
 * A coupon belongs to a single event (event_id NOT NULL) OR is venue-wide
 * (event_id NULL). Codes are stored UPPER-cased with a unique index per
 * (event_id, code) scope so the same code can exist for different events.
 *
 * Discount math is pure (validateCoupon → { ok, discountAmount, finalAmount })
 * so it can be called from both the admin preview and the
 * /api/payments/order route without side effects. Mutations
 * (incrementCouponUse) happen ONLY inside the payments/verify transaction.
 */
import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';

export type CouponDiscountType = 'fixed' | 'percent';

export interface CouponRow {
  id: string;
  event_id: string | null;
  code: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  max_uses: number | null;
  used_count: number;
  expires_at: number | null;
  active: number;
  notes: string | null;
  affiliate_id: string | null;
  created_at: number;
  created_by: string | null;
}

export interface Coupon extends Omit<CouponRow, 'active'> {
  active: boolean;
}

function hydrate(row: CouponRow): Coupon {
  return { ...row, active: !!row.active };
}

// ─── Code normalization ────────────────────────────────────────────────────

/**
 * Codes are uppercase A–Z + 0–9 only, max 24 chars. Anything outside that
 * range is silently stripped. Empty result throws so the caller surfaces a
 * useful validation error.
 */
export function normalizeCode(raw: unknown): string {
  const cleaned = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 24);
  if (!cleaned) throw new Error('Coupon code must contain at least one letter or digit.');
  return cleaned;
}

// ─── List / get ────────────────────────────────────────────────────────────

export interface ListCouponsOpts {
  eventId?: string | null;
  /** Include rows where active = 0 (admin list). Default true. */
  includeInactive?: boolean;
}

/**
 * List coupons. Without eventId → returns every coupon (admin global view).
 * With eventId → returns coupons scoped to that event PLUS venue-wide rows
 * (event_id IS NULL) so the admin sees both in one list.
 */
export function listCoupons(opts: ListCouponsOpts = {}): Coupon[] {
  const db = getDb();
  const includeInactive = opts.includeInactive ?? true;
  const activeFilter = includeInactive ? '' : ' AND active = 1';

  if (opts.eventId === undefined) {
    return (
      db.prepare(`SELECT * FROM event_coupons WHERE 1=1${activeFilter} ORDER BY created_at DESC`)
        .all() as CouponRow[]
    ).map(hydrate);
  }

  if (opts.eventId === null) {
    return (
      db.prepare(`SELECT * FROM event_coupons WHERE event_id IS NULL${activeFilter} ORDER BY created_at DESC`)
        .all() as CouponRow[]
    ).map(hydrate);
  }

  return (
    db
      .prepare(
        `SELECT * FROM event_coupons WHERE (event_id = ? OR event_id IS NULL)${activeFilter} ORDER BY created_at DESC`,
      )
      .all(opts.eventId) as CouponRow[]
  ).map(hydrate);
}

export function getCoupon(id: string): Coupon | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM event_coupons WHERE id = ?').get(id) as CouponRow | undefined;
  return row ? hydrate(row) : null;
}

/**
 * Resolve a typed code against the (event-scoped + venue-wide) namespace.
 * Returns the more specific match first (event_id = ? wins over NULL when
 * codes collide).
 */
export function getCouponByCode(eventId: string | null, code: string): Coupon | null {
  const db = getDb();
  const normalized = normalizeCode(code);

  // Event-specific first
  if (eventId) {
    const row = db
      .prepare('SELECT * FROM event_coupons WHERE event_id = ? AND code = ? LIMIT 1')
      .get(eventId, normalized) as CouponRow | undefined;
    if (row) return hydrate(row);
  }

  // Fall back to venue-wide
  const venueWide = db
    .prepare('SELECT * FROM event_coupons WHERE event_id IS NULL AND code = ? LIMIT 1')
    .get(normalized) as CouponRow | undefined;
  return venueWide ? hydrate(venueWide) : null;
}

// ─── Create / update / delete ──────────────────────────────────────────────

export interface CreateCouponInput {
  eventId?: string | null;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxUses?: number | null;
  expiresAt?: number | null;
  notes?: string | null;
  active?: boolean;
  affiliateId?: string | null;
  createdBy: string;
}

export function createCoupon(input: CreateCouponInput): Coupon {
  const code = normalizeCode(input.code);

  if (!['fixed', 'percent'].includes(input.discountType)) {
    throw new Error('discountType must be "fixed" or "percent".');
  }
  if (!Number.isFinite(input.discountValue) || input.discountValue <= 0) {
    throw new Error('discountValue must be greater than 0.');
  }
  if (input.discountType === 'percent' && input.discountValue > 100) {
    throw new Error('Percent discount cannot exceed 100.');
  }
  if (input.maxUses != null && (!Number.isInteger(input.maxUses) || input.maxUses <= 0)) {
    throw new Error('maxUses must be a positive integer or null.');
  }
  if (input.expiresAt != null && (!Number.isInteger(input.expiresAt) || input.expiresAt <= 0)) {
    throw new Error('expiresAt must be a positive epoch-ms integer or null.');
  }

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  const eventId = input.eventId || null;
  const active = input.active === false ? 0 : 1;

  // Uniqueness pre-check — surfaces a friendly error before the index fires
  const collision = getCouponByCode(eventId, code);
  if (collision && collision.event_id === eventId) {
    throw new Error(`A coupon with code "${code}" already exists for this scope.`);
  }

  try {
    db.prepare(`
      INSERT INTO event_coupons (
        id, event_id, code, discount_type, discount_value,
        max_uses, used_count, expires_at, active, notes,
        affiliate_id, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      eventId,
      code,
      input.discountType,
      input.discountValue,
      input.maxUses ?? null,
      input.expiresAt ?? null,
      active,
      input.notes?.trim() || null,
      input.affiliateId ?? null,
      now,
      input.createdBy,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create coupon.';
    if (/UNIQUE/i.test(msg)) {
      throw new Error(`A coupon with code "${code}" already exists for this scope.`);
    }
    throw e;
  }

  logAudit({
    actor: input.createdBy,
    action: 'coupon_create',
    entityType: 'coupon',
    entityId: id,
    details: {
      event_id: eventId,
      code,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      max_uses: input.maxUses ?? null,
      expires_at: input.expiresAt ?? null,
    },
  });

  return getCoupon(id)!;
}

export interface UpdateCouponInput {
  active?: boolean;
  discountType?: CouponDiscountType;
  discountValue?: number;
  maxUses?: number | null;
  expiresAt?: number | null;
  notes?: string | null;
  affiliateId?: string | null;
}

export function updateCoupon(id: string, patch: UpdateCouponInput, actor: string): Coupon | null {
  const existing = getCoupon(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, val: string | number | null) => {
    fields.push(`${col} = ?`);
    values.push(val);
  };

  if (patch.active != null) set('active', patch.active ? 1 : 0);
  if (patch.discountType != null) {
    if (!['fixed', 'percent'].includes(patch.discountType)) {
      throw new Error('discountType must be "fixed" or "percent".');
    }
    set('discount_type', patch.discountType);
  }
  if (patch.discountValue != null) {
    if (!Number.isFinite(patch.discountValue) || patch.discountValue <= 0) {
      throw new Error('discountValue must be greater than 0.');
    }
    const t = patch.discountType || existing.discount_type;
    if (t === 'percent' && patch.discountValue > 100) {
      throw new Error('Percent discount cannot exceed 100.');
    }
    set('discount_value', patch.discountValue);
  }
  if ('maxUses' in patch) {
    if (patch.maxUses != null && (!Number.isInteger(patch.maxUses) || patch.maxUses <= 0)) {
      throw new Error('maxUses must be a positive integer or null.');
    }
    set('max_uses', patch.maxUses ?? null);
  }
  if ('expiresAt' in patch) {
    if (patch.expiresAt != null && (!Number.isInteger(patch.expiresAt) || patch.expiresAt <= 0)) {
      throw new Error('expiresAt must be a positive epoch-ms integer or null.');
    }
    set('expires_at', patch.expiresAt ?? null);
  }
  if ('notes' in patch) set('notes', patch.notes?.trim() || null);
  if ('affiliateId' in patch) set('affiliate_id', patch.affiliateId ?? null);

  if (fields.length === 0) return existing;

  values.push(id);
  const db = getDb();
  db.prepare(`UPDATE event_coupons SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  logAudit({
    actor,
    action: 'coupon_update',
    entityType: 'coupon',
    entityId: id,
    details: patch as Record<string, unknown>,
  });

  return getCoupon(id);
}

/**
 * Delete a coupon. If it has any uses, we soft-delete (active=0) so
 * historical analytics still resolve the code; otherwise we hard-delete.
 */
export function deleteCoupon(id: string, actor: string): boolean {
  const db = getDb();
  const existing = getCoupon(id);
  if (!existing) return false;

  if (existing.used_count > 0) {
    db.prepare('UPDATE event_coupons SET active = 0 WHERE id = ?').run(id);
    logAudit({
      actor,
      action: 'coupon_soft_delete',
      entityType: 'coupon',
      entityId: id,
      details: { code: existing.code, used_count: existing.used_count },
    });
    return true;
  }

  db.prepare('DELETE FROM event_coupons WHERE id = ?').run(id);
  logAudit({
    actor,
    action: 'coupon_delete',
    entityType: 'coupon',
    entityId: id,
    details: { code: existing.code },
  });
  return true;
}

// ─── Pure discount engine ──────────────────────────────────────────────────

export interface ValidateCouponInput {
  code: string;
  eventId: string | null;
  subtotal: number;
}

export interface ValidateCouponResult {
  ok: boolean;
  /** INR amount that would be deducted (≥ 0, clamped to subtotal). */
  discountAmount: number;
  /** INR final amount = subtotal - discountAmount (≥ 0). */
  finalAmount: number;
  /** Coupon row id when ok=true, otherwise null. */
  couponId: string | null;
  /** Normalized code that matched, when ok=true. */
  code?: string;
  /** Generic, customer-safe reason on failure (never leaks specifics). */
  reason?: string;
}

/**
 * Pure validation — no DB writes. Used by both the admin preview and the
 * payments/order route. Returns a generic "Invalid or expired coupon"
 * reason on failure so the public surface can't be used to enumerate codes.
 *
 * Rules:
 *   - active = 1
 *   - expires_at null OR > now
 *   - used_count < max_uses (when max_uses set)
 *   - scope match: event-specific OR venue-wide (event_id NULL)
 *   - subtotal > 0 (don't apply to a free booking)
 *   - percent → round(subtotal * value / 100), clamped to subtotal
 *   - fixed   → min(value, subtotal)
 *   - final amount is non-negative
 */
export function validateCoupon(input: ValidateCouponInput): ValidateCouponResult {
  const failed = (reason: string): ValidateCouponResult => ({
    ok: false,
    discountAmount: 0,
    finalAmount: input.subtotal,
    couponId: null,
    reason,
  });

  if (!Number.isFinite(input.subtotal) || input.subtotal <= 0) {
    return failed('Coupon cannot be applied to a free booking.');
  }

  let normalized: string;
  try {
    normalized = normalizeCode(input.code);
  } catch {
    return failed('Invalid or expired coupon code.');
  }

  const coupon = getCouponByCode(input.eventId, normalized);
  if (!coupon) return failed('Invalid or expired coupon code.');
  if (!coupon.active) return failed('Invalid or expired coupon code.');
  if (coupon.expires_at != null && coupon.expires_at <= Date.now()) {
    return failed('Invalid or expired coupon code.');
  }
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
    return failed('This coupon is no longer available.');
  }
  // Scope: either venue-wide (event_id NULL) or matches event_id.
  if (coupon.event_id != null && coupon.event_id !== input.eventId) {
    return failed('Invalid or expired coupon code.');
  }

  let discount: number;
  if (coupon.discount_type === 'percent') {
    discount = Math.round((input.subtotal * coupon.discount_value) / 100);
  } else {
    discount = Math.round(coupon.discount_value);
  }
  if (!Number.isFinite(discount) || discount < 0) discount = 0;
  if (discount > input.subtotal) discount = input.subtotal;

  const finalAmount = Math.max(0, input.subtotal - discount);

  return {
    ok: true,
    discountAmount: discount,
    finalAmount,
    couponId: coupon.id,
    code: coupon.code,
  };
}

// ─── Atomic usage increment ────────────────────────────────────────────────

/**
 * Increment used_count, re-checking max_uses against the now-locked row.
 * MUST be called inside a db.transaction() (the caller — the payments
 * verify route — wraps this together with the payment confirm).
 *
 * Returns true if the increment landed, false if the coupon hit its cap
 * (caller should roll back). Idempotency is the caller's job — verify
 * is already idempotent on payments.status='captured'.
 */
export function incrementCouponUse(id: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT max_uses, used_count FROM event_coupons WHERE id = ?')
    .get(id) as { max_uses: number | null; used_count: number } | undefined;
  if (!row) return false;
  if (row.max_uses != null && row.used_count >= row.max_uses) return false;
  db.prepare('UPDATE event_coupons SET used_count = used_count + 1 WHERE id = ?').run(id);
  return true;
}

// ─── Coupon redemption ledger ──────────────────────────────────────────────

export interface RecordCouponRedemptionInput {
  couponId: string;
  paymentId: string;
  eventId: string | null;
  reservationId: string | null;
  discountAmount: number;
}

/**
 * Append a row to coupon_redemptions so we have a real audit trail of which
 * payment used which coupon (one row per redemption). UNIQUE(coupon_id,
 * payment_id) at the schema level makes the INSERT idempotent against
 * verify retries, so callers can safely invoke this from the same
 * transaction as incrementCouponUse without worrying about duplicates.
 */
export function recordCouponRedemption(input: RecordCouponRedemptionInput): void {
  if (!input.couponId || !input.paymentId) return;
  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO coupon_redemptions
      (id, coupon_id, payment_id, event_id, reservation_id, discount_amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.couponId,
    input.paymentId,
    input.eventId,
    input.reservationId,
    Number.isFinite(input.discountAmount) ? input.discountAmount : 0,
    now,
  );
}
