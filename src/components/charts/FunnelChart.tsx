'use client';

/**
 * Conversion funnel — stacked horizontal trapezoids.
 * Each stage's width is its value relative to the top stage (= 100%).
 * Drop-off % is shown to the right of each stage after the first.
 */

export interface FunnelStage {
  label: string;
  value: number;
}

interface Props {
  stages: FunnelStage[];
  color?: string;
  /** Formatter for the raw value chip on each row. */
  formatValue?: (n: number) => string;
}

export default function FunnelChart({
  stages,
  color = '#C1551A',
  formatValue = (n) => n.toLocaleString('en-IN'),
}: Props) {
  if (!stages || stages.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">No funnel data.</div>;
  }

  const top = Math.max(1, stages[0]?.value || 0);
  const opacities = [0.95, 0.78, 0.6, 0.45];

  return (
    <div className="flex flex-col gap-2">
      {stages.map((s, i) => {
        const value = s.value || 0;
        const ratio = top > 0 ? Math.max(0.02, value / top) : 0;
        const widthPct = Math.round(ratio * 100);
        const prevVal = i === 0 ? null : (stages[i - 1]?.value || 0);
        const conversion = prevVal == null
          ? null
          : (prevVal > 0 ? Math.round((value / prevVal) * 100) : 0);
        const fill = color;
        const opacity = opacities[Math.min(i, opacities.length - 1)];

        return (
          <div key={`${s.label}-${i}`} className="flex items-center gap-3">
            <div className="w-28 text-sm text-slate-700 font-medium truncate">{s.label}</div>
            <div className="flex-1 relative h-9 bg-slate-50 rounded-md overflow-hidden">
              <div
                className="h-full rounded-md transition-all"
                style={{ width: `${widthPct}%`, backgroundColor: fill, opacity }}
              />
              <div className="absolute inset-0 flex items-center px-3 text-xs font-semibold">
                <span className="text-white drop-shadow-sm">
                  {formatValue(value)}
                </span>
              </div>
            </div>
            <div className="w-20 text-xs text-right">
              {conversion == null ? (
                <span className="text-slate-400">—</span>
              ) : (
                <span className={conversion >= 50 ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                  {conversion}%
                </span>
              )}
            </div>
          </div>
        );
      })}
      <div className="text-[11px] text-slate-400 mt-1">
        Right column = conversion from previous stage.
      </div>
    </div>
  );
}
