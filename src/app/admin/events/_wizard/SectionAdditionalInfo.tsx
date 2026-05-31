'use client';

import type { WizardState } from './types';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

const REFUND_MAX = 1000;

/**
 * Additional Info section.
 *
 * Fields:
 *   • Refund Policy (NEW)  — short policy text rendered on /event/[slug]
 *   • Terms & Conditions   — long-form text
 *   • FAQs                 — long-form text
 *
 * All three are plain text (no rich editor) to keep the public page render
 * trivially safe and the schema lean.
 */
export function SectionAdditionalInfo({ state, onChange }: Props) {
  const refundLen = state.refund_policy.length;
  const refundNearLimit = refundLen > REFUND_MAX * 0.9;

  return (
    <div className="card space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Additional Info</h2>
        <p className="text-sm text-slate-500 mt-1">
          Refund policy, T&amp;C, FAQs — shown on the public event page and the booking confirmation.
        </p>
      </header>

      {/* Refund Policy (NEW) */}
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label">Refund Policy</label>
          <span className={`text-[11px] ${refundNearLimit ? 'text-amber-600' : 'text-slate-400'}`}>
            {refundLen}/{REFUND_MAX}
          </span>
        </div>
        <textarea
          className="input min-h-[100px]"
          value={state.refund_policy}
          onChange={(e) => onChange({ refund_policy: e.target.value.slice(0, REFUND_MAX) })}
          placeholder="All sales are final. No refunds unless the event is cancelled by the organizer."
          maxLength={REFUND_MAX}
          rows={4}
        />
        <div className="text-[11px] text-slate-400 mt-1">
          One short paragraph. Rendered on the booking page before the customer pays.
        </div>
      </div>

      {/* Terms & Conditions */}
      <div>
        <label className="label">Terms &amp; Conditions</label>
        <textarea
          className="input min-h-[160px]"
          value={state.terms}
          onChange={(e) => onChange({ terms: e.target.value })}
          placeholder="Entry restricted to 21+. Right of admission reserved. ID required. No outside food or beverages…"
          rows={6}
        />
      </div>

      {/* FAQs */}
      <div>
        <label className="label">FAQs</label>
        <textarea
          className="input min-h-[160px]"
          value={state.faqs}
          onChange={(e) => onChange({ faqs: e.target.value })}
          placeholder={`Q: Is there a dress code?\nA: Smart casual. No shorts or flip-flops.\n\nQ: Can I bring a plus-one?\nA: Yes, with prior booking.`}
          rows={6}
        />
        <div className="text-[11px] text-slate-400 mt-1">
          Plain text. Each Q/A on its own line.
        </div>
      </div>
    </div>
  );
}
