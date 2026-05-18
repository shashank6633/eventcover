'use client';

import { useEffect, useState } from 'react';
import { formatMoney, relativeTime } from '@/lib/format';

interface Guest {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  created_at: number;
  wallet_count: number;
  total_cover: number;
  total_redeemed: number;
}

interface Staff { name: string; count: number; total: number; }

export default function PeoplePage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [bouncers, setBouncers] = useState<Staff[]>([]);
  const [captains, setCaptains] = useState<Staff[]>([]);
  const [tab, setTab] = useState<'guests' | 'staff'>('guests');
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/people').then((r) => r.json()).then((d) => {
      if (d.ok) {
        setGuests(d.guests || []);
        setBouncers(d.bouncers || []);
        setCaptains(d.captains || []);
      }
    });
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? guests.filter(
        (g) => g.name.toLowerCase().includes(q) || g.phone.toLowerCase().includes(q)
      )
    : guests;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Directory</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">People</h1>

      <div className="mt-6 flex gap-2">
        <TabBtn active={tab === 'guests'} onClick={() => setTab('guests')}>
          Guests ({guests.length})
        </TabBtn>
        <TabBtn active={tab === 'staff'} onClick={() => setTab('staff')}>
          Staff ({bouncers.length + captains.length})
        </TabBtn>
      </div>

      {tab === 'guests' && (
        <>
          <div className="mt-4">
            <input
              className="input max-w-sm"
              placeholder="Search by name or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2">Joined</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Phone</th>
                  <th className="pb-2">Email</th>
                  <th className="pb-2 text-right">Pax</th>
                  <th className="pb-2 text-right">Wallets</th>
                  <th className="pb-2 text-right">Cover</th>
                  <th className="pb-2 text-right">Redeemed</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="py-4 text-slate-500">No guests{q ? ' match your search' : ' yet'}.</td></tr>
                )}
                {filtered.map((g) => (
                  <tr key={g.id} className="border-b border-slate-200 last:border-0">
                    <td className="py-2.5 text-slate-400">{relativeTime(g.created_at)}</td>
                    <td className="py-2.5 text-slate-900">{g.name}</td>
                    <td className="py-2.5 text-slate-700">{g.phone}</td>
                    <td className="py-2.5 text-slate-400">{g.email || '—'}</td>
                    <td className="py-2.5 text-right text-slate-700">{g.pax}</td>
                    <td className="py-2.5 text-right text-slate-700">{g.wallet_count}</td>
                    <td className="py-2.5 text-right text-slate-700">{formatMoney(g.total_cover)}</td>
                    <td className="py-2.5 text-right text-emerald-700">{formatMoney(g.total_redeemed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'staff' && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <div className="font-semibold text-slate-900">Bouncers / Entry</div>
            <div className="text-xs text-slate-500">Logged from each wallet's "issued by" field.</div>
            <div className="mt-3">
              {bouncers.length === 0 ? (
                <div className="text-slate-500 text-sm">No bouncer activity yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {bouncers.map((b) => (
                      <tr key={b.name} className="border-b border-slate-200 last:border-0">
                        <td className="py-2 text-slate-900">{b.name}</td>
                        <td className="py-2 text-right text-slate-700">{b.count} wallets</td>
                        <td className="py-2 text-right text-emerald-700">{formatMoney(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="font-semibold text-slate-900">Captains</div>
            <div className="text-xs text-slate-500">Logged from each redemption's captain field.</div>
            <div className="mt-3">
              {captains.length === 0 ? (
                <div className="text-slate-500 text-sm">No redemption activity yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {captains.map((c) => (
                      <tr key={c.name} className="border-b border-slate-200 last:border-0">
                        <td className="py-2 text-slate-900">{c.name}</td>
                        <td className="py-2 text-right text-slate-700">{c.count} redemptions</td>
                        <td className="py-2 text-right text-emerald-700">{formatMoney(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
        active ? 'bg-brand-500 text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
