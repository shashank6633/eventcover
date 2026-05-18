import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { getProvider, type ProviderId } from './providers';
import { getEvent } from './events';

export type ReservationStatus = 'pending' | 'converted' | 'no_show' | 'cancelled';

export interface ReservationRow {
  id: string;
  event_id: string;
  provider: string;
  external_ref: string | null;
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  arrival_time: string | null;
  notes: string | null;
  status: ReservationStatus;
  converted_wallet_txn: string | null;
  synced_at: number;
  raw: string | null;
}

export function listReservationsForEvent(eventId: string): ReservationRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM reservations WHERE event_id = ? ORDER BY arrival_time ASC, name ASC`
  ).all(eventId) as ReservationRow[];
}

export function getReservation(id: string): ReservationRow | null {
  const db = getDb();
  return (
    (db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as ReservationRow | undefined) ?? null
  );
}

export async function syncReservationsForEvent(eventId: string, providerId: ProviderId): Promise<{
  fetched: number;
  inserted: number;
  existing: number;
}> {
  const event = getEvent(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);

  const provider = getProvider(providerId);
  const rows = await provider.fetchForDate(event.event_date);

  const db = getDb();
  const now = Date.now();
  let inserted = 0, existing = 0;

  const insert = db.prepare(`
    INSERT INTO reservations
      (id, event_id, provider, external_ref, name, phone, email, pax, arrival_time, notes, status, synced_at, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `);

  const findExisting = db.prepare(
    `SELECT id FROM reservations WHERE provider = ? AND external_ref = ?`
  );

  const tx = db.transaction(() => {
    for (const r of rows) {
      const hit = findExisting.get(providerId, r.externalRef);
      if (hit) { existing++; continue; }
      insert.run(
        nanoid(),
        eventId,
        providerId,
        r.externalRef,
        r.name,
        r.phone,
        r.email || null,
        Number(r.pax) || 1,
        r.arrivalTime || null,
        r.notes || null,
        now,
        JSON.stringify(r.raw ?? {}),
      );
      inserted++;
    }
  });
  tx();

  logAudit({
    actor: 'admin',
    action: 'reservations_sync',
    entityType: 'event',
    entityId: eventId,
    details: { provider: providerId, fetched: rows.length, inserted, existing },
  });

  return { fetched: rows.length, inserted, existing };
}

export function markReservationConverted(id: string, walletTxn: string) {
  const db = getDb();
  db.prepare(
    `UPDATE reservations SET status = 'converted', converted_wallet_txn = ? WHERE id = ?`
  ).run(walletTxn, id);
}

export function markReservationNoShow(id: string) {
  const db = getDb();
  db.prepare(`UPDATE reservations SET status = 'no_show' WHERE id = ?`).run(id);
  logAudit({ actor: 'admin', action: 'reservation_no_show', entityType: 'reservation', entityId: id });
}
