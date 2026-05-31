'use client';

/**
 * AnalyticsDashboard — the "Dashboard" tab of /admin/analytics.
 *
 * Independent from the cashier-style Ledger tab (still owns the existing
 * page.tsx body). Pulls aggregates from /api/analytics/dashboard and
 * renders 4 headline KPI cards + 5 charts. All charts are inline SVG
 * (no external deps) using brand color #C1551A.
 *
 * The component manages its own range state. We also fetch the previous
 * comparable window so each KPI card can show a vs-previous-period
 * delta arrow (▲ green / ▼ rose).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCompactINR } from '@/lib/format';
import BarChart from '@/components/charts/BarChart';
import FunnelChart from '@/components/charts/FunnelChart';
import Heatmap from '@/components/charts/Heatmap';
import PieChart from '@/components/charts/PieChart';
import AffiliateBreakdown from '@/components/charts/AffiliateBreakdown';

const BRAND = '#C1551A';

// ─── shapes that mirror DashboardResult from src/lib/analytics-dashboard.ts ─

interface DashboardKpis {
  revenue: number;
  activeWallets: number;
  reservations: number;
  conversionRate: number | null;
}
interface RevenueByEventRow { eventId: string; name: string; eventDate: string; revenue: number; }
interface DashboardFunnel { clicks: number; reservations: number; wallets: number; }
interface AffiliateBreakdownApiRow {
  affiliateId: string; name: string; code: string;
  clicks: number; conversions: number; commissionTotal: number;
}
interface PeakHourHeatmap { matrix: number[][]; max: number; }
interface RepeatCustomers { newCount: number; repeatCount: number; total: number; }

interface DashboardResponse {
  ok: boolean;
  kpis: DashboardKpis;
  revenueByEvent: RevenueByEventRow[];
  funnel: DashboardFunnel;
  affiliateBreakdown: AffiliateBreakdownApiRow[];
  peakHourHeatmap: PeakHourHeatmap;
  repeatCustomers: RepeatCustomers;
  rangeFrom: number;
  rangeTo: number;
}

interface EventOption { id: string; name: string; event_date: string; }

type PresetKey = '7d' | '30d' | '90d' | 'ytd' | 'custom';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: '7d',  label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'ytd', label: 'YTD' },
];

// ─── helpers ───────────────────────────────────────────────────────────────

function resolvePreset(p: PresetKey, now = Date.now()): { from: number; to: number } {
  const to = now + 1000;
  if (p === '7d')  return { from: now - 7 * 86400e3, to };
  if (p === '30d') return { from: now - 30 * 86400e3, to };
  if (p === '90d') return { from: now - 90 * 86400e3, to };
  // YTD = Jan 1 in IST. India has no DST so a fixed offset works.
  const istNow = new Date(now);
  const fromUtc = Date.UTC(istNow.getUTCFullYear(), 0, 1, 0, 0, 0)
    - (5 * 60 + 30) * 60 * 1000;
  return { from: fromUtc, to };
}

function toDateInputUTC(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromDateInputUTC(s: string, endOfDay = false): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0).getTime();
}

function fmtPct(rate: number | null): string {
  if (rate == null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatRangeLabel(from: number, to: number): string {
  const f = (ms: number) => new Date(ms).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  return `${f(from)} – ${f(to)}`;
}

/** Compute the previous comparable window of the same length, ending at `from`. */
function previousWindow(from: number, to: number): { from: number; to: number } {
  const len = Math.max(1, to - from);
  return { from: from - len, to: from };
}

function delta(curr: number | null, prev: number | null): { dir: 'up' | 'down' | 'flat'; pct: number | null } {
  if (curr == null || prev == null) return { dir: 'flat', pct: null };
  if (prev === 0) {
    if (curr === 0) return { dir: 'flat', pct: 0 };
    return { dir: 'up', pct: null };
  }
  const change = (curr - prev) / Math.abs(prev);
  const pct = Math.round(change * 100);
  if (pct === 0) return { dir: 'flat', pct: 0 };
  return { dir: change > 0 ? 'up' : 'down', pct: Math.abs(pct) };
}

