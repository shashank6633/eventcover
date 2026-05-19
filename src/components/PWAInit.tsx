'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker and toggles a `standalone` class on <html>
 * when the app is running as an installed PWA. The class lets globals.css
 * disable overscroll bounce and apply other app-only polish.
 */
export function PWAInit() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(display-mode: standalone)');
    const apply = (on: boolean) => {
      document.documentElement.classList.toggle('standalone', on);
    };
    apply(mql.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener('change', onChange);

    if (!('serviceWorker' in navigator)) {
      return () => mql.removeEventListener('change', onChange);
    }

    const id = window.setTimeout(() => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => { /* swallow — PWA is best-effort */ });
    }, 1500);

    return () => {
      window.clearTimeout(id);
      mql.removeEventListener('change', onChange);
    };
  }, []);

  return null;
}
