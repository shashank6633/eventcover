'use client';

/**
 * Overview tab.
 *
 * Renders:
 *   • 5+4 KPI strip
 *   • "Views & Conversions" daily line chart (inline SVG, two series)
 *   • "Conversion Funnel" — 6-stage horizontal bars with drop-off % between
 *     each. Each row has a colored left border keyed to the stage category
 *     so the host can scan top→bottom without reading every label.
 *   • Insights v2 widgets:
 *       - Traffic Sources (top 10, horizontal bars)
 *       - Ticket Popularity (top 10, horizontal bars, brand-rust)
 *       - Page Scroll Depth (25 / 50 / 75 / 100% cards with progress bars)
 *
 * Data is fetched from /api/events/[id]/insights?range=... built by the
 * other dev. The contract is documented in the brief — we tolerate missing
 * fields by falling back to 0 / empty arrays so the dashboard never
 * crashes if the backend ships a partial shape during incremental rollout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { InsightsKpiCards, type KpiNumbers } from './InsightsKpiCards';
import type { InsightsRange } from './InsightsShell';

interface InsightsResponse {
  ok: boolean;
  kpis?: Partial<KpiNumbers> & {
    ticketSelected?: number;
    checkoutStarted?: number;
    paymentInitiated?: number;
    checkoutSuccess?: number;
    checkoutFailed?: number;
    expiredLost?: number;
    activePending?: number;
  };
  funnel?: { stage: string; count: number; dropOffPct?: number }[];
  dailySeries?: { date: string; pageViews: number; success: number }[];
  trafficSources?: { source: string; count: number }[];
  ticketPopularity?: { label: string; count: number }[];
  scrollDepth?: { 25: number; 50: number; 75: number; 100: number };
  message?: string;
}

interface FunnelStage {
  stageKey: string;
  stage: string;
  count: number;
  dropOffPct: number; // already computed by backend; we recompute as fallback
}

const STAGE_LABELS: Record<string, string> = {
  page_view: 'Page Viewed',
  book_click: 'Book Clicked',
  ticket_selected: 'Ticket Selected',
  checkout_started: 'Checkout Started',
  payment_initiated: 'Payment Initiated',
  checkout_success: 'Payment Success',
};

// Color (hex) used for the LEFT BORDER of each funnel stage card. Same
// palette the v2 reference screenshots use — slate → indigo → sky → amber
// → emerald → brand-rust as the customer progresses toward conversion.
const STAGE_ACCENT: Record<string, string> = {
  page_view:         '#64748B', // slate-500
  book_click:        '#6366F1', // indigo-500
  ticket_selected:   '#0EA5E9', // sky-500
  checkout_started:  '#F59E0B', // amber-500
  payment_initiated: '#10B981', // emerald-500
  checkout_success:  '#C1551A', // brand-rust
};

const STAGE_ORDER = [
  'page_view',
  'book_click',
  'ticket_selected',
  'checkout_started',
  'payment_initiated',
  'checkout_success',
];

export function OverviewTab({ eventId, range }: { eventId: string; range: InsightsRange }) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`/api/events/${encodeURIComponent(eventId)}/insights`, window.location.origin);
      url.searchParams.set('range', range);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      // Graceful fallback during backend rollout: a 404 means the API hasn't
      // shipped yet — render the empty shell rather than blowing up.
      if (res.status === 404) {
        setData({ ok: true, kpis: {}, funnel: [], dailySeries: [] });
        return;
      }
      const d: InsightsResponse = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load insights.');
        return;
      }
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [eventId, range]);

  useEffect(() => { void load(); }, [load]);

  // Normalise backend kpis into the KpiNumbers shape used by the strip.
  // Several alias names are accepted because the contract has two slightly
  // overlapping shapes in the spec ("checkouts" vs "checkoutStarted" etc).
  const kpis: KpiNumbers | null = useMemo(() => {
    if (!data?.kpis) return null;
    const k = data.kpis;
    return {
      pageViews:       Number(k.pageViews ?? 0),
      bookClicks:      Number(k.bookClicks ?? 0),
      checkouts:       Number(k.checkouts ?? k.checkoutStarted ?? 0),
      successful:      Number(k.successful ?? k.checkoutSuccess ?? 0),
      failed:          Number(k.failed ?? k.checkoutFailed ?? 0),
      conversionRate:  Number(k.conversionRate ?? 0),
      revenue:         Number(k.revenue ?? 0),
      activeCarts:     Number(k.activeCarts ?? 0),
      activePending:   Number(k.activePending ?? k.activeCarts ?? 0),
      expired:         Number(k.expired ?? 0),
      expiredLost:     Number(k.expiredLost ?? 0),
    };
  }, [data]);

  // Build funnel stages in the canonical order — pad missing stages with 0
  // so the bars render in the right slot even if the backend omits a kind.
  const funnel: FunnelStage[] = useMemo(() => {
    const byStage = new Map<string, number>();
    (data?.funnel || []).forEach((s) => byStage.set(s.stage, s.count));
    const stages = STAGE_ORDER.map((k) => ({
      stageKey: k,
      stage: STAGE_LABELS[k] ?? k,
      count: byStage.get(k) ?? 0,
      dropOffPct: 0,
    }));
    // Compute drop-off as % decline from previous non-zero stage. Backend may
    // already supply this; we recompute either way so the UI is consistent.
    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1].count;
      const cur  = stages[i].count;
      stages[i].dropOffPct = prev > 0 ? Math.max(0, ((prev - cur) / prev) * 100) : 0;
    }
    return stages;
  }, [data]);

  const series = data?.dailySeries || [];
  const trafficSources = data?.trafficSources || [];
  const ticketPopularity = data?.ticketPopularity || [];
  const scrollDepth = data?.scrollDepth || { 25: 0, 50: 0, 75: 0, 100: 0 };
  const totalPageViews = Number(data?.kpis?.pageViews ?? 0);

  return (
    <div className="space-y-5">
      <InsightsKpiCards kpis={kpis} loading={loading} />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Views & Conversions chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Views & Conversions</h2>
            <p className="text-xs text-slate-500 mt-0.5">Daily page views vs. successful checkouts.</p>
          </div>
          <Legend />
        </div>
        <ViewsLineChart series={series} loading={loading} />
      </div>

      {/* Conversion Funnel */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Conversion Funnel</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Drop-off between funnel stages — narrower bars mean steeper loss.
            </p>
          </div>
        </div>
        <ConversionFunnel stages={funnel} loading={loading} />
      </div>

      {/* Traffic Sources + Ticket Popularity row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <TrafficSourcesCard rows={trafficSources} loading={loading} />
        <TicketPopularityCard rows={ticketPopularity} loading={loading} />
      </div>

      {/* Page Scroll Depth */}
      <ScrollDepthCard counts={scrollDepth} totalPageViews={totalPageViews} loading={loading} />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-2 rounded-full bg-slate-700"/>Page Views
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-2 rounded-full" style={{ background: '#C1551A' }}/>Successful
      </span>
    </div>
  );
}

