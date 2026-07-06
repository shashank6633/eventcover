'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { WebsiteSection } from './_sections/WebsiteSection';
import { EventsSection } from './_sections/EventsSection';
import { AboutSection } from './_sections/AboutSection';
import { SocialsSection } from './_sections/SocialsSection';
import { TrackingSection } from './_sections/TrackingSection';
import { NotificationsSection } from './_sections/NotificationsSection';
import { TeamSection } from './_sections/TeamSection';
import { ToolsSection } from './_sections/ToolsSection';
import { BankDetailsSection } from './_sections/BankDetailsSection';
import { IntegrationsSection } from './_sections/IntegrationsSection';

/* ──────────────────────────────────────────────────────────────────────────
 * Nav schema — 3 groups, 9 entries. Mirrors the Growezzy reference layout.
 * Icons are inline SVGs (no extra deps). Active item gets a brand-tinted
 * background and a brand-coloured icon.
 * ────────────────────────────────────────────────────────────────────────── */

type IconProps = { className?: string };

const Icons: Record<string, (p: IconProps) => JSX.Element> = {
  website: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  events: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  ),
  about: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
    </svg>
  ),
  socials: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8 11l8-4M8 13l8 4" />
    </svg>
  ),
  tracking: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <path d="M3 12c3-7 15-7 18 0-3 7-15 7-18 0Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  notifications: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <path d="M6 9a6 6 0 1 1 12 0v4l2 3H4l2-3V9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  ),
  team: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M3 19c.5-3 3-5 6-5s5.5 2 6 5M14 19c.4-2.2 2-3.5 4-3.5s3.4 1.3 3.5 3.5" />
    </svg>
  ),
  tools: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <path d="M14 3a4 4 0 0 1 5 5L9 18l-4 1 1-4L14 3Z" />
    </svg>
  ),
  bank: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <path d="M3 9 12 4l9 5M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" />
    </svg>
  ),
  // Chain-link icon for the new Integrations section — matches the
  // "hooked into other services" semantic without duplicating any existing
  // icon in the registry.
  integrations: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={p.className} aria-hidden>
      <path d="M10 14a5 5 0 0 1 0-7l3-3a5 5 0 0 1 7 7l-1.5 1.5M14 10a5 5 0 0 1 0 7l-3 3a5 5 0 0 1-7-7l1.5-1.5" />
    </svg>
  ),
};

interface NavEntry {
  id: string;
  label: string;
  icon: keyof typeof Icons;
}

interface NavGroup {
  label: string;
  entries: NavEntry[];
}

const NAV: NavGroup[] = [
  {
    label: 'Brand Page',
    entries: [
      { id: 'website',  label: 'Website',  icon: 'website' },
      { id: 'events',   label: 'Events',   icon: 'events' },
      { id: 'about',    label: 'About',    icon: 'about' },
      { id: 'socials',  label: 'Socials',  icon: 'socials' },
      { id: 'tracking', label: 'Tracking', icon: 'tracking' },
    ],
  },
  {
    label: 'General',
    entries: [
      { id: 'notifications', label: 'Notifications', icon: 'notifications' },
      { id: 'team',          label: 'Team',          icon: 'team' },
      { id: 'tools',         label: 'Tools',         icon: 'tools' },
    ],
  },
  {
    // Integrations — Razorpay, WhatsApp, Meta Pixel, Reservego. Each has
    // its own dedicated page under /admin/settings/<name>; this section
    // is the discoverable home that links out to them with status pills.
    label: 'Integrations',
    entries: [
      { id: 'integrations', label: 'All integrations', icon: 'integrations' },
    ],
  },
  {
    label: 'Finance',
    entries: [
      { id: 'bank', label: 'Bank Details', icon: 'bank' },
    ],
  },
];

const DEFAULT_SECTION = 'website';
const ALL_IDS = new Set(NAV.flatMap((g) => g.entries.map((e) => e.id)));

/* ─── Section renderer ──────────────────────────────────────────────────── */

function ActiveSection({ id }: { id: string }) {
  switch (id) {
    case 'website':       return <WebsiteSection />;
    case 'events':        return <EventsSection />;
    case 'about':         return <AboutSection />;
    case 'socials':       return <SocialsSection />;
    case 'tracking':      return <TrackingSection />;
    case 'notifications': return <NotificationsSection />;
    case 'team':          return <TeamSection />;
    case 'tools':         return <ToolsSection />;
    case 'bank':          return <BankDetailsSection />;
    case 'integrations':  return <IntegrationsSection />;
    default:
      return <WebsiteSection />;
  }
}

/* ─── Shell ─────────────────────────────────────────────────────────────── */

function SettingsShell() {
  const params = useSearchParams();
  const raw = params.get('section') || DEFAULT_SECTION;
  const active = ALL_IDS.has(raw) ? raw : DEFAULT_SECTION;

  const activeLabel = useMemo(() => {
    for (const group of NAV) {
      for (const entry of group.entries) {
        if (entry.id === active) return entry.label;
      }
    }
    return 'Settings';
  }, [active]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 md:py-8">
      <div className="md:hidden mb-4">
        <div className="text-[11px] tracking-widest uppercase text-slate-400">
          Settings
        </div>
        <h1 className="text-xl font-bold text-slate-900 mt-0.5">
          {activeLabel}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 md:gap-8">
        {/* Left nav — sticky on desktop, horizontal scroll on mobile */}
        <aside className="md:sticky md:top-4 md:self-start">
          {/* Mobile: horizontal pill row */}
          <div className="md:hidden -mx-4 px-4 overflow-x-auto">
            <div className="flex gap-2 pb-2">
              {NAV.flatMap((g) => g.entries).map((entry) => {
                const isActive = entry.id === active;
                const Icon = Icons[entry.icon];
                return (
                  <Link
                    key={entry.id}
                    href={`/admin/settings?section=${entry.id}`}
                    className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full border text-xs ${
                      isActive
                        ? 'bg-brand-50 border-brand-200 text-brand-700'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {entry.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Desktop: vertical grouped nav */}
          <nav className="hidden md:block bg-white border border-slate-200 rounded-xl p-2">
            {NAV.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? 'mt-3' : ''}>
                <div className="px-2.5 py-1.5 text-[10px] tracking-widest uppercase text-slate-400">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.entries.map((entry) => {
                    const isActive = entry.id === active;
                    const Icon = Icons[entry.icon];
                    return (
                      <li key={entry.id}>
                        <Link
                          href={`/admin/settings?section=${entry.id}`}
                          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition ${
                            isActive
                              ? 'bg-brand-50 text-brand-700 font-medium'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <Icon
                            className={`w-4 h-4 flex-shrink-0 ${
                              isActive ? 'text-brand-600' : 'text-slate-400'
                            }`}
                          />
                          <span className="truncate">{entry.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Active section slot */}
        <div className="min-w-0">
          <ActiveSection id={active} />
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto px-4 py-8 text-slate-400">
          Loading…
        </div>
      }
    >
      <SettingsShell />
    </Suspense>
  );
}
