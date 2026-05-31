'use client';

import { useEffect } from 'react';

/**
 * Per-event analytics tracker. Mounted at the top of /event/[slug].
 *
 * What it does:
 *   1. On mount, generates (or reads) a stable session id from sessionStorage
 *      under the key 'evt_session_id'. This survives same-tab navigations so
 *      the same visitor doesn't get counted as N different sessions when they
 *      hit the back button or reload.
 *   2. Fires a single 'page_view' event for the (eventId, session) pair,
 *      deduped via the sessionStorage flag 'evt_pv_<eventId>'. React 18+
 *      StrictMode + bfcache can mount-twice; the flag means we still emit
 *      exactly once per session per event.
 *   3. Exposes a global `window.__trackEvent(kind, metadata)` helper so that
 *      other client components on the same page (PublicBookingForm,
 *      SeatingPicker, EventCTAs) can fire taxonomy events without
 *      prop-drilling the session id. Calls are fire-and-forget — a 404 or
 *      network error never throws into the caller.
 *
 * Backend contract:
 *   POST /api/analytics/track  { eventId, sessionId, kind, metadata? } → 204
 *
 * Failure mode: the endpoint may not be deployed yet. We swallow ALL errors
 * (network, 4xx, 5xx) silently so the public booking form keeps working.
 */

type TrackKind =
  | 'page_view'
  | 'book_click'
  | 'ticket_selected'
  | 'checkout_started'
  | 'payment_initiated'
  | 'checkout_success'
  | 'checkout_failed'
  | 'page_scroll_depth';

declare global {
  interface Window {
    __trackEvent?: (kind: TrackKind, metadata?: Record<string, unknown>) => void;
  }
}

interface Props {
  eventId: string;
  /**
   * Phased Ticket Releases — when supplied, the tracker also runs a
   * low-frequency 60s poll against /api/events/by-slug/[slug]/public to
   * detect when the active phase transitions (sellout OR deadline). On
   * transition it dispatches a `phase_changed` window event so
   * <PublicBookingForm/> can re-fetch and refresh prices in-place without
   * forcing a full page reload.
   *
   * Optional + nullable so legacy callers / events without phases skip the
   * extra network traffic entirely.
   */
  eventSlug?: string;
  /**
   * Initial active phase id from the server-rendered payload. Used as the
   * baseline for the 60s poll's "did it change?" comparison. null when no
   * phases are configured (the poll then short-circuits and never fires
   * phase_changed).
   */
  activePhaseId?: string | null;
}

const SESSION_KEY = 'evt_session_id';

/**
 * Extract referrer + UTM attribution for the page_view event so the
 * "Traffic Sources" widget on /admin/events/[id]/insights can group sessions
 * by source. We strip the referrer down to its host only (no path/query) and
 * deliberately treat internal navigation (referrer host === current host) as
 * "direct" so a same-site click doesn't pollute the chart.
 *
 * Returns an object with `undefined` fields when nothing useful is available
 * — JSON.stringify drops them, keeping the payload compact.
 */
function readTrafficSource(): {
  referrerHost?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
} {
  if (typeof window === 'undefined') return {};
  const out: {
    referrerHost?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  } = {};
  try {
    const ref = document.referrer || '';
    if (ref) {
      const refUrl = new URL(ref);
      // Internal navigation — treat as direct, don't record the host.
      if (refUrl.host && refUrl.host !== window.location.host) {
        out.referrerHost = refUrl.host;
      }
    }
  } catch {
    // Malformed referrer URL — leave host blank.
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source');
    const utmMedium = params.get('utm_medium');
    const utmCampaign = params.get('utm_campaign');
    if (utmSource && utmSource.trim()) out.utmSource = utmSource.trim().slice(0, 64);
    if (utmMedium && utmMedium.trim()) out.utmMedium = utmMedium.trim().slice(0, 64);
    if (utmCampaign && utmCampaign.trim()) out.utmCampaign = utmCampaign.trim().slice(0, 64);
  } catch {
    // URLSearchParams threw — skip UTM enrichment.
  }
  return out;
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 8) return existing;
    // crypto.randomUUID is available in modern browsers; fall back to a
    // timestamp + random pair so we never throw in older WebViews.
    const fresh =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage can throw in privacy mode / disabled storage. Return a
    // per-tab in-memory id so we still ship events; they just won't dedup
    // across reloads.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function postTrack(
  eventId: string,
  sessionId: string,
  kind: TrackKind,
  metadata?: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  // Fire-and-forget. We deliberately don't await — the booking form should
  // never wait on analytics, and the page render must not be blocked.
  try {
    const body = JSON.stringify({ eventId, sessionId, kind, metadata });
    // Prefer sendBeacon for late-firing events (e.g. checkout_started fired
    // right before a Razorpay redirect). Fall back to fetch with keepalive.
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      const blob = new Blob([body], { type: 'application/json' });
      // sendBeacon returns false when the payload is too large; in that case
      // we fall through to fetch.
      if (navigator.sendBeacon('/api/analytics/track', blob)) return;
    }
    void fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Endpoint may not exist yet (404) or network may be flaky. Swallow.
    });
  } catch {
    // JSON.stringify or Blob constructor failed — give up silently.
  }
}

