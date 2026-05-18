/**
 * Cover-charge pass — A6 PDF generator.
 *
 * Layout (strict top-to-bottom flow, no overlap):
 *   1. Header band       — logo + venue name + "COVER PASS"
 *   2. Event band        — event name + event date
 *   3. QR block          — QR code with logo overlaid in center
 *   4. Guest info        — Guest name (large) · Cover loaded · Valid until
 *   5. (whitespace)
 *   6. Footer band       — T&C paragraph + "Powered by" closing line
 *
 * Design rules:
 *   • Every section is rendered through a SectionDrawer that advances a single
 *     y-cursor — no two sections can overlap because the cursor is monotonic.
 *   • The footer band's height is computed first (T&C lines + Powered by +
 *     bottom margin), then reserved as a floor. The middle flow can never
 *     descend into footer territory.
 *   • Content length is variable — long event/guest names are truncated to
 *     known widths; the T&C paragraph wraps to any number of lines.
 *   • All text in black for high-contrast print.
 *
 * Pure function — no DB, no side effects.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import QRCode from 'qrcode';

// A6 in points (1 mm = 72/25.4 pt → 105 mm ≈ 297.64, 148 mm ≈ 419.53)
const A6_WIDTH = 297.64;
const A6_HEIGHT = 419.53;

const INK = rgb(0, 0, 0);
const RULE = rgb(0.85, 0.85, 0.85);

const MARGIN_X = 20;
const MARGIN_Y = 18;

export interface PassPdfInput {
  txnId: string;
  qrCodeId?: string;          // kept on API contract; not rendered
  guestName: string;
  coverAmount: number;
  eventName?: string;
  venueName?: string;
  venueLogo?: string;
  expiresAt?: number | null;
  termsText?: string;
}

export async function generatePassPdf(input: PassPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A6_WIDTH, A6_HEIGHT]);

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const center = A6_WIDTH / 2;
  const contentWidth = A6_WIDTH - MARGIN_X * 2;
  const venueName = (input.venueName || 'AKAN Hyderabad').toUpperCase();

  // ─── Load logo (PNG/JPEG only — SVG falls back to text header) ──────────
  let logoImage: PDFImage | null = null;
  if (input.venueLogo) {
    try { logoImage = await embedDataUrl(pdf, input.venueLogo); } catch { logoImage = null; }
  }

  // ─── PASS 1 — pre-compute footer height so we can reserve it ────────────
  const termsRaw = input.termsText ||
    'You will receive the PIN via WhatsApp. Do not share the PIN with Club staff for the safety of the vouchers.';
  const termsLines = wrapText(helv, termsRaw, contentWidth, 9);
  const termsHeight = termsLines.length * 11.5;
  const poweredHeight = 12;
  const footerBlockHeight = termsHeight + 8 + poweredHeight; // 8pt gap between blocks
  const footerTop = MARGIN_Y + footerBlockHeight; // y-coordinate of the footer's top edge

  // ─── PASS 2 — render everything else top-down ───────────────────────────
  const drawer = new SectionDrawer(page, A6_HEIGHT - MARGIN_Y);

  // 1. HEADER BAND — logo (left) + venue/pass (right), side-by-side.
  //    Saves ~28pt of vertical space vs stacked centered header, which lets
  //    the QR + guest info + T&C breathe at the bottom.
  if (logoImage) {
    const headerHeight = 44;
    const logoSize = 44;
    const headerTop = drawer.cursor;
    // Logo on the left
    page.drawImage(logoImage, {
      x: MARGIN_X,
      y: headerTop - logoSize,
      width: logoSize,
      height: logoSize,
    });
    // Text block on the right, vertically centered within the logo band
    const textBlockX = MARGIN_X + logoSize + 12;
    page.drawText(venueName, {
      x: textBlockX,
      y: headerTop - logoSize / 2 + 1,
      size: 13,
      font: helvBold,
      color: INK,
    });
    page.drawText('COVER PASS', {
      x: textBlockX,
      y: headerTop - logoSize / 2 - 11,
      size: 8,
      font: helv,
      color: INK,
    });
    drawer.advance(headerHeight);
  } else {
    // Fallback when no logo — single centered stack (still compact)
    drawer.centered(venueName, { font: helvBold, size: 13, center });
    drawer.gap(3);
    drawer.centered('COVER PASS', { font: helv, size: 8, center });
  }
  drawer.gap(12);
  drawer.divider(MARGIN_X, A6_WIDTH - MARGIN_X);
  drawer.gap(14);

  // 2. EVENT BAND
  if (input.eventName) {
    drawer.centered(truncateToWidth(helvBold, input.eventName, contentWidth, 11), {
      font: helvBold, size: 11, center,
    });
    drawer.gap(4);
  }
  if (input.expiresAt) {
    // The event "happened" the calendar day BEFORE the wallet expires
    const evDate = new Date(input.expiresAt - 24 * 3600 * 1000).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
    drawer.centered(evDate, { font: helv, size: 8, center });
  }
  drawer.gap(12);

  // 3. QR BLOCK
  const qrSize = computeQrSize(drawer.cursor, footerTop, /* reserveBelow */ 100);
  await drawQrWithOverlay(pdf, page, {
    txnId: input.txnId,
    centerX: center,
    topY: drawer.cursor,
    size: qrSize,
    logoImage,
  });
  drawer.advance(qrSize);
  drawer.gap(12);
  drawer.divider(MARGIN_X, A6_WIDTH - MARGIN_X);
  drawer.gap(12);

  // 4. GUEST INFO
  drawer.centered(truncateToWidth(helvBold, input.guestName, contentWidth, 13), {
    font: helvBold, size: 13, center,
  });
  drawer.gap(6);
  drawer.centered(`Cover loaded   INR ${input.coverAmount.toLocaleString('en-IN')}`, {
    font: helv, size: 10, center,
  });
  drawer.gap(4);
  if (input.expiresAt) {
    const exp = new Date(input.expiresAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    drawer.centered(`Valid until   ${exp}`, { font: helv, size: 9, center });
  }

  // Safety check — if middle content somehow overflowed into footer space,
  // log it (dev only). The footer still renders at its reserved position so
  // the user gets a partially-overlapping page rather than no page.
  if (drawer.cursor < footerTop) {
    /* eslint-disable no-console */
    console.warn(`[pass-pdf] content overflowed into footer area (${drawer.cursor.toFixed(1)} < ${footerTop.toFixed(1)})`);
    /* eslint-enable no-console */
  }

  // 5. FOOTER BAND (drawn at reserved bottom position)
  // T&C paragraph
  let footerY = MARGIN_Y + poweredHeight + 8 + termsHeight - 11.5;
  for (const line of termsLines) {
    drawCenteredText(page, line, { y: footerY, size: 9, font: helv, color: INK, center });
    footerY -= 11.5;
  }
  // Powered by
  drawCenteredText(page, `Powered by ${venueName}`, {
    y: MARGIN_Y,
    size: 8,
    font: helvBold,
    color: INK,
    center,
  });

  return pdf.save();
}

