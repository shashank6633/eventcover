'use client';

/**
 * ReservationSummaryCard — the single source of truth for how a reservation
 * (with its multi-stage check-in + cover-ledger state) is summarised on the
 * floor. Reused by:
 *   • /admin/scan          — captain + entry post-scan view
 *   • /admin/checkin       — entry-staff post-scan view
 *   • /admin/reservations/[id]/history — manager/host audit view
 *
 * The component is intentionally dumb: it renders whatever the server sends.
 * All status derivation, role gating, and action wiring is the parent's job.
 * That keeps it safe to drop into print previews + read-only history views
 * without leaking action buttons that the viewer can't actually use.
 */

import type { ReactNode } from 'react';

// ─── Types (shape returned by /api/reservations/[id]/ledger and /api/scan) ──

export type ReservationLedgerStatus =
  | 'pending'
  | 'partially_checked_in'
  | 'fully_checked_in'
  | 'closed';

export type CoverStatus =
  | 'not_redeemed'
  | 'partially_redeemed'
  | 'fully_redeemed';

export interface ReservationLedger {
  reservation_id: string;
  /** Short display code, e.g. "RES-CN3T". May be the same as reservation_id for old rows. */
  display_code?: string;
  guest_name: string;
  guest_phone?: string | null;
  event_name?: string | null;
  event_date?: string | null;
  total_pax: number;
  checked_in_pax: number;
  remaining_pax: number;
  entry_amount: number;
  cover_amount: number;
  cover_redeemed: number;
  cover_balance: number;
  reservation_status: ReservationLedgerStatus;
  cover_status: CoverStatus;
}

interface Props {
  ledger: ReservationLedger;
  /** Slot for role-gated action buttons. Parent renders the right set per role. */
  actions?: ReactNode;
  /** When true, hide the header chrome and just show the body. Used inside modals. */
  bare?: boolean;
}

export function ReservationSummaryCard({ ledger, actions, bare }: Props) {
  const code = ledger.display_code || shortCode(ledger.reservation_id);

  return (
    <div className={bare ? '' : 'card mt-5 space-y-4'}>
      {/* Header — reservation code + guest identity */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] tracking-widest uppercase text-slate-500">Reservation</div>
          <div className="font-mono text-sm font-semibold text-slate-900">{code}</div>
          <div className="text-base font-semibold text-slate-900 mt-1.5 truncate">
            {ledger.guest_name || 'Unknown guest'}
          </div>
          {ledger.guest_phone && (
            <div className="text-xs text-slate-500 font-mono mt-0.5">
              +91 {ledger.guest_phone.replace(/^\+?91/, '')}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StatusPill kind="reservation" status={ledger.reservation_status} />
          <StatusPill kind="cover" status={ledger.cover_status} />
        </div>
      </div>

      {/* Event line — only shown when we have something */}
      {(ledger.event_name || ledger.event_date) && (
        <div className="text-xs text-slate-500 border-t border-slate-100 pt-3">
          {ledger.event_name && <span className="font-medium text-slate-700">{ledger.event_name}</span>}
          {ledger.event_name && ledger.event_date && <span className="mx-1.5">•</span>}
          {ledger.event_date && <span>{formatDate(ledger.event_date)}</span>}
        </div>
      )}

      {/* PAX stats — 3 blocks */}
      <div>
        <div className="text-[10px] tracking-widest uppercase text-slate-500 mb-1.5">Guests</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Total" value={ledger.total_pax} />
          <Stat label="Checked-In" value={ledger.checked_in_pax} tone="emerald" />
          <Stat label="Remaining" value={ledger.remaining_pax} tone="amber" />
        </div>
      </div>

      {/* Cover stats — 3 blocks */}
      <div>
        <div className="text-[10px] tracking-widest uppercase text-slate-500 mb-1.5">Cover Charge</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Charge" value={`₹${formatINR(ledger.cover_amount)}`} />
          <Stat label="Redeemed" value={`₹${formatINR(ledger.cover_redeemed)}`} tone="amber" />
          <Stat label="Balance" value={`₹${formatINR(ledger.cover_balance)}`} tone="brand" />
        </div>
        {ledger.entry_amount > 0 && (
          <div className="text-[11px] text-slate-500 mt-2">
            Entry charge (non-refundable): ₹{formatINR(ledger.entry_amount)}
          </div>
        )}
      </div>

      {actions && <div className="pt-1">{actions}</div>}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function StatusPill({
  kind,
  status,
}: {
  kind: 'reservation' | 'cover';
  status: ReservationLedgerStatus | CoverStatus;
}) {
  const cfg = pillStyle(kind, status);
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border font-medium ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

function pillStyle(
  kind: 'reservation' | 'cover',
  status: ReservationLedgerStatus | CoverStatus,
): { label: string; cls: string } {
  if (kind === 'reservation') {
    switch (status as ReservationLedgerStatus) {
      case 'pending':
        return { label: 'Pending', cls: 'text-slate-600 border-slate-200 bg-slate-50' };
      case 'partially_checked_in':
        return { label: 'Partial entry', cls: 'text-amber-700 border-amber-200 bg-amber-50' };
      case 'fully_checked_in':
        return { label: 'All in', cls: 'text-emerald-700 border-emerald-200 bg-emerald-50' };
      case 'closed':
        return { label: 'Closed', cls: 'text-rose-700 border-rose-200 bg-rose-50' };
    }
  } else {
    switch (status as CoverStatus) {
      case 'not_redeemed':
        return { label: 'Cover unused', cls: 'text-slate-600 border-slate-200 bg-slate-50' };
      case 'partially_redeemed':
        return { label: 'Cover partial', cls: 'text-amber-700 border-amber-200 bg-amber-50' };
      case 'fully_redeemed':
        return { label: 'Cover used', cls: 'text-emerald-700 border-emerald-200 bg-emerald-50' };
    }
  }
  // Defensive — should never hit, but keeps TS happy without an explicit `never`.
  return { label: String(status), cls: 'text-slate-600 border-slate-200 bg-slate-50' };
}

function Stat({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number | string;
  tone?: 'slate' | 'emerald' | 'amber' | 'brand';
}) {
  const valueCls =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'brand'
          ? 'text-brand-600'
          : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 min-w-0">
      <div className="text-[9px] uppercase tracking-widest text-slate-500 truncate">{label}</div>
      <div className={`text-lg font-bold mt-0.5 truncate ${valueCls}`}>{value}</div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function shortCode(id: string): string {
  // Fallback when the server didn't provide display_code: take the last 4 chars
  // of the id and prefix RES- so the cashier has something readable.
  const tail = (id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return tail ? `RES-${tail}` : 'RES-—';
}

function formatINR(n: number): string {
  // Reservation amounts are stored as REAL — guard against NaN/undefined.
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatDate(d: string): string {
  // YYYY-MM-DD → "30 May 2026". Bail out gracefully if the server sent a label.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const [y, m, day] = d.split('-').map((s) => Number(s));
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
