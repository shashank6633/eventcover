'use client';

/**
 * PrepayForm — small focused client component for the /p/[token] flow.
 *
 * Unlike PublicBookingForm (which creates a reservation AND starts a
 * payment), PrepayForm targets an EXISTING reservation that just needs
 * to pay. So it:
 *   - Locks the customer identity (name + phone are already on the row,
 *     not editable by the guest here)
 *   - Renders the same M/F/C steppers as the public form
 *   - Pre-fills total pax from the Reservego pax (the customer can still
 *     redistribute across M/F/C as long as M + F + 2C === reservation.pax)
 *   - POSTs the prepay token to /api/payments/order (server verifies token
 *     equality with the row, then mints the Razorpay order)
 *   - Opens the Razorpay modal via the shared client helper
 *
 * Once the user pays, /api/payments/verify (which we extended in the same
 * commit) writes payment_id back to the reservation. We poll /prepay-resolve
 * once for the success state OR navigate to /w/<walletToken> when the
 * wallet auto-issues — same pattern PublicBookingForm uses.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { openRazorpayCheckout } from './RazorpayCheckout';

interface Reservation {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  eventDate: string | null;
  arrivalTime: string | null;
  tables: string[];
  paymentId?: string | null;
}

interface CoverRates {
  male_stag: number;
  female_stag: number;
  couple: number;
}

interface PrepayFormProps {
  token: string;
  reservation: Reservation;
  eventName: string;
  eventDate: string;
  coverRates: CoverRates;
  entryFeePerPerson: number;
  /** Razorpay total recomputation is server-side; this is just the preview. */
  paymentGatewayFeePayer: 'customer' | 'host';
  platformFeePayer: 'customer' | 'host';
  gstEnabled: boolean;
  paymentGatewayFeePct: number;
  platformFeePct: number;
  gstPercent: number;
  discountPercent: number;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'creating-order' }
  | { kind: 'awaiting-payment' }
  | { kind: 'verifying' }
  | { kind: 'paid'; message: string }
  | { kind: 'error'; message: string };

