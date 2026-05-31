/**
 * /api/events/[id]/ticket-phases/prices
 *
 *   PATCH — bulk upsert pricing matrix cells.
 *           body { updates: Array<{ phase_id, scope, scope_id, price, inventory? }> }
 *
 * Wrapped in a transaction so a half-saved matrix is impossible. Each cell
 * goes through upsertPrice() (which validates scope + price + inventory).
 * On the first row error we roll back and surface the message.
 *
 * Auth: host / manager.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import {
  listPhases,
  listPricesForPhase,
  upsertPrice,
  invalidateActivePhaseCache,
  type PhaseScope,
} from '@/lib/ticket-phases';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UpdateCell {
  phase_id: string;
  scope: PhaseScope;
  scope_id: string | null;
  price: number;
  inventory?: number | null;
}

/**
 * GET — flat list of every price cell across every phase for this event.
 * The parent /ticket-phases endpoint nests prices under phases; PricingMatrix
 * wants a flat array so it can build a single Map keyed by (phase, scope,
 * scope_id) without walking a tree.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) {
    return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  }
  const phases = listPhases(id);
  const prices = phases.flatMap((p) => listPricesForPhase(p.id));
  return NextResponse.json({ ok: true, prices });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { updates?: unknown };
  if (!Array.isArray(body.updates)) {
    return NextResponse.json(
      { ok: false, message: 'updates must be an array.' },
      { status: 400 },
    );
  }

  // Pre-validate every row before opening the transaction so a malformed
  // entry rolls the whole batch back cleanly. We also constrain the
  // phase_id to this event's phases so a manager from one event can't
  // mutate another event's pricing.
  const validScope: PhaseScope[] = ['table_type', 'zone', 'flat_entry'];
  const eventPhaseIds = new Set(listPhases(id).map((p) => p.id));
  const ops: UpdateCell[] = [];
  for (const raw of body.updates as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const phase_id = typeof raw.phase_id === 'string' ? raw.phase_id : '';
    if (!phase_id || !eventPhaseIds.has(phase_id)) {
      return NextResponse.json(
        { ok: false, message: `Unknown phase_id: ${phase_id}` },
        { status: 400 },
      );
    }
    const scope = typeof raw.scope === 'string' ? (raw.scope as PhaseScope) : null;
    if (!scope || !validScope.includes(scope)) {
      return NextResponse.json(
        { ok: false, message: `scope must be one of ${validScope.join(', ')}` },
        { status: 400 },
      );
    }
    const scope_id = scope === 'flat_entry'
      ? null
      : (typeof raw.scope_id === 'string' && raw.scope_id ? raw.scope_id : null);
    if (scope !== 'flat_entry' && !scope_id) {
      return NextResponse.json(
        { ok: false, message: 'scope_id is required for table_type / zone scope.' },
        { status: 400 },
      );
    }
    const priceNum = Number(raw.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return NextResponse.json(
        { ok: false, message: 'price must be a non-negative number.' },
        { status: 400 },
      );
    }
    let inventory: number | null | undefined;
    if ('inventory' in raw) {
      if (raw.inventory == null || raw.inventory === '') {
        inventory = null;
      } else {
        const inv = Number(raw.inventory);
        if (!Number.isInteger(inv) || inv < 0) {
          return NextResponse.json(
            { ok: false, message: 'inventory must be a non-negative integer or null.' },
            { status: 400 },
          );
        }
        inventory = inv;
      }
    }
    ops.push({ phase_id, scope, scope_id, price: priceNum, inventory });
  }

  const db = getDb();
  try {
    db.transaction(() => {
      for (const op of ops) {
        upsertPrice({
          phaseId: op.phase_id,
          scope: op.scope,
          scopeId: op.scope_id,
          price: op.price,
          inventory: op.inventory,
        });
      }
    })();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update prices.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }

  // upsertPrice() doesn't bust the active-phase cache (it's a price-only
  // mutation), but a fresh write may change which prices the customer sees
  // — drop the entry so the next /api/events/by-slug/.../public reads the
  // current row instead of a 30s-stale snapshot.
  invalidateActivePhaseCache(id);

  logAudit({
    actor: session.name,
    action: 'ticket_phase_prices_bulk_upsert',
    entityType: 'event',
    entityId: id,
    details: { count: ops.length },
  });

  // Return the fresh per-phase price snapshots so the admin matrix doesn't
  // need a follow-up GET.
  const phases = listPhases(id).map((p) => ({
    id: p.id,
    name: p.name,
    prices: listPricesForPhase(p.id),
  }));
  return NextResponse.json({ ok: true, phases });
}
