/**
 * Bookings persistence layer.
 *
 * Every booking is saved as one parent row in `bookings` plus N child rows in
 * `booking_items` (one per individual or table line). All money + occupancy is
 * computed by the pure engine (lib/pricing.ts) — this module just stores it.
 *
 * Important: each booking item denormalizes the table snapshot (capacity, fee,
 * name) so historical bookings remain stable if the event's pricing changes
 * later.
 */
import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { normalizePhone } from './users';
import { getEvent } from './events';
import {
  calculateMixedBookingTotal,
  pricingFromEvent,
  type BookingLine,
  type GuestCounts,
  type TableType,
} from './pricing';

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';
export type BookingType = 'individual' | 'table' | 'mixed';

export interface BookingItemRow {
  id: string;
  booking_id: string;
  kind: 'individual' | 'table';
  table_type_id: string | null;
  table_type_name: string | null;
  table_capacity: number | null;
  table_entry_fee: number | null;
  male_count: number;
  female_count: number;
  couple_count: number;
  pax_occupied: number;
  entry_amount: number;
  cover_amount: number;
  item_total: number;
  created_at: number;
}

export interface BookingRow {
  id: string;
  event_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  type: BookingType;
  total_pax: number;
  entry_total: number;
  table_entry_total: number;
  cover_total: number;
  subtotal: number;
  discount_amount: number;
  gst_amount: number;
  final_amount: number;
  status: BookingStatus;
  payment_method: string | null;
  notes: string | null;
  created_at: number;
  created_by: string | null;
}

export interface BookingWithItems extends BookingRow {
  items: BookingItemRow[];
}

// ─── Input types ───────────────────────────────────────────────────────────

export interface BookingLineInput {
  kind: 'individual' | 'table';
  counts: GuestCounts;
  /** Required for table lines — references an event's table_type id. */
  tableTypeId?: string;
  /** Optional per-line capacity override (the "Edit table size" escape hatch). */
  capacityOverride?: number;
}

