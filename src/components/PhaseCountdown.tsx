'use client';

import { useEffect, useState } from 'react';

/**
 * Phased Ticket Releases — live "ends in 2h 14m" countdown rendered inside
 * the phase banner above the booking form.
 *
 * Update cadence: 30s setInterval. We deliberately do NOT recompute every
 * second — sub-minute precision is wasted work for a banner that mostly
 * sits idle, and a 30s tick still feels live as the deadline approaches.
 *
 * Color rules:
 *   - default: muted slate text (matches banner copy)
 *   - <  1h remaining: amber-700 (warning)
 *   - <  5m remaining: rose-700  (urgent)
 *   - expired       : the parent banner should hide the countdown; we
 *                     still render "ended" as a fallback so we never
 *                     display a negative duration.
 *
 * Props:
 *   - endsAt          — unix epoch ms (matches the backend's TEXT/INTEGER
 *                       timestamp convention; we coerce to number for safety)
 *   - endsOnSellout   — true when the phase ALSO ends on sellout. When the
 *                       deadline expires we render the soft "ends when sold
 *                       out" hint instead of a hard "ended" since the phase
 *                       may still be live via the sellout trigger.
 */
interface Props {
  endsAt: number;
  endsOnSellout: boolean;
}

function computeRemaining(endsAt: number): { ms: number; label: string } {
  const now = Date.now();
  const ms = Math.max(0, endsAt - now);
  if (ms <= 0) return { ms: 0, label: 'ended' };
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) {
    return { ms, label: `${days}d ${hours}h` };
  }
  if (hours > 0) {
    return { ms, label: `${hours}h ${minutes}m` };
  }
  if (minutes > 0) {
    return { ms, label: `${minutes}m` };
  }
  return { ms, label: `${seconds}s` };
}

export function PhaseCountdown({ endsAt, endsOnSellout }: Props) {
  // Hydrate from server-rendered state (the parent component already
  // formatted the deadline date) — we just need the live "ends in X"
  // string. Recompute on mount + every 30s.
  const [state, setState] = useState(() => computeRemaining(endsAt));

  useEffect(() => {
    // Recompute immediately in case the client clock drifted from the
    // initial useState() snapshot (rare but possible on bfcache restore).
    setState(computeRemaining(endsAt));
    const id = setInterval(() => {
      setState(computeRemaining(endsAt));
    }, 30_000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (state.ms <= 0) {
    // Phase deadline already passed. If the phase also ends on sellout
    // it may still be live via the sellout trigger — surface a soft hint
    // rather than a hard "ended" so the parent banner stays coherent.
    return (
      <span className="text-slate-500">
        {endsOnSellout ? 'ends when sold out' : 'ended'}
      </span>
    );
  }

  // Color by urgency. <5m wins over <1h.
  const ms = state.ms;
  const colorClass =
    ms < 5 * 60_000
      ? 'text-rose-700 font-semibold'
      : ms < 60 * 60_000
        ? 'text-amber-700 font-semibold'
        : 'text-slate-700';

  return (
    <span className={colorClass} aria-live="polite">
      ends in {state.label}
    </span>
  );
}
