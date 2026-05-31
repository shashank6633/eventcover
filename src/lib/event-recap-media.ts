/**
 * Event recap media — POST-event gallery of party photos shared with
 * ticket buyers via a magic link. Distinct from event_media (the pre-event
 * sales gallery on the public landing page) so the two never collide.
 *
 * Mirrors src/lib/event-media.ts shape — same image_data base64 data-URL
 * convention, same drag-reorder pattern, same audit-on-mutate.
 */
import { nanoid } from 'nanoid';
import { getDb } from './db';
import { logAudit } from './audit';

export interface RecapMediaRow {
  id: string;
  event_id: string;
  image_data: string;
  caption: string | null;
  sort_order: number;
  created_at: number;
  created_by: string | null;
}

export interface RecapMedia extends RecapMediaRow {}

export function list(eventId: string): RecapMedia[] {
  if (!eventId) return [];
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM event_recap_media
        WHERE event_id = ?
        ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(eventId) as RecapMediaRow[];
}

export function getOne(id: string): RecapMedia | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM event_recap_media WHERE id = ?')
    .get(id) as RecapMediaRow | undefined;
  return row ?? null;
}

export interface AddInput {
  eventId: string;
  image_data: string;
  caption?: string | null;
  createdBy?: string | null;
}

export function add(input: AddInput): RecapMedia {
  if (!input.eventId) throw new Error('eventId is required.');
  if (!input.image_data || typeof input.image_data !== 'string') {
    throw new Error('image_data is required.');
  }
  if (!/^(data:image\/|https?:\/\/)/i.test(input.image_data)) {
    throw new Error('image_data must be a data: URL or https URL.');
  }

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  const nextOrder =
    (db
      .prepare(
        'SELECT COALESCE(MAX(sort_order), -1) AS m FROM event_recap_media WHERE event_id = ?',
      )
      .get(input.eventId) as { m: number }).m + 1;

  db.prepare(
    `INSERT INTO event_recap_media
       (id, event_id, image_data, caption, sort_order, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.eventId,
    input.image_data,
    input.caption?.trim() || null,
    nextOrder,
    now,
    input.createdBy || null,
  );

  logAudit({
    actor: input.createdBy || 'system',
    action: 'event_recap_add',
    entityType: 'event_recap_media',
    entityId: id,
    details: { event_id: input.eventId, sort_order: nextOrder },
  });

  return getOne(id)!;
}

export function updateCaption(id: string, caption: string | null, actor: string): RecapMedia | null {
  const existing = getOne(id);
  if (!existing) return null;
  const db = getDb();
  db.prepare('UPDATE event_recap_media SET caption = ? WHERE id = ?').run(
    caption?.trim() || null,
    id,
  );
  logAudit({
    actor,
    action: 'event_recap_update',
    entityType: 'event_recap_media',
    entityId: id,
    details: { caption: caption ?? null },
  });
  return getOne(id);
}

export function remove(id: string, actor: string): boolean {
  const existing = getOne(id);
  if (!existing) return false;
  const db = getDb();
  db.prepare('DELETE FROM event_recap_media WHERE id = ?').run(id);
  logAudit({
    actor,
    action: 'event_recap_delete',
    entityType: 'event_recap_media',
    entityId: id,
    details: { event_id: existing.event_id },
  });
  return true;
}

export function reorder(eventId: string, orderedIds: string[], actor: string): RecapMedia[] {
  if (!eventId) throw new Error('eventId is required.');
  if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array.');
  const db = getDb();
  const existing = list(eventId);
  const existingIds = new Set(existing.map((m) => m.id));

  const tx = db.transaction((ids: string[]) => {
    const stmt = db.prepare(
      'UPDATE event_recap_media SET sort_order = ? WHERE id = ? AND event_id = ?',
    );
    let pos = 0;
    for (const id of ids) {
      if (!existingIds.has(id)) continue;
      stmt.run(pos, id, eventId);
      pos++;
    }
    for (const m of existing) {
      if (ids.includes(m.id)) continue;
      stmt.run(pos, m.id, eventId);
      pos++;
    }
  });
  tx(orderedIds);

  logAudit({
    actor,
    action: 'event_recap_reorder',
    entityType: 'event',
    entityId: eventId,
    details: { count: orderedIds.length },
  });

  return list(eventId);
}
