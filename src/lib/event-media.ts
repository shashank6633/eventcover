/**
 * Event media gallery — extra images shown on the public landing page
 * in a horizontal-scroll carousel below the hero. The hero itself stays
 * on events.image_data and is unaffected by this module.
 *
 * image_data is a base64 data URL produced by <ImageUpload/>, same as
 * events.image_data — so no new storage infra is required. If we ever
 * outgrow SQLite blobs we can swap the column for an S3/R2 URL without
 * touching the API shape.
 */
import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';

export interface EventMediaRow {
  id: string;
  event_id: string;
  image_data: string;
  caption: string | null;
  sort_order: number;
  created_at: number;
  created_by: string | null;
}

export interface EventMedia extends EventMediaRow {}

export interface PublicEventMedia {
  /** Stable id so React can key — public, not load-bearing. */
  id: string;
  image_data: string;
  caption: string | null;
  sort_order: number;
}

export function listMedia(eventId: string): EventMedia[] {
  if (!eventId) return [];
  const db = getDb();
  return db
    .prepare('SELECT * FROM event_media WHERE event_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(eventId) as EventMediaRow[];
}

/**
 * Whitelisted projection used by /api/events/by-slug/[slug]/public —
 * deliberately strips created_by / created_at to avoid leaking internals.
 */
export function listPublicMedia(eventId: string): PublicEventMedia[] {
  return listMedia(eventId).map((m) => ({
    id: m.id,
    image_data: m.image_data,
    caption: m.caption,
    sort_order: m.sort_order,
  }));
}

export function getMedia(id: string): EventMedia | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM event_media WHERE id = ?').get(id) as EventMediaRow | undefined;
  return row ?? null;
}

export interface AddMediaInput {
  eventId: string;
  image_data: string;
  caption?: string | null;
  createdBy?: string | null;
}

/**
 * Append a new media row. sort_order auto-assigns to MAX(sort_order)+1
 * so newcomers land at the end of the gallery and don't shift existing
 * items.
 */
export function addMedia(input: AddMediaInput): EventMedia {
  if (!input.eventId) throw new Error('eventId is required.');
  if (!input.image_data || typeof input.image_data !== 'string') {
    throw new Error('image_data is required.');
  }
  // Loose check — full data: URLs start with "data:image/...;base64,"
  // but we also allow plain https URLs in case a future ImageUpload
  // implementation switches to remote storage.
  if (!/^(data:image\/|https?:\/\/)/i.test(input.image_data)) {
    throw new Error('image_data must be a data: URL or https URL.');
  }

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  const nextOrder =
    (db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM event_media WHERE event_id = ?')
      .get(input.eventId) as { m: number }).m + 1;

  db.prepare(`
    INSERT INTO event_media (id, event_id, image_data, caption, sort_order, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    action: 'event_media_add',
    entityType: 'event_media',
    entityId: id,
    details: { event_id: input.eventId, sort_order: nextOrder },
  });

  return getMedia(id)!;
}

export interface UpdateMediaInput {
  caption?: string | null;
}

export function updateMedia(id: string, patch: UpdateMediaInput, actor: string): EventMedia | null {
  const existing = getMedia(id);
  if (!existing) return null;
  if (!('caption' in patch)) return existing;

  const db = getDb();
  db.prepare('UPDATE event_media SET caption = ? WHERE id = ?')
    .run(patch.caption?.trim() || null, id);

  logAudit({
    actor,
    action: 'event_media_update',
    entityType: 'event_media',
    entityId: id,
    details: { caption: patch.caption ?? null },
  });

  return getMedia(id);
}

export function deleteMedia(id: string, actor: string): boolean {
  const existing = getMedia(id);
  if (!existing) return false;
  const db = getDb();
  db.prepare('DELETE FROM event_media WHERE id = ?').run(id);
  logAudit({
    actor,
    action: 'event_media_delete',
    entityType: 'event_media',
    entityId: id,
    details: { event_id: existing.event_id },
  });
  return true;
}

/**
 * Bulk reorder: rewrites sort_order for every id in orderedIds (index = new
 * position). Wrapped in a transaction so the carousel never flashes a
 * half-saved state. Any ids that don't belong to the event are skipped
 * silently — the UI shouldn't be able to send them anyway.
 */
export function reorderMedia(eventId: string, orderedIds: string[], actor: string): EventMedia[] {
  if (!eventId) throw new Error('eventId is required.');
  if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array.');

  const db = getDb();
  const existing = listMedia(eventId);
  const existingIds = new Set(existing.map((m) => m.id));

  const tx = db.transaction((ids: string[]) => {
    const stmt = db.prepare('UPDATE event_media SET sort_order = ? WHERE id = ? AND event_id = ?');
    let pos = 0;
    for (const id of ids) {
      if (!existingIds.has(id)) continue;
      stmt.run(pos, id, eventId);
      pos++;
    }
    // Any ids that weren't in the orderedIds payload get pushed to the end
    // in their existing relative order, so unknown items don't disappear.
    for (const m of existing) {
      if (ids.includes(m.id)) continue;
      stmt.run(pos, m.id, eventId);
      pos++;
    }
  });
  tx(orderedIds);

  logAudit({
    actor,
    action: 'event_media_reorder',
    entityType: 'event',
    entityId: eventId,
    details: { count: orderedIds.length },
  });

  return listMedia(eventId);
}
