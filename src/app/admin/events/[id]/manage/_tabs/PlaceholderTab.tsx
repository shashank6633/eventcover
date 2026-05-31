'use client';

/**
 * PlaceholderTab — temporary holder for the four sub-tabs (Reminders,
 * Post-Sale, Gallery, Refundable) that other devs are filling in.
 *
 * Keeps the routing + URL deep-linking intact so links shared today (e.g.
 * .../manage?tab=reminders) keep working once the real component lands —
 * the dev just needs to swap this component out in ManageShell.tsx for
 * their concrete tab.
 */

export function PlaceholderTab({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="card text-center py-12">
      <div className="text-3xl mb-2" aria-hidden>🛠️</div>
      <div className="text-base font-semibold text-slate-900">{title} — coming up</div>
      <div className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">{subtitle}</div>
      <div className="text-[11px] uppercase tracking-widest text-slate-400 mt-4">In progress</div>
    </div>
  );
}
