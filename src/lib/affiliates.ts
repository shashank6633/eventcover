import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { normalizePhone } from './users';

export type AffiliateStatus = 'active' | 'suspended';
export type CommissionType = 'percent' | 'flat';
export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'reversed';
export type PayoutMethod = 'cash' | 'upi' | 'bank';

export interface AffiliateRow {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: AffiliateStatus;
  commission_type: CommissionType;
  commission_value: number;
  notes: string | null;
  created_at: number;
  created_by: string | null;
  updated_at: number;
}

export interface Affiliate extends AffiliateRow {}

export interface AffiliateClickRow {
  id: string;
  affiliate_id: string;
  event_id: string | null;
  ip: string | null;
  user_agent: string | null;
  referer: string | null;
  created_at: number;
}

export interface AffiliateCommissionRow {
  id: string;
  ticket_id: string;
  affiliate_id: string;
  event_id: string | null;
  sale_amount: number;
  commission_type: CommissionType;
  commission_value: number;
  commission_amount: number;
  status: CommissionStatus;
  payout_id: string | null;
  created_at: number;
  paid_at: number | null;
}

export interface AffiliatePayoutRow {
  id: string;
  affiliate_id: string;
  amount: number;
  method: PayoutMethod;
  reference: string | null;
  notes: string | null;
  paid_by: string | null;
  paid_at: number;
}

export interface AffiliateEventAssignmentRow {
  id: string;
  affiliate_id: string;
  event_id: string;
  commission_type: CommissionType | null;
  commission_value: number | null;
  created_at: number;
}

export interface AffiliateEventAssignmentInput {
  eventId: string;
  commissionType?: CommissionType | null;
  commissionValue?: number | null;
}

export interface AffiliateStats {
  clicks: number;
  tickets: number;
  conversion_rate: number; // 0..1
  gross_sales: number;
  pending_commission: number;
  paid_commission: number;
  total_commission: number;
}

// ─── Code generation ────────────────────────────────────────────────────────

/**
 * Slugify a name into a short, uppercase, alphanumeric code. Falls back
 * to a random suffix if a collision is detected.
 */
function makeCodeFromName(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 8);
  return base || 'AFF';
}

function ensureUniqueCode(seed: string): string {
  const db = getDb();
  const exists = (c: string) =>
    !!db.prepare('SELECT 1 FROM affiliates WHERE code = ?').get(c);

  let code = seed.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12);
  if (!code) code = 'AFF';
  if (!exists(code)) return code;

  // Append numeric suffix until unique
  for (let i = 2; i < 100; i++) {
    const candidate = `${code}${i}`;
    if (!exists(candidate)) return candidate;
  }
  // Last resort: random 4 chars
  return `${code}${nanoid(4).toUpperCase()}`;
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

export function listAffiliates(): Affiliate[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM affiliates ORDER BY status ASC, created_at DESC')
    .all() as AffiliateRow[];
}

export function getAffiliate(id: string): Affiliate | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM affiliates WHERE id = ?').get(id) as
    | AffiliateRow
    | undefined;
  return row ?? null;
}

export function getAffiliateByCode(code: string): Affiliate | null {
  if (!code) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM affiliates WHERE code = ? AND status = ?')
    .get(code.toUpperCase(), 'active') as AffiliateRow | undefined;
  return row ?? null;
}

export interface CreateAffiliateInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  code?: string | null; // explicit override; otherwise derived from name
  commissionType: CommissionType;
  commissionValue: number;
  notes?: string | null;
  createdBy: string;
  /** Optional event assignments to create alongside the affiliate */
  eventAssignments?: AffiliateEventAssignmentInput[];
}

