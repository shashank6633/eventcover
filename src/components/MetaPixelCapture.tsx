'use client';

import { useEffect } from 'react';

/**
 * Global Meta Pixel click-ID capture. Runs on mount, then again whenever the
 * URL changes (App Router pushState). Reads ?fbclid=... from the URL and
 * writes it to the `_fbc` cookie in Meta's expected format:
 *
 *   fb.<subdomain_index>.<creation_time_ms>.<fbclid>
 *
 * - subdomain_index: 1  (safe default that works for root + www domains)
 * - creation_time_ms: Date.now()
 * - fbclid:          raw value from the URL
 *
 * Cookie is set with a 90-day expiry, SameSite=Lax, path=/. Mirrors the
 * structure of RefCapture.tsx (?ref= → ec_ref cookie).
 *
 * Also exposes window.__getFbCookies() so other client code (e.g. the
 * PublicBookingForm) can read the current { fbp, fbc } pair without
 * re-parsing document.cookie itself.
 *
 * Mounted once globally from src/app/layout.tsx — runs on EVERY page so a
 * customer who lands on /admin or / first and only later navigates to the
 * public event page still has their fbclid persisted.
 */

const FBC_COOKIE = '_fbc';
const FBP_COOKIE = '_fbp';
const TTL_DAYS = 90;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;
const SUBDOMAIN_INDEX = 1; // safe for root + single-level subdomain

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + TTL_MS).toUTCString();
  // NB: value is NOT URI-encoded here — Meta's Pixel JS writes the raw
  // formatted string and CAPI expects the raw value back.
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function normalizeFbclid(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Meta fbclid values are URL-safe base64-ish strings. Keep them as-is
  // beyond a minimal length sanity check.
  if (trimmed.length < 4 || trimmed.length > 512) return null;
  return trimmed;
}

function captureFromUrl() {
  if (typeof window === 'undefined') return;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  const fbclid = normalizeFbclid(params.get('fbclid'));
  if (!fbclid) return;

  // Always overwrite _fbc on a fresh fbclid — last-click attribution.
  const creationTime = Date.now();
  const formatted = `fb.${SUBDOMAIN_INDEX}.${creationTime}.${fbclid}`;
  writeCookie(FBC_COOKIE, formatted);
}

export function MetaPixelCapture() {
  useEffect(() => {
    // Run on first mount
    captureFromUrl();

    // App Router doesn't fire popstate on pushState, so patch the history
    // API to catch ?fbclid= added by client-side navigation too.
    const origPush = history.pushState;
    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      const ret = origPush.apply(this, args);
      setTimeout(captureFromUrl, 0);
      return ret;
    };

    return () => {
      history.pushState = origPush;
    };
  }, []);

  // Expose a helper for the booking form / any future consumer that needs to
  // read the current fbp/fbc pair off document.cookie.
  if (typeof window !== 'undefined') {
    const w = window as unknown as {
      __getFbCookies?: () => { fbp: string | null; fbc: string | null };
    };
    if (!w.__getFbCookies) {
      w.__getFbCookies = () => ({
        fbp: readCookie(FBP_COOKIE),
        fbc: readCookie(FBC_COOKIE),
      });
    }
  }

  return null;
}
