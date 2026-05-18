/**
 * Cashier persistence layer.
 *
 * The Cashier flow extends each redemption with a settlement state:
 *   • settled (0 / 1)
 *   • settled_by (cashier's display name)
 *   • settled_at (UTC ms)
 *   • invoice_no (FB{rowid} — matches the screenshot's FB107 format)
 *
 * The cashier sees redemptions in two tabs: non-settled (work to do) and
 * settled (audit). Clicking "Settle" stamps their name + timestamp; "Unsettle"
 * reverses, with a full audit trail in audit_log.
 */
import { getDb } from './db';
import { logAudit } from './audit';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// ─── Row + view types ──────────────────────────────────────────────────────

export interface CashierTxnRow {
  id: string;
  invoice_no: string;
  txn_id: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  captain: string;
  order_ref: string | null;
  notes: string | null;
  status: 'success' | 'reversed';   // redemption status (engine)
  created_at: number;

  // settlement
  settled: boolean;
  settled_by: string | null;
  settled_at: number | null;

  // joined customer info (from wallets + guests)
  customer_name: string;
  customer_phone: string;
  cover_issued: number;
}

export interface CashierTotals {
  unsettled_amount: number;
  settled_amount: number;
  total_incoming: number;     // sum of entry_fee from wallets issued in range
  total_cover_charge: number; // sum of cover_issued from wallets issued in range
  txn_count: number;
}

// ─── Date range helpers ────────────────────────────────────────────────────

/**
 * The default "shift window" for a nightlife venue: today 5 AM IST → tomorrow 5 AM IST.
 * Captures all the previous night's redemptions in one report.
 */
export function defaultShiftRange(now = new Date()): { from: number; to: number } {
  const istHour = parseInt(
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).format(now),
    10,
  );
  // If it's before 5 AM IST we're still in last night's shift; otherwise we're in today's.
  const baseDate = new Date(now);
  if (istHour < 5) baseDate.setUTCDate(baseDate.getUTCDate() - 1);

  const istParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(baseDate);
  const get = (t: string) => Number(istParts.find((p) => p.type === t)!.value);
  const y = get('year'); const m = get('month'); const d = get('day');

  // 5 AM IST on (y-m-d) = 5 - 5.5 = -0.5 UTC → 23:30 prev-day UTC
  const fromUtcAsIfLocal = Date.UTC(y, m - 1, d, 5, 0, 0);
  const from = fromUtcAsIfLocal - IST_OFFSET_MS;
  const to = from + 24 * 60 * 60 * 1000;
  return { from, to };
}

export function formatShiftRange(from: number, to: number): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  return `${fmt(from)} – ${fmt(to)}`;
}

// ─── Invoice number lazy-backfill ──────────────────────────────────────────

/**
 * Backfill any redemptions in range that don't have an invoice_no yet.
 * Uses rowid so the number is stable and monotonic.
 */
function backfillInvoiceNumbers(from: number, to: number) {
  const db = getDb();
  db.exec(`
    UPDATE redemptions
    SET invoice_no = 'FB' || rowid
    WHERE invoice_no IS NULL
      AND created_at >= ${from}
      AND created_at < ${to}
  `);
}

// ─── Query ─────────────────────────────────────────────────────────────────

export interface CashierFilters {
  from: number;             // UTC ms inclusive
  to: number;               // UTC ms exclusive
  settled?: boolean;        // omit = both
  search?: string;          // matches invoice_no, customer_name, customer_phone, amount, order_ref
  captain?: string;         // exact match
}

export function listCashierTransactions(filters: CashierFilters): CashierTxnRow[] {
  backfillInvoiceNumbers(filters.from, filters.to);
  const db = getDb();
  const where: string[] = ['r.created_at >= ?', 'r.created_at < ?', "r.status = 'success'"];
  const params: (string | number)[] = [filters.from, filters.to];

  if (filters.settled !== undefined) {
    where.push(filters.settled ? 'r.settled = 1' : '(r.settled IS NULL OR r.settled = 0)');
  }
  if (filters.captain && filters.captain !== 'all') {
    where.push('r.captain = ?'); params.push(filters.captain);
  }
  if (filters.search) {
    const s = `%${filters.search.trim()}%`;
    where.push(`(
      r.invoice_no LIKE ?
      OR g.name LIKE ?
      OR g.phone LIKE ?
      OR CAST(r.amount AS TEXT) LIKE ?
      OR r.order_ref LIKE ?
    )`);
    params.push(s, s, s, s, s);
  }

  const rows = db.prepare(`
    SELECT
      r.id, r.invoice_no, r.txn_id, r.amount, r.balance_before, r.balance_after,
      r.captain, r.order_ref, r.notes, r.status, r.created_at,
      r.settled, r.settled_by, r.settled_at,
      g.name  AS customer_name,
      g.phone AS customer_phone,
      w.cover_issued AS cover_issued
    FROM redemptions r
    LEFT JOIN wallets w ON w.txn_id = r.txn_id
    LEFT JOIN guests  g ON g.id     = w.guest_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC
  `).all(...params) as Array<Omit<CashierTxnRow, 'settled'> & { settled: number | null }>;

  return rows.map((row) => ({
    ...row,
    invoice_no: row.invoice_no ?? `FB${row.id.slice(-6)}`,
    customer_name: row.customer_name ?? '—',
    customer_phone: row.customer_phone ?? '—',
    cover_issued: row.cover_issued ?? 0,
    settled: !!row.settled,
  }));
}

