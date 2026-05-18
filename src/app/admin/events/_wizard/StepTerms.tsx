'use client';

import { RichTextEditor } from '@/components/RichTextEditor';
import type { WizardState } from './types';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

const TERMS_PLACEHOLDER = `CLUB RULES & ENTRY POLICY
To ensure a safe and enjoyable experience for everyone, please read and follow our club rules:

ENTRY & AGE POLICY
Entry is strictly subject to guests 21 years and above. A valid government-issued ID proof is required at entry.`;

const FAQS_PLACEHOLDER = `1. What is the age limit to enter?
Entry is strictly for guests aged 21 years and above. A valid government-issued ID proof is required at entry.`;

export function StepTerms({ state, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <div className="font-semibold text-slate-900">Terms & Conditions</div>
        <div className="mt-2">
          <RichTextEditor
            value={state.terms}
            onChange={(html) => onChange({ terms: html })}
            placeholder={TERMS_PLACEHOLDER}
            minHeight={220}
          />
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Shown to guests during booking. Cover rules, ID policy, dress code, refund stance — anything legally
          worth surfacing.
        </div>
      </div>

      <div>
        <div className="font-semibold text-slate-900">FAQs</div>
        <div className="mt-2">
          <RichTextEditor
            value={state.faqs}
            onChange={(html) => onChange({ faqs: html })}
            placeholder={FAQS_PLACEHOLDER}
            minHeight={180}
          />
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Optional. Repeats the common questions you don&apos;t want your team answering by phone all night.
        </div>
      </div>
    </div>
  );
}
