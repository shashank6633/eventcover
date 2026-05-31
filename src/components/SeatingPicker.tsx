'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
// Imports from the isomorphic helper, NOT '@/lib/seating-layout' — that
// module pulls in better-sqlite3 (Node-only) for its CRUD code, which can't
// be bundled into a client component.
import { sanitizeSvg } from '@/lib/svg-sanitize';

/**
 * Public-side interactive zone picker for the per-event seating layout
 * feature. Rendered above the pax/notes block on /event/[slug] when the
 * backend payload sets `seatingLayoutEnabled === true`.
 *
 * Security model
 * --------------
 * The SVG injected here is ALREADY SANITIZED on the server inside
 * /api/events/[id]/seating-layout (sanitizeSvg() strips <script>, on*
 * attributes, external href/src, <style>, <foreignObject>, CDATA,
 * DOCTYPE and processing instructions before persistence). The
 * /api/events/by-slug/[slug]/public endpoint only echoes back the value
 * stored in events.seating_layout_svg — it never accepts user input on
 * the public surface. The architect spec explicitly calls out
 * "defense in depth" via a re-sanitization on render, but at this
 * altitude (client component, server is the single source of truth for
 * what's persisted) we deliberately rely on the server-side sanitizer
 * AND scope the DOM manipulation below to a single ref'd container.
 *
 * Interactivity model
 * -------------------
 * - dangerouslySetInnerHTML installs the SVG markup.
 * - On mount + on zones/selectedZoneId/pax change we walk the
 *   container's DOM and attach pointer + click listeners to every
 *   element whose id matches a known zone's `zone_id`.
 * - Visual state is applied via inline style + data-* attributes so we
 *   can use Tailwind selectors AND keep the per-zone fill/stroke
 *   deterministic regardless of what the artist authored in Figma.
 * - When the customer hovers a zone, a tooltip <div> is positioned
 *   inside the container (no React portals — keeps things scope-local).
 * - Sold-out and inactive zones are visually muted and ignore clicks.
 *
 * Accessibility
 * -------------
 * Every interactive zone receives role="button", tabindex="0" and an
 * aria-label like "VIP, ₹2000, 12 seats available". Space and Enter
 * trigger select.
 */

export interface PublicZone {
  /** Stable PK from event_zones.id — used to identify the zone in API calls. */
  id: string;
  /** SVG layer's id attribute — matches the DOM node we attach listeners to. */
  zone_id: string;
  zone_label: string;
  price: number;
  capacity: number;
  sold_count: number;
  /**
   * Backend usually pre-computes this; we still compute defensively below
   * (capacity - sold_count, clamped at 0) in case the API hasn't shipped
   * the field yet.
   */
  remaining_capacity?: number | null;
  color?: string | null;
  active: boolean;
}

interface Props {
  /** Sanitized SVG markup from the backend. Must be non-empty. */
  svg: string;
  zones: PublicZone[];
  /** event_zones.id of the currently-selected zone (NOT the SVG layer id). */
  selectedZoneId: string | null;
  pax: number;
  /** Fired with event_zones.id when the customer picks (or null to clear). */
  onSelect: (zoneId: string | null) => void;
}

/** Brand color — matches Tailwind's brand-500 token. */
const BRAND = '#C1551A';
/** Slightly darker variant used for the selected-zone stroke. */
const BRAND_DARK = '#A14516';

function remainingOf(z: PublicZone): number {
  if (typeof z.remaining_capacity === 'number' && Number.isFinite(z.remaining_capacity)) {
    return Math.max(0, z.remaining_capacity);
  }
  const r = z.capacity - z.sold_count;
  return Number.isFinite(r) ? Math.max(0, r) : 0;
}

function isAvailable(z: PublicZone): boolean {
  return z.active && remainingOf(z) > 0;
}