export function getCashierTotals(filters: { from: number; to: number; captain?: string }): CashierTotals {
  const db = getDb();
  const where: string[] = ['r.created_at >= ?', 'r.created_at < ?', "r.status = 'success'"];
  const params: (string | number)[] = [filters.from, filters.to];
  if (filters.captain && filters.captain !== 'all') {
    where.push('r.captain = ?'); params.push(filters.captain);
  }

  const agg = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN r.settled = 1 THEN r.amount ELSE 0 END), 0) AS settled_amount,
      COALESCE(SUM(CASE WHEN r.settled = 1 THEN 0 ELSE r.amount END), 0) AS unsettled_amount,
      COUNT(*) AS txn_count
    FROM redemptions r
    WHERE ${where.join(' AND ')}
  `).get(...params) as { settled_amount: number; unsettled_amount: number; txn_count: number };

  // Total incoming + cover charges from wallets ISSUED in range (independent of redemption settlement)
  const incoming = db.prepare(`
    SELECT
      COALESCE(SUM(entry_fee), 0)   AS total_incoming,
      COALESCE(SUM(cover_issued), 0) AS total_cover
    FROM wallets
    WHERE issued_at >= ? AND issued_at < ?
  `).get(filters.from, filters.to) as { total_incoming: number; total_cover: number };

  return {
    settled_amount: agg.settled_amount,
    unsettled_amount: agg.unsettled_amount,
    txn_count: agg.txn_count,
    total_incoming: incoming.total_incoming,
    total_cover_charge: incoming.total_cover,
  };
}

export function listCaptainsInRange(from: number, to: number): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT captain FROM redemptions
    WHERE created_at >= ? AND created_at < ? AND captain IS NOT NULL AND captain != ''
    ORDER BY captain ASC
  `).all(from, to) as { captain: string }[];
  return rows.map((r) => r.captain);
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export function settleRedemption(id: string, cashierName: string): CashierTxnRow | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM redemptions WHERE id = ?').get(id) as { id: string; settled: number | null } | undefined;
  if (!existing) return null;
  if (existing.settled) {
    // idempotent — just return the current state
    return readOne(id);
  }
  const now = Date.now();
  // Ensure invoice number exists
  db.prepare(`UPDATE redemptions SET invoice_no = COALESCE(invoice_no, 'FB' || rowid) WHERE id = ?`).run(id);
  db.prepare(`UPDATE redemptions SET settled = 1, settled_by = ?, settled_at = ? WHERE id = ?`).run(cashierName, now, id);
  logAudit({
    actor: cashierName, action: 'cashier_settle', entityType: 'redemption', entityId: id,
  });
  return readOne(id);
}

export function unsettleRedemption(id: string, cashierName: string): CashierTxnRow | null {
  const db = getDb();
  const existing = db.prepare('SELECT settled FROM redemptions WHERE id = ?').get(id) as { settled: number | null } | undefined;
  if (!existing) return null;
  if (!existing.settled) return readOne(id);
  db.prepare(`UPDATE redemptions SET settled = 0, settled_by = NULL, settled_at = NULL WHERE id = ?`).run(id);
  logAudit({
    actor: cashierName, action: 'cashier_unsettle', entityType: 'redemption', entityId: id,
  });
  return readOne(id);
}

function readOne(id: string): CashierTxnRow | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT r.id, r.invoice_no, r.txn_id, r.amount, r.balance_before, r.balance_after,
           r.captain, r.order_ref, r.notes, r.status, r.created_at,
           r.settled, r.settled_by, r.settled_at,
           g.name AS customer_name, g.phone AS customer_phone, w.cover_issued
    FROM redemptions r
    LEFT JOIN wallets w ON w.txn_id = r.txn_id
    LEFT JOIN guests  g ON g.id     = w.guest_id
    WHERE r.id = ?
  `).get(id) as (Omit<CashierTxnRow, 'settled'> & { settled: number | null }) | undefined;
  if (!row) return null;
  return {
    ...row,
    invoice_no: row.invoice_no ?? `FB${row.id.slice(-6)}`,
    customer_name: row.customer_name ?? '—',
    customer_phone: row.customer_phone ?? '—',
    cover_issued: row.cover_issued ?? 0,
    settled: !!row.settled,
  };
}

// ─── CSV export ────────────────────────────────────────────────────────────

export function toCsv(rows: CashierTxnRow[]): string {
  const head = [
    'Invoice No', 'Amount', 'Redeem By', 'Customer Name', 'Customer Number',
    'Date & Time', 'Type', 'Status', 'Settled By', 'Settled At', 'Wallet Txn',
    'Order Ref', 'Notes',
  ];
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmtDate = (ms: number) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      r.invoice_no,
      r.amount,
      r.captain,
      r.customer_name,
      r.customer_phone,
      fmtDate(r.created_at),
      'Redeemed',
      r.settled ? 'Settled' : 'Unsettled',
      r.settled_by ?? '',
      r.settled_at ? fmtDate(r.settled_at) : '',
      r.txn_id,
      r.order_ref ?? '',
      r.notes ?? '',
    ].map(esc).join(','));
  }
  return lines.join('\n');
}
