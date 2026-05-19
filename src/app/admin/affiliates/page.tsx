'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PhoneInput } from '@/components/PhoneInput';
import { formatMoney } from '@/lib/format';
import type {
  Affiliate,
  AffiliateStats,
  AssignmentWithEvent,
  CommissionType,
} from '@/lib/affiliates';
import type { Event } from '@/lib/events';

interface Me { role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry'; name: string }
interface AffiliateWithAssignments extends Affiliate {
  assignments: AssignmentWithEvent[];
}
type StatsMap = Record<string, AffiliateStats | undefined>;

interface PendingAssignment {
  eventId: string;
  override: boolean;
  commissionType: CommissionType;
  commissionValue: string;
}

export default function AffiliatesAdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [affiliates, setAffiliates] = useState<AffiliateWithAssignments[]>([]);
  const [stats, setStats] = useState<StatsMap>({});
  const [events, setEvents] = useState<Event[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Add form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [defaultCommissionType, setDefaultCommissionType] = useState<CommissionType>('percent');
  const [defaultCommissionValue, setDefaultCommissionValue] = useState('10');
  const [notes, setNotes] = useState('');
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        setMe(d.user);
        setMeLoaded(true);
      });
  }, [router]);

  useEffect(() => {
    if (!meLoaded) return;
    refresh();
    fetch('/api/events').then((r) => r.json()).then((d) => {
      if (d.ok) {
        const today = istTodayISO();
        const upcoming = (d.events as Event[])
          .filter((e) => e.event_date >= today && e.status !== 'closed')
          .sort((a, b) => a.event_date.localeCompare(b.event_date));
        setEvents(upcoming);
      }
    });
  }, [meLoaded]);

  async function refresh() {
    const d = await fetch('/api/affiliates', { cache: 'no-store' }).then((r) => r.json());
    if (d.ok) {
      setAffiliates(d.affiliates || []);
      setLoaded(true);
      const out: StatsMap = {};
      await Promise.all(
        (d.affiliates as AffiliateWithAssignments[]).map(async (a) => {
          const s = await fetch(`/api/affiliates/${a.id}/stats`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
          if (s?.ok) out[a.id] = s.stats;
        }),
      );
      setStats(out);
    }
  }

  function resetForm() {
    setName(''); setPhone(''); setEmail(''); setCode('');
    setDefaultCommissionType('percent'); setDefaultCommissionValue('10');
    setNotes('');
    setPendingAssignments([]);
    setError(null);
  }

  function addEventSlot() {
    // Find first event not already in the list
    const used = new Set(pendingAssignments.map((p) => p.eventId));
    const next = events.find((e) => !used.has(e.id));
    if (!next) return;
    setPendingAssignments((arr) => [
      ...arr,
      {
        eventId: next.id,
        override: false,
        commissionType: defaultCommissionType,
        commissionValue: defaultCommissionValue,
      },
    ]);
  }
  function updateSlot(idx: number, patch: Partial<PendingAssignment>) {
    setPendingAssignments((arr) => arr.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function removeSlot(idx: number) {
    setPendingAssignments((arr) => arr.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    const v = Number(defaultCommissionValue);
    if (!(v >= 0)) { setError('Commission value must be ≥ 0.'); return; }
    if (defaultCommissionType === 'percent' && v > 100) { setError('Percent commission cannot exceed 100.'); return; }

    setBusy(true);
    try {
      const res = await fetch('/api/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone || null,
          email: email.trim() || null,
          code: code.trim() || null,
          commissionType: defaultCommissionType,
          commissionValue: v,
          notes: notes.trim() || null,
          eventAssignments: pendingAssignments.map((p) => ({
            eventId: p.eventId,
            commissionType: p.override ? p.commissionType : null,
            commissionValue: p.override ? Number(p.commissionValue) : null,
          })),
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.message); return; }
      setFlash(`✓ "${d.affiliate.name}" created with code ${d.affiliate.code} · ${pendingAssignments.length} event(s) assigned.`);
      setTimeout(() => setFlash(null), 4000);
      resetForm();
      setShowAdd(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  if (!meLoaded || !loaded) {
    return <div className="max-w-5xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
      <div className="text-[11px] tracking-widest uppercase text-slate-500">Growth</div>
      <div className="flex items-start justify-between gap-3 flex-wrap mt-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Affiliates</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Each affiliate gets a unique code per event. Tickets only earn commission for the events
            an affiliate is assigned to.
          </p>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="btn btn-primary">
          {showAdd ? 'Cancel' : '+ Add affiliate'}
        </button>
      </div>

      {flash && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
          {flash}
        </div>
      )}

      {showAdd && (
        <form onSubmit={submit} className="card mt-6 space-y-5">
          <div className="text-xs uppercase tracking-widest text-slate-500">New affiliate</div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Name *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" />
            </div>
            <div>
              <label className="label">Code (optional — auto if blank)</label>
              <input
                className="input font-mono uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="RAHUL"
                maxLength={12}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Phone</label>
              <PhoneInput value={phone} onChange={setPhone} placeholder="10-digit number" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Default commission type *</label>
              <div className="flex gap-4 pt-1.5">
                {(['percent', 'flat'] as CommissionType[]).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      name="commType"
                      value={t}
                      checked={defaultCommissionType === t}
                      onChange={() => setDefaultCommissionType(t)}
                      className="accent-brand-500"
                    />
                    <span className="text-slate-700">{t === 'percent' ? 'Percent of sale' : 'Flat ₹ per ticket'}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{defaultCommissionType === 'percent' ? 'Default percent (0–100) *' : 'Default flat ₹ *'}</label>
              <div className="relative">
                {defaultCommissionType === 'flat' && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">₹</span>}
                <input
                  className={`input ${defaultCommissionType === 'flat' ? 'pl-8' : ''}`}
                  type="number"
                  min={0}
                  step="0.01"
                  max={defaultCommissionType === 'percent' ? 100 : undefined}
                  value={defaultCommissionValue}
                  onChange={(e) => setDefaultCommissionValue(e.target.value)}
                />
                {defaultCommissionType === 'percent' && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">%</span>}
              </div>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
          </div>

          {/* ─── Event assignments ───────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">Assigned events</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  This affiliate only earns commission on tickets for these events. Per-event overrides are optional.
                </div>
              </div>
              <button
                type="button"
                onClick={addEventSlot}
                disabled={pendingAssignments.length >= events.length}
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 px-3 py-1.5 rounded-full bg-white border border-slate-200"
              >
                + Add event
              </button>
            </div>

            {events.length === 0 ? (
              <div className="text-xs text-slate-500 py-2">
                No upcoming events. Create an event first.
              </div>
            ) : pendingAssignments.length === 0 ? (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠ No events assigned. This affiliate will earn no commission until you add at least one event.
              </div>
            ) : (
              <ul className="space-y-2 mt-2">
                {pendingAssignments.map((p, idx) => {
                  const usedIds = new Set(pendingAssignments.filter((_, i) => i !== idx).map((x) => x.eventId));
                  const eventOptions = events.filter((e) => !usedIds.has(e.id));
                  return (
                    <li key={idx} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          className="input flex-1 min-w-[180px]"
                          value={p.eventId}
                          onChange={(e) => updateSlot(idx, { eventId: e.target.value })}
                        >
                          {eventOptions.map((ev) => (
                            <option key={ev.id} value={ev.id}>{ev.event_date} · {ev.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeSlot(idx)}
                          className="text-rose-600 hover:text-rose-700 text-xs font-medium px-2"
                          aria-label="Remove"
                        >
                          ✕ Remove
                        </button>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={p.override}
                          onChange={(e) => updateSlot(idx, { override: e.target.checked })}
                          className="accent-brand-500"
                        />
                        <span>Override default commission for this event</span>
                      </label>
                      {p.override && (
                        <div className="flex items-center gap-3 flex-wrap pl-5">
                          <div className="flex gap-3">
                            {(['percent', 'flat'] as CommissionType[]).map((t) => (
                              <label key={t} className="flex items-center gap-1.5 cursor-pointer text-xs">
                                <input
                                  type="radio"
                                  name={`override-${idx}`}
                                  checked={p.commissionType === t}
                                  onChange={() => updateSlot(idx, { commissionType: t })}
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
                            value={p.commissionValue}
                            onChange={(e) => updateSlot(idx, { commissionValue: e.target.value })}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create affiliate'}
            </button>
            <button type="button" onClick={() => { resetForm(); setShowAdd(false); }} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {affiliates.length === 0 ? (
        <div className="card mt-6 text-center text-slate-500 py-12">
          No affiliates yet. Add your first promoter to start tracking.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          {affiliates.map((aff) => {
            const s = stats[aff.id];
            return (
              <Link
                key={aff.id}
                href={`/admin/affiliates/${aff.id}`}
                className={`card hover:border-brand-300 transition cursor-pointer block ${aff.status === 'suspended' ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-slate-900">{aff.name}</h3>
                      <span className={`tag ${aff.status === 'active' ? 'tag-active' : 'tag-revoked'}`}>
                        {aff.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 font-mono">{aff.code}</div>
                    {aff.phone && <div className="text-xs text-slate-500">{aff.phone}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Default commission</div>
                    <div className="font-semibold text-slate-900 whitespace-nowrap">
                      {aff.commission_type === 'percent' ? `${aff.commission_value}%` : `₹${aff.commission_value}/ticket`}
                    </div>
                  </div>
                </div>

                {/* Event chips */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {aff.assignments.length === 0 ? (
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                      ⚠ No events assigned
                    </span>
                  ) : (
                    aff.assignments.slice(0, 4).map((a) => (
                      <span
                        key={a.event_id}
                        className="text-[11px] bg-brand-50 text-brand-700 border border-brand-200 rounded-full px-2.5 py-0.5"
                      >
                        {a.event_name} · {a.event_date.slice(5)}
                      </span>
                    ))
                  )}
                  {aff.assignments.length > 4 && (
                    <span className="text-[11px] text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5">
                      +{aff.assignments.length - 4} more
                    </span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Clicks" value={s?.clicks ?? 0} />
                  <Stat label="Tickets" value={s?.tickets ?? 0} />
                  <Stat label="Pending" value={formatMoney(s?.pending_commission ?? 0)} mono />
                  <Stat label="Paid" value={formatMoney(s?.paid_commission ?? 0)} mono />
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-brand-600 font-medium">
                  View breakdown →
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-6 text-xs text-slate-400">
        Logged in as <span className="font-medium text-slate-600">{me?.name}</span> ({me?.role}).
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: number | string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-bold text-slate-900 mt-0.5 ${mono ? 'whitespace-nowrap' : ''}`}>{value}</div>
    </div>
  );
}

function istTodayISO(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}
