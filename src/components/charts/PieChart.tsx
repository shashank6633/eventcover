'use client';

/**
 * Donut / pie chart — zero deps, inline SVG.
 * Computes cumulative angles and emits one <path> per segment using SVG
 * arcs. Set innerRadiusRatio=0 for a filled pie; >0 for a donut.
 */

export interface PieSegment {
  label: string;
  value: number;
  color: string;
}

interface Props {
  segments: PieSegment[];
  size?: number;
  innerRadiusRatio?: number;
  /** When all values are 0, render this hint instead of an empty circle. */
  emptyHint?: string;
}

export default function PieChart({
  segments,
  size = 180,
  innerRadiusRatio = 0.55,
  emptyHint = 'No data yet.',
}: Props) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);

  if (total <= 0) {
    return (
      <div className="text-sm text-slate-400 py-6 text-center">{emptyHint}</div>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 2;
  const innerR = innerRadiusRatio > 0 ? r * innerRadiusRatio : 0;

  let acc = 0;
  // Special-case: single non-zero segment renders as a full ring (SVG
  // arcs can't draw a full 360° in one go without a glitch).
  const nonZero = segments.filter((s) => (s.value || 0) > 0);
  const singleSegment = nonZero.length === 1;

  return (
    <div className="flex items-center gap-4">
      <svg
        role="img"
        aria-label="Repeat customer breakdown"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
      >
        {singleSegment ? (
          <>
            <circle cx={cx} cy={cy} r={r} fill={nonZero[0].color}>
              <title>{`${nonZero[0].label}: ${nonZero[0].value}`}</title>
            </circle>
            {innerR > 0 && <circle cx={cx} cy={cy} r={innerR} fill="white" />}
          </>
        ) : (
          segments.map((s, i) => {
            const value = s.value || 0;
            if (value <= 0) return null;
            const startAngle = (acc / total) * 2 * Math.PI;
            acc += value;
            const endAngle = (acc / total) * 2 * Math.PI;
            const d = arcPath(cx, cy, r, innerR, startAngle, endAngle);
            return (
              <path key={`${s.label}-${i}`} d={d} fill={s.color}>
                <title>{`${s.label}: ${value} (${pct(value, total)}%)`}</title>
              </path>
            );
          })
        )}
      </svg>
      <ul className="flex-1 flex flex-col gap-2 text-sm min-w-0">
        {segments.map((s, i) => (
          <li key={`${s.label}-${i}`} className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden
              className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-slate-700 truncate">{s.label}</span>
            <span className="text-slate-400 ml-auto whitespace-nowrap">
              {s.value.toLocaleString('en-IN')} · {pct(s.value || 0, total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function pct(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

/**
 * Build an SVG path describing a donut/pie wedge.
 * Returns an annular wedge when innerR > 0, otherwise a pie slice.
 *
 * Angles are clockwise starting from 12 o'clock (subtracts π/2).
 */
function arcPath(cx: number, cy: number, r: number, innerR: number, startAngle: number, endAngle: number): string {
  // Shift so 0 rad is 12 o'clock instead of 3 o'clock.
  const a0 = startAngle - Math.PI / 2;
  const a1 = endAngle - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  if (innerR <= 0) {
    return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`;
  }
  const xi1 = cx + innerR * Math.cos(a1);
  const yi1 = cy + innerR * Math.sin(a1);
  const xi0 = cx + innerR * Math.cos(a0);
  const yi0 = cy + innerR * Math.sin(a0);
  return [
    `M ${x0} ${y0}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`,
    `L ${xi1} ${yi1}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${xi0} ${yi0}`,
    'Z',
  ].join(' ');
}
