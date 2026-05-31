import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { verifyWalletViewToken, signWalletPassToken } from '@/lib/signed-url';
import { lookupWallet } from '@/lib/wallet';
import { getConfig, getDb } from '@/lib/db';
import { getEvent } from '@/lib/events';
import { getRazorpayConfig } from '@/lib/razorpay';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RedemptionRow {
  id: string;
  txn_id: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  captain: string;
  order_ref: string | null;
  status: string;
  created_at: number;
}

/**
 * GET /api/public/wallet/[token]
 *
 * PUBLIC, no auth — gated by HMAC-signed wallet-view token (purpose tag
 * 'wallet_view', distinct from the pass-image token).
 *
 * Returns the live snapshot of a wallet for the customer self-service page:
 * balance + cover_issued, redemption history, venue + event identity, and
 * a `topUpEnabled` flag the client uses to render the "Top up" button.
 *
 * Status semantics:
 *   - bad/expired token            → 404 (don't leak whether the txn exists)
 *   - wallet missing               → 404
 *   - exhausted / voided / expired → 200 with full payload + status flag so
 *                                    the UI can show redemption history
 *                                    (customer evidence of past spend)
 *   - active                       → 200 with full payload
 *
 * No caching — balance must reflect a redemption that landed seconds ago.
 *
 * Rate limited in-memory (per IP) — this surface is polled every 30s by
 * /w/[token] and a leaked view-token (90d TTL) is otherwise free to scrape.
 */

// ─── In-memory rate limit ──────────────────────────────────────────────────
// Local to this file — symbols intentionally don't collide with the sibling
// /topup limiter. Tuned higher than topup since the page polls every 30s:
// 60 req/IP/10min = 6/min headroom without enabling scraping.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 60;
const ipHits = new Map<string, number[]>();
let lastCleanupAt = 0;

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0]?.trim();
  if (first) return first;
  return req.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (now - lastCleanupAt > 60_000) {
    lastCleanupAt = now;
    for (const [key, hits] of ipHits) {
      const filtered = hits.filter((t) => now - t < RATE_WINDOW_MS);
      if (filtered.length === 0) ipHits.delete(key);
      else if (filtered.length !== hits.length) ipHits.set(key, filtered);
    }
  }
  const existing = ipHits.get(ip) || [];
  const fresh = existing.filter((t) => now - t < RATE_WINDOW_MS);
  if (fresh.length >= RATE_MAX) {
    ipHits.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  ipHits.set(ip, fresh);
  return true;
}

/** Stable short hash so abuse forensics has a uniqueness key without storing
 *  the raw IP. Salt prefix scopes the hash to this surface so the same IP at
 *  another endpoint would hash differently if ever combined. */
function hashIp(ip: string): string {
  return createHash('sha256').update(`vw:${ip}`).digest('hex').slice(0, 16);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  // Rate limit before any DB work — protects against a leaked view-token being
  // turned into a polling scraper.
  if (!checkRateLimit(getClientIp(req))) {
    return NextResponse.json(
      { ok: false, message: 'Too many requests. Please slow down.' },
      { status: 429, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const payload = verifyWalletViewToken(token);
  if (!payload) {
    return NextResponse.json(
      { ok: false, message: 'Invalid or expired link.' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const wallet = lookupWallet(payload.txnId);
  if (!wallet) {
    return NextResponse.json(
      { ok: false, message: 'Wallet not found.' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  // NOTE: We intentionally do NOT short-circuit on exhausted/voided wallets.
  // The customer needs to see their redemption history as evidence of how the
  // wallet was spent (per spec). The UI hides the Top Up button via the
  // `topUpEnabled` flag below and renders a status banner for non-active
  // wallets.

  // Resolve event identity for the header. Falls back to global config when
  // the wallet pre-dates the per-event refactor.
  let eventName: string | undefined;
  let eventDate: string | undefined;
  const walletEventId = (wallet as unknown as { event_id?: string | null }).event_id;
  if (walletEventId) {
    try {
      const ev = getEvent(walletEventId);
      if (ev) {
        eventName = ev.name;
        eventDate = ev.event_date;
      }
    } catch { /* ignore */ }
  }
  if (!eventName) eventName = getConfig('EVENT_NAME', '') || undefined;
  if (!eventDate) eventDate = getConfig('EVENT_DATE', '') || undefined;

  const venueName = getConfig('VENUE_NAME', 'Venue');
  const hostPhone = getConfig('HOST_PHONE', '') || null;

  // Redemption history for this wallet, newest first. Limit defensive at 50
  // — the door rarely splits a single guest's cover into that many tabs.
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, txn_id, amount, balance_before, balance_after,
           captain, order_ref, status, created_at
    FROM redemptions
    WHERE txn_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(payload.txnId) as RedemptionRow[];

  const redemptions = rows.map((r) => ({
    id: r.id,
    // `createdAt` matches the client-side WalletRedemption type in
    // src/app/w/[token]/page.tsx. `at` is kept for any other consumer that
    // may still be on the older shape.
    createdAt: r.created_at,
    at: r.created_at,
    captain: r.captain || null,
    amount: r.amount,
    balanceAfter: r.balance_after,
    orderRef: r.order_ref,
  }));

  const topUpEnabled = wallet.status === 'active' && getRazorpayConfig().isConfigured;

  // Mint a fresh signed pass URL for the "Show pass at the door" CTA. We
  // re-mint on every fetch rather than embedding a long-lived URL so the
  // pass token TTL is tied to recent customer interest, not to view-token
  // age. Skip for non-active wallets — the door-scan PNG endpoint refuses
  // them anyway.
  let passUrl: string | null = null;
  if (wallet.status === 'active') {
    try {
      const passToken = signWalletPassToken({ txnId: wallet.txn_id });
      passUrl = `/api/public/wallet-pass/${passToken}`;
    } catch { /* leave null — UI handles missing passUrl gracefully */ }
  }

  // Audit the view with a hashed IP so the operator can spot link-scraping
  // / abuse after the fact. Never block the response on a failed audit
  // write — the customer's balance is what matters.
  try {
    logAudit({
      actor: 'public',
      action: 'wallet_view_served',
      entityType: 'wallet',
      entityId: wallet.txn_id,
      details: {
        ip_hash: hashIp(getClientIp(req)),
        status: wallet.status,
      },
    });
  } catch { /* swallow */ }

  return NextResponse.json(
    {
      ok: true,
      wallet: {
        txnId: wallet.txn_id,
        guestName: wallet.name || 'Guest',
        venueName,
        eventName: eventName || null,
        eventDate: eventDate || null,
        balance: wallet.balance,
        coverIssued: wallet.cover_issued,
        expiresAt: wallet.expires_at,
        status: wallet.status,
        redemptions,
        passUrl,
      },
      topUpEnabled,
      hostPhone,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
