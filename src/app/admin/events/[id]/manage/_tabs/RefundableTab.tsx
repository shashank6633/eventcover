'use client';

/**
 * Refundable Entries Tab — bookings whose payment expired OR inventory ran out.
 *
 * Source: derived view over payments + reservations (no new table). Backed by
 *   GET  /api/events/[id]/manage/refundable
 *   POST /api/events/[id]/manage/refundable/[reservationId]/accommodate
 *   POST /api/events/[id]/manage/refundable/[reservationId]/resend
 *
 * Two actions per row:
 *   • Accommodate — issues a free comp wallet and converts the reservation
 *   • Resend     — re-sends ticket / invoice WhatsApp
 *
 * Style cribs from /admin/abandoned-bookings (KPI strip absent per spec,
 * but the table/row pill/action button styling matches so the host's eye
 * doesn't have to re-learn the layout).
 */

import { useCallback, useEffect, useState } from 'react';

interface RefundableItem {
  id: string;
  reservationId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  amount: number;
  kind: 'payment_failed' | 'no_show_paid';
  reason: string | null;
  lastPaymentStatus: string | null;
  abandonedAt: number;
}

interface Props {
  eventId: string;
}

type Pending =
  | { kind: 'accommodate'; item: RefundableItem }
  | { kind: 'resend'; item: RefundableItem }
  | null;

const KIND_META: Record<RefundableItem['kind'], { label: string; tone: 'rose' | 'amber' }> = {
  payment_failed: { label: 'Payment expired', tone: 'rose' },
  no_show_paid:   { label: 'Inventory unavailable', tone: 'amber' },
};

