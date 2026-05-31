'use client';

/**
 * Customer-facing wallet view — /w/[token].
 *
 * Public page (no AdminShell, no auth). Access is gated by the HMAC-signed
 * view token in the path; the GET API verifies it server-side and returns
 * 404 on bad/expired tokens, 410 on exhausted/voided wallets. This component
 * renders whatever the API returns, so a stranger with a guessed URL just
 * sees the friendly "couldn't find your wallet" empty state.
 *
 * Flow:
 *   1. Mount → GET /api/public/wallet/[token] → seed state
 *   2. "Show pass at the door" → opens passUrl in a new tab (passUrl is
 *      minted by the API and embedded in the GET response)
 *   3. "Top up cover" → opens amount picker → POST /topup → openRazorpayCheckout
 *      → on success POST /topup/verify → refetch wallet → show new balance
 *   4. Status banner if wallet is no longer 'active'
 *
 * Brand colour: #C1551A. Mobile-first, max-w-md.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  openRazorpayCheckout,
  type RazorpaySuccessResponse,
  type RazorpayFailureError,
} from '@/components/RazorpayCheckout';

const BRAND = '#C1551A';

// ─── Wire types ────────────────────────────────────────────────────────────
// Mirrors the architect's GET response. Optional fields tolerate the API
// adding details later without breaking this component.

interface WalletRedemption {
  id: string;
  amount: number;
  /** Epoch ms when the redemption landed. Server sends `at`. */
  at: number;
  captain?: string | null;
  orderRef?: string | null;
  /** Wallet balance after this redemption (server-side, authoritative). */
  balanceAfter?: number;
}

interface WalletPayload {
  txnId: string;
  guestName: string;
  venueName: string;
  eventName?: string | null;
  eventDate?: string | null;
  balance: number;
  coverIssued: number;
  expiresAt?: number | null;
  status: 'active' | 'exhausted' | 'expired' | 'voided' | string;
  redemptions: WalletRedemption[];
  /** Pre-minted signed URL for the wallet pass PNG. May be null if the
   *  server couldn't mint one (e.g. exhausted wallet). */
  passUrl?: string | null;
}

interface WalletResponse {
  ok: boolean;
  wallet?: WalletPayload;
  topUpEnabled?: boolean;
  hostPhone?: string | null;
  /** Server uses `message` for actionable copy (rate-limit, error states). */
  message?: string;
  error?: string;
}

interface TopUpOrderResponse {
  ok: boolean;
  orderId?: string;
  amount?: number; // paise
  currency?: string;
  keyId?: string;
  name?: string;
  message?: string;
  error?: string;
}

interface TopUpVerifyResponse {
  ok: boolean;
  balance?: number;
  coverIssued?: number;
  topUpAmount?: number;
  alreadyCaptured?: boolean;
  message?: string;
  error?: string;
}

// ─── Fetch state machine ───────────────────────────────────────────────────

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: WalletResponse }
  // 404 = bad token / wallet missing. 410 = exhausted / voided.
  // We render distinct empty states for each.
  | { kind: 'not-found' }
  | { kind: 'gone'; message: string }
  | { kind: 'error'; message: string };

type TopUpState =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'creating' }
  | { kind: 'awaiting' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string };

