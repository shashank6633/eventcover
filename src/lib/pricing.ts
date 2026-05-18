/**
 * Pricing & booking calculation engine.
 *
 * Pure functions only — no React, no I/O, no DB. This module is the single source
 * of truth for entry fee / cover charge / occupancy math. Both the server (API
 * routes saving bookings) and the client (live preview as the user types) call
 * these same functions, so totals always agree.
 *
 * Test suite: src/lib/pricing.test.ts — covers all worked examples from the spec
 * plus edge cases (empty, NaN, negative, over/under capacity).
 */

// ─── Domain types ──────────────────────────────────────────────────────────

export interface CoverRates {
  male_stag: number;
  female_stag: number;
  couple: number;
}

export interface GuestCounts {
  male: number;
  female: number;
  couple: number;
}

export type TableVisibility = 'none' | 'hidden' | 'fast_filling' | 'sold_out';

export interface TimeSlot {
  id: string;
  start: string;      // "YYYY-MM-DDTHH:MM" (datetime-local)
  end: string;
  quantity: number;   // tickets available in this slot; 0 = unlimited
}

export interface TableType {
  // Core engine fields
  id: string;
  name: string;       // "Table for 2 Pax"
  capacity: number;   // 2 | 4 | 6 | ...
  entry_fee: number;  // ₹

  // Rich metadata — all optional so legacy table types stay valid
  info?: string;                   // multi-line description shown to customer
  visibility?: TableVisibility;    // surfaces a badge on the customer page
  external_link?: string | null;   // override booking flow with an external URL
  contact_cta_enabled?: boolean;   // show "Contact us" instead of "Book now"
  max_per_booking?: number;        // cart cap; 0 = unlimited
  inventory?: number;              // total tickets available; 0 = unlimited
  time_slots?: TimeSlot[];         // windowed availability for time-based events
}

export type OccupancyRule = 'exact' | 'min';

export interface PricingConfig {
  entry_fee_per_person: number;
  cover_rates: CoverRates;
  entry_enabled: boolean;
  cover_enabled: boolean;
  occupancy_rule: OccupancyRule;
  gst_percent: number;        // 0–100
  discount_percent: number;   // 0–100
}

export const DEFAULT_PRICING: PricingConfig = {
  entry_fee_per_person: 500,
  cover_rates: { male_stag: 2000, female_stag: 1000, couple: 3000 },
  entry_enabled: true,
  cover_enabled: true,
  occupancy_rule: 'exact',
  gst_percent: 0,
  discount_percent: 0,
};

export const DEFAULT_TABLE_TYPES: TableType[] = [
  { id: 'tt_2', name: 'Table for 2 Pax', capacity: 2, entry_fee: 300 },
  { id: 'tt_4', name: 'Table for 4 Pax', capacity: 4, entry_fee: 800 },
  { id: 'tt_6', name: 'Table for 6 Pax', capacity: 6, entry_fee: 1000 },
];

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Coerce arbitrary input to a non-negative integer. Used to defang client-side
 * inputs (NaN, negative numbers, strings) without throwing — the validation
 * layer above presents friendly errors instead.
 */
function nni(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.floor(x);
}

/** Coerce to non-negative float (for money). */
function nnf(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return x;
}

function safeCounts(counts: Partial<GuestCounts> | null | undefined): GuestCounts {
  return {
    male: nni(counts?.male),
    female: nni(counts?.female),
    couple: nni(counts?.couple),
  };
}

// ─── Core formulas ─────────────────────────────────────────────────────────

/**
 * Total pax for a count tuple.
 * Male = 1 pax, Female = 1 pax, Couple = 2 pax.
 */
export function calculatePax(counts: Partial<GuestCounts>): number {
  const c = safeCounts(counts);
  return c.male + c.female + c.couple * 2;
}

/**
 * Sum of cover charges for the guest mix.
 */
export function calculateCoverCharges(counts: Partial<GuestCounts>, rates: CoverRates): number {
  const c = safeCounts(counts);
  return c.male * nnf(rates.male_stag)
       + c.female * nnf(rates.female_stag)
       + c.couple * nnf(rates.couple);
}

/**
 * Entry fee total for individual bookings.
 * NOTE: For tables, use the table's flat entry_fee instead — this is
 * per-person pricing, not per-table.
 */
