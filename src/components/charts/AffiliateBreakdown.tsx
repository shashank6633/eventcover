'use client';

import { formatCompactINR } from '@/lib/format';

/**
 * Top-affiliates list. Each row: name + code, conv/clicks ratio, INR
 * commission total, and an inline progress bar showing conversion rate.
 *
 * Composite "chart" — uses div widths instead of an SVG so the bars
 * stay aligned with the surrounding card padding. Brand color #C1551A.
 */

export interface AffiliateRow {
  name: string;
  code: string;
  clicks: number;
  conversions: number;
  commissionTotal: number;
}

interface Props {
  rows: AffiliateRow[];
  color?: string;
}

export default function AffiliateBreakdown({ rows, color = '#C1551A' }: Props) {
  if (!rows || rows.length === 0) {
    return (
      <div className="text-sm text-slate-400 py-6 text-center">
        No affiliate activity in this range.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const rate = r.clicks > 0 ? Math.min(1, r.conversions / r.clicks) : 0;
        const ratePct = Math.round(rate * 100);
        return (
          <li key={`${r.code}`} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-slate-900 truncate min-w-0">{r.name}</span>
              <span className="text-[10px] tracking-widest uppercase text-slate-400 font-mono">{r.code}</span>
              <span className="ml-auto text-sm font-semibold text-slate-900">
                {formatCompactINR(r.commissionTotal)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${ratePct}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-[11px] text-slate-500 w-28 text-right whitespace-nowrap">
                {r.conversions.toLocaleString('en-IN')} / {r.clicks.toLocaleString('en-IN')} ({ratePct}%)
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
