'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function LogoutPage() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      localStorage.removeItem('ec_captain');
      localStorage.removeItem('ec_bouncer');
    } catch {}
    setDone(true);
  }, []);

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="card text-center">
        <div className="text-[11px] tracking-widest uppercase text-slate-400">Session</div>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Logged out</h1>
        <p className="text-sm text-slate-400 mt-2">
          Cleared cached staff names from this device.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link className="btn btn-primary" href="/admin">Back to dashboard</Link>
          <Link className="btn btn-secondary" href="/admin/issue">Issue cover (bouncer)</Link>
        </div>

        <div className="mt-6 text-xs text-slate-500 leading-relaxed">
          Note: this prototype has no real auth — "logout" only clears the captain/bouncer
          names stored locally. Real session auth ships with the production build.
        </div>
        {done && <div className="hidden">ok</div>}
      </div>
    </div>
  );
}