export function createAffiliate(input: CreateAffiliateInput): Affiliate {
  if (!input.name?.trim()) throw new Error('Name is required.');
  if (!['percent', 'flat'].includes(input.commissionType)) {
    throw new Error('Commission type must be "percent" or "flat".');
  }
  if (!Number.isFinite(input.commissionValue) || input.commissionValue < 0) {
    throw new Error('Commission value must be ≥ 0.');
  }
  if (input.commissionType === 'percent' && input.commissionValue > 100) {
    throw new Error('Percent commission cannot exceed 100.');
  }

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  const code = ensureUniqueCode(input.code?.trim() || makeCodeFromName(input.name));
  const phone = input.phone ? normalizePhone(input.phone) : null;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO affiliates (
        id, code, name, phone, email, status, commission_type, commission_value,
        notes, created_at, created_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      code,
      input.name.trim(),
      phone || null,
      input.email?.trim() || null,
      input.commissionType,
      input.commissionValue,
      input.notes?.trim() || null,
      now,
      input.createdBy,
      now,
    );

    // Bulk-insert event assignments if provided
    if (input.eventAssignments?.length) {
      const ins = db.prepare(`
        INSERT INTO affiliate_event_assignments
          (id, affiliate_id, event_id, commission_type, commission_value, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const a of input.eventAssignments) {
        if (!a.eventId) continue;
        ins.run(
          nanoid(),
          id,
          a.eventId,
          a.commissionType || null,
          a.commissionValue ?? null,
          now,
        );
      }
    }
  });
  tx();

  logAudit({
    actor: input.createdBy,
    action: 'affiliate_create',
    entityType: 'affiliate',
    entityId: id,
    details: {
      code,
      name: input.name,
      commission_type: input.commissionType,
      commission_value: input.commissionValue,
      event_count: input.eventAssignments?.length ?? 0,
    },
  });

  return getAffiliate(id)!;
}

export interface UpdateAffiliateInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  status?: AffiliateStatus;
  commissionType?: CommissionType;
  commissionValue?: number;
  notes?: string | null;
}

export function updateAffiliate(
  id: string,
  patch: UpdateAffiliateInput,
  actor: string,
): Affiliate | null {
  const existing = getAffiliate(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, val: string | number | null) => {
    fields.push(`${col} = ?`);
    values.push(val);
  };

  if (patch.name != null) set('name', patch.name.trim());
  if ('phone' in patch) {
    const p = patch.phone ? normalizePhone(patch.phone) : null;
    set('phone', p || null);
  }
  if ('email' in patch) set('email', patch.email?.trim() || null);
  if (patch.status != null) {
    if (!['active', 'suspended'].includes(patch.status)) {
      throw new Error('Status must be active or suspended.');
    }
    set('status', patch.status);
  }
  if (patch.commissionType != null) {
    if (!['percent', 'flat'].includes(patch.commissionType)) {
      throw new Error('Commission type must be "percent" or "flat".');
    }
    set('commission_type', patch.commissionType);
  }
  if (patch.commissionValue != null) {
    if (!Number.isFinite(patch.commissionValue) || patch.commissionValue < 0) {
      throw new Error('Commission value must be ≥ 0.');
    }
    set('commission_value', patch.commissionValue);
  }
  if ('notes' in patch) set('notes', patch.notes?.trim() || null);

  if (fields.length === 0) return existing;

  set('updated_at', Date.now());
  values.push(id);

  const db = getDb();
  db.prepare(`UPDATE affiliates SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  logAudit({
    actor,
    action: 'affiliate_update',
    entityType: 'affiliate',
    entityId: id,
    details: patch as Record<string, unknown>,
  });

  return getAffiliate(id);
}

// ─── Click tracking ─────────────────────────────────────────────────────────

export interface RecordClickInput {
  affiliateId: string;
  eventId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  referer?: string | null;
}

export function recordClick(input: RecordClickInput): string {
  const db = getDb();
  const id = nanoid();
  db.prepare(`
    INSERT INTO affiliate_clicks (id, affiliate_id, event_id, ip, user_agent, referer, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.affiliateId,
    input.eventId || null,
    input.ip || null,
    input.userAgent || null,
    input.referer || null,
    Date.now(),
  );
  return id;
}

// ─── Commission compute + attribution ───────────────────────────────────────

/**
 * Given an affiliate and the gross sale amount (ticket price × pax), compute
 * the commission. Returns 0 for complimentary or zero-price tickets.
 */
export function computeCommission(
  affiliate: Pick<Affiliate, 'commission_type' | 'commission_value'>,
  saleAmount: number,
  pax: number = 1,
): number {
  if (saleAmount <= 0) return 0;
  if (affiliate.commission_type === 'flat') {
    return Math.round(affiliate.commission_value * Math.max(1, pax));
  }
  // percent
  return Math.round((saleAmount * affiliate.commission_value) / 100);
}

export interface AttributeTicketInput {
  ticketId: string;
  affiliateCode: string;
  eventId: string;
  saleAmount: number; // price * pax (after any discounts)
  pax: number;
}

/**
 * Resolve an affiliate code, compute commission, persist both the
 * affiliate_commissions row AND the denormalized fields on `tickets`.
 *
 * Returns the affiliate if attribution succeeded, otherwise null (e.g.
 * code didn't match an active affiliate). Never throws — safe to call
 * from inside the ticket-create path.
 */
export function attributeTicket(input: AttributeTicketInput): {
  affiliate: Affiliate;
  commission_amount: number;
} | null {
  try {
    const aff = getAffiliateByCode(input.affiliateCode);
    if (!aff) return null;
    if (input.saleAmount <= 0) return null;

    const db = getDb();

    // Strict event assignment check — the code only earns on assigned events
    const assignment = db
      .prepare(`
        SELECT * FROM affiliate_event_assignments
        WHERE affiliate_id = ? AND event_id = ?
      `)
      .get(aff.id, input.eventId) as AffiliateEventAssignmentRow | undefined;
    if (!assignment) {
      // Affiliate's code is valid but they aren't assigned to this event
      return null;
    }

    // Use assignment-specific commission if set, else affiliate default
    const effectiveType: CommissionType = assignment.commission_type || aff.commission_type;
    const effectiveValue: number =
      assignment.commission_value != null ? assignment.commission_value : aff.commission_value;

    const commission = computeCommission(
      { commission_type: effectiveType, commission_value: effectiveValue },
      input.saleAmount,
      input.pax,
    );
    if (commission <= 0) return null;

    const id = nanoid();
    const now = Date.now();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO affiliate_commissions (
          id, ticket_id, affiliate_id, event_id, sale_amount,
          commission_type, commission_value, commission_amount,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        id,
        input.ticketId,
        aff.id,
        input.eventId,
        input.saleAmount,
        effectiveType,
        effectiveValue,
        commission,
        now,
      );

      db.prepare(`
        UPDATE tickets
        SET affiliate_code = ?, affiliate_id = ?, commission_amount = ?, commission_status = 'pending'
        WHERE id = ?
      `).run(aff.code, aff.id, commission, input.ticketId);
    });
    tx();

    logAudit({
      actor: 'system',
      action: 'affiliate_attribute',
      entityType: 'ticket',
      entityId: input.ticketId,
      details: {
        affiliate_id: aff.id,
        affiliate_code: aff.code,
        sale_amount: input.saleAmount,
        commission_amount: commission,
      },
    });

    return { affiliate: aff, commission_amount: commission };
  } catch (e) {
    // Attribution is best-effort — never block a ticket creation
    console.error('[affiliate] attribution failed:', e);
    return null;
  }
}

// ─── Stats ─────────────────────────────────────────────────────────────────

export function getAffiliateStats(affiliateId: string): AffiliateStats {
  const db = getDb();
  const clicks =
    (db.prepare('SELECT COUNT(*) AS c FROM affiliate_clicks WHERE affiliate_id = ?').get(affiliateId) as { c: number }).c;
  const tickets =
    (db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE affiliate_id = ? AND status = 'issued'`).get(affiliateId) as { c: number }).c;
  const sums = db.prepare(`
    SELECT
      COALESCE(SUM(sale_amount),       0) AS gross,
      COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN commission_amount ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status =  'paid' THEN commission_amount ELSE 0 END), 0) AS paid
    FROM affiliate_commissions WHERE affiliate_id = ?
  `).get(affiliateId) as { gross: number; pending: number; paid: number };

  return {
    clicks,
    tickets,
    conversion_rate: clicks > 0 ? tickets / clicks : 0,
    gross_sales: sums.gross,
    pending_commission: sums.pending,
    paid_commission: sums.paid,
    total_commission: sums.pending + sums.paid,
  };
}

// ─── Payouts ───────────────────────────────────────────────────────────────

export interface PendingCommissionSummary {
  affiliate_id: string;
  affiliate_code: string;
  affiliate_name: string;
  commission_count: number;
  total_amount: number;
}

/**
 * Aggregated view of every affiliate with pending commissions, used to
 * power the /admin/payouts page.
 */
export function listPendingPayouts(): PendingCommissionSummary[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      a.id      AS affiliate_id,
      a.code    AS affiliate_code,
      a.name    AS affiliate_name,
      COUNT(c.id)             AS commission_count,
      COALESCE(SUM(c.commission_amount), 0) AS total_amount
    FROM affiliates a
    JOIN affiliate_commissions c ON c.affiliate_id = a.id
    WHERE c.status IN ('pending','approved')
    GROUP BY a.id
    ORDER BY total_amount DESC
  `).all() as PendingCommissionSummary[];
}

export interface CreatePayoutInput {
  affiliateId: string;
  method: PayoutMethod;
  reference?: string | null;
  notes?: string | null;
  paidBy: string;
}

/**
 * Bundle all pending commissions for an affiliate into a single payout row,
 * mark them paid, stamp the ticket commission_status. Atomic.
 */
export function createPayout(input: CreatePayoutInput): AffiliatePayoutRow | null {
  if (!['cash', 'upi', 'bank'].includes(input.method)) {
    throw new Error('Method must be cash, upi, or bank.');
  }
  const db = getDb();

  const pending = db.prepare(`
    SELECT id, commission_amount, ticket_id
    FROM affiliate_commissions
    WHERE affiliate_id = ? AND status IN ('pending','approved')
  `).all(input.affiliateId) as { id: string; commission_amount: number; ticket_id: string }[];

  if (pending.length === 0) return null;

  const total = pending.reduce((s, c) => s + c.commission_amount, 0);
  const payoutId = nanoid();
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO affiliate_payouts (id, affiliate_id, amount, method, reference, notes, paid_by, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payoutId,
      input.affiliateId,
      total,
      input.method,
      input.reference?.trim() || null,
      input.notes?.trim() || null,
      input.paidBy,
      now,
    );

    const markComm = db.prepare(`
      UPDATE affiliate_commissions
      SET status = 'paid', payout_id = ?, paid_at = ?
      WHERE id = ?
    `);
    const markTicket = db.prepare(`
      UPDATE tickets SET commission_status = 'paid' WHERE id = ?
    `);
    for (const c of pending) {
      markComm.run(payoutId, now, c.id);
      markTicket.run(c.ticket_id);
    }
  });
  tx();

  logAudit({
    actor: input.paidBy,
    action: 'affiliate_payout',
    entityType: 'affiliate',
    entityId: input.affiliateId,
    details: {
      payout_id: payoutId,
      amount: total,
      commission_count: pending.length,
      method: input.method,
    },
  });

  return db.prepare('SELECT * FROM affiliate_payouts WHERE id = ?').get(payoutId) as AffiliatePayoutRow;
}

export function listPayoutsForAffiliate(affiliateId: string): AffiliatePayoutRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM affiliate_payouts WHERE affiliate_id = ? ORDER BY paid_at DESC')
    .all(affiliateId) as AffiliatePayoutRow[];
}

export function listAllPayouts(limit = 100): (AffiliatePayoutRow & {
  affiliate_code: string;
  affiliate_name: string;
})[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, a.code AS affiliate_code, a.name AS affiliate_name
    FROM affiliate_payouts p
    JOIN affiliates a ON a.id = p.affiliate_id
    ORDER BY p.paid_at DESC
    LIMIT ?
  `).all(limit) as (AffiliatePayoutRow & { affiliate_code: string; affiliate_name: string })[];
}