export interface CreateBookingInput {
  eventId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  lines: BookingLineInput[];
  status?: BookingStatus;
  paymentMethod?: string;
  notes?: string;
  /** If false, allow saving despite occupancy errors (admin override path). */
  enforceValidation?: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function inferBookingType(lines: BookingLineInput[]): BookingType {
  const hasInd = lines.some((l) => l.kind === 'individual');
  const hasTbl = lines.some((l) => l.kind === 'table');
  if (hasInd && hasTbl) return 'mixed';
  if (hasTbl) return 'table';
  return 'individual';
}

function resolveTableType(
  eventTableTypes: TableType[],
  line: BookingLineInput,
): TableType {
  if (line.kind !== 'table') throw new Error('resolveTableType called on non-table line');
  const found = line.tableTypeId
    ? eventTableTypes.find((t) => t.id === line.tableTypeId)
    : undefined;
  if (!found) {
    throw new Error(`Table type "${line.tableTypeId}" not found on this event.`);
  }
  // Apply per-line capacity override if provided (admin escape hatch).
  return line.capacityOverride && line.capacityOverride > 0
    ? { ...found, capacity: Math.floor(line.capacityOverride) }
    : found;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Run the engine against an event's pricing config without saving.
 * Used by the "live calculation" preview in the booking UI.
 */
export function calculateForEvent(eventId: string, lines: BookingLineInput[]) {
  const event = getEvent(eventId);
  if (!event) throw new Error('Event not found.');
  const config = pricingFromEvent(event);
  const eventTableTypes = (Array.isArray(event.table_types as unknown)
    ? (event.table_types as unknown as TableType[])
    : []
  );

  const engineLines: BookingLine[] = lines.map((line) => {
    if (line.kind === 'individual') return { kind: 'individual', counts: line.counts };
    return { kind: 'table', tableType: resolveTableType(eventTableTypes, line), counts: line.counts };
  });

  return {
    config,
    ...calculateMixedBookingTotal(engineLines, config),
  };
}

export function createBooking(input: CreateBookingInput, createdBy: string): BookingWithItems {
  if (!input.eventId) throw new Error('eventId is required.');
  if (!input.customerName?.trim()) throw new Error('Customer name is required.');
  if (!input.customerPhone?.trim()) throw new Error('Customer phone is required.');
  if (!input.lines?.length) throw new Error('At least one booking line is required.');

  const total = calculateForEvent(input.eventId, input.lines);

  // Validation gate (unless overridden)
  const enforce = input.enforceValidation !== false;
  if (enforce && !total.allValid) {
    const first = total.validationErrors[0] || 'Booking has occupancy errors.';
    throw new Error(first);
  }

  const db = getDb();
  const bookingId = nanoid();
  const now = Date.now();
  const phone = normalizePhone(input.customerPhone);
  const type = inferBookingType(input.lines);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO bookings (
        id, event_id, customer_name, customer_phone, customer_email, type,
        total_pax, entry_total, table_entry_total, cover_total,
        subtotal, discount_amount, gst_amount, final_amount,
        status, payment_method, notes, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bookingId, input.eventId, input.customerName.trim(), phone,
      input.customerEmail?.trim() || null, type,
      total.totalPax, total.entryTotal, total.tableEntryTotal, total.coverTotal,
      total.subtotal, total.discountAmount, total.gstAmount, total.finalAmount,
      input.status || 'confirmed',
      input.paymentMethod || null,
      input.notes?.trim() || null,
      now, createdBy,
    );

    const itemStmt = db.prepare(`
      INSERT INTO booking_items (
        id, booking_id, kind, table_type_id, table_type_name, table_capacity, table_entry_fee,
        male_count, female_count, couple_count, pax_occupied,
        entry_amount, cover_amount, item_total, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    total.lines.forEach((line) => {
      const itemId = nanoid();
      itemStmt.run(
        itemId, bookingId, line.kind,
        line.tableType?.id ?? null,
        line.tableType?.name ?? null,
        line.tableType?.capacity ?? null,
        line.tableType?.entry_fee ?? null,
        line.counts.male, line.counts.female, line.counts.couple,
        line.pax, line.entryAmount, line.coverAmount, line.total,
        now,
      );
    });
  });
  tx();

  logAudit({
    actor: createdBy, action: 'booking_create', entityType: 'booking', entityId: bookingId,
    details: {
      event_id: input.eventId, type, pax: total.totalPax,
      final: total.finalAmount, lines: input.lines.length,
    },
  });

  return getBooking(bookingId)!;
}

export function getBooking(id: string): BookingWithItems | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as BookingRow | undefined;
  if (!row) return null;
  const items = db.prepare('SELECT * FROM booking_items WHERE booking_id = ? ORDER BY created_at ASC').all(id) as BookingItemRow[];
  return { ...row, items };
}

export interface ListBookingsOptions {
  eventId?: string;
  status?: BookingStatus;
  phone?: string;
  limit?: number;
}

export function listBookings(opts: ListBookingsOptions = {}): BookingWithItems[] {
  const db = getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.eventId) { where.push('event_id = ?'); params.push(opts.eventId); }
  if (opts.status)  { where.push('status = ?');   params.push(opts.status); }
  if (opts.phone)   { where.push('customer_phone = ?'); params.push(normalizePhone(opts.phone)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200));

  const rows = db.prepare(
    `SELECT * FROM bookings ${whereSql} ORDER BY created_at DESC LIMIT ?`,
  ).all(...params, limit) as BookingRow[];

  if (rows.length === 0) return [];

  // Fetch all items for the returned bookings in one query
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const items = db.prepare(
    `SELECT * FROM booking_items WHERE booking_id IN (${placeholders}) ORDER BY created_at ASC`,
  ).all(...ids) as BookingItemRow[];

  const byBooking = new Map<string, BookingItemRow[]>();
  for (const it of items) {
    const arr = byBooking.get(it.booking_id) ?? [];
    arr.push(it);
    byBooking.set(it.booking_id, arr);
  }

  return rows.map((r) => ({ ...r, items: byBooking.get(r.id) ?? [] }));
}

export function cancelBooking(id: string, actor: string): BookingWithItems | null {
  const db = getDb();
  const existing = getBooking(id);
  if (!existing) return null;
  if (existing.status === 'cancelled') return existing;
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
  logAudit({ actor, action: 'booking_cancel', entityType: 'booking', entityId: id });
  return getBooking(id);
}

export function confirmBooking(id: string, actor: string, paymentMethod?: string): BookingWithItems | null {
  const db = getDb();
  const existing = getBooking(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE bookings SET status = 'confirmed', payment_method = COALESCE(?, payment_method) WHERE id = ?`,
  ).run(paymentMethod || null, id);
  logAudit({ actor, action: 'booking_confirm', entityType: 'booking', entityId: id, details: { paymentMethod } });
  return getBooking(id);
}
