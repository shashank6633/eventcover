'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/format';

interface Status {
  total: number;
  byStatus: Record<string, number>;
  byPayment: Record<string, { count: number; amount: number }>;
  byBouncer: { name: string; count: number; amount: number }[];
}

export default function TicketsStatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/wallets', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { setLoading(false); return; }
        const wallets = d.wallets || [];
        const byStatus: Record<string, number> = {};
        const byPayment: Record<string, { count: number; amount: number }> = {};
        const bouncerMap: Record<string, { count: number; amount: number }> = {};
        for (const w of wallets) {
          byStatus[w.status] = (byStatus[w.status] || 0) + 1;
          if (!byPayment[w.payment_method]) byPayment[w.payment_method] = { count: 0, amount: 0 };
          byPayment[w.payment_method].count += 1;
          byPayment[w.payment_method].amount += w.entry_fee || 0;
          const b = w.issued_by || 'unknown';
          if (!bouncerMap[b]) bouncerMap[b] = { count: 0, amount: 0 };
          bouncerMap[b].count += 1;
          bouncerMap[b].amount += w.entry_fee || 0;
        }
        const byBouncer = Object.entries(bouncerMap)
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.count - a.count);
        setStatus({ total: wallets.length, byStatus, byPayment, byBouncer });
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 md:px-8 py-6 text-slate-500">Loading…</div>;
  }
  if (!status) return null;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 py-6">
      <div className="text-[11px] tracking-widest uppercase text-slate-500">Live status</div>
      <h2 className="text-xl font-semibold text-slate-900 mt-1">Offline Tickets Status</h2>
      <p className="text-sm text-slate-500 mt-1">
        Real-time view of every ticket sold at the door — broken down by status, payment method, and bouncer.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
        <Stat label="Total issued" value={status.total} />
        <Stat label="Active"   value={status.byStatus.active   || 0} tone="emerald" />
        <Stat label="Exhausted"value={status.byStatus.exhausted || 0} />
        <Stat label="Expired"  value={status.byStatus.expired  || 0} tone="amber" />
        <Stat label="Flagged"  value={status.byStatus.flagged  || 0} tone="rose" />
      </div>

      <div className="card mt-6">
        <div className="font-semibold text-slate-900">By payment method</div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(status.byPayment).map(([method, v]) => (
            <div key={method} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{method}</div>
              <div className="text-lg font-bold text-slate-900 mt-0.5">{formatMoney(v.amount)}</div>
              <div className="text-xs text-slate-500">{v.count} tickets</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-4">
        <div className="font-semibold text-slate-900">By bouncer</div>
        {status.byBouncer.length === 0 ? (
          <div className="text-sm text-slate-500 mt-3">No tickets issued yet today.</div>
        ) : (
          <table className="w-full text-sm mt-3">
            <thead>
              <tr className="text-left text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-200">
                <th className="pb-2">Bouncer</th>
                <th className="pb-2 text-right">Tickets</th>
                <th className="pb-2 text-right">Collected</th>
              </tr>
            </thead>
            <tbody>
              {status.byBouncer.map((b) => (
                <tr key={b.name} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 text-slate-900">{b.name}</td>
                  <td className="py-2.5 text-right text-slate-700">{b.count}</td>
                  <td className="py-2.5 text-right text-emerald-700 font-semibold">{formatMoney(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 text-xs text-slate-500">
        For the full ledger with filters and per-row actions, see{' '}
        <Link href="/admin/tickets" className="text-brand-600 hover:text-brand-700 font-medium">Offline Ticketing →</Link>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'amber' | 'rose' }) {
  const cls =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber'   ? 'text-amber-700' :
    tone === 'rose'    ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`text-xl font-bold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
