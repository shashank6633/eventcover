'use client';

/**
 * /admin/analytics — two-tab layout.
 *
 *   Dashboard (default)   high-level KPI cards + 5 charts driven by
 *                         /api/analytics/dashboard
 *   Ledger                the original cashier-style transaction feed.
 *                         Extracted into <AnalyticsLedger /> so this
 *                         page stays a thin tab shell.
 *
 * Each tab is rendered independently — the inactive tab never fetches.
 * Tab state is local (no router push, no full reload). We also accept
 * an optional ?tab=ledger query param on first paint so deep links into
 * the ledger from existing bookmarks keep working.
 *
 * Next.js 15: useSearchParams must live inside a Suspense boundary at
 * build time. The outer component is the suspense shell; the inner
 * AnalyticsTabs reads the param and owns tab state.
 *
 * AdminShell wraps every /admin route via src/app/admin/layout.tsx, so
 * this page does NOT import AdminShell on its own.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import AnalyticsLedger from '@/components/AnalyticsLedger';

type TabKey = 'dashboard' | 'ledger';

export default function AnalyticsPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Analytics</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Cover</h1>
      <Suspense fallback={<TabsFallback />}>
        <AnalyticsTabs />
      </Suspense>
    </div>
  );
}

function AnalyticsTabs() {
  const search = useSearchParams();
  const initialTab: TabKey = search?.get('tab') === 'ledger' ? 'ledger' : 'dashboard';
  const [tab, setTab] = useState<TabKey>(initialTab);

  // Allow the URL ?tab= to win on navigation between tabs from other links.
  useEffect(() => {
    const t = search?.get('tab');
    if (t === 'ledger' || t === 'dashboard') setTab(t);
  }, [search]);

  return (
    <>
      <div className="mt-4 inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1">
        <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</TabButton>
        <TabButton active={tab === 'ledger'} onClick={() => setTab('ledger')}>Ledger</TabButton>
      </div>
      <div className="mt-5">
        {tab === 'dashboard' ? <AnalyticsDashboard /> : <AnalyticsLedger />}
      </div>
    </>
  );
}

function TabsFallback() {
  return (
    <div className="mt-5 text-slate-400 text-sm">Loading…</div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
        active
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}
