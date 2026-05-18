import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sweepExpired } from '@/lib/wallet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  sweepExpired();
  const db = getDb();

  const guests = db.prepare(`
    SELECT g.id, g.name, g.phone, g.email, g.pax, g.created_at,
      COUNT(w.txn_id) AS wallet_count,
      COALESCE(SUM(w.cover_issued), 0) AS total_cover,
      COALESCE((
        SELECT SUM(r.amount) FROM redemptions r
        JOIN wallets w2 ON w2.txn_id = r.txn_id
        WHERE w2.guest_id = g.id AND r.status = 'success'
      ), 0) AS total_redeemed
    FROM guests g
    LEFT JOIN wallets w ON w.guest_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC
    LIMIT 200
  `).all();

  const bouncers = db.prepare(`
    SELECT issued_by AS name, COUNT(*) AS count, SUM(entry_fee) AS total
    FROM wallets
    WHERE issued_by IS NOT NULL AND issued_by != ''
    GROUP BY issued_by
    ORDER BY count DESC
  `).all();

  const captains = db.prepare(`
    SELECT captain AS name, COUNT(*) AS count, SUM(amount) AS total
    FROM redemptions
    WHERE status = 'success' AND captain IS NOT NULL AND captain != ''
    GROUP BY captain
    ORDER BY count DESC
  `).all();

  return NextResponse.json({ ok: true, guests, bouncers, captains });
}