const TOPUP_PRESETS = [500, 1000, 2000];
const TOPUP_MIN = 100;
const TOPUP_MAX = 50000;

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return '₹0';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function formatTime(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function formatDate(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/** Returns a humanised "in 4h 22m" style string, or "expired" if past. */
function formatExpiresIn(expiresAt: number | null | undefined, now: number): {
  text: string;
  /** ms remaining — used to pick chip colour. */
  msRemaining: number;
} {
  if (!expiresAt) return { text: '', msRemaining: Number.POSITIVE_INFINITY };
  const delta = expiresAt - now;
  if (delta <= 0) return { text: 'Expired', msRemaining: 0 };

  const totalMin = Math.floor(delta / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 60 * 24) / 60);
  const mins = totalMin - days * 60 * 24 - hours * 60;

  if (days > 0) return { text: `Expires in ${days}d ${hours}h`, msRemaining: delta };
  if (hours > 0) return { text: `Expires in ${hours}h ${mins}m`, msRemaining: delta };
  return { text: `Expires in ${mins}m`, msRemaining: delta };
}

// ─── Page (client component) ───────────────────────────────────────────────

export default function WalletViewPage({
  params,
}: {
  // Next.js 15 — params is a Promise. We resolve it once on mount.
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'loading' });
  const [now, setNow] = useState<number>(() => Date.now());

  // Top-up modal state.
  const [topUp, setTopUp] = useState<TopUpState>({ kind: 'idle' });
  const [customAmount, setCustomAmount] = useState<string>('');

  // Resolve params (Next 15 async).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await params;
      if (!cancelled) setToken(p.token);
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  const loadWallet = useCallback(async (tok: string) => {
    try {
      const res = await fetch(`/api/public/wallet/${encodeURIComponent(tok)}`, {
        cache: 'no-store',
      });
      if (res.status === 404) {
        setFetchState({ kind: 'not-found' });
        return;
      }
      // NOTE: The API no longer returns 410 for exhausted/voided wallets —
      // it returns 200 with status flagged so this page can render the
      // redemption history (customer evidence of past spend). The
      // `WalletContent` component handles non-active statuses via
      // `statusBanner`. The 'gone' FetchState is retained only for legacy
      // safety; nothing produces it today.
      if (!res.ok) {
        setFetchState({
          kind: 'error',
          message: 'Could not load your wallet. Please try again.',
        });
        return;
      }
      const json = (await res.json()) as WalletResponse;
      if (!json.ok || !json.wallet) {
        setFetchState({
          kind: 'error',
          // Server uses `message` for actionable copy (rate-limit, exhausted,
          // invalid amount). Reading only `error` silently drops it.
          message: json.message || json.error || 'Could not load your wallet.',
        });
        return;
      }
      setFetchState({ kind: 'ready', data: json });
    } catch {
      setFetchState({
        kind: 'error',
        message: 'Network error. Check your connection and try again.',
      });
    }
  }, []);

  // Initial + token-change fetch.
  useEffect(() => {
    if (!token) return;
    setFetchState({ kind: 'loading' });
    void loadWallet(token);
  }, [token, loadWallet]);

  // Ticking clock — refreshes the expires-in chip every 30s and re-polls the
  // API every 30s so a redemption from the door scanner shows up here too.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!token || fetchState.kind !== 'ready') return;
    const poll = setInterval(() => {
      void loadWallet(token);
    }, 30_000);
    return () => clearInterval(poll);
  }, [token, fetchState.kind, loadWallet]);

  // ─── Top-up flow ─────────────────────────────────────────────────────────

  const startTopUp = async (amount: number) => {
    if (!token || fetchState.kind !== 'ready' || !fetchState.data.wallet) return;
    if (!Number.isFinite(amount) || amount < TOPUP_MIN || amount > TOPUP_MAX) {
      setTopUp({
        kind: 'error',
        message: `Enter an amount between ₹${TOPUP_MIN} and ₹${TOPUP_MAX.toLocaleString('en-IN')}.`,
      });
      return;
    }

    setTopUp({ kind: 'creating' });
    try {
      const res = await fetch(
        `/api/public/wallet/${encodeURIComponent(token)}/topup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as TopUpOrderResponse;
      if (!res.ok || !json.ok || !json.orderId || !json.keyId) {
        setTopUp({
          kind: 'error',
          message: json.message || json.error || 'Could not start top-up. Please try again.',
        });
        return;
      }

      const wallet = fetchState.data.wallet;
      setTopUp({ kind: 'awaiting' });

      try {
        await openRazorpayCheckout({
          keyId: json.keyId,
          orderId: json.orderId,
          amount: json.amount ?? Math.round(amount * 100),
          currency: json.currency || 'INR',
          name: json.name || wallet.venueName || 'Cover top-up',
          description: `Top up cover for ${wallet.guestName}`,
          customerName: wallet.guestName || 'Guest',
          // We don't have phone/email in the wallet view payload — Razorpay
          // allows empty prefills, the modal will just prompt for them.
          customerPhone: '',
          notes: { txnId: wallet.txnId, kind: 'wallet_topup' },
          theme: { color: BRAND },
          onSuccess: (resp) => {
            void verifyTopUp(resp);
          },
          onFailure: (err: RazorpayFailureError) => {
            setTopUp({
              kind: 'error',
              message:
                err.description ||
                'Top-up failed. No money was deducted — please try again.',
            });
          },
          onDismiss: () => {
            setTopUp({ kind: 'idle' });
          },
        });
      } catch {
        setTopUp({
          kind: 'error',
          message:
            'Could not open the payment window. Check your connection and try again.',
        });
      }
    } catch {
      setTopUp({
        kind: 'error',
        message: 'Network error starting top-up. Please try again.',
      });
    }
  };

  const verifyTopUp = async (resp: RazorpaySuccessResponse) => {
    if (!token) return;
    setTopUp({ kind: 'verifying' });
    try {
      const res = await fetch(
        `/api/public/wallet/${encodeURIComponent(token)}/topup/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpayOrderId: resp.razorpay_order_id,
            razorpayPaymentId: resp.razorpay_payment_id,
            razorpaySignature: resp.razorpay_signature,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as TopUpVerifyResponse;
      if (!res.ok || !json.ok) {
        setTopUp({
          kind: 'error',
          message:
            json.message ||
            json.error ||
            'Could not verify your top-up. If money was deducted, contact the venue with your payment ID.',
        });
        return;
      }
      setTopUp({ kind: 'idle' });
      setCustomAmount('');
      // Refetch — server is source of truth for the new balance.
      void loadWallet(token);
    } catch {
      setTopUp({
        kind: 'error',
        message:
          'Network error verifying top-up. If money was deducted, contact the venue with your payment ID.',
      });
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-md px-4 py-6 space-y-5">
        {fetchState.kind === 'loading' && <LoadingSkeleton />}

        {fetchState.kind === 'not-found' && (
          <EmptyState
            title="We couldn't find your wallet."
            body="The link may be incorrect or copied incompletely. Double-check the link in your WhatsApp message, or contact the venue."
          />
        )}

        {fetchState.kind === 'gone' && (
          <EmptyState
            title="This pass is no longer valid."
            body={fetchState.message}
          />
        )}

        {fetchState.kind === 'error' && (
          <ErrorBanner
            message={fetchState.message}
            onRetry={token ? () => void loadWallet(token) : undefined}
          />
        )}

        {fetchState.kind === 'ready' && fetchState.data.wallet && (
          <WalletContent
            wallet={fetchState.data.wallet}
            topUpEnabled={fetchState.data.topUpEnabled === true}
            hostPhone={fetchState.data.hostPhone || null}
            now={now}
            topUp={topUp}
            customAmount={customAmount}
            setCustomAmount={setCustomAmount}
            onOpenTopUp={() => setTopUp({ kind: 'picking' })}
            onCancelTopUp={() => setTopUp({ kind: 'idle' })}
            onStartTopUp={startTopUp}
          />
        )}
      </div>
    </main>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-full bg-slate-200 animate-pulse" />
        <div className="h-3 w-32 rounded bg-slate-200 animate-pulse" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="h-3 w-24 rounded bg-slate-200 animate-pulse" />
        <div className="h-10 w-40 rounded bg-slate-200 animate-pulse" />
        <div className="h-2 w-full rounded bg-slate-100 animate-pulse" />
        <div className="h-3 w-32 rounded bg-slate-200 animate-pulse" />
      </div>
      <div className="h-12 rounded-xl bg-slate-200 animate-pulse" />
      <div className="h-12 rounded-xl bg-slate-200 animate-pulse" />
    </>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center space-y-2">
      <div
        className="mx-auto h-10 w-10 rounded-full"
        style={{ backgroundColor: BRAND, opacity: 0.15 }}
      />
      <h1 className="text-base font-semibold text-slate-800">{title}</h1>
      <p className="text-sm text-slate-500">{body}</p>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 space-y-2">
      <div>{message}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}

interface WalletContentProps {
  wallet: WalletPayload;
  topUpEnabled: boolean;
  hostPhone: string | null;
  now: number;
  topUp: TopUpState;
  customAmount: string;
  setCustomAmount: (v: string) => void;
  onOpenTopUp: () => void;
  onCancelTopUp: () => void;
  onStartTopUp: (amount: number) => void;
}

function WalletContent(props: WalletContentProps) {
  const {
    wallet,
    topUpEnabled,
    hostPhone,
    now,
    topUp,
    customAmount,
    setCustomAmount,
    onOpenTopUp,
    onCancelTopUp,
    onStartTopUp,
  } = props;

  const pct =
    wallet.coverIssued > 0
      ? Math.max(0, Math.min(100, (wallet.balance / wallet.coverIssued) * 100))
      : 0;

  const expiresInfo = formatExpiresIn(wallet.expiresAt, now);

  // Chip colour ramp matches spec: <1h rose, <6h amber, else slate.
  const chipClass = (() => {
    if (!expiresInfo.text) return 'bg-slate-100 text-slate-600';
    if (expiresInfo.msRemaining <= 0) return 'bg-rose-100 text-rose-700';
    if (expiresInfo.msRemaining < 60 * 60 * 1000) return 'bg-rose-100 text-rose-700';
    if (expiresInfo.msRemaining < 6 * 60 * 60 * 1000)
      return 'bg-amber-100 text-amber-800';
    return 'bg-slate-100 text-slate-600';
  })();

  const isInactive = wallet.status !== 'active';
  const statusBanner = (() => {
    if (wallet.status === 'exhausted')
      return 'This wallet has been used up.';
    if (wallet.status === 'expired')
      return wallet.expiresAt
        ? `Expired on ${formatDate(wallet.expiresAt)}.`
        : 'This wallet has expired.';
    if (wallet.status === 'voided') return 'This wallet was refunded.';
    return null;
  })();

  const showTopUpButton = topUpEnabled && wallet.status === 'active';
  const topUpBusy =
    topUp.kind === 'creating' ||
    topUp.kind === 'awaiting' ||
    topUp.kind === 'verifying';

  return (
    <>
      {/* Brand header */}
      <div className="flex items-center gap-2">
        <div
          className="h-6 w-6 rounded-full"
          style={{ backgroundColor: BRAND }}
          aria-hidden="true"
        />
        <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">
          {wallet.venueName || 'Venue'}
        </div>
      </div>

      {/* Status banner (non-active wallets) */}
      {statusBanner && (
        <div
          className={
            wallet.status === 'voided'
              ? 'rounded-xl border border-slate-200 bg-slate-100 p-3 text-sm text-slate-700'
              : 'rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800'
          }
        >
          {statusBanner}
        </div>
      )}

      {/* Balance card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">
          Cover balance
        </div>
        <div className="text-4xl font-bold tabular-nums text-slate-900">
          {formatINR(wallet.balance)}
        </div>
        <div className="text-xs text-slate-500">
          of {formatINR(wallet.coverIssued)} loaded
        </div>
        {/* Progress bar */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: BRAND }}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Event + expires-in row */}
      {(wallet.eventName || expiresInfo.text) && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-700 truncate">
            {wallet.eventName || ''}
          </div>
          {expiresInfo.text && (
            <span
              className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${chipClass}`}
            >
              {expiresInfo.text}
            </span>
          )}
        </div>
      )}

      {/* Primary actions */}
      <div className="space-y-2">
        {wallet.passUrl && !isInactive ? (
          <a
            href={wallet.passUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
            style={{ backgroundColor: BRAND }}
          >
            Show pass at the door
          </a>
        ) : !isInactive ? (
          <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">
            Pass unavailable
          </div>
        ) : null}

        {showTopUpButton && (
          <button
            type="button"
            onClick={onOpenTopUp}
            disabled={topUpBusy}
            className="w-full rounded-xl border border-brand-500 bg-white px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              borderColor: BRAND,
              color: BRAND,
            }}
          >
            {topUp.kind === 'creating' && 'Starting top-up…'}
            {topUp.kind === 'awaiting' && 'Complete payment…'}
            {topUp.kind === 'verifying' && 'Verifying…'}
            {(topUp.kind === 'idle' ||
              topUp.kind === 'picking' ||
              topUp.kind === 'error') &&
              'Top up cover'}
          </button>
        )}

        {topUp.kind === 'error' && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
            {topUp.message}
          </div>
        )}
      </div>

      {/* Amount picker (inline expansion below the button) */}
      {topUp.kind === 'picking' && (
        <TopUpPicker
          customAmount={customAmount}
          setCustomAmount={setCustomAmount}
          onPick={onStartTopUp}
          onCancel={onCancelTopUp}
        />
      )}

      {/* Redemption history */}
      <RedemptionHistory redemptions={wallet.redemptions} />

      {/* Footer */}
      <div className="pt-2 text-center text-[11px] text-slate-400">
        Powered by Akan EventCover{hostPhone ? ` · ${hostPhone}` : ''} ·{' '}
        Lost this link? Contact venue.
      </div>
    </>
  );
}

function TopUpPicker({
  customAmount,
  setCustomAmount,
  onPick,
  onCancel,
}: {
  customAmount: string;
  setCustomAmount: (v: string) => void;
  onPick: (amount: number) => void;
  onCancel: () => void;
}) {
  const parsedCustom = Number.parseInt(customAmount, 10);
  const customValid =
    Number.isFinite(parsedCustom) &&
    parsedCustom >= TOPUP_MIN &&
    parsedCustom <= TOPUP_MAX;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-800">
          Choose a top-up amount
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {TOPUP_PRESETS.map((amt) => (
          <button
            key={amt}
            type="button"
            onClick={() => onPick(amt)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:border-slate-300 hover:bg-slate-50"
          >
            {formatINR(amt)}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="topup-custom"
          className="block text-xs font-medium text-slate-600"
        >
          Or enter a custom amount (₹{TOPUP_MIN}–₹
          {TOPUP_MAX.toLocaleString('en-IN')})
        </label>
        <div className="flex gap-2">
          <input
            id="topup-custom"
            type="number"
            inputMode="numeric"
            min={TOPUP_MIN}
            max={TOPUP_MAX}
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="1500"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          <button
            type="button"
            disabled={!customValid}
            onClick={() => customValid && onPick(parsedCustom)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: BRAND }}
          >
            Top up
          </button>
        </div>
      </div>
    </div>
  );
}

function RedemptionHistory({
  redemptions,
}: {
  redemptions: WalletRedemption[];
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">
        Recent activity
      </div>
      {redemptions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
          No redemptions yet.
        </div>
      ) : (
        <ul className="rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
          {redemptions.map((r) => (
            <li
              key={r.id}
              className="flex items-start justify-between gap-3 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-500 tabular-nums">
                  {formatTime(r.at)}
                </div>
                <div className="text-sm text-slate-700 truncate">
                  {r.captain ? `by ${r.captain}` : 'Redeemed'}
                  {r.orderRef ? ` · Table ${r.orderRef}` : ''}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-rose-600 tabular-nums">
                  -{formatINR(r.amount)}
                </div>
                {typeof r.balanceAfter === 'number' && (
                  <div className="text-[11px] text-slate-400 tabular-nums">
                    Balance {formatINR(r.balanceAfter)}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