// ─── component ─────────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const initial = useMemo(() => resolvePreset('30d'), []);
  const [preset, setPreset] = useState<PresetKey>('30d');
  const [from, setFrom] = useState<number>(initial.from);
  const [to, setTo] = useState<number>(initial.to);
  const [editFrom, setEditFrom] = useState<string>(toDateInputUTC(initial.from));
  const [editTo, setEditTo] = useState<string>(toDateInputUTC(initial.to));
  const [showCustom, setShowCustom] = useState(false);

  const [eventId, setEventId] = useState<string>('all');
  const [events, setEvents] = useState<EventOption[]>([]);

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [prev, setPrev] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load event list once — for the filter dropdown.
  useEffect(() => {
    fetch('/api/events')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.events)) {
          setEvents(d.events.map((e: { id: string; name: string; event_date: string }) => ({
            id: e.id, name: e.name, event_date: e.event_date,
          })));
        }
      })
      .catch(() => { /* event filter is optional */ });
  }, []);

  const fetchDashboard = useCallback(() => {
    setLoading(true);
    setError(null);

    const make = (rangeFrom: number, rangeTo: number) => {
      const sp = new URLSearchParams();
      sp.set('from', String(rangeFrom));
      sp.set('to', String(rangeTo));
      if (eventId !== 'all') sp.set('eventId', eventId);
      return fetch(`/api/analytics/dashboard?${sp.toString()}`).then((r) => r.json());
    };

    const prevWindow = previousWindow(from, to);
    Promise.all([make(from, to), make(prevWindow.from, prevWindow.to)])
      .then(([curr, previous]: [DashboardResponse, DashboardResponse]) => {
        if (!curr?.ok) throw new Error('Could not load dashboard.');
        setData(curr);
        setPrev(previous?.ok ? previous : null);
      })
      .catch((e: Error) => {
        setError(e?.message || 'Could not load dashboard.');
        setData(null); setPrev(null);
      })
      .finally(() => setLoading(false));
  }, [from, to, eventId]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  function applyPreset(p: PresetKey) {
    setPreset(p);
    setShowCustom(false);
    const r = resolvePreset(p);
    setFrom(r.from); setTo(r.to);
    setEditFrom(toDateInputUTC(r.from));
    setEditTo(toDateInputUTC(r.to));
  }
  function applyCustom() {
    setPreset('custom');
    setFrom(fromDateInputUTC(editFrom));
    setTo(fromDateInputUTC(editTo, true));
    setShowCustom(false);
  }

  // ─── derived values for charts ──────────────────────────────────────────

  const revenueRows = useMemo(() => {
    if (!data) return [];
    return data.revenueByEvent.map((r) => ({ label: r.name || '—', value: r.revenue }));
  }, [data]);

  const funnelStages = useMemo(() => {
    if (!data) return [];
    // 4 stages: clicks → reservations → wallets → revenue-positive activity.
    // We approximate the 4th stage as "Active wallets" since payments/wallets
    // overlap and a fourth column from dashboard data is ambiguous.
    return [
      { label: 'Clicks',       value: data.funnel.clicks },
      { label: 'Reservations', value: data.funnel.reservations },
      { label: 'Wallets',      value: data.funnel.wallets },
      { label: 'Active Now',   value: data.kpis.activeWallets },
    ];
  }, [data]);

  const pieSegments = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Repeat', value: data.repeatCustomers.repeatCount, color: BRAND },
      { label: 'New',    value: data.repeatCustomers.newCount,    color: '#FCD7BD' },
    ];
  }, [data]);

  // ─── render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Filter row */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                preset === p.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowCustom((v) => !v)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              preset === 'custom'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Custom
          </button>
        </div>

        <div className="text-sm text-slate-600">{formatRangeLabel(from, to)}</div>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-slate-500">Event</label>
          <select
            className="input"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="all">All events</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} {ev.event_date ? `· ${ev.event_date}` : ''}
              </option>
            ))}
          </select>
        </div>

        {showCustom && (
          <div className="w-full flex flex-wrap items-end gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div>
              <label className="label">From</label>
              <input type="date" className="input" value={editFrom} max={editTo}
                     onChange={(e) => setEditFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input" value={editTo} min={editFrom}
                     onChange={(e) => setEditTo(e.target.value)} />
            </div>
            <button type="button" onClick={applyCustom} className="btn btn-primary">Apply</button>
            <button type="button" onClick={() => setShowCustom(false)} className="btn btn-secondary">Cancel</button>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="card p-4 border border-rose-200 bg-rose-50 flex items-center gap-3">
          <span className="text-rose-700 text-sm flex-1">{error}</span>
          <button type="button" onClick={fetchDashboard} className="btn btn-secondary">Retry</button>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Revenue"
          icon={<IconCash />}
          value={data ? formatCompactINR(data.kpis.revenue) : null}
          delta={delta(data?.kpis.revenue ?? null, prev?.kpis.revenue ?? null)}
          loading={loading && !data}
        />
        <KpiCard
          label="Active Wallets"
          icon={<IconWallet />}
          value={data ? data.kpis.activeWallets.toLocaleString('en-IN') : null}
          delta={delta(data?.kpis.activeWallets ?? null, prev?.kpis.activeWallets ?? null)}
          loading={loading && !data}
        />
        <KpiCard
          label="Reservations"
          icon={<IconInbox />}
          value={data ? data.kpis.reservations.toLocaleString('en-IN') : null}
          delta={delta(data?.kpis.reservations ?? null, prev?.kpis.reservations ?? null)}
          loading={loading && !data}
        />
        <KpiCard
          label="Conversion"
          icon={<IconTrend />}
          value={data ? fmtPct(data.kpis.conversionRate) : null}
          delta={delta(
            data?.kpis.conversionRate ?? null,
            prev?.kpis.conversionRate ?? null,
          )}
          loading={loading && !data}
          formatDelta={(d) => d.pct == null ? '' : `${d.pct} pp`}
        />
      </div>

      {/* Revenue by event */}
      <div className="card p-5">
        <CardHeader title="Revenue by event" caption="Top 10 by combined wallet + ticket + payment revenue." />
        {loading && !data ? (
          <SkeletonRows rows={6} />
        ) : (
          <BarChart
            data={revenueRows}
            color={BRAND}
            formatValue={(n) => formatCompactINR(n)}
          />
        )}
      </div>

      {/* Funnel — full width row */}
      <div className="card p-5">
        <CardHeader title="Conversion funnel" caption="Clicks → reservations → wallets → currently active." />
        {loading && !data ? (
          <SkeletonRows rows={4} />
        ) : (
          <FunnelChart stages={funnelStages} color={BRAND} />
        )}
      </div>

      {/* Two-column: Affiliate | Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-5">
          <CardHeader title="Top affiliates" caption="Clicks, conversions, commission earned in range." />
          {loading && !data ? (
            <SkeletonRows rows={5} />
          ) : (
            <AffiliateBreakdown rows={data?.affiliateBreakdown ?? []} color={BRAND} />
          )}
        </div>
        <div className="card p-5">
          <CardHeader title="Peak hours" caption="Wallet issuances by day-of-week × hour (IST)." />
          {loading && !data ? (
            <SkeletonRows rows={7} />
          ) : (
            <Heatmap
              matrix={data?.peakHourHeatmap.matrix ?? []}
              max={data?.peakHourHeatmap.max ?? 0}
              color={BRAND}
            />
          )}
        </div>
      </div>

      {/* Repeat customer pie */}
      <div className="card p-5">
        <CardHeader title="Repeat customers" caption="Guests with ≥2 lifetime visits vs first-timers in range." />
        {loading && !data ? (
          <SkeletonRows rows={3} />
        ) : (
          <PieChart segments={pieSegments} size={180} innerRadiusRatio={0.55} />
        )}
      </div>

      {/* Empty hint shown only when fully loaded + everything is zero */}
      {!loading && data && data.kpis.revenue === 0 && data.funnel.clicks === 0 && data.funnel.reservations === 0 && data.funnel.wallets === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">
          <div className="text-2xl mb-1">📊</div>
          No activity in this window yet. Try a longer range or check back after the next event.
        </div>
      )}
    </div>
  );
}

