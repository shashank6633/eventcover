'use client';

import { useEffect, useState } from 'react';
import type { VenueTable, TableStatus } from '@/lib/tables';

const STATUS_LABELS: Record<TableStatus, string> = {
  open: 'Open',
  booked: 'Booked',
  occupied: 'Occupied',
  closed: 'Closed',
};

const STATUS_TONE: Record<TableStatus, string> = {
  open: 'border-slate-200 bg-slate-50 text-slate-700',
  booked: 'border-amber-200 bg-amber-50 text-amber-700',
  occupied: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  closed: 'border-rose-200 bg-rose-50 text-rose-700',
};

export default function TableManagementPage() {
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [zone, setZone] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/tables', { cache: 'no-store' });
    const data = await res.json();
    setTables(data.tables || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!label.trim()) { setError('Label is required.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), capacity: Number(capacity), zone: zone.trim() || undefined }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.message);
      else {
        setLabel(''); setCapacity('4'); setZone('');
        await load();
      }
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(id: string, status: TableStatus) {
    await fetch(`/api/tables/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function clearWallet(id: string) {
    await fetch(`/api/tables/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'open', active_wallet_txn: null }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this table?')) return;
    await fetch(`/api/tables/${id}`, { method: 'DELETE' });
    load();
  }

  const counts = {
    total: tables.length,
    open: tables.filter((t) => t.status === 'open').length,
    booked: tables.filter((t) => t.status === 'booked').length,
    occupied: tables.filter((t) => t.status === 'occupied').length,
    closed: tables.filter((t) => t.status === 'closed').length,
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Floor plan</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Table management</h1>
      <p className="text-sm text-slate-400 mt-1">
        Set up your tables, track status in real time, and link wallets to specific tables at entry.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-6">
        <Stat label="Total" value={counts.total} />
        <Stat label="Open" value={counts.open} tone="slate" />
        <Stat label="Booked" value={counts.booked} tone="amber" />
        <Stat label="Occupied" value={counts.occupied} tone="emerald" />
        <Stat label="Closed" value={counts.closed} tone="rose" />
      </div>

      <div className="card mt-6">
        <div className="font-semibold text-slate-900">Add table</div>
        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <form onSubmit={create} className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">Label</label>
            <input className="input w-full" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="T1, VIP-3…" />
          </div>
          <div>
            <label className="label">Capacity</label>
            <input className="input w-full" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
          <div>
            <label className="label">Zone (optional)</label>
            <input className="input w-full" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Upper deck, Patio…" />
          </div>
          <div className="flex items-end">
            <button className="btn btn-primary w-full" disabled={creating}>
              {creating ? 'Adding…' : 'Add table'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="card text-slate-400 text-sm">Loading…</div>
        ) : tables.length === 0 ? (
          <div className="card text-slate-400 text-sm">
            No tables yet. Add your first table above.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tables.map((t) => (
              <div key={t.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-bold text-slate-900">{t.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Capacity {t.capacity}
                      {t.zone ? ` · ${t.zone}` : ''}
                    </div>
                  </div>
                  <span className={`tag ${STATUS_TONE[t.status]} border`}>
                    {STATUS_LABELS[t.status]}
                  </span>
                </div>

                {t.active_wallet_txn && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-700">Active wallet</div>
                    <div className="font-mono text-xs text-emerald-700 mt-0.5">{t.active_wallet_txn}</div>
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['open', 'booked', 'occupied', 'closed'] as TableStatus[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(t.id, s)}
                      disabled={t.status === s}
                      className={`text-xs py-1.5 rounded border transition ${
                        t.status === s
                          ? 'bg-brand-500 text-white border-brand-500 cursor-default'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {t.active_wallet_txn && (
                    <button className="text-xs text-slate-400 hover:text-slate-900" onClick={() => clearWallet(t.id)}>
                      Clear wallet
                    </button>
                  )}
                  <button className="text-xs text-rose-600 hover:text-rose-700 ml-auto" onClick={() => remove(t.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'slate' | 'amber' | 'emerald' | 'rose' }) {
  const cls =
    tone === 'slate' ? 'text-slate-700' :
    tone === 'amber' ? 'text-amber-700' :
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'rose' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
