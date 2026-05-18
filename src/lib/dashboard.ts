import { getDb } from './db';
import { sweepExpired } from './wallet';
import type { DashboardKpis, PaymentMethod } from './types';

export function computeDashboard(): DashboardKpis {
  sweepExpired();
  const db = getDb();

  const walletAgg = db.prepare(`
    SELECT
      COALESCE(SUM(entry_fee), 0) AS entry_total,
      COALESCE(SUM(cover_issued), 0) AS cover_total,
      COUNT(*) AS issued_count,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN status = 'exhausted' THEN 1 ELSE 0 END) AS exhausted_count,
      SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_count
    FROM wallets
  `).get() as {
    entry_total: number; cover_total: number; issued_count: number;
    active_count: number; exhausted_count: number; expired_count: number;
  };

  const redeemAgg = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS redeemed_total,
      COUNT(*) AS redemption_count
    FROM redemptions
    WHERE status = 'success'
  `).get() as { redeemed_total: number; redemption_count: number };

  const payRows = db.prepare(`
    SELECT payment_method, SUM(entry_fee) AS amount, COUNT(*) AS count
    FROM wallets
    GROUP BY payment_method
  `).all() as { payment_method: PaymentMethod; amount: number; count: number }[];

  const paymentMix: Record<PaymentMethod, { amount: number; count: number }> = {
    cash: { amount: 0, count: 0 },
    upi: { amount: 0, count: 0 },
    card: { amount: 0, count: 0 },
    online: { amount: 0, count: 0 },
    comp: { amount: 0, count: 0 },
  };
  for (const r of payRows) {
    if (paymentMix[r.payment_method]) {
      paymentMix[r.payment_method] = { amount: r.amount || 0, count: r.count || 0 };
    }
  }

  const cover = walletAgg.cover_total || 0;
  const redeemed = redeemAgg.redeemed_total || 0;

  return {
    totalEntryFees: walletAgg.entry_total || 0,
    totalCoverIssued: cover,
    totalRedeemed: redeemed,
    unredeemed: +(cover - redeemed).toFixed(2),
    redemptionRate: cover > 0 ? Math.round((redeemed / cover) * 1000) / 10 : 0,
    walletsIssued: walletAgg.issued_count || 0,
    walletsActive: walletAgg.active_count || 0,
    walletsExhausted: walletAgg.exhausted_count || 0,
    walletsExpired: walletAgg.expired_count || 0,
    redemptionCount: redeemAgg.redemption_count || 0,
    paymentMix,
  };
}
