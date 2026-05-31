/**
 * Ticket Design — per-event override of the wallet pass PNG visual layout.
 *
 * Single source of truth for:
 *   • shape of the JSON stored in events.ticket_design_json
 *   • default values when the column is NULL/'{}' or contains junk
 *   • hex color sanitization shared by the admin PUT handler and the
 *     SVG renderer in lib/pdf/pass-image.ts
 *
 * Brand color #C1551A stays the fallback for `background`/`accent` so an
 * event with no design configured renders pixel-identical to today's PNG.
 */

export type TicketLayout = 'classic' | 'minimal';

export interface TicketDesign {
  background: string;   // hex, used for the header band gradient start
  accent: string;       // hex, used for the header band gradient end
  text: string;         // hex, used for primary text + QR pixels
  show_logo: boolean;   // when false, header band degenerates into a thin bar
  show_date: boolean;   // when false, the event-date sub-line is skipped
  layout: TicketLayout; // 'classic' = today's stacked layout, 'minimal' = trimmed
}

export const DEFAULT_TICKET_DESIGN: TicketDesign = {
  background: '#C1551A',  // AKAN rust — keeps parity with hard-coded BRAND
  accent: '#8B3E13',      // BRAND_DARK
  text: '#111827',        // slate-900 (INK)
  show_logo: true,
  show_date: true,
  layout: 'classic',
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Normalize a hex color string. Returns the input if it matches `#RRGGBB`,
 * otherwise the fallback. Uppercases the hex for consistency in storage.
 */
export function normalizeHexColor(hex: unknown, fallback: string): string {
  if (typeof hex !== 'string') return fallback;
  const trimmed = hex.trim();
  if (!HEX_RE.test(trimmed)) return fallback;
  return '#' + trimmed.slice(1).toUpperCase();
}

/**
 * Parse + sanitize a TicketDesign JSON blob from the DB. Always returns a
 * fully-populated object — missing/invalid fields fall back to defaults.
 * Accepts string (raw JSON), object (already parsed), null, or undefined.
 */
export function parseTicketDesign(input: string | object | null | undefined): TicketDesign {
  if (input == null) return { ...DEFAULT_TICKET_DESIGN };

  let raw: unknown;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return { ...DEFAULT_TICKET_DESIGN };
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return { ...DEFAULT_TICKET_DESIGN };
    }
  } else {
    raw = input;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_TICKET_DESIGN };
  }

  const r = raw as Record<string, unknown>;
  const layout: TicketLayout = r.layout === 'minimal' ? 'minimal' : 'classic';

  return {
    background: normalizeHexColor(r.background, DEFAULT_TICKET_DESIGN.background),
    accent: normalizeHexColor(r.accent, DEFAULT_TICKET_DESIGN.accent),
    text: normalizeHexColor(r.text, DEFAULT_TICKET_DESIGN.text),
    show_logo: toBool(r.show_logo, DEFAULT_TICKET_DESIGN.show_logo),
    show_date: toBool(r.show_date, DEFAULT_TICKET_DESIGN.show_date),
    layout,
  };
}

/**
 * Resolve the effective TicketDesign for an event row. Accepts either a
 * pre-parsed TicketDesign-ish object, the raw JSON string, or null/undefined.
 * Always returns a complete TicketDesign — never crashes on malformed input.
 */
export function getEffectiveDesign(input: string | TicketDesign | object | null | undefined): TicketDesign {
  return parseTicketDesign(input as string | object | null | undefined);
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return fallback;
}
