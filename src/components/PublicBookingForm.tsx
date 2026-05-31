'use client';

import { useState } from 'react';
import { PhoneInput } from './PhoneInput';
import { fireMetaEvent } from './MetaPixel';
import {
  openRazorpayCheckout,
  type RazorpaySuccessResponse,
  type RazorpayFailureError,
} from './RazorpayCheckout';
import { SeatingPicker, type PublicZone } from './SeatingPicker';
import type { FieldDef } from '@/lib/events';

/**
 * Public-facing reservation form rendered on /event/[slug]. Unauthenticated
 * customers fill this in to reserve a slot. On submit it POSTs to
 * /api/reservations/public along with any Meta click-attribution values
 * (_fbp, _fbc cookies + raw fbclid from the URL) so the backend can mirror
 * the Lead event server-side via the Conversions API.
 *
 * Fields:
 *   - name   (required, 2+ chars)
 *   - phone  (required, E.164 via PhoneInput)
 *   - pax    (required number, default 2)
 *   - notes  (optional textarea)
 *
 * Payment flow (when `paymentMode` !== 'none'):
 *   1. POST /api/reservations/public  → reservationId (status: pending)
 *   2. POST /api/payments/order { reservationId } → razorpayOrderId + keyId + amount + customer
 *   3. Open Razorpay checkout via the imperative helper in RazorpayCheckout.tsx
 *   4. On success → POST /api/payments/verify → confirm UI
 *   5. On failure → keep reservation as pending, surface retry
 *   6. On dismiss → show cancelled banner, reservation stays pending
 *
 * Meta Pixel events fired:
 *   - 'Lead'              → on successful reservation create (always)
 *   - 'InitiateCheckout'  → when Razorpay modal opens (paid flow)
 *   - 'Purchase'          → on verified payment success (paid flow)
 */

/**
 * Phase 3 access modes.
 *   - 'public'      — anyone can book (default)
 *   - 'invite_link' — booking only with ?invite=<secret> token in the URL
 *   - 'phone_list'  — booking only for phone numbers on the event's invitee list
 *
 * Exported so the public event page can type its access_mode field.
 */
export type AccessMode = 'public' | 'invite_link' | 'phone_list';

/**
 * Phase 3 multi-slot picker shape — the active slots returned from the
 * extended public event payload. `remaining_capacity` is optional: when
 * null/undefined we render the slot without a capacity hint.
 */
export interface EventSlot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string | null;
  label: string | null;
  max_capacity: number | null;
  remaining_capacity: number | null;
}

interface Props {
  eventSlug: string;
  eventName: string;
  eventDate: string;
  /** Payment configuration for this event. Defaults to 'none'. */
  paymentMode?: 'none' | 'deposit' | 'full_cover';
  /** Display-only INR rupee amount preview. Server re-computes actual charge. */
  paymentAmount?: number | null;
  /** Event id — needed for coupon validation. Optional for backward compat. */
  eventId?: string;
  /**
   * Phase 3: which gate the server will enforce on submit. The form uses this
   * only to (a) decide whether to require a slot pick, (b) tailor 403 copy.
   * Defaults to 'public' for legacy callers.
   */
  accessMode?: AccessMode;
  /**
   * Phase 3: invite token captured from the URL (?invite=) by the page. Always
   * forwarded to /api/reservations/public so the server can constant-time
   * compare against event.invite_secret. Null when no token was supplied.
   */
  inviteToken?: string | null;
  /**
   * Phase 3: active slots — when non-empty, the form renders a required slot
   * picker and includes `slotId` in the POST body. Empty means single
   * implicit slot (event_date + start_time fallback).
   */
  slots?: EventSlot[];
  /**
   * Phase 4: host-configured custom RSVP fields. Rendered after the standard
   * inputs (after the slot picker, before notes). Empty/undefined means no
   * custom fields — the form is identical to the legacy version.
   */
  rsvpFields?: FieldDef[];
  /**
   * Seating Layout: when true, render the interactive <SeatingPicker/>
   * above the pax input. The customer must pick a zone before submit;
   * the zone's price overrides the flat per-pax entry fee on the server.
   * Defaults to false so every legacy event renders exactly as it does
   * today.
   */
  seatingLayoutEnabled?: boolean;
  /**
   * Server-sanitized SVG markup. Only meaningful when
   * `seatingLayoutEnabled` is true. Null on events without an uploaded
   * layout.
   */
  seatingLayoutSvg?: string | null;
  /**
   * Public projection of event_zones rows for this event. Empty when
   * the host hasn't defined zones yet (the form falls back to the
   * legacy flat-pricing flow with an inline notice).
   */
  zones?: PublicZone[];
  /**
   * Per-event Settings — fee payer config + GST flag. When any of these
   * means a fee/GST is added on top, the form renders a line-item
   * breakdown above the CTA so the customer sees the all-in math. When
   * all three are host-paid / GST-off, the form shows a single all-in
   * price like before. Defaults keep legacy events unchanged.
   */
  paymentGatewayFeePayer?: 'customer' | 'host';
  platformFeePayer?: 'customer' | 'host';
  gstEnabled?: boolean;
  /**
   * Percentages used to build the customer-facing line items. Server is
   * still the source of truth for the actual charge (see
   * /api/payments/order → computeBilling()); these are platform constants
   * leaked so the form doesn't need an extra preview round-trip on every
   * pax/zone change.
   */
  paymentGatewayFeePct?: number;
  platformFeePct?: number;
  gstPercent?: number;
  discountPercent?: number;
}

/**
 * Successfully validated coupon snapshot. We hold this in component state
 * once /api/coupons/validate returns ok so the CTA reflects the discount
 * and the order-create call forwards the code.
 */
