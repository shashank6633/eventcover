'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReservationRow } from '@/lib/reservations';

export interface ReservationSearchHit extends ReservationRow {
  event_name: string | null;
  event_status: string | null;
}

interface Props {
  /** Optional event filter — when set, scopes search to one event */
  eventId?: string;
  /** Called when the operator picks a result */
  onPick: (r: ReservationSearchHit) => void;
}

/**
 * Compact, expandable search box. Searches reservations by name OR phone
 * with a 250ms debounce. Used at the top of the Issue Cover page so door
 * staff can pull up a customer's booking by mobile number or name.
 *
 * Collapsed by default to keep the form clean. Click to expand → type →
 * see matches in a dropdown → click a result → prefill triggered via
 * onPick callback.
 */
export function ReservationSearch({ eventId, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReservationSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const q = query.trim();
    if (!q || q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceTimer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (eventId) params.set('eventId', eventId);
        const res = await fetch(`/api/reservations/lookup?${params.toString()}`);
        const d = await res.json();
        if (d.ok) setResults(d.results || []);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, eventId]);

  // Focus the input when we expand
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  function pick(r: ReservationSearchHit) {
    onPick(r);
    setOpen(false);
    setQuery('');
    setResults([]);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30 transition text-left text-sm text-slate-600"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 flex-shrink-0">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span className="flex-1">Find reservation by name or mobile</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Search</span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-brand-300 bg-white shadow-card-hover">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 flex-shrink-0">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or phone (e.g. Priya or 98765)"
          className="flex-1 bg-transparent border-0 outline-none text-sm py-1"
          autoComplete="off"
        />
        {loading && (
          <span className="text-[10px] uppercase tracking-wider text-slate-400">…</span>
        )}
        <button
          type="button"
          onClick={() => { setOpen(false); setQuery(''); setResults([]); }}
          className="text-slate-400 hover:text-slate-700 text-xs px-1.5"
          aria-label="Close search"
        >
          ✕
        </button>
      </div>

      {query.trim().length >= 2 && (
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 && !loading ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              No reservations match &quot;{query}&quot;.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    className="w-full text-left px-4 py-3 hover:bg-brand-50/40 transition flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{r.name}</span>
                        {(() => {
                          const bdayNear = isWithinSevenDaysOfEvent(r.bday ?? null, r.event_date ?? null);
                          const annivNear = isWithinSevenDaysOfEvent(r.anniv ?? null, r.event_date ?? null);
                          return (
                            <>
                              {bdayNear && <span title="Birthday near event date" aria-label="Birthday">🎂</span>}
                              {annivNear && <span title="Anniversary near event date" aria-label="Anniversary">💍</span>}
                            </>
                          );
                        })()}
                        {typeof r.total_visits === 'number' && r.total_visits > 0 && (
                          <span className="text-[10px] uppercase tracking-wider text-slate-500">
                            Returning · {ordinal(r.total_visits)} visit
                          </span>
                        )}
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${sourceClass(r.provider)}`}>
                          {sourceLabel(r.provider)}
                        </span>
                        {r.status === 'converted' && (
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                            already issued
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {r.phone}
                        {r.email ? ` · ${r.email}` : ''}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
                        {r.event_name && <span className="text-slate-700">{r.event_name}</span>}
                        {r.event_date && <span>{r.event_date}</span>}
                        {r.arrival_time && <span>{r.arrival_time}</span>}
                      </div>
                      {(() => {
                        const tables = parseJsonArray(r.tables_json ?? null);
                        if (tables.length === 0) return null;
                        return (
                          <div className="text-xs text-slate-500 mt-0.5 truncate">
                            📋 Tables: {tables.join(', ')}
                          </div>
                        );
                      })()}
                      {(() => {
                        const tags = [
                          ...parseJsonArray(r.tags_json ?? null),
                          ...parseJsonArray(r.custom_tags_json ?? null),
                        ];
                        if (tags.length === 0) return null;
                        const visible = tags.slice(0, 3);
                        const extra = tags.length - visible.length;
                        return (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {visible.map((t, i) => (
                              <span
                                key={`${t}-${i}`}
                                className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200"
                              >
                                {t}
                              </span>
                            ))}
                            {extra > 0 && (
                              <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                                +{extra} more
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      {r.notes && (
                        <div className="text-xs text-slate-500 mt-0.5 truncate italic">{r.notes}</div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs text-slate-400 uppercase tracking-wider">PAX</div>
                      <div className="font-bold text-slate-900 text-lg leading-none">{r.pax}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {query.trim().length < 2 && (
        <div className="px-4 py-3 text-xs text-slate-500">
          Type at least 2 characters to search across all reservations.
        </div>
      )}
    </div>
  );
}

function sourceLabel(provider: string): string {
  if (provider === 'manual')         return 'Manual';
  if (provider === 'reservego')      return 'Reservego';
  if (provider === 'reservego-mock') return 'Mock';
  return provider;
}
function sourceClass(provider: string): string {
  if (provider === 'manual')    return 'border-slate-300 text-slate-700 bg-slate-100';
  if (provider === 'reservego') return 'border-sky-200 text-sky-700 bg-sky-50';
  return 'border-slate-200 text-slate-500 bg-slate-50';
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function ordinal(n: number): string {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function isWithinSevenDaysOfEvent(iso: string | null, eventDate: string | null): boolean {
  if (!iso || !eventDate) return false;
  const ev = new Date(eventDate + 'T00:00:00');
  const d = new Date(iso);
  if (isNaN(d.getTime()) || isNaN(ev.getTime())) return false;
  const evMD = ev.getMonth() * 31 + ev.getDate();
  const dMD = d.getMonth() * 31 + d.getDate();
  return Math.abs(evMD - dMD) <= 7;
}
