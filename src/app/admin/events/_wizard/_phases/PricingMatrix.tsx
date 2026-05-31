'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Phase } from './PhasesManager';

/**
 * PricingMatrix — 2D editor for phase × scope pricing & inventory.
 *
 * Rows are SCOPES (one per ticket type, one per zone, plus a synthetic
 * "flat_entry" row that covers the event-wide entry_fee_per_person).
 * Cols are PHASES (Early Bird, Phase 1, …) sourced from PhasesManager.
 *
 * Each cell holds:
 *   • price input (numeric, debounced 400ms PATCH)
 *   • inventory input (blank = unlimited)
 *   • "sold / total" badge
 *
 * Backend contract:
 *   GET /api/events/[id]/ticket-phases/prices →
 *     { ok, prices: PriceCell[] }
 *   PATCH /api/events/[id]/ticket-phases/[phaseId]/prices →
 *     body { scope, scope_id, price, inventory }
 *     (an upsert keyed on UNIQUE(phase_id, scope, scope_id) per the spec)
 *   DELETE same path with body { scope, scope_id } removes a cell.
 */

export type Scope = 'table_type' | 'zone' | 'flat_entry';

export interface ScopeRow {
  scope: Scope;
  scopeId: string | null; // null for flat_entry
  label: string;
  /** Optional list-context — e.g. capacity for tables, total seats for zones. */
  sublabel?: string;
}

export interface PriceCell {
  phase_id: string;
  scope: Scope;
  scope_id: string | null;
  price: number;
  inventory: number | null; // null = unlimited
  sold: number;
}

interface Props {
  eventId: string;
  phases: Phase[];
  scopes: ScopeRow[];
}

// Debounce window for autosaving a price/inventory edit. 400ms matches the
// architect spec and feels snappy without spamming PATCH on every keystroke.
const SAVE_DEBOUNCE_MS = 400;

