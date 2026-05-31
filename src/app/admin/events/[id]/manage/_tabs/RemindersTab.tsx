'use client';

/**
 * REMINDERS TAB — /admin/events/[id]/manage?tab=reminders
 *
 * UI for the per-event auto-WhatsApp reminder schedule. The host can:
 *   • Toggle the master "Enable reminders" switch.
 *   • Add up to TWO reminder offsets (minutes before event start).
 *   • Quick-add common offsets (15m · 30m · 2h).
 *   • Remove individual schedule rows.
 *
 * State is owned entirely by this component — there is NO upstream "Save"
 * button. Every mutation is persisted immediately via the backend contracts
 * documented at the top of the spec (POST/PATCH/DELETE on
 * /api/events/[id]/manage/reminders[/(scheduleId)]). On the wire, the API
 * surfaces { ok, masterEnabled, schedules: [{id, minutesBefore, enabled}] }.
 *
 * Failure modes are surfaced inline (toast-style row at the bottom of the
 * card). All network errors fail soft — we re-fetch on next mount so the UI
 * stays consistent with the server.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────
 * Types — mirror the backend contract exactly.
 * ──────────────────────────────────────────────────────────────────────── */

interface ReminderSchedule {
  id: string;
  minutesBefore: number;
  enabled: boolean;
}

interface RemindersResponse {
  ok: boolean;
  masterEnabled?: boolean;
  schedules?: ReminderSchedule[];
  message?: string;
}

const MAX_SCHEDULES = 2;
const QUICK_ADD_PRESETS: { label: string; minutes: number }[] = [
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '2 hours',    minutes: 120 },
];

/* ────────────────────────────────────────────────────────────────────────
 * Small pure helpers.
 * ──────────────────────────────────────────────────────────────────────── */

/** "≈ 1 hour before" / "≈ 2 hours before" / "≈ 30 minutes before". */
function describeOffset(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `≈ ${minutes} minute${minutes === 1 ? '' : 's'} before`;
  const hours = minutes / 60;
  // Show one decimal only when it isn't whole (90min → 1.5).
  const pretty = Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1);
  return `≈ ${pretty} hour${hours === 1 ? '' : 's'} before`;
}

