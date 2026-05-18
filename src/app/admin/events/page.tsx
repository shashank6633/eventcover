'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Event } from '@/lib/events';
import { Stepper } from './_wizard/Stepper';
import { StepDetails } from './_wizard/StepDetails';
import { StepTerms } from './_wizard/StepTerms';
import { StepBookings } from './_wizard/StepBookings';
import { StepMessages } from './_wizard/StepMessages';
import { EMPTY_STATE, hydrateFromEvent, STEP_LABELS, type WizardState, type Step } from './_wizard/types';

export default function EventsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EventsClient />
    </Suspense>
  );
}

function Loading() {
  return <div className="max-w-5xl mx-auto px-6 md:px-8 py-6 text-slate-500">Loading…</div>;
}

function EventsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const newParam = params.get('new');
  const editParam = params.get('edit');
  const wizardOpen = !!(newParam || editParam);

  if (!wizardOpen) return <EventsHubRedirect />;

  return (
    <EventWizard
      initialEventId={editParam || null}
      onClose={() => router.push('/admin')}
    />
  );
}

function EventsHubRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin'); }, [router]);
  return <Loading />;
}

interface WizardProps {
  initialEventId: string | null;
  onClose: () => void;
}

function EventWizard({ initialEventId, onClose }: WizardProps) {
  const router = useRouter();
  const [eventId, setEventId] = useState<string | null>(initialEventId);
  const [step, setStep] = useState<Step>(1);
  const [maxReached, setMaxReached] = useState<Step>(initialEventId ? 4 : 1);
  const [state, setState] = useState<WizardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(!!initialEventId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialEventId) { setLoading(false); return; }
    fetch(`/api/events/${initialEventId}`).then((r) => r.json()).then((d) => {
      if (d.ok) { setState(hydrateFromEvent(d.event as Event)); setMaxReached(4); }
      else setError(d.message || 'Event not found.');
      setLoading(false);
    });
  }, [initialEventId]);

  function update(patch: Partial<WizardState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  async function saveStep(currentStep: Step): Promise<boolean> {
    setError(null);

    if (currentStep === 1) {
      if (!state.name.trim()) { setError('Event title is required.'); return false; }
      if (!state.event_date) { setError('Pick an event date.'); return false; }
    }

    const payloadByStep: Record<Step, Record<string, unknown>> = {
      1: {
        name: state.name,
        event_date: state.event_date,
        description: state.description || null,
        image_data: state.image_data,
        start_time: state.start_time || null,
        is_public: state.is_public,
        venue_id: state.venue_id || null,
        artist_ids: state.artist_ids,
        genre: state.genre || null,
        tags: state.tags,
      },
      2: { terms: state.terms || null, faqs: state.faqs || null },
      3: {
        entry_fee_per_person: state.entry_fee_per_person,
        cover_male_stag: state.cover_rates.male_stag,
        cover_female_stag: state.cover_rates.female_stag,
        cover_couple: state.cover_rates.couple,
        entry_enabled: state.entry_enabled,
        cover_enabled: state.cover_enabled,
        table_types: state.table_types,
        occupancy_rule: state.occupancy_rule,
        gst_percent: state.gst_percent,
        discount_percent: state.discount_percent,
      },
      4: { messages_config: state.messages_config },
    };
    const payload = payloadByStep[currentStep];

    setBusy(true);
    try {
      let res;
      if (!eventId) {
        res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, status: 'draft' }),
        });
      } else {
        res = await fetch(`/api/events/${eventId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json();
      if (!data.ok) { setError(data.message || 'Save failed.'); return false; }
      if (!eventId && data.event?.id) {
        setEventId(data.event.id);
        router.replace(`/admin/events?edit=${data.event.id}`);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSaveAndContinue() {
    const ok = await saveStep(step);
    if (!ok) return;
    if (step < 4) {
      const next = (step + 1) as Step;
      setStep(next);
      setMaxReached((m) => (next > m ? next : m));
    } else {
      if (eventId) {
        await fetch(`/api/events/${eventId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'live' }),
        });
      }
      onClose();
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-8 py-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 text-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          {eventId ? 'Edit Event' : 'Add Event'}
        </button>
      </div>

      <div className="mt-6 card">
        <Stepper current={step} maxReached={maxReached} onJump={(s) => setStep(s)} />

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="mt-6">
          {step === 1 && <StepDetails state={state} onChange={update} />}
          {step === 2 && <StepTerms state={state} onChange={update} />}
          {step === 3 && <StepBookings state={state} onChange={update} />}
          {step === 4 && <StepMessages state={state} onChange={update} />}
        </div>

        <div className="mt-7 flex items-center gap-3 pt-5 border-t border-slate-100">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              className="btn btn-secondary"
            >
              Prev
            </button>
          ) : <span className="flex-1" />}

          <span className="flex-1 text-center text-xs text-slate-400">
            Step {step} of 4 · {STEP_LABELS[step]}
          </span>

          <button
            type="button"
            onClick={onSaveAndContinue}
            disabled={busy}
            className="btn btn-primary"
          >
            {busy ? 'Saving…' : (step === 4 ? 'Update' : 'Save & Continue')}
          </button>
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-400 text-center">
        Each step saves independently. You can leave and return — your draft sticks.{' '}
        <Link href="/admin" className="text-brand-600 hover:text-brand-700">Back to Events</Link>
      </div>
    </div>
  );
}
