'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function CoverPage() {
  const [config, setConfig] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((d) => {
      if (d.ok) setConfig(d.config || {});
    });
  }, []);

  const fee = config.DEFAULT_ENTRY_FEE || '—';
  const cutoff = config.EVENT_CUTOFF_HOUR || '2';
  const eventDate = config.EVENT_DATE || '—';

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Policy</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Cover</h1>
      <p className="text-sm text-slate-400 mt-1">
        How the cover charge works at your venue. Every guest's entry fee becomes a redeemable
        wallet balance they can spend on F&B during the event.
      </p>

      <div className="card mt-6">
        <div className="font-semibold text-slate-900">Current policy</div>
        <ul className="mt-3 text-sm text-slate-700 space-y-2">
          <li>
            <span className="text-slate-500">Policy:</span>{' '}
            <span className="text-slate-900">Cover = Entry Fee (1:1)</span>
          </li>
          <li>
            <span className="text-slate-500">Default entry fee:</span>{' '}
            <span className="text-slate-900">₹{fee}</span>
          </li>
          <li>
            <span className="text-slate-500">Event date:</span>{' '}
            <span className="text-slate-900">{eventDate}</span>
          </li>
          <li>
            <span className="text-slate-500">Wallets valid until:</span>{' '}
            <span className="text-slate-900">{cutoff.padStart(2, '0')}:00 IST the next day</span>
          </li>
        </ul>
      </div>

      <div className="card mt-4">
        <div className="font-semibold text-slate-900">How it works</div>
        <ol className="mt-3 text-sm text-slate-700 space-y-3 list-decimal list-inside marker:text-slate-500">
          <li>
            Bouncer collects entry fee (cash, UPI, card, online, or comps) and issues a wallet
            with QR + QR Code ID equal to the fee.
          </li>
          <li>
            Guest walks around with their QR. Any captain on the floor can redeem against the
            wallet — amount is debited live, QR Code ID required for every redeem.
          </li>
          <li>
            Wallet expires automatically at the cutoff hour of the following day (IST). After
            that, remaining balance lapses — this is the venue's revenue insight (unredeemed).
          </li>
          <li>
            Cashier reconciles the system's redeem total against POS/bar billing at close-out.
          </li>
        </ol>
      </div>

      <div className="card mt-4">
        <div className="font-semibold text-slate-900">Change policy</div>
        <p className="text-sm text-slate-400 mt-2">
          Cover policy is controlled via venue settings. Edit the default entry fee, event date,
          and cutoff hour in <Link className="text-sky-600 hover:text-sky-700" href="/admin/settings">Settings</Link>.
        </p>
      </div>

      <div className="card mt-4 border-amber-200 bg-amber-50">
        <div className="font-semibold text-amber-700">Not yet configurable</div>
        <ul className="mt-2 text-sm text-slate-700 space-y-1">
          <li>Per-event cover amount (currently 1:1 with entry fee)</li>
          <li>Partial cover (e.g., ₹1500 entry → ₹1200 cover, ₹300 house fee)</li>
          <li>Time-of-night pricing (early bird / VIP / couple entry)</li>
          <li>Excluded-item list (e.g., cover not valid on tobacco)</li>
        </ul>
        <p className="text-xs text-slate-500 mt-3">
          These are one-liners to add — tell me which you need first.
        </p>
      </div>
    </div>
  );
}
