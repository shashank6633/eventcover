export type PaymentMethod = 'cash' | 'upi' | 'card' | 'online' | 'comp';
export type WalletStatus = 'active' | 'exhausted' | 'expired' | 'revoked' | 'flagged';
export const ALL_WALLET_STATUSES: WalletStatus[] = ['active', 'exhausted', 'expired', 'revoked', 'flagged'];

export interface Guest {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  source: string;
  created_at: number;
}

export interface Wallet {
  txn_id: string;
  guest_id: string;
  entry_fee: number;
  cover_issued: number;
  balance: number;
  payment_method: PaymentMethod;
  pin_hash: string;
  pin_fail_count: number;
  pin_locked_until: number | null;
  status: WalletStatus;
  issued_by: string;
  issued_at: number;
  checked_out_at: number | null;
  expires_at: number | null;
}

export interface WalletWithGuest extends Wallet {
  name: string;
  phone: string;
  email: string | null;
}

export interface Redemption {
  id: string;
  txn_id: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  captain: string;
  order_ref: string | null;
  notes: string | null;
  status: string;
  created_at: number;
}

export interface RedemptionWithGuest extends Redemption {
  guest_name: string;
}

export interface DashboardKpis {
  totalEntryFees: number;
  totalCoverIssued: number;
  totalRedeemed: number;
  unredeemed: number;
  redemptionRate: number;
  walletsIssued: number;
  walletsActive: number;
  walletsExhausted: number;
  walletsExpired: number;
  redemptionCount: number;
  paymentMix: Record<PaymentMethod, { amount: number; count: number }>;
}
