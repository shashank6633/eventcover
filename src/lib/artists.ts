import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';

export interface ArtistRow {
  id: string;
  name: string;
  about: string | null;
  social_url: string | null;
  image_data: string | null;
  active: number;
  created_at: number;
  created_by: string | null;
}

export interface Artist extends Omit<ArtistRow, 'active'> {
  active: boolean;
}

/**
 * Server-side hard cap on the size of an image data URL.
 *
 * Client already resizes to 800×800 JPEG @ 0.85 quality (~80–150 KB). We accept up to
 * ~1.5 MB to leave headroom for slightly larger uploads from old/poorly-compressed
 * source images. Beyond that, we reject — base64 in SQLite stops being sensible.
 */
const MAX_IMAGE_BYTES = 1_500_000;

function toArtist(row: ArtistRow): Artist {
  return { ...row, active: !!row.active };
}

export function listArtists(): Artist[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM artists ORDER BY active DESC, name ASC',
  ).all() as ArtistRow[];
  return rows.map(toArtist);
}

export function getArtist(id: string): Artist | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM artists WHERE id = ?').get(id) as ArtistRow | undefined;
  return row ? toArtist(row) : null;
}

export interface ArtistInput {
  name: string;
  about?: string | null;
  social_url?: string | null;
  image_data?: string | null;
}

export function createArtist(input: ArtistInput, createdBy: string): Artist {
  const name = input.name.trim();
  if (!name) throw new Error('Artist name is required.');

  const social = (input.social_url ?? '').trim();
  if (social && !isValidUrl(social)) throw new Error('Social media URL is not a valid link.');

  const image = (input.image_data ?? '').trim() || null;
  validateImageData(image);

  const db = getDb();
  const id = nanoid();
  db.prepare(`
    INSERT INTO artists (id, name, about, social_url, image_data, active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    name,
    (input.about ?? '').trim() || null,
    social || null,
    image,
    Date.now(),
    createdBy,
  );
  logAudit({
    actor: createdBy, action: 'artist_create', entityType: 'artist', entityId: id,
    details: { name, has_image: !!image },
  });
  return getArtist(id)!;
}

export interface ArtistPatch {
  name?: string;
  about?: string | null;
  social_url?: string | null;
  image_data?: string | null;
  active?: boolean;
}

export function updateArtist(id: string, patch: ArtistPatch, actor: string): Artist | null {
  const existing = getArtist(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) throw new Error('Artist name cannot be empty.');
    fields.push('name = ?'); values.push(v);
  }
  if (patch.about !== undefined) {
    fields.push('about = ?'); values.push((patch.about ?? '').trim() || null);
  }
  if (patch.social_url !== undefined) {
    const url = (patch.social_url ?? '').trim();
    if (url && !isValidUrl(url)) throw new Error('Social media URL is not a valid link.');
    fields.push('social_url = ?'); values.push(url || null);
  }
  if (patch.image_data !== undefined) {
    const img = (patch.image_data ?? '').trim() || null;
    validateImageData(img);
    fields.push('image_data = ?'); values.push(img);
  }
  if (patch.active !== undefined) {
    fields.push('active = ?'); values.push(patch.active ? 1 : 0);
  }

  if (fields.length === 0) return existing;
  values.push(id);

  const db = getDb();
  db.prepare(`UPDATE artists SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  logAudit({
    actor, action: 'artist_update', entityType: 'artist', entityId: id,
    // Don't log the image_data blob — just whether it changed.
    details: { ...patch, image_data: patch.image_data !== undefined ? (patch.image_data ? '<set>' : '<removed>') : undefined },
  });
  return getArtist(id);
}

export function deleteArtist(id: string, actor: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM artists WHERE id = ?').run(id);
  if (result.changes > 0) {
    logAudit({ actor, action: 'artist_delete', entityType: 'artist', entityId: id });
    return true;
  }
  return false;
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateImageData(image: string | null): void {
  if (!image) return;
  if (!image.startsWith('data:image/')) {
    throw new Error('Image must be a data URL (data:image/...).');
  }
  if (image.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large after compression (${Math.round(image.length / 1024)} KB). Try a smaller source image.`);
  }
}
