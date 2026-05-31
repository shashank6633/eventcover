'use client';

import { ReactNode } from 'react';

/**
 * Shared frame for every settings sub-section. Renders a header card with the
 * title + description + optional "Save Changes" CTA (top-right on desktop,
 * full-width on mobile), then a vertical stack of body cards.
 */
export function SectionShell({
  eyebrow,
  title,
  description,
  onSave,
  saving,
  saved,
  error,
  saveLabel = 'Save Changes',
  saveDisabled,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  onSave?: () => unknown;
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  saveLabel?: string;
  saveDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-[11px] tracking-widest uppercase text-slate-400">
                {eyebrow}
              </div>
            )}
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-slate-500 mt-1.5">{description}</p>
            )}
          </div>
          {onSave && (
            <button
              onClick={() => { void onSave(); }}
              disabled={!!saving || !!saveDisabled}
              className="btn btn-primary w-full md:w-auto md:flex-shrink-0"
            >
              {saving ? 'Saving…' : saveLabel}
            </button>
          )}
        </div>
        {(error || saved) && (
          <div className="mt-3">
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
                {error}
              </div>
            )}
            {saved && !error && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
                Settings saved.
              </div>
            )}
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
