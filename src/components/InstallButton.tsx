'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed-at';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return;

    function onPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === 'dismissed') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDeferred(null);
  }

  if (installed || !deferred) return null;

  return (
    <div
      className="fixed bottom-4 inset-x-4 z-50 md:left-auto md:right-4 md:w-[340px] rounded-xl border border-brand-200 bg-white shadow-card-hover p-3 flex items-center gap-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      role="dialog"
      aria-label="Install EventCover"
    >
      <div className="w-9 h-9 rounded-lg bg-brand-500 text-white flex items-center justify-center font-bold flex-shrink-0">
        E
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">Install EventCover</div>
        <div className="text-[11px] text-slate-500 leading-tight mt-0.5">
          Add to home screen for one-tap door access.
        </div>
      </div>
      <button
        onClick={dismiss}
        className="text-slate-400 hover:text-slate-700 text-xs px-2 py-1 rounded"
        aria-label="Dismiss install prompt"
      >
        Later
      </button>
      <button
        onClick={install}
        className="btn btn-primary !py-1.5 !px-3 text-xs font-semibold"
      >
        Install
      </button>
    </div>
  );
}