// ─── Event assignments ────────────────────────────────────────────────────

export interface AssignmentWithEvent extends AffiliateEventAssignmentRow {
  event_name: string;
  event_date: string;
  event_status: string;
}

export function listAssignments(affiliateId: string): AssignmentWithEvent[] {
  const db = getDb();
  return db.prepare(`
    SELECT a.*, e.name AS event_name, e.event_date, e.status AS event_status
    FROM affiliate_event_assignments a
    JOIN events e ON e.id = a.event_id
    WHERE a.affiliate_id = ?
    ORDER BY e.event_date DESC
  `).all(affiliateId) as AssignmentWithEvent[];
}

export function getAssignment(affiliateId: string, eventId: string): AffiliateEventAssignmentRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM affiliate_event_assignments WHERE affiliate_id = ? AND event_id = ?')
    .get(affiliateId, eventId) as AffiliateEventAssignmentRow | undefined;
  return row ?? null;
}

export function assignEvent(
  affiliateId: string,
  eventId: string,
  commissionType: CommissionType | null | undefined,
  commissionValue: number | null | undefined,
  actor: string,
): AffiliateEventAssignmentRow {
  if (!affiliateId || !eventId) throw new Error('affiliateId and eventId are required.');
  if (commissionType && !['percent', 'flat'].includes(commissionType)) {
    throw new Error('Commission type must be "percent" or "flat".');
  }
  if (commissionValue != null && (!Number.isFinite(commissionValue) || commissionValue < 0)) {
    throw new Error('Commission value must be ≥ 0.');
  }
  if (commissionType === 'percent' && commissionValue != null && commissionValue > 100) {
    throw new Error('Percent commission cannot exceed 100.');
  }

  const db = getDb();
  const existing = getAssignment(affiliateId, eventId);
  if (existing) {
    // Upsert: update the override values
    db.prepare(`
      UPDATE affiliate_event_assignments
      SET commission_type = ?, commission_value = ?
      WHERE id = ?
    `).run(commissionType || null, commissionValue ?? null, existing.id);
    logAudit({
      actor,
      action: 'affiliate_assignment_update',
      entityType: 'affiliate_event_assignment',
      entityId: existing.id,
      details: { affiliateId, eventId, commissionType, commissionValue },
    });
    return getAssignment(affiliateId, eventId)!;
  }

  const id = nanoid();
  const now = Date.now();
  db.prepare(`
    INSERT INTO affiliate_event_assignments
      (id, affiliate_id, event_id, commission_type, commission_value, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, affiliateId, eventId, commissionType || null, commissionValue ?? null, now);

  logAudit({
    actor,
    action: 'affiliate_assignment_create',
    entityType: 'affiliate_event_assignment',
    entityId: id,
    details: { affiliateId, eventId, commissionType, commissionValue },
  });

  return getAssignment(affiliateId, eventId)!;
}

export function unassignEvent(affiliateId: string, eventId: string, actor: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM affiliate_event_assignments WHERE affiliate_id = ? AND event_id = ?')
    .run(affiliateId, eventId);
  if (result.changes > 0) {
    logAudit({
      actor,
      action: 'affiliate_assignment_delete',
      entityType: 'affiliate_event_assignment',
      details: { affiliateId, eventId },
    });
    return true;
  }
  return false;
}

// ─── Per-event breakdown ──────────────────────────────────────────────────

export interface EventBreakdownRow {
  event_id: string;
  event_name: string;
  event_date: string;
  event_status: string;
  /** The commission actually in effect for this assignment (override or affiliate default) */
  effective_commission_type: CommissionType;
  effective_commission_value: number;
  /** Whether this row is using an explicit per-event override */
  has_override: boolean;
  clicks: number;
  tickets: number;
  sales: number;
  pending_commission: number;
  paid_commission: number;
  total_commission: number;
}

/**
 * Per-event breakdown for an affiliate — drives the affiliate detail page.
 * Includes events the affiliate is ASSIGNED to, even if they have no clicks
 * or tickets yet (so the operator can see all campaigns at a glance).
 */
export function getAffiliateEventBreakdown(affiliateId: string): EventBreakdownRow[] {
  const aff = getAffiliate(affiliateId);
  if (!aff) return [];

  const db = getDb();
  const assignments = listAssignments(affiliateId);

  return assignments.map((a) => {
    const clicks =
      (db.prepare('SELECT COUNT(*) AS c FROM affiliate_clicks WHERE affiliate_id = ? AND event_id = ?')
        .get(affiliateId, a.event_id) as { c: number }).c;
    const tickets =
      (db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE affiliate_id = ? AND event_id = ? AND status = 'issued'`)
        .get(affiliateId, a.event_id) as { c: number }).c;
    const sums = db.prepare(`
      SELECT
        COALESCE(SUM(sale_amount),       0) AS sales,
        COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN commission_amount ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN commission_amount ELSE 0 END), 0) AS paid
      FROM affiliate_commissions
      WHERE affiliate_id = ? AND event_id = ?
    `).get(affiliateId, a.event_id) as { sales: number; pending: number; paid: number };

    return {
      event_id: a.event_id,
      event_name: a.event_name,
      event_date: a.event_date,
      event_status: a.event_status,
      effective_commission_type: (a.commission_type || aff.commission_type) as CommissionType,
      effective_commission_value: a.commission_value != null ? a.commission_value : aff.commission_value,
      has_override: a.commission_type != null || a.commission_value != null,
      clicks,
      tickets,
      sales: sums.sales,
      pending_commission: sums.pending,
      paid_commission: sums.paid,
      total_commission: sums.pending + sums.paid,
    };
  });
}

// ─── Drill-down: tickets for a specific (affiliate, event) ────────────────

export interface AffiliateTicketRow {
  ticket_id: string;
  customer_name: string;
  customer_phone: string;
  ticket_name: string;
  category: string;
  pax: number;
  price: number;
  status: string;
  created_at: number;
  commission_amount: number;
  commission_status: string;
}

export function listTicketsForAffiliateEvent(
  affiliateId: string,
  eventId: string,
): AffiliateTicketRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      t.id              AS ticket_id,
      t.customer_name,
      t.customer_phone,
      t.ticket_name,
      t.category,
      t.pax,
      t.price,
      t.status,
      t.created_at,
      COALESCE(c.commission_amount, 0) AS commission_amount,
      COALESCE(c.status, '')           AS commission_status
    FROM tickets t
    LEFT JOIN affiliate_commissions c
      ON c.ticket_id = t.id AND c.affiliate_id = t.affiliate_id
    WHERE t.affiliate_id = ? AND t.event_id = ?
    ORDER BY t.created_at DESC
  `).all(affiliateId, eventId) as AffiliateTicketRow[];
}
