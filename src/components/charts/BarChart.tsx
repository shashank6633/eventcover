'use client';

/**
 * Horizontal bar chart — zero deps, inline SVG.
 * Used for "Revenue by Event" on the analytics dashboard.
 *
 * Each row: <label>  ████████████  <value>
 */

export interface BarDatum {
  label: string;
  value: number;
}

interface Props {
  data: BarDatum[];
  /** Override the max scale; defaults to the largest value in `data`. */
  max?: number;
  color?: string;
  /** Row height in px. */
  rowHeight?: number;
  /** Bar height in px (visual thickness inside the row). */
  barHeight?: number;
  formatValue?: (n: number) => string;
}

export default function BarChart({
  data,
  max,
  color = '#C1551A',
  rowHeight = 38,
  barHeight = 18,
  formatValue = (n) => String(n),
}: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-slate-400 py-6 text-center">
        No data in this range.
      </div>
    );
  }

  const peak = Math.max(1, max ?? Math.max(...data.map((d) => d.value || 0)));
  const labelColWidth = 160;
  const valueColWidth = 90;
  const barAreaWidth = 100; // viewBox is %-based for responsive scaling
  const totalWidth = labelColWidth + barAreaWidth + valueColWidth;
  const height = data.length * rowHeight + 8;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        role="img"
        aria-label="Revenue by event"
        viewBox={`0 0 ${totalWidth} ${height}`}
        preserveAspectRatio="xMinYMid meet"
        className="w-full"
        style={{ minWidth: 360, maxHeight: height + 20 }}
      >
        {data.map((d, i) => {
          const y = i * rowHeight + 4;
          const ratio = peak > 0 ? Math.max(0.005, (d.value || 0) / peak) : 0;
          const barWidth = ratio * barAreaWidth;
          const barY = y + (rowHeight - barHeight) / 2;

          return (
            <g key={`${d.label}-${i}`}>
              {/* label */}
              <text
                x={labelColWidth - 8}
                y={y + rowHeight / 2}
                fontSize="11"
                fill="#475569"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {truncate(d.label, 22)}
              </text>
              {/* track */}
              <rect
                x={labelColWidth}
                y={barY}
                width={barAreaWidth}
                height={barHeight}
                rx={3}
                fill="#F1F5F9"
              />
              {/* bar */}
              <rect
                x={labelColWidth}
                y={barY}
                width={barWidth}
                height={barHeight}
                rx={3}
                fill={color}
              >
                <title>{`${d.label}: ${formatValue(d.value)}`}</title>
              </rect>
              {/* value */}
              <text
                x={labelColWidth + barAreaWidth + 6}
                y={y + rowHeight / 2}
                fontSize="11"
                fill="#0F172A"
                fontWeight={600}
                dominantBaseline="middle"
              >
                {formatValue(d.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
