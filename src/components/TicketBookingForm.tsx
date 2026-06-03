'use client';

/**
 * TicketBookingForm — unified booking form for the EventCover model.
 *
 * Demonstrates how Entry Fee, Cover Charges, and Table Tickets compose on a
 * single page. This is a clean, focused reference component — uses the same
 * shared helpers as PublicBookingForm (openRazorpayCheckout etc.) but with
 * all the booking math + ticket-type selection in one place so the logic
 * is easy to read in isolation.
 *
 * MENTAL MODEL — the three concepts:
 *   • Entry Fee     — per-head charge for General Entry mode
 *   • Table Ticket  — flat per-table charge for Table mode (NOT × pax)
 *   • Cover Charge  — per-category (M/F/C) fee that stacks on top of EITHER
 *                     of the above. Becomes the QR wallet at the door.
 *
 * INVARIANT — for any selected mode:
 *   M + F + 2C === selectedPax
 *
 * For Table mode, selectedPax is locked to the chosen table's capacity.
 * For General Entry / Zone modes, the customer chooses the pax.
 *
 * PRICING (mirrors src/lib/pricing-calculator.ts):
 *   General Entry:  base = entry_fee × pax + cover
 *   Table:          base = table_price + cover       ← flat, not × pax
 *   Zone:           base = zone_price × pax + cover
 *
 *   discount     = base × discount_pct + coupon
 *   subtotal     = base − discount
 *   gateway_fee  = subtotal × gateway_pct   (if customer pays)
 *   platform_fee = subtotal × platform_pct  (if customer pays)
 *   gst          = (subtotal + fees) × gst_pct   (if enabled)
 *   total        = subtotal + gateway_fee + platform_fee + gst
 *
 * BACKEND CONTRACT (when wiring this as the primary form):
 *   POST /api/reservations/public
 *     body: { eventSlug, name, phone, email?, pax, ticketMode,
 *             tableTypeId?, zoneId?, genderMix }
 *
 *   POST /api/payments/order
 *     body: { reservationId, genderMix, tableTypeId?, zoneId? }
 *     Server resolves the active price (phase override first, then static),
 *     uses pricedPax=1 for table mode, recomputes via computeBilling().
 */

import { useEffect, useMemo, useState } from 'react';
import { openRazorpayCheckout } from './RazorpayCheckout';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TableType {
  /** Stable id (e.g. 'tt_t4'). Matches Pricing Matrix scope_id. */
  id: string;
  name: string;
  /** Number of seats this table accommodates. M + F + 2C must equal this. */
  capacity: number;
  /** Base flat price for the whole table. Phase override may replace this. */
  basePrice: number;
  /** Active inventory remaining for this table type — null = unlimited. */
  remaining: number | null;
  /**
   * Optional phase-resolved price. When the active phase has an override
   * for this table_type, set this to the phase price. The form uses it
   * preferentially so the customer sees the live phase price.
   */
  phasePrice?: number;
  phaseName?: string;
}

export interface Zone {
  id: string;
  label: string;
  /** Per-seat price for this zone (mirror of event_zones.price). */
  pricePerSeat: number;
  /** Available seats remaining. */
  remaining: number;
  phasePrice?: number;
}

export interface CoverRates {
  male_stag: number;
  female_stag: number;
  couple: number;
}

interface Props {
  eventSlug: string;
  eventId: string;
  eventName: string;
  eventDate: string;

  /** When > 0, General Entry mode is offered. */
  entryFeePerPerson: number;
  /** Flat-entry phase override if active. Falls back to entryFeePerPerson. */
  flatEntryPhasePrice?: number | null;

  /** Per-event cover rates. When all 0, the M/F/C UI hides and falls back to a single pax. */
  coverRates: CoverRates;

  /** Available table types. Empty = no Tables mode. */
  tableTypes: TableType[];

  /** Available zones. Empty = no Zone mode. */
  zones: Zone[];

  /** Fee + GST configuration. */
  paymentGatewayFeePayer: 'customer' | 'host';
  platformFeePayer: 'customer' | 'host';
  gstEnabled: boolean;
  paymentGatewayFeePct: number;
  platformFeePct: number;
  gstPercent: number;
  discountPercent: number;
}

