'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney, relativeTime } from '@/lib/format';
import type { PayoutMethod, PendingCommissionSummary } from '@/lib/affiliates';

interface PayoutHistoryItem {
  id: string;
  affiliate_id: string;
  amount: number;
  method: PayoutMethod;
  reference: string | null;
  notes: string | null;
  paid_by: string | null;
  paid_at: number;
  affiliate_code: string;
  affiliate_name: string;
}

export default function PayoutsAdminPage() {
  const router = useRouter();
  const [meLoaded, setMeLoaded] = useState(false);

  const [pending, setPending] = useState<PendingCommissionSummary[]>([]);
  const [history, setHistory] = useState<PayoutHistoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [paying, setPaying] = useState<PendingCommissionSummary | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d?.ok) { router.replace('/login'); return; }
        if (d.user.role !== 'host' && d.user.role !== 'manager') {
          router.replace('/admin');
          return;
        }
        setMeLoaded(true);
      });
  }, [router]);

  useEffect(() => {
    if (!meLoaded) return;
    refresh();
  }, [meLoaded]);

  async function refresh() {
    const d = await fetch('/api/payouts', { cache: 'no-store' }).then((r) => r.json());
    if (d.ok) {
      setPending(d.pending || []);
      setHistory(d.history || []);
      setLoaded(true);
    }
  }

  if (!meLoaded || !loaded) {
    return <div className="max-w-5xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;
  }

  const totalPending = pending.reduce((s, p) => s + p.total_amount, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
      <div className="text-[11px] tracking-widest uppercase text-slate-500">Growth</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Affiliate Payouts</h1>
      <p className="text-sm text-slate-500 mt-1">
        Pending commissions are bundled into a single payout per affiliate when you mark them paid.
      </p>

      {flash && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
          {flash}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
        <div className="kpi">
          <div className="kpi-label">Pending payouts</div>
          <div className="kpi-value whitespace-nowrap">{formatMoney(totalPending)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Affiliates owed</div>
          <div className="kpi-value">{pending.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Payouts this month</div>
          <div className="kpi-value">{history.filter((h) => isThisMonth(h.paid_at)).length}</div>
        </div>
      </div>

      {/* Pending */}
      <div className="card mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-slate-900">Pending</div>
          <div className="text-xs text-slate-500">{pending.length} affiliate(s)</div>
        </div>
        {pending.length === 0 ? (
          <div className="text-sm text-slate-500 py-4 text-center">
            No pending commissions. All affiliates paid up. 🎉
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-left text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2 whitespace-nowrap">Affiliate</th>
                  <th className="pb-2 whitespace-nowrap">Code</th>
                  <th className="pb-2 text-right whitespace-nowrap">Commissions</th>
                  <th className="pb-2 text-right whitespace-nowrap">Amount</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.affiliate_id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 text-slate-900">{row.affiliate_name}</td>
                    <td className="py-2.5 text-slate-500 font-mono text-xs">{row.affiliate_code}</td>
                    <td className="py-2.5 text-right text-slate-700">{row.commission_count}</td>
                    <td className="py-2.5 text-right text-emerald-700 font-semibold whitespace-nowrap">
                      {formatMoney(row.total_amount)}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        className="btn btn-primary !py-1 !px-3 text-xs"
                        onClick={() => setPaying(row)}
                      >
                        Mark paid
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History */}
      <div className="card mt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-slate-900">Payout history</div>
          <div className="text-xs text-slate-500">{history.length} total</div>
        </div>
        {history.length === 0 ? (
          <div className="text-sm text-slate-500 py-4 text-center">No payouts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-left text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2 whitespace-nowrap">When</th>
                  <th className="pb-2 whitespace-nowrap">Affiliate</th>
                  <th className="pb-2 whitespace-nowrap">Method</th>
                  <th className="pb-2 whitespace-nowrap">Reference</th>
                  <th className="pb-2 text-right whitespace-nowrap">Amount</th>
                  <th className="pb-2 whitespace-nowrap">Paid by</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 text-slate-500 whitespace-nowrap">{relativeTime(h.paid_at)}</td>
                    <td className="py-2.5 text-slate-900">
                      {h.affiliate_name}
                      <div className="text-xs text-slate-500 font-mono">{h.affiliate_code}</div>
                    </td>
                    <td className="py-2.5 text-slate-700 uppercase text-xs">{h.method}</td>
                    <td className="py-2.5 text-slate-500 text-xs">{h.reference || '—'}</td>
                    <td className="py-2.5 text-right font-semibold text-slate-900 whitespace-nowrap">
                      {formatMoney(h.amount)}
                    </td>
                    <td className="py-2.5 text-slate-500 text-xs whitespace-nowrap">{h.paid_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {paying && (
        <PayoutModal
          row={paying}
          onClose={() => setPaying(null)}
          onPaid={(amount) => {
            setPaying(null);
            setFlash(`✓ Paid ${formatMoney(amount)} to ${paying.affiliate_name}.`);
            setTimeout(() => setFlash(null), 4000);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function isThisMonth(ts: number): boolean {
  const d = new Date(ts);
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function PayoutModal({
  row,
  onClose,
  onPaid,
}: {
  row: PendingCommissionSummary;
  onClose: () => void;
  onPaid: (amount: number) => void;
}) {
  const [method, setMethod] = useState<PayoutMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliateId: row.affiliate_id,
          method,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.message); return; }
      onPaid(d.payout.amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900">Mark payout as paid</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 mb-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Paying</div>
          <div className="mt-1 text-slate-900 font-semibold">{row.affiliate_name}</div>
          <div className="text-xs text-slate-500 font-mono">{row.affiliate_code}</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">{row.commission_count} commission(s)</span>
            <span className="text-lg font-bold text-emerald-700">{formatMoney(row.total_amount)}</span>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">{error}</div>
          )}
          <div>
            <label className="label">Method</label>
            <div className="flex gap-4 pt-1">
              {(['cash', 'upi', 'bank'] as PayoutMethod[]).map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="method"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                    className="accent-brand-500"
                  />
                  <span className="text-slate-700 uppercase text-xs">{m}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Reference (UPI txn id, receipt #, etc.)</label>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
              {busy ? 'Recording…' : `Pay ${formatMoney(row.total_amount)}`}
            </button>
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