export function EventAnalyticsTracker({
  eventId,
  eventSlug,
  activePhaseId = null,
}: Props) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!eventId) return;

    const sessionId = getOrCreateSessionId();
    if (!sessionId) return;

    // Install the global track helper. Always overwrite — if a previous
    // tracker for a different eventId is still on the page (shouldn't
    // happen, but be defensive) the latest one wins.
    window.__trackEvent = (kind, metadata) => {
      try {
        postTrack(eventId, sessionId, kind, metadata);
      } catch {
        // Never let an analytics call throw into the booking form.
      }
    };

    // Dedup page_view per (event, session) — React StrictMode double-mounts
    // useEffect in dev; bfcache restores can also fire mount-like events.
    const pvFlagKey = `evt_pv_${eventId}`;
    let alreadyFired = false;
    try {
      alreadyFired = window.sessionStorage.getItem(pvFlagKey) === '1';
    } catch {
      // sessionStorage unavailable — emit anyway; better to slightly
      // over-count than miss everything.
      alreadyFired = false;
    }

    if (!alreadyFired) {
      // Enrich the page_view with traffic-source attribution so the
      // dashboard's "Traffic Sources" widget can group by referrer + UTM.
      const source = readTrafficSource();
      const meta: Record<string, unknown> = {};
      if (source.referrerHost) meta.referrerHost = source.referrerHost;
      if (source.utmSource) meta.utmSource = source.utmSource;
      if (source.utmMedium) meta.utmMedium = source.utmMedium;
      if (source.utmCampaign) meta.utmCampaign = source.utmCampaign;
      postTrack(
        eventId,
        sessionId,
        'page_view',
        Object.keys(meta).length > 0 ? meta : undefined,
      );
      try {
        window.sessionStorage.setItem(pvFlagKey, '1');
      } catch {
        // Ignore — see above.
      }
    }

    // ---- Scroll-depth tracking ----
    // Fire `page_scroll_depth` exactly once per (event, session, threshold)
    // when the visitor first crosses the 25 / 50 / 75 / 100 % marks of the
    // page. Throttled via requestAnimationFrame so we never run the math
    // on every wheel tick. Dedup is persisted in sessionStorage so a
    // remount (StrictMode dev, bfcache restore) doesn't re-fire thresholds
    // the user already passed.
    const thresholds = [25, 50, 75, 100] as const;
    const firedThisMount = new Set<number>();
    function alreadyFiredDepth(pct: number): boolean {
      try {
        return (
          window.sessionStorage.getItem(`evt_scroll_${eventId}_${pct}`) === '1'
        );
      } catch {
        return firedThisMount.has(pct);
      }
    }
    function markFiredDepth(pct: number): void {
      firedThisMount.add(pct);
      try {
        window.sessionStorage.setItem(`evt_scroll_${eventId}_${pct}`, '1');
      } catch {
        // Storage disabled — fall back to in-memory set above.
      }
    }
    let scrollRafId: number | null = null;
    let scrollPending = false;
    function computeAndFire() {
      scrollPending = false;
      scrollRafId = null;
      try {
        const doc = document.documentElement;
        const body = document.body;
        const viewport = window.innerHeight || doc.clientHeight || 0;
        const fullHeight = Math.max(
          body.scrollHeight,
          doc.scrollHeight,
          body.offsetHeight,
          doc.offsetHeight,
          doc.clientHeight,
        );
        const scrolled =
          window.scrollY != null ? window.scrollY : doc.scrollTop || 0;
        // Page too short to scroll — treat as 100% reached so we don't
        // permanently miss the deepest threshold on small-content pages.
        if (fullHeight <= viewport) {
          for (const pct of thresholds) {
            if (!alreadyFiredDepth(pct)) {
              markFiredDepth(pct);
              postTrack(eventId, sessionId, 'page_scroll_depth', { depthPct: pct });
            }
          }
          return;
        }
        const reachedPct = ((scrolled + viewport) / fullHeight) * 100;
        for (const pct of thresholds) {
          if (reachedPct >= pct && !alreadyFiredDepth(pct)) {
            markFiredDepth(pct);
            postTrack(eventId, sessionId, 'page_scroll_depth', { depthPct: pct });
          }
        }
      } catch {
        // Defensive — never let scroll instrumentation throw into the page.
      }
    }
    function onScroll() {
      if (scrollPending) return;
      scrollPending = true;
      try {
        scrollRafId = window.requestAnimationFrame(computeAndFire);
      } catch {
        // rAF unavailable — run synchronously as a last resort.
        computeAndFire();
      }
    }
    // Run once on mount in case the page is already scrolled (bfcache
    // restore, refresh on a deep anchor, etc.).
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // ---- Phased Ticket Releases — 60s active-phase poll ----
    // When a slug + an initial activePhaseId are provided, we poll the
    // public event endpoint every 60s to detect phase transitions (either
    // the deadline elapsed or the phase sold out and the server flipped
    // to the next one). On a change we dispatch a `phase_changed` window
    // event so <PublicBookingForm/> can re-fetch its live prices in-place
    // without forcing a full page reload.
    //
    // The poll is intentionally cheap (one GET per minute, no metadata
    // posted) and short-circuits when eventSlug is absent OR the event
    // has no phases configured yet (activePhaseId starts null AND the
    // first poll response has no activePhase either).
    let phasePollId: number | null = null;
    let lastSeenPhaseId: string | null = activePhaseId;
    async function pollActivePhase() {
      if (!eventSlug) return;
      try {
        const res = await fetch(
          `/api/events/by-slug/${encodeURIComponent(eventSlug)}/public`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as {
          activePhase?: { id?: string | null } | null;
        } | null;
        const nextId =
          json && json.activePhase && typeof json.activePhase.id === 'string'
            ? json.activePhase.id
            : null;
        if (nextId !== lastSeenPhaseId) {
          lastSeenPhaseId = nextId;
          try {
            window.dispatchEvent(
              new CustomEvent('phase_changed', {
                detail: { activePhaseId: nextId, eventId, eventSlug },
              }),
            );
          } catch {
            // CustomEvent unavailable in some very old WebViews — fall back
            // to a plain Event so the listener still fires (it will just
            // see undefined detail).
            try {
              window.dispatchEvent(new Event('phase_changed'));
            } catch {
              // Give up silently — analytics must never throw.
            }
          }
        }
      } catch {
        // Network blip — try again on the next tick.
      }
    }
    if (eventSlug) {
      try {
        phasePollId = window.setInterval(pollActivePhase, 60_000);
      } catch {
        // setInterval unavailable — skip the poll, banner stays static.
      }
    }

    return () => {
      // Tear down scroll instrumentation so a SPA navigation to a different
      // event doesn't leave dangling listeners that fire against the wrong
      // eventId. The sessionStorage dedup flags persist across the tab so
      // a back-button restore still skips already-fired thresholds.
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (scrollRafId != null) {
        try {
          window.cancelAnimationFrame(scrollRafId);
        } catch {
          // Ignore — rAF may not be available.
        }
      }
      if (phasePollId != null) {
        try {
          window.clearInterval(phasePollId);
        } catch {
          // Ignore — clearInterval may not be available in exotic envs.
        }
      }
      // Leave the global helper installed across re-renders of this
      // component. Only delete it if the tracker is being unmounted for
      // good (eventId changed or page is unmounting). Since the only caller
      // is the public event page (one tracker per page), we clear it on
      // unmount so a future SPA navigation to a different event re-installs.
      if (window.__trackEvent) {
        try {
          delete window.__trackEvent;
        } catch {
          window.__trackEvent = undefined;
        }
      }
    };
  }, [eventId, eventSlug, activePhaseId]);

  return null;
}
