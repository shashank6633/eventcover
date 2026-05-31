/**
 * Seating Layout — sanitize uploaded venue SVGs, extract named zones, and
 * provide a CRUD layer over the event_zones table.
 *
 * Two-stage XSS defence:
 *   1. sanitizeSvg() runs on every WRITE (admin upload → DB).
 *   2. The same sanitizer runs on the CLIENT before dangerouslySetInnerHTML
 *      (EventZoneSvg.tsx). Defence-in-depth: if either layer is patched
 *      independently the other still catches malicious content.
 *
 * Parser strategy: regex on the sanitized string — Figma's SVG export is
 * deterministic so we don't pay the cost of pulling in jsdom / @xmldom.
 * If non-Figma exports ever become a problem the implementation can be
 * swapped out behind the same public API without touching callers.
 */
import { getDb } from './db';
import { nanoid } from 'nanoid';
import type { Database } from 'better-sqlite3';
import { logAudit } from './audit';
// Re-export the isomorphic sanitizer + types so existing server callers keep
// importing from '@/lib/seating-layout'. The actual implementation lives in
// svg-sanitize.ts (no Node-only deps) so SeatingPicker.tsx (client) can use
// the same sanitize logic for defense-in-depth.
export {
  sanitizeSvg,
  parseSvgZones,
  MAX_SVG_BYTES,
  DEFAULT_ZONE_EXCLUDE_PREFIXES,
} from './svg-sanitize';
export type { ZoneCandidate, SanitizeResult } from './svg-sanitize';
// Plus a local import so functions in THIS file (e.g. bulkUpsertFromSvg) can
// reference the type — `export type ... from` doesn't create a local binding.
import type { ZoneCandidate } from './svg-sanitize';

// ─── Public types ─────────────────────────────────────────────────────────

export interface EventZoneRow {
  id: string;
  event_id: string;
  zone_id: string;
  zone_label: string;
  price: number;
  capacity: number;
  sold_count: number;
  color: string | null;
  sort_order: number;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface EventZone extends Omit<EventZoneRow, 'active'> {
  active: boolean;
}

export interface PublicEventZone {
  /** event_zones.id — stable React key. */
  id: string;
  /** Matches the SVG layer id="..." attribute. */
  zone_id: string;
  zone_label: string;
  price: number;
  capacity: number;
  sold_count: number;
  color: string | null;
  active: boolean;
}

// ─── Sanitizer ────────────────────────────────────────────────────────────
//
// The sanitizer + parseSvgZones + constants + ZoneCandidate / SanitizeResult
// types now live in ./svg-sanitize.ts (pure string ops, no Node-only deps) so
// the client-side SeatingPicker can import them too. The `export ... from`
// statements above re-expose the same surface here for back-compat — every
// existing import of `@/lib/seating-layout` keeps working unchanged.
//
// Everything from here down is the server-only DB layer (zone CRUD, reserve /
// release seat counts, bulk upsert from sanitized SVG, etc.).

// ─── Zone CRUD ────────────────────────────────────────────────────────────

function hydrate(row: EventZoneRow): EventZone {
  return { ...row, active: !!row.active };
}

function publicProjection(row: EventZoneRow): PublicEventZone {
  return {
    id: row.id,
    zone_id: row.zone_id,
    zone_label: row.zone_label,
    price: row.price,
    capacity: row.capacity,
    sold_count: row.sold_count,
    color: row.color,
    active: !!row.active,
  };
}

export function listZones(eventId: string): EventZone[] {
  if (!eventId) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM event_zones
        WHERE event_id = ?
        ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(eventId) as EventZoneRow[];
  return rows.map(hydrate);
}

/**
 * Whitelisted projection used by /api/events/by-slug/[slug]/public. Mirrors
 * the admin list but drops created_at/updated_at + flattens active to a
 * boolean so the public renderer doesn't have to.
 */
export function listPublicZones(eventId: string): PublicEventZone[] {
  if (!eventId) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM event_zones
        WHERE event_id = ?
        ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(eventId) as EventZoneRow[];
  return rows.map(publicProjection);
}

export function getZone(id: string): EventZone | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM event_zones WHERE id = ?').get(id) as
    | EventZoneRow
    | undefined;
  return row ? hydrate(row) : null;
}

/**
 * Resolve an event-scoped zone by its SVG layer id. Useful when the public
 * booking flow needs to map a zone_id sent by the customer back to the
 * server-side row.
 */
export function getZoneByZoneId(eventId: string, zoneId: string): EventZone | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM event_zones WHERE event_id = ? AND zone_id = ? LIMIT 1')
    .get(eventId, zoneId) as EventZoneRow | undefined;
  return row ? hydrate(row) : null;
}

