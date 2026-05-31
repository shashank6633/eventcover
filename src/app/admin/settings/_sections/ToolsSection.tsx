'use client';

import Link from 'next/link';
import { SectionShell } from './SectionShell';

/**
 * ToolsSection — General → Tools.
 *
 * Placeholder home for future imports/exports + system tools. For now it links
 * to the existing utility pages that don't fit cleanly under any of the other
 * settings sections (affiliates, abandoned bookings, payouts).
 */

interface QuickLink {
  href: string;
  label: string;
  description: string;
}

const QUICK_LINKS: QuickLink[] = [
  {
    href: '/admin/affiliates',
    label: 'Affiliates',
    description: 'Tracking links + commission programs for partners and creators.',
  },
  {
    href: '/admin/abandoned-bookings',
    label: 'Abandoned Bookings',
    description: 'Recover guests who started a booking but never paid.',
  },
  {
    href: '/admin/payouts',
    label: 'Affiliate Payouts',
    description: 'Settle commissions to affiliates — bank transfer + receipts.',
  },
];

export function ToolsSection() {
  return (
    <SectionShell
      eyebrow="General"
      title="Tools"
      description="Imports &amp; exports, integrations, and system tools."
    >
      <div className="card space-y-3 border-dashed">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          Coming Soon
        </div>
        <p className="text-sm text-slate-600">
          Imports &amp; exports, integrations, system tools — coming soon. For
          now, the utility pages below are reachable from the side-nav.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          Quick Links
        </div>
        <ul className="space-y-2">
          {QUICK_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    {l.label}
                  </div>
                  <div className="text-xs text-slate-500">
                    {l.description}
                  </div>
                </div>
                <span className="text-slate-400 text-sm">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  );
}
