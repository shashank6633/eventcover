/**
 * /api/events/[id]/zones
 *
 *   GET    — list zones for the event (host/manager).
 *   POST   — manually add a zone not present in the SVG (admin override).
 *   PATCH  — bulk update price/capacity/active/sort_order/label for many
 *            zones in one transaction. Mirrors how the wizard saves the
 *            full RSVP fields array on every save.
 *
 * Auth: host / manager (read + write). Single-zone DELETE lives at
 * /api/events/[id]/zones/[zoneId] for clarity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import {
  listZones,
  createZone,
  updateZone,
  type UpdateZoneInput,
} from '@/lib/seating-layout';

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
  return NextResponse.json({ ok: true, zones: listZones(id) });
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
    zone_id?: unknown;
    zone_label?: unknown;
    price?: unknown;
    capacity?: unknown;
    color?: unknown;
    sort_order?: unknown;
    active?: unknown;
  };

  try {
    const zone = createZone({
      eventId: id,
      zoneId: String(body.zone_id ?? ''),
      label: String(body.zone_label ?? body.zone_id ?? ''),
      price: body.price != null ? Number(body.price) : 0,
      capacity: body.capacity != null ? Number(body.capacity) : 0,
      color: typeof body.color === 'string' ? body.color : null,
      sortOrder: body.sort_order != null ? Number(body.sort_order) : undefined,
      active: body.active === undefined ? true : !!body.active,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, zone });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create zone.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

/**
 * Bulk PATCH — body { zones: Array<{ id, ...UpdateZoneInput }> }
 *
 * Wrapped in a transaction so a half-saved table is impossible. Each row
 * goes through updateZone() (which logs audit + validates lower-capacity
 * vs. sold_count). On the first row error we roll back and surface the
 * message.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { zones?: unknown };
  if (!Array.isArray(body.zones)) {
    return NextResponse.json(
      { ok: false, message: 'zones must be an array.' },
      { status: 400 },
    );
  }

  // Build a list of (id, patch) pairs to apply. Reject anything that's
  // obviously malformed before opening the transaction.
  type Pair = { id: string; patch: UpdateZoneInput };
  const ops: Pair[] = [];
  for (const raw of body.zones as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const rowId = typeof raw.id === 'string' ? raw.id : '';
    if (!rowId) continue;
    const patch: UpdateZoneInput = {};
    if ('zone_id' in raw) patch.zone_id = String(raw.zone_id ?? '');
    if ('zone_label' in raw) patch.zone_label = String(raw.zone_label ?? '');
    if ('price' in raw) patch.price = Number(raw.price);
    if ('capacity' in raw) patch.capacity = Number(raw.capacity);
    if ('color' in raw) patch.color = typeof raw.color === 'string' ? raw.color : null;
    if ('sort_order' in raw) patch.sort_order = Number(raw.sort_order);
    if ('active' in raw) patch.active = !!raw.active;
    ops.push({ id: rowId, patch });
  }

  const db = getDb();
  try {
    db.transaction(() => {
      for (const op of ops) {
        updateZone(op.id, op.patch, session.name);
      }
    })();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update zones.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true, zones: listZones(id) });
}