/** Summary line for the bottom card: "X hour(s), Y minute(s)". */
function describeOffsetCompact(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = minutes / 60;
  return Number.isInteger(hours)
    ? `${hours} hour${hours === 1 ? '' : 's'}`
    : `${hours.toFixed(1)} hours`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Component.
 * ──────────────────────────────────────────────────────────────────────── */

export function RemindersTab({ eventId }: { eventId: string }) {
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [schedules, setSchedules] = useState<ReminderSchedule[]>([]);
  const [draftMinutes, setDraftMinutes] = useState<string>(''); // freeform input

  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [togglingMaster, setTogglingMaster] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo]   = useState<string | null>(null);
  const infoTimer = useRef<number | null>(null);

  // Toast helper — non-blocking inline notice that clears itself.
  const flashInfo = useCallback((msg: string) => {
    setInfo(msg);
    if (infoTimer.current) window.clearTimeout(infoTimer.current);
    infoTimer.current = window.setTimeout(() => setInfo(null), 2500);
  }, []);

  useEffect(() => () => {
    if (infoTimer.current) window.clearTimeout(infoTimer.current);
  }, []);

  /* ── Load ───────────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manage/reminders`,
        { cache: 'no-store' },
      );
      // The backend may not be deployed yet — render defaults so the form is
      // still usable instead of bricking the tab.
      if (res.status === 404) {
        setMasterEnabled(false);
        setSchedules([]);
        return;
      }
      const d: RemindersResponse = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load reminders.');
        return;
      }
      setMasterEnabled(Boolean(d.masterEnabled));
      setSchedules(Array.isArray(d.schedules) ? d.schedules : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  /* ── Master toggle ──────────────────────────────────────────────────── */

  async function toggleMaster(next: boolean) {
    setTogglingMaster(true);
    setError(null);
    // Optimistic update — revert on failure.
    const prev = masterEnabled;
    setMasterEnabled(next);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manage/reminders`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        },
      );
      const d = await res.json();
      if (!d.ok) {
        setMasterEnabled(prev);
        setError(d.message || 'Could not update reminders.');
        return;
      }
      flashInfo(next ? 'Reminders enabled.' : 'Reminders disabled.');
    } catch (e) {
      setMasterEnabled(prev);
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setTogglingMaster(false);
    }
  }

  /* ── Add schedule ───────────────────────────────────────────────────── */

  const atCap = schedules.length >= MAX_SCHEDULES;

  async function addSchedule(minutes: number) {
    if (atCap) {
      setError(`You can configure a maximum of ${MAX_SCHEDULES} reminders.`);
      return;
    }
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError('Enter a positive number of minutes.');
      return;
    }
    if (minutes > 1440) {
      setError('Maximum 1440 minutes (24 hours) before the event.');
      return;
    }
    if (schedules.some((s) => s.minutesBefore === minutes)) {
      setError('That reminder offset is already configured.');
      return;
    }

    setAdding(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manage/reminders`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutesBefore: minutes }),
        },
      );
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not add reminder.');
        return;
      }
      // Re-read the canonical list from the server so we never drift.
      if (Array.isArray(d.schedules)) {
        setSchedules(d.schedules);
      } else {
        // Backend didn't echo the list — re-fetch to stay in sync.
        await load();
      }
      setDraftMinutes('');
      flashInfo('Reminder added.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setAdding(false);
    }
  }

  async function deleteSchedule(scheduleId: string) {
    setBusyRow(scheduleId);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manage/reminders/${encodeURIComponent(scheduleId)}`,
        { method: 'DELETE' },
      );
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not delete reminder.');
        return;
      }
      setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
      flashInfo('Reminder removed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusyRow(null);
    }
  }

  async function toggleSchedule(scheduleId: string, next: boolean) {
    setBusyRow(scheduleId);
    setError(null);
    // Optimistic.
    setSchedules((prev) => prev.map((s) => s.id === scheduleId ? { ...s, enabled: next } : s));
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manage/reminders/${encodeURIComponent(scheduleId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        },
      );
      const d = await res.json();
      if (!d.ok) {
        // Revert.
        setSchedules((prev) => prev.map((s) => s.id === scheduleId ? { ...s, enabled: !next } : s));
        setError(d.message || 'Could not update reminder.');
      }
    } catch (e) {
      setSchedules((prev) => prev.map((s) => s.id === scheduleId ? { ...s, enabled: !next } : s));
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusyRow(null);
    }
  }

  /* ── Derived ────────────────────────────────────────────────────────── */

  const sortedSchedules = useMemo(
    () => [...schedules].sort((a, b) => a.minutesBefore - b.minutesBefore),
    [schedules],
  );

  const activeSchedules = useMemo(
    () => sortedSchedules.filter((s) => s.enabled),
    [sortedSchedules],
  );

  /** Comma-separated human list for the bottom summary card. */
  const summaryListing = useMemo(() => {
    if (activeSchedules.length === 0) return '';
    const labels = activeSchedules.map((s) => describeOffsetCompact(s.minutesBefore));
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return labels.join(', ');
  }, [activeSchedules]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="card">
        <h2 className="text-base font-semibold text-slate-900">Customer Reminders</h2>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Configure automatic reminders to notify your customers before the event starts.
          Reminders help reduce no-shows and keep attendees informed.
        </p>
      </div>

      {/* Master toggle card */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">Enable reminders</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Send automatic reminders to customers before the event
            </div>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
            <span className="text-[11px] font-medium text-slate-600 select-none">
              {masterEnabled ? 'On' : 'Off'}
            </span>
            <span className="relative inline-block w-10 h-6">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={masterEnabled}
                disabled={loading || togglingMaster}
                onChange={(e) => void toggleMaster(e.target.checked)}
              />
              <span className="absolute inset-0 rounded-full bg-slate-200 peer-checked:bg-brand-500 transition" />
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
            </span>
          </label>
        </div>
      </div>

      {/* Schedules card — visible only when reminders are enabled */}
      {masterEnabled && (
        <div className="card">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-sm font-semibold text-slate-900">Reminder Times</h3>
            <span className="text-[11px] text-slate-400">
              {sortedSchedules.length} / {MAX_SCHEDULES}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            When should we remind your customers? <span className="text-slate-400">(max {MAX_SCHEDULES})</span>
          </p>

          {/* Existing schedules */}
          {loading && sortedSchedules.length === 0 ? (
            <div className="text-sm text-slate-500 mt-4">Loading…</div>
          ) : sortedSchedules.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {sortedSchedules.map((s) => (
                <li
                  key={s.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                    s.enabled ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/50 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="tabular-nums font-semibold text-slate-900">
                      {s.minutesBefore}
                    </span>
                    <span className="text-xs text-slate-500 shrink-0">minutes</span>
                    <span className="text-xs text-slate-400 ml-2 truncate">
                      {describeOffset(s.minutesBefore)}
                    </span>
                  </div>

                  {/* Per-row enable toggle */}
                  <label className="inline-flex items-center gap-1 cursor-pointer shrink-0">
                    <span className="relative inline-block w-9 h-5">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={s.enabled}
                        disabled={busyRow === s.id}
                        onChange={(e) => void toggleSchedule(s.id, e.target.checked)}
                      />
                      <span className="absolute inset-0 rounded-full bg-slate-200 peer-checked:bg-brand-500 transition" />
                      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() => void deleteSchedule(s.id)}
                    disabled={busyRow === s.id}
                    className="text-[11px] text-slate-500 hover:text-rose-600 font-medium px-2 py-1 rounded shrink-0 disabled:opacity-50"
                    aria-label="Delete reminder"
                  >
                    {busyRow === s.id ? '…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 text-xs text-slate-500 italic">
              No reminders configured yet. Add one below.
            </div>
          )}

          {/* Add-row */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              Add reminder
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  inputMode="numeric"
                  value={draftMinutes}
                  onChange={(e) => setDraftMinutes(e.target.value)}
                  placeholder="60"
                  disabled={atCap || adding}
                  className="input !w-24 text-center tabular-nums"
                  aria-label="Minutes before event"
                />
                <span className="text-xs text-slate-500">minutes before event</span>
                {draftMinutes && Number(draftMinutes) > 0 && (
                  <span className="text-[11px] text-slate-400">
                    {describeOffset(Number(draftMinutes))}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void addSchedule(Number(draftMinutes))}
                disabled={atCap || adding || !draftMinutes.trim() || Number(draftMinutes) <= 0}
                className="btn btn-primary !py-1.5 !px-3 text-sm"
                title={atCap ? `Max ${MAX_SCHEDULES} reminders` : 'Add reminder'}
              >
                {adding ? 'Adding…' : '+ Add'}
              </button>
            </div>

            {/* Quick add chips */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500 mr-1">Quick add:</span>
              {QUICK_ADD_PRESETS.map((p) => {
                const alreadyConfigured = schedules.some((s) => s.minutesBefore === p.minutes);
                const disabled = atCap || adding || alreadyConfigured;
                return (
                  <button
                    key={p.minutes}
                    type="button"
                    onClick={() => void addSchedule(p.minutes)}
                    disabled={disabled}
                    title={
                      alreadyConfigured ? 'Already configured' :
                      atCap ? `Max ${MAX_SCHEDULES} reminders` : `Add ${p.label}`
                    }
                    className={`text-xs px-3 py-1 rounded-full border font-medium transition ${
                      disabled
                        ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-brand-500 hover:text-brand-700'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {atCap && (
              <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-block">
                Maximum {MAX_SCHEDULES} reminders reached. Remove one to add another.
              </div>
            )}
          </div>

          {/* Inline error / info row */}
          {(error || info) && (
            <div className="mt-4">
              {error && (
                <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              {info && !error && (
                <div className="text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                  {info}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reminder Summary card — only when there's something meaningful to say */}
      {masterEnabled && activeSchedules.length > 0 && (
        <div className="card !bg-brand-50/40 !border-brand-200">
          <div className="flex items-start gap-3">
            <div className="text-brand-600 text-lg leading-none mt-0.5">🔔</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Reminder Summary</div>
              <div className="text-xs text-slate-700 mt-1 leading-relaxed">
                Customers will be notified via WhatsApp at{' '}
                <strong className="text-brand-700">{summaryListing}</strong>{' '}
                before the event.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* When reminders are OFF, surface the global error there instead */}
      {!masterEnabled && error && (
        <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
