'use client';

/**
 * Edit modal for a single ticket / table type.
 *
 * Surfaces the rich metadata that the customer booking page will consume:
 *   • Name + multi-line info
 *   • Visibility status (none / hidden / fast filling / sold out) — mutually exclusive
 *   • External booking link (overrides default flow)
 *   • Contact CTA toggle
 *   • Price + max-per-booking + inventory
 *   • Time-based availability slots
 *
 * Opens from the pencil button on each row in StepBookings.
 */
import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import type { TableType, TableVisibility, TimeSlot } from '@/lib/pricing';

interface Props {
  initial: TableType;
  onSave: (next: TableType) => void;
  onClose: () => void;
}

export function TableTypeEditModal({ initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial.name);
  const [info, setInfo] = useState(initial.info ?? '');
  const [visibility, setVisibility] = useState<TableVisibility>(initial.visibility ?? 'none');
  const [externalLink, setExternalLink] = useState(initial.external_link ?? '');
  const [contactCta, setContactCta] = useState(!!initial.contact_cta_enabled);
  const [price, setPrice] = useState(String(initial.entry_fee));
  const [maxPerBooking, setMaxPerBooking] = useState(String(initial.max_per_booking ?? 0));
  const [inventory, setInventory] = useState(String(initial.inventory ?? 0));
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [slots, setSlots] = useState<TimeSlot[]>(initial.time_slots ?? []);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  function addSlot() {
    setSlots((s) => [...s, { id: nanoid(), start: '', end: '', quantity: 0 }]);
  }
  function updateSlot(id: string, patch: Partial<TimeSlot>) {
    setSlots((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function removeSlot(id: string) {
    setSlots((s) => s.filter((x) => x.id !== id));
  }

  function save() {
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    const url = externalLink.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setError('External link must start with http:// or https://');
      return;
    }
    const next: TableType = {
      id: initial.id,
      name: name.trim(),
      capacity: Math.max(1, Number(capacity) || 1),
      entry_fee: Math.max(0, Number(price) || 0),
      info: info.trim() || undefined,
      visibility,
      external_link: url || null,
      contact_cta_enabled: contactCta,
      max_per_booking: Math.max(0, Number(maxPerBooking) || 0),
      inventory: Math.max(0, Number(inventory) || 0),
      time_slots: slots
        .filter((s) => s.start || s.end || s.quantity > 0)  // drop empties
        .map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          quantity: Math.max(0, Math.floor(Number(s.quantity) || 0)),
        })),
    };
    onSave(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start md:items-center justify-center px-4 py-6 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated w-full max-w-md my-auto overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-edit-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div id="ticket-edit-title" className="text-lg font-semibold text-slate-900">Edit Entry Ticket</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 p-1" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="px-6 pb-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <Field label="Name">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Table of 2 PAX"
              autoFocus
            />
          </Field>

          {/* Ticket Info */}
          <Field label="Ticket Info">
            <textarea
              className="input min-h-[80px]"
              value={info}
              onChange={(e) => setInfo(e.target.value)}
              placeholder="Enter Ticket info"
            />
          </Field>

          {/* Status chips */}
          <div className="grid grid-cols-2 gap-2">
            <StatusChip
              active={visibility === 'hidden'}
              onClick={() => setVisibility(visibility === 'hidden' ? 'none' : 'hidden')}
              icon={<IconHide />}
              label="Hide Ticket"
              tone="rose"
            />
            <StatusChip
              active={visibility === 'fast_filling'}
              onClick={() => setVisibility(visibility === 'fast_filling' ? 'none' : 'fast_filling')}
              icon={<IconFire />}
              label="Fast Filling"
              tone="amber"
            />
            <StatusChip
              active={visibility === 'sold_out'}
              onClick={() => setVisibility(visibility === 'sold_out' ? 'none' : 'sold_out')}
              icon={<IconSoldOut />}
              label="Sold Out"
              tone="rose"
            />
            <StatusChip
              active={visibility === 'none'}
              onClick={() => setVisibility('none')}
              icon={<IconDot />}
              label="None"
              tone="brand"
            />
          </div>

          {/* External link */}
          <Field label="External Link">
            <input
              className="input"
              type="url"
              value={externalLink}
              onChange={(e) => setExternalLink(e.target.value)}
              placeholder="Enter or paste booking link"
            />
          </Field>

          {/* Contact CTA */}
          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              Contact CTA
              <span className="text-slate-400" title="Replaces the Book button with a Contact-us button on the customer page">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M12 8h.01M11 12h1v4h1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </div>
            <Toggle checked={contactCta} onChange={setContactCta} />
          </div>

          {/* Price / Max / Inventory */}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Ticket Price">
              <input
                className="input"
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            <Field label="Max Tickets Per Booking">
              <input
                className="input"
                type="number"
                min={0}
                value={maxPerBooking}
                onChange={(e) => setMaxPerBooking(e.target.value)}
                title="0 = unlimited"
              />
            </Field>
            <Field label="Ticket Inventory">
              <input
                className="input"
                type="number"
                min={0}
                value={inventory}
                onChange={(e) => setInventory(e.target.value)}
                title="0 = unlimited"
              />
            </Field>
          </div>

          {/* Capacity (kept since the pricing engine needs it) */}
          <Field label="Table Capacity (pax)">
            <input
              className="input"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </Field>

          {/* Time slots */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-900">Time base configuration</div>
              <button
                type="button"
                onClick={addSlot}
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                + Add
              </button>
            </div>

            {slots.length === 0 && (
              <div className="mt-2 text-xs text-slate-500">
                No time-based limits. Tickets are available throughout the event.
              </div>
            )}

            <div className="mt-2 space-y-2">
              {slots.map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-brand-500 flex-shrink-0" />
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider w-10">Start</span>
                    <input
                      className="input text-sm flex-1"
                      type="datetime-local"
                      value={s.start}
                      onChange={(e) => updateSlot(s.id, { start: e.target.value })}
                    />
                    <input
                      className="w-14 text-center text-sm border border-slate-200 rounded px-2 py-1.5 outline-none focus:border-brand-400"
                      type="number"
                      min={0}
                      value={s.quantity}
                      onChange={(e) => updateSlot(s.id, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                      title="Quantity (0 = unlimited for this slot)"
                    />
                    <button
                      type="button"
                      onClick={() => removeSlot(s.id)}
                      className="text-slate-400 hover:text-rose-600 p-1"
                      aria-label="Remove slot"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider w-10">End</span>
                    <input
                      className="input text-sm flex-1"
                      type="datetime-local"
                      value={s.end}
                      onChange={(e) => updateSlot(s.id, { end: e.target.value })}
                    />
                    <div className="w-14" /> {/* spacer to align with the start row's qty + remove */}
                    <div className="w-6" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-white">
          <button onClick={save} className="btn btn-primary w-full">
            Update
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function StatusChip({
  active, onClick, icon, label, tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: 'rose' | 'amber' | 'brand';
}) {
  const toneClasses =
    tone === 'rose'  ? (active ? 'border-rose-300 bg-rose-50 text-rose-700'  : 'border-slate-200 text-slate-600') :
    tone === 'amber' ? (active ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600') :
                       (active ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600');
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition cursor-pointer text-sm font-medium ${toneClasses}`}
      role="radio"
      aria-checked={active}
    >
      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
        active
          ? (tone === 'rose' ? 'border-rose-500 bg-rose-500 text-white' :
             tone === 'amber' ? 'border-amber-500 bg-amber-500 text-white' :
                                'border-brand-500 bg-brand-500 text-white')
          : 'border-slate-300 text-slate-400'
      }`}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition ${checked ? 'bg-brand-500' : 'bg-slate-300'}`}
      aria-pressed={checked}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

function IconHide() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 12h14"/></svg>;
}
function IconFire() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2s4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 1-3s-3 2-3 6a6 6 0 0 0 12 0c0-6-6-12-6-12z"/></svg>;
}
function IconSoldOut() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="6" width="18" height="14" rx="1"/><path d="M3 10h18"/></svg>;
}
function IconDot() {
  return <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3"/></svg>;
}
