'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { ROLE_LABEL, type UserRole } from '@/lib/roles';
import { InstallButton } from '@/components/InstallButton';

type NavItem = { href: string; label: string; icon: React.ReactNode; roles: UserRole[] };
type NavSection = { section: string; items: NavItem[] };

const ROLES_ALL: UserRole[] = ['host', 'manager', 'cashier', 'captain', 'entry'];
const ROLES_MGMT: UserRole[] = ['host', 'manager'];
const ROLES_CASHIER: UserRole[] = ['host', 'manager', 'cashier'];

const NAV: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { href: '/admin',         label: 'Events',            icon: <IconCalendar />, roles: ROLES_MGMT },
      { href: '/admin/analytics', label: 'Analytics',       icon: <IconChart />,    roles: ROLES_CASHIER },
    ],
  },
  {
    section: 'Schedule',
    items: [
      { href: '/admin/venues',       label: 'Venues',           icon: <IconBuilding />, roles: ROLES_MGMT },
      { href: '/admin/artists',      label: 'Artists / Event Hosts', icon: <IconMic />,  roles: ROLES_MGMT },
    ],
  },
  {
    section: 'Operations',
    items: [
      { href: '/admin/tickets',           label: 'Offline Ticketing',       icon: <IconTicket />, roles: ROLES_MGMT },
      { href: '/admin/tickets-status',    label: 'Offline Tickets Status',  icon: <IconList />,   roles: ROLES_MGMT },
      { href: '/admin/cashier',           label: 'Cashier',                 icon: <IconCash />,   roles: ROLES_CASHIER },
      { href: '/admin/issue',             label: 'Issue Cover',             icon: <IconPlus />,   roles: ['host', 'manager', 'entry'] },
      { href: '/admin/redeem',            label: 'Redeem Cover',            icon: <IconScan />,   roles: ['host', 'manager', 'captain'] },
      { href: '/admin/history',           label: 'History',                 icon: <IconClock />,  roles: ROLES_CASHIER },
      { href: '/admin/cover',             label: 'Cover',                   icon: <IconShield />, roles: ROLES_MGMT },
      { href: '/admin/reservations',      label: 'Reservations',            icon: <IconInbox />,  roles: ROLES_MGMT },
      { href: '/admin/tables',            label: 'Tables',                  icon: <IconGrid />,   roles: ROLES_MGMT },
      { href: '/admin/people',            label: 'People',                  icon: <IconUsers />,  roles: ROLES_MGMT },
    ],
  },
  {
    section: 'Growth',
    items: [
      { href: '/admin/affiliates', label: 'Affiliates',       icon: <IconTrend />, roles: ROLES_MGMT },
      { href: '/admin/payouts',    label: 'Affiliate Payouts',icon: <IconWallet />,roles: ROLES_MGMT },
    ],
  },
  {
    section: 'Configuration',
    items: [
      { href: '/admin/staff',    label: 'Staff',         icon: <IconShieldUser />,  roles: ROLES_ALL },
      { href: '/admin/settings', label: 'Settings',      icon: <IconCog />,         roles: ROLES_MGMT },
      { href: '/admin/tnc',      label: 'Terms',         icon: <IconDoc />,         roles: ROLES_MGMT },
    ],
  },
];

