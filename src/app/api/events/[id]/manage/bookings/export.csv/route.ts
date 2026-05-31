/**
 * GET /api/events/[id]/manage/bookings/export.csv
 *
 * Streams a CSV of every reservation for the event. Columns:
 *   name, phone, email, pax, amount, payment_status, booked_at, zone, slot,
 *   plus one column per RSVP field configured on the event.
 *
 * No pagination — the host expects to download everything in a single file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatIso(ts: number | null): string {
  if (!ts) return '';
  // IST representation — keeps the file human-readable for the host.
  return new Date(ts).toLocaleString('en-IN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

interface ExportRow {
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  status: string;
  synced_at: number;
  arrival_time: string | null;
  rsvp_answers_json: string | null;
  payment_amount: number | null;
  payment_status: string | null;
  slot_label: string | null;
  slot_start: string | null;
  zone_name: string | null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  const ev = getEvent(id);
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  const db = getDb();

  // Defensive: event_zones may or may not exist depending on whether the
  // seating-layout feature ever ran initSchema on this DB. Wrap zone JOIN
  // in a fallback so the export never explodes.
  let zoneSelect = `NULL AS zone_name`;
  try {
    const zoneExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='event_zones'`)
      .get();
    if (zoneExists) zoneSelect = `(SELECT name FROM event_zones WHERE id = r.zone_id) AS zone_name`;
  } catch { /* fall through */ }

  const rows = db
    .prepare(
      `SELECT
         r.name, r.phone, r.email, r.pax, r.status, r.synced_at,
         r.arrival_time, r.rsvp_answers_json,
         p.amount AS payment_amount,
         p.status AS payment_status,
         (SELECT label FROM event_slots WHERE id = r.slot_id)        AS slot_label,
         (SELECT start_time FROM event_slots WHERE id = r.slot_id)   AS slot_start,
         ${zoneSelect}
       FROM reservations r
       LEFT JOIN payments p ON p.id = (
         SELECT p2.id FROM payments p2 WHERE p2.reservation_id = r.id
          ORDER BY p2.updated_at DESC LIMIT 1
       )
       WHERE r.event_id = ?
       ORDER BY r.synced_at ASC`,
    )
    .all(id) as ExportRow[];

  // Build the header — base columns + dynamic RSVP columns (one per field
  // configured on the event at export time).
  const baseCols = [
    'name', 'phone', 'email', 'pax',
    'amount', 'payment_status', 'booked_at',
    'zone', 'slot',
  ];
  const rsvpFields = ev.rsvp_fields || [];

  const headerLine = [
    ...baseCols,
    ...rsvpFields.map((f) => f.label || f.id),
  ].map(csvEscape).join(',');

  const bodyLines: string[] = [];
  for (const r of rows) {
    let rsvp: Record<string, string | string[]> = {};
    if (r.rsvp_answers_json) {
      try { rsvp = JSON.parse(r.rsvp_answers_json) as Record<string, string | string[]>; }
      catch { /* malformed — leave empty */ }
    }
    const slotLabel = r.slot_label || (r.slot_start ? `Slot @ ${r.slot_start}` : '');
    const cells: string[] = [
      r.name,
      r.phone,
      r.email ?? '',
      String(r.pax || 1),
      r.payment_amount != null ? String(r.payment_amount) : '',
      r.payment_status ?? '',
      formatIso(r.synced_at),
      r.zone_name ?? '',
      slotLabel,
    ];
    for (const field of rsvpFields) {
      const val = rsvp[field.id];
      if (Array.isArray(val)) cells.push(val.join('; '));
      else if (val == null) cells.push('');
      else cells.push(String(val));
    }
    bodyLines.push(cells.map(csvEscape).join(','));
  }

  // BOM so Excel recognises the file as UTF-8 — without it, special chars
  // (₹, ñ, names with accents) render as mojibake in Windows Excel.
  const body = '﻿' + headerLine + '\n' + bodyLines.join('\n') + '\n';

  const safeName = (ev.name || 'event').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 50);
  const filename = `bookings_${safeName}_${ev.event_date}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
