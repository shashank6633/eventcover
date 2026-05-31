/**
 * /api/events/[id]/ticket-phases
 *
 *   GET    — list phases for the event + each phase's prices.
 *   POST   — create a new phase { name, ends_at?, ends_on_sellout? }.
 *   PATCH  — bulk reorder { orderedIds }.
 *
 * Auth: host / manager. Customer-facing reads of the active phase + prices
 * go through /api/events/by-slug/[slug]/public — DO NOT call this route
 * from the public booking page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import {
  listPhases,
  createPhase,
  reorderPhases,
  listPricesForPhase,
} from '@/lib/ticket-phases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const phases = listPhases(id);
  // Hydrate prices for each phase so the admin matrix renders in a single
  // round-trip. With a typical 3-4 phase setup the cost is negligible.
  const phasesWithPrices = phases.map((p) => ({
    ...p,
    prices: listPricesForPhase(p.id),
  }));
  return NextResponse.json({ ok: true, phases: phasesWithPrices });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    ends_at?: unknown;
    ends_on_sellout?: unknown;
    active?: unknown;
    sort_order?: unknown;
  };

  try {
    const phase = createPhase({
      eventId: id,
      name: String(body.name ?? ''),
      endsAt: body.ends_at != null && body.ends_at !== '' ? Number(body.ends_at) : null,
      endsOnSellout: body.ends_on_sellout === undefined ? true : !!body.ends_on_sellout,
      active: body.active === undefined ? true : !!body.active,
      sortOrder: body.sort_order != null ? Number(body.sort_order) : undefined,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, phase });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create phase.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

/**
 * Bulk reorder — body { orderedIds: string[] }
 *
 * Mirrors how /api/events/[id]/zones PATCH handles bulk updates: validates
 * the array, then defers to the lib's reorderPhases() which runs inside a
 * transaction so concurrent creates can't collide on sort_order.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { orderedIds?: unknown };
  if (!Array.isArray(body.orderedIds)) {
    return NextResponse.json(
      { ok: false, message: 'orderedIds must be an array.' },
      { status: 400 },
    );
  }

  try {
    const phases = reorderPhases(id, body.orderedIds.filter((s): s is string => typeof s === 'string'), session.name);
    return NextResponse.json({ ok: true, phases });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reorder phases.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
