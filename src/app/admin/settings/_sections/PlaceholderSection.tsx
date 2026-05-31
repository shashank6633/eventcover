'use client';

import { SectionShell } from './SectionShell';

/**
 * Stand-in for sections shipped in later Fixer passes (Events / Notifications /
 * Team / Tools / Bank Details). Keeps the left-nav structure complete so the
 * shell renders the full Growezzy-style hierarchy from day one.
 */
export function PlaceholderSection({
  eyebrow,
  title,
  description,
  note,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  note?: string;
}) {
  return (
    <SectionShell eyebrow={eyebrow} title={title} description={description}>
      <div className="card">
        <div className="border border-dashed border-slate-300 rounded-lg px-4 py-8 text-center text-sm text-slate-500">
          {note || 'Coming soon.'}
        </div>
      </div>
    </SectionShell>
  );
}
