import { getDb } from './db';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import type { CoverRates, TableType, OccupancyRule } from './pricing';
export type { TableType, OccupancyRule, CoverRates } from './pricing';

export type CoverPolicy = 'equal' | 'fixed' | 'percent';
export type EventStatus = 'draft' | 'live' | 'closed';

export interface PaxRule {
  label: string;
  min_pax: number;
  max_pax: number | null;
  fee_per_pax: number;
}

export interface TicketProduct {
  id: string;
  name: string;
  price: number;
  info: string | null;
}

export interface BookingType {
  id: string;
  name: string;
  tickets: TicketProduct[];
}

export interface MessagesConfig {
  wa_details_enabled?: boolean;
  event_location?: string;
  event_datetime?: string;
  poc_phone?: string;
  important_info?: string;
  wa_group_enabled?: boolean;
  wa_group_link?: string;
}

export interface EventRow {
  id: string;
  name: string;
  event_date: string;
  status: EventStatus;
  base_entry_fee: number;
  cover_policy: CoverPolicy;
  cover_value: number;
  pax_rules: string;
  cutoff_hour: number;
  notes: string | null;
  created_at: number;

  // Wizard fields
  description: string | null;
  image_data: string | null;
  start_time: string | null;
  is_public: number;
  venue_id: string | null;
  artist_ids: string;       // JSON
  genre: string | null;
  tags: string;             // JSON
  terms: string | null;
  faqs: string | null;
  booking_types: string;    // JSON
  messages_config: string;  // JSON

  // Pricing engine columns
  entry_fee_per_person: number;
  cover_male_stag: number;
  cover_female_stag: number;
  cover_couple: number;
  entry_enabled: number;
  cover_enabled: number;
  table_types: string;      // JSON
  occupancy_rule: string;
  gst_percent: number;
  discount_percent: number;
}

export interface Event extends Omit<EventRow,
  'pax_rules' | 'artist_ids' | 'tags' | 'booking_types' | 'messages_config' | 'is_public'
  | 'entry_enabled' | 'cover_enabled' | 'table_types' | 'occupancy_rule'
> {
  pax_rules: PaxRule[];
  artist_ids: string[];
  tags: string[];
  booking_types: BookingType[];
  messages_config: MessagesConfig;
  is_public: boolean;

  // Pricing engine (hydrated)
  entry_enabled: boolean;
  cover_enabled: boolean;
  table_types: TableType[];
  occupancy_rule: OccupancyRule;
  cover_rates: CoverRates;  // Convenience: built from cover_male_stag + cover_female_stag + cover_couple
}

export interface PriceResult {
  entryFee: number;
  coverIssued: number;
  ruleLabel: string | null;
  feePerPax: number;
  pax: number;
  paxNote: string;
}

