/**
 * Analytics aggregation — drives /admin/analytics.
 *
 * Two parallel scopes:
 *   1. Lifetime  — every wallet / ticket / redemption ever created
 *   2. Range     — same KPIs scoped to a from/to window (defaults to today's shift)
 *
 * Plus a flat transaction feed (Issue / Redeem / Ticket events) with the same
 * columns as the screenshot reference:
 *   Invoice No · Customer Name · Customer Ph.no · Amount · Timestamp · Txn ·
 *   Payment Mode · Employee Name · Action
 */
import { getDb } from './db';
import { sweepExpired } from './wallet';
import type { PaymentMethod } from './types';

export interface AnalyticsKpis {
  totalCustomers: number;
  totalIncoming: number;
  totalCoverCharge: number;
  amountIssued: number;
  topUpsPreload: number;     // placeholder — not yet implemented; always 0
  totalRedeems: number;
  leftOver: number;
  editedAmount: number;
  paymentBreakdown: {
    online: number;
    cash: number;
    card: number;
    upi: number;
    ticket: number;
  };
}

export type AnalyticsTxnKind = 'Issue' | 'Redeem' | 'Top Up' | 'Ticket' | 'Void';

export interface AnalyticsTxnRow {
  id: string;                   // composite, e.g. 'issue:SKY-…' or 'redeem:rd_…'
  invoice_no: string;
  customer_name: string;
  customer_phone: string;
  amount: number;
  timestamp: number;
  kind: AnalyticsTxnKind;       // 'Issue' / 'Redeem' / 'Ticket' / 'Void'
  payment_mode: string;         // CASH / UPI / CARD / ONLINE / COMP / TICKET / —
  employee_name: string;
  /** Underlying wallet/ticket id used by the row's Action button (delete/void). */
  entity_ref: string;
  entity_type: 'wallet' | 'redemption' | 'ticket';
}

export interface AnalyticsFilters {
  /** UTC ms inclusive. Omit both for lifetime. */
  from?: number;
  /** UTC ms exclusive. */
  to?: number;
  /** Free text — invoice, name, phone, amount. */
  search?: string;
  /** Employee name (issued_by / captain / ticket created_by). */
  employee?: string;
  /** Max rows in the transaction feed. */
  limit?: number;
}

export interface AnalyticsResult {
  lifetime: AnalyticsKpis;
  range: AnalyticsKpis;
  transactions: AnalyticsTxnRow[];
  /** Distinct employee names — drives the dropdown. */
  employees: string[];
  /** Echoes the resolved range so the UI can render it. */
  rangeFrom: number;
  rangeTo: number;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function loadVoidedTxnIdsAll(): Set<string> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT entity_id
    FROM audit_log
    WHERE action = 'wallet_void' AND entity_type = 'wallet' AND entity_id IS NOT NULL
  `).all() as { entity_id: string }[];
  return new Set(rows.map((r) => r.entity_id));
}

function loadVoidedTxnIdsRange(from: number, to: number): Set<string> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT entity_id
    FROM audit_log
    WHERE action = 'wallet_void' AND entity_type = 'wallet'
      AND timestamp >= ? AND timestamp < ?
      AND entity_id IS NOT NULL
  `).all(from, to) as { entity_id: string }[];
  return new Set(rows.map((r) => r.entity_id));
}

/**
 * Sum cover_issued for a set of voided wallets — what would otherwise
 * have been redeemable. Drives "Edited Amount".
 */
function sumVoidedCover(txnIds: string[]): number {
  if (txnIds.length === 0) return 0;
  const db = getDb();
  const placeholders = txnIds.map(() => '?').join(',');
  const row = db.prepare(`
    SELECT COALESCE(SUM(cover_issued), 0) AS total
    FROM wallets WHERE txn_id IN (${placeholders})
  `).get(...txnIds) as { total: number };
  return row.total || 0;
}

// ─── per-scope KPI computation ─────────────────────────────────────────────

/**
 * Compute the 10 KPI tiles for a given scope. When `from`/`to` are undefined
 * the scope is lifetime (no time filter).
 */
