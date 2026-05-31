'use client';

/**
 * 7×24 heatmap (day-of-week × hour-of-day) — inline SVG, zero deps.
 * Alpha is value/max with a 0.05 floor so populated cells stay visible.
 */

interface Props {
  /** matrix[dow][hour] → count. dow=0 ⇒ Sunday, matching SQLite strftime('%w'). */
  matrix: number[][];
  /** Highest value across all cells. 0 ⇒ "no data". */
  max: number;
  color?: string;
  rowLabels?: string[];
  colLabels?: string[];
}

const DOW_DEFAULT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Heatmap({
  matrix,
  max,
  color = '#C1551A',
  rowLabels = DOW_DEFAULT,
  colLabels,
}: Props) {
  if (!matrix || matrix.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">No activity yet.</div>;
  }

  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;

  const cellW = 20;
  const cellH = 20;
  const gap = 2;
  const labelW = 36;
  const labelH = 18;
  const width = labelW + cols * (cellW + gap);
  const height = labelH + rows * (cellH + gap);

  const labels = colLabels ?? Array.from({ length: cols }, (_, i) => String(i).padStart(2, '0'));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        role="img"
        aria-label="Peak-hour activity heatmap"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMin meet"
        className="block"
        style={{ minWidth: 560, maxWidth: '100%', height: 'auto' }}
      >
        {/* col headers — show every 3 hours to avoid crowding */}
        {labels.map((lbl, c) => (
          <text
            key={`col-${c}`}
            x={labelW + c * (cellW + gap) + cellW / 2}
            y={labelH - 4}
            fontSize="9"
            fill="#94A3B8"
            textAnchor="middle"
          >
            {c % 3 === 0 ? lbl : ''}
          </text>
        ))}
        {/* row labels */}
        {rowLabels.map((lbl, r) => (
          <text
            key={`row-${r}`}
            x={labelW - 6}
            y={labelH + r * (cellH + gap) + cellH / 2}
            fontSize="10"
            fill="#475569"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {lbl}
          </text>
        ))}
        {/* cells */}
        {matrix.map((row, r) =>
          row.map((v, c) => {
            const ratio = max > 0 ? (v || 0) / max : 0;
            const alpha = v > 0 ? Math.max(0.08, ratio) : 0;
            return (
              <rect
                key={`cell-${r}-${c}`}
                x={labelW + c * (cellW + gap)}
                y={labelH + r * (cellH + gap)}
                width={cellW}
                height={cellH}
                rx={3}
                fill={v > 0 ? color : '#F1F5F9'}
                fillOpacity={v > 0 ? alpha : 1}
              >
                <title>{`${rowLabels[r]} ${String(c).padStart(2, '0')}:00 — ${v} issues`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      {max > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-2">
          <span>Less</span>
          <div className="flex items-center gap-1">
            {[0.1, 0.3, 0.55, 0.8, 1].map((a) => (
              <span
                key={a}
                className="inline-block rounded-sm"
                style={{ width: 12, height: 12, backgroundColor: color, opacity: a }}
              />
            ))}
          </div>
          <span>More</span>
          <span className="ml-3">Peak: {max}/hr</span>
        </div>
      )}
    </div>
  );
}
