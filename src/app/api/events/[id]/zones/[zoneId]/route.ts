/**
 * /api/events/[id]/zones/[zoneId]
 *
 *   PATCH  — single-zone update. host / manager.
 *   DELETE — host / manager; soft-deletes (active=0) when sold_count > 0
 *            so historical reservations still resolve, hard-deletes otherwise.
 *
 * Note: [zoneId] here is the event_zones.id PK (nanoid), NOT the SVG layer
 * id. The wizard always knows the PK when it has a row in hand; the SVG
 * layer id is editable in-place via the PATCH zone_id field.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import {
  getZone,
  updateZone,
  deleteZone,
  type UpdateZoneInput,
} from '@/lib/seating-layout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; zoneId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, zoneId } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  const zone = getZone(zoneId);
  if (!zone || zone.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'zone not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: UpdateZoneInput = {};
  if ('zone_id' in body) patch.zone_id = String(body.zone_id ?? '');
  if ('zone_label' in body) patch.zone_label = String(body.zone_label ?? '');
  if ('price' in body) patch.price = Number(body.price);
  if ('capacity' in body) patch.capacity = Number(body.capacity);
  if ('color' in body) patch.color = typeof body.color === 'string' ? body.color : null;
  if ('sort_order' in body) patch.sort_order = Number(body.sort_order);
  if ('active' in body) patch.active = !!body.active;

  try {
    const updated = updateZone(zoneId, patch, session.name);
    return NextResponse.json({ ok: true, zone: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update zone.';
    // Lowering capacity below sold_count surfaces as a friendly 409.
    const status = /already sold/i.test(msg) ? 409 : 400;
    return NextResponse.json({ ok: false, message: msg }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; zoneId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, zoneId } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  const zone = getZone(zoneId);
  if (!zone || zone.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'zone not found' }, { status: 404 });
  }

  const result = deleteZone(zoneId, session.name);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.reason || 'Failed to delete zone.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, softDeleted: result.softDeleted });
}
