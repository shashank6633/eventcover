'use client';

import { useEffect, useState } from 'react';
import type { WizardState } from './types';
import type { Venue } from '@/lib/venues';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

export function StepMessages({ state, onChange }: Props) {
  const cfg = state.messages_config;
  const set = (patch: Partial<typeof cfg>) => onChange({ messages_config: { ...cfg, ...patch } });

  const [venues, setVenues] = useState<Venue[]>([]);

  useEffect(() => {
    fetch('/api/venues').then((r) => r.json()).then((d) => { if (d.ok) setVenues(d.venues || []); });
  }, []);

  // Auto-suggest event_location from chosen venue when blank
  useEffect(() => {
    if (cfg.event_location || !state.venue_id) return;
    const v = venues.find((x) => x.id === state.venue_id);
    if (v) set({ event_location: `${v.name}, ${v.city}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.venue_id, venues]);

  // Auto-suggest event_datetime from event_date + start_time when blank
  useEffect(() => {
    if (cfg.event_datetime || !state.event_date) return;
    const d = new Date(state.event_date + (state.start_time ? `T${state.start_time}` : 'T00:00'));
    if (Number.isNaN(d.getTime())) return;
    const formatted = d.toLocaleString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
    set({ event_datetime: formatted });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.event_date, state.start_time]);

  const detailsEnabled = !!cfg.wa_details_enabled;
  const groupEnabled = !!cfg.wa_group_enabled;

  return (
    <div className="space-y-5">
      {/* Event-details message */}
      <div className={`rounded-xl border overflow-hidden transition ${detailsEnabled ? 'border-brand-200' : 'border-slate-200'}`}>
        <label className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition ${detailsEnabled ? 'bg-brand-500 text-white' : 'bg-slate-50 text-slate-700'}`}>
          <input
            type="checkbox"
            checked={detailsEnabled}
            onChange={(e) => set({ wa_details_enabled: e.target.checked })}
            className="accent-white w-4 h-4"
          />
          <span className="text-sm font-medium">
            Send WhatsApp message with event details after payment confirmation
            <span className={`block text-xs mt-0.5 ${detailsEnabled ? 'text-white/80' : 'text-slate-500'}`}>
              Only after you approve · plain text only
            </span>
          </span>
        </label>

        {detailsEnabled && (
          <div className="p-4 space-y-4 bg-white">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Event Location</label>
                <input
                  className="input"
                  value={cfg.event_location ?? ''}
                  onChange={(e) => set({ event_location: e.target.value })}
                  placeholder="e.g. Akan Hyderabad, Hyderabad"
                />
              </div>
              <div>
                <label className="label">Event Date & Time</label>
                <input
                  className="input"
                  value={cfg.event_datetime ?? ''}
                  onChange={(e) => set({ event_datetime: e.target.value })}
                  placeholder="20-05-2026, 09:01 PM"
                />
              </div>
            </div>

            <div>
              <label className="label">Contact Number Of Event POC</label>
              <div className="flex gap-2">
                <span className="inline-flex items-center px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700">+91</span>
                <input
                  className="input flex-1"
                  type="tel"
                  inputMode="tel"
                  value={cfg.poc_phone ?? ''}
                  onChange={(e) => set({ poc_phone: e.target.value })}
                  placeholder="0000000000"
                />
              </div>
            </div>

            <div>
              <label className="label">Important Info</label>
              <textarea
                className="input min-h-[90px]"
                value={cfg.important_info ?? ''}
                onChange={(e) => set({ important_info: e.target.value })}
                placeholder="Please don't bring anything…"
              />
              <div className="mt-1 text-xs text-slate-500">
                WhatsApp messages don&apos;t support emojis or line breaks. Please use plain text only.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Group-link message */}
      <div className={`rounded-xl border overflow-hidden transition ${groupEnabled ? 'border-brand-200' : 'border-slate-200'}`}>
        <label className="flex items-center gap-3 px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={groupEnabled}
            onChange={(e) => set({ wa_group_enabled: e.target.checked })}
            className="accent-brand-500 w-4 h-4"
          />
          <span className="text-sm text-slate-700 font-medium">
            Send a WhatsApp message with a group link after payment confirmation
            <span className="block text-xs mt-0.5 text-slate-500">Only after you approve</span>
          </span>
        </label>

        {groupEnabled && (
          <div className="px-4 pb-4">
            <label className="label">WhatsApp Group Invite Link</label>
            <input
              className="input"
              type="url"
              value={cfg.wa_group_link ?? ''}
              onChange={(e) => set({ wa_group_link: e.target.value })}
              placeholder="https://chat.whatsapp.com/..."
            />
            <div className="mt-1 text-xs text-slate-500">
              Get this from WhatsApp → Group info → Invite via link.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
