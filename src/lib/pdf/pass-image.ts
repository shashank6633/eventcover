/**
 * Cover-charge pass — PNG image generator.
 *
 * Built for WhatsApp delivery where customers see the QR INLINE in chat
 * (no need to tap-to-open like a PDF). Captain scans the QR directly off
 * the customer's phone screen for fast door throughput.
 *
 * Pipeline:
 *   wallet data → SVG layout → sharp SVG-renderer → PNG buffer
 *
 * Pure JS — no native canvas/Chromium needed. Sharp is already a Next.js
 * dependency. QR codes are embedded as inline SVG (vector — scales sharply
 * regardless of phone DPI).
 *
 * Dimensions: 800×1200 (portrait 2:3, fits WhatsApp media well).
 */
import QRCode from 'qrcode';
import sharp from 'sharp';
import { getEffectiveDesign, type TicketDesign } from '../ticket-design';

export interface PassImageInput {
  txnId: string;
  guestName: string;
  coverAmount: number;
  eventName?: string;
  eventDate?: string;       // YYYY-MM-DD
  pax?: number;
  venueName?: string;
  venueLogo?: string;       // data URL or http(s) URL — optional
  qrCodeId?: string;        // human-readable wallet code, displayed below QR
  expiresAt?: number | null;
  /**
   * Optional per-event design override. Accepts a partial TicketDesign, a
   * raw JSON string from events.ticket_design_json, or null/undefined.
   * Always resolved through getEffectiveDesign(), so junk/empty input
   * falls back to the brand defaults and the existing pixel output stays
   * identical for callers that don't pass it.
   */
  ticket_design?: string | Partial<TicketDesign> | null;
}

const W = 800;
const H = 1200;
const MUTED = '#6B7280';      // slate-500
const RULE = '#E5E7EB';       // slate-200
const BG = '#FFFFFF';

/**
 * Generate the wallet pass as a PNG buffer ready for WhatsApp / download.
 * Layout: brand header → event → QR (large, centered) → code → guest details
 * → footer.
 */