function toneClass(tone: 'amber' | 'rose' | 'slate'): string {
  switch (tone) {
    case 'amber': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'rose':  return 'bg-rose-50 text-rose-700 border-rose-200';
    default:      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function formatAgo(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function RefundableTab({ eventId }: Props) {
  const [items, setItems] = useState<RefundableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/manage/refundable`, { cache: 'no-store' });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load refundable entries.');
        return;
      }
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  // Toast auto-dismiss after 4s so the user can confirm the action landed
  // without manually clearing it.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const runAccommodate = useCallback(async (item: RefundableItem) => {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${eventId}/manage/refundable/${encodeURIComponent(item.reservationId)}/accommodate`,
        { method: 'POST' },
      );
      const d = await res.json();
      if (!d.ok) {
        setToast({ kind: 'err', text: d.message || 'Could not accommodate.' });
        return;
      }
      // Drop locally so the list shrinks immediately.
      setItems((prev) => prev.filter((b) => b.id !== item.id));
      setToast({ kind: 'ok', text: `Comp wallet issued for ${item.name || item.phone || 'guest'}.` });
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Network error.' });
    } finally {
      setBusyId(null);
      setPending(null);
    }
  }, [eventId]);

  const runResend = useCallback(async (item: RefundableItem) => {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${eventId}/manage/refundable/${encodeURIComponent(item.reservationId)}/resend`,
        { method: 'POST' },
      );
      const d = await res.json();
      if (!d.ok) {
        setToast({ kind: 'err', text: d.message || 'Could not resend.' });
        return;
      }
      setToast({ kind: 'ok', text: `Ticket re-sent to ${item.phone || item.name || 'guest'}.` });
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Network error.' });
    } finally {
      setBusyId(null);
      setPending(null);
    }
  }, [eventId]);

  return (
    <div className="space-y-4">
      {/* Spec-mandated header card with the "what this is" copy. */}
      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900">Refundable Entries</h2>
        <p className="text-sm text-slate-600 mt-1.5">
          These bookings had their payment expire or inventory became unavailable. You can
          accommodate them to convert to a successful booking, or resend their ticket &amp; invoice.
        </p>
      </div>

      {/* Toast / inline status — non-blocking confirmation of last action. */}
      {toast && (
        <div
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            toast.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {toast.text}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card text-slate-500 text-sm">Loading refundable entries…</div>
      ) : items.length === 0 ? (
        <AllClearEmpty />
      ) : (
        <div className="card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold">Phone</th>
                  <th className="text-right px-4 py-3 font-semibold">Amount</th>
                  <th className="text-left px-4 py-3 font-semibold">Last payment</th>
                  <th className="text-left px-4 py-3 font-semibold">When</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((b) => {
                  const meta = KIND_META[b.kind];
                  const lastStatus = (b.lastPaymentStatus || '').toLowerCase();
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{b.name || '—'}</div>
                        {b.email && (
                          <div className="text-[11px] text-slate-400 truncate max-w-[200px]">{b.email}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {b.phone || '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                        {formatINR(b.amount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${toneClass(meta.tone)}`}>
                          {meta.label}
                        </span>
                        {lastStatus && (
                          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                            {lastStatus}
                          </div>
                        )}
                        {b.reason && (
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]" title={b.reason}>
                            {b.reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatAgo(b.abandonedAt)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPending({ kind: 'accommodate', item: b })}
                            disabled={busyId === b.id}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 font-medium disabled:opacity-50"
                          >
                            Accommodate
                          </button>
                          <button
                            type="button"
                            onClick={() => setPending({ kind: 'resend', item: b })}
                            disabled={busyId === b.id || !b.phone}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-medium disabled:opacity-50"
                            title={!b.phone ? 'No phone on file — cannot resend' : undefined}
                          >
                            {busyId === b.id ? 'Working…' : 'Resend'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm dialogs for both actions — money-side actions get a
          modal rather than window.confirm so the operator sees what
          they're about to do. */}
      {pending && (
        <ConfirmDialog
          pending={pending}
          busy={busyId === pending.item.id}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (pending.kind === 'accommodate') void runAccommodate(pending.item);
            else void runResend(pending.item);
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function AllClearEmpty() {
  return (
    <div className="card text-center py-12">
      <div className="text-4xl mb-2">🎉</div>
      <div className="text-sm font-semibold text-slate-700">All clear</div>
      <div className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
        No refundable entries for this offering. All bookings are in good shape.
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

interface ConfirmDialogProps {
  pending: NonNullable<Pending>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ pending, busy, onCancel, onConfirm }: ConfirmDialogProps) {
  const { item, kind } = pending;
  const isAccommodate = kind === 'accommodate';
  const title = isAccommodate ? 'Accommodate this guest?' : 'Re-send ticket?';
  const body = isAccommodate
    ? `This will issue a free comp wallet for ${item.name || item.phone || 'this guest'} and convert their reservation. Use this when you've decided to honor a booking that lost payment or inventory.`
    : `This will re-send the ticket & invoice via WhatsApp to ${item.phone || item.name || 'this guest'}. Use this when the guest already has a wallet but didn't receive the confirmation.`;
  const cta = isAccommodate ? 'Issue comp wallet' : 'Send WhatsApp';
  const ctaClass = isAccommodate
    ? 'bg-brand-600 hover:bg-brand-700 text-white border border-brand-700'
    : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onCancel}>
      <div
        className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="refundable-confirm-title"
      >
        <h3 id="refundable-confirm-title" className="text-lg font-semibold text-slate-900 mb-2">
          {title}
        </h3>
        <p className="text-sm text-slate-600">{body}</p>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <div><span className="text-slate-500">Guest:</span> {item.name || '—'}</div>
          <div><span className="text-slate-500">Phone:</span> {item.phone || '—'}</div>
          <div><span className="text-slate-500">Amount:</span> {formatINR(item.amount)}</div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-3 py-1.5 text-sm rounded font-medium disabled:opacity-50 ${ctaClass}`}
          >
            {busy ? 'Working…' : cta}
          </button>
        </div>
      </div>
    </div>
  );
}