function computeKpis(from: number | undefined, to: number | undefined): AnalyticsKpis {
  const db = getDb();
  const inRange = from !== undefined && to !== undefined;

  // Wallets in scope
  const walletWhere = inRange ? 'WHERE issued_at >= ? AND issued_at < ?' : '';
  const walletParams = inRange ? [from!, to!] : [];

  const walletAgg = db.prepare(`
    SELECT
      COALESCE(SUM(entry_fee), 0)    AS entry_total,
      COALESCE(SUM(cover_issued), 0) AS cover_total,
      COUNT(*)                       AS wallet_count,
      COUNT(DISTINCT guest_id)       AS unique_guests
    FROM wallets
    ${walletWhere}
  `).get(...walletParams) as { entry_total: number; cover_total: number; wallet_count: number; unique_guests: number };

  // Payment-mode breakdown (entry+cover bundled — the amount paid for the wallet)
  const payRows = db.prepare(`
    SELECT payment_method,
           COALESCE(SUM(entry_fee + cover_issued), 0) AS amount
    FROM wallets
    ${walletWhere}
    GROUP BY payment_method
  `).all(...walletParams) as { payment_method: PaymentMethod; amount: number }[];

  const paymentBreakdown = { online: 0, cash: 0, card: 0, upi: 0, ticket: 0 };
  for (const r of payRows) {
    if (r.payment_method in paymentBreakdown) {
      paymentBreakdown[r.payment_method as keyof typeof paymentBreakdown] += r.amount || 0;
    }
  }

  // Redemptions in scope (success only — reversed redemptions feed Edited Amount)
  const redeemWhere = inRange ? "WHERE r.created_at >= ? AND r.created_at < ? AND r.status = 'success'" : "WHERE r.status = 'success'";
  const redeemAgg = db.prepare(`
    SELECT COALESCE(SUM(r.amount), 0) AS total
    FROM redemptions r
    ${redeemWhere}
  `).get(...walletParams) as { total: number };

  // Reversed redemptions feed Edited Amount alongside voids
  const reversedWhere = inRange ? "WHERE r.created_at >= ? AND r.created_at < ? AND r.status = 'reversed'" : "WHERE r.status = 'reversed'";
  const reversedAgg = db.prepare(`
    SELECT COALESCE(SUM(r.amount), 0) AS total
    FROM redemptions r
    ${reversedWhere}
  `).get(...walletParams) as { total: number };

  // Tickets in scope — count toward Total Incoming + Ticket Amount.
  // Complimentary tickets cost nothing so they're excluded from money totals.
  const ticketWhere = inRange ? "WHERE created_at >= ? AND created_at < ? AND status = 'issued' AND complimentary = 0" : "WHERE status = 'issued' AND complimentary = 0";
  const ticketAgg = db.prepare(`
    SELECT COALESCE(SUM(price), 0) AS total, COUNT(*) AS count
    FROM tickets
    ${ticketWhere}
  `).get(...walletParams) as { total: number; count: number };
  paymentBreakdown.ticket = ticketAgg.total || 0;

  // Voided wallets — for Edited Amount
  const voided = inRange
    ? Array.from(loadVoidedTxnIdsRange(from!, to!))
    : Array.from(loadVoidedTxnIdsAll());
  const voidedCover = sumVoidedCover(voided);

  const amountIssued = walletAgg.cover_total || 0;
  const totalRedeems = redeemAgg.total || 0;
  const editedAmount = voidedCover + (reversedAgg.total || 0);

  return {
    totalCustomers: walletAgg.unique_guests || 0,
    totalIncoming: (walletAgg.entry_total || 0) + (walletAgg.cover_total || 0) + (ticketAgg.total || 0),
    totalCoverCharge: walletAgg.cover_total || 0,
    amountIssued,
    topUpsPreload: 0,
    totalRedeems,
    leftOver: Math.max(0, amountIssued - totalRedeems),
    editedAmount,
    paymentBreakdown,
  };
}

// ─── transaction feed ──────────────────────────────────────────────────────

/**
 * Flat feed of every issue / redeem / ticket event in a range.
 * Defaults to lifetime when from/to are omitted. Filter + search applied here.
 */
