'use client';

/**
 * Generic "Coming soon" card used by sections planned for Phase 2-4.
 * Renders the section label, a phase chip, and a one-line preview of what
 * the section will eventually do — so hosts can preview the roadmap from
 * inside the wizard rather than dropping into a separate release notes page.
 */
interface Props {
  title: string;
  phase: 2 | 3 | 4;
  description: string;
  /** What the section will do once built. Optional bullet list. */
  bullets?: string[];
}

export function SectionPlaceholder({ title, phase, description, bullets }: Props) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
          Coming · Phase {phase}
        </span>
      </div>
      <p className="text-sm text-slate-600">{description}</p>
      {bullets && bullets.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {bullets.map((b) => (
            <li key={b} className="text-sm text-slate-600 flex items-start gap-2">
              <span className="text-brand-500 mt-0.5">·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 text-[11px] text-slate-400 italic">
        Not blocking — you can save and publish events without this section.
      </div>
    </div>
  );
}
