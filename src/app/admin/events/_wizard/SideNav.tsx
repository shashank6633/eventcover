'use client';

import { SECTIONS, getIncompleteSections, type SectionKey, type WizardState } from './types';

interface Props {
  active: SectionKey;
  onSelect: (k: SectionKey) => void;
  state: WizardState;
}

/**
 * Vertical section nav for the event wizard. Mirrors Growezzy's layout:
 *
 *   [icon] Section label
 *          Section description
 *          [optional NEW badge / phase tag]
 *          [optional red dot if required + incomplete]
 *
 * Active row gets a brand-tinted background + left border. Phase-only
 * sections (2/3/4) are rendered but visually muted so the host can preview
 * what's coming without thinking they're broken.
 */
export function SideNav({ active, onSelect, state }: Props) {
  const incomplete = new Set(getIncompleteSections(state));

  return (
    <nav
      aria-label="Event wizard sections"
      className="bg-white rounded-xl border border-slate-200 overflow-hidden"
    >
      <ul className="divide-y divide-slate-100">
        {SECTIONS.map((s) => {
          const isActive = active === s.key;
          const isPhase1 = s.phase === 1;
          const showDot = !!s.required && incomplete.has(s.key);
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onSelect(s.key)}
                className={`relative w-full text-left flex items-start gap-3 px-3 py-3 transition
                            ${isActive
                              ? 'bg-brand-50 border-l-4 border-brand-500'
                              : 'border-l-4 border-transparent hover:bg-slate-50'}`}
              >
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                              ${isActive ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}
                              ${!isPhase1 && !isActive ? 'opacity-60' : ''}`}
                >
                  <Icon name={s.icon} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-sm font-semibold ${isActive ? 'text-brand-700' : 'text-slate-900'}`}>
                      {s.label}
                    </span>
                    {!isPhase1 && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-semibold">
                        P{s.phase}
                      </span>
                    )}
                    {showDot && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-rose-500"
                        title="Required field missing"
                        aria-label="Required field missing"
                      />
                    )}
                  </div>
                  <div className={`text-[11px] mt-0.5 truncate ${isActive ? 'text-brand-600' : 'text-slate-500'}`}>
                    {s.description}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─── Icons (16px) ──────────────────────────────────────────────────────────

function Icon({ name }: { name: string }) {
  const props = {
    width: 16, height: 16, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'info':
      return <svg {...props}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>;
    case 'pin':
      return <svg {...props}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
    case 'calendar':
      return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>;
    case 'ticket':
      return <svg {...props}><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" /><path d="M13 6v12" /></svg>;
    case 'design':
      return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /><path d="M3 12h2M19 12h2" /></svg>;
    case 'image':
      return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>;
    case 'doc':
      return <svg {...props}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></svg>;
    case 'lock':
      return <svg {...props}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
    case 'form':
      return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>;
    case 'tag':
      return <svg {...props}><path d="M20.59 13.41L13 21l-9-9V3h9l7.59 7.59a2 2 0 0 1 0 2.82z" /><circle cx="7.5" cy="7.5" r="1" /></svg>;
    case 'bell':
      return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>;
    case 'cog':
      return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
    default:
      return <svg {...props}><circle cx="12" cy="12" r="9" /></svg>;
  }
}