function listTransactionFeed(filters: AnalyticsFilters): AnalyticsTxnRow[] {
  const db = getDb();
  const limit = Math.min(5000, Math.max(50, filters.limit ?? 1000));
  const inRange = filters.from !== undefined && filters.to !== undefined;

  const rows: AnalyticsTxnRow[] = [];

  // Issues (wallet issuances)
  const issueWhere = inRange ? 'WHERE w.issued_at >= ? AND w.issued_at < ?' : '';
  const issueParams = inRange ? [filters.from!, filters.to!, limit] : [limit];
  const issues = db.prepare(`
    SELECT w.txn_id, w.cover_issued, w.entry_fee, w.payment_method, w.issued_by, w.issued_at,
           g.name AS customer_name, g.phone AS customer_phone
    FROM wallets w
    LEFT JOIN guests g ON g.id = w.guest_id
    ${issueWhere}
    ORDER BY w.issued_at DESC
    LIMIT ?
  `).all(...issueParams) as Array<{
    txn_id: string; cover_issued: number; entry_fee: number;
    payment_method: PaymentMethod; issued_by: string | null; issued_at: number;
    customer_name: string | null; customer_phone: string | null;
  }>;

  for (const w of issues) {
    rows.push({
      id: `issue:${w.txn_id}`,
      invoice_no: w.txn_id,
      customer_name: w.customer_name || '—',
      customer_phone: w.customer_phone || '—',
      amount: (w.entry_fee || 0) + (w.cover_issued || 0),
      timestamp: w.issued_at,
      kind: 'Issue',
      payment_mode: (w.payment_method || '—').toUpperCase(),
      employee_name: w.issued_by || '—',
      entity_ref: w.txn_id,
      entity_type: 'wallet',
    });
  }

  // Redemptions
  const redeemWhere = inRange
    ? "WHERE r.created_at >= ? AND r.created_at < ? AND r.status = 'success'"
    : "WHERE r.status = 'success'";
  const redeemParams = inRange ? [filters.from!, filters.to!, limit] : [limit];
  const redeems = db.prepare(`
    SELECT r.id, r.invoice_no, r.amount, r.captain, r.created_at, r.txn_id,
           w.payment_method,
           g.name AS customer_name, g.phone AS customer_phone
    FROM redemptions r
    LEFT JOIN wallets w ON w.txn_id = r.txn_id
    LEFT JOIN guests g ON g.id = w.guest_id
    ${redeemWhere}
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(...redeemParams) as Array<{
    id: string; invoice_no: string | null; amount: number; captain: string; created_at: number;
    txn_id: string; payment_method: PaymentMethod | null;
    customer_name: string | null; customer_phone: string | null;
  }>;

  for (const r of redeems) {
    rows.push({
      id: `redeem:${r.id}`,
      invoice_no: r.invoice_no ?? `FB${r.id.slice(-6)}`,
      customer_name: r.customer_name || '—',
      customer_phone: r.customer_phone || '—',
      amount: r.amount,
      timestamp: r.created_at,
      kind: 'Redeem',
      payment_mode: (r.payment_method || 'WALLET').toUpperCase(),
      employee_name: r.captain || '—',
      entity_ref: r.id,
      entity_type: 'redemption',
    });
  }

  // Tickets (Ticket-Amount stream)
  const ticketWhere = inRange
    ? "WHERE t.created_at >= ? AND t.created_at < ? AND t.status = 'issued'"
    : "WHERE t.status = 'issued'";
  const ticketParams = inRange ? [filters.from!, filters.to!, limit] : [limit];
  const tickets = db.prepare(`
    SELECT t.id, t.customer_name, t.customer_phone, t.price, t.created_at, t.created_by,
           t.complimentary, t.ticket_name
    FROM tickets t
    ${ticketWhere}
    ORDER BY t.created_at DESC
    LIMIT ?
  `).all(...ticketParams) as Array<{
    id: string; customer_name: string; customer_phone: string; price: number;
    created_at: number; created_by: string | null; complimentary: number; ticket_name: string;
  }>;

  for (const t of tickets) {
    rows.push({
      id: `ticket:${t.id}`,
      invoice_no: t.id,
      customer_name: t.customer_name || '—',
      customer_phone: t.customer_phone || '—',
      amount: t.price || 0,
      timestamp: t.created_at,
      kind: 'Ticket',
      payment_mode: t.complimentary ? 'COMP' : 'TICKET',
      employee_name: t.created_by || '—',
      entity_ref: t.id,
      entity_type: 'ticket',
    });
  }

  // Filter + sort
  let filtered = rows;
  if (filters.employee && filters.employee !== 'all') {
    filtered = filtered.filter((r) => r.employee_name === filters.employee);
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter((r) =>
      r.invoice_no.toLowerCase().includes(q) ||
      r.customer_name.toLowerCase().includes(q) ||
      r.customer_phone.toLowerCase().includes(q) ||
      String(r.amount).includes(q),
    );
  }
  filtered.sort((a, b) => b.timestamp - a.timestamp);
  return filtered;
}

// ─── public entry point ────────────────────────────────────────────────────

export function computeAnalytics(filters: AnalyticsFilters = {}): AnalyticsResult {
  sweepExpired();
  const now = Date.now();
  // Resolve range — default to today's shift (5 AM IST today → 5 AM IST tomorrow).
  // Cashier already encodes this; we duplicate the simple version here to avoid
  // pulling cashier's IST math into analytics. UI passes explicit values normally.
  const rangeFrom = filters.from ?? (now - 24 * 60 * 60 * 1000);
  const rangeTo = filters.to ?? now + 1000;

  const lifetime = computeKpis(undefined, undefined);
  const range = computeKpis(rangeFrom, rangeTo);
  const transactions = listTransactionFeed({
    from: rangeFrom,
    to: rangeTo,
    search: filters.search,
    employee: filters.employee,
    limit: filters.limit,
  });

  // Distinct employees across both wallets and redemptions and tickets
  const db = getDb();
  const employeeRows = db.prepare(`
    SELECT name FROM (
      SELECT DISTINCT issued_by AS name FROM wallets WHERE issued_by IS NOT NULL AND issued_by != ''
      UNION
      SELECT DISTINCT captain  AS name FROM redemptions WHERE captain IS NOT NULL AND captain != ''
      UNION
      SELECT DISTINCT created_by AS name FROM tickets WHERE created_by IS NOT NULL AND created_by != ''
    ) ORDER BY name ASC
  `).all() as { name: string }[];
  const employees = employeeRows.map((r) => r.name);

  return { lifetime, range, transactions, employees, rangeFrom, rangeTo };
}
