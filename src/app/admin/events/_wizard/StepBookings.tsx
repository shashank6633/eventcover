'use client';

import { useState } from 'react';
import { nanoid } from 'nanoid';
import type { WizardState } from './types';
import type { TableType, OccupancyRule } from '@/lib/events';
import { TableTypeEditModal } from './TableTypeEditModal';
import { formatMoney } from '@/lib/format';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

/**
 * Step 3 — Pricing & Tables.
 *
 * Configures the pricing engine for this event:
 *   • Per-person entry fee (toggleable)
 *   • Cover charges by category (Male / Female / Couple, toggleable)
 *   • Table types with capacity + flat entry fee (admin-editable list)
 *   • Occupancy rule: exact vs min
 *   • GST + discount %
 *
 * What the actual bookings cost is computed from these values by the engine
 * at /admin/bookings/new — same numbers used by the live preview and saved
 * to the bookings table.
 */
export function StepBookings({ state, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const setRate = (key: keyof typeof state.cover_rates, val: number) =>
    onChange({ cover_rates: { ...state.cover_rates, [key]: val } });

  function addTableType() {
    const t: TableType = {
      id: nanoid(),
      name: 'New Table',
      capacity: 4,
      entry_fee: 500,
      visibility: 'none',
      max_per_booking: 0,
      inventory: 0,
      contact_cta_enabled: false,
      time_slots: [],
    };
    onChange({ table_types: [...state.table_types, t] });
    setEditingId(t.id);
  }
  function replaceTableType(id: string, next: TableType) {
    onChange({ table_types: state.table_types.map((t) => (t.id === id ? next : t)) });
  }
  function removeTableType(id: string) {
    if (!confirm('Remove this table type?')) return;
    onChange({ table_types: state.table_types.filter((t) => t.id !== id) });
  }

  const editingTable = editingId ? state.table_types.find((t) => t.id === editingId) : null;

  return (
    <div className="space-y-6">
      {/* Entry fee */}
      <Section
        title="Entry Fee"
        enabled={state.entry_enabled}
        onToggleEnabled={(v) => onChange({ entry_enabled: v })}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldMoney
            label="Entry Fee Per Person"
            value={state.entry_fee_per_person}
            onChange={(v) => onChange({ entry_fee_per_person: v })}
            disabled={!state.entry_enabled}
          />
          <div className="text-xs text-slate-500 self-end pb-2">
            Applies to individual entries. Table bookings use the flat table fee below.
          </div>
        </div>
      </Section>

      {/* Cover charges */}
      <Section
        title="Cover Charges"
        enabled={state.cover_enabled}
        onToggleEnabled={(v) => onChange({ cover_enabled: v })}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FieldMoney
            label="Male Stag"
            value={state.cover_rates.male_stag}
            onChange={(v) => setRate('male_stag', v)}
            disabled={!state.cover_enabled}
            hint="1 pax · charged per male"
          />
          <FieldMoney
            label="Female Stag"
            value={state.cover_rates.female_stag}
            onChange={(v) => setRate('female_stag', v)}
            disabled={!state.cover_enabled}
            hint="1 pax · charged per female"
          />
          <FieldMoney
            label="Couple"
            value={state.cover_rates.couple}
            onChange={(v) => setRate('couple', v)}
            disabled={!state.cover_enabled}
            hint="2 pax · charged per couple"
          />
        </div>
      </Section>

      {/* Table types */}
      <Section title="Table Types">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-slate-500">
            Each table has fixed seating capacity + flat entry fee. Cover charges still apply per guest.
          </div>
          <button type="button" onClick={addTableType} className="text-sm font-medium text-brand-600 hover:text-brand-700 whitespace-nowrap">
            + Add Table Type
          </button>
        </div>

        {state.table_types.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No table types yet. Add one to allow table bookings.
          </div>
        ) : (
          <div className="space-y-2">
            {state.table_types.map((t) => (
              <TicketRow
                key={t.id}
                t={t}
                onEdit={() => setEditingId(t.id)}
                onDelete={() => removeTableType(t.id)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Rules */}
      <Section title="Booking Rules">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <div className="label">Occupancy Rule</div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <RuleOption
                label="Exact match"
                description="Pax must equal table capacity. Admin can edit table size to override."
                value="exact"
                current={state.occupancy_rule}
                onSelect={(v) => onChange({ occupancy_rule: v })}
              />
              <RuleOption
                label="Minimum fill"
                description="Pax must be at least capacity. Over-capacity allowed."
                value="min"
                current={state.occupancy_rule}
                onSelect={(v) => onChange({ occupancy_rule: v })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldPercent
              label="GST %"
              value={state.gst_percent}
              onChange={(v) => onChange({ gst_percent: v })}
            />
            <FieldPercent
              label="Discount %"
              value={state.discount_percent}
              onChange={(v) => onChange({ discount_percent: v })}
            />
          </div>
        </div>
      </Section>

      <div className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-4">
        These prices feed the calculation engine. Changes apply to <b>new</b> bookings only —
        historical bookings keep their original price snapshot.
      </div>

      {editingTable && (
        <TableTypeEditModal
          initial={editingTable}
          onSave={(next) => { replaceTableType(editingTable.id, next); setEditingId(null); }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

// ─── Ticket row (replaces the inline editor) ───────────────────────────────

function TicketRow({ t, onEdit, onDelete }: {
  t: TableType;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const vis = t.visibility ?? 'none';
  return (
    <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 truncate">{t.name || 'Untitled'}</span>
          <VisibilityBadge value={vis} />
        </div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">
          {t.capacity} pax · {formatMoney(t.entry_fee)}
          {t.inventory && t.inventory > 0 ? ` · ${t.inventory} in stock` : ''}
          {t.max_per_booking && t.max_per_booking > 0 ? ` · max ${t.max_per_booking}/booking` : ''}
          {t.time_slots && t.time_slots.length > 0 ? ` · ${t.time_slots.length} time slot${t.time_slots.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100 transition"
        aria-label={`Edit ${t.name}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
        </svg>
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="text-slate-400 hover:text-rose-600 p-1.5 rounded hover:bg-rose-50 transition"
        aria-label={`Remove ${t.name}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
        </svg>
      </button>
    </div>
  );
}

function VisibilityBadge({ value }: { value: NonNullable<TableType['visibility']> }) {
  if (value === 'none') return null;
  const meta = {
    hidden:       { label: 'Hidden',       tone: 'rose'  as const, icon: '–' },
    fast_filling: { label: 'Fast Filling', tone: 'amber' as const, icon: '🔥' },
    sold_out:     { label: 'Sold Out',     tone: 'rose'  as const, icon: '✕' },
  }[value];
  const cls =
    meta.tone === 'rose'  ? 'border-rose-200 bg-rose-50 text-rose-700' :
    meta.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                            'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {meta.label}
    </span>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Section({
  title, children, enabled, onToggleEnabled,
}: {
  title: string; children: React.ReactNode; enabled?: boolean; onToggleEnabled?: (v: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold text-slate-900">{title}</div>
        {onToggleEnabled !== undefined && (
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <span className={enabled ? 'text-slate-700 font-medium' : 'text-slate-400'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              type="button"
              onClick={() => onToggleEnabled(!enabled)}
              className={`relative w-9 h-5 rounded-full transition ${enabled ? 'bg-brand-500' : 'bg-slate-300'}`}
              aria-pressed={enabled}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
            </button>
          </label>
        )}
      </div>
      {children}
    </div>
  );
}

function FieldMoney({
  label, value, onChange, disabled, hint,
}: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className={`relative ${disabled ? 'opacity-50' : ''}`}>
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">₹</span>
        <input
          className="input pl-8"
          type="number"
          min={0}
          step="50"
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          disabled={disabled}
        />
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function FieldPercent({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          className="input pr-8"
          type="number"
          min={0}
          max={100}
          step="1"
          value={value}
          onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">%</span>
      </div>
    </div>
  );
}

function RuleOption({
  label, description, value, current, onSelect,
}: {
  label: string; description: string; value: OccupancyRule;
  current: OccupancyRule; onSelect: (v: OccupancyRule) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`text-left rounded-lg border px-3 py-2 transition ${
        active
          ? 'border-brand-500 bg-brand-50/60 text-slate-900'
          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${active ? 'border-brand-500' : 'border-slate-300'}`}>
          {active && <div className="w-1.5 h-1.5 bg-brand-500 rounded-full" />}
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500 leading-snug">{description}</div>
    </button>
  );
}
