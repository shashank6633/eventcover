/**
 * Unit tests for the pricing engine.
 *
 * Run:
 *   npx tsx --test src/lib/pricing.test.ts
 * or (compiled):
 *   npx tsc --noEmit && node --test --import tsx src/lib/pricing.test.ts
 *
 * Coverage:
 *   • All 6 worked examples from the spec produce exact stated totals
 *   • Edge cases: empty, NaN, negative, fractional, over/under capacity
 *   • GST + discount order-of-operations
 *   • Min vs exact occupancy modes
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  calculatePax,
  calculateCoverCharges,
  calculateEntryFee,
  validateTableOccupancy,
  calculateIndividualTotal,
  calculateTableTotal,
  calculateMixedBookingTotal,
  DEFAULT_PRICING,
  type TableType,
  type GuestCounts,
  type BookingLine,
  type PricingConfig,
} from './pricing.js';

// Test fixtures — match spec defaults exactly
const CFG = DEFAULT_PRICING;
const T2: TableType = { id: 't2', name: 'Table for 2 Pax', capacity: 2, entry_fee: 300 };
const T4: TableType = { id: 't4', name: 'Table for 4 Pax', capacity: 4, entry_fee: 800 };
const T6: TableType = { id: 't6', name: 'Table for 6 Pax', capacity: 6, entry_fee: 1000 };

const empty: GuestCounts = { male: 0, female: 0, couple: 0 };

describe('calculatePax', () => {
  it('Male = 1, Female = 1, Couple = 2', () => {
    assert.equal(calculatePax({ male: 1, female: 0, couple: 0 }), 1);
    assert.equal(calculatePax({ male: 0, female: 1, couple: 0 }), 1);
    assert.equal(calculatePax({ male: 0, female: 0, couple: 1 }), 2);
  });
  it('mixed group sums correctly', () => {
    assert.equal(calculatePax({ male: 1, female: 1, couple: 1 }), 4);
    assert.equal(calculatePax({ male: 2, female: 0, couple: 2 }), 6);
  });
  it('handles empty / NaN / negative defensively', () => {
    assert.equal(calculatePax(empty), 0);
    assert.equal(calculatePax({ male: NaN, female: -1, couple: 0 }), 0);
    assert.equal(calculatePax({} as GuestCounts), 0);
  });
});

describe('calculateCoverCharges', () => {
  it('uses correct per-category rates', () => {
    const c = calculateCoverCharges({ male: 1, female: 1, couple: 1 }, CFG.cover_rates);
    assert.equal(c, 2000 + 1000 + 3000);
  });
  it('returns 0 for empty', () => {
    assert.equal(calculateCoverCharges(empty, CFG.cover_rates), 0);
  });
});

describe('calculateEntryFee', () => {
  it('pax × rate', () => {
    assert.equal(calculateEntryFee(4, 500), 2000);
  });
  it('handles 0 pax', () => {
    assert.equal(calculateEntryFee(0, 500), 0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SPEC EXAMPLES — INDIVIDUAL ENTRY
// ──────────────────────────────────────────────────────────────────────────

describe('Individual Entry — spec examples', () => {
  it('Example 1: 2 Male Stags → ₹5000', () => {
    const r = calculateIndividualTotal({ male: 2, female: 0, couple: 0 }, CFG);
    assert.equal(r.pax, 2);
    assert.equal(r.entryAmount, 1000);
    assert.equal(r.coverAmount, 4000);
    assert.equal(r.total, 5000);
  });

  it('Example 2: 1 Couple → ₹4000', () => {
    const r = calculateIndividualTotal({ male: 0, female: 0, couple: 1 }, CFG);
    assert.equal(r.pax, 2);
    assert.equal(r.entryAmount, 1000);   // 2 × 500
    assert.equal(r.coverAmount, 3000);
    assert.equal(r.total, 4000);
  });

  it('Example 3: 1 Male + 1 Female + 1 Couple → ₹8000', () => {
    const r = calculateIndividualTotal({ male: 1, female: 1, couple: 1 }, CFG);
    assert.equal(r.pax, 4);
    assert.equal(r.entryAmount, 2000);
    assert.equal(r.coverAmount, 6000);
    assert.equal(r.total, 8000);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// OCCUPANCY VALIDATION
// ──────────────────────────────────────────────────────────────────────────

describe('validateTableOccupancy — exact mode (default)', () => {
  it('exact match is valid', () => {
    const r = validateTableOccupancy({ male: 2, female: 0, couple: 1 }, 4);
    assert.equal(r.valid, true);
    assert.equal(r.occupied, 4);
    assert.equal(r.message, null);
  });

  it('UNDER capacity is INVALID — spec: Table of 4 + 1 Couple only', () => {
    const r = validateTableOccupancy({ male: 0, female: 0, couple: 1 }, 4);
    assert.equal(r.valid, false);
    assert.equal(r.occupied, 2);
    assert.match(r.message ?? '', /only 2 pax/i);
  });

  it('OVER capacity is INVALID in exact mode — spec: Table of 4 + 5 Male Stags', () => {
    const r = validateTableOccupancy({ male: 5, female: 0, couple: 0 }, 4);
    assert.equal(r.valid, false);
    assert.equal(r.occupied, 5);
    assert.match(r.message ?? '', /Remove 1|increase the table/i);
  });

  it('UNDER — Table of 4 + 1 Male + 1 Female', () => {
    const r = validateTableOccupancy({ male: 1, female: 1, couple: 0 }, 4);
    assert.equal(r.valid, false);
    assert.equal(r.occupied, 2);
  });

  it('UNDER — Table of 6 + 2 Couples (4 pax)', () => {
    const r = validateTableOccupancy({ male: 0, female: 0, couple: 2 }, 6);
    assert.equal(r.valid, false);
    assert.equal(r.occupied, 4);
  });

  it('OVER — Table of 6 + 7 pax', () => {
    const r = validateTableOccupancy({ male: 7, female: 0, couple: 0 }, 6);
    assert.equal(r.valid, false);
  });

  it('VALID — Table of 4: 2 Couples', () => {
    assert.equal(validateTableOccupancy({ couple: 2, male: 0, female: 0 }, 4).valid, true);
  });
  it('VALID — Table of 4: 4 Male Stags', () => {
    assert.equal(validateTableOccupancy({ male: 4, female: 0, couple: 0 }, 4).valid, true);
  });
  it('VALID — Table of 4: 2 Male + 1 Couple', () => {
    assert.equal(validateTableOccupancy({ male: 2, female: 0, couple: 1 }, 4).valid, true);
  });
  it('VALID — Table of 6: 3 Couples', () => {
    assert.equal(validateTableOccupancy({ couple: 3, male: 0, female: 0 }, 6).valid, true);
  });
  it('VALID — Table of 6: 4 Male + 1 Couple', () => {
    assert.equal(validateTableOccupancy({ male: 4, female: 0, couple: 1 }, 6).valid, true);
  });
});

describe('validateTableOccupancy — min mode', () => {
  it('over-capacity is allowed', () => {
    const r = validateTableOccupancy({ male: 5, female: 0, couple: 0 }, 4, 'min');
    assert.equal(r.valid, true);
  });
  it('under-capacity still invalid', () => {
    const r = validateTableOccupancy({ male: 2, female: 0, couple: 0 }, 4, 'min');
    assert.equal(r.valid, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SPEC EXAMPLES — TABLE BOOKING
// ──────────────────────────────────────────────────────────────────────────

describe('Table Booking — spec examples', () => {
  it('Example 1: Table of 4 + 2 Males + 1 Couple → ₹7800', () => {
    const r = calculateTableTotal(T4, { male: 2, female: 0, couple: 1 }, CFG);
    assert.equal(r.occupancy?.valid, true);
    assert.equal(r.pax, 4);
    assert.equal(r.entryAmount, 800);
    assert.equal(r.coverAmount, 4000 + 3000);   // (2×2000) + (1×3000)
    assert.equal(r.total, 7800);
  });

  it('Example 2: Table of 6 + 4 Males + 1 Couple → ₹12000', () => {
    const r = calculateTableTotal(T6, { male: 4, female: 0, couple: 1 }, CFG);
    assert.equal(r.occupancy?.valid, true);
    assert.equal(r.pax, 6);
    assert.equal(r.entryAmount, 1000);
    assert.equal(r.coverAmount, 8000 + 3000);
    assert.equal(r.total, 12000);
  });

  it('Example 3: Table of 6 + 2 Males + 2 Couples → ₹11000', () => {
    const r = calculateTableTotal(T6, { male: 2, female: 0, couple: 2 }, CFG);
    assert.equal(r.occupancy?.valid, true);
    assert.equal(r.pax, 6);
    assert.equal(r.entryAmount, 1000);
    assert.equal(r.coverAmount, 4000 + 6000);
    assert.equal(r.total, 11000);
  });

  it('Invalid table still calculates totals (so UI can show what it WOULD cost)', () => {
    const r = calculateTableTotal(T4, { male: 1, female: 0, couple: 0 }, CFG);
    assert.equal(r.occupancy?.valid, false);
    assert.equal(r.total, 800 + 2000); // still computed; UI gates the save
  });
});

// ──────────────────────────────────────────────────────────────────────────
// MIXED BOOKING (spec's worked example)
// ──────────────────────────────────────────────────────────────────────────

describe('Mixed Booking — spec example', () => {
  it('Individual (2 Male, ₹5000) + Table-of-4 (1 Couple + 2 Male, ₹7800) = ₹12800', () => {
    const lines: BookingLine[] = [
      { kind: 'individual', counts: { male: 2, female: 0, couple: 0 } },
      { kind: 'table', tableType: T4, counts: { male: 2, female: 0, couple: 1 } },
    ];
    const r = calculateMixedBookingTotal(lines, CFG);
    assert.equal(r.allValid, true);
    assert.equal(r.totalPax, 2 + 4);
    assert.equal(r.entryTotal, 1000);
    assert.equal(r.tableEntryTotal, 800);
    assert.equal(r.coverTotal, 4000 + 7000);   // 4000 individual + 7000 table
    assert.equal(r.subtotal, 12800);
    assert.equal(r.finalAmount, 12800);
  });

  it('Surfaces validation errors when any line is invalid', () => {
    const lines: BookingLine[] = [
      { kind: 'individual', counts: { male: 1, female: 0, couple: 0 } },
      { kind: 'table', tableType: T4, counts: { male: 1, female: 0, couple: 0 } }, // 1/4 — under
    ];
    const r = calculateMixedBookingTotal(lines, CFG);
    assert.equal(r.allValid, false);
    assert.equal(r.validationErrors.length, 1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// PRICING TOGGLES + GST/DISCOUNT
// ──────────────────────────────────────────────────────────────────────────

describe('Pricing toggles', () => {
  it('entry_enabled=false zeroes entry but keeps cover', () => {
    const cfg: PricingConfig = { ...CFG, entry_enabled: false };
    const r = calculateIndividualTotal({ male: 2, female: 0, couple: 0 }, cfg);
    assert.equal(r.entryAmount, 0);
    assert.equal(r.coverAmount, 4000);
    assert.equal(r.total, 4000);
  });

  it('cover_enabled=false zeroes cover but keeps entry', () => {
    const cfg: PricingConfig = { ...CFG, cover_enabled: false };
    const r = calculateIndividualTotal({ male: 2, female: 0, couple: 0 }, cfg);
    assert.equal(r.coverAmount, 0);
    assert.equal(r.total, 1000);
  });

  it('both disabled → 0', () => {
    const cfg: PricingConfig = { ...CFG, entry_enabled: false, cover_enabled: false };
    const r = calculateIndividualTotal({ male: 2, female: 0, couple: 0 }, cfg);
    assert.equal(r.total, 0);
  });
});

describe('GST + discount', () => {
  it('discount applied before GST (standard Indian order)', () => {
    // subtotal = ₹5000, discount 10% = ₹500, taxable = ₹4500, GST 18% = ₹810, final = ₹5310
    const cfg: PricingConfig = { ...CFG, discount_percent: 10, gst_percent: 18 };
    const r = calculateMixedBookingTotal(
      [{ kind: 'individual', counts: { male: 2, female: 0, couple: 0 } }],
      cfg,
    );
    assert.equal(r.subtotal, 5000);
    assert.equal(r.discountAmount, 500);
    assert.equal(r.taxableAmount, 4500);
    assert.equal(r.gstAmount, 810);
    assert.equal(r.finalAmount, 5310);
  });

  it('percents clamped to [0,100]', () => {
    const cfg: PricingConfig = { ...CFG, gst_percent: 500, discount_percent: -50 };
    const r = calculateMixedBookingTotal(
      [{ kind: 'individual', counts: { male: 1, female: 0, couple: 0 } }],
      cfg,
    );
    // Discount clamped to 0; GST clamped to 100. Subtotal = 2500 (entry 500 + cover 2000).
    assert.equal(r.discountAmount, 0);
    assert.equal(r.gstAmount, 2500);
    assert.equal(r.finalAmount, 5000);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// EDGE CASES
// ──────────────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('empty booking → all zeros + valid', () => {
    const r = calculateMixedBookingTotal([], CFG);
    assert.equal(r.totalPax, 0);
    assert.equal(r.finalAmount, 0);
    assert.equal(r.allValid, true);
  });

  it('fractional pax inputs floor down', () => {
    assert.equal(calculatePax({ male: 1.7, female: 0, couple: 0 }), 1);
  });

  it('Table-for-2 + 1 Couple — exact match', () => {
    const r = calculateTableTotal(T2, { male: 0, female: 0, couple: 1 }, CFG);
    assert.equal(r.occupancy?.valid, true);
    assert.equal(r.total, 300 + 3000);
  });
});
