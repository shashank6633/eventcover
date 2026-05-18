/**
 * Transaction register — the source of truth for the History page.
 *
 * Unions two streams into one ledger so an operator can see every entry &
 * cover-charge movement in date order:
 *
 *   1. Wallet issuances  — money IN at the door  (Transaction = "Entry & Cover")
 *   2. Redemptions       — cover spent at bar    (Transaction = "Cover Redemption")
 *
 * Each row carries the current status (Active / Voided / Expired / Exhausted /
 * Pending / Settled / Reversed) so an "alteration" — voiding a cover, reversing
 * a redemption, auto-expiry — surfaces immediately without needing a separate
 * row. The audit_log still records the *who/when* of every state change
 * (queryable via /api/history when needed for forensic detail).
 */
import { getDb } from './db';

export type TxnKind = 'entry' | 'redemption';

export type TxnStatus =
  | 'Active'      // wallet still has balance
  | 'Exhausted'   // wallet fully redeemed
  | 'Expired'     // wallet hit expires_at
  | 'Voided'      // admin force-voided the wallet (refund)
  | 'Pending'     // redemption not yet settled by cashier
  | 'Settled'     // redemption settled
  | 'Reversed';   // redemption was reversed

export interface TransactionRow {
  /** Stable row id used for the Action column. */
  id: string;
  /** 'entry' = wallet issuance row, 'redemption' = bar redemption row. */
  kind: TxnKind;
  /** Customer-facing receipt number. Wallets use txn_id; redemptions use FB{rowid}. */
  invoice_no: string;
  /** ₹ amount for the transaction. */
  amount: number;
  /** Staff who handled it — issuer at the door for entries, captain at bar for redemptions. */
  redeemed_by: string;
  /** Joined customer info from guests table. */
  customer_name: string;
  customer_phone: string;
  /** Transaction timestamp (UTC ms). */
  created_at: number;
  /** Display label for the Transaction column. */
  transaction_type: string;
  /** Current state — drives the Status pill and the available Actions. */
  status: TxnStatus;
  /** Wallet txn_id this row belongs to. Lets the UI pivot to the full lifecycle. */
  wallet_txn_id: string;
  /** Extra context the UI may want — payment method, balance, etc. */
  payment_method?: string;
  balance?: number;
  cover_issued?: number;
  expires_at?: number | null;
  /** Settlement metadata (only for redemption rows). */
  settled_by?: string | null;
  settled_at?: number | null;
}

export interface TransactionFilters {
  /** Inclusive UTC ms — defaults to last 7 days at the API layer. */
  from: number;
  /** Exclusive UTC ms. */
  to: number;
  /** Limit to a single kind. Omit = both. */
  kind?: TxnKind;
  /** Captain name (matches `redeemed_by`). 'all' or omit = no filter. */
  redeemedBy?: string;
  /** Free-text search across invoice / customer / phone / staff. */
  search?: string;
  /** Hard cap for safety. Defaults applied at API layer. */
  limit?: number;
}

export interface TransactionListResult {
  rows: TransactionRow[];
  /** Distinct staff names in the period — used for the "Redeem By" dropdown. */
  staff: string[];
  /** Roll-ups for the page header strip. */
  totals: {
    entries_count: number;
    entries_amount: number;
    redemptions_count: number;
    redemptions_amount: number;
    settled_amount: number;
    pending_amount: number;
    voided_count: number;
    reversed_count: number;
  };
}

/**
 * Make sure every redemption in the period has an invoice_no stamped on it.
 * Identical pattern to cashier.ts — the FB prefix + rowid gives a stable,
 * monotonic invoice number that won't shift if rows are added.
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

function mapWalletStatus(s: string): TxnStatus {
  // Wallet voids go through voidWallet() which marks status='exhausted' AND
  // emits a wallet_void audit row. We treat 'exhausted with cover_issued > 0
  // and zero redemptions' as not-quite-voided; the source of truth for "Voided"
  // is the audit log lookup below.
  switch (s) {
    case 'active':    return 'Active';
    case 'exhausted': return 'Exhausted';
    case 'expired':   return 'Expired';
    default:          return 'Active';
  }
}

/**
 * Inspect audit_log to flip the wallet status to 'Voided' when a wallet_void
 * event exists for the txn_id. Done as a separate pass so the main UNION
 * stays a single, fast SQL query.
 */
