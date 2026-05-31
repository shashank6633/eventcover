'use client';

import { useEffect } from 'react';

/**
 * Global affiliate-ref capture. Runs on mount, then again whenever the
 * URL changes (App Router pushState). Reads ?ref=CODE OR ?t=CODE from
 * the URL (both are aliases for the same attribution slot), stores it
 * in a 30-day cookie + localStorage, and fires a one-time click to
 * /api/affiliate/click.
 *
 * ?t= is the canonical URL form for per-event Tracking Links (the
 * non-commission Promote tab); ?ref= is the original commission-affiliate
 * form. Both flow through the same cookie (single attribution slot —
 * last-touch wins) and the same backend lookup via getAffiliateByCode().
 * If BOTH appear on the same URL, ?t= wins because it's the more
 * specific channel-attribution param.
 *
 * Last-click attribution: a new ?ref=/?t= ALWAYS overwrites the previous
 * cookie within the 30-day window.
 *
 * Mounted once globally from src/app/layout.tsx.
 */

const COOKIE_NAME = 'ec_ref';
const STORAGE_KEY = 'ec_ref';
const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

function writeCookie(value: string) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + TTL_MS).toUTCString();
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function readCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeCode(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,32}$/.test(upper)) return null;
  return upper;
}

function captureFromUrl() {
  if (typeof window === 'undefined') return;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  // ?t= (Tracking Link) takes priority over ?ref= when both are present —
  // it's the more specific channel-attribution param surfaced by the
  // per-event Promote page. Falls back to ?ref= for legacy commission
  // affiliate URLs. Both write into the same cookie slot — last touch
  // wins exactly the same way regardless of which param was used.
  const code = normalizeCode(params.get('t')) || normalizeCode(params.get('ref'));
  if (!code) return;

  // Always overwrite cookie + storage — last-click rule
  writeCookie(code);
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ code, ts: Date.now() }),
    );
  } catch {
    /* localStorage may be disabled */
  }

  // Fire click once per browser session per code so a customer who
  // refreshes the page doesn't inflate the click count.
  const sessionKey = `ec_ref_logged:${code}`;
  try {
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');
  } catch {
    // sessionStorage blocked — still send the click (worst case: double-counts on refresh)
  }

  // Try to capture event id: prefer explicit ?event=ID query param, fall
  // back to /event/[slug] path pattern.
  let eventId: string | null = params.get('event') || null;
  if (!eventId) {
    const match = window.location.pathname.match(/\/event\/([^/?#]+)/);
    if (match) eventId = match[1];
  }

  fetch('/api/affiliate/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      eventId,
      referer: document.referrer || null,
    }),
    keepalive: true,
  }).catch(() => { /* fire-and-forget */ });
}

export function RefCapture() {
  useEffect(() => {
    // Run on first mount
    captureFromUrl();

    // App Router doesn't fire popstate on pushState, so also patch
    // the history API to catch ?ref= added by client-side nav.
    const origPush = history.pushState;
    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      const ret = origPush.apply(this, args);
      // Defer to next tick so window.location is up-to-date
      setTimeout(captureFromUrl, 0);
      return ret;
    };

    return () => {
      history.pushState = origPush;
    };
  }, []);

  // Also expose the current value for any consumer that needs it
  // (e.g. a future public booking flow that POSTs the cookie value).
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __getAffRef?: () => string | null };
    if (!w.__getAffRef) w.__getAffRef = readCookie;
  }

  return null;
}