function safeJson<T>(json: string | null | undefined, fallback: T): T {
  try {
    const parsed = JSON.parse(json || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function parseRules(json: string): PaxRule[] {
  const arr = safeJson<unknown>(json, []);
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (r): r is PaxRule =>
      !!r && typeof (r as PaxRule).label === 'string' &&
      Number.isFinite((r as PaxRule).min_pax) && Number.isFinite((r as PaxRule).fee_per_pax),
  );
}

function parseBookingTypes(json: string): BookingType[] {
  const arr = safeJson<unknown>(json, []);
  if (!Array.isArray(arr)) return [];
  return arr.filter((b): b is BookingType => !!b && typeof (b as BookingType).name === 'string')
    .map((b) => ({
      id: b.id || nanoid(),
      name: b.name,
      tickets: Array.isArray(b.tickets) ? b.tickets.map((t) => ({
        id: t.id || nanoid(),
        name: String(t.name || ''),
        price: Number(t.price) || 0,
        info: t.info ? String(t.info) : null,
      })) : [],
    }));
}

function parseTableTypes(json: string): TableType[] {
  const arr = safeJson<unknown>(json, []);
  if (!Array.isArray(arr)) return [];
  const VALID_VIS = new Set(['none', 'hidden', 'fast_filling', 'sold_out']);
  return arr
    .filter((t): t is TableType => !!t && typeof (t as TableType).name === 'string')
    .map((raw) => {
      const t = raw as TableType & Record<string, unknown>;
      const out: TableType = {
        id: t.id || nanoid(),
        name: String(t.name),
        capacity: Number(t.capacity) || 0,
        entry_fee: Number(t.entry_fee) || 0,
      };
      // Preserve all optional metadata so the customer-facing booking page can read it.
      if (typeof t.info === 'string') out.info = t.info;
      if (typeof t.visibility === 'string' && VALID_VIS.has(t.visibility)) {
        out.visibility = t.visibility as TableType['visibility'];
      }
      if ('external_link' in t) {
        out.external_link = typeof t.external_link === 'string' ? t.external_link : null;
      }
      if ('contact_cta_enabled' in t) out.contact_cta_enabled = !!t.contact_cta_enabled;
      if ('max_per_booking' in t) out.max_per_booking = Number(t.max_per_booking) || 0;
      if ('inventory' in t) out.inventory = Number(t.inventory) || 0;
      if (Array.isArray(t.time_slots)) {
        out.time_slots = (t.time_slots as Record<string, unknown>[]).map((s) => ({
          id: typeof s.id === 'string' && s.id ? s.id : nanoid(),
          start: String(s.start || ''),
          end: String(s.end || ''),
          quantity: Number(s.quantity) || 0,
        }));
      }
      return out;
    });
}

function hydrate(row: EventRow): Event {
  const occRule: OccupancyRule = row.occupancy_rule === 'min' ? 'min' : 'exact';
  return {
    ...row,
    pax_rules: parseRules(row.pax_rules),
    artist_ids: safeJson<string[]>(row.artist_ids, []),
    tags: safeJson<string[]>(row.tags, []),
    booking_types: parseBookingTypes(row.booking_types),
    messages_config: safeJson<MessagesConfig>(row.messages_config, {}),
    is_public: !!row.is_public,
    entry_enabled: !!row.entry_enabled,
    cover_enabled: !!row.cover_enabled,
    table_types: parseTableTypes(row.table_types),
    occupancy_rule: occRule,
    cover_rates: {
      male_stag: row.cover_male_stag ?? 2000,
      female_stag: row.cover_female_stag ?? 1000,
      couple: row.cover_couple ?? 3000,
    },
  };
}

export function listEvents(): Event[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM events ORDER BY event_date DESC, created_at DESC').all() as EventRow[];
  return rows.map(hydrate);
}

export function getEvent(id: string): Event | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
  return row ? hydrate(row) : null;
}

export function getEventForDate(dateISO: string): Event | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM events WHERE event_date = ? AND status != 'closed' ORDER BY created_at DESC LIMIT 1`,
  ).get(dateISO) as EventRow | undefined;
  return row ? hydrate(row) : null;
}

export interface CreateEventInput {
  name: string;
  event_date: string;
  base_entry_fee?: number;
  cover_policy?: CoverPolicy;
  cover_value?: number;
  pax_rules?: PaxRule[];
  cutoff_hour?: number;
  notes?: string | null;
  status?: EventStatus;

  description?: string | null;
  image_data?: string | null;
  start_time?: string | null;
  is_public?: boolean;
  venue_id?: string | null;
  artist_ids?: string[];
  genre?: string | null;
  tags?: string[];
  terms?: string | null;
  faqs?: string | null;
  booking_types?: BookingType[];
  messages_config?: MessagesConfig;

  // Pricing engine
  entry_fee_per_person?: number;
  cover_male_stag?: number;
  cover_female_stag?: number;
  cover_couple?: number;
  entry_enabled?: boolean;
  cover_enabled?: boolean;
  table_types?: TableType[];
  occupancy_rule?: OccupancyRule;
  gst_percent?: number;
  discount_percent?: number;
}

export function createEvent(input: CreateEventInput): Event {
  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  db.prepare(`
    INSERT INTO events (
      id, name, event_date, status, base_entry_fee, cover_policy, cover_value, pax_rules,
      cutoff_hour, notes, created_at,
      description, image_data, start_time, is_public, venue_id, artist_ids, genre, tags,
      terms, faqs, booking_types, messages_config
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.name.trim(), input.event_date,
    input.status || 'draft',
    input.base_entry_fee ?? 0,
    input.cover_policy || 'equal',
    input.cover_value == null ? 100 : input.cover_value,
    JSON.stringify(input.pax_rules || []),
    input.cutoff_hour || 2,
    input.notes || null,
    now,
    input.description || null,
    input.image_data || null,
    input.start_time || null,
    input.is_public === false ? 0 : 1,
    input.venue_id || null,
    JSON.stringify(input.artist_ids || []),
    input.genre || null,
    JSON.stringify(input.tags || []),
    input.terms || null,
    input.faqs || null,
    JSON.stringify(input.booking_types || []),
    JSON.stringify(input.messages_config || {}),
  );

  logAudit({ actor: 'admin', action: 'event_create', entityType: 'event', entityId: id, details: { name: input.name, date: input.event_date } });
  return getEvent(id)!;
}

