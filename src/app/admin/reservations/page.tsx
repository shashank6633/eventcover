'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Event } from '@/lib/events';
import type { ReservationRow, ReservationStatus } from '@/lib/reservations';
import { formatMoney } from '@/lib/format';

export default function ReservationsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ReservationsClient />
    </Suspense>
  );
}

function Loading() {
  return <div className="max-w-5xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;
}

interface Pricing { entryFee: number; coverIssued: number; ruleLabel: string | null; paxNote: string; }

function ReservationsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const initialEventId = params.get('eventId') || '';

  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState<string>(initialEventId);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [pricing, setPricing] = useState<Record<string, Pricing>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('reservego-mock');
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/events').then((r) => r.json()).then((d) => {
      if (d.ok) {
        setEvents(d.events || []);
        if (!eventId && d.events?.length) {
          const first = d.events[0].id;
          setEventId(first);
          router.replace(`/admin/reservations?eventId=${first}`);
        }
      }
    });
    fetch('/api/reservations/sync').then((r) => r.json()).then((d) => {
      if (d.ok) { setProviders(d.implemented || []); setProvider(d.active || 'reservego-mock'); }
    });
  }, []);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/reservations?eventId=${eventId}`, { cache: 'no-store' })
      .then((r) => r.json()).then((d) => { if (d.ok) setReservations(d.reservations || []); });
  }, [eventId, syncResult]);

  useEffect(() => {
    if (!eventId || reservations.length === 0) return;
    (async () => {
      const map: Record<string, Pricing> = {};
      await Promise.all(reservations.map(async (r) => {
        const res = await fetch(`/api/events/price?eventId=${eventId}&pax=${r.pax}`).then((x) => x.json());
        if (res.ok) map[r.id] = { entryFee: res.entryFee, coverIssued: res.coverIssued, ruleLabel: res.ruleLabel, paxNote: res.paxNote };
      }));
      setPricing(map);
    })();
  }, [eventId, reservations]);

  async function sync() {
    if (!eventId) return;
    setSyncing(true); setSyncResult(null);
    const res = await fetch('/api/reservations/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, provider }),
    }).then((r) => r.json());
    if (res.ok) {
      setSyncResult(`${res.inserted} new reservation${res.inserted === 1 ? '' : 's'} synced · ${res.existing} already in system · ${res.fetched} total fetched from ${res.provider}`);
    } else {
      setSyncResult(`Sync failed: ${res.message}`);
    }
    setSyncing(false);
  }

  async function markNoShow(id: string) {
    await fetch(`/api/reservations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'no_show' }),
    });
    setSyncResult(Date.now().toString());
  }

  const event = events.find((e) => e.id === eventId) || null;
  const byStatus = {
    pending: reservations.filter((r) => r.status === 'pending').length,
    converted: reservations.filter((r) => r.status === 'converted').length,
    no_show: reservations.filter((r) => r.status === 'no_show').length,
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Reservation sync</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Reservations</h1>
      <p className="text-sm text-slate-400 mt-1">
        Pull guest reservations from Reservego (or any reservation platform). Pre-calculated
        entry + cover based on the event's pax rules. One click to issue the wallet when the
        guest arrives.
      </p>

      <div className="card mt-6">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <label className="label">Event</label>
            <select
              className="input"
              value={eventId}
              onChange={(e) => { setEventId(e.target.value); router.replace(`/admin/reservations?eventId=${e.target.value}`); }}
            >
              {events.length === 0 && <option value="">No events yet — create one first</option>}
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.event_date} · {ev.name} ({ev.status})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Provider</label>
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={sync} disabled={syncing || !eventId}>
            {syncing ? 'Syncing…' : 'Sync reservations'}
          </button>
        </div>
        {!providers.includes('reservego') && (
          <div className="mt-3 text-xs text-amber-700">
            Only the mock provider is implemented right now. Once Reservego API docs arrive,
            the "reservego" option will pull real data.
          </div>
        )}
        {syncResult && (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 px-3 py-2 text-sm">
            {syncResult}
          </div>
        )}
      </div>

      {event && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Stat label="Total reservations" value={reservations.length} />
          <Stat label="Pending" value={byStatus.pending} tone="amber" />
          <Stat label="Converted" value={byStatus.converted} tone="emerald" />
          <Stat label="No-shows" value={byStatus.no_show} tone="slate" />
        </div>
      )}

      <div className="card mt-4">
        {!event ? (
          <div className="text-slate-400 text-sm">
            Select (or <Link className="text-sky-600 hover:text-sky-700" href="/admin/events">create</Link>) an event first.
          </div>
        ) : reservations.length === 0 ? (
          <div className="text-slate-400 text-sm">
            No reservations synced yet. Click "Sync reservations" to pull from {provider}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2">Arrival</th>
                  <th className="pb-2">Guest</th>
                  <th className="pb-2">Pax</th>
                  <th className="pb-2">Pricing</th>
                  <th className="pb-2 text-right">Entry</th>
                  <th className="pb-2 text-right">Cover</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => {
                  const p = pricing[r.id];
                  return (
                    <tr key={r.id} className="border-b border-slate-200 last:border-0">
                      <td className="py-2.5 text-slate-400">{r.arrival_time || '—'}</td>
                      <td className="py-2.5">
                        <div className="text-slate-900">{r.name}</div>
                        <div className="text-xs text-slate-500">{r.phone}{r.email ? ` · ${r.email}` : ''}</div>
                        {r.notes && <div className="text-xs text-slate-500 mt-0.5">{r.notes}</div>}
                      </td>
                      <td className="py-2.5 text-slate-700">{r.pax}</td>
                      <td className="py-2.5 text-xs text-slate-400">
                        {p ? p.paxNote : <span className="opacity-50">…</span>}
                      </td>
                      <td className="py-2.5 text-right text-slate-700">{p ? formatMoney(p.entryFee) : '—'}</td>
                      <td className="py-2.5 text-right text-emerald-700">{p ? formatMoney(p.coverIssued) : '—'}</td>
                      <td className="py-2.5">
                        <span className={`tag ${tagClass(r.status)}`}>{r.status.replace('_',' ')}</span>
                        {r.converted_wallet_txn && (
                          <div className="text-[10px] font-mono text-slate-500 mt-1">{r.converted_wallet_txn}</div>
                        )}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        {r.status === 'pending' && (
                          <>
                            <Link
                              className="text-xs text-emerald-600 hover:text-emerald-700 mr-3"
                              href={`/admin/issue?r=${r.id}&eventId=${eventId}`}
                            >
                              Issue →
                            </Link>
                            <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => markNoShow(r.id)}>
                              No-show
                            </button>
                          </>
                        )}
                        {r.status === 'converted' && r.converted_wallet_txn && (
                          <Link className="text-xs text-sky-600 hover:text-sky-700"
                                href={`/admin/redeem?t=${encodeURIComponent(r.converted_wallet_txn)}`}>
                            Redeem →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'emerald' | 'slate' }) {
  const cls = tone === 'amber' ? 'text-amber-700'
    : tone === 'emerald' ? 'text-emerald-700'
    : tone === 'slate' ? 'text-slate-700' : 'text-slate-900';
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`text-xl font-bold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}

function tagClass(s: ReservationStatus): string {
  if (s === 'pending')   return 'border-amber-200 text-amber-700 bg-amber-50';
  if (s === 'converted') return 'border-emerald-200 text-emerald-700 bg-emerald-50';
  if (s === 'no_show')   return 'border-slate-200 text-slate-400 bg-slate-50';
  return 'border-rose-200 text-rose-700 bg-rose-50';
}
