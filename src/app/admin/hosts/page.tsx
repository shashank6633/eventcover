'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function HostManagementPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<{ walletsIssued: number; walletsActive: number; totalCoverIssued: number } | null>(null);

  useEffect(() => {
    fetch('/api/dashboard').then((r) => r.json()).then((d) => {
      if (d.ok) { setConfig(d.config || {}); setStats(d.kpis); }
    });
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Multi-venue</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Host management</h1>
      <p className="text-sm text-slate-400 mt-1">
        A host is an operator that runs one or more venues on EventCover. This local prototype
        runs as a single-host deployment.
      </p>

      <div className="card mt-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] tracking-wider uppercase text-emerald-700">Primary host</div>
            <div className="text-xl font-semibold text-slate-900 mt-1">{config.VENUE_NAME || 'Unnamed venue'}</div>
            <div className="text-sm text-slate-400 mt-0.5">
              {config.HOST_EMAIL || 'email not set'}
              {config.HOST_PHONE ? ` · ${config.HOST_PHONE}` : ''}
            </div>
          </div>
          <span className="tag tag-active">Active</span>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-5">
          <MiniStat label="Wallets issued" value={stats?.walletsIssued ?? 0} />
          <MiniStat label="Active wallets" value={stats?.walletsActive ?? 0} />
          <MiniStat label="Cover issued (₹)" value={stats ? stats.totalCoverIssued.toLocaleString('en-IN') : '0'} />
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Edit host details in{' '}
          <Link className="text-sky-600 hover:text-sky-700" href="/admin/settings">Settings</Link>.
        </div>
      </div>

      <div className="card mt-4 border-amber-200 bg-amber-50">
        <div className="font-semibold text-amber-700">Coming with production</div>
        <ul className="mt-2 text-sm text-slate-700 space-y-1 list-disc list-inside marker:text-slate-500">
          <li>Multi-host tenancy (platform owner manages multiple venues)</li>
          <li>Per-host billing + subscription tier (Basic / Pro / Enterprise)</li>
          <li>Per-host Razorpay key configuration</li>
          <li>Consolidated cross-venue analytics for chain operators</li>
          <li>Host-level audit log + data export</li>
        </ul>
        <p className="text-xs text-slate-500 mt-3">
          This page will list all hosts when the SaaS backend (NestJS + Postgres + row-level
          security) is built. See the system design doc.
        </p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-[10px] tracking-wider uppercase text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );
}
