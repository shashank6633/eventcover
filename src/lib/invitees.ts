/**
 * Phase 3 — Invite Only (phone-list mode).
 *
 * event_invitees stores an allowlist of phone numbers (normalized via
 * normalizePhone) per event. When events.access_mode = 'phone_list', the
 * public booking endpoint validates the caller's phone against this table
 * and rejects bookings from numbers that aren't on the list.
 *
 * After a successful reservation, used=1 + used_at + used_reservation_id
 * are stamped inside the same transaction so a single invitation cannot
 * be re-used. Admins can reset an entry via PATCH (resetInviteeUse).
 *
 * Phones are stored already normalized — bulk-import normalizes before
 * the unique-index lookup so '+91 9...' and '9...' collide correctly.
 */
import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { normalizePhone } from './users';

export interface InviteeRow {
  id: string;
  event_id: string;
  phone: string;
  name: string | null;
  plus_ones_allowed: number;
  used: number;
  used_at: number | null;
  used_reservation_id: string | null;
  notes: string | null;
  created_at: number;
  created_by: string | null;
}

export interface Invitee extends Omit<InviteeRow, 'used'> {
  used: boolean;
}

function hydrate(row: InviteeRow): Invitee {
  return { ...row, used: !!row.used };
}

// ─── List / get ────────────────────────────────────────────────────────────

export function listInvitees(eventId: string): Invitee[] {
  if (!eventId) return [];
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM event_invitees WHERE event_id = ? ORDER BY created_at DESC')
    .all(eventId) as InviteeRow[];
  return rows.map(hydrate);
}

export function getInvitee(id: string): Invitee | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM event_invitees WHERE id = ?').get(id) as InviteeRow | undefined;
  return row ? hydrate(row) : null;
}

/**
 * Look up an invitee by (eventId, phone). Phone is normalized before the
 * query so callers don't have to. Used by validateInviteAccess +
 * isPhoneInvited (the public-booking gate).
 */
export function findInviteeByPhone(eventId: string, phone: string): Invitee | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM event_invitees WHERE event_id = ? AND phone = ?')
    .get(eventId, normalized) as InviteeRow | undefined;
  return row ? hydrate(row) : null;
}

/**
 * Convenience boolean: is this phone on the invite list for this event?
 * Does NOT consider plus_ones_allowed or used — callers needing those
 * should use findInviteeByPhone.
 */
