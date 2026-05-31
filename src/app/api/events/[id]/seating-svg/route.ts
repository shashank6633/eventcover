/**
 * /api/events/[id]/seating-svg
 *
 *  POST   — upload (or replace) the venue SVG. Sanitizes the input, persists
 *           to events.seating_layout_svg, bulk-upserts the parsed zones,
 *           and flips seating_layout_enabled = 1.
 *  DELETE — clears the SVG + flips seating_layout_enabled = 0. Leaves
 *           event_zones rows in place so historical reservations resolve.
 *
 * Auth: host / manager only — mirrors the rest of the event admin surface.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getEvent, updateEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import { sanitizeSvg, bulkUpsertFromSvg, listZones, MAX_SVG_BYTES } from '@/lib/seating-layout';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — admin convenience: returns the current SVG (if any) + the parsed
 * zone list. The wizard hydrates the Seating Layout card from this.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const db = getDb();
  const row = db
    .prepare('SELECT seating_layout_svg, seating_layout_enabled, seating_layout_phases_enabled FROM events WHERE id = ?')
    .get(id) as
    | {
        seating_layout_svg: string | null;
        seating_layout_enabled: number;
        seating_layout_phases_enabled: number;
      }
    | undefined;
  return NextResponse.json({
    ok: true,
    svg: row?.seating_layout_svg ?? null,
    enabled: !!row?.seating_layout_enabled,
    phases_enabled: !!row?.seating_layout_phases_enabled,
    zones: listZones(id),
  });
}

/**
 * POST — body { svg: string, enabled?: boolean, phases_enabled?: boolean }
 *
 * Rejects with 400 + reason if sanitization fails. On success persists the
 * sanitized markup, runs bulkUpsertFromSvg() so the zones table reflects
 * the new layer list (existing price/capacity/sold_count on matching
 * zone_ids are preserved — admin edits are sticky across re-uploads), and
 * returns the new layout + zone list.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    svg?: unknown;
    enabled?: unknown;
    phases_enabled?: unknown;
  };

  if (typeof body.svg !== 'string') {
    return NextResponse.json(
      { ok: false, message: 'svg (string) is required.' },
      { status: 400 },
    );
  }
  if (body.svg.length > MAX_SVG_BYTES) {
    return NextResponse.json(
      { ok: false, message: `SVG exceeds the ${Math.round(MAX_SVG_BYTES / 1024)} KB limit.` },
      { status: 400 },
    );
  }

  const result = sanitizeSvg(body.svg);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.reason }, { status: 400 });
  }

  // Persist the sanitized SVG via the events lib's passthrough so the audit
  // trail stays consistent with other event edits.
  const enabledFlag = body.enabled === undefined ? true : !!body.enabled;
  const phasesFlag = body.phases_enabled === undefined ? undefined : !!body.phases_enabled;
  updateEvent(id, {
    seating_layout_svg: result.svg,
    seating_layout_enabled: enabledFlag,
    ...(phasesFlag !== undefined ? { seating_layout_phases_enabled: phasesFlag } : {}),
  });

  // Sync the zones table. Preserves price/capacity/sold_count on existing
  // zone_id matches; only zone_label + color refresh from the new SVG.
  bulkUpsertFromSvg(id, result.zones, session.name);

  logAudit({
    actor: session.name,
    action: 'event_seating_svg_upload',
    entityType: 'event',
    entityId: id,
    details: {
      bytes: result.svg.length,
      parsed_zones: result.zones.length,
      enabled: enabledFlag,
    },
  });

  return NextResponse.json({
    ok: true,
    svg: result.svg,
    enabled: enabledFlag,
    zones: listZones(id),
    parsed_zones: result.zones.length,
  });
}

/**
 * DELETE — clears the SVG + flips the feature off. Leaves the event_zones
 * rows so reservations that reference them keep resolving. Admin can
 * re-enable + re-upload later without losing history.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  updateEvent(id, {
    seating_layout_svg: null,
    seating_layout_enabled: false,
  });

  logAudit({
    actor: session.name,
    action: 'event_seating_svg_delete',
    entityType: 'event',
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