export function PricingMatrix({ eventId, phases, scopes }: Props) {
  const [cells, setCells] = useState<Map<string, PriceCell>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable key for the (phase, scope, scopeId) tuple used in the cells map.
  const cellKey = useCallback(
    (phaseId: string, scope: Scope, scopeId: string | null) =>
      `${phaseId}::${scope}::${scopeId ?? ''}`,
    [],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${eventId}/ticket-phases/prices`);
      const d = await safeJson(res);
      if (d && d.ok && Array.isArray(d.prices)) {
        const next = new Map<string, PriceCell>();
        for (const raw of d.prices) {
          const cell = normalizeCell(raw);
          if (cell) next.set(cellKey(cell.phase_id, cell.scope, cell.scope_id), cell);
        }
        setCells(next);
      } else if (d && !d.ok) {
        setError(pickMessage(d, 'Could not load pricing matrix.'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [eventId, cellKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const commitCell = useCallback(
    async (
      phaseId: string,
      scope: Scope,
      scopeId: string | null,
      patch: { price?: number; inventory?: number | null },
    ) => {
      // Optimistic merge before the round-trip so the badge updates instantly.
      setCells((prev) => {
        const k = cellKey(phaseId, scope, scopeId);
        const cur = prev.get(k);
        const merged: PriceCell = {
          phase_id: phaseId,
          scope,
          scope_id: scopeId,
          price: patch.price ?? cur?.price ?? 0,
          inventory:
            patch.inventory !== undefined ? patch.inventory : cur?.inventory ?? null,
          sold: cur?.sold ?? 0,
        };
        const next = new Map(prev);
        next.set(k, merged);
        return next;
      });

      try {
        const body: Record<string, unknown> = {
          scope,
          scope_id: scopeId,
        };
        if (patch.price !== undefined) body.price = patch.price;
        if (patch.inventory !== undefined) body.inventory = patch.inventory;
        const res = await fetch(
          `/api/events/${eventId}/ticket-phases/${encodeURIComponent(phaseId)}/prices`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        const d = await safeJson(res);
        if (!d || !d.ok) {
          setError(pickMessage(d, 'Could not save price.'));
          return;
        }
        if (d.price && typeof d.price === 'object') {
          const canonical = normalizeCell(d.price);
          if (canonical) {
            setCells((prev) => {
              const next = new Map(prev);
              next.set(
                cellKey(canonical.phase_id, canonical.scope, canonical.scope_id),
                canonical,
              );
              return next;
            });
          }
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
      }
    },
    [eventId, cellKey],
  );

  if (phases.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
        Add a phase above to start configuring per-phase pricing.
      </div>
    );
  }
  if (scopes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
        Add a ticket type or seating zone first, then configure prices per phase here.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <header>
        <div className="text-sm font-semibold text-slate-900">
          Pricing matrix
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          One row per ticket type and zone. One column per phase. Set price and
          (optional) inventory for each combination.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400">
          Loading pricing…
        </div>
      ) : (
        <div className="relative overflow-x-auto -mx-1">
          <table className="w-full text-sm border-collapse min-w-[640px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200 bg-white">
                <th className="sticky left-0 z-10 text-left px-2 py-2 font-semibold bg-white border-r border-slate-100 min-w-[140px]">
                  Scope
                </th>
                {phases.map((p) => (
                  <th
                    key={p.id}
                    className="text-left px-2 py-2 font-semibold min-w-[180px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono normal-case text-xs text-slate-800">
                        {p.name}
                      </span>
                      {p.active && (
                        <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                          Active
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scopes.map((s) => (
                <tr
                  key={`${s.scope}:${s.scopeId ?? ''}`}
                  className="border-b border-slate-100"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 text-left px-2 py-2 bg-white border-r border-slate-100 align-top"
                  >
                    <ScopeLabel row={s} />
                  </th>
                  {phases.map((p) => {
                    const k = cellKey(p.id, s.scope, s.scopeId);
                    const cell = cells.get(k);
                    return (
                      <td key={p.id} className="px-2 py-2 align-top">
                        <PricingCell
                          phaseId={p.id}
                          scope={s.scope}
                          scopeId={s.scopeId}
                          cell={cell}
                          onCommit={commitCell}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400 italic">
        Changes save automatically. Blank inventory = unlimited. Sold count is read-only —
        derived from captured payments.
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sticky scope label cell
 * ────────────────────────────────────────────────────────────────────── */
function ScopeLabel({ row }: { row: ScopeRow }) {
  const tagColors: Record<Scope, string> = {
    table_type: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    zone: 'bg-violet-50 text-violet-700 border-violet-200',
    flat_entry: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  const tagLabel: Record<Scope, string> = {
    table_type: 'Table',
    zone: 'Zone',
    flat_entry: 'Entry',
  };
  return (
    <div className="min-w-[120px]">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded border font-semibold ${tagColors[row.scope]}`}
        >
          {tagLabel[row.scope]}
        </span>
        <span className="text-xs font-semibold text-slate-800 truncate">
          {row.label}
        </span>
      </div>
      {row.sublabel && (
        <div className="text-[10px] text-slate-500 mt-0.5">{row.sublabel}</div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Single cell editor
 * ────────────────────────────────────────────────────────────────────── */
function PricingCell({
  phaseId,
  scope,
  scopeId,
  cell,
  onCommit,
}: {
  phaseId: string;
  scope: Scope;
  scopeId: string | null;
  cell: PriceCell | undefined;
  onCommit: (
    phaseId: string,
    scope: Scope,
    scopeId: string | null,
    patch: { price?: number; inventory?: number | null },
  ) => void;
}) {
  const [priceDraft, setPriceDraft] = useState(
    cell ? String(cell.price) : '',
  );
  const [invDraft, setInvDraft] = useState(
    cell?.inventory == null ? '' : String(cell.inventory),
  );
  const [hover, setHover] = useState(false);

  // Re-sync the drafts when the upstream cell mutates (canonical server
  // value adopted after a successful PATCH, or initial hydration). We compare
  // against the current draft so the user isn't yanked mid-typing.
  useEffect(() => {
    if (cell == null) {
      setPriceDraft('');
      setInvDraft('');
      return;
    }
    setPriceDraft((cur) => (cur === '' || Number(cur) !== cell.price ? String(cell.price) : cur));
    setInvDraft((cur) => {
      const canonical = cell.inventory == null ? '' : String(cell.inventory);
      if (cur === canonical) return cur;
      // If the user has an unsaved typed value, leave it alone.
      if (cur !== '' && cell.inventory != null && Number(cur) !== cell.inventory) {
        return cur;
      }
      return canonical;
    });
  }, [cell]);

  // Debounce both price + inventory commits. We hold the latest values in a
  // ref so the timer's closure doesn't capture stale draft text.
  const latestRef = useRef({ priceDraft, invDraft });
  latestRef.current = { priceDraft, invDraft };
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueCommit = useCallback(
    (changed: 'price' | 'inventory') => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const { priceDraft: p, invDraft: i } = latestRef.current;
        const patch: { price?: number; inventory?: number | null } = {};
        if (changed === 'price') {
          const n = Number(p);
          if (!Number.isFinite(n) || n < 0) return;
          patch.price = n;
        } else {
          if (i.trim() === '') {
            patch.inventory = null;
          } else {
            const n = Number(i);
            if (!Number.isFinite(n) || n < 0) return;
            patch.inventory = Math.floor(n);
          }
        }
        onCommit(phaseId, scope, scopeId, patch);
      }, SAVE_DEBOUNCE_MS);
    },
    [phaseId, scope, scopeId, onCommit],
  );

  // Flush the pending debounce on unmount so a row that's torn down mid-edit
  // doesn't drop the user's last keystroke.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const isEmpty = cell == null;

  if (isEmpty && !hover && priceDraft === '' && invDraft === '') {
    return (
      <button
        type="button"
        onMouseEnter={() => setHover(true)}
        onFocus={() => setHover(true)}
        onClick={() => setHover(true)}
        className="w-full text-left text-slate-300 hover:text-brand-500 text-sm font-mono py-1.5 px-2 rounded border border-transparent hover:border-brand-200 hover:bg-brand-50/30 transition"
        aria-label="Add price for this cell"
      >
        —
      </button>
    );
  }

  const soldBadge = cell ? formatSoldBadge(cell) : null;

  return (
    <div
      className="space-y-1.5"
      onMouseLeave={() => {
        if (isEmpty && priceDraft === '' && invDraft === '') setHover(false);
      }}
    >
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-slate-400 font-mono">₹</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className="input !py-1 !px-1.5 !text-xs w-full"
          value={priceDraft}
          placeholder="0"
          onChange={(e) => {
            setPriceDraft(e.target.value);
            queueCommit('price');
          }}
        />
      </div>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        className="input !py-1 !px-1.5 !text-xs w-full"
        value={invDraft}
        placeholder="Unlimited"
        onChange={(e) => {
          setInvDraft(e.target.value);
          queueCommit('inventory');
        }}
      />
      {soldBadge && (
        <div
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded inline-block ${soldBadge.tone}`}
        >
          {soldBadge.text}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

function formatSoldBadge(cell: PriceCell): { text: string; tone: string } {
  const sold = cell.sold;
  if (cell.inventory == null) {
    return {
      text: `${sold} sold`,
      tone: 'bg-slate-100 text-slate-600',
    };
  }
  const ratio = cell.inventory > 0 ? sold / cell.inventory : 1;
  let tone = 'bg-slate-100 text-slate-600';
  if (ratio >= 1) tone = 'bg-rose-100 text-rose-700';
  else if (ratio >= 0.8) tone = 'bg-amber-100 text-amber-700';
  else if (ratio > 0) tone = 'bg-emerald-100 text-emerald-700';
  return {
    text: `${sold} / ${cell.inventory} sold`,
    tone,
  };
}

function normalizeCell(raw: unknown): PriceCell | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const phase_id = typeof o.phase_id === 'string' ? o.phase_id : null;
  const scopeRaw = typeof o.scope === 'string' ? o.scope : null;
  if (!phase_id || !scopeRaw) return null;
  if (scopeRaw !== 'table_type' && scopeRaw !== 'zone' && scopeRaw !== 'flat_entry') {
    return null;
  }
  return {
    phase_id,
    scope: scopeRaw,
    scope_id: typeof o.scope_id === 'string' && o.scope_id ? o.scope_id : null,
    price: toNumber(o.price, 0),
    inventory:
      o.inventory == null
        ? null
        : Number.isFinite(toNumber(o.inventory, NaN))
          ? toNumber(o.inventory, 0)
          : null,
    sold: toNumber(o.sold, 0),
  };
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickMessage(
  resp: Record<string, unknown> | null,
  fallback: string,
): string {
  if (resp && typeof resp.message === 'string' && resp.message) {
    return resp.message;
  }
  return fallback;
}

// Re-export so parent sections can build their scope list without
// duplicating the literal shape.
export type { Scope as PricingScope };