export function isPhoneInvited(eventId: string, phone: string): boolean {
  return findInviteeByPhone(eventId, phone) !== null;
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export interface AddInviteeInput {
  eventId: string;
  phone: string;
  name?: string | null;
  plus_ones_allowed?: number;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * Insert a single invitee. Throws on:
 *   • missing/invalid phone
 *   • duplicate (event_id, phone) — unique index trips
 *
 * Returns the hydrated row.
 */
export function addInvitee(input: AddInviteeInput): Invitee {
  if (!input.eventId) throw new Error('eventId is required.');
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('Valid phone number required.');

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  const plusOnes = Math.max(0, Math.floor(Number(input.plus_ones_allowed ?? 0)));

  try {
    db.prepare(`
      INSERT INTO event_invitees
        (id, event_id, phone, name, plus_ones_allowed, used, used_at,
         used_reservation_id, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)
    `).run(
      id,
      input.eventId,
      phone,
      input.name?.trim() || null,
      plusOnes,
      input.notes?.trim() || null,
      now,
      input.createdBy || null,
    );
  } catch (err) {
    // better-sqlite3 surfaces UNIQUE violations as SqliteError with
    // code SQLITE_CONSTRAINT_UNIQUE. Re-throw as a friendly message.
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(msg)) {
      throw new Error(`Phone ${phone} is already on the invite list for this event.`);
    }
    throw err;
  }

  logAudit({
    actor: input.createdBy || 'system',
    action: 'invitee_add',
    entityType: 'invitee',
    entityId: id,
    details: { event_id: input.eventId, phone, plus_ones_allowed: plusOnes },
  });

  return getInvitee(id)!;
}

export interface BulkImportRow {
  phone: string;
  name?: string | null;
  plus_ones_allowed?: number;
  notes?: string | null;
}

export interface BulkImportResult {
  inserted: number;
  skipped: number;
  errors: { row: number; phone: string; reason: string }[];
}

/**
 * Bulk-import invitees. Skip-on-conflict: rows whose normalized phone is
 * already on the list are counted in `skipped` rather than aborting the
 * batch. Per-row errors collected into `errors[]`.
 *
 * Capped at 5000 rows per request (caller enforces; we also defensively
 * slice) to keep transaction size bounded.
 */
export function bulkImportInvitees(
  eventId: string,
  rows: BulkImportRow[],
  createdBy: string | null,
): BulkImportResult {
  if (!eventId) throw new Error('eventId is required.');
  if (!Array.isArray(rows)) throw new Error('rows must be an array.');

  const capped = rows.slice(0, 5000);
  const db = getDb();
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO event_invitees
      (id, event_id, phone, name, plus_ones_allowed, used, used_at,
       used_reservation_id, notes, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)
  `);

  const result: BulkImportResult = { inserted: 0, skipped: 0, errors: [] };

  const tx = db.transaction(() => {
    capped.forEach((raw, idx) => {
      const rowNum = idx + 1;
      try {
        const phone = normalizePhone(String(raw?.phone ?? ''));
        if (!phone) {
          result.errors.push({ row: rowNum, phone: String(raw?.phone ?? ''), reason: 'Invalid phone.' });
          return;
        }
        const plusOnes = Math.max(0, Math.floor(Number(raw.plus_ones_allowed ?? 0)));
        try {
          insert.run(
            nanoid(),
            eventId,
            phone,
            raw.name?.toString().trim() || null,
            plusOnes,
            raw.notes?.toString().trim() || null,
            now,
            createdBy,
          );
          result.inserted++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/UNIQUE constraint failed/i.test(msg)) {
            result.skipped++;
          } else {
            result.errors.push({ row: rowNum, phone, reason: msg });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ row: rowNum, phone: String(raw?.phone ?? ''), reason: msg });
      }
    });
  });
  tx();

  logAudit({
    actor: createdBy || 'system',
    action: 'invitee_bulk_import',
    entityType: 'event',
    entityId: eventId,
    details: { inserted: result.inserted, skipped: result.skipped, errors: result.errors.length },
  });

  return result;
}

export interface UpdateInviteeInput {
  name?: string | null;
  plus_ones_allowed?: number;
  notes?: string | null;
  /** When true, clear used/used_at/used_reservation_id so the invite can be re-redeemed. */
  reset?: boolean;
}

export function updateInvitee(id: string, patch: UpdateInviteeInput, actor: string): Invitee | null {
  const existing = getInvitee(id);
  if (!existing) return null;
  const db = getDb();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, val: string | number | null) => { fields.push(`${col} = ?`); values.push(val); };

  if ('name' in patch) set('name', patch.name?.trim() || null);
  if (patch.plus_ones_allowed != null) {
    set('plus_ones_allowed', Math.max(0, Math.floor(Number(patch.plus_ones_allowed))));
  }
  if ('notes' in patch) set('notes', patch.notes?.trim() || null);
  if (patch.reset === true) {
    set('used', 0);
    set('used_at', null);
    set('used_reservation_id', null);
  }

  if (fields.length === 0) return existing;
  values.push(id);
  db.prepare(`UPDATE event_invitees SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  logAudit({
    actor,
    action: patch.reset ? 'invitee_reset' : 'invitee_update',
    entityType: 'invitee',
    entityId: id,
    details: { ...patch },
  });
  return getInvitee(id);
}

export function deleteInvitee(id: string, actor: string): boolean {
  const existing = getInvitee(id);
  if (!existing) return false;
  const db = getDb();
  db.prepare('DELETE FROM event_invitees WHERE id = ?').run(id);
  logAudit({
    actor,
    action: 'invitee_delete',
    entityType: 'invitee',
    entityId: id,
    details: { event_id: existing.event_id, phone: existing.phone },
  });
  return true;
}

/**
 * Atomic mark-used inside the public reservation transaction. The caller
 * must already hold the BEGIN IMMEDIATE — this just stamps the row.
 *
 * NOTE: This does NOT decrement plus_ones_allowed (the cap is applied at
 * validate-time, not redeem-time).
 */
export function markInviteeUsed(inviteeId: string, reservationId: string, now = Date.now()): void {
  const db = getDb();
  db.prepare(`
    UPDATE event_invitees
    SET used = 1, used_at = ?, used_reservation_id = ?
    WHERE id = ?
  `).run(now, reservationId, inviteeId);
}
