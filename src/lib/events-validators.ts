/**
 * Shared input validators for event create/update endpoints.
 *
 * Originally lived inside `src/app/api/events/route.ts` as exported helpers,
 * but Next.js 15 production builds reject any export from a route file that
 * isn't a Route lifecycle export (GET/POST/PATCH/etc. or dynamic/runtime).
 * Moving them here keeps `/api/events/route.ts` and `/api/events/[id]/route.ts`
 * sharing the same validation logic without violating the route-export contract.
 */
import type { PaxRule, BookingType } from './events';

export function validatePaxRules(raw: unknown): PaxRule[] | Error {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return new Error('pax_rules must be an array.');
  const out: PaxRule[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (typeof r?.label !== 'string' || !r.label.trim()) return new Error('rule.label is required');
    const min = Number(r.min_pax);
    const max = r.max_pax == null ? null : Number(r.max_pax);
    const feePerPax = Number(r.fee_per_pax);
    if (!(min >= 1)) return new Error(`rule "${r.label}" — min_pax must be >= 1`);
    if (max != null && max < min) return new Error(`rule "${r.label}" — max_pax must be >= min_pax`);
    if (!(feePerPax >= 0)) return new Error(`rule "${r.label}" — fee_per_pax must be >= 0`);
    out.push({ label: r.label.trim(), min_pax: min, max_pax: max, fee_per_pax: feePerPax });
  }
  return out;
}

export function validateBookingTypes(raw: unknown): BookingType[] | Error {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return new Error('booking_types must be an array.');
  return (raw as Record<string, unknown>[]).map((b) => ({
    id: typeof b.id === 'string' ? b.id : '',
    name: typeof b.name === 'string' ? b.name.trim() : '',
    tickets: Array.isArray(b.tickets) ? b.tickets.map((t: Record<string, unknown>) => ({
      id: typeof t.id === 'string' ? t.id : '',
      name: typeof t.name === 'string' ? t.name.trim() : '',
      price: Number(t.price) || 0,
      info: t.info ? String(t.info) : null,
    })) : [],
  }));
}