export function calculateEntryFee(pax: number, ratePerPerson: number): number {
  return nnf(pax) * nnf(ratePerPerson);
}

// ─── Occupancy validation ──────────────────────────────────────────────────

export interface OccupancyResult {
  valid: boolean;
  occupied: number;
  capacity: number;
  diff: number;                    // occupied - capacity (negative = under, positive = over)
  rule: OccupancyRule;
  message: string | null;          // null when valid
  remaining: number;               // pax still needed (positive) or excess (negative)
}

/**
 * Validate a guest mix against a table's capacity.
 *
 * Default rule is 'exact' — occupied must equal capacity. The 'min' rule allows
 * over-capacity (occupied >= capacity). Either way, under-capacity is invalid.
 *
 * Resolution path for invalid: the UI exposes "Edit table size" so a host /
 * manager can bump the capacity for THIS booking line only (denormalized,
 * doesn't affect the event's defined table type).
 */
export function validateTableOccupancy(
  counts: Partial<GuestCounts>,
  capacity: number,
  rule: OccupancyRule = 'exact',
): OccupancyResult {
  const occupied = calculatePax(counts);
  const cap = nni(capacity);
  const diff = occupied - cap;

  let valid: boolean;
  let message: string | null = null;

  if (rule === 'min') {
    valid = diff >= 0;
    if (!valid) {
      message = `Table needs at least ${cap} pax — currently ${occupied}. Add ${-diff} more or shrink the table.`;
    }
  } else {
    valid = diff === 0;
    if (diff < 0) {
      message = `Table seats ${cap} but only ${occupied} pax assigned. Add ${-diff} more or shrink the table.`;
    } else if (diff > 0) {
      message = `Table seats ${cap} but ${occupied} pax assigned. Remove ${diff} or increase the table size.`;
    }
  }

  return {
    valid,
    occupied,
    capacity: cap,
    diff,
    rule,
    message,
    remaining: cap - occupied,
  };
}

// ─── Line item totals ──────────────────────────────────────────────────────

export interface IndividualLine {
  kind: 'individual';
  counts: GuestCounts;
}

export interface TableLine {
  kind: 'table';
  /** Snapshot of the table type at booking time (price + capacity may be locally overridden). */
  tableType: TableType;
  counts: GuestCounts;
}

export type BookingLine = IndividualLine | TableLine;

export interface LineResult {
  kind: 'individual' | 'table';
  pax: number;
  entryAmount: number;             // individual: pax × rate;  table: tableType.entry_fee
  coverAmount: number;
  total: number;                   // entry + cover
  counts: GuestCounts;
  tableType?: TableType;           // only for table lines
  occupancy?: OccupancyResult;     // only for table lines
}

/**
 * Compute totals for an individual-entry line.
 */
export function calculateIndividualTotal(
  counts: Partial<GuestCounts>,
  config: PricingConfig,
): LineResult {
  const safe = safeCounts(counts);
  const pax = calculatePax(safe);
  const entryAmount = config.entry_enabled ? calculateEntryFee(pax, config.entry_fee_per_person) : 0;
  const coverAmount = config.cover_enabled ? calculateCoverCharges(safe, config.cover_rates) : 0;
  return {
    kind: 'individual',
    pax,
    entryAmount,
    coverAmount,
    total: entryAmount + coverAmount,
    counts: safe,
  };
}

/**
 * Compute totals for a table line.
 * Table entry fee is FLAT (not pax-based). Cover charges are still per-person.
 */
export function calculateTableTotal(
  tableType: TableType,
  counts: Partial<GuestCounts>,
  config: PricingConfig,
): LineResult {
  const safe = safeCounts(counts);
  const occupancy = validateTableOccupancy(safe, tableType.capacity, config.occupancy_rule);
  const entryAmount = config.entry_enabled ? nnf(tableType.entry_fee) : 0;
  const coverAmount = config.cover_enabled ? calculateCoverCharges(safe, config.cover_rates) : 0;
  return {
    kind: 'table',
    pax: occupancy.occupied,
    entryAmount,
    coverAmount,
    total: entryAmount + coverAmount,
    counts: safe,
    tableType,
    occupancy,
  };
}

