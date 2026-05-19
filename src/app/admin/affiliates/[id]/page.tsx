'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { formatMoney, relativeTime } from '@/lib/format';
import type {
  Affiliate,
  AffiliateStats,
  EventBreakdownRow,
  AffiliateTicketRow,
  CommissionType,
} from '@/lib/affiliates';
import type { Event } from '@/lib/events';

interface Me { role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry'; name: string }

export default function AffiliateDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || '');

  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [overall, setOverall] = useState<AffiliateStats | null>(null);
  const [breakdown, setBreakdown] = useState<EventBreakdownRow[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [drilldownEventId, setDrilldownEventId] = useState<string | null>(null);
  const [drilldownTickets, setDrilldownTickets] = useState<AffiliateTicketRow[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const [showAssign, setShowAssign] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (!d?.ok) { router.replace('/login'); return; }
      if (d.user.role !== 'host' && d.user.role !== 'manager') {
        router.replace('/admin');
        return;
      }
      setMe(d.user);
      setMeLoaded(true);
    });
  }, [router]);

  useEffect(() => {
    if (!meLoaded || !id) return;
    refresh();
    fetch('/api/events').then((r) => r.json()).then((d) => {
      if (d.ok) {
        const today = istTodayISO();
        setEvents(
          (d.events as Event[])
            .filter((e) => e.event_date >= today && e.status !== 'closed')
            .sort((a, b) => a.event_date.localeCompare(b.event_date)),
        );
      }
    });
  }, [meLoaded, id]);

  async function refresh() {
    const d = await fetch(`/api/affiliates/${id}/breakdown`, { cache: 'no-store' }).then((r) => r.json());
    if (d.ok) {
      setAffiliate(d.affiliate);
      setOverall(d.overall);
      setBreakdown(d.events || []);
      setLoaded(true);
    }
  }

  async function openDrilldown(eventId: string) {
    setDrilldownEventId(eventId);
    setDrilldownLoading(true);
    setDrilldownTickets([]);
    try {
      const d = await fetch(`/api/affiliates/${id}/breakdown?eventId=${eventId}`, { cache: 'no-store' }).then((r) => r.json());
      if (d.ok) setDrilldownTickets(d.tickets || []);
    } finally {
      setDrilldownLoading(false);
    }
  }

  function shareUrl(eventId: string, code: string): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/?ref=${code}&event=${eventId}`;
  }

  async function copyLink(eventId: string) {
    if (!affiliate) return;
    const url = shareUrl(eventId, affiliate.code);
    try {
      await navigator.clipboard.writeText(url);
      setFlash(`Link copied: ${url}`);
    } catch {
      setFlash(url);
    }
    setTimeout(() => setFlash(null), 4000);
  }

  async function unassign(eventId: string, eventName: string) {
    if (!confirm(`Remove ${eventName} from this affiliate? Future tickets won't earn commission.`)) return;
    const res = await fetch(`/api/affiliates/${id}/assignments/${eventId}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.ok) {
      setFlash(`Removed ${eventName} from assignments.`);
      setTimeout(() => setFlash(null), 3000);
      refresh();
    }
  }

  if (!meLoaded || !loaded || !affiliate) {
    return <div className="max-w-6xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;
  }

  // Events available to assign — not already assigned + upcoming
  const assignedIds = new Set(breakdown.map((b) => b.event_id));
  const assignableEvents = events.filter((e) => !assignedIds.has(e.id));

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
      <Link href="/admin/affiliates" className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 mb-3">
        ← Back to Affiliates
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] tracking-widest uppercase text-slate-500">Affiliate</div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1 flex items-center gap-2 flex-wrap">
            {affiliate.name}
            <span className={`tag ${affiliate.status === 'active' ? 'tag-active' : 'tag-revoked'}`}>
              {affiliate.status}
            </span>
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-500 flex-wrap">
            <span className="font-mono text-slate-700">{affiliate.code}</span>
            {affiliate.phone && <span>· {affiliate.phone}</span>}
            {affiliate.email && <span>· {affiliate.email}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Default commission</div>
          <div className="font-semibold text-slate-900 whitespace-nowrap">
            {affiliate.commission_type === 'percent' ? `${affiliate.commission_value}%` : `₹${affiliate.commission_value}/ticket`}
          </div>
        </div>
      </div>

      {flash && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm break-all">
          {flash}
        </div>
      )}

      {/* Overall KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
        <div className="kpi">
          <div className="kpi-label">Clicks</div>
          <div className="kpi-value">{overall?.clicks ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Tickets</div>
          <div className="kpi-value">{overall?.tickets ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Pending</div>
          <div className="kpi-value whitespace-nowrap">{formatMoney(overall?.pending_commission ?? 0)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Paid</div>
          <div className="kpi-value whitespace-nowrap">{formatMoney(overall?.paid_commission ?? 0)}</div>
        </div>
      </div>

      {/* Per-event breakdown */}
      <div className="card mt-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="font-semibold text-slate-900">Per-event breakdown</div>
            <div className="text-xs text-slate-500">Click a row to see the tickets attributed for that event.</div>
          </div>
          <button
            type="button"
            onClick={() => setShowAssign((v) => !v)}
            disabled={assignableEvents.length === 0}
            className="btn btn-secondary !py-1.5 !px-3 text-xs"
          >
            {showAssign ? 'Cancel' : '+ Assign event'}
          </button>
        </div>

        {showAssign && (
          <AssignEventForm
            affiliateId={id}
            events={assignableEvents}
            affiliate={affiliate}
            onAssigned={() => { setShowAssign(false); refresh(); }}
          />
        )}

        {breakdown.length === 0 ? (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mt-3">
            ⚠ No events assigned. This affiliate earns no commission until you assign at least one event above.
          </div>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2 whitespace-nowrap">Event</th>
                  <th className="pb-2 whitespace-nowrap">Rate</th>
                  <th className="pb-2 text-right whitespace-nowrap">Clicks</th>
                  <th className="pb-2 text-right whitespace-nowrap">Tickets</th>
                  <th className="pb-2 text-right whitespace-nowrap">Sales</th>
                  <th className="pb-2 text-right whitespace-nowrap">Commission</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.event_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => openDrilldown(row.event_id)}
                        className="text-left"
                      >
                        <div className="text-slate-900 font-medium hover:text-brand-700">{row.event_name}</div>
                        <div className="text-xs text-slate-500 whitespace-nowrap">{row.event_date}</div>
                      </button>
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      <span className="text-slate-700">
                        {row.effective_commission_type === 'percent'
                          ? `${row.effective_commission_value}%`
                          : `₹${row.effective_commission_value}/ticket`}
                      </span>
                      {row.has_override && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-brand-700 bg-brand-50 border border-brand-200 rounded-full px-1.5 py-0.5">
                          override
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right text-slate-700">{row.clicks}</td>
                    <td className="py-3 text-right text-slate-700">{row.tickets}</td>
                    <td className="py-3 text-right text-slate-700 whitespace-nowrap">{formatMoney(row.sales)}</td>
                    <td className="py-3 text-right text-emerald-700 font-semibold whitespace-nowrap">
                      {formatMoney(row.total_commission)}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => copyLink(row.event_id)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700 mr-3"
                      >
                        Copy link
                      </button>
                      <button
                        onClick={() => unassign(row.event_id, row.event_name)}
                        className="text-xs font-medium text-slate-500 hover:text-rose-700"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drill-down modal */}
      {drilldownEventId && (
        <DrilldownModal
          event={breakdown.find((b) => b.event_id === drilldownEventId)!}
          tickets={drilldownTickets}
          loading={drilldownLoading}
          onClose={() => setDrilldownEventId(null)}
        />
      )}
    </div>
  );
}

function AssignEventForm({
  affiliateId,
  events,
  affiliate,
  onAssigned,
}: {
  affiliateId: string;
  events: Event[];
  affiliate: Affiliate;
  onAssigned: () => void;
}) {
  const [eventId, setEventId] = useState(events[0]?.id || '');
  const [override, setOverride] = useState(false);
  const [type, setType] = useState<CommissionType>(affiliate.commission_type);
  const [value, setValue] = useState(String(affiliate.commission_value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/affiliates/${affiliateId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          commissionType: override ? type : null,
          commissionValue: override ? Number(value) : null,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.message); return; }
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mt-3 text-xs text-slate-500">
        No upcoming events to assign.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-slate-50 p-4 mt-3 space-y-3">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">{error}</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3 items-end">
        <div>
          <label className="label">Event</label>
          <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.event_date} · {ev.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary whitespace-nowrap" disabled={busy}>
          {busy ? 'Saving…' : 'Assign'}
        </button>
      </div>
      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600">
        <input
          type="checkbox"
          checked={override}
          onChange={(e) => setOverride(e.target.checked)}
          className="accent-brand-500"
        />
        <span>
          Override default commission ({affiliate.commission_type === 'percent' ? `${affiliate.commission_value}%` : `₹${affiliate.commission_value}/ticket`}) for this event
        </span>
      </label>
      {override && (
        <div className="flex items-center gap-3 flex-wrap pl-5">
          <div className="flex gap-3">
            {(['percent', 'flat'] as CommissionType[]).map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="assignType"
                  checked={type === t}
                  onChange={() => setType(t)}
                  className="accent-brand-500"
                />
                <span>{t === 'percent' ? '%' : '₹/ticket'}</span>
              </label>
            ))}
          </div>
          <input
            className="input !w-24 !py-1 text-sm"
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      )}
    </form>
  );
}

function DrilldownModal({
  event,
  tickets,
  loading,
  onClose,
}: {
  event: EventBreakdownRow;
  tickets: AffiliateTicketRow[];
  loading: boolean;
  onClose: () => void;
}) {
  const total = useMemo(
    () => tickets.reduce((s, t) => s + (t.commission_amount || 0), 0),
    [tickets],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3 gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 truncate">{event.event_name}</h3>
            <div className="text-xs text-slate-500 mt-0.5">
              {event.event_date} · {event.tickets} ticket(s) · {formatMoney(total)} commission
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 flex-shrink-0">✕</button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 py-8 text-center">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="text-sm text-slate-500 py-8 text-center">No tickets attributed yet for this event.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-left text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2 whitespace-nowrap">When</th>
                  <th className="pb-2">Customer</th>
                  <th className="pb-2 whitespace-nowrap">Ticket</th>
                  <th className="pb-2 text-right whitespace-nowrap">PAX</th>
                  <th className="pb-2 text-right whitespace-nowrap">Price</th>
                  <th className="pb-2 text-right whitespace-nowrap">Commission</th>
                  <th className="pb-2 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.ticket_id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 text-slate-500 whitespace-nowrap">{relativeTime(t.created_at)}</td>
                    <td className="py-2.5 text-slate-900">
                      {t.customer_name}
                      <div className="text-xs text-slate-500 whitespace-nowrap">{t.customer_phone}</div>
                    </td>
                    <td className="py-2.5 text-slate-700 whitespace-nowrap">{t.ticket_name}</td>
                    <td className="py-2.5 text-right text-slate-700">{t.pax}</td>
                    <td className="py-2.5 text-right text-slate-700 whitespace-nowrap">{formatMoney(t.price)}</td>
                    <td className="py-2.5 text-right text-emerald-700 font-semibold whitespace-nowrap">
                      {formatMoney(t.commission_amount)}
                    </td>
                    <td className="py-2.5 whitespace-nowrap">
                      <span className={`tag ${t.commission_status === 'paid' ? 'tag-active' : 'tag-expired'}`}>
                        {t.commission_status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function istTodayISO(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}