export function updateEvent(id: string, patch: Partial<CreateEventInput>): Event | null {
  const db = getDb();
  const existing = getEvent(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, val: string | number | null) => { fields.push(`${col} = ?`); values.push(val); };

  if (patch.name != null) set('name', String(patch.name).trim());
  if (patch.event_date != null) set('event_date', String(patch.event_date));
  if (patch.status != null) set('status', patch.status);
  if (patch.base_entry_fee != null) set('base_entry_fee', Number(patch.base_entry_fee));
  if (patch.cover_policy != null) set('cover_policy', patch.cover_policy);
  if (patch.cover_value != null) set('cover_value', Number(patch.cover_value));
  if (patch.pax_rules != null) set('pax_rules', JSON.stringify(patch.pax_rules));
  if (patch.cutoff_hour != null) set('cutoff_hour', Number(patch.cutoff_hour));
  if ('notes' in patch) set('notes', patch.notes ?? null);

  if ('description' in patch) set('description', patch.description ?? null);
  if ('image_data' in patch) set('image_data', patch.image_data ?? null);
  if ('start_time' in patch) set('start_time', patch.start_time ?? null);
  if (patch.is_public != null) set('is_public', patch.is_public ? 1 : 0);
  if ('venue_id' in patch) set('venue_id', patch.venue_id ?? null);
  if (patch.artist_ids != null) set('artist_ids', JSON.stringify(patch.artist_ids));
  if ('genre' in patch) set('genre', patch.genre ?? null);
  if (patch.tags != null) set('tags', JSON.stringify(patch.tags));
  if ('terms' in patch) set('terms', patch.terms ?? null);
  if ('faqs' in patch) set('faqs', patch.faqs ?? null);
  if (patch.booking_types != null) set('booking_types', JSON.stringify(patch.booking_types));
  if (patch.messages_config != null) set('messages_config', JSON.stringify(patch.messages_config));

  // Pricing engine
  if (patch.entry_fee_per_person != null) set('entry_fee_per_person', Number(patch.entry_fee_per_person));
  if (patch.cover_male_stag != null) set('cover_male_stag', Number(patch.cover_male_stag));
  if (patch.cover_female_stag != null) set('cover_female_stag', Number(patch.cover_female_stag));
  if (patch.cover_couple != null) set('cover_couple', Number(patch.cover_couple));
  if (patch.entry_enabled != null) set('entry_enabled', patch.entry_enabled ? 1 : 0);
  if (patch.cover_enabled != null) set('cover_enabled', patch.cover_enabled ? 1 : 0);
  if (patch.table_types != null) set('table_types', JSON.stringify(patch.table_types));
  if (patch.occupancy_rule != null) set('occupancy_rule', patch.occupancy_rule);
  if (patch.gst_percent != null) set('gst_percent', Number(patch.gst_percent));
  if (patch.discount_percent != null) set('discount_percent', Number(patch.discount_percent));

  if (fields.length === 0) return existing;
  values.push(id);
  db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  // Don't log heavy fields (image_data, descriptions) — they bloat the audit log.
  const lightPatch: Record<string, unknown> = { ...patch };
  delete lightPatch.image_data;
  delete lightPatch.description;
  delete lightPatch.terms;
  delete lightPatch.faqs;
  logAudit({ actor: 'admin', action: 'event_update', entityType: 'event', entityId: id, details: lightPatch });
  return getEvent(id);
}

export function deleteEvent(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM events WHERE id = ?').run(id);
  if (result.changes > 0) {
    logAudit({ actor: 'admin', action: 'event_delete', entityType: 'event', entityId: id });
    return true;
  }
  return false;
}

export function priceEntry(event: Event, pax: number): PriceResult {
  const p = Math.max(1, Math.floor(pax));
  let feePerPax = event.base_entry_fee;
  let ruleLabel: string | null = null;
  let paxNote = `${p} × ₹${event.base_entry_fee} (base rate)`;

  for (const rule of event.pax_rules) {
    if (p >= rule.min_pax && (rule.max_pax == null || p <= rule.max_pax)) {
      feePerPax = rule.fee_per_pax;
      ruleLabel = rule.label;
      paxNote = `${p} × ₹${rule.fee_per_pax} (${rule.label})`;
      break;
    }
  }

  const entryFee = feePerPax * p;
  let coverIssued = entryFee;
  if (event.cover_policy === 'fixed') coverIssued = event.cover_value * p;
  else if (event.cover_policy === 'percent') coverIssued = Math.round(entryFee * (event.cover_value / 100));

  return { entryFee, coverIssued, ruleLabel, feePerPax, pax: p, paxNote };
}
