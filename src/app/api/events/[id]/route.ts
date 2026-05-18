import { NextRequest, NextResponse } from 'next/server';
import { getEvent, updateEvent, deleteEvent } from '@/lib/events';
import { validatePaxRules, validateBookingTypes } from '@/lib/events-validators';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, event });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};

  // Strings (nullable copy semantics — pass null to clear)
  for (const k of [
    'name', 'event_date', 'status', 'cover_policy', 'notes',
    'description', 'image_data', 'start_time', 'venue_id',
    'genre', 'terms', 'faqs',
  ]) {
    if (k in body) patch[k] = body[k];
  }

  // Numbers
  for (const k of [
    'base_entry_fee', 'cover_value', 'cutoff_hour',
    'entry_fee_per_person', 'cover_male_stag', 'cover_female_stag', 'cover_couple',
    'gst_percent', 'discount_percent',
  ]) {
    if (k in body) patch[k] = Number(body[k]);
  }

  // Booleans
  if ('is_public' in body) patch.is_public = !!body.is_public;
  if ('entry_enabled' in body) patch.entry_enabled = !!body.entry_enabled;
  if ('cover_enabled' in body) patch.cover_enabled = !!body.cover_enabled;

  // Occupancy rule (enum)
  if (body.occupancy_rule === 'exact' || body.occupancy_rule === 'min') {
    patch.occupancy_rule = body.occupancy_rule;
  }

  // Table types (validated array of {id, name, capacity, entry_fee})
  if ('table_types' in body) {
    if (!Array.isArray(body.table_types)) {
      return NextResponse.json({ ok: false, message: 'table_types must be an array.' }, { status: 400 });
    }
    const VALID_VIS = new Set(['none', 'hidden', 'fast_filling', 'sold_out']);
    const sanitized: Record<string, unknown>[] = [];
    for (const raw of body.table_types as Record<string, unknown>[]) {
      const out: Record<string, unknown> = {
        id: typeof raw.id === 'string' && raw.id ? raw.id : `tt_${Math.random().toString(36).slice(2, 9)}`,
        name: String(raw.name || '').trim(),
        capacity: Math.max(1, Number(raw.capacity) || 1),
        entry_fee: Math.max(0, Number(raw.entry_fee) || 0),
      };
      if ('info' in raw) out.info = typeof raw.info === 'string' ? raw.info : '';
      if ('visibility' in raw && typeof raw.visibility === 'string' && VALID_VIS.has(raw.visibility)) {
        out.visibility = raw.visibility;
      }
      if ('external_link' in raw) {
        const url = typeof raw.external_link === 'string' ? raw.external_link.trim() : '';
        if (url && !/^https?:\/\//i.test(url)) {
          return NextResponse.json(
            { ok: false, message: `Table "${out.name}": external link must start with http:// or https://` },
            { status: 400 },
          );
        }
        out.external_link = url || null;
      }
      if ('contact_cta_enabled' in raw) out.contact_cta_enabled = !!raw.contact_cta_enabled;
      if ('max_per_booking' in raw) out.max_per_booking = Math.max(0, Number(raw.max_per_booking) || 0);
      if ('inventory' in raw) out.inventory = Math.max(0, Number(raw.inventory) || 0);
      if ('time_slots' in raw && Array.isArray(raw.time_slots)) {
        out.time_slots = (raw.time_slots as Record<string, unknown>[]).map((s) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `ts_${Math.random().toString(36).slice(2, 9)}`,
          start: String(s.start || ''),
          end: String(s.end || ''),
          quantity: Math.max(0, Number(s.quantity) || 0),
        }));
      }
      sanitized.push(out);
    }
    patch.table_types = sanitized;
  }

  // Arrays
  if ('artist_ids' in body && Array.isArray(body.artist_ids)) {
    patch.artist_ids = body.artist_ids.map(String);
  }
  if ('tags' in body && Array.isArray(body.tags)) {
    patch.tags = body.tags.map(String);
  }

  // Nested JSON
  if ('pax_rules' in body) {
    const rules = validatePaxRules(body.pax_rules);
    if (rules instanceof Error) return NextResponse.json({ ok: false, message: rules.message }, { status: 400 });
    patch.pax_rules = rules;
  }
  if ('booking_types' in body) {
    const bts = validateBookingTypes(body.booking_types);
    if (bts instanceof Error) return NextResponse.json({ ok: false, message: bts.message }, { status: 400 });
    patch.booking_types = bts;
  }
  if ('messages_config' in body && body.messages_config && typeof body.messages_config === 'object') {
    patch.messages_config = body.messages_config;
  }

  const event = updateEvent(id, patch);
  if (!event) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, event });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ok = deleteEvent(id);
  if (!ok) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
