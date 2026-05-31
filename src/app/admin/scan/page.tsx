'use client';

/**
 * /admin/scan — unified QR scan screen.
 *
 * Roles allowed: entry, captain, manager, host.
 * The page itself is open to all four roles, but the action buttons inside
 * the summary card are role-gated (entry can check-in; captain can redeem;
 * manager/host can do both + view history). Server endpoints enforce the
 * same gates — this UI just hides the buttons that would 403.
 *
 * Two entry paths:
 *   1. ?token=…  → page mounts, immediately resolves token to a ledger.
 *      This is the deep-link path: scanning the printed pass with the OS
 *      camera lands the user on /admin/scan?token=…
 *   2. In-page camera scanner — for the door staff's existing logged-in
 *      session. Tapping "Scan reservation QR" opens the modal.
 *
 * The two scan screens (this one + /admin/checkin) share the same backend
 * resolve + ledger flow; only the default-action button differs per role
 * audience. We deliberately keep both so the URL is recognisable on a
 * staff phone home screen ("which icon do I tap?").
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ReservationQrScanner } from '@/components/ReservationQrScanner';
import {
  ReservationSummaryCard,
  type ReservationLedger,
} from '@/components/ReservationSummaryCard';
import type { UserRole } from '@/lib/roles';

interface Me {
  id: string;
  name: string;
  role: UserRole;
}

interface QrResolveResponse {
  ok: boolean;
  message?: string;
  reservation?: ReservationLedger;
}

interface CheckinResponse {
  ok: boolean;
  message?: string;
  reservation?: ReservationLedger;
  guests_checked_in?: number;
}

interface RedeemResponse {
  ok: boolean;
  message?: string;
  reservation?: ReservationLedger;
  amount_redeemed?: number;
}

type ToastTone = 'success' | 'error';
interface Toast {
  tone: ToastTone;
  text: string;
}

export default function ScanPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ScanClient />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <div className="card text-center text-slate-400">Loading…</div>
    </div>
  );
}

function ScanClient() {
  const router = useRouter();
  const params = useSearchParams();
  const initialToken = (params.get('token') || '').trim();
  // The reservations list view deep-links to /admin/scan?reservationId=…
  // (staff already-authed → don't bounce them through the camera). We mint a
  // token server-side via /api/reservations/[id]/qr and then run the same
  // token-resolve path so the rest of the UI is uniform.
  const initialReservationId = (params.get('reservationId') || '').trim();

  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(true);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [ledger, setLedger] = useState<ReservationLedger | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const [checkinOpen, setCheckinOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  // ─── Auth bootstrap ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => {
        if (r.status === 401) {
          router.replace(`/login?next=${encodeURIComponent('/admin/scan')}`);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        if (d?.ok) setMe(d.user);
        setMeLoading(false);
      })
      .catch(() => {
        if (!cancelled) setMeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // ─── Token → ledger resolver ──────────────────────────────────────────────

  const resolveToken = useCallback(async (token: string) => {
    setResolving(true);
    setResolveError(null);
    setLedger(null);
    try {
      const res = await fetch(`/api/reservations/qr-resolve/${encodeURIComponent(token)}`, {
        cache: 'no-store',
      });
      const data: QrResolveResponse = await res.json();
      if (!data.ok || !data.reservation) {
        setResolveError(data.message || 'Could not resolve this QR code.');
      } else {
        setLedger(data.reservation);
      }
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setResolving(false);
    }
  }, []);

  // Auto-resolve on mount if ?token=… is present (deep-link from printed pass).
  useEffect(() => {
    if (!initialToken) return;
    resolveToken(initialToken);
  }, [initialToken, resolveToken]);

  // ─── Reservation-id → token → ledger (deep-link from list view) ───────────
  //
  // The /admin/reservations row uses ?reservationId=… (the QA noted that the
  // staff is already logged-in here, so opening the camera is friction). We
  // mint a one-shot token via /api/reservations/[id]/qr, then drop into the
  // same resolve flow so the summary card, action buttons and audit log all
  // behave identically to a real scan.
  useEffect(() => {
    if (!initialReservationId || initialToken) return;
    let cancelled = false;
    (async () => {
      setResolving(true);
      setResolveError(null);
      setLedger(null);
      try {
        const res = await fetch(
          `/api/reservations/${encodeURIComponent(initialReservationId)}/qr`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => ({ ok: false }));
        if (cancelled) return;
        if (!data.ok || !data.token) {
          setResolveError(data.message || 'Could not load this reservation.');
          setResolving(false);
          return;
        }
        // Sync the URL so a refresh re-resolves the same reservation through
        // the token path (and shareable URLs are scan-able).
        router.replace(`/admin/scan?token=${encodeURIComponent(data.token)}`);
        await resolveToken(data.token);
      } catch (e) {
        if (cancelled) return;
        setResolveError(e instanceof Error ? e.message : 'Network error');
        setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialReservationId, initialToken, resolveToken, router]);

  // ─── Toast auto-dismiss ───────────────────────────────────────────────────

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── Scanner callbacks ────────────────────────────────────────────────────

  function handleScanned(token: string) {
    setScannerOpen(false);
    // Keep the URL in sync so a refresh re-resolves the same reservation.
    router.replace(`/admin/scan?token=${encodeURIComponent(token)}`);
    resolveToken(token);
  }

  function rescan() {
    setLedger(null);
    setResolveError(null);
    setCheckinOpen(false);
    setRedeemOpen(false);
    router.replace('/admin/scan');
    setScannerOpen(true);
  }

  // ─── Role + state derivations ─────────────────────────────────────────────

  const role = me?.role;
  const canCheckin = role === 'entry' || role === 'manager' || role === 'host';
  const canRedeem = role === 'captain' || role === 'manager' || role === 'host';
  const canViewHistory = role === 'manager' || role === 'host';

  const checkinDisabled =
    !ledger ||
    ledger.reservation_status === 'closed' ||
    ledger.reservation_status === 'fully_checked_in' ||
    ledger.remaining_pax <= 0;

  const redeemDisabled =
    !ledger ||
    ledger.reservation_status === 'closed' ||
    ledger.cover_status === 'fully_redeemed' ||
    ledger.cover_balance <= 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  if (meLoading) return <Loading />;

  return (
    <div className="max-w-md mx-auto px-4 py-6 md:py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Floor</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Scan Reservation</h1>
      <p className="text-xs text-slate-500 mt-1">
        One QR per reservation — check in guests at the door or redeem cover at the table.
      </p>

      {/* Scanner CTA — primary action on the empty state */}
      {!ledger && (
        <>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="btn btn-primary w-full mt-6 flex items-center justify-center gap-2"
          >
            <ScanIcon />
            Scan reservation QR
          </button>

          {resolving && (
            <div className="card mt-4 flex items-center gap-3 text-slate-700">
              <div className="w-5 h-5 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
              <span className="text-sm">Looking up reservation…</span>
            </div>
          )}

          {resolveError && (
            <div className="card mt-4">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center">
                <div className="w-10 h-10 mx-auto rounded-full bg-rose-500 text-white flex items-center justify-center font-bold">
                  !
                </div>
                <div className="mt-3 text-sm font-semibold text-rose-800">
                  Could not resolve QR
                </div>
                <div className="mt-1 text-xs text-rose-700">{resolveError}</div>
              </div>
              <button
                type="button"
                className="btn btn-primary w-full mt-4"
                onClick={rescan}
              >
                Scan again
              </button>
            </div>
          )}
        </>
      )}

      {/* Resolved reservation view */}
      {ledger && (
        <>
          <ReservationSummaryCard
            ledger={ledger}
            actions={
              <div className="grid grid-cols-1 gap-2.5">
                {canCheckin && (
                  <button
                    type="button"
                    className="btn btn-primary w-full"
                    disabled={checkinDisabled}
                    onClick={() => setCheckinOpen(true)}
                  >
                    Check-In Guests
                  </button>
                )}
                {canRedeem && (
                  <button
                    type="button"
                    className={`btn w-full ${canCheckin ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={redeemDisabled}
                    onClick={() => setRedeemOpen(true)}
                  >
                    Redeem Cover Charge
                  </button>
                )}
                {canViewHistory && (
                  <Link
                    href={`/admin/reservations/${ledger.reservation_id}/history`}
                    className="btn btn-secondary w-full"
                  >
                    View History
                  </Link>
                )}
              </div>
            }
          />

          <button
            type="button"
            onClick={rescan}
            className="btn btn-secondary w-full mt-3 flex items-center justify-center gap-2"
          >
            <ScanIcon />
            Scan another reservation
          </button>
        </>
      )}

      {/* Scanner modal */}
      {scannerOpen && (
        <ReservationQrScanner
          onDetected={(token) => handleScanned(token)}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Check-in modal */}
      {checkinOpen && ledger && (
        <CheckinModal
          ledger={ledger}
          onClose={() => setCheckinOpen(false)}
          onSuccess={(updated, count) => {
            setLedger(updated);
            setCheckinOpen(false);
            setToast({
              tone: 'success',
              text: `+${count} guest${count === 1 ? '' : 's'} checked in`,
            });
          }}
        />
      )}

      {/* Redeem modal */}
      {redeemOpen && ledger && (
        <RedeemModal
          ledger={ledger}
          onClose={() => setRedeemOpen(false)}
          onSuccess={(updated, amount) => {
            setLedger(updated);
            setRedeemOpen(false);
            setToast({
              tone: 'success',
              text: `Redeemed ₹${amount.toLocaleString('en-IN')}`,
            });
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed inset-x-0 bottom-6 z-40 mx-auto max-w-md px-4 pointer-events-none`}
        >
          <div
            className={`rounded-xl px-4 py-3 shadow-elevated text-sm font-medium text-center pointer-events-auto ${
              toast.tone === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-rose-600 text-white'
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Check-In Modal ──────────────────────────────────────────────────────────

interface CheckinModalProps {
  ledger: ReservationLedger;
  onClose: () => void;
  onSuccess: (updated: ReservationLedger, count: number) => void;
}

function CheckinModal({ ledger, onClose, onSuccess }: CheckinModalProps) {
  const [guests, setGuests] = useState<string>('1');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = ledger.remaining_pax;
  const guestsNum = Number(guests);
  const guestsValid = Number.isInteger(guestsNum) && guestsNum >= 1 && guestsNum <= remaining;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation copy is verbatim from the product spec — managers grep these
    // strings when tracing door-night incidents. Don't paraphrase.
    if (Number.isNaN(guestsNum)) {
      setError('Cannot be zero');
      return;
    }
    if (guestsNum < 0) {
      setError('Cannot be negative');
      return;
    }
    if (!Number.isInteger(guestsNum) || guestsNum < 1) {
      setError('Cannot be zero');
      return;
    }
    if (guestsNum > remaining) {
      setError(`Only ${remaining} guests remaining for this reservation.`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(
        `/api/reservations/${encodeURIComponent(ledger.reservation_id)}/checkin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Server accepts either {count} or {guests}; we send both so the
          // post-server-fix contract works regardless of which key the
          // server lands on. `count` is the canonical one per the spec.
          body: JSON.stringify({
            count: guestsNum,
            guests: guestsNum,
            notes: notes.trim() || undefined,
          }),
        },
      );
      const data: CheckinResponse = await res.json();
      if (!data.ok || !data.reservation) {
        setError(data.message || 'Check-in failed. Try again.');
        return;
      }
      onSuccess(data.reservation, data.guests_checked_in ?? guestsNum);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="How many guests are entering now?">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}

        <div>
          <label className="label">Guests entering</label>
          <input
            className="input text-2xl font-bold text-center"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            min={1}
            max={remaining}
            value={guests}
            onChange={(e) => setGuests(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          <div className="text-xs text-slate-500 mt-2">
            {remaining} of {ledger.total_pax} still to enter.
          </div>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. one guest joining late"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary w-full"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={busy || !guestsValid}
          >
            {busy ? 'Checking in…' : `Check in ${guestsNum || ''}`.trim()}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Redeem Modal ────────────────────────────────────────────────────────────

interface RedeemModalProps {
  ledger: ReservationLedger;
  onClose: () => void;
  onSuccess: (updated: ReservationLedger, amount: number) => void;
}

function RedeemModal({ ledger, onClose, onSuccess }: RedeemModalProps) {
  const [amount, setAmount] = useState('');
  const [billId, setBillId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balance = ledger.cover_balance;
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= balance;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation copy is verbatim from the product spec.
    if (Number.isNaN(amountNum) || amountNum === 0) {
      setError('Cannot be zero');
      return;
    }
    if (amountNum < 0) {
      setError('Cannot be negative');
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Cannot be zero');
      return;
    }
    if (amountNum > balance) {
      setError('Redemption amount exceeds available cover balance.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(
        `/api/reservations/${encodeURIComponent(ledger.reservation_id)}/redeem`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Server accepts either billId or bill_id; we send bill_id (snake)
          // to match the canonical client/server convention agreed in the
          // post-fix contract. The redeem route already coerces both.
          body: JSON.stringify({
            amount: amountNum,
            bill_id: billId.trim() || undefined,
            notes: notes.trim() || undefined,
          }),
        },
      );
      const data: RedeemResponse = await res.json();
      if (!data.ok || !data.reservation) {
        // Server uses 409 with { message: "Bill #X already redeemed" } for dup
        // bill collisions; surface verbatim.
        setError(data.message || 'Redeem failed. Try again.');
        return;
      }
      onSuccess(data.reservation, data.amount_redeemed ?? amountNum);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Redeem cover charge">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}

        {/* Balance highlight — gives the captain a quick read before typing */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Available balance</div>
          <div className="text-3xl font-bold text-brand-600 mt-0.5">₹{formatINR(balance)}</div>
        </div>

        <div>
          <label className="label">
            Amount (₹) <span className="text-rose-600">*</span>
          </label>
          <input
            className="input text-2xl font-bold text-center"
            type="number"
            inputMode="decimal"
            min={1}
            step={1}
            max={balance}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </div>

        <div>
          <label className="label">Bill # (recommended)</label>
          <input
            className="input"
            value={billId}
            onChange={(e) => setBillId(e.target.value)}
            placeholder="e.g. KOT#4521"
            autoComplete="off"
          />
          <div className="text-xs text-slate-500 mt-2">
            Same bill can't be redeemed twice. Leave blank for ad-hoc redemptions.
          </div>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. partial settle, manager approved"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary w-full"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={busy || !amountValid}
          >
            {busy ? 'Redeeming…' : `Redeem ₹${amount || ''}`.trim()}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  // Lock body scroll while the modal is up — door staff often scroll a long
  // ledger card with their thumb and accidentally drag the modal.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-elevated">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 p-1"
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
      {children}
    </div>
  );
}

function ScanIcon() {
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
      aria-hidden
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M21 7V5a2 2 0 0 0-2-2h-2" />
      <path d="M3 17v2a2 2 0 0 0 2 2h2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 12h10" />
    </svg>
  );
}

function formatINR(n: number): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
