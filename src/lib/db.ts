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
    // Reservego webhook integration — Bearer-token shared secret. Auto-generated
    // on first boot; host can regenerate it from /admin/settings/reservego.
    ['RESERVEGO_WEBHOOK_SECRET', nanoid(40)],
    ['RESERVEGO_WEBHOOK_LAST_AT', '0'],
    ['RESERVEGO_WEBHOOK_LAST_ACTION', ''],
    ['RESERVEGO_WEBHOOK_LAST_STATUS', ''],
    // When 'true' (default), a webhook for a date with no matching event
    // auto-creates a draft event and attaches the reservation. When 'false',
    // missing event → 404 and Reservego's delivery is rejected.
    ['RESERVEGO_AUTO_CREATE_EVENTS', 'true'],
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

  // ─── Affiliate tracking ──────────────────────────────────────────────
  // Each affiliate is an external promoter with a unique ref code. Clicks
  // are logged when their link is opened (via RefCapture in the layout);
  // commissions accrue when a ticket is created against their code;
  // payouts bundle paid commissions for an affiliate at a point in time.
  db.exec(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id                TEXT PRIMARY KEY,
      code              TEXT UNIQUE NOT NULL,
      name              TEXT NOT NULL,
      phone             TEXT,
      email             TEXT,
      status            TEXT NOT NULL DEFAULT 'active',
      commission_type   TEXT NOT NULL DEFAULT 'percent',
      commission_value  REAL NOT NULL DEFAULT 10,
      notes             TEXT,
      created_at        INTEGER NOT NULL,
      created_by        TEXT,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_affiliates_status ON affiliates(status);
    CREATE INDEX IF NOT EXISTS idx_affiliates_code   ON affiliates(code);

    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id           TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      event_id     TEXT,
      ip           TEXT,
      user_agent   TEXT,
      referer      TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clicks_affiliate ON affiliate_clicks(affiliate_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS affiliate_payouts (
      id           TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
      amount       REAL NOT NULL,
      method       TEXT NOT NULL DEFAULT 'cash',
      reference    TEXT,
      notes        TEXT,
      paid_by      TEXT,
      paid_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payouts_affiliate ON affiliate_payouts(affiliate_id, paid_at DESC);

    CREATE TABLE IF NOT EXISTS affiliate_commissions (
      id                TEXT PRIMARY KEY,
      ticket_id         TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      affiliate_id      TEXT NOT NULL REFERENCES affiliates(id),
      event_id          TEXT,
      sale_amount       REAL NOT NULL,
      commission_type   TEXT NOT NULL,
      commission_value  REAL NOT NULL,
      commission_amount REAL NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      payout_id         TEXT REFERENCES affiliate_payouts(id),
      created_at        INTEGER NOT NULL,
      paid_at           INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON affiliate_commissions(affiliate_id, status);
    CREATE INDEX IF NOT EXISTS idx_commissions_ticket    ON affiliate_commissions(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_payout    ON affiliate_commissions(payout_id);

    /**
     * Many-to-many: which events is this affiliate authorized to earn on?
     * Strict attribution — a ticket only earns commission when an assignment
     * row exists for (affiliate_id, ticket.event_id).
     *
     * commission_type / commission_value are nullable — when blank, fall
     * back to the affiliate's default values.
     */
    CREATE TABLE IF NOT EXISTS affiliate_event_assignments (
      id                TEXT PRIMARY KEY,
      affiliate_id      TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      event_id          TEXT NOT NULL REFERENCES events(id)     ON DELETE CASCADE,
      commission_type   TEXT,
      commission_value  REAL,
      created_at        INTEGER NOT NULL,
      UNIQUE(affiliate_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_event     ON affiliate_event_assignments(event_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_affiliate ON affiliate_event_assignments(affiliate_id);
  `);

  // Attribution fields stamped onto the ticket itself for fast joins + history
  const ticketCols = db.prepare('PRAGMA table_info(tickets)').all() as { name: string }[];
  const addTicketCol = (name: string, ddl: string) => {
    if (!ticketCols.some((c) => c.name === name)) db.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${ddl}`);
  };
  addTicketCol('affiliate_code',    'TEXT');
  addTicketCol('affiliate_id',      'TEXT');
  addTicketCol('commission_amount', 'REAL');
  addTicketCol('commission_status', 'TEXT');

  // ─── Reservations: first-class data (event_id nullable + event_date col) ──
  // Originally reservations.event_id was NOT NULL, forcing every booking to
  // be tied to an existing event. That doesn't match how Reservego works:
  // bookings come in for any future date, and we may not have created the
  // event yet (or it may never become a ticketed event at all). New model:
  //   • event_id is NULLABLE — reservations can exist without an event
  //   • event_date is the source of truth for which day the booking is for
  //   • when an event is later created for that date, auto-link unassigned
  //     reservations to it (handled in lib/events.ts createEvent)
  const resCols = db.prepare('PRAGMA table_info(reservations)').all() as { name: string; notnull: number }[];
  const eventIdCol = resCols.find((c) => c.name === 'event_id');
  const needsRecreate = eventIdCol && eventIdCol.notnull === 1;
  const hasEventDate = resCols.some((c) => c.name === 'event_date');

  if (needsRecreate) {
    // SQLite doesn't support modifying constraints in place — recreate.
    // This is the canonical SQLite migration pattern (CREATE → COPY →
    // DROP → RENAME), wrapped in a transaction so it's atomic.
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE IF NOT EXISTS reservations_new (
        id                   TEXT PRIMARY KEY,
        event_id             TEXT REFERENCES events(id),  -- now nullable
        event_date           TEXT,                         -- new column
        provider             TEXT NOT NULL,
        external_ref         TEXT,
        name                 TEXT NOT NULL,
        phone                TEXT NOT NULL,
        email                TEXT,
        pax                  INTEGER DEFAULT 1,
        arrival_time         TEXT,
        notes                TEXT,
        status               TEXT DEFAULT 'pending',
        converted_wallet_txn TEXT,
        synced_at            INTEGER NOT NULL,
        raw                  TEXT
      );

      INSERT INTO reservations_new (
        id, event_id, event_date, provider, external_ref, name, phone, email,
        pax, arrival_time, notes, status, converted_wallet_txn, synced_at, raw
      )
      SELECT
        r.id, r.event_id,
        COALESCE(e.event_date, NULL) AS event_date,
        r.provider, r.external_ref, r.name, r.phone, r.email,
        r.pax, r.arrival_time, r.notes, r.status, r.converted_wallet_txn,
        r.synced_at, r.raw
      FROM reservations r
      LEFT JOIN events e ON e.id = r.event_id;

      DROP TABLE reservations;
      ALTER TABLE reservations_new RENAME TO reservations;

      CREATE INDEX IF NOT EXISTS idx_reservations_event  ON reservations(event_id);
      CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
      CREATE INDEX IF NOT EXISTS idx_reservations_date   ON reservations(event_date);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_reservations_provider_ref
        ON reservations(provider, external_ref) WHERE external_ref IS NOT NULL;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  } else if (!hasEventDate) {
    // Already nullable (newer install) but missing the event_date column.
    db.exec(`ALTER TABLE reservations ADD COLUMN event_date TEXT`);
    db.exec(`
      UPDATE reservations
      SET event_date = COALESCE(
        event_date,
        (SELECT event_date FROM events WHERE events.id = reservations.event_id)
      )
      WHERE event_date IS NULL AND event_id IS NOT NULL
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(event_date)`);
  }

  // ─── Reservations: Reservego-rich fields ──────────────────────────────────
  // The webhook payload includes structured arrays (tables, tags, custom
  // tags, preferences) and customer-context fields (bday, anniv, total
  // visits) plus the raw bookingTime. Originally these were either dropped
  // or merged into a single `notes` blob. Promote them to first-class
  // columns so the UI can render them independently and so future code can
  // query/filter by tag without parsing free text.
  //
  // All additive — re-read PRAGMA after the potential table recreate above
  // so we don't ALTER a stale column list.
  const resColsForRich = db.prepare('PRAGMA table_info(reservations)').all() as { name: string }[];
  const addResCol = (name: string, ddl: string) => {
    if (!resColsForRich.some((c) => c.name === name)) db.exec(`ALTER TABLE reservations ADD COLUMN ${name} ${ddl}`);
  };
  addResCol('booking_time',      'TEXT');
  addResCol('tables_json',       'TEXT');
  addResCol('tags_json',         'TEXT');
  addResCol('custom_tags_json',  'TEXT');
  addResCol('preferences_json',  'TEXT');
  addResCol('bday',              'TEXT');
  addResCol('anniv',             'TEXT');
  addResCol('total_visits',      'INTEGER');
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
