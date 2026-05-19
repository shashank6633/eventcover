'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Event } from '@/lib/events';
import type { ReservationRow, ReservationStatus, WebhookHealth } from '@/lib/reservations';
import { formatMoney } from '@/lib/format';
import { PhoneInput } from '@/components/PhoneInput';

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
interface WebhookStatus { health: WebhookHealth; configured: boolean; lastAt: number; lastAction: string; reservationCountThisMonth: number }
interface ReservationWithEvent extends ReservationRow {
  event_name: string | null;
  event_status: string | null;
}

function ReservationsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const initialEventId = params.get('eventId') || '';

  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState<string>(initialEventId);
  const [reservations, setReservations] = useState<ReservationWithEvent[]>([]);
  const [pricing, setPricing] = useState<Record<string, Pricing>>({});
  const [webhook, setWebhook] = useState<WebhookStatus | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/events').then((r) => r.json()).then((d) => {
      if (d.ok) setEvents(d.events || []);
    });
    refreshWebhookStatus();
  }, []);

  function refreshWebhookStatus() {
    fetch('/api/reservations/webhook-status').then((r) => r.json()).then((d) => {
      if (d.ok) setWebhook({
        health: d.health, configured: d.configured, lastAt: d.lastAt,
        lastAction: d.lastAction, reservationCountThisMonth: d.reservationCountThisMonth,
      });
    }).catch(() => { /* non-blocking */ });
  }

  useEffect(() => {
    const url = eventId
      ? `/api/reservations?eventId=${eventId}`
      : `/api/reservations`;
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setReservations(d.reservations || []); });
    refreshWebhookStatus();
  }, [eventId, refreshKey]);

  useEffect(() => {
    if (reservations.length === 0) { setPricing({}); return; }
    (async () => {
      const map: Record<string, Pricing> = {};
      await Promise.all(reservations.map(async (r) => {
        if (!r.event_id) return;
        const res = await fetch(`/api/events/price?eventId=${r.event_id}&pax=${r.pax}`).then((x) => x.json());
        if (res.ok) map[r.id] = { entryFee: res.entryFee, coverIssued: res.coverIssued, ruleLabel: res.ruleLabel, paxNote: res.paxNote };
      }));
      setPricing(map);
    })();
  }, [reservations]);

  async function markNoShow(id: string) {
    await fetch(`/api/reservations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'no_show' }),
    });
    setRefreshKey((k) => k + 1);
  }

  // Client-side filter — name, phone, email, booking id, tables, tags, comments
  const filtered = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return reservations;
    const digits = q.replace(/\D/g, '');
    return reservations.filter((r) => {
      if (r.name.toLowerCase().includes(q)) return true;
      if (r.phone.toLowerCase().includes(q)) return true;
      if (digits && r.phone.replace(/\D/g, '').includes(digits)) return true;
      if (r.email?.toLowerCase().includes(q)) return true;
      if (r.external_ref?.toLowerCase().includes(q)) return true;
      if (r.notes?.toLowerCase().includes(q)) return true;
      if (r.tables_json?.toLowerCase().includes(q)) return true;
      if (r.tags_json?.toLowerCase().includes(q)) return true;
      if (r.custom_tags_json?.toLowerCase().includes(q)) return true;
      if (r.event_name?.toLowerCase().includes(q)) return true;
      return false;
    });
  })();

  const byStatus = {
    pending: filtered.filter((r) => r.status === 'pending').length,
    converted: filtered.filter((r) => r.status === 'converted').length,
    no_show: filtered.filter((r) => r.status === 'no_show').length,
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] tracking-widest uppercase text-slate-400">Reservation sync</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Reservations</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            All reservations from the Reservego webhook and manual entries, in one list.
            Filter by event or view everything together.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <WebhookPill status={webhook} />
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="btn btn-primary !py-2 !px-4 text-sm whitespace-nowrap"
          >
            + Add reservation
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-6">
        <Stat label="Total reservations" value={filtered.length} />
        <Stat label="Pending" value={byStatus.pending} tone="amber" />
        <Stat label="Converted" value={byStatus.converted} tone="emerald" />
        <Stat label="No-shows" value={byStatus.no_show} tone="slate" />
      </div>

      {notice && (
        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 px-3 py-2 text-sm">
          {notice}
        </div>
      )}

      {showAdd && (
        <AddReservationModal
          events={events}
          defaultEventId={eventId}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            setRefreshKey((k) => k + 1);
            setNotice('✓ Reservation added.');
          }}
        />
      )}

      <div className="card mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr] gap-3 mb-3">
          <div className="min-w-0">
            <label className="label">Search</label>
            <div className="relative">
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                className="input pl-9 w-full"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, phone, booking ID, table, tag…"
                autoComplete="off"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs px-1.5"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <label className="label">Filter by event</label>
            <select
              className="input w-full"
              value={eventId}
              onChange={(e) => {
                const v = e.target.value;
                setEventId(v);
                router.replace(v ? `/admin/reservations?eventId=${v}` : `/admin/reservations`);
              }}
            >
              <option value="">All events</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.event_date} · {ev.name} ({ev.status})
                </option>
              ))}
            </select>
          </div>
        </div>
        {search && (
          <div className="text-xs text-slate-500 -mt-1 mb-3">
            Showing {filtered.length} of {reservations.length} reservation{reservations.length === 1 ? '' : 's'} matching &quot;{search}&quot;.
          </div>
        )}

        {reservations.length === 0 ? (
          <div className="text-slate-400 text-sm">
            No reservations yet. They will appear here as the Reservego webhook receives them,
            or you can add one manually with "+ Add reservation".
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-slate-400 text-sm">
            No reservations match &quot;{search}&quot;.{' '}
            <button onClick={() => setSearch('')} className="text-brand-600 hover:text-brand-700 underline">
              Clear search
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[1400px]">
              <thead>
                <tr className="text-left text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2 pl-4 sm:pl-0 whitespace-nowrap">Date</th>
                  <th className="pb-2">Guest</th>
                  <th className="pb-2 whitespace-nowrap">Pax</th>
                  <th className="pb-2 whitespace-nowrap">Event</th>
                  <th className="pb-2 whitespace-nowrap">Tables</th>
                  <th className="pb-2">Tags</th>
                  <th className="pb-2 whitespace-nowrap">Special</th>
                  <th className="pb-2">Comments</th>
                  <th className="pb-2">Preferences</th>
                  <th className="pb-2 whitespace-nowrap">Source</th>
                  <th className="pb-2 whitespace-nowrap">Pricing</th>
                  <th className="pb-2 text-right whitespace-nowrap">Entry</th>
                  <th className="pb-2 text-right whitespace-nowrap">Cover</th>
                  <th className="pb-2 whitespace-nowrap">Status</th>
                  <th className="pb-2 whitespace-nowrap">Booking ID</th>
                  <th className="pb-2 pr-4 sm:pr-0"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const p = pricing[r.id];
                  const tables = parseJsonArray(r.tables_json);
                  const tags = [...parseJsonArray(r.tags_json), ...parseJsonArray(r.custom_tags_json)];
                  const prefs = parseJsonArray(r.preferences_json);
                  const visible = tags.slice(0, 3);
                  const extra = tags.length - visible.length;
                  const special = specialChip(r.bday, r.anniv, r.event_date);
                  const comments = r.notes && r.notes.length > 60 ? r.notes.slice(0, 60) + '…' : r.notes;
                  return (
                    <tr key={r.id} className="border-b border-slate-200 last:border-0 align-top">
                      <td className="py-2.5 pl-4 sm:pl-0 whitespace-nowrap">
                        <div className="text-slate-700">{r.event_date || '—'}</div>
                        {r.arrival_time && <div className="text-xs text-slate-400">{r.arrival_time}</div>}
                      </td>
                      <td className="py-2.5">
                        <div className="text-slate-900">{r.name}</div>
                        <div className="text-xs text-slate-500">{r.phone}</div>
                        {r.email && <div className="text-xs text-slate-500">{r.email}</div>}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        <div className="text-base font-semibold text-slate-900">{r.pax}</div>
                        {r.total_visits != null && r.total_visits > 0 && (
                          <div className="text-[10px] text-slate-400">{ordinal(r.total_visits)} visit</div>
                        )}
                      </td>
                      <td className="py-2.5 text-slate-700 whitespace-nowrap">
                        {r.event_name ? (
                          <span className="text-slate-700">{r.event_name}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        {tables.length > 0 ? (
                          <span className="font-mono text-xs text-slate-700">{tables.join(', ')}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {tags.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {visible.map((t, i) => (
                              <span key={`${t}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600 whitespace-nowrap">
                                {t}
                              </span>
                            ))}
                            {extra > 0 && (
                              <span className="text-[10px] text-slate-400">+{extra} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        {special ? (
                          <div className="flex flex-wrap gap-1">{special}</div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {comments ? (
                          <span className="text-xs italic text-slate-500">{comments}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {prefs.length > 0 ? (
                          <span className="font-mono text-xs text-slate-700">{prefs.join(', ')}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${sourceClass(r.provider)}`}>
                          {sourceLabel(r.provider)}
                        </span>
                      </td>
                      <td className="py-2.5 text-xs text-slate-400 whitespace-nowrap">
                        {r.event_id ? (p ? p.paxNote : <span className="opacity-50">…</span>) : <span className="opacity-50">—</span>}
                      </td>
                      <td className="py-2.5 text-right text-slate-700 whitespace-nowrap">{p ? formatMoney(p.entryFee) : '—'}</td>
                      <td className="py-2.5 text-right text-emerald-700 whitespace-nowrap">{p ? formatMoney(p.coverIssued) : '—'}</td>
                      <td className="py-2.5 whitespace-nowrap">
                        <span className={`tag ${tagClass(r.status)}`}>{r.status.replace('_',' ')}</span>
                        {r.converted_wallet_txn && (
                          <div className="text-[10px] font-mono text-slate-500 mt-1">{r.converted_wallet_txn}</div>
                        )}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        {r.external_ref ? (
                          <span className="font-mono text-[10px] text-slate-500" title={r.external_ref}>
                            {truncateMiddle(r.external_ref, 14)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 sm:pr-0 whitespace-nowrap">
                        {r.status === 'pending' && r.event_id && (
                          <>
                            <Link
                              className="text-xs text-emerald-600 hover:text-emerald-700 mr-3"
                              href={`/admin/issue?r=${r.id}&eventId=${r.event_id}`}
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

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function truncateMiddle(str: string, max: number): string {
  if (str.length <= max) return str;
  const half = Math.floor((max - 1) / 2);
  return str.slice(0, half) + '…' + str.slice(str.length - half);
}

function specialChip(bday: string | null | undefined, anniv: string | null | undefined, eventDate: string | null | undefined) {
  if (!eventDate) return null;
  const ev = new Date(eventDate + 'T00:00:00');
  if (isNaN(ev.getTime())) return null;
  const isNear = (iso: string | null | undefined) => {
    if (!iso) return false;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    const evMD = ev.getMonth() * 31 + ev.getDate();
    const dMD = d.getMonth() * 31 + d.getDate();
    return Math.abs(evMD - dMD) <= 7;
  };
  const chips: JSX.Element[] = [];
  if (isNear(bday)) {
    chips.push(
      <span key="b" className="text-[10px] px-1.5 py-0.5 rounded-full border border-pink-200 bg-pink-50 text-pink-700 whitespace-nowrap">
        🎂 Birthday
      </span>
    );
  }
  if (isNear(anniv)) {
    chips.push(
      <span key="a" className="text-[10px] px-1.5 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 whitespace-nowrap">
        💍 Anniversary
      </span>
    );
  }
  return chips.length > 0 ? <>{chips}</> : null;
}

function tagClass(s: ReservationStatus): string {
  if (s === 'pending')   return 'border-amber-200 text-amber-700 bg-amber-50';
  if (s === 'converted') return 'border-emerald-200 text-emerald-700 bg-emerald-50';
  if (s === 'no_show')   return 'border-slate-200 text-slate-400 bg-slate-50';
  return 'border-rose-200 text-rose-700 bg-rose-50';
}

function sourceLabel(provider: string): string {
  if (provider === 'manual')     return 'Manual';
  if (provider === 'reservego')  return 'Reservego';
  if (provider === 'reservego-mock') return 'Mock';
  return provider;
}
function sourceClass(provider: string): string {
  if (provider === 'manual')    return 'border-slate-300 text-slate-700 bg-slate-100';
  if (provider === 'reservego') return 'border-sky-200 text-sky-700 bg-sky-50';
  return 'border-slate-200 text-slate-500 bg-slate-50';
}

function WebhookPill({ status }: { status: WebhookStatus | null }) {
  if (!status) return null;
  const cls =
    status.health === 'healthy'  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    status.health === 'error'    ? 'bg-rose-50 text-rose-700 border-rose-200' :
    status.health === 'untested' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                   'bg-slate-50 text-slate-600 border-slate-200';
  const label =
    status.health === 'healthy'  ? `Webhook live · ${status.reservationCountThisMonth} this month` :
    status.health === 'error'    ? 'Webhook error' :
    status.health === 'untested' ? 'Webhook saved · untested' :
                                   'Webhook not configured';
  return (
    <Link
      href="/admin/settings/reservego"
      className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border ${cls} hover:opacity-80 whitespace-nowrap`}
    >
      {label}
    </Link>
  );
}

function AddReservationModal({
  events,
  defaultEventId,
  onClose,
  onCreated,
}: {
  events: Event[];
  defaultEventId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Default date: today (IST) so manual entry "just works" without picking
  const todayIST = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  // If the operator was viewing a specific event, pre-fill that event's date.
  const prefillFromEvent = defaultEventId
    ? (events.find((e) => e.id === defaultEventId)?.event_date ?? '')
    : '';

  const [eventDate, setEventDate] = useState(prefillFromEvent || todayIST);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pax, setPax] = useState('1');
  const [arrivalTime, setArrivalTime] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live hint: does an event exist for this date?
  const matchingEvent = events.find(
    (e) => e.event_date === eventDate && e.status !== 'closed',
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!eventDate) { setError('Booking date is required.'); return; }
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!phone) { setError('Phone is required.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventDate,
          // Optional explicit override; server will also try to auto-match
          // by date if we don't send eventId.
          eventId: matchingEvent?.id ?? null,
          name: name.trim(),
          phone,
          email: email.trim() || null,
          pax: Number(pax) || 1,
          arrivalTime: arrivalTime || null,
          notes: notes.trim() || null,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.message); return; }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900">Add reservation</h3>
            <div className="text-xs text-slate-500 truncate">
              {matchingEvent
                ? `Will attach to: ${matchingEvent.name}`
                : 'No event for this date yet — will land as unassigned'}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 flex-shrink-0">✕</button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">{error}</div>
          )}
          <div>
            <label className="label">Booking date *</label>
            <input
              className="input"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              required
            />
            {matchingEvent ? (
              <div className="text-xs text-emerald-700 mt-1.5">
                ✓ Matches event: <strong>{matchingEvent.name}</strong>
              </div>
            ) : (
              <div className="text-xs text-amber-700 mt-1.5">
                No event for this date yet. The reservation will appear in the list and auto-link
                when you create an event for {eventDate}.
              </div>
            )}
          </div>
          <div>
            <label className="label">Guest name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Mehta" autoFocus />
          </div>
          <div>
            <label className="label">Phone *</label>
            <PhoneInput value={phone} onChange={setPhone} placeholder="10-digit number" required />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Pax *</label>
              <input className="input" type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} />
            </div>
            <div>
              <label className="label">Arrival time</label>
              <input className="input" type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Birthday, anniversary, allergies, etc." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
              {busy ? 'Adding…' : 'Add reservation'}
            </button>
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
