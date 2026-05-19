'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatMoney, relativeTime } from '@/lib/format';
import { PhoneInput } from '@/components/PhoneInput';
import type { Ticket, TicketCategory, Gender } from '@/lib/tickets';
import type { Event } from '@/lib/events';

type Step = 'identifier' | 'details';

interface LookupResult {
  found: boolean;
  name?: string;
  email?: string | null;
  gender?: Gender | null;
  lastSeenAt?: number;
}

export default function OfflineTicketingPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Customer state
  const [step, setStep] = useState<Step>('identifier');
  // `phone` is now the full E.164 string (e.g., "+917207666333"). The
  // PhoneInput component handles country code selection + per-country digit
  // validation. An empty string means "not yet valid".
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('male');
  const [customerNotes, setCustomerNotes] = useState('');
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [lookup, setLookup] = useState<LookupResult | null>(null);

  // Ticket state
  const [ticketName, setTicketName] = useState('');
  const [category, setCategory] = useState<TicketCategory>('guest_list');
  const [pax, setPax] = useState('1');
  const [ticketNotes, setTicketNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [price, setPrice] = useState('0');
  const [paidOffline, setPaidOffline] = useState(false);
  const [complimentary, setComplimentary] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/events').then((r) => r.json()).then((d) => {
      if (d.ok) {
        const today = istTodayISO();
        const upcoming = (d.events as Event[])
          .filter((e) => e.event_date >= today && e.status !== 'closed')
          .sort((a, b) => a.event_date.localeCompare(b.event_date));
        setEvents(upcoming);
        if (upcoming.length > 0) setEventId(upcoming[0].id);
      }
      setLoadingEvents(false);
    });
  }, []);

  useEffect(() => {
    if (!eventId) { setTickets([]); return; }
    refreshTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  async function refreshTickets() {
    if (!eventId) return;
    const d = await fetch(`/api/tickets?eventId=${eventId}`, { cache: 'no-store' }).then((r) => r.json());
    if (d.ok) setTickets(d.tickets || []);
  }

  async function loadCustomer() {
    setError(null);
    const full = phone; // already E.164 from PhoneInput (or '' if invalid)
    if (!full) {
      setError('Enter a valid mobile number.');
      return;
    }
    setLoadingCustomer(true);
    try {
      const d = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(full)}`).then((r) => r.json());
      if (d.found) {
        setName(d.name || full);
        if (d.gender) setGender(d.gender);
        setLookup(d);
        showFlash(`Welcome back, ${d.name}.`);
      } else {
        setName(full);
        setLookup({ found: false });
      }
      setStep('details');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed.');
    } finally {
      setLoadingCustomer(false);
    }
  }

  function showFlash(msg: string, ms = 4000) {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), ms);
  }

  function resetForm() {
    setTicketName('');
    setCategory('guest_list');
    setPax('1');
    setTicketNotes('');
    setInternalNotes('');
    setPrice('0');
    setPaidOffline(false);
    setComplimentary(false);
    setPhone(''); setName(''); setGender('male'); setCustomerNotes('');
    setLookup(null);
    setStep('identifier');
    setError(null);
  }

  function toggleComp(next: boolean) {
    setComplimentary(next);
    if (next) {
      setPaidOffline(false);
      setPrice('0');
    }
  }

  function togglePaid(next: boolean) {
    setPaidOffline(next);
    if (next) setComplimentary(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!eventId) { setError('Select an event.'); return; }
    if (!name.trim()) { setError('Customer name is required.'); return; }
    if (!ticketName.trim()) { setError('Ticket name is required.'); return; }
    const paxN = Number(pax);
    if (!(paxN >= 1)) { setError('PAX must be at least 1.'); return; }
    const priceN = Number(price);
    if (!(priceN >= 0)) { setError('Price must be 0 or greater.'); return; }
    if (!phone) { setError('Mobile number is required.'); return; }

    const full = phone; // E.164 from PhoneInput

    setBusy(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          customerName: name.trim(),
          customerPhone: full,
          customerGender: gender,
          customerNotes: customerNotes.trim() || null,
          ticketName: ticketName.trim(),
          category,
          pax: paxN,
          ticketNotes: ticketNotes.trim() || null,
          internalNotes: internalNotes.trim() || null,
          price: priceN,
          paidOffline,
          complimentary,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.message); return; }
      showFlash(`✓ Ticket "${data.ticket.ticket_name}" issued to ${data.ticket.customer_name}.`);
      resetForm();
      refreshTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  const revenue = useMemo(() => {
    return tickets
      .filter((t) => t.status === 'issued' && t.paid_offline)
      .reduce((sum, t) => sum + (t.price || 0), 0);
  }, [tickets]);

  const compCount = useMemo(
    () => tickets.filter((t) => t.status === 'issued' && t.complimentary).length,
    [tickets],
  );
  const totalIssued = useMemo(
    () => tickets.filter((t) => t.status === 'issued').length,
    [tickets],
  );

  const fullPhoneForBooking = phone; // E.164 from PhoneInput

  return (
    <div className="max-w-4xl mx-auto px-6 md:px-8 py-6">
      <div>
        <div className="text-[11px] tracking-widest uppercase text-slate-500">Door</div>
        <h2 className="text-xl font-semibold text-slate-900 mt-1">Offline Ticketing</h2>
        <p className="text-sm text-slate-500 mt-1">
          Issue guest list, walk-in, paid-offline, and complimentary entries for an upcoming event.
        </p>
      </div>

      {flash && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
          {flash}
        </div>
      )}

      <form onSubmit={submit} className="card mt-6 space-y-5">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {/* Event */}
        <FormRow label={<>Event <Star /></>}>
          {loadingEvents ? (
            <div className="text-sm text-slate-500">Loading events…</div>
          ) : events.length === 0 ? (
            <div className="text-sm text-slate-500">
              No upcoming events.{' '}
              <Link href="/admin/events" className="text-brand-600 hover:text-brand-700 font-medium">Create one →</Link>
            </div>
          ) : (
            <select
              className="input"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              required
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.event_date} · {ev.name}
                </option>
              ))}
            </select>
          )}
        </FormRow>

        {/* Mobile Number + Load */}
        <FormRow label={<>Mobile Number <Star /></>}>
          {/* Stack on mobile (Load button below) so the PhoneInput gets the
              full row width and the country dropdown + national number both
              have room. Side-by-side again from md+ where horizontal space is
              ample. */}
          <div className="flex flex-col sm:flex-row gap-2">
            <PhoneInput
              value={phone}
              onChange={setPhone}
              placeholder="10-digit number"
              className="flex-1"
              required
            />
            <button
              type="button"
              onClick={loadCustomer}
              disabled={loadingCustomer || !phone}
              className="btn btn-primary px-6 sm:flex-shrink-0"
            >
              {loadingCustomer ? '…' : 'Load'}
            </button>
          </div>
          {lookup?.found && (
            <div className="mt-1.5 text-xs text-emerald-700">
              Returning customer · last seen {relativeTime(lookup.lastSeenAt!)}
            </div>
          )}
          {lookup && !lookup.found && (
            <div className="mt-1.5 text-xs text-slate-500">
              New customer — name pre-filled with phone, please edit below.
            </div>
          )}
        </FormRow>

        {step === 'details' && (
          <>
            <FormRow label={<>Name <Star /></>}>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer name"
              />
            </FormRow>

            <FormRow label={<>Gender <Star /></>}>
              <div className="flex gap-5 items-center pt-1.5">
                {(['male', 'female', 'other'] as Gender[]).map((g) => (
                  <label key={g} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      name="gender"
                      value={g}
                      checked={gender === g}
                      onChange={() => setGender(g)}
                      className="accent-brand-500"
                    />
                    <span className="text-slate-700 capitalize">{g === 'other' ? 'Others' : g}</span>
                  </label>
                ))}
              </div>
            </FormRow>

            <FormRow label="Notes">
              <input
                className="input"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                placeholder="Enter notes"
              />
            </FormRow>

            <FormRow label="Ticketing Revenue">
              <div className="text-slate-900 font-semibold py-2">{formatMoney(revenue)}</div>
              <div className="text-xs text-slate-500 -mt-1">
                {totalIssued} ticket(s) issued · {compCount} complimentary
              </div>
            </FormRow>

            <div className="h-px bg-slate-200 my-2" />

            <FormRow label={<>Ticket Name <Star /></>}>
              <input
                className="input"
                value={ticketName}
                onChange={(e) => setTicketName(e.target.value)}
                placeholder="e.g. Guest List, VIP, Comp Pass"
              />
            </FormRow>

            <FormRow label="">
              <div className="flex gap-6 items-center -mt-2">
                {(['guest_list', 'walk_in'] as TicketCategory[]).map((c) => (
                  <label key={c} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      name="category"
                      value={c}
                      checked={category === c}
                      onChange={() => setCategory(c)}
                      className="accent-brand-500"
                    />
                    <span className="text-slate-700">{c === 'guest_list' ? 'Guest List' : 'Walk-In'}</span>
                  </label>
                ))}
              </div>
            </FormRow>

            <FormRow label="PAX">
              <input
                className="input"
                type="number"
                min={1}
                value={pax}
                onChange={(e) => setPax(e.target.value)}
              />
            </FormRow>

            <FormRow label="Ticket Notes">
              <input
                className="input"
                value={ticketNotes}
                onChange={(e) => setTicketNotes(e.target.value)}
                placeholder="Enter notes (visible to customer)"
              />
            </FormRow>

            <FormRow label="Internal Notes">
              <input
                className="input"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Enter internal notes (not visible to customer)"
              />
            </FormRow>

            <FormRow label="Ticket Price">
              <div className="flex gap-3 items-center flex-wrap">
                <div className="relative flex-1 min-w-[140px]">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">₹</span>
                  <input
                    className="input pl-8"
                    type="number"
                    min={0}
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    disabled={complimentary}
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={paidOffline}
                    onChange={(e) => togglePaid(e.target.checked)}
                    className="accent-brand-500 w-4 h-4"
                  />
                  <span className="text-slate-700">Paid Offline</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={complimentary}
                    onChange={(e) => toggleComp(e.target.checked)}
                    className="accent-brand-500 w-4 h-4"
                  />
                  <span className="text-slate-700">Complimentary</span>
                </label>
              </div>
            </FormRow>

            <div className="flex gap-3 pt-2">
              <Link
                href={`/admin/issue?phone=${encodeURIComponent(fullPhoneForBooking)}&name=${encodeURIComponent(name)}&eventId=${eventId}`}
                className="btn btn-secondary flex-1 text-center"
              >
                To Event Booking
              </Link>
              <button className="btn btn-primary flex-1" disabled={busy}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </form>

      {/* Recent tickets for this event */}
      {eventId && tickets.length > 0 && (
        <div className="card mt-6">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-slate-900">
              Recent tickets for this event
            </div>
            <div className="text-xs text-slate-500">{tickets.length} total</div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-2 whitespace-nowrap">When</th>
                  <th className="pb-2">Customer</th>
                  <th className="pb-2 whitespace-nowrap">Ticket</th>
                  <th className="pb-2 whitespace-nowrap">Category</th>
                  <th className="pb-2 text-right whitespace-nowrap">PAX</th>
                  <th className="pb-2 text-right whitespace-nowrap">Price</th>
                  <th className="pb-2 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {tickets.slice(0, 20).map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 text-slate-500 whitespace-nowrap">{relativeTime(t.created_at)}</td>
                    <td className="py-2.5 text-slate-900">
                      {t.customer_name}
                      <div className="text-xs text-slate-500 whitespace-nowrap">{t.customer_phone}</div>
                    </td>
                    <td className="py-2.5 text-slate-700 whitespace-nowrap">{t.ticket_name}</td>
                    <td className="py-2.5 text-slate-500 text-xs uppercase whitespace-nowrap">
                      {t.category === 'guest_list' ? 'Guest list' : 'Walk-in'}
                    </td>
                    <td className="py-2.5 text-right text-slate-700">{t.pax}</td>
                    <td className="py-2.5 text-right text-slate-700 whitespace-nowrap">
                      {t.complimentary ? <span className="text-amber-700">Comp</span> : formatMoney(t.price)}
                    </td>
                    <td className="py-2.5 whitespace-nowrap">
                      <span className={`tag ${t.status === 'cancelled' ? 'tag-revoked' : 'tag-active'}`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FormRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[160px,1fr] gap-2 lg:gap-4 lg:items-start">
      <div className="text-sm font-medium text-slate-700 lg:pt-2.5">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Star() {
  return <span className="text-rose-600">*</span>;
}

function istTodayISO(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}