function loadVoidedTxnIds(from: number, to: number): Set<string> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT entity_id
    FROM audit_log
    WHERE action = 'wallet_void'
      AND entity_type = 'wallet'
      AND timestamp >= ?
      AND timestamp <= ?
      AND entity_id IS NOT NULL
  `).all(from, to) as { entity_id: string }[];
  return new Set(rows.map((r) => r.entity_id));
}

function mapRedemptionStatus(status: string, settled: number | null): TxnStatus {
  if (status === 'reversed') return 'Reversed';
  return settled ? 'Settled' : 'Pending';
}

export function listTransactions(filters: TransactionFilters): TransactionListResult {
  backfillInvoiceNumbers(filters.from, filters.to);
  const db = getDb();
  const limit = Math.min(5000, Math.max(50, filters.limit ?? 1000));

  // ─── Entries (wallet issuances) ────────────────────────────────────────
  const entryRows = filters.kind === 'redemption'
    ? []
    : db.prepare(`
        SELECT
          w.txn_id, w.cover_issued, w.entry_fee, w.balance, w.payment_method,
          w.status, w.issued_by, w.issued_at, w.expires_at,
          g.name AS customer_name, g.phone AS customer_phone
        FROM wallets w
        LEFT JOIN guests g ON g.id = w.guest_id
        WHERE w.issued_at >= ? AND w.issued_at < ?
        ORDER BY w.issued_at DESC
        LIMIT ?
      `).all(filters.from, filters.to, limit) as Array<{
        txn_id: string; cover_issued: number; entry_fee: number; balance: number;
        payment_method: string; status: string; issued_by: string | null; issued_at: number;
        expires_at: number | null;
        customer_name: string | null; customer_phone: string | null;
      }>;

  // ─── Redemptions (cover spent at bar) ──────────────────────────────────
  const redemptionRows = filters.kind === 'entry'
    ? []
    : db.prepare(`
        SELECT
          r.id, r.invoice_no, r.amount, r.captain, r.status, r.created_at,
          r.settled, r.settled_by, r.settled_at, r.txn_id,
          w.cover_issued, w.expires_at,
          g.name AS customer_name, g.phone AS customer_phone
        FROM redemptions r
        LEFT JOIN wallets w ON w.txn_id = r.txn_id
        LEFT JOIN guests  g ON g.id     = w.guest_id
        WHERE r.created_at >= ? AND r.created_at < ?
        ORDER BY r.created_at DESC
        LIMIT ?
      `).all(filters.from, filters.to, limit) as Array<{
        id: string; invoice_no: string | null; amount: number; captain: string;
        status: string; created_at: number;
        settled: number | null; settled_by: string | null; settled_at: number | null;
        txn_id: string; cover_issued: number | null; expires_at: number | null;
        customer_name: string | null; customer_phone: string | null;
      }>;

  const voided = loadVoidedTxnIds(filters.from, filters.to);

  // ─── Project into TransactionRow ───────────────────────────────────────
  const rows: TransactionRow[] = [];

  for (const w of entryRows) {
    const status = voided.has(w.txn_id) ? 'Voided' : mapWalletStatus(w.status);
    rows.push({
      id: `entry:${w.txn_id}`,
      kind: 'entry',
      invoice_no: w.txn_id,
      amount: w.cover_issued,
      redeemed_by: w.issued_by || '—',
      customer_name: w.customer_name || '—',
      customer_phone: w.customer_phone || '—',
      created_at: w.issued_at,
      transaction_type: 'Entry & Cover',
      status,
      wallet_txn_id: w.txn_id,
      payment_method: w.payment_method,
      balance: w.balance,
      cover_issued: w.cover_issued,
      expires_at: w.expires_at,
    });
  }

  for (const r of redemptionRows) {
    rows.push({
      id: `redeem:${r.id}`,
      kind: 'redemption',
      invoice_no: r.invoice_no ?? `FB${r.id.slice(-6)}`,
      amount: r.amount,
      redeemed_by: r.captain,
      customer_name: r.customer_name || '—',
      customer_phone: r.customer_phone || '—',
      created_at: r.created_at,
      transaction_type: 'Cover Redemption',
      status: mapRedemptionStatus(r.status, r.settled),
      wallet_txn_id: r.txn_id,
      cover_issued: r.cover_issued ?? 0,
      expires_at: r.expires_at,
      settled_by: r.settled_by,
      settled_at: r.settled_at,
    });
  }

  // ─── Filters applied in JS so the SQL stays simple ─────────────────────
  let filtered = rows;
  if (filters.redeemedBy && filters.redeemedBy !== 'all') {
    filtered = filtered.filter((r) => r.redeemed_by === filters.redeemedBy);
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter((r) =>
      r.invoice_no.toLowerCase().includes(q) ||
      r.customer_name.toLowerCase().includes(q) ||
      r.customer_phone.toLowerCase().includes(q) ||
      r.redeemed_by.toLowerCase().includes(q) ||
      r.wallet_txn_id.toLowerCase().includes(q) ||
      String(r.amount).includes(q),
    );
  }

  // Sort: newest first
  filtered.sort((a, b) => b.created_at - a.created_at);

  // ─── Totals ────────────────────────────────────────────────────────────
  const totals = {
    entries_count: 0, entries_amount: 0,
    redemptions_count: 0, redemptions_amount: 0,
    settled_amount: 0, pending_amount: 0,
    voided_count: 0, reversed_count: 0,
  };
  for (const r of filtered) {
    if (r.kind === 'entry') {
      totals.entries_count++;
      totals.entries_amount += r.amount;
      if (r.status === 'Voided') totals.voided_count++;
    } else {
      totals.redemptions_count++;
      totals.redemptions_amount += r.amount;
      if (r.status === 'Settled')  totals.settled_amount += r.amount;
      if (r.status === 'Pending')  totals.pending_amount += r.amount;
      if (r.status === 'Reversed') totals.reversed_count++;
    }
  }

  // ─── Distinct staff list (across both streams) ─────────────────────────
  const staffSet = new Set<string>();
  for (const r of rows) if (r.redeemed_by && r.redeemed_by !== '—') staffSet.add(r.redeemed_by);
  const staff = Array.from(staffSet).sort();

  return { rows: filtered, staff, totals };
}

/**
 * CSV export — matches the column order the operator sees on screen.
 */
export function transactionsToCsv(rows: TransactionRow[]): string {
  const head = [
    'Invoice No', 'Amount', 'Redeem By', 'Customer Name', 'Customer Mobile',
    'Date & Time', 'Transaction', 'Status', 'Wallet Txn', 'Settled By', 'Settled At',
  ];
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmtDate = (ms: number) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      r.invoice_no, r.amount, r.redeemed_by, r.customer_name, r.customer_phone,
      fmtDate(r.created_at), r.transaction_type, r.status, r.wallet_txn_id,
      r.settled_by ?? '', r.settled_at ? fmtDate(r.settled_at) : '',
    ].map(esc).join(','));
  }
  return lines.join('\n');
}
