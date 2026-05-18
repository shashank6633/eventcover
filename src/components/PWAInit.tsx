'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker. Mounted once from the root layout.
 * Silent on failure (e.g. dev hot-reload, private mode).
 */
export function PWAInit() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Defer registration so it doesn't compete with initial paint
    const id = window.setTimeout(() => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => { /* swallow — PWA is best-effort */ });
    }, 1500);

    return () => window.clearTimeout(id);
  }, []);

  return null;
}
