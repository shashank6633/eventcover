'use client';

/**
 * Reservation History — manager/host audit view for the shared-QR
 * check-in + cover-redemption ledger.
 *
 * Loads the live ledger via /api/reservations/[id]/ledger and renders:
 *   • A ReservationSummaryCard with the current snapshot
 *   • Two timeline columns (check-ins | redemptions)
 *   • A manager-only Reverse action on each row that goes back to
 *     /api/reservations/[id]/checkins/[checkinId]/reverse
 *     or /api/reservations/[id]/redemptions/[redemptionId]/reverse
 *
 * Reversed rows render struck-through + grey so the audit trail is
 * preserved (we don't delete on reverse, we mark + log).
 *
 * Role gate: only host + manager can land here. The page server-fetches
 * /api/auth/me and bounces non-managers back to /admin/reservations.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ReservationSummaryCard,
  type ReservationLedger,
} from '@/components/ReservationSummaryCard';
import { formatMoney } from '@/lib/format';
import type { UserRole } from '@/lib/roles';

interface CheckinRow {
  id: string;
  reservation_id: string;
  checked_in_pax: number;
  checked_in_by: string;
  notes: string | null;
  status?: string;
  reversed_at: number | null;
  reversed_by: string | null;
  timestamp: number;
  /** Optional snapshot of remaining_pax AFTER this event — server-computed when available. */
  remaining_after?: number | null;
}

interface RedemptionRow {
  id: string;
  reservation_id: string;
  bill_id: string | null;
  redeemed_amount: number;
  redeemed_by: string;
  notes: string | null;
  status: 'success' | 'reversed' | string;
  reversed_at: number | null;
  reversed_by: string | null;
  timestamp: number;
  /** Optional snapshot of cover_balance AFTER this event — server-computed when available. */
  balance_after?: number | null;
}

interface LedgerPayload {
  ledger: ReservationLedger;
  checkins: CheckinRow[];
  redemptions: RedemptionRow[];
}

interface Me {
  id: string;
  name: string;
  role: UserRole;
}

