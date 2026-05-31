'use client';

import { useState } from 'react';
import { RichTextEditor } from '@/components/RichTextEditor';
import type { WizardState } from './types';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

const SUMMARY_MAX = 100;

/**
 * Basic Info section — the canonical "what is this event?" page.
 *
 * Fields:
 *   • Event Title             (required)
 *   • URL Key (slug)          (auto-generated server-side when blank)
 *   • One-Line Summary        (NEW — shown in Meta Ad previews + event lists)
 *   • Description (rich text) (required)
 *   • Public/Private toggle
 *   • Meta Pixel ID override  (only when public)
 *
 * AI Enhance button (top-right of Description) opens a "Coming soon" modal
 * since the Claude API key flow isn't built yet.
 */
export function SectionBasicInfo({ state, onChange }: Props) {
  const [aiOpen, setAiOpen] = useState(false);
  const summaryLen = state.one_line_summary.length;
  const summaryNearLimit = summaryLen > SUMMARY_MAX * 0.9;

  function setSlug(raw: string) {
    // Sanitize as user types — kebab-case, lowercase, max 80
    const cleaned = raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
    onChange({ slug: cleaned });
  }

  return (
    <div className="card space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Basic Info</h2>
        <p className="text-sm text-slate-500 mt-1">
          Core details that show up on the public event page, WhatsApp previews, and Meta ad cards.
        </p>
      </header>

      {/* Event Name */}
      <div>
        <label className="label">
          Event Title <span className="text-rose-600">*</span>
        </label>
        <input
          className="input"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Threeory Band Live at Akan"
          maxLength={150}
        />
      </div>

      {/* URL Key */}
      <div>
        <label className="label">URL Key</label>
        <input
          className="input font-mono text-sm"
          value={state.slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="e.g. threeory-band-live-2026-06-15"
        />
        <div className="text-[11px] text-slate-400 mt-1">
          Only lowercase letters, numbers, and hyphens. Leave blank to auto-generate from name + date.
          Preview: <span className="font-mono">wallet.akanhyd.com/event/{state.slug || '[auto]'}</span>
        </div>
      </div>

      {/* One-Line Summary */}
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label">One-Line Summary</label>
          <span className={`text-[11px] ${summaryNearLimit ? 'text-amber-600' : 'text-slate-400'}`}>
            {summaryLen}/{SUMMARY_MAX}
          </span>
        </div>
        <textarea
          className="input min-h-[60px] resize-none"
          value={state.one_line_summary}
          onChange={(e) => onChange({ one_line_summary: e.target.value.slice(0, SUMMARY_MAX) })}
          placeholder="A relaxing weekend of yoga and wellness"
          maxLength={SUMMARY_MAX}
          rows={2}
        />
        <div className="text-[11px] text-slate-400 mt-1">
          Shown in event previews, Meta ad headlines, and search results. Keep it tight.
        </div>
      </div>

      {/* Description with AI Enhance */}
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label">
            Full Description <span className="text-rose-600">*</span>
          </label>
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="text-[11px] inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium"
          >
            ✨ Enhance with AI
          </button>
        </div>
        <RichTextEditor
          value={state.description}
          onChange={(html) => onChange({ description: html })}
          placeholder="Tell guests what to expect — the artist, the vibe, special inclusions…"
          minHeight={200}
        />
      </div>

      {/* Visibility toggle */}
      <div className="pt-2 border-t border-slate-100">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 accent-brand-500 cursor-pointer"
            checked={state.is_public}
            onChange={(e) => onChange({ is_public: e.target.checked })}
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">Public event</div>
            <div className="text-xs text-slate-500 mt-1">
              When OFF, the public landing page returns 404 and the event is only visible to admin staff.
            </div>
          </div>
        </label>
      </div>

      {/* Meta Pixel override (only when public) */}
      {state.is_public && (
        <div className="pt-4 border-t border-slate-100">
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
            Marketing
          </div>
          <label className="label">Meta Pixel ID override</label>
          <input
            className="input font-mono text-sm"
            value={state.meta_pixel_id}
            onChange={(e) => onChange({ meta_pixel_id: e.target.value.replace(/\D/g, '') })}
            placeholder="uses venue default"
            inputMode="numeric"
            maxLength={17}
          />
          <div className="text-[11px] text-slate-400 mt-1">
            Blank = use venue-wide Pixel from{' '}
            <a href="/admin/settings/meta" target="_blank" className="text-brand-600 underline">
              Settings → Meta
            </a>.
          </div>
        </div>
      )}

      {/* AI Enhance modal stub */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAiOpen(false)}>
          <div
            className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-lg font-semibold text-slate-900">✨ Enhance with AI</h3>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                Coming · Phase 2
              </span>
            </div>
            <p className="text-sm text-slate-600">
              Once enabled, this will rewrite your description into polished marketing copy
              using Claude. We&apos;ll need a Claude API key configured under{' '}
              <span className="font-mono">Settings → AI</span> before turning this on.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="btn btn-primary"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