type TicketMode = 'entry' | 'table' | 'zone';

type Status =
  | { kind: 'idle' }
  | { kind: 'reserving' }
  | { kind: 'creating-order' }
  | { kind: 'awaiting-payment' }
  | { kind: 'verifying' }
  | { kind: 'paid'; txnId?: string }
  | { kind: 'error'; message: string };

// ─── Component ─────────────────────────────────────────────────────────────

export function TicketBookingForm({
  eventSlug,
  eventName,
  eventDate,
  entryFeePerPerson,
  flatEntryPhasePrice,
  coverRates,
  tableTypes,
  zones,
  paymentGatewayFeePayer,
  platformFeePayer,
  gstEnabled,
  paymentGatewayFeePct,
  platformFeePct,
  gstPercent,
  discountPercent,
}: Props) {
  // Which modes does this event support?
  const hasEntry = entryFeePerPerson > 0 || (flatEntryPhasePrice ?? 0) > 0;
  const hasTables = tableTypes.length > 0;
  const hasZones = zones.length > 0;

  // Default mode preference: tables > zones > entry. Reflects the typical
  // upsell hierarchy (tables are the highest-margin product).
  const defaultMode: TicketMode = hasTables ? 'table' : hasZones ? 'zone' : 'entry';
  const [mode, setMode] = useState<TicketMode>(defaultMode);
  const [tableTypeId, setTableTypeId] = useState<string | null>(
    hasTables ? tableTypes[0]?.id ?? null : null,
  );
  const [zoneId, setZoneId] = useState<string | null>(hasZones ? zones[0]?.id ?? null : null);

  // Customer identity
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Guest mix
  const [male, setMale] = useState(0);
  const [female, setFemale] = useState(0);
  const [couples, setCouples] = useState(0);
  // For General Entry mode the customer picks the pax directly via the
  // steppers; selectedPax derives from M + F + 2C. For Table mode pax is
  // LOCKED to the table's capacity — the steppers must sum to that. For
  // Zone mode pax is set by the M/F/C steppers and constrained by the
  // zone's remaining seats.
  const selectedPax = male + female + couples * 2;

  // Constraints by mode
  const selectedTable = tableTypeId ? tableTypes.find((t) => t.id === tableTypeId) ?? null : null;
  const selectedZone = zoneId ? zones.find((z) => z.id === zoneId) ?? null : null;
  const requiredPax = mode === 'table' ? selectedTable?.capacity ?? 0 : null;
  const remainingSeats = mode === 'zone' ? selectedZone?.remaining ?? 0 : Infinity;

  const paxValid =
    selectedPax > 0 &&
    (mode === 'table' ? selectedPax === requiredPax : true) &&
    (mode === 'zone' ? selectedPax <= remainingSeats : true);

  // ─── Live pricing ────────────────────────────────────────────────────
  // This mirrors what the server-side computeBilling() will produce. The
  // server is the source of truth on the actual Razorpay amount; this is
  // a display hint that updates as the customer changes inputs.
  const pricing = useMemo(() => {
    const cover =
      male * coverRates.male_stag +
      female * coverRates.female_stag +
      couples * coverRates.couple;

    let entryBase = 0;
    if (mode === 'entry') {
      const perHead = (flatEntryPhasePrice ?? 0) > 0
        ? (flatEntryPhasePrice as number)
        : entryFeePerPerson;
      entryBase = perHead * selectedPax;
    } else if (mode === 'table' && selectedTable) {
      // Flat — NOT × pax. The whole table costs one price.
      entryBase = selectedTable.phasePrice ?? selectedTable.basePrice;
    } else if (mode === 'zone' && selectedZone) {
      const perSeat = selectedZone.phasePrice ?? selectedZone.pricePerSeat;
      entryBase = perSeat * selectedPax;
    }

    const base = entryBase + cover;
    const discount = base * (clampPct(discountPercent) / 100);
    const subtotal = Math.max(0, base - discount);
    const gateway = paymentGatewayFeePayer === 'customer'
      ? subtotal * (clampPct(paymentGatewayFeePct) / 100)
      : 0;
    const platform = platformFeePayer === 'customer'
      ? subtotal * (clampPct(platformFeePct) / 100)
      : 0;
    const preGst = subtotal + gateway + platform;
    const gst = gstEnabled ? preGst * (clampPct(gstPercent) / 100) : 0;
    const total = preGst + gst;

    return { entryBase, cover, base, discount, subtotal, gateway, platform, gst, total };
  }, [
    mode, selectedPax, selectedTable, selectedZone,
    male, female, couples,
    coverRates, entryFeePerPerson, flatEntryPhasePrice,
    discountPercent, paymentGatewayFeePayer, platformFeePayer,
    paymentGatewayFeePct, platformFeePct, gstEnabled, gstPercent,
  ]);

  // When mode switches to Table, snap the steppers to a default that
  // matches the table's capacity (e.g. Table of 4 → 2M + 2F as a sensible
  // mixed starting point). For Entry / Zone modes don't auto-fill — the
  // customer is in charge of the count.
  useEffect(() => {
    if (mode === 'table' && selectedTable) {
      const cap = selectedTable.capacity;
      // Default to even M/F when capacity is even; otherwise everyone Male.
      if (cap % 2 === 0) {
        setMale(cap / 2);
        setFemale(cap / 2);
        setCouples(0);
      } else {
        setMale(cap);
        setFemale(0);
        setCouples(0);
      }
    }
  }, [mode, selectedTable]);

  // ─── Submit ──────────────────────────────────────────────────────────
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const busy =
    status.kind === 'reserving' ||
    status.kind === 'creating-order' ||
    status.kind === 'awaiting-payment' ||
    status.kind === 'verifying';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({ kind: 'idle' });

    if (!name.trim()) return setStatus({ kind: 'error', message: 'Name is required.' });
    if (!phone.trim() || phone.replace(/\D/g, '').length < 10) {
      return setStatus({ kind: 'error', message: 'Valid phone number required.' });
    }
    if (!paxValid) {
      if (mode === 'table') {
        return setStatus({
          kind: 'error',
          message: `Guest mix must sum to ${requiredPax} (${selectedTable?.name}). You have ${selectedPax}.`,
        });
      }
      if (mode === 'zone') {
        return setStatus({
          kind: 'error',
          message: `Only ${remainingSeats} seats left in ${selectedZone?.label}. Reduce guests.`,
        });
      }
      return setStatus({ kind: 'error', message: 'Add at least one guest.' });
    }

    // Step 1: create the reservation. Server validates the mode-specific
    // constraints AGAIN (defense in depth) and returns reservationId.
    setStatus({ kind: 'reserving' });
    let reservationId: string;
    try {
      const res = await fetch('/api/reservations/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSlug,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          pax: selectedPax,
          // Mode-specific selectors. Server is responsible for ignoring
          // the irrelevant ones (e.g. a zoneId on a table booking).
          ticketMode: mode,
          tableTypeId: mode === 'table' ? tableTypeId ?? undefined : undefined,
          zoneId: mode === 'zone' ? zoneId ?? undefined : undefined,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        reservationId?: string;
      };
      if (!res.ok || !d.ok || !d.reservationId) {
        return setStatus({
          kind: 'error',
          message: d.message || 'Could not create reservation.',
        });
      }
      reservationId = d.reservationId;
    } catch (e) {
      return setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Network error.',
      });
    }

    // Step 2: start payment. The Razorpay order is minted server-side from
    // computeBilling() — that recomputation is the source-of-truth charge.
    setStatus({ kind: 'creating-order' });
    let order: {
      ok?: boolean;
      message?: string;
      keyId?: string;
      razorpayOrderId?: string;
      amount?: number;
      currency?: string;
      customer?: { name: string; phone: string; email: string | null };
    };
    try {
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservationId,
          genderMix: { male, female, couple: couples },
          // Forward the customer's chosen selectors so the server can
          // resolve the active phase price for this scope. Today the
          // reservation row carries zone_id; tableTypeId needs a new
          // column (table_type_id) — see TODO at the bottom of this file.
          tableTypeId: mode === 'table' ? tableTypeId ?? undefined : undefined,
          zoneId: mode === 'zone' ? zoneId ?? undefined : undefined,
        }),
      });
      order = (await res.json().catch(() => ({}))) as typeof order;
      if (!res.ok || !order?.ok || !order.razorpayOrderId || !order.keyId) {
        return setStatus({
          kind: 'error',
          message: order?.message || 'Could not start payment.',
        });
      }
    } catch (e) {
      return setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Network error.',
      });
    }

    // Step 3: open Razorpay modal.
    setStatus({ kind: 'awaiting-payment' });
    await openRazorpayCheckout({
      keyId: order.keyId,
      orderId: order.razorpayOrderId,
      amount: order.amount || 0,
      currency: order.currency || 'INR',
      name: eventName,
      description: descriptionForMode(mode, selectedTable, selectedZone, selectedPax),
      customerName: order.customer?.name || name,
      customerPhone: order.customer?.phone || phone,
      customerEmail: order.customer?.email || email || undefined,
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
          const vd = (await v.json().catch(() => ({}))) as { ok?: boolean; message?: string; txnId?: string };
          if (!v.ok || !vd.ok) {
            return setStatus({
              kind: 'error',
              message: vd.message || 'Payment captured but verify failed. Contact the venue.',
            });
          }
          setStatus({ kind: 'paid', txnId: vd.txnId });
        } catch {
          setStatus({
            kind: 'error',
            message: 'Payment captured but we could not verify it. Contact the venue.',
          });
        }
      },
    });
  }

  // ─── Render: success state ───────────────────────────────────────────
  if (status.kind === 'paid') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6">
        <div className="text-2xl font-bold text-emerald-900 mb-1">✓ Booked</div>
        <p className="text-sm text-emerald-800 mb-3">
          We've sent a WhatsApp confirmation to {phone}. Show that at the door.
        </p>
        <div className="text-xs text-emerald-800/70 bg-white/60 rounded-lg p-3">
          <div><strong>Event:</strong> {eventName} · {eventDate}</div>
          <div><strong>{labelForMode(mode, selectedTable, selectedZone)}:</strong> {selectedPax} guests</div>
          {status.txnId && <div><strong>Txn:</strong> <span className="font-mono">{status.txnId}</span></div>}
        </div>
      </div>
    );
  }

  // ─── Render: form ────────────────────────────────────────────────────
  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900">Book tickets</h2>

      {/* Mode picker — only show modes the event actually supports. */}
      <TicketTypePicker
        hasEntry={hasEntry}
        hasTables={hasTables}
        hasZones={hasZones}
        mode={mode}
        onChange={setMode}
        disabled={busy}
      />

      {/* Mode-specific sub-pickers */}
      {mode === 'table' && hasTables && (
        <TablePicker
          tableTypes={tableTypes}
          selectedId={tableTypeId}
          onSelect={setTableTypeId}
          disabled={busy}
        />
      )}
      {mode === 'zone' && hasZones && (
        <ZonePicker
          zones={zones}
          selectedId={zoneId}
          onSelect={setZoneId}
          disabled={busy}
        />
      )}

      {/* Customer identity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <div className="text-xs font-medium text-slate-600 mb-1">Name *</div>
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            disabled={busy}
            required
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium text-slate-600 mb-1">Phone *</div>
          <input
            type="tel"
            className="input w-full"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 9876543210"
            disabled={busy}
            required
          />
        </label>
      </div>
      <label className="block">
        <div className="text-xs font-medium text-slate-600 mb-1">Email (optional)</div>
        <input
          type="email"
          className="input w-full"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={busy}
        />
      </label>

      {/* Guest mix (M/F/C) — required for cover stacking */}
      <GuestMixSection
        coverRates={coverRates}
        male={male} female={female} couples={couples}
        onMale={setMale} onFemale={setFemale} onCouples={setCouples}
        disabled={busy}
        requiredPax={requiredPax}
        selectedPax={selectedPax}
      />

      {/* Live breakdown */}
      <PriceBreakdown
        mode={mode}
        pricing={pricing}
        paymentGatewayFeePct={paymentGatewayFeePct}
        platformFeePct={platformFeePct}
        gstPercent={gstPercent}
        gstEnabled={gstEnabled}
      />

      {/* Errors */}
      {status.kind === 'error' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          {status.message}
        </div>
      )}

      {/* CTA */}
      <button
        type="submit"
        disabled={busy || !paxValid || !name.trim() || !phone.trim()}
        className="btn btn-primary w-full !py-3"
      >
        {status.kind === 'reserving' ? 'Reserving…' :
         status.kind === 'creating-order' ? 'Starting payment…' :
         status.kind === 'awaiting-payment' ? 'Opening Razorpay…' :
         status.kind === 'verifying' ? 'Verifying…' :
         `Pay ₹${Math.round(pricing.total).toLocaleString('en-IN')}`}
      </button>
    </form>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function TicketTypePicker({
  hasEntry, hasTables, hasZones, mode, onChange, disabled,
}: {
  hasEntry: boolean;
  hasTables: boolean;
  hasZones: boolean;
  mode: TicketMode;
  onChange: (m: TicketMode) => void;
  disabled?: boolean;
}) {
  const options: Array<{ key: TicketMode; label: string; hint: string; visible: boolean }> = (
    [
      { key: 'table' as const, label: 'Table',           hint: 'Reserve a whole table',     visible: hasTables },
      { key: 'zone'  as const, label: 'Seating',         hint: 'Pick a section',            visible: hasZones },
      { key: 'entry' as const, label: 'General Entry',   hint: 'Pay per person at the door',visible: hasEntry },
    ] satisfies Array<{ key: TicketMode; label: string; hint: string; visible: boolean }>
  ).filter((o) => o.visible);

  if (options.length <= 1) return null; // nothing to pick

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-slate-600">Ticket type</div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            disabled={disabled}
            className={
              'rounded-lg border px-3 py-2.5 text-left transition disabled:opacity-50 ' +
              (mode === o.key
                ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                : 'border-slate-200 bg-white hover:border-slate-300')
            }
          >
            <div className={`text-sm font-semibold ${mode === o.key ? 'text-brand-700' : 'text-slate-900'}`}>
              {o.label}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{o.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TablePicker({
  tableTypes, selectedId, onSelect, disabled,
}: {
  tableTypes: TableType[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-slate-600">Pick a table</div>
      <div className="grid grid-cols-1 gap-1.5">
        {tableTypes.map((t) => {
          const price = t.phasePrice ?? t.basePrice;
          const isSelected = selectedId === t.id;
          const soldOut = t.remaining !== null && t.remaining <= 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => !soldOut && onSelect(t.id)}
              disabled={disabled || soldOut}
              className={
                'rounded-lg border px-3 py-2.5 flex items-center justify-between transition disabled:opacity-50 ' +
                (isSelected
                  ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                  : 'border-slate-200 bg-white hover:border-slate-300')
              }
            >
              <div className="text-left">
                <div className={`text-sm font-semibold ${isSelected ? 'text-brand-700' : 'text-slate-900'}`}>
                  {t.name}
                </div>
                <div className="text-[11px] text-slate-500">
                  Seats {t.capacity}
                  {t.phaseName && ` · ${t.phaseName}`}
                  {t.remaining !== null && ` · ${soldOut ? 'sold out' : `${t.remaining} left`}`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold font-mono text-slate-900">
                  ₹{price.toLocaleString('en-IN')}
                </div>
                {t.phasePrice != null && t.phasePrice !== t.basePrice && (
                  <div className="text-[10px] text-slate-400 line-through font-mono">
                    ₹{t.basePrice.toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ZonePicker({
  zones, selectedId, onSelect, disabled,
}: {
  zones: Zone[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-slate-600">Pick a section</div>
      <div className="grid grid-cols-1 gap-1.5">
        {zones.map((z) => {
          const price = z.phasePrice ?? z.pricePerSeat;
          const isSelected = selectedId === z.id;
          const soldOut = z.remaining <= 0;
          return (
            <button
              key={z.id}
              type="button"
              onClick={() => !soldOut && onSelect(z.id)}
              disabled={disabled || soldOut}
              className={
                'rounded-lg border px-3 py-2.5 flex items-center justify-between transition disabled:opacity-50 ' +
                (isSelected
                  ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                  : 'border-slate-200 bg-white hover:border-slate-300')
              }
            >
              <div className="text-left">
                <div className={`text-sm font-semibold ${isSelected ? 'text-brand-700' : 'text-slate-900'}`}>
                  {z.label}
                </div>
                <div className="text-[11px] text-slate-500">
                  {soldOut ? 'sold out' : `${z.remaining} seats left`}
                </div>
              </div>
              <div className="text-sm font-bold font-mono text-slate-900">
                ₹{price.toLocaleString('en-IN')}<span className="text-[10px] font-normal text-slate-500">/seat</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GuestMixSection({
  coverRates,
  male, female, couples,
  onMale, onFemale, onCouples,
  disabled,
  requiredPax,
  selectedPax,
}: {
  coverRates: CoverRates;
  male: number; female: number; couples: number;
  onMale: (n: number) => void;
  onFemale: (n: number) => void;
  onCouples: (n: number) => void;
  disabled?: boolean;
  requiredPax: number | null;
  selectedPax: number;
}) {
  const showWarning = requiredPax !== null && selectedPax !== requiredPax;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold text-slate-900">Guest mix</div>
        <div className={`text-[11px] font-medium ${showWarning ? 'text-rose-600' : 'text-slate-500'}`}>
          {selectedPax} {requiredPax !== null ? `/ ${requiredPax}` : ''} guests
        </div>
      </div>
      <GuestRow label="Male" sub={`₹${coverRates.male_stag.toLocaleString('en-IN')} per person`}
        count={male} unit={coverRates.male_stag}
        onDec={() => onMale(Math.max(0, male - 1))} onInc={() => onMale(male + 1)}
        disabled={disabled} />
      <GuestRow label="Female" sub={`₹${coverRates.female_stag.toLocaleString('en-IN')} per person`}
        count={female} unit={coverRates.female_stag}
        onDec={() => onFemale(Math.max(0, female - 1))} onInc={() => onFemale(female + 1)}
        disabled={disabled} />
      <GuestRow label="Couple" sub={`₹${coverRates.couple.toLocaleString('en-IN')} per couple · 2 pax`}
        count={couples} unit={coverRates.couple}
        onDec={() => onCouples(Math.max(0, couples - 1))} onInc={() => onCouples(couples + 1)}
        disabled={disabled} />
      {showWarning && (
        <div className="text-[11px] text-rose-600 pt-1">
          Adjust the mix to sum to {requiredPax}. Currently {selectedPax}.
        </div>
      )}
    </div>
  );
}

function GuestRow({
  label, sub, count, unit, disabled, onInc, onDec,
}: {
  label: string; sub: string; count: number; unit: number;
  disabled?: boolean; onInc: () => void; onDec: () => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-white rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-[11px] text-slate-500">{sub}</div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onDec} disabled={disabled || count === 0}
          className="w-7 h-7 rounded-md border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition">−</button>
        <div className="min-w-[24px] text-center text-sm font-semibold tabular-nums">{count}</div>
        <button type="button" onClick={onInc} disabled={disabled}
          className="w-7 h-7 rounded-md border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition">+</button>
      </div>
      <div className="min-w-[64px] text-right text-xs font-mono text-slate-600 tabular-nums">
        {count > 0 ? `₹${(count * unit).toLocaleString('en-IN')}` : '—'}
      </div>
    </div>
  );
}

function PriceBreakdown({
  mode, pricing, paymentGatewayFeePct, platformFeePct, gstPercent, gstEnabled,
}: {
  mode: TicketMode;
  pricing: {
    entryBase: number; cover: number; base: number; discount: number;
    subtotal: number; gateway: number; platform: number; gst: number; total: number;
  };
  paymentGatewayFeePct: number;
  platformFeePct: number;
  gstPercent: number;
  gstEnabled: boolean;
}) {
  if (pricing.total <= 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-1">
      <Row label={mode === 'table' ? 'Table' : mode === 'zone' ? 'Seats' : 'Entry'} value={pricing.entryBase} />
      <Row label="Cover charges" value={pricing.cover} />
      {pricing.discount > 0 && <Row label="Discount" value={-pricing.discount} tone="emerald" />}
      {pricing.gateway > 0 && <Row label={`Gateway fee (${paymentGatewayFeePct}%)`} value={pricing.gateway} small />}
      {pricing.platform > 0 && <Row label={`Platform fee (${platformFeePct}%)`} value={pricing.platform} small />}
      {gstEnabled && pricing.gst > 0 && <Row label={`GST (${gstPercent}%)`} value={pricing.gst} small />}
      <div className="border-t border-slate-100 pt-2 mt-2 flex items-baseline justify-between">
        <div className="text-sm font-semibold text-slate-900">Total</div>
        <div className="text-xl font-bold text-slate-900 font-mono">
          ₹{pricing.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone, small }: { label: string; value: number; tone?: 'emerald'; small?: boolean }) {
  const cls = tone === 'emerald' ? 'text-emerald-700' : small ? 'text-slate-500' : 'text-slate-700';
  return (
    <div className="flex items-baseline justify-between">
      <div className={`text-xs ${small ? 'text-slate-400' : 'text-slate-500'}`}>{label}</div>
      <div className={`${small ? 'text-xs' : 'text-sm'} ${cls} font-mono`}>
        {value < 0 ? '−' : ''}₹{Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, Number(v) || 0));
}

function labelForMode(mode: TicketMode, table: TableType | null, zone: Zone | null): string {
  if (mode === 'table' && table) return table.name;
  if (mode === 'zone' && zone) return zone.label;
  return 'General Entry';
}

function descriptionForMode(
  mode: TicketMode, table: TableType | null, zone: Zone | null, pax: number,
): string {
  if (mode === 'table' && table) return `${table.name} · ${pax} guests`;
  if (mode === 'zone' && zone) return `${zone.label} · ${pax} guests`;
  return `General Entry · ${pax} guests`;
}

/* ───────────────────────────────────────────────────────────────────────────
 * BACKEND TODOs for wiring this as the production booking form
 * ─────────────────────────────────────────────────────────────────────────── */
//
// 1. SCHEMA — add to `reservations`:
//      table_type_id      TEXT      (FK ref to events.table_types[i].id; nullable)
//      table_type_name    TEXT      (denormalized for audit)
//      table_capacity     INTEGER   (denormalized for audit)
//    Run an idempotent addResCol() migration in src/lib/db.ts.
//
// 2. PUBLIC EVENT ROUTE — extend /api/events/by-slug/[slug]/public to expose:
//      tableTypes: Array<TableType>
//    where each item is:
//      {
//        id, name, capacity, basePrice: entry_fee, remaining,
//        phasePrice?: number, phaseName?: string
//      }
//    Phase-aware prices come from the existing getPhasePricesForBooking()
//    helper — filter to scope='table_type' and project onto each table id.
//    Remaining inventory = table_types[i].inventory − sold_count, where
//    sold_count = count of reservations with table_type_id = this id AND
//    status IN ('pending', 'converted').
//
// 3. RESERVATION ROUTE — /api/reservations/public accepts:
//      ticketMode: 'entry' | 'table' | 'zone'
//      tableTypeId?: string
//      zoneId?: string
//    Server validates:
//      - mode === 'table'  → tableTypeId required, look up table type,
//                            enforce pax === table.capacity, decrement
//                            inventory (or count-on-read).
//      - mode === 'zone'   → zoneId required, enforce pax ≤ zone remaining.
//      - mode === 'entry'  → both ids ignored.
//    Persist table_type_id / table_type_name / table_capacity to row.
//
// 4. PAYMENT ORDER ROUTE — /api/payments/order:
//      When reservation.table_type_id is set:
//        - Look up active phase price: getActivePhasePrice(eventId, 'table_type', tableTypeId)
//          Fall back to table.entry_fee from events.table_types JSON.
//        - Set pricePerUnit = that price.
//        - Set pricedPax = 1  ← flat billing, not × pax. Cover is still
//          computed from genderMix so it scales with actual headcount.
//      For zone bookings (existing path) keep pricedPax = pax.
//      For flat entry (existing path) keep pricedPax = pax.
//
// 5. PRICING CALCULATOR — no changes needed. The current code already does
//    `base = perUnitOverride * pax + cover`. When pax=1 + perUnitOverride=
//    table_price + cover from M/F/C → base = table_price + cover ✓
//
// 6. DISPLAY — show table_type_name on:
//      /admin/reservations row (next to the existing "MFC" pill)
//      /admin/bookings row (the new column we just built)
//      Customer wallet pass on /w/[token]
//
// All ~3-5 hours of focused work. Happy to ship in one commit if you want
// this wired as the production form.
