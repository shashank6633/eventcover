import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { bulkImportInvitees, type BulkImportRow } from '@/lib/invitees';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/events/[id]/invitees/import
 * Body: { rows: [{ phone, name?, plus_ones_allowed?, notes? }, ...] }
 *
 * Skip-on-conflict: rows whose normalized phone is already on the list are
 * counted in `skipped` rather than aborting. Capped at 5000 rows per call.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { rows?: unknown };
  if (!Array.isArray(body.rows)) {
    return NextResponse.json(
      { ok: false, message: 'rows must be an array of { phone, name?, plus_ones_allowed? }.' },
      { status: 400 },
    );
  }
  if (body.rows.length > 5000) {
    return NextResponse.json(
      { ok: false, message: 'Max 5000 rows per import.' },
      { status: 400 },
    );
  }

  const rows: BulkImportRow[] = (body.rows as unknown[]).map((r) => {
    const raw = (r ?? {}) as Record<string, unknown>;
    return {
      phone: String(raw.phone ?? ''),
      name: typeof raw.name === 'string' ? raw.name : null,
      plus_ones_allowed: raw.plus_ones_allowed == null ? 0 : Number(raw.plus_ones_allowed),
      notes: typeof raw.notes === 'string' ? raw.notes : null,
    };
  });

  try {
    const result = bulkImportInvitees(id, rows, session.name);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to import invitees.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