export async function generatePassImage(input: PassImageInput): Promise<Buffer> {
  // Resolve the design first — empty/null/invalid input → brand defaults so
  // legacy callers (and rows with NULL ticket_design_json) render unchanged.
  const design = getEffectiveDesign(input.ticket_design);
  const BRAND = design.background;
  const BRAND_DARK = design.accent;
  const INK = design.text;
  const isMinimal = design.layout === 'minimal';
  const showLogo = design.show_logo !== false;
  const showDate = design.show_date !== false;

  const venueName = (input.venueName || 'AKAN Hyderabad').toUpperCase();
  const eventLine = input.eventName ? truncate(input.eventName, 36) : 'Event Cover';
  const eventDate = input.eventDate && showDate ? formatDate(input.eventDate) : '';
  const guestName = truncate(input.guestName || 'Guest', 28);
  const cover = formatINR(input.coverAmount);
  const pax = input.pax && input.pax > 1 ? `${input.pax} guests` : '1 guest';
  const expires = input.expiresAt ? formatExpiry(input.expiresAt) : '';

  // QR contents: the txn id — captain's scanner reads + redeems
  const qrSvgString = await QRCode.toString(input.txnId, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: INK, light: BG },
  });
  // Strip outer <svg> wrapper so we can paste the <path> inside our own svg
  const qrInner = qrSvgString
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();

  const qrSize = isMinimal ? 440 : 480;
  const qrX = (W - qrSize) / 2;
  const qrY = isMinimal ? 280 : 320;

  // Header band height. When show_logo === false, the band degenerates into
  // a thin brand-colored bar — the venue name / COVER PASS labels disappear
  // but we keep a hint of the brand color so the pass still feels stamped.
  // Minimal layout uses a thinner band by default for a cleaner top.
  const headerH = showLogo ? (isMinimal ? 110 : 130) : 12;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${BRAND}" />
      <stop offset="100%" stop-color="${BRAND_DARK}" />
    </linearGradient>
  </defs>

  <!-- Card background -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="${BG}" />

  <!-- Header band -->
  <rect x="0" y="0" width="${W}" height="${headerH}" fill="url(#brandGrad)" />
  ${showLogo ? `
  <text x="${W / 2}" y="55" text-anchor="middle"
        font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        font-size="32" font-weight="700" fill="#FFFFFF" letter-spacing="3">
    ${escapeXml(venueName)}
  </text>
  <text x="${W / 2}" y="95" text-anchor="middle"
        font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        font-size="18" font-weight="500" fill="#FFFFFF" opacity="0.85" letter-spacing="6">
    COVER PASS
  </text>` : ''}

  <!-- Event line -->
  <text x="${W / 2}" y="${headerH + 60}" text-anchor="middle"
        font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        font-size="28" font-weight="600" fill="${INK}">
    ${escapeXml(eventLine)}
  </text>
  ${eventDate ? `
  <text x="${W / 2}" y="${headerH + 95}" text-anchor="middle"
        font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        font-size="18" font-weight="400" fill="${MUTED}">
    ${escapeXml(eventDate)}
  </text>` : ''}

  <!-- QR block with rounded card background -->
  <rect x="${qrX - 20}" y="${qrY - 20}" width="${qrSize + 40}" height="${qrSize + 40}"
        rx="20" ry="20" fill="${BG}" stroke="${RULE}" stroke-width="2" />
  <g transform="translate(${qrX}, ${qrY}) scale(${qrSize / extractQRSize(qrSvgString)})">
    ${qrInner}
  </g>

  ${input.qrCodeId ? `
  <text x="${W / 2}" y="${qrY + qrSize + 75}" text-anchor="middle"
        font-family="ui-monospace,SFMono-Regular,Menlo,Monaco,monospace"
        font-size="36" font-weight="700" fill="${INK}" letter-spacing="6">
    ${escapeXml(input.qrCodeId)}
  </text>
  <text x="${W / 2}" y="${qrY + qrSize + 100}" text-anchor="middle"
        font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        font-size="12" font-weight="500" fill="${MUTED}" letter-spacing="4">
    QR CODE ID
  </text>` : ''}

  <!-- Guest info grid -->
  <g transform="translate(0, ${qrY + qrSize + 145})">
    <text x="${W / 2}" y="0" text-anchor="middle"
          font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
          font-size="26" font-weight="600" fill="${INK}">
      ${escapeXml(guestName)}
    </text>
    <text x="${W / 2}" y="32" text-anchor="middle"
          font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
          font-size="16" font-weight="400" fill="${MUTED}">
      ${escapeXml(pax)} · Cover loaded ${escapeXml(cover)}
    </text>
    ${expires ? `
    <text x="${W / 2}" y="58" text-anchor="middle"
          font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
          font-size="13" font-weight="400" fill="${MUTED}">
      Valid until ${escapeXml(expires)}
    </text>` : ''}
  </g>

  <!-- Footer rule + tagline -->
  <line x1="60" y1="${H - 70}" x2="${W - 60}" y2="${H - 70}" stroke="${RULE}" stroke-width="1" />
  <text x="${W / 2}" y="${H - 42}" text-anchor="middle"
        font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        font-size="13" font-weight="500" fill="${MUTED}">
    Show this at the door · No PIN required to scan
  </text>
  <text x="${W / 2}" y="${H - 22}" text-anchor="middle"
        font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        font-size="11" font-weight="400" fill="${MUTED}" letter-spacing="2">
    POWERED BY EVENTCOVER
  </text>
</svg>`;

  // Render SVG to PNG buffer at exact 1× density (sharp's libvips handles the QR vector cleanly)
  return sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trim() + '…';
}

function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return '₹0';
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(amount));
}

function formatDate(iso: string): string {
  // Parse YYYY-MM-DD as local IST and format "DD Mon YYYY"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00+05:30`);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatExpiry(ts: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ts));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * QRCode lib outputs `<svg ... width="N" height="N" viewBox="0 0 N N">`.
 * We need that intrinsic size so we can scale the embedded paths to our
 * desired pixel dimensions.
 */
function extractQRSize(svg: string): number {
  const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /) ||
            svg.match(/width="(\d+(?:\.\d+)?)"/);
  return m ? Number(m[1]) : 33;
}
