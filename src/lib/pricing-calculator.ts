/**
 * Pricing calculator — final billed amount + per-line fee breakdown.
 *
 * This module is the SINGLE source of truth for "what does the customer
 * actually pay?" once you mix in per-event payer config (gateway / platform)
 * and GST. The earlier `pricing.ts` engine handles the line-item math
 * (entry, cover, guest mix) — this layer sits on top and applies the
 * processing-fee overlays before persisting a fee_breakdown JSON.
 *
 * Pure functions only — no DB, no I/O. Reads platform-level percentages
 * from the config table at call-site (the API route fetches them and
 * passes them in via the `percentages` override, or we fall back to the
 * built-in defaults exposed here for test/preview environments).
 *
 * Calculation contract (from spec):
 *   base        = entry_fee * pax + cover_for(genderMix)  OR  zonePrice * pax
 *   discount    = base * (discount_percent / 100)
 *   subtotal    = base - discount
 *   gateway_fee = subtotal * (PAYMENT_GATEWAY_FEE_PCT/100)  if gateway payer = 'customer'
 *   platform_fee= subtotal * (PLATFORM_FEE_PCT/100)         if platform payer = 'customer'
 *   pre_gst     = subtotal + gateway_fee + platform_fee
 *   gst         = pre_gst * (gst_percent/100)               if gst_enabled
 *   final       = pre_gst + gst
 *
 * Razorpay paise = round(final * 100).
 */

import { getConfig } from './db';
import { calculateCoverCharges, type CoverRates, type GuestCounts } from './pricing';
import type { Event } from './events';

// ─── Public types ──────────────────────────────────────────────────────────

export interface PricingInput {
  event: Pick<
    Event,
    | 'entry_fee_per_person'
    | 'cover_rates'
    | 'discount_percent'
    | 'gst_percent'
    | 'gst_enabled'
    | 'payment_gateway_fee_payer'
    | 'platform_fee_payer'
  >;
  pax: number;
  /** Gender mix for cover charges. Omit when using zonePrice. */
  genderMix?: { male: number; female: number; couple: number };
  /** When set, OVERRIDES per-person entry fee — used for seated/zone events. */
  zonePrice?: number;
  /**
   * Optional per-unit price override coming from a phased ticket release.
   * When supplied, REPLACES the per-person entry fee (flat path) OR the
   * zone per-seat price (zone path). Fee / GST math is unchanged — phases
   * only mutate the base. Set by /api/payments/order after looking up
   * getActivePhasePrice() for the chosen scope.
   */
  activePhasePrice?: number;
  /**
   * Optional INR amount to subtract from the subtotal AFTER the event-level
   * discount_percent has been applied. The /api/payments/order route uses
   * this to layer a coupon code's reduction onto the spec calculation
   * without bypassing the gateway/platform/GST overlay — the fees still
   * compute against the post-coupon subtotal so the customer's all-in
   * amount stays accurate.
   */
  couponDiscount?: number;
  /**
   * Optional platform overrides. When undefined, the calculator reads the
   * canonical config values from the DB (PAYMENT_GATEWAY_FEE_PCT,
   * PLATFORM_FEE_PCT). Tests pass explicit values to stay deterministic.
   */
  overrides?: {
    gateway_pct?: number;
    platform_pct?: number;
  };
}