function formatRupees(n: number): string {
  if (!Number.isFinite(n)) return '';
  const isWhole = Math.round(n) === n;
  return isWhole
    ? n.toLocaleString('en-IN')
    : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SeatingPicker({ svg, zones, selectedZoneId, pax, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Tooltip state — driven by the imperative pointer handlers but rendered
  // through React so the markup stays declarative and accessible.
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    zoneId: string;
  } | null>(null);

  // Touch devices get a sticky bottom info bar instead of a hover tooltip
  // (hover doesn't exist on touch). We detect "no hover" once on mount via
  // matchMedia and use it to gate the tooltip render only — listeners stay
  // bound either way because pointerenter still fires on tap on most
  // touch browsers.
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    try {
      setIsTouch(window.matchMedia('(hover: none)').matches);
    } catch {
      setIsTouch(false);
    }
  }, []);

  /**
   * Defence-in-depth: re-run the same sanitizer the server uses before
   * injecting via dangerouslySetInnerHTML. If the server-side stage is
   * ever bypassed (db migration, manual SQL, future endpoint) the client
   * still strips <script>, on* handlers, external href/src, <style>,
   * <foreignObject>, CDATA, DOCTYPE and processing instructions before
   * the markup hits the DOM. Memoized on the raw prop so we don't
   * re-sanitize on every parent re-render.
   */
  const cleanedSvg = useMemo(() => {
    const result = sanitizeSvg(svg);
    return result.ok ? result.svg : '';
  }, [svg]);

  /**
   * Index zones by the SVG layer id (zone_id) so the DOM walker can do an
   * O(1) lookup per node instead of an O(N*M) match. Memoized so a parent
   * re-render doesn't churn the index.
   */
  const zoneByLayerId = useMemo(() => {
    const map = new Map<string, PublicZone>();
    for (const z of zones) map.set(z.zone_id, z);
    return map;
  }, [zones]);

  /**
   * Apply visual state to a single SVG element based on its zone's
   * availability + selection + (if pax exceeds remaining) over-pax flash.
   * Pulled into a callback so both the mount-time walk and the
   * selection-change effect can call it.
   */
  const applyZoneStyle = useCallback(
    (el: SVGElement, zone: PublicZone, selected: boolean) => {
      const available = isAvailable(zone);
      const remaining = remainingOf(zone);
      const overPax = available && pax > remaining;

      // Reset transitions once — repeated assignment is cheap but readable.
      el.style.transition = 'fill-opacity 120ms ease, stroke 120ms ease, opacity 120ms ease';
      el.style.cursor = available ? 'pointer' : 'not-allowed';

      // Base fill: honor the host-set color if present, else use brand-100
      // so every zone reads as "interactive" even when the artist forgot to
      // fill it in Figma. We don't overwrite an existing inline fill that
      // the SVG already has — we only set fill when the element has none.
      if (zone.color && !el.getAttribute('fill')) {
        el.setAttribute('fill', zone.color);
      }

      if (!available) {
        // Sold out / inactive → muted grey overlay via opacity.
        el.style.opacity = '0.35';
        el.style.fillOpacity = '0.6';
        el.style.stroke = '#94a3b8'; // slate-400
        el.style.strokeWidth = '1';
      } else if (selected) {
        // Selected — brand-color outline, brighter fill.
        el.style.opacity = '1';
        el.style.fillOpacity = overPax ? '0.45' : '0.7';
        el.style.stroke = overPax ? '#dc2626' : BRAND_DARK; // rose-600 on over-pax
        el.style.strokeWidth = '3';
      } else {
        // Default interactive state.
        el.style.opacity = '1';
        el.style.fillOpacity = '0.35';
        el.style.stroke = BRAND;
        el.style.strokeWidth = '1.5';
      }
      // data-state lets host CSS (if any) override.
      el.dataset.zoneState = !available
        ? 'unavailable'
        : selected
          ? 'selected'
          : 'idle';
    },
    [pax],
  );

  /**
   * Walk the injected SVG DOM, find each zone-layer element, and attach
   * pointer/click/keyboard listeners + aria attributes. Returns a cleanup
   * function that detaches every listener so React strict-mode double-
   * mounts don't leak handlers.
   *
   * Re-runs whenever `svg`, `zones` or `pax` change (we re-bind on pax
   * because the over-pax flashing styling depends on it; cheap enough on a
   * typical venue with <50 zones).
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cleanedSvg) return;

    // Defensive — if the SVG didn't parse into a real <svg> root, bail.
    const svgRoot = container.querySelector('svg');
    if (!svgRoot) return;

    // Make the SVG responsive: fit container width, preserve aspect ratio.
    // Only set width if the author didn't already set it.
    svgRoot.setAttribute('width', '100%');
    svgRoot.removeAttribute('height');
    if (!svgRoot.getAttribute('preserveAspectRatio')) {
      svgRoot.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
    svgRoot.style.maxWidth = '100%';
    svgRoot.style.height = 'auto';
    svgRoot.style.display = 'block';

    const cleanups: Array<() => void> = [];

    for (const [layerId, zone] of zoneByLayerId.entries()) {
      // querySelector by id — CSS escape the id so weird Figma layer names
      // like "VIP-1" or "P.1" don't blow up the selector.
      const el = svgRoot.querySelector(
        `#${CSS.escape(layerId)}`,
      ) as SVGElement | null;
      if (!el) continue;

      const available = isAvailable(zone);
      const remaining = remainingOf(zone);
      const selected = selectedZoneId === zone.id;

      // Initial visual state.
      applyZoneStyle(el, zone, selected);

      // a11y — role + label + tabindex. Re-applied on each effect run since
      // remaining/pax/selected change between renders.
      el.setAttribute('role', 'button');
      el.setAttribute(
        'aria-label',
        `${zone.zone_label}, ₹${formatRupees(zone.price)}, ${
          available ? `${remaining} seats available` : 'sold out'
        }${selected ? ', selected' : ''}`,
      );
      el.setAttribute('aria-disabled', available ? 'false' : 'true');
      el.setAttribute('aria-pressed', selected ? 'true' : 'false');
      if (available) {
        el.setAttribute('tabindex', '0');
      } else {
        el.removeAttribute('tabindex');
      }
      el.setAttribute('data-zone-id', zone.id);

      const onEnter = (e: PointerEvent) => {
        if (!available) return;
        // Tooltip position relative to the container (not the page).
        const rect = container.getBoundingClientRect();
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          zoneId: zone.id,
        });
      };
      const onMove = (e: PointerEvent) => {
        if (!available) return;
        const rect = container.getBoundingClientRect();
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          zoneId: zone.id,
        });
      };
      const onLeave = () => {
        setTooltip((t) => (t && t.zoneId === zone.id ? null : t));
      };
      const handleSelect = () => {
        if (!available) return;
        // Toggle: clicking the already-selected zone clears.
        onSelect(selectedZoneId === zone.id ? null : zone.id);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          handleSelect();
        }
      };

      el.addEventListener('pointerenter', onEnter);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerleave', onLeave);
      el.addEventListener('click', handleSelect);
      el.addEventListener('keydown', onKey);

      cleanups.push(() => {
        el.removeEventListener('pointerenter', onEnter);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
        el.removeEventListener('click', handleSelect);
        el.removeEventListener('keydown', onKey);
      });
    }

    return () => {
      for (const fn of cleanups) fn();
    };
    // applyZoneStyle is stable per pax-change; including it covers the
    // over-pax visual re-render.
  }, [cleanedSvg, zoneByLayerId, selectedZoneId, applyZoneStyle, onSelect, pax]);

  // Bail-out: nothing to render if the SVG or zone list is missing.
  if (!cleanedSvg || zones.length === 0) return null;

  // Tooltip state stores event_zones.id (NOT the SVG layer id), so look up
  // the hovered zone by zone.id directly.
  const hoveredZone = tooltip
    ? zones.find((z) => z.id === tooltip.zoneId) || null
    : null;

  const selectedZone = selectedZoneId
    ? zones.find((z) => z.id === selectedZoneId) || null
    : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Pick your seating zone</h3>
        {selectedZone && (
          <span className="text-xs text-slate-500">
            Tap a different zone to change
          </span>
        )}
      </div>

      {/* The interactive SVG container. We size it to its natural aspect via
          the height: auto rule applied to the <svg> in the effect, capped to
          a sensible viewport so very tall venue maps don't dominate the
          page. */}
      <div
        className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
        role="group"
        aria-label="Seating layout"
      >
        <div
          ref={containerRef}
          // Sanitized server-side AND re-sanitized client-side via
          // sanitizeSvg(svg) memoized into cleanedSvg above. Two
          // independent layers — see comment near cleanedSvg definition.
          // This is the architect-approved injection site.
          dangerouslySetInnerHTML={{ __html: cleanedSvg }}
          className="w-full max-h-[70vh] overflow-auto touch-pan-x touch-pan-y"
        />

        {/* Hover tooltip — only on hover-capable (non-touch) devices. */}
        {!isTouch && tooltip && hoveredZone && (
          <div
            role="tooltip"
            aria-hidden="true"
            className="pointer-events-none absolute z-10 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg whitespace-nowrap"
            style={{
              // Offset so the cursor doesn't sit on top of the tooltip text.
              left: Math.min(tooltip.x + 12, 9999),
              top: Math.max(tooltip.y - 36, 0),
            }}
          >
            {hoveredZone.zone_label} · ₹{formatRupees(hoveredZone.price)} ·{' '}
            {remainingOf(hoveredZone)} available
          </div>
        )}
      </div>

      {/* Sticky bottom info bar for touch devices — shows the SELECTED zone
          (or a prompt to pick one). On non-touch we still show the
          selected-zone summary inline below the SVG for clarity. */}
      {isTouch ? (
        <div
          role="status"
          className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900"
        >
          {selectedZone ? (
            <>
              <span className="font-semibold">{selectedZone.zone_label}</span>{' '}
              · ₹{formatRupees(selectedZone.price)} · {remainingOf(selectedZone)}{' '}
              available
            </>
          ) : (
            <span className="text-slate-700">
              Tap a zone in the map to pick your seating.
            </span>
          )}
        </div>
      ) : (
        selectedZone && (
          <div
            role="status"
            className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900"
          >
            Selected:{' '}
            <span className="font-semibold">{selectedZone.zone_label}</span> ·
            ₹{formatRupees(selectedZone.price)} · {remainingOf(selectedZone)}{' '}
            available
          </div>
        )
      )}

      {/* Legend — every zone gets a chip. Clicking a chip selects the zone
          (mirrors clicking the shape) so the picker works even if a zone's
          SVG shape is too small to tap. */}
      <ul
        className="flex flex-wrap gap-2"
        aria-label="Zone legend"
      >
        {zones.map((z) => {
          const remaining = remainingOf(z);
          const available = isAvailable(z);
          const selected = z.id === selectedZoneId;
          return (
            <li key={z.id}>
              <button
                type="button"
                onClick={() => {
                  if (!available) return;
                  onSelect(selected ? null : z.id);
                }}
                disabled={!available}
                aria-pressed={selected}
                aria-label={`${z.zone_label}, ₹${formatRupees(z.price)}, ${
                  available ? `${remaining} seats available` : 'sold out'
                }`}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
                  available ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                  selected
                    ? 'border-brand-600 bg-brand-100 text-brand-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: z.color || BRAND }}
                />
                <span>{z.zone_label}</span>
                <span className="text-slate-500">·</span>
                <span>₹{formatRupees(z.price)}</span>
                <span className="text-slate-500">·</span>
                <span>
                  {available ? `${remaining} avail` : 'sold out'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