export default function ReservationHistoryPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const reservationId = params?.id ?? '';

  const [me, setMe] = useState<Me | null>(null);
  const [payload, setPayload] = useState<LedgerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Confirm-reverse modal state
  const [reverseTarget, setReverseTarget] = useState<
    | { kind: 'checkin'; row: CheckinRow }
    | { kind: 'redemption'; row: RedemptionRow }
    | null
  >(null);

  // ── Auth + role guard ────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/me')
      .then((r) => (r.status === 401 ? null : r.json()))
      .then((d) => {
        if (!mounted) return;
        if (!d?.ok) {
          router.replace(`/login?next=/admin/reservations/${reservationId}/history`);
          return;
        }
        const role = d.user?.role as UserRole;
        if (role !== 'host' && role !== 'manager') {
          // Non-managers don't see history; bounce them to the list with a hint.
          router.replace('/admin/reservations');
          return;
        }
        setMe({ id: d.user.id, name: d.user.name, role });
      })
      .catch(() => {
        if (mounted) setError('Could not verify your session. Please re-login.');
      });
    return () => {
      mounted = false;
    };
  }, [router, reservationId]);

  // ── Ledger fetch ─────────────────────────────────────────────────────────
  //
  // The server-side history route lives at /api/reservations/[id]/history and
  // returns `{ ok, reservation, checkins, redemptions }` after the contract
  // fix. We accept the older `summary` / `ledger` keys too for forward/back
  // compatibility while both client and server land.
  const loadLedger = useCallback(async () => {
    if (!reservationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reservations/${encodeURIComponent(reservationId)}/history`,
        { cache: 'no-store' },
      );
      if (res.status === 404) {
        setError('Reservation not found.');
        setPayload(null);
        return;
      }
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load ledger.');
        return;
      }
      // Prefer the post-fix `reservation` key. Fall back to legacy keys so
      // this code keeps working if the server lags one deploy behind.
      const ledger: ReservationLedger | null =
        d.reservation ?? d.ledger ?? d.summary ?? null;
      if (!ledger) {
        setError('Server returned an unexpected response shape.');
        return;
      }
      const checkins: CheckinRow[] = Array.isArray(d.checkins) ? d.checkins : [];
      const redemptions: RedemptionRow[] = Array.isArray(d.redemptions)
        ? d.redemptions
        : [];
      setPayload({ ledger, checkins, redemptions });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Network error loading ledger.',
      );
    } finally {
      setLoading(false);
    }
  }, [reservationId]);

  useEffect(() => {
    if (!me) return;
    loadLedger();
  }, [me, loadLedger]);

  // ── Reverse handler ──────────────────────────────────────────────────────
  //
  // Routes after the contract fix:
  //   POST /api/reservations/[id]/reverse-checkin     body { checkinId, reason }
  //   POST /api/reservations/[id]/reverse-redemption  body { redemptionId, reason }
  //
  // The server now requires a non-empty reason; the confirm modal blocks
  // submit when reason is blank, but we double-check here so a stale modal
  // can't slip an empty string through.
  const submitReverse = useCallback(
    async (reason: string) => {
      if (!reverseTarget || !me) return;
      const trimmedReason = reason.trim();
      if (!trimmedReason) {
        setError('Reason is required to reverse this entry.');
        return;
      }
      const path =
        reverseTarget.kind === 'checkin'
          ? `/api/reservations/${encodeURIComponent(reservationId)}/reverse-checkin`
          : `/api/reservations/${encodeURIComponent(reservationId)}/reverse-redemption`;
      const body =
        reverseTarget.kind === 'checkin'
          ? { checkinId: reverseTarget.row.id, reason: trimmedReason }
          : { redemptionId: reverseTarget.row.id, reason: trimmedReason };
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await res.json().catch(() => ({ ok: false }));
        if (!res.ok || !d.ok) {
          setError(d.message || 'Reverse failed.');
          return;
        }
        setNotice(
          reverseTarget.kind === 'checkin'
            ? 'Check-in reversed.'
            : 'Redemption reversed.',
        );
        setReverseTarget(null);
        await loadLedger();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error.');
      }
    },
    [reverseTarget, me, reservationId, loadLedger],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  if (!me) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 text-slate-400">
        Checking permissions…
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="min-w-0">
          <div className="text-[11px] tracking-widest uppercase text-slate-400">
            Reservation audit
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">History</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Immutable log of every door check-in and cover redemption against
            this reservation. Managers can reverse a row — that action is
            recorded too, never silently undone.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/reservations"
            className="btn btn-secondary !py-2 !px-4 text-sm whitespace-nowrap"
          >
            ← All reservations
          </Link>
          <button
            type="button"
            onClick={() => loadLedger()}
            className="btn btn-primary !py-2 !px-4 text-sm whitespace-nowrap"
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 px-3 py-2 text-sm flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-sky-500 hover:text-sky-700"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-500 hover:text-rose-700"
          >
            ✕
          </button>
        </div>
      )}

      {loading && !payload ? (
        <div className="card text-slate-400 text-sm">Loading ledger…</div>
      ) : !payload ? (
        <div className="card text-slate-500 text-sm">
          {error ? 'Could not load this reservation.' : 'No ledger data yet.'}
        </div>
      ) : (
        <>
          <ReservationSummaryCard ledger={payload.ledger} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <CheckinTimeline
              rows={payload.checkins}
              canReverse={me.role === 'host' || me.role === 'manager'}
              onReverseClick={(row) =>
                setReverseTarget({ kind: 'checkin', row })
              }
            />
            <RedemptionTimeline
              rows={payload.redemptions}
              canReverse={me.role === 'host' || me.role === 'manager'}
              onReverseClick={(row) =>
                setReverseTarget({ kind: 'redemption', row })
              }
            />
          </div>
        </>
      )}

      {reverseTarget && (
        <ReverseConfirmModal
          kind={reverseTarget.kind}
          row={reverseTarget.row}
          onCancel={() => setReverseTarget(null)}
          onConfirm={submitReverse}
        />
      )}
    </div>
  );
}

// ─── Check-in timeline ───────────────────────────────────────────────────────

function CheckinTimeline({
  rows,
  canReverse,
  onReverseClick,
}: {
  rows: CheckinRow[];
  canReverse: boolean;
  onReverseClick: (row: CheckinRow) => void;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.timestamp - a.timestamp),
    [rows],
  );

  return (
    <section className="card">
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-900 tracking-wide">
          Check-in history
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-slate-400">
          {sorted.length} event{sorted.length === 1 ? '' : 's'}
        </span>
      </header>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<IconDoor />}
          title="No check-ins yet"
          hint="Entry staff scans the reservation QR at the door to mark guests in."
        />
      ) : (
        <ol className="space-y-2">
          {sorted.map((row) => {
            const reversed = !!row.reversed_at;
            return (
              <li
                key={row.id}
                className={`rounded-xl border p-3 text-sm ${
                  reversed
                    ? 'border-slate-200 bg-slate-50/60 text-slate-400'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div
                      className={`font-semibold ${
                        reversed ? 'line-through' : 'text-slate-900'
                      }`}
                    >
                      +{row.checked_in_pax} guest
                      {row.checked_in_pax === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatTimestamp(row.timestamp)} · by{' '}
                      <span className="font-medium">
                        {row.checked_in_by || 'staff'}
                      </span>
                    </div>
                    {row.remaining_after != null && !reversed && (
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Remaining after: {row.remaining_after}
                      </div>
                    )}
                    {row.notes && (
                      <div className="text-xs italic text-slate-500 mt-1">
                        “{row.notes}”
                      </div>
                    )}
                    {reversed && (
                      <div className="text-[11px] text-rose-600 mt-1">
                        Reversed {formatTimestamp(row.reversed_at!)}
                        {row.reversed_by ? ` by ${row.reversed_by}` : ''}
                      </div>
                    )}
                  </div>
                  {!reversed && canReverse && (
                    <button
                      type="button"
                      onClick={() => onReverseClick(row)}
                      className="text-xs text-rose-600 hover:text-rose-700 font-medium whitespace-nowrap"
                    >
                      Reverse
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ─── Redemption timeline ─────────────────────────────────────────────────────

function RedemptionTimeline({
  rows,
  canReverse,
  onReverseClick,
}: {
  rows: RedemptionRow[];
  canReverse: boolean;
  onReverseClick: (row: RedemptionRow) => void;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.timestamp - a.timestamp),
    [rows],
  );

  return (
    <section className="card">
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-900 tracking-wide">
          Redemption history
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-slate-400">
          {sorted.length} event{sorted.length === 1 ? '' : 's'}
        </span>
      </header>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<IconReceipt />}
          title="No redemptions yet"
          hint="Captains scan the reservation QR to debit cover against a bill."
        />
      ) : (
        <ol className="space-y-2">
          {sorted.map((row) => {
            const reversed = row.status === 'reversed' || !!row.reversed_at;
            return (
              <li
                key={row.id}
                className={`rounded-xl border p-3 text-sm ${
                  reversed
                    ? 'border-slate-200 bg-slate-50/60 text-slate-400'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div
                      className={`font-semibold ${
                        reversed ? 'line-through' : 'text-slate-900'
                      }`}
                    >
                      −{formatMoney(row.redeemed_amount)}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatTimestamp(row.timestamp)} · by{' '}
                      <span className="font-medium">
                        {row.redeemed_by || 'captain'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Bill{' '}
                      {row.bill_id ? (
                        <span className="font-mono text-slate-700">
                          #{row.bill_id}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      {row.balance_after != null && !reversed && (
                        <>
                          {' '}
                          · Balance after {formatMoney(row.balance_after)}
                        </>
                      )}
                    </div>
                    {row.notes && (
                      <div className="text-xs italic text-slate-500 mt-1">
                        “{row.notes}”
                      </div>
                    )}
                    {reversed && (
                      <div className="text-[11px] text-rose-600 mt-1">
                        Reversed
                        {row.reversed_at
                          ? ` ${formatTimestamp(row.reversed_at)}`
                          : ''}
                        {row.reversed_by ? ` by ${row.reversed_by}` : ''}
                      </div>
                    )}
                  </div>
                  {!reversed && canReverse && (
                    <button
                      type="button"
                      onClick={() => onReverseClick(row)}
                      className="text-xs text-rose-600 hover:text-rose-700 font-medium whitespace-nowrap"
                    >
                      Reverse
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ─── Reverse confirm modal ───────────────────────────────────────────────────

function ReverseConfirmModal({
  kind,
  row,
  onCancel,
  onConfirm,
}: {
  kind: 'checkin' | 'redemption';
  row: CheckinRow | RedemptionRow;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const headline =
    kind === 'checkin'
      ? `Reverse +${(row as CheckinRow).checked_in_pax} check-in?`
      : `Reverse −${formatMoney((row as RedemptionRow).redeemed_amount)} redemption?`;

  const body =
    kind === 'checkin'
      ? "The reservation's checked-in pax counter will decrement and reservation status will recompute."
      : "The reservation's cover_redeemed counter will decrement and the bill ID becomes re-billable.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900">{headline}</h3>
            <p className="text-xs text-slate-500 mt-1">{body}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 flex-shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <label className="label">
          Reason (recorded in audit log) <span className="text-rose-600">*</span>
        </label>
        <textarea
          className="input min-h-[80px]"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. wrong reservation scanned, bill voided, accidental double-tap"
          required
          autoFocus
        />
        {!reason.trim() && (
          <div className="text-[11px] text-slate-500 mt-1">
            A non-empty reason is required.
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || !reason.trim()}
            className="btn btn-primary flex-1"
          >
            {busy ? 'Reversing…' : 'Confirm reverse'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn btn-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center text-center py-6 text-slate-400">
      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-2">
        {icon}
      </div>
      <div className="text-sm font-medium text-slate-600">{title}</div>
      <div className="text-xs mt-1 max-w-xs">{hint}</div>
    </div>
  );
}

function formatTimestamp(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function IconDoor() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-slate-400"
    >
      <path d="M4 22V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v18" />
      <path d="M2 22h20" />
      <path d="M14 12v.01" />
    </svg>
  );
}

function IconReceipt() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-slate-400"
    >
      <path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2V2z" />
      <path d="M8 7h8M8 11h8M8 15h6" />
    </svg>
  );
}
