'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { WizardState } from './types';

/**
 * Coupons section (Phase 2).
 *
 * Reads the current event's id from the `edit` query param — coupons live
 * in their own `event_coupons` table keyed by event_id, so there's no row
 * to attach them to until the event itself has been saved at least once.
 *
 * Surfaces a small CRUD UI:
 *   • Table of existing coupons (code, type/value, usage, expiry, active toggle, delete)
 *   • "+ Add coupon" button → inline modal (code, type, value, max_uses?, expires_at?, active)
 *   • Empty state + "save first" state
 *
 * Server contract — matches the Phase 2 architect spec:
 *   GET    /api/coupons?eventId=…           → { ok: true, coupons: Coupon[] }
 *   POST   /api/coupons                     → { ok: true, coupon: Coupon }
 *   PATCH  /api/coupons/[id]                → { ok: true, coupon: Coupon }
 *   DELETE /api/coupons/[id]                → { ok: true }
 */

// Props kept identical to the rest of the wizard sections so the renderer in
// `/admin/events/page.tsx` can pass them uniformly. We don't actually mutate
// WizardState here — coupons live in their own table — but accepting the
// props keeps the section-renderer signature consistent.
interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

interface Coupon {
  id: string;
  event_id: string | null;
  code: string;
  discount_type: 'fixed' | 'percent';
  discount_value: number;
  max_uses: number | null;
  used_count: number;
  expires_at: number | null;
  active: 0 | 1 | boolean;
  affiliate_id: string | null;
  notes: string | null;
  created_at: number;
}

export function SectionCoupons(_props: Props) {
  // The wizard URL is /admin/events?edit=<eventId>&section=coupons.
  const params = useSearchParams();
  const eventId = params.get('edit');

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Pre-computed at the top level so the hooks order stays stable across
  // renders even when the modal isn't open.
  const existingCodes = useMemo(
    () => new Set(coupons.map((c) => c.code.toUpperCase())),
    [coupons],
  );

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/coupons?eventId=${encodeURIComponent(eventId)}`, {
        cache: 'no-store',
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Failed to load coupons.');
      setCoupons(Array.isArray(d.coupons) ? d.coupons : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load coupons.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleActive(c: Coupon) {
    if (busyId) return;
    setBusyId(c.id);
    const nextActive = !truthy(c.active);
    // Optimistic flip
    setCoupons((cs) => cs.map((x) => (x.id === c.id ? { ...x, active: nextActive ? 1 : 0 } : x)));
    try {
      const res = await fetch(`/api/coupons/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: nextActive }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Failed to update.');
    } catch (e) {
      // Roll back
      setCoupons((cs) => cs.map((x) => (x.id === c.id ? c : x)));
      setError(e instanceof Error ? e.message : 'Failed to update.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCoupon(c: Coupon) {
    if (busyId) return;
    if (!confirm(`Delete coupon "${c.code}"?\n\nIf it has already been used, it will be deactivated instead.`)) return;
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/coupons/${c.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Failed to delete.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete.');
    } finally {
      setBusyId(null);
    }
  }

  // ─── No event id yet ──────────────────────────────────────────────────────
  if (!eventId) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Coupons</h2>
        <p className="text-sm text-slate-600">
          Save the event first to add coupons.
        </p>
        <p className="text-[11px] text-slate-400 mt-3 italic">
          Coupons attach to a specific event and need the event id before they can be created.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Coupons</h2>
          <p className="text-sm text-slate-500 mt-1">
            Discount codes customers can enter on the public booking page.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary whitespace-nowrap"
          onClick={() => setShowAdd(true)}
        >
          + Add coupon
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm mb-3">
          {error}
        </div>
      )}

      {loading && coupons.length === 0 ? (
        <div className="text-sm text-slate-500 py-8 text-center">Loading…</div>
      ) : coupons.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center">
          <div className="text-sm text-slate-600">
            No coupons yet. Add one to offer discounts on the public booking page.
          </div>
        </div>
      ) : (
        <CouponTable
          coupons={coupons}
          busyId={busyId}
          onToggle={toggleActive}
          onDelete={deleteCoupon}
        />
      )}

      {showAdd && (
        <CouponEditorModal
          eventId={eventId}
          existingCodes={existingCodes}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); void load(); }}
        />
      )}
    </div>
  );
}

