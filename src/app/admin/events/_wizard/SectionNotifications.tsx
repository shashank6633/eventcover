'use client';

import { StepMessages } from './StepMessages';
import type { WizardState } from './types';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

/**
 * Notifications section — wraps the existing StepMessages component which
 * owns the WhatsApp message-template configuration that fires when a wallet
 * is issued / a reservation is confirmed.
 */
export function SectionNotifications({ state, onChange }: Props) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
        <p className="text-sm text-slate-500 mt-1">
          Customize the WhatsApp messages customers receive on reservation, booking confirmation, and cover-pass delivery.
        </p>
      </header>
      <StepMessages state={state} onChange={onChange} />
    </div>
  );
}
