/**
 * Phased Ticket Releases — Early Bird → Phase 1 → Phase 2 → ... transitions
 *
 * MODEL: phases are a pricing + inventory overlay on top of the existing
 * ticket types (table_types JSON entries) and seating zones (event_zones).
 * Each phase has many `event_ticket_phase_prices` rows — one per scope:
 *
 *   • scope='table_type', scope_id = table_types[].id
 *   • scope='zone',       scope_id = event_zones.id  (the PK, not the SVG id)
 *   • scope='flat_entry', scope_id = NULL — covers event-wide entry_fee_per_person
 *
 * ACTIVE PHASE RESOLUTION (cached 30s per event):
 *   First phase ordered by sort_order ASC where
 *     active=1
 *     AND (ends_at IS NULL OR ends_at > now)
 *     AND (NOT ends_on_sellout OR total_sold < total_inventory)
 *
 * AUTO-TRANSITION ON CAPTURE: /api/payments/verify calls
 * tryTransitionAfterCapture() after incrementing sold. If the active phase
 * is now sold out AND ends_on_sellout, the phase is marked ended_at=now
 * active=0 and the next phase by sort_order is activated. Time-based
 * transitions go through a separate sweep endpoint
 * /api/events/[id]/ticket-phases/sweep.
 */
import { nanoid } from 'nanoid';
import type { Database } from 'better-sqlite3';
import { getDb } from './db';
import { logAudit } from './audit';

// ─── Public types ─────────────────────────────────────────────────────────

export type PhaseScope = 'table_type' | 'zone' | 'flat_entry';

