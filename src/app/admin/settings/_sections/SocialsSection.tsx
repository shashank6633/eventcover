'use client';

import { useEffect, useState } from 'react';
import { SectionShell } from './SectionShell';
import { useConfigSection } from './useConfigSection';

const KEYS = ['BRAND_SOCIAL_LINKS_JSON'];

type SocialKind =
  | 'instagram'
  | 'youtube'
  | 'facebook'
  | 'x'
  | 'tiktok'
  | 'website'
  | 'other';

interface SocialLink {
  kind: SocialKind;
  url: string;
}

const KIND_LABELS: Record<SocialKind, string> = {
  instagram: 'Instagram',
  youtube:   'YouTube',
  facebook:  'Facebook',
  x:         'X (Twitter)',
  tiktok:    'TikTok',
  website:   'Website',
  other:     'Other',
};

const MAX_LINKS = 5;

function parseLinks(json: string): SocialLink[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x): x is SocialLink =>
          x &&
          typeof x === 'object' &&
          typeof x.kind === 'string' &&
          typeof x.url === 'string' &&
          x.kind in KIND_LABELS,
      )
      .slice(0, MAX_LINKS);
  } catch {
    return [];
  }
}

export function SocialsSection() {
  const { config, set, save, loaded, saving, saved, error } = useConfigSection(KEYS);
  const [links, setLinks] = useState<SocialLink[]>([]);

  // Hydrate local list when config loads / refreshes.
  useEffect(() => {
    setLinks(parseLinks(config.BRAND_SOCIAL_LINKS_JSON || ''));
  }, [config.BRAND_SOCIAL_LINKS_JSON]);

  function commit(next: SocialLink[]) {
    setLinks(next);
    set('BRAND_SOCIAL_LINKS_JSON', JSON.stringify(next));
  }

  function addLink() {
    if (links.length >= MAX_LINKS) return;
    commit([...links, { kind: 'instagram', url: '' }]);
  }

  function updateLink(i: number, patch: Partial<SocialLink>) {
    const next = links.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    commit(next);
  }

  function removeLink(i: number) {
    commit(links.filter((_, idx) => idx !== i));
  }

  if (!loaded) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <SectionShell
      eyebrow="Brand Page"
      title="Socials"
      description="Up to five social or web links. Shown on your public event invites and booking page footer."
      onSave={save}
      saving={saving}
      saved={saved}
      error={error}
    >
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-slate-500">
            Social Links
          </div>
          <div className="text-xs text-slate-400">
            {links.length} / {MAX_LINKS}
          </div>
        </div>

        {links.length === 0 ? (
          <div className="border border-dashed border-slate-300 rounded-lg px-4 py-8 text-center">
            <div className="text-sm text-slate-500 mb-3">
              No social links yet.
            </div>
            <button onClick={addLink} className="btn btn-primary">
              + Add Your First Link
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((link, i) => (
              <div
                key={i}
                className="grid grid-cols-[140px_1fr_auto] gap-2 items-center"
              >
                <select
                  className="input"
                  value={link.kind}
                  onChange={(e) =>
                    updateLink(i, { kind: e.target.value as SocialKind })
                  }
                >
                  {Object.entries(KIND_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  value={link.url}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                  placeholder="https://…"
                />
                <button
                  onClick={() => removeLink(i)}
                  className="w-9 h-9 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                  aria-label="Remove link"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}

            {links.length < MAX_LINKS && (
              <button
                onClick={addLink}
                className="text-sm text-brand-600 hover:underline mt-2"
              >
                + Add Link
              </button>
            )}
          </div>
        )}
      </div>
    </SectionShell>
  );
}
