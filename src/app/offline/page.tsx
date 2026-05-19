'use client';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-brand-500 text-white text-2xl font-bold flex items-center justify-center mx-auto shadow-card">
          E
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          EventCover needs an internet connection to issue and redeem covers in real time.
          Check your Wi-Fi or mobile data and try again.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Already-issued wallets remain valid — your guests aren&apos;t blocked.
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn btn-primary mt-6"
        >
          Try again
        </button>

        <div className="mt-8 text-[11px] uppercase tracking-widest text-slate-400">
          EventCover by Akan
        </div>
      </div>
    </div>
  );
}