interface Me { id: string; name: string; role: UserRole; phone: string; email?: string | null }
interface Branding { venueName: string; venueLogo: string }

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [branding, setBranding] = useState<Branding>({ venueName: 'EventCover', venueLogo: '' });

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => {
      if (r.status === 401) { router.replace(`/login?next=${encodeURIComponent(pathname)}`); return null; }
      return r.json();
    }).then((d) => { if (d?.ok) setMe(d.user); });
    fetch('/api/branding')
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setBranding({ venueName: d.venueName, venueLogo: d.venueLogo }); });
  }, [pathname, router]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  const pageTitle = useMemo(() => {
    // Sub-routes not represented in the sidebar — resolve to a sensible title.
    if (pathname.startsWith('/admin/events')) return 'Events';
    if (pathname.startsWith('/admin/bookings')) return 'Bookings';

    for (const sec of NAV) {
      for (const it of sec.items) {
        if (it.href === '/admin' && pathname === '/admin') return it.label;
        if (it.href !== '/admin' && (pathname === it.href || pathname.startsWith(it.href + '/'))) {
          return it.label;
        }
      }
    }
    return 'Admin';
  }, [pathname]);

  return (
    <div className="min-h-screen flex bg-[#F8F7F4]">
      {/* Mobile top bar — extends under the iOS status bar in standalone mode */}
      <div
        className="md:hidden fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-200 flex items-center px-4"
        style={{
          height: 'calc(3.5rem + env(safe-area-inset-top))',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="p-2 -ml-2 rounded text-slate-700">
          <IconMenu />
        </button>
        <div className="ml-3 text-sm font-semibold text-slate-900">{pageTitle}</div>
        {me && (
          <div className="ml-auto flex items-center gap-2">
            <Avatar name={me.name} />
          </div>
        )}
      </div>

      {open && <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />}

      {/* Sidebar */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-50 md:z-0 h-screen w-64 shrink-0
                    bg-[#FAFAF7] border-r border-slate-200 overflow-y-auto
                    transition-transform md:translate-x-0 flex flex-col
                    ${open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Brand */}
        <div className="px-5 py-5 flex items-center gap-2 border-b border-slate-200">
          <BrandMark logo={branding.venueLogo} venueName={branding.venueName} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] tracking-[0.25em] uppercase text-slate-500 leading-none truncate">
              {branding.venueName || 'Akan'}
            </div>
            <div className="text-sm font-semibold text-slate-900 mt-0.5">EventCover</div>
          </div>
          <button aria-label="Close menu" className="md:hidden p-1.5 rounded text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}>
            <IconX />
          </button>
        </div>

        {/* Nav */}
        <nav className="py-3 flex-1">
          {NAV.map((section) => {
            const visible = me ? section.items.filter((it) => it.roles.includes(me.role)) : [];
            if (visible.length === 0) return null;
            return (
              <div key={section.section} className="mb-3 px-3">
                <div className="px-3 pt-2 pb-1.5 text-[9px] tracking-[0.18em] uppercase text-slate-400 font-medium">
                  {section.section}
                </div>
                <ul className="space-y-0.5">
                  {visible.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition ${
                            active
                              ? 'bg-brand-100 text-brand-700 font-semibold'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          <span className={`w-4 h-4 inline-flex items-center justify-center ${active ? 'text-brand-600' : 'text-slate-400'}`}>
                            {item.icon}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* User pill */}
        {me && (
          <div className="px-3 pb-4 pt-2 border-t border-slate-200">
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-white border border-slate-200">
              <Avatar name={me.name} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1">
                  {me.name}
                  <VerifiedBadge />
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {me.email || me.phone}
                </div>
              </div>
              <button onClick={logout} className="text-slate-400 hover:text-slate-900 p-1" aria-label="Sign out">
                <IconOut />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main with top header */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Desktop top header bar */}
        <header className="hidden md:flex sticky top-0 z-30 h-16 bg-[#F8F7F4]/95 backdrop-blur border-b border-slate-200 items-center px-8">
          <h1 className="text-xl font-bold text-slate-900">{pageTitle}</h1>
          <div className="ml-auto flex items-center gap-3">
            {me && (
              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white border border-slate-200">
                <Avatar name={me.name} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1">
                    {me.name}
                    <VerifiedBadge />
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{me.email || me.phone}</div>
                </div>
                <button onClick={logout} className="text-slate-400 hover:text-slate-900 p-1 ml-1" aria-label="Sign out">
                  <IconOut />
                </button>
              </div>
            )}
          </div>
        </header>

        <main
          className="flex-1 min-w-0
                     pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-0
                     pb-[env(safe-area-inset-bottom)]"
        >
          {children}
        </main>
      </div>

      {/* Install-to-home-screen prompt (only shows when beforeinstallprompt fires) */}
      <InstallButton />
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(href + '/');
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  );
}

function VerifiedBadge() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="#C1551A" aria-hidden>
      <path d="M12 2l2.4 1.8 3-.3.8 2.9 2.6 1.6-1.1 2.8 1.1 2.8-2.6 1.6-.8 2.9-3-.3L12 22l-2.4-1.8-3 .3-.8-2.9-2.6-1.6 1.1-2.8-1.1-2.8 2.6-1.6.8-2.9 3 .3z"/>
      <path d="M8 12l2.5 2.5L16 9" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function BrandMark({ logo, venueName }: { logo?: string; venueName?: string }) {
  // When a venue logo is uploaded, use it. Otherwise fall back to the first
  // letter of the venue name on the brand-color tile.
  if (logo) {
    return (
      <div className="w-9 h-9 rounded-lg overflow-hidden bg-white border border-slate-200 shadow-card flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={`${venueName || 'Venue'} logo`} className="w-full h-full object-contain" />
      </div>
    );
  }
  const initial = (venueName || 'A').trim().charAt(0).toUpperCase() || 'A';
  return (
    <div className="w-9 h-9 rounded-lg bg-brand-500 text-white flex items-center justify-center font-bold text-sm shadow-card">
      {initial}
    </div>
  );
}

function svg(children: React.ReactNode) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
function IconCalendar() { return svg(<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>); }
function IconChart()    { return svg(<><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-7"/></>); }
function IconUsers()    { return svg(<><circle cx="9" cy="8" r="4"/><path d="M17 11a3 3 0 1 0-3-3"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></>); }
function IconPlus()     { return svg(<><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>); }
function IconScan()     { return svg(<><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M21 7V5a2 2 0 0 0-2-2h-2"/><path d="M3 17v2a2 2 0 0 0 2 2h2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 12h10"/></>); }
function IconCash()     { return svg(<><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></>); }
function IconGrid()     { return svg(<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>); }
function IconTicket()   { return svg(<><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M13 6v12"/></>); }
function IconList()     { return svg(<><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></>); }
function IconClock()    { return svg(<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>); }
function IconShield()   { return svg(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></>); }
function IconDoc()      { return svg(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></>); }
function IconCog()      { return svg(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>); }
function IconBuilding() { return svg(<><rect x="4" y="3" width="16" height="18"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></>); }
function IconMic()      { return svg(<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></>); }
function IconInbox()    { return svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>); }
function IconShieldUser() { return svg(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><circle cx="12" cy="11" r="2.5"/><path d="M8 17c.8-1.5 2.3-2.5 4-2.5s3.2 1 4 2.5"/></>); }
function IconOut()      { return svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></>); }
function IconMenu()     { return svg(<><path d="M3 6h18M3 12h18M3 18h18"/></>); }
function IconX()        { return svg(<><path d="M18 6L6 18M6 6l12 12"/></>); }
function IconTrend()    { return svg(<><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></>); }
function IconWallet()   { return svg(<><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="15" r="1.5"/></>); }
