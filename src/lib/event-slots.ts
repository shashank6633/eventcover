/**
 * Phase 3 — Multi-slot Schedule.
 *
 * event_slots stores per-event session slots (e.g. "6 PM doors", "9 PM doors",
 * "Day 1 — Morning", "Day 1 — Evening"). When an event has zero active
 * slots, the public booking form skips the picker and uses events.event_date
 * + events.start_time (back-compat).
 *
 * Capacity is checked race-safely inside a `db.transaction(() => …)` call.
 * better-sqlite3 wraps that in `BEGIN IMMEDIATE` so concurrent writers
 * serialise — two simultaneous public bookings can't both pass the COUNT
 * check.
 *
 * Soft-deactivate (active=0) preserves history; hard delete is allowed only
 * when zero reservations reference the slot.
 */
import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';

export interface EventSlotRow {
  id: string;
  event_id: string;
  slot_date: string;       // YYYY-MM-DD
  start_time: string;      // HH:MM (24h)
  end_time: string | null;
  label: string | null;
  max_capacity: number | null;
  sort_order: number;
  active: number;
  created_at: number;
}

export interface EventSlot extends Omit<EventSlotRow, 'active'> {
  active: boolean;
}

export interface EventSlotWithCapacity extends EventSlot {
  used_capacity: number;
  remaining_capacity: number | null;  // null when max_capacity is null (unlimited)
}

function hydrate(row: EventSlotRow): EventSlot {
  return { ...row, active: !!row.active };
}

// ─── Validators ────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function assertDate(d: string, field: string): void {
  if (!DATE_RE.test(d)) throw new Error(`${field} must be YYYY-MM-DD.`);
}
function assertTime(t: string, field: string): void {
  if (!TIME_RE.test(t)) throw new Error(`${field} must be HH:MM (24-hour).`);
}

// ─── List / get ────────────────────────────────────────────────────────────

export interface ListSlotsOpts {
  /** Default true — return only active=1 rows. Pass false for the admin editor. */
  activeOnly?: boolean;
}

export function listSlots(eventId: string, opts: ListSlotsOpts = {}): EventSlot[] {
  if (!eventId) return [];
  const activeOnly = opts.activeOnly ?? true;
  const db = getDb();
  const sql = activeOnly
    ? 'SELECT * FROM event_slots WHERE event_id = ? AND active = 1 ORDER BY sort_order ASC, start_time ASC'
    : 'SELECT * FROM event_slots WHERE event_id = ? ORDER BY active DESC, sort_order ASC, start_time ASC';
  return (db.prepare(sql).all(eventId) as EventSlotRow[]).map(hydrate);
}

export function getSlot(slotId: string): EventSlot | null {
  if (!slotId) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM event_slots WHERE id = ?').get(slotId) as EventSlotRow | undefined;
  return row ? hydrate(row) : null;
}

/**
 * COUNT(*) of non-cancelled reservations referencing this slot.
 * Used by both the capacity gate and the admin "X / Y used" indicator.
 */
export function getSlotCapacityUsed(slotId: string): number {
  if (!slotId) return 0;
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM reservations WHERE slot_id = ? AND status != 'cancelled'`)
    .get(slotId) as { c: number };
  return row.c;
}

export function listSlotsWithCapacity(eventId: string, opts: ListSlotsOpts = {}): EventSlotWithCapacity[] {
  const slots = listSlots(eventId, opts);
  return slots.map((s) => {
    const used = getSlotCapacityUsed(s.id);
    const remaining = s.max_capacity == null ? null : Math.max(0, s.max_capacity - used);
    return { ...s, used_capacity: used, remaining_capacity: remaining };
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export interface AddSlotInput {
  eventId: string;
  slot_date: string;
  start_time: string;
  end_time?: string | null;
  label?: string | null;
  max_capacity?: number | null;
}

/**
 * Append a new slot at the end (sort_order = MAX+1).
 */
export function addSlot(input: AddSlotInput): EventSlot {
  if (!input.eventId) throw new Error('eventId is required.');
  assertDate(input.slot_date, 'slot_date');
  assertTime(input.start_time, 'start_time');
  if (input.end_time) assertTime(input.end_time, 'end_time');

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  const nextOrder =
    (db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM event_slots WHERE event_id = ?')
      .get(input.eventId) as { m: number }).m + 1;

  const maxCap = input.max_capacity == null ? null : Math.max(0, Math.floor(Number(input.max_capacity)));

  db.prepare(`
    INSERT INTO event_slots
      (id, event_id, slot_date, start_time, end_time, label, max_capacity,
       sort_order, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    input.eventId,
    input.slot_date,
    input.start_time,
    input.end_time || null,
    input.label?.trim() || null,
    maxCap,
    nextOrder,
    now,
  );

  logAudit({
    actor: 'system',
    action: 'event_slot_add',
    entityType: 'event_slot',
    entityId: id,
    details: { event_id: input.eventId, slot_date: input.slot_date, start_time: input.start_time },
  });

  return getSlot(id)!;
}