// ─── Booking total (Mixed = Individual + Table) ────────────────────────────

export interface BookingTotal {
  lines: LineResult[];
  totalPax: number;
  entryTotal: number;        // sum of individual-line entry fees
  tableEntryTotal: number;   // sum of table-line entry fees
  coverTotal: number;        // sum of all cover charges
  subtotal: number;          // entryTotal + tableEntryTotal + coverTotal (pre-discount/GST)
  discountAmount: number;
  taxableAmount: number;     // after discount, before GST
  gstAmount: number;
  finalAmount: number;       // ⟵ what the customer pays
  allValid: boolean;
  validationErrors: string[];
}

/**
 * Compute the booking's full bill from a list of lines.
 *
 * Order of operations on totals:
 *   1. Sum line subtotals
 *   2. Apply discount (% of subtotal)
 *   3. Apply GST (% of post-discount amount) — standard Indian billing order
 *   4. Final = taxable + GST
 *
 * GST and discount default to 0 in the engine — set them on the event's config.
 */
export function calculateMixedBookingTotal(
  lines: BookingLine[],
  config: PricingConfig,
): BookingTotal {
  const results: LineResult[] = lines.map((line) => {
    if (line.kind === 'individual') {
      return calculateIndividualTotal(line.counts, config);
    }
    return calculateTableTotal(line.tableType, line.counts, config);
  });

  const totalPax = results.reduce((s, r) => s + r.pax, 0);
  const entryTotal = results
    .filter((r) => r.kind === 'individual')
    .reduce((s, r) => s + r.entryAmount, 0);
  const tableEntryTotal = results
    .filter((r) => r.kind === 'table')
    .reduce((s, r) => s + r.entryAmount, 0);
  const coverTotal = results.reduce((s, r) => s + r.coverAmount, 0);

  const subtotal = entryTotal + tableEntryTotal + coverTotal;
  const discountAmount = round2(subtotal * (clampPercent(config.discount_percent) / 100));
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const gstAmount = round2(taxableAmount * (clampPercent(config.gst_percent) / 100));
  const finalAmount = round2(taxableAmount + gstAmount);

  const validationErrors: string[] = [];
  for (const r of results) {
    if (r.occupancy && !r.occupancy.valid && r.occupancy.message) {
      validationErrors.push(r.occupancy.message);
    }
  }

  return {
    lines: results,
    totalPax,
    entryTotal,
    tableEntryTotal,
    coverTotal,
    subtotal,
    discountAmount,
    taxableAmount,
    gstAmount,
    finalAmount,
    allValid: validationErrors.length === 0,
    validationErrors,
  };
}

function clampPercent(p: number): number {
  const n = nnf(p);
  return Math.min(100, n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Convenience: extract PricingConfig from an Event row ──────────────────

/**
 * Helper for callers that have a raw event row (from DB) and want a
 * ready-to-use PricingConfig. Defaults fill in for missing/legacy events.
 */
export function pricingFromEvent(event: {
  entry_fee_per_person?: number | null;
  cover_male_stag?: number | null;
  cover_female_stag?: number | null;
  cover_couple?: number | null;
  entry_enabled?: number | boolean | null;
  cover_enabled?: number | boolean | null;
  occupancy_rule?: string | null;
  gst_percent?: number | null;
  discount_percent?: number | null;
}): PricingConfig {
  return {
    entry_fee_per_person: nnf(event.entry_fee_per_person ?? DEFAULT_PRICING.entry_fee_per_person),
    cover_rates: {
      male_stag: nnf(event.cover_male_stag ?? DEFAULT_PRICING.cover_rates.male_stag),
      female_stag: nnf(event.cover_female_stag ?? DEFAULT_PRICING.cover_rates.female_stag),
      couple: nnf(event.cover_couple ?? DEFAULT_PRICING.cover_rates.couple),
    },
    entry_enabled: event.entry_enabled == null ? true : !!event.entry_enabled,
    cover_enabled: event.cover_enabled == null ? true : !!event.cover_enabled,
    occupancy_rule: (event.occupancy_rule === 'min' ? 'min' : 'exact'),
    gst_percent: nnf(event.gst_percent),
    discount_percent: nnf(event.discount_percent),
  };
}