// ─── SectionDrawer — monotonic top-down cursor ─────────────────────────────

class SectionDrawer {
  cursor: number;
  constructor(private page: PDFPage, top: number) {
    this.cursor = top;
  }
  /** Move cursor down by n points. */
  gap(n: number) { this.cursor -= n; }
  /** Advance cursor by n (treats n as the drawn item's height). */
  advance(n: number) { this.cursor -= n; }
  centered(text: string, opts: { font: PDFFont; size: number; center: number }) {
    // Draw at (cursor - size) so size = ascent ~= height; advance accordingly
    drawCenteredText(this.page, text, {
      y: this.cursor - opts.size,
      size: opts.size,
      font: opts.font,
      color: INK,
      center: opts.center,
    });
    this.cursor -= opts.size;
  }
  image(img: PDFImage, opts: { centerX: number; width: number; height: number }) {
    this.page.drawImage(img, {
      x: opts.centerX - opts.width / 2,
      y: this.cursor - opts.height,
      width: opts.width,
      height: opts.height,
    });
    this.cursor -= opts.height;
  }
  divider(x1: number, x2: number) {
    this.page.drawLine({
      start: { x: x1, y: this.cursor },
      end: { x: x2, y: this.cursor },
      thickness: 0.5,
      color: RULE,
    });
  }
}