// ─── Coupon table ──────────────────────────────────────────────────────────

function CouponTable({
  coupons,
  busyId,
  onToggle,
  onDelete,
}: {
  coupons: Coupon[];
  busyId: string | null;
  onToggle: (c: Coupon) => void;
  onDelete: (c: Coupon) => void;
}) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <th className="py-2 px-2 font-medium">Code</th>
            <th className="py-2 px-2 font-medium">Discount</th>
            <th className="py-2 px-2 font-medium">Usage</th>
            <th className="py-2 px-2 font-medium">Expires</th>
            <th className="py-2 px-2 font-medium">Active</th>
            <th className="py-2 px-2 font-medium w-10"></th>
          </tr>
        </thead>
        <tbody>
          {coupons.map((c) => {
            const active = truthy(c.active);
            const isBusy = busyId === c.id;
            const usage = c.max_uses == null
              ? `${c.used_count} / ∞`
              : `${c.used_count} / ${c.max_uses}`;
            return (
              <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/40">
                <td className="py-2.5 px-2">
                  <span className="font-mono font-semibold text-slate-900">{c.code}</span>
                </td>
                <td className="py-2.5 px-2">
                  <TypeChip type={c.discount_type} />
                  <span className="ml-2 text-slate-700">
                    {formatDiscount(c.discount_type, c.discount_value)}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-slate-700 tabular-nums">{usage}</td>
                <td className="py-2.5 px-2 text-slate-700">
                  {c.expires_at ? formatExpiry(c.expires_at) : <span className="text-slate-400">—</span>}
                </td>
                <td className="py-2.5 px-2">
                  <button
                    type="button"
                    onClick={() => onToggle(c)}
                    disabled={isBusy}
                    className={`relative w-9 h-5 rounded-full transition disabled:opacity-50 ${
                      active ? 'bg-brand-500' : 'bg-slate-300'
                    }`}
                    aria-pressed={active}
                    aria-label={active ? 'Deactivate coupon' : 'Activate coupon'}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        active ? 'translate-x-[18px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </td>
                <td className="py-2.5 px-2 text-right">
                  <button
                    type="button"
                    onClick={() => onDelete(c)}
                    disabled={isBusy}
                    className="text-slate-400 hover:text-rose-600 p-1 disabled:opacity-50"
                    aria-label={`Delete coupon ${c.code}`}
                    title="Delete"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TypeChip({ type }: { type: 'fixed' | 'percent' }) {
  const isFixed = type === 'fixed';
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${
        isFixed
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-violet-50 text-violet-700 border-violet-200'
      }`}
    >
      {isFixed ? 'Fixed' : 'Percent'}
    </span>
  );
}

// ─── Add-coupon modal ──────────────────────────────────────────────────────

function CouponEditorModal({
  eventId,
  existingCodes,
  onClose,
  onSaved,
}: {
  eventId: string;
  existingCodes: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState('');
  const [type, setType] = useState<'fixed' | 'percent'>('fixed');
  const [value, setValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');  // YYYY-MM-DD
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Close on Escape (mirrors TableTypeEditModal)
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  function handleCodeChange(raw: string) {
    // Force uppercase + restrict to A-Z 0-9
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setCode(cleaned);
  }

  async function save() {
    setError(null);

    const trimmedCode = code.trim();
    if (!trimmedCode) { setError('Code is required.'); return; }
    if (!/^[A-Z0-9]+$/.test(trimmedCode)) {
      setError('Code can only contain A–Z and 0–9.');
      return;
    }
    if (existingCodes.has(trimmedCode)) {
      setError('A coupon with this code already exists for this event.');
      return;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      setError('Discount value must be greater than 0.');
      return;
    }
    if (type === 'percent' && numericValue > 100) {
      setError('Percent discount cannot exceed 100%.');
      return;
    }

    let maxUsesNum: number | null = null;
    if (maxUses.trim() !== '') {
      const n = Number(maxUses);
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
        setError('Max uses must be a whole number ≥ 1.');
        return;
      }
      maxUsesNum = n;
    }

    let expiresAtMs: number | null = null;
    if (expiresAt) {
      // Use end-of-day so the coupon is valid through the selected date.
      const d = new Date(expiresAt + 'T23:59:59');
      if (Number.isNaN(d.getTime())) {
        setError('Invalid expiry date.');
        return;
      }
      expiresAtMs = d.getTime();
    }

    setSaving(true);
    try {
      const res = await fetch('/api/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          code: trimmedCode,
          discountType: type,
          discountValue: numericValue,
          maxUses: maxUsesNum,
          expiresAt: expiresAtMs,
          active,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Failed to create coupon.');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create coupon.');
    } finally {
      setSaving(false);
    }
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
        aria-labelledby="coupon-edit-title"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div id="coupon-edit-title" className="text-lg font-semibold text-slate-900">
            Add Coupon
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 p-1" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Code */}
          <div>
            <label className="label">Code</label>
            <input
              className="input font-mono uppercase tracking-wider"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="EARLYBIRD"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
            />
            <div className="text-[11px] text-slate-400 mt-1">
              A–Z and 0–9 only. Case-insensitive for customers.
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="label">Discount Type</label>
            <div className="grid grid-cols-2 gap-2">
              <TypeRadio
                active={type === 'fixed'}
                onClick={() => setType('fixed')}
                label="Fixed (₹)"
                hint="-₹500 off"
              />
              <TypeRadio
                active={type === 'percent'}
                onClick={() => setType('percent')}
                label="Percent (%)"
                hint="-20% off"
              />
            </div>
          </div>

          {/* Value */}
          <div>
            <label className="label">
              {type === 'fixed' ? 'Discount Amount (₹)' : 'Discount Percent (%)'}
            </label>
            <input
              className="input"
              type="number"
              min={0}
              max={type === 'percent' ? 100 : undefined}
              step={type === 'percent' ? 1 : 1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={type === 'fixed' ? '500' : '20'}
            />
          </div>

          {/* Max uses + expiry */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Max Uses</label>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="unlimited"
              />
              <div className="text-[11px] text-slate-400 mt-1">Leave blank for ∞.</div>
            </div>
            <div>
              <label className="label">Expires On</label>
              <input
                className="input"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <div className="text-[11px] text-slate-400 mt-1">Leave blank for no expiry.</div>
            </div>
          </div>

          {/* Active */}
          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
            <div className="text-sm text-slate-700">Active</div>
            <button
              type="button"
              onClick={() => setActive((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition ${active ? 'bg-brand-500' : 'bg-slate-300'}`}
              aria-pressed={active}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  active ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-white">
          <button
            onClick={save}
            disabled={saving}
            className="btn btn-primary w-full"
          >
            {saving ? 'Saving…' : 'Create coupon'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TypeRadio({
  active, onClick, label, hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition cursor-pointer ${
        active
          ? 'border-brand-400 bg-brand-50 text-brand-700'
          : 'border-slate-200 text-slate-600 hover:border-slate-300'
      }`}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className={`text-[11px] ${active ? 'text-brand-600' : 'text-slate-400'}`}>{hint}</span>
    </button>
  );
}

// ─── Pure formatters ───────────────────────────────────────────────────────

function truthy(v: 0 | 1 | boolean): boolean {
  return v === true || v === 1;
}

function formatDiscount(type: 'fixed' | 'percent', value: number): string {
  if (type === 'fixed') return `₹${formatInr(value)} off`;
  // Strip trailing .0 for clean display
  const v = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${v}% off`;
}

function formatInr(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

function formatExpiry(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const expired = ms < now;
  const text = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return expired ? `${text} (expired)` : text;
}