interface AppliedCoupon {
  code: string;
  discount: number; // INR rupees
  finalAmount: number; // INR rupees
}

interface CouponValidateResponse {
  ok: boolean;
  discountAmount?: number;
  finalAmount?: number;
  reason?: string;
  error?: string;
}

interface OrderResponse {
  ok: boolean;
  razorpayOrderId?: string;
  amount?: number; // paise
  currency?: string;
  keyId?: string;
  customer?: { name: string; phone: string; email?: string };
  eventName?: string;
  error?: string;
}

interface VerifyResponse {
  ok: boolean;
  txnId?: string;
  error?: string;
}

interface ReservationResponse {
  ok: boolean;
  reservationId?: string;
  message?: string;
  error?: string;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function readFbclidFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('fbclid');
    return v && v.trim().length > 0 ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Phase 3 — render a slot's date + start (and end if present) into a single
 * human-friendly string. Used by the slot picker. Falls back to the raw
 * strings if Date parsing fails so we never show "Invalid Date" to a
 * customer.
 */
function formatSlotLabel(slot: EventSlot): string {
  const datePart = (() => {
    try {
      const d = new Date(`${slot.slot_date}T00:00:00`);
      if (Number.isNaN(d.getTime())) return slot.slot_date;
      return d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return slot.slot_date;
    }
  })();
  const timePart = slot.end_time
    ? `${slot.start_time}–${slot.end_time}`
    : slot.start_time;
  const labelPart = slot.label ? ` · ${slot.label}` : '';
  return `${datePart} · ${timePart}${labelPart}`;
}

function formatRupees(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '';
  // Compact INR formatting — no decimals if a whole number.
  const isWhole = Math.round(amount) === amount;
  return isWhole
    ? `${amount.toLocaleString('en-IN')}`
    : amount.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Mirrors src/lib/pricing-calculator.ts → computeBilling() but client-side
 * for the booking-form preview. Server still recomputes on order-create so a
 * tampered client cannot under-pay. Keep this in sync with the server math.
 */
interface ClientBreakdown {
  base: number;
  discount: number;
  subtotal: number;
  gateway_fee: number;
  platform_fee: number;
  gst: number;
  final: number;
}

function computeClientBreakdown(args: {
  base: number;
  discountPercent: number;
  couponDiscount: number;
  gatewayPayer: 'customer' | 'host';
  platformPayer: 'customer' | 'host';
  gstEnabled: boolean;
  gatewayPct: number;
  platformPct: number;
  gstPct: number;
}): ClientBreakdown {
  const base = Math.max(0, round2(args.base));
  const pctDiscount = round2(base * (Math.min(100, Math.max(0, args.discountPercent)) / 100));
  const couponDiscount = Math.max(0, round2(args.couponDiscount));
  const discount = round2(Math.min(base, pctDiscount + couponDiscount));
  const subtotal = Math.max(0, round2(base - discount));
  const gatewayFee =
    args.gatewayPayer === 'customer'
      ? round2(subtotal * (Math.min(100, Math.max(0, args.gatewayPct)) / 100))
      : 0;
  const platformFee =
    args.platformPayer === 'customer'
      ? round2(subtotal * (Math.min(100, Math.max(0, args.platformPct)) / 100))
      : 0;
  const preGst = round2(subtotal + gatewayFee + platformFee);
  const gst = args.gstEnabled
    ? round2(preGst * (Math.min(100, Math.max(0, args.gstPct)) / 100))
    : 0;
  const final = round2(preGst + gst);
  return {
    base,
    discount,
    subtotal,
    gateway_fee: gatewayFee,
    platform_fee: platformFee,
    gst,
    final,
  };
}

type Status =
  | { kind: 'idle' }
  | { kind: 'reserving' }
  | { kind: 'creating-order' }
  | { kind: 'awaiting-payment' }
  | { kind: 'verifying' }
  | { kind: 'success'; message: string; txnId?: string }
  | { kind: 'reserved-no-payment'; message: string } // free flow success
  | { kind: 'error'; message: string }
  | { kind: 'payment-cancelled' };

export function PublicBookingForm({
  eventSlug,
  eventName,
  eventDate,
  paymentMode = 'none',
  paymentAmount = null,
  eventId,
  accessMode = 'public',
  inviteToken = null,
  slots = [],
  rsvpFields = [],
  seatingLayoutEnabled = false,
  seatingLayoutSvg = null,
  zones = [],
  paymentGatewayFeePayer = 'host',
  platformFeePayer = 'host',
  gstEnabled = false,
  paymentGatewayFeePct = 0,
  platformFeePct = 0,
  gstPercent = 0,
  discountPercent = 0,
}: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(''); // E.164 from PhoneInput; '' when invalid
  const [pax, setPax] = useState<number>(2);
  const [notes, setNotes] = useState('');

  // Phase 4 — dynamic RSVP answers keyed by FieldDef.id. checkbox fields
  // store a string[] (the picked options); every other type stores a
  // single string. Errors are surfaced by id from the server's per-field
  // 400 response OR client-side required checks.
  const hasRsvpFields = rsvpFields.length > 0;
  const [rsvpAnswers, setRsvpAnswers] = useState<Record<string, string | string[]>>({});
  const [rsvpErrors, setRsvpErrors] = useState<Record<string, string>>({});

  // Phase 3 slot picker state. When the event ships zero active slots, this
  // stays '' and the form skips the picker entirely (server uses event_date
  // + start_time as fallback).
  const hasSlots = slots.length > 0;
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');

  // Seating Layout — the picker is rendered when the host has both turned
  // the feature ON and uploaded a parseable SVG with at least one zone.
  // Defensive: if zones is empty (host enabled the toggle but never saved
  // zones), we treat seating as effectively off and surface an inline
  // notice instead of breaking the booking flow.
  const hasSeating =
    !!seatingLayoutEnabled &&
    typeof seatingLayoutSvg === 'string' &&
    seatingLayoutSvg.length > 0 &&
    zones.length > 0;
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const selectedZone = hasSeating && selectedZoneId
    ? zones.find((z) => z.id === selectedZoneId) || null
    : null;
  // Compute remaining capacity for the picked zone defensively — backend
  // ships remaining_capacity, but fall back to capacity - sold_count so a
  // pre-migration payload doesn't break the validator below.
  const selectedZoneRemaining = selectedZone
    ? typeof selectedZone.remaining_capacity === 'number' &&
      Number.isFinite(selectedZone.remaining_capacity)
      ? Math.max(0, selectedZone.remaining_capacity)
      : Math.max(0, selectedZone.capacity - selectedZone.sold_count)
    : 0;
  // Surface a per-pax-exceeds-zone-remaining inline error WITHOUT blowing
  // away the form-level status (e.g. busy/idle). Cleared every time the
  // customer changes pax or picks a different zone.
  const zoneOverPax =
    hasSeating && selectedZone ? pax > selectedZoneRemaining : false;

  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Coupon state — independent of the main submit state machine so the user
  // can apply/clear a coupon without disturbing form-level errors.
  const [couponCode, setCouponCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);

  const isPaid = paymentMode !== 'none';
  const busy =
    status.kind === 'reserving' ||
    status.kind === 'creating-order' ||
    status.kind === 'awaiting-payment' ||
    status.kind === 'verifying';

  function reset() {
    setName('');
    setPhone('');
    setPax(2);
    setNotes('');
    setCouponCode('');
    setCouponError(null);
    setAppliedCoupon(null);
    setSelectedSlotId('');
    setRsvpAnswers({});
    setRsvpErrors({});
    setSelectedZoneId(null);
  }

  /**
   * Per-field onChange handlers for the dynamic RSVP renderer below.
   *
   * setSingle is used for text / textarea / dropdown / radio — a single string.
   * toggleMulti is used for checkbox — toggles the option in the string[].
   * Both clear the per-field error on edit so it doesn't linger after the
   * customer fixes the input.
   */
  function setSingle(fieldId: string, value: string) {
    setRsvpAnswers((s) => ({ ...s, [fieldId]: value }));
    if (rsvpErrors[fieldId]) {
      setRsvpErrors((e) => {
        const next = { ...e };
        delete next[fieldId];
        return next;
      });
    }
  }

  function toggleMulti(fieldId: string, option: string) {
    setRsvpAnswers((s) => {
      const prev = Array.isArray(s[fieldId]) ? (s[fieldId] as string[]) : [];
      const next = prev.includes(option)
        ? prev.filter((o) => o !== option)
        : [...prev, option];
      return { ...s, [fieldId]: next };
    });
    if (rsvpErrors[fieldId]) {
      setRsvpErrors((e) => {
        const next = { ...e };
        delete next[fieldId];
        return next;
      });
    }
  }

  /**
   * Client-side required-field check. The server re-validates everything
   * (see /api/reservations/public + validateRsvpAnswers), but catching it
   * here saves a round-trip and surfaces inline errors before submit.
   *
   * Returns a per-id error map. Empty map = good to submit.
   */
  function validateRsvpClientSide(): Record<string, string> {
    const errs: Record<string, string> = {};
    for (const f of rsvpFields) {
      if (!f.required) continue;
      const v = rsvpAnswers[f.id];
      if (f.type === 'checkbox') {
        if (!Array.isArray(v) || v.length === 0) {
          errs[f.id] = 'Please pick at least one option.';
        }
      } else {
        const s = typeof v === 'string' ? v.trim() : '';
        if (!s) errs[f.id] = 'This field is required.';
      }
    }
    return errs;
  }

  /**
   * Validate the typed coupon code against /api/coupons/validate. Pure
   * preview — does NOT consume the coupon. On success we stash the
   * snapshot in appliedCoupon so the CTA + order-create reflect it.
   *
   * paymentAmount is the display-hint subtotal from the server payload.
   * If it's null/0 (free flow) we shouldn't be here — the section is
   * hidden in that case.
   */
  async function handleApplyCoupon() {
    const trimmed = couponCode.trim().toUpperCase();
    if (!trimmed) {
      setCouponError('Please enter a code.');
      return;
    }
    if (paymentAmount == null || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setCouponError('No payable amount to discount.');
      return;
    }
    setCouponBusy(true);
    setCouponError(null);
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: trimmed,
          eventId: eventId || undefined,
          eventSlug, // backend may key by slug if eventId is unavailable
          subtotal: paymentAmount,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as CouponValidateResponse;
      if (!res.ok || !json?.ok) {
        // Generic error message — don't leak whether the code exists.
        setCouponError(json?.reason || json?.error || 'Invalid or expired');
        setAppliedCoupon(null);
        return;
      }
      const discount = Number(json.discountAmount ?? 0);
      const finalAmount =
        Number.isFinite(Number(json.finalAmount))
          ? Number(json.finalAmount)
          : Math.max(0, paymentAmount - discount);
      setAppliedCoupon({
        code: trimmed,
        discount,
        finalAmount,
      });
      setCouponCode(trimmed);
    } catch {
      setCouponError('Could not validate. Please try again.');
      setAppliedCoupon(null);
    } finally {
      setCouponBusy(false);
    }
  }

  function handleRemoveCoupon() {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponError(null);
  }

  function setError(message: string) {
    setStatus({ kind: 'error', message });
  }

  /**
   * Create the pending reservation. Returns the reservationId on success
   * (always fires Pixel Lead), or null on failure (status already set).
   */
  async function createReservation(): Promise<string | null> {
    // Read Meta attribution from cookies + URL. Prefer the helper exposed
    // by MetaPixelCapture; fall back to direct cookie reads so the form
    // still works if the capture component is ever unmounted.
    const w = window as unknown as {
      __getFbCookies?: () => { fbp: string | null; fbc: string | null };
    };
    const fb = w.__getFbCookies
      ? w.__getFbCookies()
      : { fbp: readCookie('_fbp'), fbc: readCookie('_fbc') };
    const fbclid = readFbclidFromUrl();

    const res = await fetch('/api/reservations/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventSlug,
        name: name.trim(),
        phone,
        pax,
        notes: notes.trim() || undefined,
        fbp: fb.fbp || undefined,
        fbc: fb.fbc || undefined,
        fbclid: fbclid || undefined,
        // Phase 3 — always include if available. Server ignores when
        // access_mode='public'.
        invite: inviteToken || undefined,
        slotId: selectedSlotId || undefined,
        // Phase 4 — custom RSVP answers, keyed by FieldDef.id. Always sent
        // (server short-circuits when the event has no custom fields).
        rsvpAnswers: hasRsvpFields ? rsvpAnswers : undefined,
        // Seating Layout — when the host has enabled per-zone pricing the
        // server requires zoneId on the reservation. Only forwarded when
        // the feature is active so legacy events keep their existing
        // payload shape. Key matches the server contract (camelCase).
        zoneId: hasSeating ? selectedZoneId : undefined,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as ReservationResponse & {
      errors?: Record<string, string>;
    };
    if (!res.ok || !json?.ok) {
      // Phase 4 — server returned per-field errors. Surface them inline so
      // the customer can fix each input in place rather than re-reading a
      // generic toast.
      if (res.status === 400 && json?.errors && typeof json.errors === 'object') {
        setRsvpErrors(json.errors);
      }
      // Phase 3 — surface gate-specific copy so the customer knows why.
      if (res.status === 403) {
        if (accessMode === 'phone_list') {
          setError(
            "Sorry, your number isn't on the guest list for this event.",
          );
        } else if (accessMode === 'invite_link') {
          setError(
            'This invite link is invalid or has expired. Please check the link sent to you.',
          );
        } else {
          setError(json?.error || 'This booking was blocked. Please contact the host.');
        }
        return null;
      }
      // Slot raced — capacity conflict. The server returns 409 when a slot
      // just filled up. Surface the server's hint when present.
      if (res.status === 409) {
        setError(
          json?.error ||
            'That time slot just filled up — please pick another slot and try again.',
        );
        return null;
      }
      setError(json?.error || 'Something went wrong. Please try again.');
      return null;
    }

    // Fire Pixel Lead client-side (server-side CAPI Lead fires too, deduped
    // by event_id on the backend).
    fireMetaEvent('Lead', {
      content_name: eventName,
      currency: 'INR',
      value: 0,
    });

    return json.reservationId || null;
  }

  async function handleFreeFlowSubmit() {
    setStatus({ kind: 'reserving' });
    const reservationId = await createReservation();
    if (!reservationId && status.kind !== 'error') {
      // Older backends may not return a reservationId; treat as success
      // anyway as long as the API returned ok.
    }
    setStatus({
      kind: 'reserved-no-payment',
      message: "Reservation received — we'll WhatsApp you to confirm.",
    });
    reset();
  }

  async function handlePaidFlowSubmit() {
    setStatus({ kind: 'reserving' });
    const reservationId = await createReservation();
    if (!reservationId) {
      // Either createReservation set an error already, or we got no id.
      if (status.kind !== 'error') {
        setError(
          'We saved your details but could not start payment. Please try again.',
        );
      }
      return;
    }

    // Create the Razorpay order on the server.
    setStatus({ kind: 'creating-order' });
    // Forward the per-session analytics id (set by <EventAnalyticsTracker>
    // into sessionStorage on first page-view) so the server can stitch the
    // eventual checkout_success / checkout_failed funnel rows back to the
    // originating page-view + book_click. Safe-guarded — sessionStorage is
    // unavailable in SSR / privacy modes; we just omit when missing.
    let analyticsSessionId: string | undefined;
    try {
      const sid = typeof window !== 'undefined'
        ? window.sessionStorage.getItem('evt_session_id')
        : null;
      if (sid && sid.trim()) analyticsSessionId = sid.trim();
    } catch { /* sessionStorage may throw in some sandboxes */ }

    let order: OrderResponse;
    try {
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservationId,
          // Forward the validated coupon code so the server can re-validate
          // and reduce amountPaise before creating the Razorpay order.
          couponCode: appliedCoupon?.code,
          // Analytics session id — server stashes it in payments.notes so the
          // checkout_success / checkout_failed rows emitted from verify or
          // the failure webhook are funnel-stitched to this session.
          sessionId: analyticsSessionId,
        }),
      });
      order = (await res.json().catch(() => ({}))) as OrderResponse;
      if (!res.ok || !order?.ok || !order.razorpayOrderId || !order.keyId) {
        setError(
          order?.error ||
            'Payment could not be started. Your reservation is saved — please try again or contact us.',
        );
        return;
      }
    } catch {
      setError(
        'Network error while starting payment. Your reservation is saved — please retry.',
      );
      return;
    }

    // Open the Razorpay modal.
    setStatus({ kind: 'awaiting-payment' });
    const displayAmountPaise = order.amount ?? 0;
    const displayAmountRupees = displayAmountPaise / 100;

    // Fire InitiateCheckout — modal is about to open.
    fireMetaEvent('InitiateCheckout', {
      value: displayAmountRupees,
      currency: 'INR',
      content_name: eventName,
    });
    // Fire payment_initiated — this is the funnel stage between
    // checkout_started (CTA click) and checkout_success. It signals that
    // the Razorpay order was created on the server AND the modal is about
    // to be opened on the client. The /admin/events/[id]/insights funnel
    // uses the drop-off between this and checkout_success to surface
    // payment-abandonment.
    window.__trackEvent?.('payment_initiated', {
      amount: displayAmountRupees,
      pax,
      zoneId: hasSeating ? selectedZoneId : undefined,
    });

    try {
      await openRazorpayCheckout({
        keyId: order.keyId,
        orderId: order.razorpayOrderId,
        amount: displayAmountPaise,
        currency: order.currency || 'INR',
        name: order.eventName || eventName,
        description: `Booking for ${eventName} · ${eventDate}`,
        customerName: order.customer?.name || name.trim(),
        customerPhone: order.customer?.phone || phone,
        customerEmail: order.customer?.email,
        notes: { reservationId, eventSlug },
        theme: { color: '#C1551A' },
        onSuccess: (resp) => {
          void verifyPayment(resp, displayAmountRupees);
        },
        onFailure: (err) => {
          handlePaymentFailure(err);
        },
        onDismiss: () => {
          setStatus({ kind: 'payment-cancelled' });
        },
      });
    } catch {
      setError(
        'Could not open the payment window. Please check your connection and try again.',
      );
    }
  }

  async function verifyPayment(
    resp: RazorpaySuccessResponse,
    amountRupees: number,
  ) {
    setStatus({ kind: 'verifying' });
    try {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpayOrderId: resp.razorpay_order_id,
          razorpayPaymentId: resp.razorpay_payment_id,
          razorpaySignature: resp.razorpay_signature,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as VerifyResponse;
      if (!res.ok || !json?.ok) {
        setError(
          json?.error ||
            'We could not verify your payment. If money was deducted, please contact us with your payment ID.',
        );
        return;
      }
      // Fire Pixel Purchase event on verified success.
      fireMetaEvent('Purchase', {
        value: amountRupees,
        currency: 'INR',
        content_name: eventName,
      });
      setStatus({
        kind: 'success',
        message: 'Booking confirmed! Cover pass sent to your WhatsApp.',
        txnId: json.txnId,
      });
      reset();
    } catch {
      setError(
        'Network error verifying payment. If money was deducted, please contact us with your payment ID.',
      );
    }
  }

  function handlePaymentFailure(err: RazorpayFailureError) {
    setError(
      err.description ||
        'Payment failed. Your reservation is still saved — you can retry.',
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: 'idle' });

    // Per-event analytics — fire-and-forget. CTA was clicked (this is the
    // "Reserve & Pay" / "Reserve my spot" submit button). Mirrors the Pixel
    // Lead/AddToCart taxonomy but scoped to our /admin/events/[id]/insights
    // dashboard. window.__trackEvent is installed by <EventAnalyticsTracker>
    // mounted at the top of /event/[slug]; if absent (e.g. tracker not yet
    // hydrated) the call is silently skipped via optional chaining.
    window.__trackEvent?.('book_click', {
      ctaSource: isPaid ? 'reserve_pay' : 'reserve_free',
    });
    // ticket_selected — once we know pax + (optionally) a zone is valid, the
    // customer has effectively "picked a ticket". Fired here on submit rather
    // than on every keystroke so we don't pollute the funnel with debounce
    // noise. Server-side funnel-stitching will use this as the
    // post-book_click stage.
    //
    // metadata.ticketType — the human-readable label customers see. For
    // seating events this is the zone name (e.g. "Diamond Lounge"); for
    // flat-pricing events it's the event-level "ticket" concept (we use a
    // synthetic "General Admission" so the Ticket Popularity widget still
    // shows the flat-priced event as a single bar instead of silently
    // hiding it). zoneName is duplicated as a separate field so the
    // dashboard can disambiguate seating vs. ticket-type events. Uses the
    // outer-scope `selectedZone` which is already memo'd off
    // (hasSeating, selectedZoneId, zones).
    const ticketType = selectedZone
      ? selectedZone.zone_label
      : 'General Admission';
    window.__trackEvent?.('ticket_selected', {
      pax,
      zoneId: hasSeating ? selectedZoneId : undefined,
      zoneName: selectedZone ? selectedZone.zone_label : undefined,
      ticketType,
    });
    // checkout_started — fires the instant the customer commits to the
    // paid flow (CTA click), BEFORE we hit /api/payments/order. The next
    // funnel stage is payment_initiated, which fires only once the
    // Razorpay order is created and the modal is about to open. Free-flow
    // events skip both checkout_started and payment_initiated.
    if (isPaid) {
      window.__trackEvent?.('checkout_started', {
        pax,
        zoneId: hasSeating ? selectedZoneId : undefined,
      });
    }

    // Client-side validation
    if (name.trim().length < 2) {
      setError('Please enter your name.');
      return;
    }
    if (!phone) {
      setError('Please enter a valid mobile number.');
      return;
    }
    if (!Number.isFinite(pax) || pax < 1 || pax > 50) {
      setError('Pax must be between 1 and 50.');
      return;
    }
    // Phase 3 — when the event has active slots, the customer must pick one
    // before submitting. Server re-validates that the slot belongs to this
    // event and still has capacity.
    if (hasSlots && !selectedSlotId) {
      setError('Please pick a time slot.');
      return;
    }
    // Seating Layout — zone is required when the feature is on. Validate
    // pax fits the zone before we hit the wire; server re-validates with
    // a transactional lock so this is just a UX shortcut.
    if (hasSeating) {
      if (!selectedZoneId || !selectedZone) {
        setError('Please pick a seating zone.');
        return;
      }
      if (zoneOverPax) {
        setError(
          `Only ${selectedZoneRemaining} seats remaining in ${selectedZone.zone_label}.`,
        );
        return;
      }
    }
    // Phase 4 — required RSVP fields. Server re-validates so this is just a
    // UX shortcut to surface inline errors without a round-trip.
    if (hasRsvpFields) {
      const errs = validateRsvpClientSide();
      if (Object.keys(errs).length > 0) {
        setRsvpErrors(errs);
        setError('Please complete the required questions below.');
        return;
      }
      setRsvpErrors({});
    }

    if (isPaid) {
      await handlePaidFlowSubmit();
    } else {
      await handleFreeFlowSubmit();
    }
  }

  // ----- Per-event fee/GST line-items -----
  // Show a breakdown ONLY when at least one of gateway/platform/GST flags
  // would add a customer-facing line. When everything is host-paid + GST
  // off we keep the legacy single all-in price display (per spec).
  const showFeeBreakdown =
    isPaid &&
    (paymentGatewayFeePayer === 'customer' ||
      platformFeePayer === 'customer' ||
      gstEnabled);

  // Base subtotal used for the breakdown — zone price × pax overrides the
  // server-supplied paymentAmount when a zone is picked, otherwise we use
  // the display-hint paymentAmount × pax-factor (server's paymentAmount is
  // already total for full_cover at pax=1; we multiply when full_cover
  // mode and a higher pax is selected).
  const breakdownBase: number | null = (() => {
    if (hasSeating && selectedZone) {
      return selectedZone.price * Math.max(1, pax);
    }
    if (paymentMode === 'full_cover' && paymentAmount != null) {
      // paymentAmount from the public route is computed at pax=1, so scale
      // up to match what the server will actually bill for this pax.
      return paymentAmount * Math.max(1, pax);
    }
    return paymentAmount ?? null;
  })();

  const liveBreakdown: ClientBreakdown | null =
    showFeeBreakdown && breakdownBase != null && breakdownBase > 0
      ? computeClientBreakdown({
          base: breakdownBase,
          discountPercent,
          couponDiscount: appliedCoupon?.discount ?? 0,
          gatewayPayer: paymentGatewayFeePayer,
          platformPayer: platformFeePayer,
          gstEnabled,
          gatewayPct: paymentGatewayFeePct,
          platformPct: platformFeePct,
          gstPct: gstPercent,
        })
      : null;

  // ----- CTA label -----
  // When a coupon is applied, the CTA shows the discounted amount so the
  // customer sees the final charge before tapping. paymentAmount is the
  // server-provided display hint; the discount is reflected client-side
  // off the validated coupon snapshot.
  //
  // Seating Layout: when a zone is selected, the per-pax price comes from
  // the zone — NOT from the event's flat entry_fee_per_person. We compute
  // the display total as (zone.price * pax) before applying the coupon.
  // The coupon's previously-validated finalAmount keyed off paymentAmount
  // is irrelevant in that case (the server re-derives final amount from
  // the zone price during /api/payments/order), so we fall back to the
  // raw zone subtotal when seating is on. This keeps the CTA honest even
  // before the customer applies a coupon.
  let ctaLabel = 'Reserve my spot';
  if (busy) {
    if (status.kind === 'reserving') ctaLabel = 'Saving…';
    else if (status.kind === 'creating-order') ctaLabel = 'Starting payment…';
    else if (status.kind === 'awaiting-payment') ctaLabel = 'Waiting for payment…';
    else if (status.kind === 'verifying') ctaLabel = 'Verifying…';
  } else if (isPaid) {
    // Live breakdown (when fees/GST are customer-paid) wins because it
    // already folds in the coupon + the zone price + the fees + GST.
    // Otherwise fall back to the legacy preference order: zone subtotal →
    // coupon final → server-supplied paymentAmount.
    const zoneSubtotal =
      hasSeating && selectedZone ? selectedZone.price * Math.max(1, pax) : null;
    const effectiveAmount = liveBreakdown
      ? liveBreakdown.final
      : zoneSubtotal != null
        ? zoneSubtotal
        : appliedCoupon
          ? appliedCoupon.finalAmount
          : paymentAmount;
    const rupees = formatRupees(effectiveAmount);
    ctaLabel = rupees ? `Reserve & Pay ₹${rupees}` : 'Reserve & Pay';
  } else if (hasSeating && selectedZone) {
    // Free-flow event with seating still shows the zone price for clarity.
    const rupees = formatRupees(selectedZone.price * Math.max(1, pax));
    ctaLabel = rupees ? `Reserve my spot · ₹${rupees}` : 'Reserve my spot';
  }

  return (
    <form
      onSubmit={handleSubmit}
      id="book"
      className="card mt-6 space-y-4 scroll-mt-6"
      aria-label={`Reserve for ${eventName} on ${eventDate}`}
    >
      <h2 className="text-lg font-bold text-slate-900">Reserve online</h2>

      {/* Seating Layout — interactive zone picker. Rendered above the rest
          of the form so the customer sees pricing before filling in their
          details. When the host has enabled the toggle but has no zones
          uploaded yet, we surface a soft notice and fall through to the
          legacy flat-pricing flow (server falls back to entry_fee_per_person
          when reservation.zone_id is null). */}
      {seatingLayoutEnabled && !hasSeating && (
        <div
          role="note"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Seating layout is being set up. Bookings use the standard pricing
          shown below for now.
        </div>
      )}

      {hasSeating && seatingLayoutSvg && (
        <SeatingPicker
          svg={seatingLayoutSvg}
          zones={zones}
          selectedZoneId={selectedZoneId}
          pax={pax}
          onSelect={setSelectedZoneId}
        />
      )}

      {/* Over-pax inline error — shown immediately on zone change/pax change
          so the customer doesn't have to hit submit to learn the math. */}
      {hasSeating && zoneOverPax && selectedZone && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          Only {selectedZoneRemaining} seats remaining in{' '}
          <span className="font-semibold">{selectedZone.zone_label}</span>.
          Reduce pax or pick a different zone.
        </div>
      )}

      <div>
        <label className="label" htmlFor="pbf-name">
          Your name
        </label>
        <input
          id="pbf-name"
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          autoComplete="name"
          required
          disabled={busy}
        />
      </div>

      <div>
        <label className="label">Mobile number</label>
        <PhoneInput
          value={phone}
          onChange={setPhone}
          required
          disabled={busy}
        />
      </div>

      <div>
        <label className="label" htmlFor="pbf-pax">
          Number of people (pax)
        </label>
        <input
          id="pbf-pax"
          type="number"
          inputMode="numeric"
          min={1}
          max={50}
          className="input"
          value={pax}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            setPax(Number.isFinite(n) ? n : 0);
          }}
          required
          disabled={busy}
        />
      </div>

      {/* Phase 3 — slot picker. Only rendered when the event has at least
          one active slot. The customer must pick one before submit; the
          server re-validates that the slot belongs to this event and still
          has remaining capacity. */}
      {hasSlots && (
        <div>
          <label className="label" htmlFor="pbf-slot">
            Pick a time slot <span className="text-rose-600">*</span>
          </label>
          <select
            id="pbf-slot"
            className="input"
            value={selectedSlotId}
            onChange={(e) => setSelectedSlotId(e.target.value)}
            required
            disabled={busy}
          >
            <option value="">Select a slot…</option>
            {slots.map((s) => {
              const cap = s.remaining_capacity;
              const soldOut =
                typeof cap === 'number' && Number.isFinite(cap) && cap <= 0;
              const capHint =
                typeof cap === 'number' && Number.isFinite(cap)
                  ? soldOut
                    ? ' — sold out'
                    : cap <= 5
                      ? ` — ${cap} left`
                      : ''
                  : '';
              return (
                <option key={s.id} value={s.id} disabled={soldOut}>
                  {formatSlotLabel(s)}
                  {capHint}
                </option>
              );
            })}
          </select>
          <div className="text-[11px] text-slate-400 mt-1">
            Choose the session you&rsquo;d like to attend.
          </div>
        </div>
      )}

      {/* Phase 4 — host-configured custom RSVP fields. Rendered between the
          slot picker and the Notes textarea so the layout flows: identity →
          attendance details → host's questions → free-form notes. The
          renderer below is inlined rather than extracted into a shared
          component because each field type wants its own form control;
          a generic <Field/> wrapper would just add an indirection. */}
      {hasRsvpFields && rsvpFields.map((f) => {
        const fieldId = `pbf-rsvp-${f.id}`;
        const err = rsvpErrors[f.id];
        const labelEl = (
          <label className="label" htmlFor={fieldId}>
            {f.label}
            {f.required && <span className="text-rose-600"> *</span>}
          </label>
        );

        if (f.type === 'textarea') {
          const value = typeof rsvpAnswers[f.id] === 'string' ? (rsvpAnswers[f.id] as string) : '';
          return (
            <div key={f.id}>
              {labelEl}
              <textarea
                id={fieldId}
                className="input min-h-[80px]"
                value={value}
                onChange={(e) => setSingle(f.id, e.target.value)}
                disabled={busy}
                maxLength={1000}
              />
              {err && <div role="alert" className="text-xs text-rose-700 mt-1">{err}</div>}
            </div>
          );
        }

        if (f.type === 'dropdown') {
          const value = typeof rsvpAnswers[f.id] === 'string' ? (rsvpAnswers[f.id] as string) : '';
          return (
            <div key={f.id}>
              {labelEl}
              <select
                id={fieldId}
                className="input"
                value={value}
                onChange={(e) => setSingle(f.id, e.target.value)}
                disabled={busy}
                required={f.required}
              >
                <option value="">Select…</option>
                {(f.options || []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {err && <div role="alert" className="text-xs text-rose-700 mt-1">{err}</div>}
            </div>
          );
        }

        if (f.type === 'radio') {
          const value = typeof rsvpAnswers[f.id] === 'string' ? (rsvpAnswers[f.id] as string) : '';
          return (
            <fieldset key={f.id}>
              <legend className="label">
                {f.label}
                {f.required && <span className="text-rose-600"> *</span>}
              </legend>
              <div className="space-y-1.5 mt-1">
                {(f.options || []).map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name={fieldId}
                      value={opt}
                      checked={value === opt}
                      onChange={() => setSingle(f.id, opt)}
                      disabled={busy}
                      className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
              {err && <div role="alert" className="text-xs text-rose-700 mt-1">{err}</div>}
            </fieldset>
          );
        }

        if (f.type === 'checkbox') {
          const picked = Array.isArray(rsvpAnswers[f.id]) ? (rsvpAnswers[f.id] as string[]) : [];
          return (
            <fieldset key={f.id}>
              <legend className="label">
                {f.label}
                {f.required && <span className="text-rose-600"> *</span>}
              </legend>
              <div className="space-y-1.5 mt-1">
                {(f.options || []).map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={picked.includes(opt)}
                      onChange={() => toggleMulti(f.id, opt)}
                      disabled={busy}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
              {err && <div role="alert" className="text-xs text-rose-700 mt-1">{err}</div>}
            </fieldset>
          );
        }

        // 'text' (default)
        const value = typeof rsvpAnswers[f.id] === 'string' ? (rsvpAnswers[f.id] as string) : '';
        return (
          <div key={f.id}>
            {labelEl}
            <input
              id={fieldId}
              type="text"
              className="input"
              value={value}
              onChange={(e) => setSingle(f.id, e.target.value)}
              disabled={busy}
              maxLength={1000}
            />
            {err && <div role="alert" className="text-xs text-rose-700 mt-1">{err}</div>}
          </div>
        );
      })}

      <div>
        <label className="label" htmlFor="pbf-notes">
          Notes (optional)
        </label>
        <textarea
          id="pbf-notes"
          className="input min-h-[80px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything we should know? (dietary needs, occasion, etc.)"
          maxLength={500}
          disabled={busy}
        />
      </div>

      {/* Coupon section — only when this event collects money. Rendered as
          a soft-bordered band so it's clearly optional and doesn't compete
          with required fields above. Server is the source of truth; the
          client-side validation is a UX preview only. */}
      {isPaid && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Have a coupon?
          </h3>
          {appliedCoupon ? (
            <div className="flex items-start gap-2 text-sm text-emerald-800">
              <span aria-hidden className="mt-0.5">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="10" cy="10" r="9" fill="#059669" />
                  <path
                    d="M6 10.5l2.5 2.5L14 7.5"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  Code{' '}
                  <span className="font-mono">{appliedCoupon.code}</span> applied
                </div>
                <div className="text-emerald-700">
                  ₹{formatRupees(appliedCoupon.discount)} off · new total ₹
                  {formatRupees(appliedCoupon.finalAmount)}
                </div>
                <button
                  type="button"
                  onClick={handleRemoveCoupon}
                  disabled={busy}
                  className="mt-1 text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  id="pbf-coupon"
                  type="text"
                  className="input flex-1 uppercase tracking-wide"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value.toUpperCase());
                    if (couponError) setCouponError(null);
                  }}
                  placeholder="Coupon code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={32}
                  disabled={busy || couponBusy}
                  aria-label="Coupon code"
                />
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  disabled={busy || couponBusy || couponCode.trim().length === 0}
                  className="rounded-lg border border-brand-500 bg-white px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {couponBusy ? 'Checking…' : 'Apply'}
                </button>
              </div>
              {couponError && (
                <div
                  role="alert"
                  className="text-xs font-medium text-rose-700"
                >
                  {couponError}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Per-event fee / GST line-items. Only when the host has configured at
          least one customer-paid fee or enabled GST — otherwise we keep the
          legacy single-price CTA. The numbers are computed client-side off
          the public payload's percentages; server recomputes on order
          create so a tampered client cannot under-charge. */}
      {liveBreakdown && (
        <div
          className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm space-y-1"
          aria-label="Price breakdown"
        >
          <div className="flex justify-between text-slate-700">
            <span>Ticket × {pax}</span>
            <span className="tabular-nums">₹{formatRupees(liveBreakdown.base)}</span>
          </div>
          {liveBreakdown.discount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>Discount</span>
              <span className="tabular-nums">−₹{formatRupees(liveBreakdown.discount)}</span>
            </div>
          )}
          {paymentGatewayFeePayer === 'customer' && liveBreakdown.gateway_fee > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Payment gateway fee</span>
              <span className="tabular-nums">+₹{formatRupees(liveBreakdown.gateway_fee)}</span>
            </div>
          )}
          {platformFeePayer === 'customer' && liveBreakdown.platform_fee > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Platform fee</span>
              <span className="tabular-nums">+₹{formatRupees(liveBreakdown.platform_fee)}</span>
            </div>
          )}
          {gstEnabled && liveBreakdown.gst > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>GST</span>
              <span className="tabular-nums">+₹{formatRupees(liveBreakdown.gst)}</span>
            </div>
          )}
          <div className="border-t border-slate-200 mt-1 pt-1 flex justify-between font-semibold text-slate-900">
            <span>Total</span>
            <span className="tabular-nums">₹{formatRupees(liveBreakdown.final)}</span>
          </div>
        </div>
      )}

      {status.kind === 'error' && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex flex-col gap-2"
        >
          <span>{status.message}</span>
          {isPaid && (
            <button
              type="button"
              onClick={() => setStatus({ kind: 'idle' })}
              className="self-start text-xs font-semibold text-rose-700 underline underline-offset-2"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {status.kind === 'payment-cancelled' && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Payment cancelled — your reservation is saved but not confirmed.
          Reload to retry payment.
        </div>
      )}

      {status.kind === 'reserved-no-payment' && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          {status.message}
        </div>
      )}

      {status.kind === 'success' && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5">
              {/* Checkmark */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="10" cy="10" r="9" fill="#059669" />
                <path
                  d="M6 10.5l2.5 2.5L14 7.5"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="flex-1">
              <div className="font-semibold">{status.message}</div>
              {status.txnId && (
                <div className="mt-1 text-xs text-emerald-700">
                  Txn:{' '}
                  <span className="font-mono">{status.txnId}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary w-full text-base py-3 flex items-center justify-center gap-2"
        disabled={busy || status.kind === 'success'}
      >
        {busy && (
          <span
            aria-hidden
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
          />
        )}
        <span>{ctaLabel}</span>
      </button>

      {isPaid ? (
        <p className="text-xs text-slate-500 text-center">
          Payment confirms your booking instantly · Powered by Razorpay
        </p>
      ) : (
        <p className="text-xs text-slate-500 text-center">
          We&rsquo;ll WhatsApp you to confirm. No payment needed now.
        </p>
      )}
    </form>
  );
}