// ─── QR with logo overlay ──────────────────────────────────────────────────

async function drawQrWithOverlay(
  pdf: PDFDocument,
  page: PDFPage,
  opts: {
    txnId: string;
    centerX: number;
    topY: number;
    size: number;
    logoImage: PDFImage | null;
  },
) {
  const x = opts.centerX - opts.size / 2;
  const y = opts.topY - opts.size;

  const qrPngBytes = await QRCode.toBuffer(opts.txnId, {
    type: 'png',
    errorCorrectionLevel: 'H',
    margin: 1,
    width: opts.size * 3,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  const qrImage = await pdf.embedPng(qrPngBytes);
  page.drawImage(qrImage, { x, y, width: opts.size, height: opts.size });

  if (opts.logoImage) {
    const overlaySize = Math.floor(opts.size * 0.22); // under H-level 30% recovery limit
    const padSize = overlaySize + 10;
    const cx = opts.centerX;
    const cy = y + opts.size / 2;
    page.drawRectangle({
      x: cx - padSize / 2,
      y: cy - padSize / 2,
      width: padSize,
      height: padSize,
      color: rgb(1, 1, 1),
    });
    page.drawImage(opts.logoImage, {
      x: cx - overlaySize / 2,
      y: cy - overlaySize / 2,
      width: overlaySize,
      height: overlaySize,
    });
  }
}

/**
 * Adaptive QR size — uses all space available between the current cursor and
 * the reserved area below (footer + guest info). Caps at 160pt and floors at
 * 110pt so a long event name or T&C doesn't shrink the QR below scannable size.
 */
function computeQrSize(cursorY: number, footerTop: number, reserveBelow: number): number {
  const available = cursorY - footerTop - reserveBelow;
  return Math.max(110, Math.min(160, available));
}

// ─── Text helpers ──────────────────────────────────────────────────────────

function drawCenteredText(
  page: PDFPage, text: string,
  opts: { y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; center: number },
) {
  const w = opts.font.widthOfTextAtSize(text, opts.size);
  page.drawText(text, {
    x: opts.center - w / 2,
    y: opts.y,
    size: opts.size,
    font: opts.font,
    color: opts.color,
  });
}

function wrapText(font: PDFFont, text: string, maxWidth: number, size: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Truncate text with an ellipsis so it fits within maxWidth at the given size. */
function truncateToWidth(font: PDFFont, text: string, maxWidth: number, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let lo = 0; let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = `${text.slice(0, mid)}…`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

async function embedDataUrl(pdf: PDFDocument, dataOrUrl: string): Promise<PDFImage> {
  let bytes: Uint8Array;
  let mime: string;

  if (dataOrUrl.startsWith('data:')) {
    const m = dataOrUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('invalid data URL');
    mime = m[1];
    bytes = Uint8Array.from(Buffer.from(m[2], 'base64'));
  } else {
    const res = await fetch(dataOrUrl);
    if (!res.ok) throw new Error(`logo fetch ${res.status}`);
    mime = res.headers.get('content-type') || 'image/png';
    bytes = new Uint8Array(await res.arrayBuffer());
  }

  if (mime.includes('jpeg') || mime.includes('jpg')) return pdf.embedJpg(bytes);
  if (mime.includes('svg')) {
    throw new Error('SVG logo not supported — upload PNG or JPEG via Settings → Venue Logo.');
  }
  return pdf.embedPng(bytes);
}
