import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { defaultEventDate } from './expiry';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'eventcover.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      pax INTEGER DEFAULT 1,
      source TEXT DEFAULT 'walk_in',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets (
      txn_id TEXT PRIMARY KEY,
      guest_id TEXT NOT NULL REFERENCES guests(id),
      entry_fee REAL NOT NULL,
      cover_issued REAL NOT NULL,
      balance REAL NOT NULL,
      payment_method TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_fail_count INTEGER DEFAULT 0,
      pin_locked_until INTEGER,
      status TEXT DEFAULT 'active',
      issued_by TEXT,
      issued_at INTEGER NOT NULL,
      checked_out_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);
    CREATE INDEX IF NOT EXISTS idx_wallets_issued_at ON wallets(issued_at DESC);

    CREATE TABLE IF NOT EXISTS redemptions (
      id TEXT PRIMARY KEY,
      txn_id TEXT NOT NULL REFERENCES wallets(txn_id),
      amount REAL NOT NULL,
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      captain TEXT NOT NULL,
      order_ref TEXT,
      notes TEXT,
      status TEXT DEFAULT 'success',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_redemptions_created ON redemptions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_redemptions_txn ON redemptions(txn_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp DESC);

    CREATE TABLE IF NOT EXISTS venues (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      city            TEXT NOT NULL,
      address         TEXT,
      google_maps_url TEXT,
      notes           TEXT,
      active          INTEGER DEFAULT 1,
      created_at      INTEGER NOT NULL,
      created_by      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_venues_active ON venues(active);

    CREATE TABLE IF NOT EXISTS artists (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      about       TEXT,
      social_url  TEXT,
      image_data  TEXT,
      active      INTEGER DEFAULT 1,
      created_at  INTEGER NOT NULL,
      created_by  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_artists_active ON artists(active);

    CREATE TABLE IF NOT EXISTS tickets (
      id              TEXT PRIMARY KEY,
      event_id        TEXT NOT NULL,
      guest_id        TEXT,
      customer_name   TEXT NOT NULL,
      customer_phone  TEXT NOT NULL,
      customer_gender TEXT,
      customer_notes  TEXT,
      ticket_name     TEXT NOT NULL,
      category        TEXT NOT NULL,
      pax             INTEGER NOT NULL DEFAULT 1,
      ticket_notes    TEXT,
      internal_notes  TEXT,
      price           REAL NOT NULL DEFAULT 0,
      paid_offline    INTEGER DEFAULT 0,
      complimentary   INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'issued',
      created_at      INTEGER NOT NULL,
      created_by      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

    /**
     * Paid bookings — distinct from "tickets" (offline guestlist/walk-in) and "wallets" (cover-spend).
     * A booking has many booking_items (each is an individual entry line OR a table line).
     */
    CREATE TABLE IF NOT EXISTS bookings (
      id              TEXT PRIMARY KEY,
      event_id        TEXT NOT NULL,
      customer_name   TEXT NOT NULL,
      customer_phone  TEXT NOT NULL,
      customer_email  TEXT,
      type            TEXT NOT NULL,          -- 'individual' | 'table' | 'mixed'
      total_pax       INTEGER NOT NULL DEFAULT 0,
      entry_total     REAL NOT NULL DEFAULT 0,
      table_entry_total REAL NOT NULL DEFAULT 0,
      cover_total     REAL NOT NULL DEFAULT 0,
      subtotal        REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      gst_amount      REAL NOT NULL DEFAULT 0,
      final_amount    REAL NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed' | 'cancelled'
      payment_method  TEXT,                              -- 'cash' | 'upi' | 'card' | 'online' | 'comp'
      notes           TEXT,
      created_at      INTEGER NOT NULL,
      created_by      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_event ON bookings(event_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

    CREATE TABLE IF NOT EXISTS booking_items (
      id              TEXT PRIMARY KEY,
      booking_id      TEXT NOT NULL,
      kind            TEXT NOT NULL,          -- 'individual' | 'table'
      table_type_id   TEXT,
      table_type_name TEXT,                   -- denormalized snapshot
      table_capacity  INTEGER,                -- denormalized snapshot (may be overridden per-line)
      table_entry_fee REAL,                   -- denormalized snapshot
      male_count      INTEGER NOT NULL DEFAULT 0,
      female_count    INTEGER NOT NULL DEFAULT 0,
      couple_count    INTEGER NOT NULL DEFAULT 0,
      pax_occupied    INTEGER NOT NULL DEFAULT 0,
      entry_amount    REAL NOT NULL DEFAULT 0,
      cover_amount    REAL NOT NULL DEFAULT 0,
      item_total      REAL NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_booking_items_booking ON booking_items(booking_id);

    CREATE TABLE IF NOT EXISTS venue_tables (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      capacity INTEGER DEFAULT 4,
      zone TEXT,
      status TEXT DEFAULT 'open',
      active_wallet_txn TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tables_status ON venue_tables(status);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event_date TEXT NOT NULL,
      status TEXT DEFAULT 'live',
      base_entry_fee REAL NOT NULL DEFAULT 0,
      cover_policy TEXT NOT NULL DEFAULT 'equal',
      cover_value REAL DEFAULT 100,
      pax_rules TEXT DEFAULT '[]',
      cutoff_hour INTEGER DEFAULT 2,
      notes TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      email TEXT,
      role TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

    CREATE TABLE IF NOT EXISTS otp_codes (
      id              TEXT PRIMARY KEY,
      identifier      TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      user_id         TEXT,
      code_hash       TEXT NOT NULL,
      expires_at      INTEGER NOT NULL,
      attempts        INTEGER DEFAULT 0,
      used            INTEGER DEFAULT 0,
      created_at      INTEGER NOT NULL,
      ip              TEXT,
      user_agent      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_codes(identifier, used, expires_at DESC);
    CREATE INDEX IF NOT EXISTS idx_otp_created ON otp_codes(created_at DESC);

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      provider TEXT NOT NULL,
      external_ref TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      pax INTEGER DEFAULT 1,
      arrival_time TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      converted_wallet_txn TEXT,
      synced_at INTEGER NOT NULL,
      raw TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reservations_event ON reservations(event_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_reservations_provider_ref
      ON reservations(provider, external_ref) WHERE external_ref IS NOT NULL;
  `);

  migrate(db);

  const seed: [string, string][] = [
    ['VENUE_NAME', 'Demo Lounge'],
    ['EVENT_NAME', 'Saturday Night'],
    ['DEFAULT_ENTRY_FEE', '1500'],
    ['PIN_LENGTH', '6'],
    ['EVENT_CUTOFF_HOUR', '2'],
    ['EVENT_DATE', defaultEventDate(2)],
    ['SESSION_SECRET', nanoid(48)],
    ['RESERVATION_PROVIDER', 'reservego-mock'],
    ['OTP_PROVIDER', 'console'],          // 'console' | 'email' | 'whatsapp'
    ['OTP_TTL_SECONDS', '300'],            // 5 minutes
    ['OTP_MAX_ATTEMPTS', '5'],
    ['OTP_REQUEST_COOLDOWN_SECONDS', '60'],
    ['OTP_LENGTH', '6'],
  ];
  const up = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of seed) up.run(k, v);

  seedHostIfEmpty(db);
  seedVenueIfEmpty(db);
}

function seedVenueIfEmpty(db: Database.Database) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM venues').get() as { c: number };
  if (row.c > 0) return;

  const venueName = (db.prepare(`SELECT value FROM config WHERE key = 'VENUE_NAME'`).get() as { value: string } | undefined)?.value || 'My Venue';
  db.prepare(`
    INSERT INTO venues (id, name, city, address, google_maps_url, notes, active, created_at, created_by)
    VALUES (?, ?, 'Hyderabad', NULL, NULL, NULL, 1, ?, 'system')
  `).run(nanoid(), venueName, Date.now());
}

function seedHostIfEmpty(db: Database.Database) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (row.c > 0) return;

  const defaultPin = '1234';
  const hash = bcrypt.hashSync(defaultPin, 10);
  const id = nanoid();
  const phone = db.prepare(`SELECT value FROM config WHERE key = 'HOST_PHONE'`).get() as { value: string } | undefined;
  db.prepare(`
    INSERT INTO users (id, name, phone, email, role, pin_hash, active, created_at, created_by)
    VALUES (?, 'Host', ?, NULL, 'host', ?, 1, ?, 'system')
  `).run(id, phone?.value || '+910000000000', hash, Date.now());

  console.log('\n============================================');
  console.log('  EventCover Host account bootstrapped');
  console.log('  Phone:', phone?.value || '+910000000000');
  console.log('  PIN:  ', defaultPin);
  console.log('  ▲ Change this in /admin/staff after login.');
  console.log('============================================\n');
}

function migrate(db: Database.Database) {
  // Cashier settlement columns on redemptions
  const redCols = db.prepare('PRAGMA table_info(redemptions)').all() as { name: string }[];
  const addRedCol = (name: string, ddl: string) => {
    if (!redCols.some((c) => c.name === name)) db.exec(`ALTER TABLE redemptions ADD COLUMN ${name} ${ddl}`);
  };
  addRedCol('settled',     'INTEGER DEFAULT 0');
  addRedCol('settled_by',  'TEXT');
  addRedCol('settled_at',  'INTEGER');
  addRedCol('invoice_no',  'TEXT');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_redemptions_settled ON redemptions(settled, created_at DESC)'); } catch { /* idempotent */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_redemptions_invoice ON redemptions(invoice_no)'); } catch { /* idempotent */ }

  const walletCols = db.prepare('PRAGMA table_info(wallets)').all() as { name: string }[];
  if (!walletCols.some((c) => c.name === 'expires_at')) {
    db.exec('ALTER TABLE wallets ADD COLUMN expires_at INTEGER');
  }
  if (!walletCols.some((c) => c.name === 'table_id')) {
    db.exec('ALTER TABLE wallets ADD COLUMN table_id TEXT');
  }
  if (!walletCols.some((c) => c.name === 'event_id')) {
    db.exec('ALTER TABLE wallets ADD COLUMN event_id TEXT');
  }
  if (!walletCols.some((c) => c.name === 'reservation_id')) {
    db.exec('ALTER TABLE wallets ADD COLUMN reservation_id TEXT');
  }

  // Events wizard columns — additive so legacy event rows keep working.
  const eventCols = db.prepare('PRAGMA table_info(events)').all() as { name: string }[];
  const addEvCol = (name: string, ddl: string) => {
    if (!eventCols.some((c) => c.name === name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${ddl}`);
  };
  addEvCol('description',     'TEXT');
  addEvCol('image_data',      'TEXT');
  addEvCol('start_time',      'TEXT');
  addEvCol('is_public',       'INTEGER DEFAULT 1');
  addEvCol('venue_id',        'TEXT');
  addEvCol('artist_ids',      "TEXT DEFAULT '[]'");
  addEvCol('genre',           'TEXT');
  addEvCol('tags',            "TEXT DEFAULT '[]'");
  addEvCol('terms',           'TEXT');
  addEvCol('faqs',            'TEXT');
  addEvCol('booking_types',   "TEXT DEFAULT '[]'");
  addEvCol('messages_config', "TEXT DEFAULT '{}'");

  // Pricing engine columns
  addEvCol('entry_fee_per_person', 'REAL DEFAULT 500');
  addEvCol('cover_male_stag',      'REAL DEFAULT 2000');
  addEvCol('cover_female_stag',    'REAL DEFAULT 1000');
  addEvCol('cover_couple',         'REAL DEFAULT 3000');
  addEvCol('entry_enabled',        'INTEGER DEFAULT 1');
  addEvCol('cover_enabled',        'INTEGER DEFAULT 1');
  addEvCol('table_types',          "TEXT DEFAULT '[]'");
  addEvCol('occupancy_rule',       "TEXT DEFAULT 'exact'");
  addEvCol('gst_percent',          'REAL DEFAULT 0');
  addEvCol('discount_percent',     'REAL DEFAULT 0');
}

export function getConfig(key: string, fallback = ''): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setConfig(key: string, value: string) {
  const db = getDb();
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getAllConfig(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM config').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
