'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * PhasesManager — list + edit ticket release phases for a single event.
 *
 * Backend contract (matches the spec the API ticket implements):
 *   GET    /api/events/[id]/ticket-phases             → { ok, phases: Phase[] }
 *   POST   /api/events/[id]/ticket-phases             body { name, ends_at?, ends_on_sellout? }
 *   PATCH  /api/events/[id]/ticket-phases/[phaseId]   body { name?, ends_at?, ends_on_sellout?, active?, sort_order? }
 *   DELETE /api/events/[id]/ticket-phases/[phaseId]
 *   POST   /api/events/[id]/ticket-phases/[phaseId]/end-now
 *
 * The whole card is self-contained — it mounts, hydrates on its own,
 * and persists every edit immediately. We don't touch WizardState here
 * because phases live in their own tables (see event_ticket_phases) and
 * we don't want one global "Save" button mass-overwriting child rows.
 */
export interface Phase {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
  ends_at: number | null;       // epoch millis — null = no time trigger
  ends_on_sellout: boolean;
  started_at: number | null;
  ended_at: number | null;
}

interface Props {
  eventId: string;
  /** Optional callback so a parent (PricingMatrix) can re-fetch when the phase list changes. */
  onPhasesChange?: (phases: Phase[]) => void;
}

export function PhasesManager({ eventId, onPhasesChange }: Props) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Phase | null>(null);

  // Stash the parent callback in a ref so `reload` does NOT depend on it.
  // The parent passes a fresh inline lambda on every render — making `reload`
  // depend on it kicks off an infinite render loop (reload changes → useEffect
  // re-fires → setPhases → onPhasesChange → parent renders → new lambda →
  // reload changes → …). Visible flicker. The ref keeps `reload` stable,
  // and we still invoke the LATEST callback via the ref.
  const onPhasesChangeRef = useRef(onPhasesChange);
  useEffect(() => { onPhasesChangeRef.current = onPhasesChange; }, [onPhasesChange]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${eventId}/ticket-phases`);
      const d = await safeJson(res);
      if (d && d.ok && Array.isArray(d.phases)) {
        const next = normalizePhases(d.phases);
        setPhases(next);
        onPhasesChangeRef.current?.(next);
      } else if (d && !d.ok) {
        setError(pickMessage(d, 'Could not load phases.'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSave = useCallback(
    async (draft: PhaseDraft) => {
      setBusy(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          name: draft.name,
          ends_at: draft.ends_at, // millis or null
          ends_on_sellout: draft.ends_on_sellout,
        };
        const isEdit = !!draft.id;
        const url = isEdit
          ? `/api/events/${eventId}/ticket-phases/${encodeURIComponent(draft.id!)}`
          : `/api/events/${eventId}/ticket-phases`;
        const res = await fetch(url, {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await safeJson(res);
        if (!d || !d.ok) {
          setError(pickMessage(d, 'Could not save phase.'));
          return;
        }
        setModalOpen(false);
        setEditing(null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
      } finally {
        setBusy(false);
      }
    },
    [eventId, reload],
  );

  const handleDelete = useCallback(
    async (phase: Phase) => {
      if (!confirm(`Delete phase "${phase.name}"? Pricing rows for this phase will also be removed.`)) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/events/${eventId}/ticket-phases/${encodeURIComponent(phase.id)}`,
          { method: 'DELETE' },
        );
        const d = await safeJson(res);
        if (!d || !d.ok) {
          setError(pickMessage(d, 'Could not delete phase.'));
          return;
        }
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
      } finally {
        setBusy(false);
      }
    },
    [eventId, reload],
  );

  const handleEndNow = useCallback(
    async (phase: Phase) => {
      if (!confirm(`End "${phase.name}" now? The next phase by sort order will activate.`)) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/events/${eventId}/ticket-phases/${encodeURIComponent(phase.id)}/end-now`,
          { method: 'POST' },
        );
        const d = await safeJson(res);
        if (!d || !d.ok) {
          setError(pickMessage(d, 'Could not end phase.'));
          return;
        }
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
      } finally {
        setBusy(false);
      }
    },
    [eventId, reload],
  );

  const handleMove = useCallback(
    async (phase: Phase, direction: 'up' | 'down') => {
      const idx = phases.findIndex((p) => p.id === phase.id);
      if (idx < 0) return;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= phases.length) return;
      const other = phases[swapIdx];
      setBusy(true);
      setError(null);
      try {
        // Two PATCHes — swap sort_order values. The backend re-sequences
        // canonically and returns the new list shape on next reload.
        const payloads: Array<[string, number]> = [
          [phase.id, other.sort_order],
          [other.id, phase.sort_order],
        ];
        for (const [id, sort_order] of payloads) {
          const res = await fetch(
            `/api/events/${eventId}/ticket-phases/${encodeURIComponent(id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sort_order }),
            },
          );
          const d = await safeJson(res);
          if (!d || !d.ok) {
            setError(pickMessage(d, 'Could not reorder phases.'));
            return;
          }
        }
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
      } finally {
        setBusy(false);
      }
    },
    [eventId, phases, reload],
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <header>
        <div className="text-sm font-semibold text-slate-900">
          Ticket Release Phases
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Release pricing in waves (Early Bird then Phase 1 then Phase 2…). Each phase
          can end on a date, when it sells out, or both.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400">
          Loading phases…
        </div>
      ) : phases.length === 0 ? (
        <EmptyState
          onCreate={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        />
      ) : (
        <ul className="space-y-2">
          {phases.map((p, i) => (
            <PhaseCard
              key={p.id}
              phase={p}
              canMoveUp={i > 0}
              canMoveDown={i < phases.length - 1}
              busy={busy}
              onMoveUp={() => handleMove(p, 'up')}
              onMoveDown={() => handleMove(p, 'down')}
              onEdit={() => {
                setEditing(p);
                setModalOpen(true);
              }}
              onEndNow={() => handleEndNow(p)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </ul>
      )}

      {phases.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 px-3 py-1.5 rounded-md border border-brand-200 bg-white hover:bg-brand-50/40 transition disabled:opacity-50"
          >
            + Add phase
          </button>
        </div>
      )}

      {modalOpen && (
        <PhaseModal
          initial={editing}
          busy={busy}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Empty state
 * ────────────────────────────────────────────────────────────────────── */
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <div className="text-sm font-semibold text-slate-700 mb-1">
        No phases yet
      </div>
      <p className="text-xs text-slate-500 max-w-md mx-auto mb-3">
        Create your first phase (e.g. <span className="font-mono">Early Bird</span>) and
        set a price for each ticket type or zone below. The next phase activates automatically
        when this one ends or sells out.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-md transition"
      >
        + Create your first phase
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Single phase card
 * ────────────────────────────────────────────────────────────────────── */
function PhaseCard({
  phase,
  canMoveUp,
  canMoveDown,
  busy,
  onMoveUp,
  onMoveDown,
  onEdit,
  onEndNow,
  onDelete,
}: {
  phase: Phase;
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onEndNow: () => void;
  onDelete: () => void;
}) {
  const trigger = describeTrigger(phase);
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-base font-semibold text-slate-900 truncate">
            {phase.name}
          </span>
          {phase.active && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              Active
            </span>
          )}
          {!phase.active && phase.ended_at && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">
              Ended
            </span>
          )}
          {!phase.active && !phase.ended_at && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">
              Upcoming
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-1">{trigger}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <IconBtn
          onClick={onMoveUp}
          disabled={!canMoveUp || busy}
          title="Move up"
          label="↑"
        />
        <IconBtn
          onClick={onMoveDown}
          disabled={!canMoveDown || busy}
          title="Move down"
          label="↓"
        />
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="text-[11px] font-medium text-slate-700 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          Edit
        </button>
        {phase.active && (
          <button
            type="button"
            onClick={onEndNow}
            disabled={busy}
            className="text-[11px] font-medium text-amber-700 hover:text-amber-800 px-2 py-1 rounded border border-amber-200 hover:bg-amber-50 disabled:opacity-50"
          >
            End now
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="text-[11px] font-medium text-rose-600 hover:text-rose-700 px-2 py-1 rounded border border-rose-200 hover:bg-rose-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function IconBtn({
  onClick,
  disabled,
  title,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="text-xs font-mono text-slate-600 hover:text-slate-900 w-7 h-7 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
    >
      {label}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Edit/Create modal
 * ────────────────────────────────────────────────────────────────────── */
interface PhaseDraft {
  id?: string;
  name: string;
  ends_at: number | null;
  ends_on_sellout: boolean;
}

function PhaseModal({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: Phase | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: PhaseDraft) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  // datetime-local needs "YYYY-MM-DDTHH:mm" in the user's local TZ.
  const [endsAt, setEndsAt] = useState(() =>
    initial?.ends_at ? millisToLocalInput(initial.ends_at) : '',
  );
  const [endsOnSellout, setEndsOnSellout] = useState(
    initial?.ends_on_sellout ?? true,
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Name is required.');
      return;
    }
    let endsAtMs: number | null = null;
    if (endsAt) {
      const parsed = Date.parse(endsAt);
      if (!Number.isFinite(parsed)) {
        setLocalError('Could not parse end date.');
        return;
      }
      endsAtMs = parsed;
    }
    if (!endsAtMs && !endsOnSellout) {
      setLocalError('Pick at least one end trigger: a date or sellout.');
      return;
    }
    setLocalError(null);
    onSave({
      id: initial?.id,
      name: trimmed,
      ends_at: endsAtMs,
      ends_on_sellout: endsOnSellout,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-900">
          {initial ? 'Edit phase' : 'Add phase'}
        </h3>

        {localError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-xs">
            {localError}
          </div>
        )}

        <label className="block">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Name
          </span>
          <input
            className="input mt-1 w-full font-mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Early Bird"
            maxLength={60}
            autoFocus
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Ends at (optional)
          </span>
          <input
            type="datetime-local"
            className="input mt-1 w-full"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Leave blank if you only want sellout to trigger the next phase.
          </p>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={endsOnSellout}
            onChange={(e) => setEndsOnSellout(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">
              End when sold out
            </span>
            <span className="block text-[11px] text-slate-500">
              Activate the next phase as soon as this one&apos;s total inventory hits zero.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn btn-secondary text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="btn btn-primary text-xs"
          >
            {busy ? 'Saving…' : 'Save phase'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

function normalizePhases(raw: unknown[]): Phase[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const id = typeof o.id === 'string' ? o.id : null;
      const name = typeof o.name === 'string' ? o.name : null;
      if (!id || !name) return null;
      return {
        id,
        name,
        sort_order: toNumber(o.sort_order, 0),
        active: !!o.active && o.active !== 0,
        ends_at: o.ends_at == null ? null : toNumber(o.ends_at, 0) || null,
        ends_on_sellout:
          o.ends_on_sellout === undefined || o.ends_on_sellout === null
            ? true
            : !!o.ends_on_sellout && o.ends_on_sellout !== 0,
        started_at: o.started_at == null ? null : toNumber(o.started_at, 0) || null,
        ended_at: o.ended_at == null ? null : toNumber(o.ended_at, 0) || null,
      } satisfies Phase;
    })
    .filter((p): p is Phase => p !== null)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function describeTrigger(phase: Phase): string {
  // "Ends DATE · or when sold out" / "Ends DATE" / "Ends when sold out" / "No end trigger"
  const parts: string[] = [];
  if (phase.ends_at) {
    parts.push(`Ends ${formatDate(phase.ends_at)}`);
  }
  if (phase.ends_on_sellout) {
    parts.push(phase.ends_at ? 'or when sold out' : 'Ends when sold out');
  }
  if (parts.length === 0) return 'No automatic end trigger — end manually.';
  return parts.join(' · ');
}

function formatDate(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

function millisToLocalInput(ms: number): string {
  // datetime-local wants "YYYY-MM-DDTHH:mm" — adjust for timezone offset so
  // the value the user sees in the input matches the wall-clock time we
  // stored. Built-in Date.toISOString() returns UTC which would shift it.
  const d = new Date(ms);
  const off = d.getTimezoneOffset() * 60_000;
  const local = new Date(ms - off);
  return local.toISOString().slice(0, 16);
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

// Re-export so PricingMatrix can share the same draft shape without a
// separate types file.
export type { PhaseDraft };