export interface CreateZoneInput {
  eventId: string;
  zoneId: string;
  label: string;
  price?: number;
  capacity?: number;
  color?: string | null;
  sortOrder?: number;
  active?: boolean;
  createdBy?: string;
}

export function createZone(input: CreateZoneInput): EventZone {
  if (!input.eventId) throw new Error('eventId is required.');
  const zoneId = String(input.zoneId || '').trim();
  if (!zoneId) throw new Error('zoneId is required.');
  const label = String(input.label || zoneId).trim();
  const price = Number.isFinite(Number(input.price)) ? Math.max(0, Number(input.price)) : 0;
  const capacity = Number.isInteger(Number(input.capacity))
    ? Math.max(0, Number(input.capacity))
    : 0;

  const db = getDb();
  const id = nanoid();
  const now = Date.now();

  try {
    db.prepare(
      `INSERT INTO event_zones
        (id, event_id, zone_id, zone_label, price, capacity, sold_count, color, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.eventId,
      zoneId,
      label,
      price,
      capacity,
      input.color || null,
      Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0,
      input.active === false ? 0 : 1,
      now,
      now,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create zone.';
    if (/UNIQUE/i.test(msg)) {
      throw new Error(`Zone "${zoneId}" already exists for this event.`);
    }
    throw err;
  }

  logAudit({
    actor: input.createdBy || 'system',
    action: 'event_zone_create',
    entityType: 'event_zone',
    entityId: id,
    details: { event_id: input.eventId, zone_id: zoneId, label, price, capacity },
  });

  return getZone(id)!;
}

export interface UpdateZoneInput {
  zone_id?: string;
  zone_label?: string;
  price?: number;
  capacity?: number;
  color?: string | null;
  sort_order?: number;
  active?: boolean;
}

export function updateZone(id: string, patch: UpdateZoneInput, actor: string): EventZone | null {
  const existing = getZone(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, val: string | number | null) => {
    fields.push(`${col} = ?`);
    values.push(val);
  };

  if (patch.zone_id != null) {
    const zid = String(patch.zone_id).trim();
    if (!zid) throw new Error('zone_id cannot be empty.');
    set('zone_id', zid);
  }
  if (patch.zone_label != null) {
    set('zone_label', String(patch.zone_label).trim() || existing.zone_label);
  }
  if (patch.price != null) {
    const p = Number(patch.price);
    if (!Number.isFinite(p) || p < 0) throw new Error('price must be a non-negative number.');
    set('price', p);
  }
  if (patch.capacity != null) {
    const cap = Number(patch.capacity);
    if (!Number.isInteger(cap) || cap < 0) {
      throw new Error('capacity must be a non-negative integer.');
    }
    if (cap < existing.sold_count) {
      throw new Error(
        `${existing.sold_count} seats already sold in this zone; cannot lower capacity below that.`,
      );
    }
    set('capacity', cap);
  }
  if ('color' in patch) set('color', patch.color ? String(patch.color) : null);
  if (patch.sort_order != null) {
    const so = Number(patch.sort_order);
    if (!Number.isInteger(so)) throw new Error('sort_order must be an integer.');
    set('sort_order', so);
  }
  if (patch.active != null) set('active', patch.active ? 1 : 0);

  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  const db = getDb();
  try {
    db.prepare(`UPDATE event_zones SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update zone.';
    if (/UNIQUE/i.test(msg)) {
      throw new Error('Another zone in this event already uses that zone_id.');
    }
    throw err;
  }

  logAudit({
    actor,
    action: 'event_zone_update',
    entityType: 'event_zone',
    entityId: id,
    details: patch as Record<string, unknown>,
  });

  return getZone(id);
}

/**
 * Delete a zone. Soft-deletes (active=0) when sold_count > 0 so historical
 * reservations still resolve; hard-deletes otherwise. Only host-role
 * callers should reach this path — the API layer enforces that.
 */
export function deleteZone(id: string, actor: string): { ok: boolean; softDeleted: boolean; reason?: string } {
  const existing = getZone(id);
  if (!existing) return { ok: false, softDeleted: false, reason: 'Zone not found.' };

  const db = getDb();
  if (existing.sold_count > 0) {
    db.prepare('UPDATE event_zones SET active = 0, updated_at = ? WHERE id = ?').run(Date.now(), id);
    logAudit({
      actor,
      action: 'event_zone_soft_delete',
      entityType: 'event_zone',
      entityId: id,
      details: { event_id: existing.event_id, zone_id: existing.zone_id, sold_count: existing.sold_count },
    });
    return { ok: true, softDeleted: true };
  }

  db.prepare('DELETE FROM event_zones WHERE id = ?').run(id);
  logAudit({
    actor,
    action: 'event_zone_delete',
    entityType: 'event_zone',
    entityId: id,
    details: { event_id: existing.event_id, zone_id: existing.zone_id },
  });
  return { ok: true, softDeleted: false };
}

/**
 * INSERT … ON CONFLICT(event_id, zone_id) DO UPDATE — preserves price,
 * capacity, sold_count, active when the host re-uploads. Only zone_label
 * + color are refreshed from the new SVG so admin edits stay sticky.
 */
export function bulkUpsertFromSvg(
  eventId: string,
  candidates: ZoneCandidate[],
  actor: string,
): EventZone[] {
  if (!eventId) throw new Error('eventId is required.');
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO event_zones
      (id, event_id, zone_id, zone_label, price, capacity, sold_count, color, sort_order, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, 1, ?, ?)
    ON CONFLICT(event_id, zone_id) DO UPDATE SET
      zone_label = excluded.zone_label,
      color = COALESCE(event_zones.color, excluded.color),
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction((rows: ZoneCandidate[]) => {
    let order = 0;
    for (const c of rows) {
      if (!c.id) continue;
      stmt.run(
        nanoid(),
        eventId,
        c.id,
        c.label || c.id,
        c.color || null,
        order,
        now,
        now,
      );
      order += 1;
    }
  });
  tx(candidates);

  logAudit({
    actor,
    action: 'event_zone_bulk_upsert',
    entityType: 'event',
    entityId: eventId,
    details: { count: candidates.length },
  });

  return listZones(eventId);
}

/**
 * Reserve `pax` seats inside a zone, re-reading sold_count + capacity under
 * the implicit row lock. MUST be called inside a db.transaction() so the
 * check + write happen atomically. Returns false when the zone is inactive
 * or capacity would be exceeded.
 */
export function reserveZoneSeats(zoneId: string, pax: number, db?: Database): boolean {
  if (!zoneId || !Number.isFinite(pax) || pax <= 0) return false;
  const handle = db ?? getDb();
  const row = handle
    .prepare('SELECT capacity, sold_count, active FROM event_zones WHERE id = ?')
    .get(zoneId) as { capacity: number; sold_count: number; active: number } | undefined;
  if (!row) return false;
  if (!row.active) return false;
  if (row.sold_count + pax > row.capacity) return false;
  handle
    .prepare('UPDATE event_zones SET sold_count = sold_count + ?, updated_at = ? WHERE id = ?')
    .run(pax, Date.now(), zoneId);
  return true;
}

/**
 * Inverse of reserveZoneSeats — clamps at 0 so a stale zone_pax_count can
 * never drive sold_count negative.
 */
export function releaseZoneSeats(zoneId: string, pax: number, db?: Database): void {
  if (!zoneId || !Number.isFinite(pax) || pax <= 0) return;
  const handle = db ?? getDb();
  handle
    .prepare(
      `UPDATE event_zones
        SET sold_count = MAX(0, sold_count - ?),
            updated_at = ?
        WHERE id = ?`,
    )
    .run(pax, Date.now(), zoneId);
}

/**
 * Recompute sold_count from the sum of reservations.zone_pax_count for
 * non-cancelled / non-no_show bookings. Admin escape hatch for drift.
 */
export function rebuildSoldCountFromReservations(eventId: string, actor: string): { updated: number } {
  if (!eventId) return { updated: 0 };
  const db = getDb();
  const zones = listZones(eventId);
  const now = Date.now();
  let updated = 0;

  const tx = db.transaction(() => {
    const sumStmt = db.prepare(`
      SELECT COALESCE(SUM(zone_pax_count), 0) AS total
        FROM reservations
       WHERE zone_id = ?
         AND status NOT IN ('cancelled', 'no_show')
    `);
    const update = db.prepare(
      'UPDATE event_zones SET sold_count = ?, updated_at = ? WHERE id = ?',
    );
    for (const z of zones) {
      const sum = (sumStmt.get(z.id) as { total: number } | undefined)?.total ?? 0;
      if (sum !== z.sold_count) {
        update.run(sum, now, z.id);
        updated += 1;
      }
    }
  });
  tx();

  logAudit({
    actor,
    action: 'event_zones_rebuild',
    entityType: 'event',
    entityId: eventId,
    details: { updated },
  });

  return { updated };
}