export function PrepayForm({
  token,
  reservation,
  eventName,
  eventDate,
  coverRates,
  paymentGatewayFeePayer,
  platformFeePayer,
  gstEnabled,
  paymentGatewayFeePct,
  platformFeePct,
  gstPercent,
  discountPercent,
}: PrepayFormProps) {
  // Pre-distribute the Reservego pax into a sensible default — everyone
  // under Male for an Indian-club mental model where stag is the most
  // common starting split. Guest can rebalance before paying.
  const [male, setMale] = useState(reservation.pax);
  const [female, setFemale] = useState(0);
  const [couples, setCouples] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const totalPax = male + female + couples * 2;
  const mixSumsToPax = totalPax === reservation.pax;

  // Live total preview — base = M×male_stag + F×female_stag + C×couple.
  // Server recomputes via computeBilling() so this is just a display hint.
  const coverStack =
    male * coverRates.male_stag +
    female * coverRates.female_stag +
    couples * coverRates.couple;

  const breakdown = useMemo(() => {
    const base = coverStack;
    const pctDisc = Math.max(0, base * (Math.min(100, Math.max(0, discountPercent)) / 100));
    const subtotal = Math.max(0, base - pctDisc);
    const gw = paymentGatewayFeePayer === 'customer'
      ? subtotal * (Math.min(100, Math.max(0, paymentGatewayFeePct)) / 100)
      : 0;
    const pf = platformFeePayer === 'customer'
      ? subtotal * (Math.min(100, Math.max(0, platformFeePct)) / 100)
      : 0;
    const preGst = subtotal + gw + pf;
    const gst = gstEnabled ? preGst * (Math.min(100, Math.max(0, gstPercent)) / 100) : 0;
    return { base, subtotal, gw, pf, gst, final: preGst + gst };
  }, [
    coverStack, discountPercent, paymentGatewayFeePayer, paymentGatewayFeePct,
    platformFeePayer, platformFeePct, gstEnabled, gstPercent,
  ]);

  // Stable ref so the Razorpay modal callback closure doesn't capture stale
  // status. The modal lives outside React's render loop.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  async function startPayment() {
    if (status.kind !== 'idle' && status.kind !== 'error') return;
    if (!mixSumsToPax) {
      setStatus({
        kind: 'error',
        message: `Your guest mix sums to ${totalPax} — but the reservation is for ${reservation.pax} people. Adjust the counts so they match.`,
      });
      return;
    }
    if (totalPax === 0) {
      setStatus({ kind: 'error', message: 'Add at least one guest to continue.' });
      return;
    }

    setStatus({ kind: 'creating-order' });
    try {
      // Server accepts EITHER reservationId OR prepayToken — we send the
      // token so the route re-verifies the HMAC + checks token equality
      // with the row's current payment_link_token. A revoked link returns
      // 410; we surface the message cleanly.
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prepayToken: tokenRef.current,
          genderMix: { male, female, couple: couples },
        }),
      });
      const order = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        keyId?: string;
        razorpayOrderId?: string;
        amount?: number;
        currency?: string;
        customer?: { name: string; phone: string; email: string | null };
      };
      if (!res.ok || !order.ok || !order.razorpayOrderId || !order.keyId) {
        setStatus({
          kind: 'error',
          message: order.message || 'Could not start payment. Please try again or contact the venue.',
        });
        return;
      }

      setStatus({ kind: 'awaiting-payment' });
      await openRazorpayCheckout({
        keyId: order.keyId,
        orderId: order.razorpayOrderId,
        amount: order.amount || 0,
        currency: order.currency || 'INR',
        name: eventName,
        description: `Cover charge · ${eventName}`,
        customerName: order.customer?.name || reservation.name,
        customerPhone: order.customer?.phone || reservation.phone,
        customerEmail: order.customer?.email || reservation.email || undefined,
        onFailure: (err) => {
          setStatus({
            kind: 'error',
            message: err?.description || 'Payment failed. Please try again.',
          });
        },
        onSuccess: async (rzr) => {
          setStatus({ kind: 'verifying' });
          try {
            const v = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: rzr.razorpay_order_id,
                razorpay_payment_id: rzr.razorpay_payment_id,
                razorpay_signature: rzr.razorpay_signature,
              }),
            });
            const vd = (await v.json().catch(() => ({}))) as { ok?: boolean; message?: string };
            if (!v.ok || !vd.ok) {
              setStatus({
                kind: 'error',
                message: vd.message || 'Payment captured but verification failed. Contact the venue.',
              });
              return;
            }
            setStatus({
              kind: 'paid',
              message: 'Payment received! You will get a WhatsApp confirmation shortly. Show that at the door.',
            });
          } catch {
            setStatus({
              kind: 'error',
              message: 'Payment captured but we could not verify it here. Contact the venue with your transaction id.',
            });
          }
        },
        onDismiss: () => setStatus({ kind: 'idle' }),
      });
    } catch {
      setStatus({ kind: 'error', message: 'Network error. Please try again.' });
    }
  }

  if (status.kind === 'paid') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-emerald-900">
        <div className="text-2xl font-bold mb-1">✓ Paid</div>
        <p className="text-sm mb-4">{status.message}</p>
        <div className="text-xs text-emerald-800/70 bg-white/60 rounded-lg p-3">
          <div><strong>Guest:</strong> {reservation.name}</div>
          <div><strong>Event:</strong> {eventName} · {eventDate}</div>
          <div><strong>Pax:</strong> {reservation.pax} ({male}M · {female}F · {couples}C)</div>
        </div>
      </div>
    );
  }

  const busy =
    status.kind === 'creating-order' ||
    status.kind === 'awaiting-payment' ||
    status.kind === 'verifying';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Reservation</div>
        <div className="text-base font-semibold text-slate-900">{reservation.name}</div>
        <div className="text-sm text-slate-600">{reservation.phone}</div>
        <div className="text-xs text-slate-500 mt-1">
          {reservation.pax} guest{reservation.pax === 1 ? '' : 's'}
          {reservation.arrivalTime && ` · arrives ${reservation.arrivalTime}`}
          {reservation.tables.length > 0 && ` · ${reservation.tables.join(', ')}`}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-semibold text-slate-900">Guest mix</div>
          <div className={`text-[11px] font-medium ${mixSumsToPax ? 'text-slate-500' : 'text-rose-600'}`}>
            {totalPax} / {reservation.pax} guests
          </div>
        </div>
        <GuestRow
          label="Male"
          unit={coverRates.male_stag}
          count={male}
          onDec={() => setMale(Math.max(0, male - 1))}
          onInc={() => setMale(male + 1)}
          disabled={busy}
        />
        <GuestRow
          label="Female"
          unit={coverRates.female_stag}
          count={female}
          onDec={() => setFemale(Math.max(0, female - 1))}
          onInc={() => setFemale(female + 1)}
          disabled={busy}
        />
        <GuestRow
          label="Couple"
          unit={coverRates.couple}
          count={couples}
          onDec={() => setCouples(Math.max(0, couples - 1))}
          onInc={() => setCouples(couples + 1)}
          disabled={busy}
          sublabel="2 pax"
        />
        {!mixSumsToPax && (
          <div className="text-[11px] text-amber-700 pt-1">
            Adjust so M + F + 2 × C = {reservation.pax}.
          </div>
        )}
      </div>

      {/* Total breakdown */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-1 text-sm">
        <Row label="Cover" value={breakdown.base} />
        {breakdown.gw > 0 && <Row label={`Gateway fee (${paymentGatewayFeePct}%)`} value={breakdown.gw} />}
        {breakdown.pf > 0 && <Row label={`Platform fee (${platformFeePct}%)`} value={breakdown.pf} />}
        {breakdown.gst > 0 && <Row label={`GST (${gstPercent}%)`} value={breakdown.gst} />}
        <div className="border-t border-slate-100 pt-2 mt-2 flex items-baseline justify-between">
          <div className="text-sm font-semibold text-slate-900">Total</div>
          <div className="text-xl font-bold text-slate-900 font-mono">
            ₹{breakdown.final.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {status.kind === 'error' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          {status.message}
        </div>
      )}

      <button
        type="button"
        onClick={startPayment}
        disabled={busy || !mixSumsToPax || totalPax === 0}
        className="btn btn-primary w-full !py-3"
      >
        {status.kind === 'creating-order'
          ? 'Starting…'
          : status.kind === 'awaiting-payment'
            ? 'Opening payment…'
            : status.kind === 'verifying'
              ? 'Verifying payment…'
              : `Pay ₹${Math.round(breakdown.final).toLocaleString('en-IN')}`}
      </button>

      <p className="text-[11px] text-slate-400 text-center">
        Powered by Razorpay. You'll get a WhatsApp confirmation on payment.
      </p>
    </div>
  );
}

function GuestRow({
  label,
  unit,
  count,
  sublabel,
  disabled,
  onInc,
  onDec,
}: {
  label: string;
  unit: number;
  count: number;
  sublabel?: string;
  disabled?: boolean;
  onInc: () => void;
  onDec: () => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-white rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-[11px] text-slate-500">
          ₹{unit.toLocaleString('en-IN')}{sublabel ? ` per couple · ${sublabel}` : ' per person'}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDec}
          disabled={disabled || count === 0}
          aria-label={`Decrease ${label}`}
          className="w-7 h-7 rounded-md border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          −
        </button>
        <div className="min-w-[28px] text-center text-sm font-semibold text-slate-900 tabular-nums">
          {count}
        </div>
        <button
          type="button"
          onClick={onInc}
          disabled={disabled}
          aria-label={`Increase ${label}`}
          className="w-7 h-7 rounded-md border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          +
        </button>
      </div>
      <div className="min-w-[64px] text-right text-xs font-mono text-slate-600 tabular-nums">
        {count > 0 ? `₹${(count * unit).toLocaleString('en-IN')}` : '—'}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm text-slate-700 font-mono">
        ₹{value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}