// ─── sub-components ────────────────────────────────────────────────────────

function CardHeader({ title, caption }: { title: string; caption?: string }) {
  return (
    <div className="mb-4">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {caption && <div className="text-xs text-slate-500 mt-0.5">{caption}</div>}
    </div>
  );
}

interface DeltaInfo { dir: 'up' | 'down' | 'flat'; pct: number | null }

function KpiCard({
  label, value, icon, delta, loading, formatDelta,
}: {
  label: string;
  value: string | null;
  icon: React.ReactNode;
  delta: DeltaInfo;
  loading: boolean;
  formatDelta?: (d: DeltaInfo) => string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] uppercase tracking-widest text-slate-500">{label}</div>
        <div
          className="rounded-lg p-1.5"
          style={{ backgroundColor: '#FBE9DC' /* brand-50 tint */, color: BRAND }}
        >
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-2">
        {loading ? <SkeletonBlock width="60%" height={28} /> : (value ?? '—')}
      </div>
      <div className="mt-1 h-4 text-xs">
        {loading || delta.pct == null ? (
          <span className="text-slate-300">vs previous —</span>
        ) : delta.dir === 'flat' ? (
          <span className="text-slate-400">vs previous · no change</span>
        ) : delta.dir === 'up' ? (
          <span className="text-emerald-600 font-medium">
            ▲ {formatDelta ? formatDelta(delta) : `${delta.pct}%`} vs previous
          </span>
        ) : (
          <span className="text-rose-600 font-medium">
            ▼ {formatDelta ? formatDelta(delta) : `${delta.pct}%`} vs previous
          </span>
        )}
      </div>
    </div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} width="100%" height={20} />
      ))}
    </div>
  );
}

function SkeletonBlock({ width, height }: { width: number | string; height: number }) {
  return (
    <div
      className="rounded-md bg-slate-100 animate-pulse"
      style={{ width, height }}
    />
  );
}

// ─── tiny icons ────────────────────────────────────────────────────────────

function IconCash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}
function IconWallet() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" />
      <circle cx="17" cy="13" r="1" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}
function IconTrend() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