export interface UpdateSlotInput {
  slot_date?: string;
  start_time?: string;
  end_time?: string | null;
  label?: string | null;
  max_capacity?: number | null;
  active?: boolean;
}

export function updateSlot(slotId: string, patch: UpdateSlotInput, actor: string): EventSlot | null {
  const existing = getSlot(slotId);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, val: string | number | null) => { fields.push(`${col} = ?`); values.push(val); };

  if (patch.slot_date != null) {
    assertDate(patch.slot_date, 'slot_date');
    set('slot_date', patch.slot_date);
  }
  if (patch.start_time != null) {
    assertTime(patch.start_time, 'start_time');
    set('start_time', patch.start_time);
  }
  if ('end_time' in patch) {
    if (patch.end_time) assertTime(patch.end_time, 'end_time');
    set('end_time', patch.end_time || null);
  }
  if ('label' in patch) set('label', patch.label?.trim() || null);
  if ('max_capacity' in patch) {
    set('max_capacity', patch.max_capacity == null ? null : Math.max(0, Math.floor(Number(patch.max_capacity))));
  }
  if (patch.active != null) set('active', patch.active ? 1 : 0);

  if (fields.length === 0) return existing;
  values.push(slotId);
  const db = getDb();
  db.prepare(`UPDATE event_slots SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  logAudit({
    actor,
    action: 'event_slot_update',
    entityType: 'event_slot',
    entityId: slotId,
    details: { ...patch },
  });
  return getSlot(slotId);
}

/**
 * Hard delete a slot — only allowed when no reservations reference it.
 * Returns { ok: false, reason } if reservations are attached so the caller
 * can suggest soft-deactivate (PATCH { active: false }) instead.
 */
export function deleteSlot(slotId: string, actor: string): { ok: true } | { ok: false; reason: string; attached: number } {
  const existing = getSlot(slotId);
  if (!existing) return { ok: false, reason: 'Slot not found.', attached: 0 };
  const db = getDb();
  const attached = (db.prepare(
    `SELECT COUNT(*) AS c FROM reservations WHERE slot_id = ?`,
  ).get(slotId) as { c: number }).c;
  if (attached > 0) {
    return {
      ok: false,
      reason: `Slot has ${attached} reservation(s). Deactivate instead to preserve history.`,
      attached,
    };
  }
  db.prepare('DELETE FROM event_slots WHERE id = ?').run(slotId);
  logAudit({
    actor,
    action: 'event_slot_delete',
    entityType: 'event_slot',
    entityId: slotId,
    details: { event_id: existing.event_id },
  });
  return { ok: true };
}

/**
 * Bulk reorder: rewrites sort_order for every id in orderedIds (index = new
 * position). Wrapped in a transaction. Any ids that don't belong to the
 * event are skipped silently.
 */
export function reorderSlots(eventId: string, orderedIds: string[], actor: string): EventSlot[] {
  if (!eventId) throw new Error('eventId is required.');
  if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array.');

  const db = getDb();
  const existing = listSlots(eventId, { activeOnly: false });
  const existingIds = new Set(existing.map((s) => s.id));

  const tx = db.transaction((ids: string[]) => {
    const stmt = db.prepare('UPDATE event_slots SET sort_order = ? WHERE id = ? AND event_id = ?');
    let pos = 0;
    for (const id of ids) {
      if (!existingIds.has(id)) continue;
      stmt.run(pos, id, eventId);
      pos++;
    }
    // Push unknown items to the end in their existing order.
    for (const s of existing) {
      if (ids.includes(s.id)) continue;
      stmt.run(pos, s.id, eventId);
      pos++;
    }
  });
  tx(orderedIds);

  logAudit({
    actor,
    action: 'event_slot_reorder',
    entityType: 'event',
    entityId: eventId,
    details: { count: orderedIds.length },
  });

  return listSlots(eventId, { activeOnly: false });
}

/**
 * Race-safe capacity check. Returns { ok: false, reason } if the slot would
 * exceed max_capacity after a new booking of `pax` people, or if the slot
 * doesn't belong to the given event / isn't active.
 *
 * MUST be called inside the same transaction as the reservation insert so
 * the COUNT check + INSERT happen atomically. better-sqlite3's
 * db.transaction() uses BEGIN IMMEDIATE which serialises writers — that's
 * what makes the capacity check race-safe.
 */
export function checkSlotCapacity(
  slotId: string,
  eventId: string,
  pax: number,
): { ok: true; slot: EventSlot; used: number } | { ok: false; reason: string } {
  const slot = getSlot(slotId);
  if (!slot) return { ok: false, reason: 'Slot not found.' };
  if (slot.event_id !== eventId) return { ok: false, reason: 'Slot does not belong to this event.' };
  if (!slot.active) return { ok: false, reason: 'Slot is not active.' };
  if (slot.max_capacity == null) return { ok: true, slot, used: 0 };  // unlimited
  const used = getSlotCapacityUsed(slotId);
  if (used + pax > slot.max_capacity) {
    return { ok: false, reason: `Slot capacity reached (${used}/${slot.max_capacity}).` };
  }
  return { ok: true, slot, used };
}