export interface TicketPhaseRow {
  id: string;
  event_id: string;
  name: string;
  sort_order: number;
  active: number;
  ends_at: number | null;
  ends_on_sellout: number;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TicketPhase {
  id: string;
  event_id: string;
  name: string;
  sort_order: number;
  active: boolean;
  ends_at: number | null;
  ends_on_sellout: boolean;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TicketPhasePriceRow {
  id: string;
  phase_id: string;
  scope: PhaseScope;
  scope_id: string | null;
  price: number;
  inventory: number | null;
  sold: number;
  created_at: number;
  updated_at: number;
}

export interface TicketPhasePrice {
  id: string;
  phase_id: string;
  scope: PhaseScope;
  scope_id: string | null;
  price: number;
  /** NULL means unlimited inventory. */
  inventory: number | null;
  sold: number;
  created_at: number;
  updated_at: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function hydratePhase(row: TicketPhaseRow): TicketPhase {
  return {
    ...row,
    active: !!row.active,
    ends_on_sellout: !!row.ends_on_sellout,
  };
}

function hydratePrice(row: TicketPhasePriceRow): TicketPhasePrice {
  return { ...row };
}

// ─── Phase CRUD ───────────────────────────────────────────────────────────

export function listPhases(eventId: string): TicketPhase[] {
  if (!eventId) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM event_ticket_phases
        WHERE event_id = ?
        ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(eventId) as TicketPhaseRow[];
  return rows.map(hydratePhase);
}

export function getPhase(id: string): TicketPhase | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM event_ticket_phases WHERE id = ?').get(id) as
    | TicketPhaseRow
    | undefined;
  return row ? hydratePhase(row) : null;
}

export interface CreatePhaseInput {
  eventId: string;
  name: string;
  sortOrder?: number;
  active?: boolean;
  endsAt?: number | null;
  endsOnSellout?: boolean;
  createdBy?: string;
}

export function createPhase(input: CreatePhaseInput): TicketPhase {
  if (!input.eventId) throw new Error('eventId is required.');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Phase name is required.');

  const db = getDb();
  const id = nanoid();
  const now = Date.now();

  // Default sort_order = MAX(sort_order) + 1 so a freshly-created phase
  // falls at the end of the queue, not in front of existing ones.
  let sortOrder = input.sortOrder;
  if (sortOrder == null || !Number.isFinite(sortOrder)) {
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM event_ticket_phases WHERE event_id = ?`,
      )
      .get(input.eventId) as { m: number } | undefined;
    sortOrder = (row?.m ?? -1) + 1;
  }

  const active = input.active === false ? 0 : 1;
  const endsAt = input.endsAt != null && Number.isFinite(Number(input.endsAt)) ? Number(input.endsAt) : null;
  const endsOnSellout = input.endsOnSellout === false ? 0 : 1;
  const startedAt = active ? now : null;

  db.prepare(
    `INSERT INTO event_ticket_phases
       (id, event_id, name, sort_order, active, ends_at, ends_on_sellout,
        started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(id, input.eventId, name, sortOrder, active, endsAt, endsOnSellout, startedAt, now, now);

  invalidateActivePhaseCache(input.eventId);

  logAudit({
    actor: input.createdBy || 'system',
    action: 'ticket_phase_create',
    entityType: 'ticket_phase',
    entityId: id,
    details: { event_id: input.eventId, name, sort_order: sortOrder, active: !!active },
  });

  return getPhase(id)!;
}

export interface UpdatePhaseInput {
  name?: string;
  sort_order?: number;
  active?: boolean;
  ends_at?: number | null;
  ends_on_sellout?: boolean;
}

export function updatePhase(id: string, patch: UpdatePhaseInput, actor: string): TicketPhase | null {
  const existing = getPhase(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, val: string | number | null) => {
    fields.push(`${col} = ?`);
    values.push(val);
  };

  if (patch.name != null) {
    const n = String(patch.name).trim();
    if (!n) throw new Error('Phase name cannot be empty.');
    set('name', n);
  }
  if (patch.sort_order != null) {
    const so = Number(patch.sort_order);
    if (!Number.isInteger(so)) throw new Error('sort_order must be an integer.');
    set('sort_order', so);
  }
  if (patch.active != null) {
    const willActivate = !!patch.active;
    set('active', willActivate ? 1 : 0);
    // When toggling ON for the first time, stamp started_at; toggling OFF
    // stamps ended_at so the audit trail is self-contained.
    if (willActivate && !existing.started_at) {
      set('started_at', Date.now());
    }
    if (!willActivate && existing.active && !existing.ended_at) {
      set('ended_at', Date.now());
    }
  }
  if ('ends_at' in patch) {
    if (patch.ends_at == null) set('ends_at', null);
    else {
      const n = Number(patch.ends_at);
      if (!Number.isFinite(n)) throw new Error('ends_at must be a number or null.');
      set('ends_at', n);
    }
  }
  if (patch.ends_on_sellout != null) {
    set('ends_on_sellout', patch.ends_on_sellout ? 1 : 0);
  }

  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  const db = getDb();
  db.prepare(`UPDATE event_ticket_phases SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  invalidateActivePhaseCache(existing.event_id);

  logAudit({
    actor,
    action: 'ticket_phase_update',
    entityType: 'ticket_phase',
    entityId: id,
    details: patch as Record<string, unknown>,
  });

  return getPhase(id);
}

/**
 * Delete a phase. Soft-deletes (active=0, ended_at=now) when any of its
 * prices have sold > 0 so historical reservations / audit still resolve;
 * hard-deletes otherwise (cascade drops the price rows via FK).
 */
export function deletePhase(id: string, actor: string): { ok: boolean; softDeleted: boolean; reason?: string } {
  const existing = getPhase(id);
  if (!existing) return { ok: false, softDeleted: false, reason: 'Phase not found.' };

  const db = getDb();
  const sumRow = db
    .prepare('SELECT COALESCE(SUM(sold), 0) AS total FROM event_ticket_phase_prices WHERE phase_id = ?')
    .get(id) as { total: number } | undefined;
  const sold = sumRow?.total ?? 0;

  if (sold > 0) {
    db.prepare(
      `UPDATE event_ticket_phases
          SET active = 0, ended_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(Date.now(), Date.now(), id);
    invalidateActivePhaseCache(existing.event_id);
    logAudit({
      actor,
      action: 'ticket_phase_soft_delete',
      entityType: 'ticket_phase',
      entityId: id,
      details: { event_id: existing.event_id, name: existing.name, sold },
    });
    return { ok: true, softDeleted: true };
  }

  db.prepare('DELETE FROM event_ticket_phases WHERE id = ?').run(id);
  invalidateActivePhaseCache(existing.event_id);
  logAudit({
    actor,
    action: 'ticket_phase_delete',
    entityType: 'ticket_phase',
    entityId: id,
    details: { event_id: existing.event_id, name: existing.name },
  });
  return { ok: true, softDeleted: false };
}

/**
 * Rewrite sort_order based on the supplied order. Phases not in the list
 * are left in place (their sort_order is not touched). Wrapped in a tx so
 * concurrent reorders + creates don't collide on the sort_order column.
 */
export function reorderPhases(eventId: string, orderedIds: string[], actor: string): TicketPhase[] {
  if (!eventId) throw new Error('eventId is required.');
  if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array.');

  const db = getDb();
  const stmt = db.prepare(
    `UPDATE event_ticket_phases SET sort_order = ?, updated_at = ? WHERE id = ? AND event_id = ?`,
  );
  const now = Date.now();
  db.transaction(() => {
    let order = 0;
    for (const id of orderedIds) {
      if (typeof id !== 'string' || !id) continue;
      stmt.run(order, now, id, eventId);
      order += 1;
    }
  })();

  invalidateActivePhaseCache(eventId);

  logAudit({
    actor,
    action: 'ticket_phase_reorder',
    entityType: 'event',
    entityId: eventId,
    details: { ordered_ids: orderedIds },
  });

  return listPhases(eventId);
}

/**
 * Mark a phase ended right now and activate the next one (by sort_order).
 * Convenience helper for the "End now" admin action — same logic the
 * auto-transition path runs internally.
 */
export function endPhaseNow(id: string, actor: string): TicketPhase | null {
  const existing = getPhase(id);
  if (!existing) return null;

  const db = getDb();
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `UPDATE event_ticket_phases
          SET active = 0, ended_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(now, now, id);
    activateNextPhase(existing.event_id, existing.sort_order, db);
  })();

  invalidateActivePhaseCache(existing.event_id);

  logAudit({
    actor,
    action: 'ticket_phase_end_now',
    entityType: 'ticket_phase',
    entityId: id,
    details: { event_id: existing.event_id, name: existing.name },
  });

  return getPhase(id);
}

// ─── Price CRUD ───────────────────────────────────────────────────────────

export function listPricesForPhase(phaseId: string): TicketPhasePrice[] {
  if (!phaseId) return [];
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM event_ticket_phase_prices WHERE phase_id = ? ORDER BY scope ASC, scope_id ASC')
    .all(phaseId) as TicketPhasePriceRow[];
  return rows.map(hydratePrice);
}

export function listPricesForEvent(eventId: string): TicketPhasePrice[] {
  if (!eventId) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.* FROM event_ticket_phase_prices p
         JOIN event_ticket_phases ph ON ph.id = p.phase_id
        WHERE ph.event_id = ?
        ORDER BY ph.sort_order ASC, p.scope ASC`,
    )
    .all(eventId) as TicketPhasePriceRow[];
  return rows.map(hydratePrice);
}

export interface UpsertPriceInput {
  phaseId: string;
  scope: PhaseScope;
  scopeId: string | null;
  price: number;
  inventory?: number | null;
}

/**
 * INSERT … ON CONFLICT(phase_id, scope, scope_id) DO UPDATE — preserves the
 * `sold` counter on subsequent edits so an admin can re-price + re-stock a
 * phase without resetting how much has already moved. Returns the row.
 */
export function upsertPrice(input: UpsertPriceInput): TicketPhasePrice {
  if (!input.phaseId) throw new Error('phaseId is required.');
  const validScope: PhaseScope[] = ['table_type', 'zone', 'flat_entry'];
  if (!validScope.includes(input.scope)) {
    throw new Error(`scope must be one of ${validScope.join(', ')}.`);
  }
  const scopeId = input.scope === 'flat_entry' ? null : (input.scopeId || null);
  if (input.scope !== 'flat_entry' && !scopeId) {
    throw new Error('scopeId is required for table_type / zone scope.');
  }
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('price must be a non-negative number.');
  }
  let inventory: number | null = null;
  if (input.inventory != null) {
    const inv = Number(input.inventory);
    if (!Number.isInteger(inv) || inv < 0) {
      throw new Error('inventory must be a non-negative integer or null.');
    }
    inventory = inv;
  }

  const db = getDb();
  const now = Date.now();

  // Two-step upsert: SQLite's ON CONFLICT clause requires the conflict
  // target columns; we use the unique index (phase_id, scope, scope_id).
  // NULL scope_id doesn't compare equal in SQLite's NULL handling for
  // UNIQUE constraints — flat_entry uses a sentinel '' value for the
  // conflict-target match… Actually SQLite treats NULLs as distinct in
  // unique indexes, so a duplicate flat_entry insert WOULD slip through.
  // Guard against that with an explicit pre-check for flat_entry.
  if (input.scope === 'flat_entry') {
    const existing = db
      .prepare(
        `SELECT id FROM event_ticket_phase_prices
          WHERE phase_id = ? AND scope = 'flat_entry' AND scope_id IS NULL
          LIMIT 1`,
      )
      .get(input.phaseId) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE event_ticket_phase_prices
            SET price = ?, inventory = ?, updated_at = ?
          WHERE id = ?`,
      ).run(price, inventory, now, existing.id);
      return getPriceById(existing.id)!;
    }
    const id = nanoid();
    db.prepare(
      `INSERT INTO event_ticket_phase_prices
         (id, phase_id, scope, scope_id, price, inventory, sold, created_at, updated_at)
       VALUES (?, ?, 'flat_entry', NULL, ?, ?, 0, ?, ?)`,
    ).run(id, input.phaseId, price, inventory, now, now);
    return getPriceById(id)!;
  }

  // Non-flat scope — UNIQUE(phase_id, scope, scope_id) works correctly
  // because scope_id is non-NULL. Try INSERT, fall back to UPDATE.
  try {
    const id = nanoid();
    db.prepare(
      `INSERT INTO event_ticket_phase_prices
         (id, phase_id, scope, scope_id, price, inventory, sold, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, input.phaseId, input.scope, scopeId, price, inventory, now, now);
    return getPriceById(id)!;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (!/UNIQUE/i.test(msg)) throw err;
    db.prepare(
      `UPDATE event_ticket_phase_prices
          SET price = ?, inventory = ?, updated_at = ?
        WHERE phase_id = ? AND scope = ? AND scope_id = ?`,
    ).run(price, inventory, now, input.phaseId, input.scope, scopeId);
    const row = db
      .prepare(
        `SELECT * FROM event_ticket_phase_prices
          WHERE phase_id = ? AND scope = ? AND scope_id = ?
          LIMIT 1`,
      )
      .get(input.phaseId, input.scope, scopeId) as TicketPhasePriceRow | undefined;
    return row ? hydratePrice(row) : (() => { throw new Error('Price row not found after upsert.'); })();
  }
}

function getPriceById(id: string): TicketPhasePrice | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM event_ticket_phase_prices WHERE id = ?').get(id) as
    | TicketPhasePriceRow
    | undefined;
  return row ? hydratePrice(row) : null;
}

/**
 * Atomic sold-counter bump. delta>0 captures, delta<0 reverses. Clamped at 0.
 * Caller is responsible for invoking inside a transaction when paired with
 * other mutations (e.g. payment capture).
 */
export function incrementSold(
  phaseId: string,
  scope: PhaseScope,
  scopeId: string | null,
  delta: number,
  db?: Database,
): TicketPhasePrice | null {
  if (!phaseId) return null;
  const n = Number(delta);
  if (!Number.isFinite(n) || n === 0) return null;
  const handle = db ?? getDb();

  // Match the same NULL-aware lookup as upsertPrice (flat_entry path).
  let row: TicketPhasePriceRow | undefined;
  if (scope === 'flat_entry' || scopeId == null) {
    row = handle
      .prepare(
        `SELECT * FROM event_ticket_phase_prices
          WHERE phase_id = ? AND scope = ? AND scope_id IS NULL
          LIMIT 1`,
      )
      .get(phaseId, scope) as TicketPhasePriceRow | undefined;
  } else {
    row = handle
      .prepare(
        `SELECT * FROM event_ticket_phase_prices
          WHERE phase_id = ? AND scope = ? AND scope_id = ?
          LIMIT 1`,
      )
      .get(phaseId, scope, scopeId) as TicketPhasePriceRow | undefined;
  }
  if (!row) return null;

  const next = Math.max(0, row.sold + n);
  handle
    .prepare('UPDATE event_ticket_phase_prices SET sold = ?, updated_at = ? WHERE id = ?')
    .run(next, Date.now(), row.id);

  return getPriceById(row.id);
}

// ─── Active-phase resolution + 30s in-memory cache ────────────────────────

interface ActivePhaseCacheEntry {
  expiresAt: number;
  phase: TicketPhase | null;
}
const ACTIVE_PHASE_CACHE = new Map<string, ActivePhaseCacheEntry>();
const ACTIVE_PHASE_TTL_MS = 30_000;

export function invalidateActivePhaseCache(eventId?: string): void {
  if (eventId) ACTIVE_PHASE_CACHE.delete(eventId);
  else ACTIVE_PHASE_CACHE.clear();
}

function phaseTotals(phaseId: string, db?: Database): { sold: number; inventory: number; unlimited: boolean } {
  const handle = db ?? getDb();
  const rows = handle
    .prepare('SELECT inventory, sold FROM event_ticket_phase_prices WHERE phase_id = ?')
    .all(phaseId) as { inventory: number | null; sold: number }[];
  let sold = 0;
  let inventory = 0;
  let unlimited = false;
  for (const r of rows) {
    sold += r.sold || 0;
    if (r.inventory == null) {
      unlimited = true;
    } else {
      inventory += r.inventory;
    }
  }
  return { sold, inventory, unlimited };
}

function isPhaseLive(phase: TicketPhase, now: number, db?: Database): boolean {
  if (!phase.active) return false;
  if (phase.ends_at != null && phase.ends_at <= now) return false;
  if (phase.ends_on_sellout) {
    const totals = phaseTotals(phase.id, db);
    // Unlimited inventory on any price = never sells out.
    if (!totals.unlimited && totals.inventory > 0 && totals.sold >= totals.inventory) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve the active phase for an event. Cached for 30s per eventId — the
 * cache is process-local so multi-instance deployments may resolve slightly
 * different phases during the TTL window. Acceptable trade-off given the
 * write paths that mutate phase state (capture, sweep) call
 * invalidateActivePhaseCache() to force a fresh read.
 */
export function getActivePhase(eventId: string): TicketPhase | null {
  if (!eventId) return null;
  const now = Date.now();
  const cached = ACTIVE_PHASE_CACHE.get(eventId);
  if (cached && cached.expiresAt > now) return cached.phase;

  const phases = listPhases(eventId);
  let active: TicketPhase | null = null;
  for (const p of phases) {
    if (isPhaseLive(p, now)) {
      active = p;
      break;
    }
  }

  ACTIVE_PHASE_CACHE.set(eventId, { expiresAt: now + ACTIVE_PHASE_TTL_MS, phase: active });
  return active;
}

/**
 * Look up the next phase by sort_order strictly after `afterSortOrder`. The
 * helper is used by both endPhaseNow() and the auto-transition path. NOT
 * filtered by `isPhaseLive` — the caller decides whether to activate it.
 */
function getNextPhase(eventId: string, afterSortOrder: number, db?: Database): TicketPhase | null {
  const handle = db ?? getDb();
  const row = handle
    .prepare(
      `SELECT * FROM event_ticket_phases
        WHERE event_id = ? AND sort_order > ?
        ORDER BY sort_order ASC
        LIMIT 1`,
    )
    .get(eventId, afterSortOrder) as TicketPhaseRow | undefined;
  return row ? hydratePhase(row) : null;
}

function activateNextPhase(eventId: string, afterSortOrder: number, db?: Database): TicketPhase | null {
  const next = getNextPhase(eventId, afterSortOrder, db);
  if (!next) return null;
  const handle = db ?? getDb();
  const now = Date.now();
  // Only stamp started_at the first time the phase comes alive.
  if (next.active && next.started_at) {
    return next;
  }
  handle
    .prepare(
      `UPDATE event_ticket_phases
          SET active = 1,
              started_at = COALESCE(started_at, ?),
              updated_at = ?
        WHERE id = ?`,
    )
    .run(now, now, next.id);
  return getPhase(next.id);
}

// ─── Public booking payload ───────────────────────────────────────────────

export interface PhasePricesForBooking {
  phase: TicketPhase | null;
  prices: TicketPhasePrice[];
  nextPhasePreview: {
    phase: TicketPhase;
    minPrice: number | null;
  } | null;
}

/**
 * Bundle used by /api/events/by-slug/[slug]/public so the customer-facing
 * page can render the current phase price grid + a teaser for the next
 * phase. The teaser falls back to NULL when no upcoming phase exists.
 */
export function getPhasePricesForBooking(eventId: string): PhasePricesForBooking {
  const active = getActivePhase(eventId);
  let prices: TicketPhasePrice[] = [];
  let nextPhasePreview: PhasePricesForBooking['nextPhasePreview'] = null;

  if (active) {
    prices = listPricesForPhase(active.id);
    const next = getNextPhase(eventId, active.sort_order);
    if (next) {
      const nextPrices = listPricesForPhase(next.id);
      const min = nextPrices.length
        ? Math.min(...nextPrices.map((p) => Number(p.price) || 0))
        : null;
      nextPhasePreview = { phase: next, minPrice: min };
    }
  } else {
    // No active phase — there may still be an upcoming one configured by
    // the host that hasn't started yet (active=0 + future ends_at OR sort
    // order). Surface the first such phase as the preview so the page can
    // render "Next: <Name> prices start at …".
    const phases = listPhases(eventId);
    for (const p of phases) {
      if (!p.active && (p.ends_at == null || p.ends_at > Date.now())) {
        const nextPrices = listPricesForPhase(p.id);
        const min = nextPrices.length
          ? Math.min(...nextPrices.map((q) => Number(q.price) || 0))
          : null;
        nextPhasePreview = { phase: p, minPrice: min };
        break;
      }
    }
  }

  return { phase: active, prices, nextPhasePreview };
}

// ─── Auto-transition + sweep ──────────────────────────────────────────────

export interface TryTransitionInput {
  eventId: string;
  scope: PhaseScope;
  scopeId: string | null;
  count: number;
}

/**
 * Called from /api/payments/verify after a successful capture. Increments
 * the active phase's price-row `sold` counter for the chosen scope/scopeId,
 * then — if the phase is now sold out AND ends_on_sellout — flips it to
 * active=0 and activates the next phase. Returns the resulting phase state.
 *
 * Fire-and-forget on the caller side: an exception here must NOT roll back
 * the customer's already-captured payment.
 */
export function tryTransitionAfterCapture(input: TryTransitionInput): {
  active: TicketPhase | null;
  transitioned: boolean;
} {
  if (!input.eventId) return { active: null, transitioned: false };
  const count = Number(input.count);
  if (!Number.isFinite(count) || count <= 0) {
    return { active: getActivePhase(input.eventId), transitioned: false };
  }

  const db = getDb();
  let transitioned = false;
  let finalPhase: TicketPhase | null = null;
  const now = Date.now();

  db.transaction(() => {
    // Re-resolve active phase inside the tx so two concurrent captures
    // serialize through better-sqlite3's single-writer model. We bypass the
    // cache here — the cache is for reads, captures must see latest state.
    const phases = listPhases(input.eventId);
    let active: TicketPhase | null = null;
    for (const p of phases) {
      if (isPhaseLive(p, now, db)) {
        active = p;
        break;
      }
    }
    if (!active) {
      finalPhase = null;
      return;
    }

    incrementSold(active.id, input.scope, input.scopeId, count, db);

    if (active.ends_on_sellout) {
      const totals = phaseTotals(active.id, db);
      if (!totals.unlimited && totals.inventory > 0 && totals.sold >= totals.inventory) {
        db.prepare(
          `UPDATE event_ticket_phases
              SET active = 0, ended_at = ?, updated_at = ?
            WHERE id = ?`,
        ).run(now, now, active.id);
        activateNextPhase(input.eventId, active.sort_order, db);
        transitioned = true;
      }
    }

    finalPhase = getActivePhase(input.eventId);
  })();

  invalidateActivePhaseCache(input.eventId);
  return { active: finalPhase, transitioned };
}

/**
 * Time-based sweep — runs through every active phase for the event and
 * ends any whose ends_at has passed, activating the next phase in line.
 * Idempotent: a second call within the same second is a no-op. Returns
 * a summary that the admin / cron caller can log.
 */
export function sweepTimeBasedTransitions(eventId: string, actor: string): {
  ended: string[];
  activated: string[];
} {
  if (!eventId) return { ended: [], activated: [] };
  const db = getDb();
  const now = Date.now();
  const ended: string[] = [];
  const activated: string[] = [];

  db.transaction(() => {
    const phases = listPhases(eventId);
    for (const p of phases) {
      if (!p.active) continue;
      if (p.ends_at == null || p.ends_at > now) continue;
      db.prepare(
        `UPDATE event_ticket_phases
            SET active = 0, ended_at = ?, updated_at = ?
          WHERE id = ?`,
      ).run(now, now, p.id);
      ended.push(p.id);
      const next = activateNextPhase(eventId, p.sort_order, db);
      if (next) activated.push(next.id);
    }
  })();

  invalidateActivePhaseCache(eventId);

  if (ended.length || activated.length) {
    logAudit({
      actor,
      action: 'ticket_phase_sweep',
      entityType: 'event',
      entityId: eventId,
      details: { ended, activated },
    });
  }

  return { ended, activated };
}

// ─── Pricing helpers ─────────────────────────────────────────────────────

/**
 * Resolve the active phase's price for a given (scope, scopeId) tuple, or
 * NULL when no phase is active OR the phase doesn't override that scope.
 * Used by /api/payments/order to pick the override before computeBilling().
 */
export function getActivePhasePrice(
  eventId: string,
  scope: PhaseScope,
  scopeId: string | null,
): { phase: TicketPhase; price: TicketPhasePrice } | null {
  const phase = getActivePhase(eventId);
  if (!phase) return null;
  const db = getDb();
  let row: TicketPhasePriceRow | undefined;
  if (scope === 'flat_entry' || scopeId == null) {
    row = db
      .prepare(
        `SELECT * FROM event_ticket_phase_prices
          WHERE phase_id = ? AND scope = ? AND scope_id IS NULL
          LIMIT 1`,
      )
      .get(phase.id, scope) as TicketPhasePriceRow | undefined;
  } else {
    row = db
      .prepare(
        `SELECT * FROM event_ticket_phase_prices
          WHERE phase_id = ? AND scope = ? AND scope_id = ?
          LIMIT 1`,
      )
      .get(phase.id, scope, scopeId) as TicketPhasePriceRow | undefined;
  }
  if (!row) return null;
  return { phase, price: hydratePrice(row) };
}
