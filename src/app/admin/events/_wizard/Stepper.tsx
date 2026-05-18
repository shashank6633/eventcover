'use client';

import type { Step } from './types';
import { STEP_LABELS } from './types';

interface Props {
  current: Step;
  maxReached: Step;          // can't click steps beyond this
  onJump: (step: Step) => void;
}

/**
 * Step progress indicator.
 *
 * Mobile (< 768 px):  Compact "Step N of 4 · <label>" header + dot-progress row.
 *                     Saves horizontal space and avoids label overflow.
 * Desktop (>= 768 px): Full horizontal track with numbered chips + labels +
 *                     connecting lines, as before.
 */
export function Stepper({ current, maxReached, onJump }: Props) {
  const steps: Step[] = [1, 2, 3, 4];

  return (
    <div className="w-full select-none">
      {/* MOBILE: compact header + dots */}
      <div className="md:hidden">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">
              Step {current} of 4
            </div>
            <div className="text-sm font-semibold text-brand-700 mt-0.5">
              {STEP_LABELS[current]}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {steps.map((s) => {
              const reached = s <= maxReached;
              const isActive = s === current;
              const isCompleted = s < current;
              const canClick = s <= maxReached;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!canClick}
                  onClick={() => canClick && onJump(s)}
                  className={`h-2 rounded-full transition-all ${
                    isActive ? 'w-6 bg-brand-500'
                    : isCompleted ? 'w-2 bg-brand-500'
                    : reached ? 'w-2 bg-brand-200'
                    : 'w-2 bg-slate-200'
                  } ${canClick ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                  aria-label={`Go to step ${s}: ${STEP_LABELS[s]}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* DESKTOP: full track */}
      <div className="hidden md:flex items-center w-full text-sm">
        {steps.map((s, i) => {
          const reached = s <= maxReached;
          const isActive = s === current;
          const canClick = s <= maxReached;
          const isCompleted = s < current;
          return (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                disabled={!canClick}
                onClick={() => canClick && onJump(s)}
                className={`flex items-center gap-2 group ${canClick ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                title={canClick ? `Go to ${STEP_LABELS[s]}` : 'Save earlier steps first'}
              >
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold transition ${
                    isActive ? 'bg-white text-brand-700 ring-2 ring-brand-500'
                    : isCompleted ? 'bg-brand-500 text-white'
                    : reached ? 'bg-brand-100 text-brand-700'
                    : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isCompleted ? <Check /> : s}
                </span>
                <span
                  className={`whitespace-nowrap transition ${
                    isActive ? 'text-brand-700 font-semibold'
                    : reached ? 'text-slate-700'
                    : 'text-slate-400'
                  }`}
                >
                  {STEP_LABELS[s]}
                </span>
              </button>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px mx-4 ${s < maxReached ? 'bg-brand-300' : 'bg-slate-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Check() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7"/>
    </svg>
  );
}
