'use client';

import { StepBookings } from './StepBookings';
import { SectionSeatingLayout, PhasesSubCard } from './SectionSeatingLayout';
import type { WizardState } from './types';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /**
   * Persisted event id. Forwarded to <SectionSeatingLayout /> so the SVG +
   * zones endpoints (which are child-table mutations, persisted immediately
   * instead of with the global Save) know which event to address. Null for
   * an un-saved event — the seating card collapses its upload UI in that
   * case and prompts the host to save first.
   */
  eventId?: string | null;
}

/**
 * Tickets section in the new side-nav model. Composes:
 *   • StepBookings — pricing, table types, GST/discount, Razorpay payment mode
 *   • SectionSeatingLayout — opt-in per-event SVG zone pricing (Phase 5)
 *
 * The seating layout card sits BELOW the existing pricing cards. When its
 * master toggle is off the flat-pricing flow is the only thing in play; when
 * on, the per-zone price overrides entry_fee_per_person on the public
 * booking page.
 */
export function SectionTickets({ state, onChange, eventId }: Props) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Tickets</h2>
        <p className="text-sm text-slate-500 mt-1">
          Set entry fee, cover charges, table types, taxes, and online payment behaviour.
        </p>
      </header>
      <StepBookings state={state} onChange={onChange} />
      {/* Ticket Release Phases — same card the Seating Layout section also
          renders. Both surfaces share `state.seating_layout_phases_enabled`
          so flipping the toggle in either spot unlocks the matrix everywhere. */}
      <div className="card space-y-4">
        <PhasesSubCard
          state={state}
          onChange={onChange}
          eventId={eventId ?? null}
        />
      </div>
      <SectionSeatingLayout
        state={state}
        onChange={onChange}
        eventId={eventId ?? null}
      />
    </div>
  );
}
