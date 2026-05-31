'use client';

/**
 * Cart Recovery tab — Insights v2 dashboard.
 *
 * Layout, top → bottom:
 *   1. KPI strip — Total Carts / Recovered / Revenue Recovered / Messages Sent
 *   2. Config card — toggle + delay + template + "Save" / "Run sweep now"
 *   3. Recovery Activity table — outcome pill, customer, cart amount/items,
 *      progress phrase, relative when. Each row is clickable; click opens
 *      a slide-over side panel showing the full engagement timeline for
 *      that cart (currently MVP: list of recovery attempts with
 *      timestamps; future: full event-stream join).
 *
 * Data: /api/events/[id]/cart-recovery returns
 *   { config, kpis, activity, recentAttempts, recoveryRate, ... }
 *
 * The shell tolerates partial responses (e.g. a backend that hasn't shipped
 * the v2 `kpis`/`activity` yet) by falling back to the legacy `recentAttempts`
 * + `recoveryRate` shape so the dashboard never hard-blanks during rollout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface RecoveryConfig {
  enabled: boolean;
  delayMinutes: 30 | 60 | 120 | 240;
  templateName: string;
  templateLang?: string;
  lastSweptAt?: number;
}

interface LegacyAttempt {
  id: string;
  sentAt: number;
  customerName: string | null;
  phone: string | null;
  eventName: string | null;
  status: 'sent' | 'recovered' | 'failed';
  interaktMessageId: string | null;
  recoveredAt: number | null;
  error: string | null;
}

interface ActivityRow {
  id: string;
  outcome: 'in_progress' | 'recovered' | 'failed';
  customerName: string | null;
  customerPhone: string | null;
  amount: number;
  items: string;
  progress: string;
  abandonedAt: number;
  sentAt: number | null;
  recoveredAt: number | null;
}

interface RecoveryKpis {
  totalCarts: number;
  inProgress: number;
  recovered: number;
  recoveryRatePct: number;
  revenueRecovered: number;
  messagesSent: number;
  messagesOpened: number;
}

interface RecoveryResponse {
  ok: boolean;
  config?: Partial<RecoveryConfig>;
  recentAttempts?: LegacyAttempt[];
  recoveryRate?: { sent: number; recovered: number; failed?: number; rate?: number };
  kpis?: RecoveryKpis;
  activity?: ActivityRow[];
  message?: string;
}

const DELAY_OPTIONS: { value: 30 | 60 | 120 | 240; label: string }[] = [
  { value: 30,  label: '30 minutes' },
  { value: 60,  label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
];

const DEFAULT_CONFIG: RecoveryConfig = {
  enabled: false,
  delayMinutes: 60,
  templateName: 'akan_cart_recovery',
  templateLang: 'en',
};

function fmtAgo(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtTimestamp(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function fmtINR(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return '₹0';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function RecoveryTab({ eventId }: { eventId: string }) {
  const [config, setConfig] = useState<RecoveryConfig>(DEFAULT_CONFIG);
  const [kpis, setKpis] = useState<RecoveryKpis | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [legacyAttempts, setLegacyAttempts] = useState<LegacyAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/cart-recovery`, { cache: 'no-store' });
      if (res.status === 404) {
        setConfig(DEFAULT_CONFIG);
        setActivity([]);
        setKpis(null);
        return;
      }
      const d: RecoveryResponse = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load cart-recovery config.');
        return;
      }
      setConfig({
        enabled:       Boolean(d.config?.enabled ?? false),
        delayMinutes:  (d.config?.delayMinutes ?? 60) as RecoveryConfig['delayMinutes'],
        templateName:  d.config?.templateName  ?? DEFAULT_CONFIG.templateName,
        templateLang:  d.config?.templateLang  ?? 'en',
        lastSweptAt:   d.config?.lastSweptAt   ?? 0,
      });
      setKpis(d.kpis ?? null);
      setActivity(d.activity ?? []);
      setLegacyAttempts(d.recentAttempts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/cart-recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled:      config.enabled,
          delayMinutes: config.delayMinutes,
          templateName: config.templateName.trim() || DEFAULT_CONFIG.templateName,
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not save config.');
        return;
      }
      setInfo('Saved.');
      setTimeout(() => setInfo(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  async function sweep() {
    if (!config.enabled) {
      // No point pestering the API if the feature is off — give a soft hint.
      if (!confirm('Auto-recovery is OFF. Run a one-time manual sweep anyway?')) return;
    }
    setSweeping(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/cart-recovery/sweep`, {
        method: 'POST',
      });
      if (res.status === 429) {
        setError('Sweep ran too recently — wait a minute and try again.');
        return;
      }
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Sweep failed.');
        return;
      }
      const sent = Number(d.sent ?? 0);
      const skipped = Number(d.skipped ?? 0);
      setInfo(`Sweep done — ${sent} sent, ${skipped} skipped.`);
      // Re-load to show the new attempts row.
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSweeping(false);
    }
  }

  // The selected row's timeline panel reads from `activity` (already loaded)
  // + filters `legacyAttempts` for any matching id so the side panel surfaces
  // every attempt against this cart, not just the latest.
  const timelineForSelected = useMemo(() => {
    if (!selected) return [];
    const events: Array<{ at: number; label: string; detail?: string }> = [];
    events.push({
      at: selected.abandonedAt,
      label: 'Cart abandoned',
      detail: selected.items || 'Cart left without completing payment',
    });
    if (selected.sentAt) {
      events.push({ at: selected.sentAt, label: 'Recovery WhatsApp sent' });
    }
    // Surface any extra attempt rows we know about (currently just one per
    // cart given the UNIQUE(source, source_id) constraint, but future
    // multi-stage cadences will append here).
    for (const a of legacyAttempts) {
      if (a.id !== selected.id) continue;
      if (a.recoveredAt) {
        events.push({ at: a.recoveredAt, label: 'Recovered (payment captured)' });
      }
      if (a.error) {
        events.push({ at: a.sentAt, label: 'Send failed', detail: a.error });
      }
    }
    if (selected.recoveredAt && !events.some((e) => e.label.startsWith('Recovered'))) {
      events.push({ at: selected.recoveredAt, label: 'Recovered (payment captured)' });
    }
    events.sort((a, b) => a.at - b.at);
    return events;
  }, [selected, legacyAttempts]);

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <RecoveryKpiStrip kpis={kpis} loading={loading} />

      {/* Config form */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-slate-900">Auto WhatsApp follow-ups</h2>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <span className="text-xs font-medium text-slate-600">
              {config.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <span className="relative inline-block w-10 h-6">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              />
              <span className="absolute inset-0 rounded-full bg-slate-200 peer-checked:bg-brand-500 transition"/>
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition peer-checked:translate-x-4"/>
            </span>
          </label>
        </div>
        <p className="text-xs text-slate-500">
          When a customer abandons checkout, we wait the delay below and then send a WhatsApp template
          via Interakt. The template needs three body variables: {'{{1}}'} guest name, {'{{2}}'} event name,
          {' {{3}}'} resume URL.
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Delay</label>
            <select
              className="input"
              value={config.delayMinutes}
              onChange={(e) => setConfig({ ...config, delayMinutes: Number(e.target.value) as RecoveryConfig['delayMinutes'] })}
              disabled={loading}
            >
              {DELAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Time of inactivity before the follow-up fires.</p>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Interakt template name</label>
            <input
              className="input font-mono"
              value={config.templateName}
              onChange={(e) => setConfig({ ...config, templateName: e.target.value })}
              placeholder="akan_cart_recovery"
              disabled={loading}
            />
            <p className="text-[11px] text-slate-400 mt-1">Must be approved in your Interakt dashboard.</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button onClick={() => void save()} disabled={saving || loading} className="btn btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => void sweep()} disabled={sweeping || loading} className="btn btn-secondary">
            {sweeping ? 'Running…' : 'Run sweep now'}
          </button>
          {config.lastSweptAt ? (
            <span className="text-[11px] text-slate-400 ml-2">
              Last swept {fmtAgo(config.lastSweptAt)}
            </span>
          ) : null}
          {info && (
            <span className="text-[12px] text-emerald-600 font-medium ml-auto">{info}</span>
          )}
          {error && (
            <span className="text-[12px] text-rose-600 font-medium ml-auto">{error}</span>
          )}
        </div>
      </div>

      {/* Recovery Activity table */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-5 pt-5 pb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recovery Activity</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any row to see the full engagement timeline.
            </p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="text-xs text-brand-600 font-medium hover:text-brand-700">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <RecoveryActivityTable
          rows={activity}
          loading={loading}
          onRowClick={(row) => setSelected(row)}
        />
      </div>

      {/* Side panel — full engagement timeline */}
      {selected && (
        <TimelineDrawer
          row={selected}
          events={timelineForSelected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ─── KPI strip ──────────────────────────────────────────────────────────────

function RecoveryKpiStrip({ kpis, loading }: { kpis: RecoveryKpis | null; loading: boolean }) {
  const total = kpis?.totalCarts ?? 0;
  const inProgress = kpis?.inProgress ?? 0;
  const recovered = kpis?.recovered ?? 0;
  const ratePct = kpis?.recoveryRatePct ?? 0;
  const revenue = kpis?.revenueRecovered ?? 0;
  const sent = kpis?.messagesSent ?? 0;
  const opened = kpis?.messagesOpened ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard
        label="Total Carts"
        value={loading ? '—' : total.toLocaleString('en-IN')}
        subtitle={loading ? undefined : `${inProgress.toLocaleString('en-IN')} in progress`}
        tone="slate"
      />
      <KpiCard
        label="Recovered"
        value={loading ? '—' : recovered.toLocaleString('en-IN')}
        subtitle={loading ? undefined : `${ratePct.toFixed(1)}% recovery rate`}
        tone="emerald"
      />
      <KpiCard
        label="Revenue Recovered"
        value={loading ? '—' : fmtINR(revenue)}
        subtitle={loading ? undefined : 'From captured payments'}
        tone="brand"
      />
      <KpiCard
        label="Messages Sent"
        value={loading ? '—' : sent.toLocaleString('en-IN')}
        subtitle={loading ? undefined : `${opened.toLocaleString('en-IN')} opened`}
        tone="slate"
      />
    </div>
  );
}

function KpiCard({
  label, value, subtitle, tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone: 'slate' | 'emerald' | 'brand';
}) {
  const accent =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'brand'   ? 'text-brand-700' :
    'text-slate-900';
  return (
    <div className="card !p-4 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 truncate">{label}</div>
      <div className={`text-2xl font-bold tabular-nums truncate ${accent}`}>{value}</div>
      {subtitle && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{subtitle}</div>}
    </div>
  );
}

// ─── Recovery Activity table ────────────────────────────────────────────────

function RecoveryActivityTable({
  rows, loading, onRowClick,
}: {
  rows: ActivityRow[];
  loading: boolean;
  onRowClick: (r: ActivityRow) => void;
}) {
  if (loading && rows.length === 0) {
    return <div className="px-5 pb-6 text-sm text-slate-500">Loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="px-5 pb-8 pt-2 text-center">
        <div className="text-sm font-medium text-slate-700">No recovery activity yet.</div>
        <div className="text-xs text-slate-500 mt-1">
          When a customer abandons their cart and the delay elapses, the attempt will appear here.
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-y border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left px-4 py-3 font-semibold">Outcome</th>
            <th className="text-left px-4 py-3 font-semibold">Customer</th>
            <th className="text-left px-4 py-3 font-semibold">Cart</th>
            <th className="text-left px-4 py-3 font-semibold">Progress</th>
            <th className="text-left px-4 py-3 font-semibold">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr
              key={r.id}
              className="hover:bg-slate-50/70 cursor-pointer transition"
              onClick={() => onRowClick(r)}
            >
              <td className="px-4 py-3 whitespace-nowrap">
                <OutcomePill outcome={r.outcome} />
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">{r.customerName || '—'}</div>
                <div className="text-xs text-slate-500">{r.customerPhone || ''}</div>
              </td>
              <td className="px-4 py-3 min-w-[180px]">
                <div className="text-sm font-semibold tabular-nums text-slate-900">
                  {fmtINR(r.amount)}
                </div>
                {r.items ? (
                  <div className="text-xs text-slate-500 uppercase tracking-wide mt-0.5 truncate max-w-[260px]">
                    {r.items}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 mt-0.5">Cart</div>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-slate-700">{r.progress}</td>
              <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                {fmtAgo(r.abandonedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutcomePill({ outcome }: { outcome: ActivityRow['outcome'] }) {
  const meta =
    outcome === 'recovered' ? { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Recovered' } :
    outcome === 'failed'    ? { cls: 'bg-rose-50 text-rose-700 border-rose-200',          label: 'Failed' } :
                              { cls: 'bg-slate-50 text-slate-600 border-slate-200',       label: 'In Progress' };
  return (
    <span className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

// ─── Side-panel timeline drawer ─────────────────────────────────────────────

/**
 * Right-anchored slide-over panel showing the engagement timeline for a
 * single recovery row. Closes on backdrop click or Esc. MVP timeline:
 *   • Cart abandoned (at + cart items)
 *   • Recovery message sent (at)
 *   • Send failed (if error) OR Recovered (if payment captured)
 *
 * Future: stitch in the full event-stream join (page_view, book_click, …)
 * once the backend can join recovery attempts to the originating session.
 */
function TimelineDrawer({
  row, events, onClose,
}: {
  row: ActivityRow;
  events: { at: number | null; label: string; detail?: string }[];
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close timeline"
        className="absolute inset-0 bg-slate-900/30"
        onClick={onClose}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Recovery timeline"
        className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              Engagement timeline
            </div>
            <div className="font-semibold text-slate-900 truncate">
              {row.customerName || 'Unknown customer'}
            </div>
            <div className="text-xs text-slate-500 truncate">{row.customerPhone || ''}</div>
            <div className="mt-2 flex items-center gap-2">
              <OutcomePill outcome={row.outcome} />
              <span className="text-sm font-semibold tabular-nums text-slate-700">
                {fmtINR(row.amount)}
              </span>
            </div>
            {row.items && (
              <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-1 truncate">
                {row.items}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition shrink-0"
            aria-label="Close"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6"  y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {events.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-8">
              No events recorded yet.
            </div>
          ) : (
            <ol className="relative border-l border-slate-200 pl-4 space-y-4">
              {events.map((e, i) => (
                <li key={i} className="relative">
                  <span
                    className="absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white"
                    style={{ background: '#C1551A' }}
                  />
                  <div className="text-sm font-medium text-slate-900">{e.label}</div>
                  {e.detail && (
                    <div className="text-xs text-slate-500 mt-0.5">{e.detail}</div>
                  )}
                  <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
                    {fmtTimestamp(e.at)} · {fmtAgo(e.at)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 text-[11px] text-slate-400">
          Future: full session event-stream (page_view, ticket_selected, checkout_started, …).
        </footer>
      </aside>
    </div>
  );
}
