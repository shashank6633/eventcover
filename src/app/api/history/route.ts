import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Audit log read endpoint.
 *
 * Open to host / manager / cashier — cashiers need visibility for end-of-shift
 * reconciliation and dispute investigation. Captains and entry staff cannot
 * see the audit log.
 *
 * Filters:
 *   from, to       — UTC ms range (defaults to last 7 days)
 *   actor          — exact match (used by the actor dropdown)
 *   q              — text search across action / actor / entity_id
 *   actions        — comma-separated allow-list (used by the "money-only" toggle)
 *   limit          — capped at 2000
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'cashier']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(2000, Math.max(50, Number(sp.get('limit')) || 500));
  const from = Number(sp.get('from')) || (Date.now() - 7 * 24 * 3600 * 1000);
  const to = Number(sp.get('to')) || Date.now() + 1000;
  const actor = sp.get('actor') || undefined;
  const q = sp.get('q') || undefined;
  const actions = sp.get('actions')?.split(',').map((s) => s.trim()).filter(Boolean) || undefined;

  const where: string[] = ['timestamp >= ?', 'timestamp <= ?'];
  const params: (string | number)[] = [from, to];
  if (actor && actor !== 'all') { where.push('actor = ?'); params.push(actor); }
  if (q && q.trim()) {
    const s = `%${q.trim()}%`;
    where.push('(action LIKE ? OR actor LIKE ? OR entity_id LIKE ?)');
    params.push(s, s, s);
  }
  if (actions && actions.length > 0) {
    where.push(`action IN (${actions.map(() => '?').join(',')})`);
    params.push(...actions);
  }

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, timestamp, actor, action, entity_type, entity_id, details
    FROM audit_log
    WHERE ${where.join(' AND ')}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params, limit) as {
    id: number; timestamp: number; actor: string; action: string;
    entity_type: string | null; entity_id: string | null; details: string | null;
  }[];

  // Distinct actor list for the dropdown
  const actors = db.prepare(`
    SELECT DISTINCT actor FROM audit_log
    WHERE timestamp >= ? AND timestamp <= ? AND actor IS NOT NULL AND actor != ''
    ORDER BY actor ASC
  `).all(from, to) as { actor: string }[];

  return NextResponse.json({
    ok: true,
    range: { from, to },
    actors: actors.map((a) => a.actor),
    events: rows.map((r) => ({
      ...r,
      details: parseJson(r.details),
    })),
  });
}

function parseJson(s: string | null) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}
