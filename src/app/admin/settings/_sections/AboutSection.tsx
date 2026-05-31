'use client';

import { RichTextEditor } from '@/components/RichTextEditor';
import { SectionShell } from './SectionShell';
import { useConfigSection } from './useConfigSection';

const KEYS = ['BRAND_ABOUT_HTML'];

export function AboutSection() {
  const { config, set, save, loaded, saving, saved, error } = useConfigSection(KEYS);

  if (!loaded) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <SectionShell
      eyebrow="Brand Page"
      title="About"
      description="Long-form copy about your venue — used on public event invites and the booking page."
      onSave={save}
      saving={saving}
      saved={saved}
      error={error}
    >
      <div className="card space-y-3">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          About Your Brand
        </div>
        <RichTextEditor
          value={config.BRAND_ABOUT_HTML || ''}
          onChange={(html) => set('BRAND_ABOUT_HTML', html)}
          placeholder="Tell guests what your venue stands for, what makes it special, and what to expect."
          minHeight={220}
        />
      </div>

      <div className="card space-y-3 border-amber-200 bg-amber-50/50">
        <div className="text-xs uppercase tracking-widest text-amber-700">
          Tips
        </div>
        <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5">
          <li>
            Lead with the <strong>vibe</strong> — a guest decides in the first
            two lines whether they belong here.
          </li>
          <li>
            Mention any <strong>signatures</strong> (a star bartender, a
            resident DJ, a heritage cuisine) so search and shareables have
            something to grab.
          </li>
          <li>
            Keep paragraphs short. Customers read this on a phone right before
            tapping "Book".
          </li>
        </ul>
      </div>
    </SectionShell>
  );
}