export interface PricingBreakdown {
  base: number;
  discount: number;
  subtotal: number;
  gateway_fee: number;
  platform_fee: number;
  gst: number;
  final: number;
  payer_config: {
    gateway: 'customer' | 'host';
    platform: 'customer' | 'host';
    gst_enabled: boolean;
  };
  percentages: {
    gateway_pct: number;
    platform_pct: number;
    gst_pct: number;
    discount_pct: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function nnf(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return x;
}

function clampPercent(p: number): number {
  return Math.min(100, nnf(p));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Read the platform-level fee percentages from the config table. Caller can
 * override either side via PricingInput.overrides — tests rely on that path
 * to avoid touching the global config. Bad config values fall back to 0
 * (free) rather than throwing so a misconfiguration never blocks checkout.
 */
function resolvePercentages(
  overrides?: PricingInput['overrides'],
): { gateway_pct: number; platform_pct: number } {
  const gw =
    overrides?.gateway_pct != null
      ? clampPercent(overrides.gateway_pct)
      : clampPercent(Number(getConfig('PAYMENT_GATEWAY_FEE_PCT', '2')));
  const pl =
    overrides?.platform_pct != null
      ? clampPercent(overrides.platform_pct)
      : clampPercent(Number(getConfig('PLATFORM_FEE_PCT', '0')));
  return { gateway_pct: gw, platform_pct: pl };
}

// ─── Core ─────────────────────────────────────────────────────────────────

/**
 * Compute the final billed amount + complete breakdown for an event booking.
 *
 * The caller decides between flat per-person pricing and zone pricing by
 * either supplying genderMix (uses cover_rates + entry_fee_per_person) or
 * zonePrice (single per-seat price covers everything). The two paths are
 * mutually exclusive — zonePrice wins when both are provided.
 *
 * The returned `payer_config` snapshot captures which payer was in effect at
 * compute time so reconciliation can audit "this booking had platform fee
 * passed to customer" even after the host flips the setting later.
 */
export function computeBilling(input: PricingInput): PricingBreakdown {
  const ev = input.event;
  const pax = Math.max(1, Math.floor(nnf(input.pax)));

  // 1. Base.
  // Resolution order for per-unit price (zone/flat path):
  //   activePhasePrice  →  zonePrice  →  entry_fee_per_person
  // A phase override always wins because the host's phased release is the
  // most recent pricing decision.
  //
  // Cover-charge stacking (M/F/C model):
  // When genderMix is supplied, we ALWAYS add cover = M×male_stag +
  // F×female_stag + C×couple on top of the base — regardless of whether
  // the base came from a phase/zone override or the flat entry path. This
  // matches the "Table price + per-category cover on top" pricing model the
  // host configured: a Table of 4 reserves the seat, the per-category
  // cover funds the door entry.
  //
  // Back-compat: when genderMix is NOT supplied and a phase/zone override
  // IS, base = perUnitOverride * pax (no cover) — same as before, used by
  // the legacy zone-picker flow.
  let base: number;
  const phaseOverride =
    input.activePhasePrice != null && Number.isFinite(input.activePhasePrice)
      ? nnf(input.activePhasePrice)
      : null;
  const zoneOverride =
    input.zonePrice != null && Number.isFinite(input.zonePrice)
      ? nnf(input.zonePrice)
      : null;
  const perUnitOverride = phaseOverride ?? zoneOverride;

  // Compute cover separately so we can stack it on either the override
  // path OR the flat-entry path.
  const hasGenderMix =
    input.genderMix != null &&
    (nnf(input.genderMix.male) > 0 ||
      nnf(input.genderMix.female) > 0 ||
      nnf(input.genderMix.couple) > 0);
  const counts: GuestCounts = {
    male: Math.floor(nnf(input.genderMix?.male)),
    female: Math.floor(nnf(input.genderMix?.female)),
    couple: Math.floor(nnf(input.genderMix?.couple)),
  };
  const rates: CoverRates = {
    male_stag: nnf(ev.cover_rates?.male_stag),
    female_stag: nnf(ev.cover_rates?.female_stag),
    couple: nnf(ev.cover_rates?.couple),
  };
  const cover = hasGenderMix ? calculateCoverCharges(counts, rates) : 0;

  if (perUnitOverride != null) {
    // Table / zone / phased release path. Cover stacks on top of the
    // per-unit price when the customer provided a gender mix; otherwise
    // we preserve the legacy "override replaces everything" semantics.
    base = perUnitOverride * pax + cover;
  } else {
    // Flat-entry path. Entry fee per head + per-category cover.
    const entry = nnf(ev.entry_fee_per_person) * pax;
    base = entry + cover;
  }
  base = round2(Math.max(0, base));

  // 2. Discount = event-level discount_percent + optional coupon reduction.
  // The coupon reduction is a flat INR (validateCoupon already pre-computed
  // it against the subtotal upstream); we add it to the percentage-derived
  // discount so the persisted breakdown captures the full reduction in one
  // number — reconciliation doesn't need a separate coupon column to make
  // sense of the math.
  const discountPct = clampPercent(ev.discount_percent);
  const pctDiscount = round2(base * (discountPct / 100));
  const couponDiscount = round2(nnf(input.couponDiscount));
  const discount = round2(Math.min(base, pctDiscount + couponDiscount));

  // 3. Subtotal.
  const subtotal = round2(Math.max(0, base - discount));

  // 4. Processing fees — applied ONLY when payer is the customer.
  const { gateway_pct, platform_pct } = resolvePercentages(input.overrides);
  const gatewayPayer: 'customer' | 'host' =
    ev.payment_gateway_fee_payer === 'customer' ? 'customer' : 'host';
  const platformPayer: 'customer' | 'host' =
    ev.platform_fee_payer === 'customer' ? 'customer' : 'host';
  const gateway_fee = gatewayPayer === 'customer' ? round2(subtotal * (gateway_pct / 100)) : 0;
  const platform_fee = platformPayer === 'customer' ? round2(subtotal * (platform_pct / 100)) : 0;

  // 5. Pre-GST total.
  const pre_gst = round2(subtotal + gateway_fee + platform_fee);

  // 6. GST.
  const gstEnabled = !!ev.gst_enabled;
  const gstPct = clampPercent(ev.gst_percent);
  const gst = gstEnabled ? round2(pre_gst * (gstPct / 100)) : 0;

  // 7. Final.
  const final = round2(pre_gst + gst);

  return {
    base,
    discount,
    subtotal,
    gateway_fee,
    platform_fee,
    gst,
    final,
    payer_config: {
      gateway: gatewayPayer,
      platform: platformPayer,
      gst_enabled: gstEnabled,
    },
    percentages: {
      gateway_pct,
      platform_pct,
      gst_pct: gstEnabled ? gstPct : 0,
      discount_pct: discountPct,
    },
  };
}
