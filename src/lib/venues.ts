import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';

export interface VenueRow {
  id: string;
  name: string;
  city: string;
  address: string | null;
  google_maps_url: string | null;
  notes: string | null;
  active: number;
  created_at: number;
  created_by: string | null;
}

export interface Venue extends Omit<VenueRow, 'active'> {
  active: boolean;
}

function toVenue(row: VenueRow): Venue {
  return { ...row, active: !!row.active };
}

export function listVenues(): Venue[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM venues ORDER BY active DESC, name ASC').all() as VenueRow[];
  return rows.map(toVenue);
}

export function getVenue(id: string): Venue | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM venues WHERE id = ?').get(id) as VenueRow | undefined;
  return row ? toVenue(row) : null;
}

export interface CreateVenueInput {
  name: string;
  city: string;
  address?: string | null;
  google_maps_url?: string | null;
  notes?: string | null;
  createdBy: string;
}

export function createVenue(input: CreateVenueInput): Venue {
  const name = input.name.trim();
  const city = input.city.trim();
  if (!name) throw new Error('Name is required.');
  if (!city) throw new Error('City is required.');

  const mapsUrl = (input.google_maps_url ?? '').trim();
  if (mapsUrl && !isValidUrl(mapsUrl)) {
    throw new Error('Google Maps URL is not a valid URL.');
  }

  const db = getDb();
  const id = nanoid();
  db.prepare(`
    INSERT INTO venues (id, name, city, address, google_maps_url, notes, active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, name, city,
    (input.address ?? '').trim() || null,
    mapsUrl || null,
    (input.notes ?? '').trim() || null,
    Date.now(),
    input.createdBy,
  );
  logAudit({
    actor: input.createdBy, action: 'venue_create', entityType: 'venue', entityId: id,
    details: { name, city },
  });
  return getVenue(id)!;
}

export interface UpdateVenueInput {
  name?: string;
  city?: string;
  address?: string | null;
  google_maps_url?: string | null;
  notes?: string | null;
  active?: boolean;
}

export function updateVenue(id: string, patch: UpdateVenueInput, actor: string): Venue | null {
  const existing = getVenue(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) throw new Error('Name cannot be empty.');
    fields.push('name = ?'); values.push(v);
  }
  if (patch.city !== undefined) {
    const v = patch.city.trim();
    if (!v) throw new Error('City cannot be empty.');
    fields.push('city = ?'); values.push(v);
  }
  if (patch.google_maps_url !== undefined) {
    const url = (patch.google_maps_url ?? '').trim();
    if (url && !isValidUrl(url)) throw new Error('Google Maps URL is not a valid URL.');
    fields.push('google_maps_url = ?'); values.push(url || null);
  }
  if (patch.address !== undefined) {
    fields.push('address = ?'); values.push((patch.address ?? '').trim() || null);
  }
  if (patch.notes !== undefined) {
    fields.push('notes = ?'); values.push((patch.notes ?? '').trim() || null);
  }
  if (patch.active !== undefined) {
    fields.push('active = ?'); values.push(patch.active ? 1 : 0);
  }

  if (fields.length === 0) return existing;
  values.push(id);

  const db = getDb();
  db.prepare(`UPDATE venues SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  logAudit({ actor, action: 'venue_update', entityType: 'venue', entityId: id, details: patch as unknown as Record<string, unknown> });
  return getVenue(id);
}

export function deleteVenue(id: string, actor: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM venues WHERE id = ?').run(id);
  if (result.changes > 0) {
    logAudit({ actor, action: 'venue_delete', entityType: 'venue', entityId: id });
    return true;
  }
  return false;
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}
