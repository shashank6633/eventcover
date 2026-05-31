'use client';

/**
 * Pure presentational KPI cards used on the Overview tab.
 *
 * Two strips:
 *   • Top: 5 cards — Page Views / Book Clicks / Checkouts / Successful / Failed
 *   • Bottom: 4 cards — Conversion Rate / Revenue / Active Carts / Expired
 *
 * Loading skeleton is rendered when `loading` is true; values are still
 * shown as '—' if a particular field is missing so cards don't disappear
 * during partial updates.
 */

import type { ReactNode } from 'react';

export interface KpiNumbers {
  pageViews: number;
  bookClicks: number;
  checkouts: number;
  successful: number;
  failed: number;
  conversionRate: number;   // percent, already multiplied by 100
  revenue: number;          // rupees (whole)
  activeCarts: number;
  activePending: number;    // subtitle "X pending"
  expired: number;
  expiredLost: number;      // rupees lost
}

function fmtNum(n: number | undefined): string {
  if (!Number.isFinite(n as number)) return '—';
  return (n as number).toLocaleString('en-IN');
}

function fmtPct(n: number | undefined, decimals = 2): string {
  if (!Number.isFinite(n as number)) return '—';
  return `${(n as number).toFixed(decimals)}%`;
}

function fmtINR(n: number | undefined): string {
  if (!Number.isFinite(n as number) || (n as number) < 0) return '—';
  return `₹${Math.round(n as number).toLocaleString('en-IN')}`;
}

interface Props {
  kpis: KpiNumbers | null;
  loading: boolean;
}

export function InsightsKpiCards({ kpis, loading }: Props) {
  const attempts = (kpis?.successful ?? 0) + (kpis?.failed ?? 0);
  const successPct = attempts > 0 ? ((kpis!.successful / attempts) * 100) : 0;
  const failedPct  = attempts > 0 ? ((kpis!.failed     / attempts) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* TOP STRIP — funnel volume */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card
          label="Page Views"
          value={loading ? '—' : fmtNum(kpis?.pageViews)}
          tone="slate"
        />
        <Card
          label="Book Clicks"
          value={loading ? '—' : fmtNum(kpis?.bookClicks)}
          tone="slate"
        />
        <Card
          label="Checkouts"
          value={loading ? '—' : fmtNum(kpis?.checkouts)}
          tone="slate"
        />
        <Card
          label="Successful"
          value={loading ? '—' : fmtNum(kpis?.successful)}
          subtitle={loading || attempts === 0 ? undefined : `(${successPct.toFixed(0)}%)`}
          tone="emerald"
        />
        <Card
          label="Failed"
          value={loading ? '—' : fmtNum(kpis?.failed)}
          subtitle={loading || attempts === 0 ? undefined : `(${failedPct.toFixed(0)}%)`}
          tone="rose"
        />
      </div>

      {/* BOTTOM STRIP — derived business metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          label="Conversion Rate"
          value={loading ? '—' : fmtPct(kpis?.conversionRate)}
          tone="brand"
        />
        <Card
          label="Revenue"
          value={loading ? '—' : fmtINR(kpis?.revenue)}
          tone="brand"
        />
        <Card
          label="Active Carts"
          value={loading ? '—' : fmtNum(kpis?.activeCarts)}
          subtitle={loading ? undefined : `${kpis?.activePending ?? 0} pending`}
          tone="amber"
        />
        <Card
          label="Expired"
          value={loading ? '—' : fmtNum(kpis?.expired)}
          subtitle={loading ? undefined : `${fmtINR(kpis?.expiredLost)} lost`}
          tone="rose"
        />
      </div>
    </div>
  );
}

function Card({
  label, value, subtitle, tone,
}: {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  tone: 'slate' | 'brand' | 'amber' | 'rose' | 'emerald';
}) {
  const accent =
    tone === 'brand'   ? 'text-brand-700' :
    tone === 'amber'   ? 'text-amber-700' :
    tone === 'rose'    ? 'text-rose-700' :
    tone === 'emerald' ? 'text-emerald-700' :
    'text-slate-900';
  return (
    <div className="card !p-4 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 truncate">{label}</div>
      <div className={`text-2xl font-bold tabular-nums truncate ${accent}`}>{value}</div>
      {subtitle && (
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">{subtitle}</div>
      )}
    </div>
  );
}
