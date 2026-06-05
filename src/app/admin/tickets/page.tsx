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

  // Currently selected event — used by CoverQuickPicks to surface the
  // event's per-category cover rates as one-tap fill buttons. Null while
  // the events list is still loading OR no event is selected (rare —
  // useEffect above auto-picks the soonest upcoming event).
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === eventId) ?? null,
    [events, eventId],
  );

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
      // Build a one-line flash that surfaces BOTH the ticket save AND the
      // auto-issued wallet status. The wallet kind ('cover' | 'entry_only')
      // determines whether the QR carries a redeemable balance or just door
      // entry — copy reflects that so the host confirms they issued the
      // right kind.
      //
      // Branch matrix:
      //   - cover + WhatsApp queued      → "Cover ₹X sent on WhatsApp"
      //   - cover + WhatsApp off         → "Cover ₹X · QR Code ID NNNN"
      //   - entry_only + WhatsApp queued → "Entry pass sent on WhatsApp"
      //   - entry_only + WhatsApp off    → "Entry pass · QR Code ID NNNN"
      //   - wallet missing               → "wallet pending — issue manually"
      const w = data.wallet as {
        pin?: string;
        balance?: number;
        whatsappQueued?: boolean;
        kind?: 'cover' | 'entry_only';
      } | null;
      let flash = `✓ Ticket "${data.ticket.ticket_name}" issued to ${data.ticket.customer_name}`;
      if (w?.pin) {
        const isCover = w.kind === 'cover';
        const label = isCover
          ? `Cover ₹${(w.balance ?? 0).toLocaleString('en-IN')}`
          : 'Entry pass';
        flash += w.whatsappQueued
          ? ` · ${label} sent on WhatsApp`
          : ` · ${label} · QR Code ID ${w.pin.slice(-4)}`;
      } else {
        flash += ` (wallet not auto-issued — visit Issue Cover)`;
      }
      flash += '.';
      showFlash(flash);
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
              {/* Quick-pick row — auto-fills price from the SELECTED event's
                  per-category cover rates (configured in the wizard's
                  Tickets section). Clicking a chip also nudges the
                  customer's gender + pax to match (Couple = 2 pax) so the
                  operator doesn't double-enter. Hides cleanly when the
                  selected event has all-zero cover rates (e.g. paid-online
                  events that don't run an at-door cover model). */}
              <CoverQuickPicks
                event={selectedEvent}
                disabled={complimentary}
                onPick={({ amount, asGender, paxValue }) => {
                  setPrice(String(amount));
                  setPaidOffline(true);
                  if (asGender) setGender(asGender);
                  if (paxValue) setPax(String(paxValue));
                }}
              />
              <div className="flex gap-3 items-center flex-wrap mt-2">
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

/* ────────────────────────────────────────────────────────────────────────
 * CoverQuickPicks — per-event cover-rate chips above the Ticket Price input
 *
 * Pulls cover_male_stag / cover_female_stag / cover_couple from the SELECTED
 * event's config and renders one chip per non-zero rate. Tapping a chip
 * auto-fills the form with:
 *   • price       = the chip's amount
 *   • paidOffline = true (door collection is the common case here)
 *   • gender      = 'male' | 'female' | undefined (Couple doesn't set gender)
 *   • pax         = 2 for Couple, otherwise leaves the operator's existing value
 *
 * Hides cleanly when:
 *   • No event is selected yet
 *   • All three cover rates are 0 (e.g. paid-online-only events where the
 *     host doesn't run an at-door cover model)
 *   • The Complimentary checkbox is on (price input is disabled anyway)
 *
 * Keeps the operator in keyboard-free flow: pick event → tap "Male ₹2000"
 * → tap Submit. No mental math, no risk of typing the wrong rate.
 * ──────────────────────────────────────────────────────────────────────── */
function CoverQuickPicks({
  event,
  disabled,
  onPick,
}: {
  event: Event | null;
  disabled?: boolean;
  onPick: (next: { amount: number; asGender?: Gender; paxValue?: number }) => void;
}) {
  if (!event || disabled) return null;
  const male = Number(event.cover_rates?.male_stag) || 0;
  const female = Number(event.cover_rates?.female_stag) || 0;
  const couple = Number(event.cover_rates?.couple) || 0;
  if (male <= 0 && female <= 0 && couple <= 0) return null;

  const chips: Array<{
    key: string;
    label: string;
    amount: number;
    asGender?: Gender;
    paxValue?: number;
  }> = [];
  if (male > 0)   chips.push({ key: 'male',   label: 'Male',   amount: male,   asGender: 'male' });
  if (female > 0) chips.push({ key: 'female', label: 'Female', amount: female, asGender: 'female' });
  if (couple > 0) chips.push({ key: 'couple', label: 'Couple', amount: couple, paxValue: 2 });

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-slate-500">
        Quick pick from <span className="text-slate-700 font-semibold">{event.name}</span>'s cover rates
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onPick({ amount: c.amount, asGender: c.asGender, paxValue: c.paxValue })}
            className="text-xs font-medium px-3 py-1.5 rounded-full border bg-white border-slate-200 text-slate-700 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-800 transition"
          >
            {c.label} ₹{c.amount.toLocaleString('en-IN')}
            {c.paxValue && <span className="text-[10px] text-slate-400 ml-1">(2 pax)</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