/**
 * Inline SVG line chart — two series sharing a single Y axis.
 *
 * Y-axis scale is the max of either series so the absolute Page-View line
 * doesn't dwarf the Successful line into invisibility. Empty / loading
 * states render a placeholder gridline pattern.
 */
function ViewsLineChart({ series, loading }: { series: { date: string; pageViews: number; success: number }[]; loading: boolean }) {
  const W = 640;
  const H = 220;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  if (loading) {
    return (
      <div className="text-sm text-slate-400 text-center py-12">Loading chart…</div>
    );
  }
  if (!series.length) {
    return (
      <div className="text-sm text-slate-400 text-center py-12">
        No data yet for this range. Once visitors hit the public event page, you’ll see traffic land here.
      </div>
    );
  }

  const max = Math.max(1, ...series.map((p) => Math.max(p.pageViews, p.success)));
  const xStep = series.length > 1 ? innerW / (series.length - 1) : innerW;

  const buildPath = (key: 'pageViews' | 'success') =>
    series.map((p, i) => {
      const x = PAD_L + i * xStep;
      const y = PAD_T + innerH - (p[key] / max) * innerH;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');

  // Horizontal gridlines at 0/25/50/75/100% of max
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const y = PAD_T + innerH - p * innerH;
    const val = Math.round(max * p);
    return { y, val };
  });

  // X tick labels — show at most 7 for readability
  const tickEvery = Math.max(1, Math.ceil(series.length / 7));

  return (
    <div className="w-full overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily views and conversions">
        {/* Y gridlines + labels */}
        {gridLines.map((g, idx) => (
          <g key={idx}>
            <line x1={PAD_L} x2={W - PAD_R} y1={g.y} y2={g.y} stroke="#E5E7EB" strokeWidth="1" />
            <text x={PAD_L - 6} y={g.y + 3} textAnchor="end" fontSize="10" fill="#94A3B8">{g.val}</text>
          </g>
        ))}
        {/* Page Views line */}
        <path d={buildPath('pageViews')} fill="none" stroke="#0F172A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        {/* Successful line */}
        <path d={buildPath('success')} fill="none" stroke="#C1551A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        {/* Dots on each data point */}
        {series.map((p, i) => {
          const x = PAD_L + i * xStep;
          const yPv = PAD_T + innerH - (p.pageViews / max) * innerH;
          const ySu = PAD_T + innerH - (p.success   / max) * innerH;
          return (
            <g key={p.date}>
              <circle cx={x} cy={yPv} r="2.5" fill="#0F172A"/>
              <circle cx={x} cy={ySu} r="2.5" fill="#C1551A"/>
              {i % tickEvery === 0 && (
                <text x={x} y={H - 10} textAnchor="middle" fontSize="10" fill="#64748B">
                  {shortDate(p.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function shortDate(iso: string): string {
  // Accept either yyyy-mm-dd or full ISO; show dd MMM
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/**
 * Vertical funnel — each row is a horizontal bar whose width is proportional
 * to the maximum stage. Between adjacent stages we surface drop-off % in
 * red so the host can see where to put their effort.
 *
 * Insights v2: each row carries a colored left border matching its stage
 * category (slate → indigo → sky → amber → emerald → brand-rust) so the
 * funnel is scannable without reading each label.
 */
function ConversionFunnel({ stages, loading }: { stages: FunnelStage[]; loading: boolean }) {
  if (loading) {
    return <div className="text-sm text-slate-400 text-center py-12">Loading funnel…</div>;
  }
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct = (s.count / max) * 100;
        const accent = STAGE_ACCENT[s.stageKey] ?? '#C1551A';
        return (
          <div key={s.stageKey}>
            <div
              className="flex items-center gap-3 rounded-md border border-slate-100 bg-white pl-2 pr-1 py-1.5"
              style={{ borderLeft: `4px solid ${accent}` }}
            >
              {/* Stage label column */}
              <div className="w-32 sm:w-40 text-xs font-medium text-slate-700 truncate">{s.stage}</div>
              {/* Bar */}
              <div className="flex-1 h-7 rounded-md bg-slate-50 relative overflow-hidden border border-slate-100">
                <div
                  className="absolute inset-y-0 left-0 rounded-md"
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    background: accent,
                    opacity: 0.85,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-end pr-3 text-xs font-semibold text-slate-800 tabular-nums">
                  {s.count.toLocaleString('en-IN')}
                </div>
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className="ml-2 pl-3 mt-1 mb-1 flex items-center gap-1 text-[11px] text-rose-600 font-medium tabular-nums">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                {s.dropOffPct === 0 && stages[i].count === 0 ? '—' : `-${s.dropOffPct.toFixed(2)}%`} drop-off
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Insights v2 widgets ────────────────────────────────────────────────────

/**
 * Traffic Sources card — horizontal bar list of (referrer host / utm source)
 * with counts. Falls back to a small bar-chart icon + empty copy when
 * nothing has been collected yet so the card slot doesn't disappear during
 * the first hours of the rollout.
 */
function TrafficSourcesCard({
  rows, loading,
}: { rows: { source: string; count: number }[]; loading: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-slate-900">Traffic Sources</h2>
        <p className="text-xs text-slate-500 mt-0.5">Where your visitors are coming from.</p>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400 text-center py-8">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyChart message="No traffic source data yet" />
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => {
            const pct = Math.max(4, (r.count / max) * 100);
            return (
              <li key={r.source} className="flex items-center gap-3">
                <div className="w-32 sm:w-40 text-xs font-medium text-slate-700 truncate" title={r.source}>
                  {r.source}
                </div>
                <div className="flex-1 h-6 rounded-md bg-slate-50 relative overflow-hidden border border-slate-100">
                  <div
                    className="absolute inset-y-0 left-0 rounded-md"
                    style={{ width: `${pct}%`, background: '#0F172A', opacity: 0.78 }}
                  />
                </div>
                <div className="w-10 text-right text-xs font-semibold tabular-nums text-slate-800">
                  {r.count.toLocaleString('en-IN')}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * Ticket Popularity card — same horizontal-bar pattern as Traffic Sources,
 * but painted brand-rust so the two cards in the same row are visually
 * distinct. Reads from /api/events/[id]/insights → ticketPopularity which
 * groups ticket_selected events by metadata.ticketType (or zoneName).
 */
function TicketPopularityCard({
  rows, loading,
}: { rows: { label: string; count: number }[]; loading: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-slate-900">Ticket Popularity</h2>
        <p className="text-xs text-slate-500 mt-0.5">Which options your audience prefers.</p>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400 text-center py-8">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyChart message="No ticket selections yet" />
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => {
            const pct = Math.max(4, (r.count / max) * 100);
            return (
              <li key={r.label} className="flex items-center gap-3">
                <div className="w-32 sm:w-40 text-xs font-medium text-slate-700 truncate" title={r.label}>
                  {r.label}
                </div>
                <div className="flex-1 h-6 rounded-md bg-slate-50 relative overflow-hidden border border-slate-100">
                  <div
                    className="absolute inset-y-0 left-0 rounded-md"
                    style={{ width: `${pct}%`, background: '#C1551A', opacity: 0.85 }}
                  />
                </div>
                <div className="w-10 text-right text-xs font-semibold tabular-nums text-slate-800">
                  {r.count.toLocaleString('en-IN')}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * Page Scroll Depth — 4 cards (25/50/75/100%). Each card shows the unique
 * sessions that reached that depth + a thin indigo progress bar
 * representing depth-reached / total-pageviews. When totalPageViews=0 the
 * bar is blank (we don't divide by zero).
 */
function ScrollDepthCard({
  counts, totalPageViews, loading,
}: {
  counts: { 25: number; 50: number; 75: number; 100: number };
  totalPageViews: number;
  loading: boolean;
}) {
  const thresholds: (25 | 50 | 75 | 100)[] = [25, 50, 75, 100];
  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-slate-900">Page Scroll Depth</h2>
        <p className="text-xs text-slate-500 mt-0.5">How far visitors scroll on your event page.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {thresholds.map((pct) => {
          const count = counts[pct] ?? 0;
          const barPct = totalPageViews > 0
            ? Math.min(100, Math.max(0, (count / totalPageViews) * 100))
            : 0;
          return (
            <div
              key={pct}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="text-[10px] uppercase tracking-widest text-slate-500">
                Scrolled to {pct}%
              </div>
              <div className="text-2xl font-bold tabular-nums text-slate-900 mt-1">
                {loading ? '—' : count.toLocaleString('en-IN')}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${barPct}%`, background: '#6366F1' }}
                />
              </div>
              <div className="text-[10px] text-slate-400 mt-1 tabular-nums">
                {totalPageViews > 0
                  ? `${barPct.toFixed(0)}% of ${totalPageViews.toLocaleString('en-IN')} views`
                  : 'No views in range'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="12" y1="20" x2="12" y2="10"/>
        <line x1="18" y1="20" x2="18" y2="4"/>
        <line x1="6"  y1="20" x2="6"  y2="14"/>
        <line x1="3"  y1="20" x2="21" y2="20"/>
      </svg>
      <div className="text-sm mt-2">{message}</div>
    </div>
  );
}
