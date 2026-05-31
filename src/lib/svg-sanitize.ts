/**
 * Isomorphic SVG sanitizer + zone-candidate extractor.
 *
 * Pure string operations — no DB, no Node-only deps. Safe to import from
 * both server code (writes go through sanitize on the way IN to the DB) and
 * client code (renders go through sanitize on the way OUT to the user, as
 * defense-in-depth before dangerouslySetInnerHTML).
 *
 * Lifted out of src/lib/seating-layout.ts because that file imports the
 * better-sqlite3 native module, which can't be bundled into a client component.
 * SeatingPicker.tsx (client) imports from THIS file; seating-layout.ts
 * (server) re-exports from here so existing callers keep working.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface ZoneCandidate {
  /** The raw id from the SVG layer (e.g. "VIP", "Stage_P1"). */
  id: string;
  /** Title-cased, hyphens/underscores → spaces. Editable in admin. */
  label: string;
  /** Originating tag kind so admin UI can show a small badge. */
  kind: 'g' | 'path' | 'rect' | 'polygon' | 'circle' | 'ellipse';
  /** Optional accent color extracted from fill="#xxx" if present. */
  color?: string;
}

export type SanitizeResult =
  | { ok: true; svg: string; zones: ZoneCandidate[] }
  | { ok: false; reason: string };

// ─── Constants ────────────────────────────────────────────────────────────

/** Hard size cap — 256 KB is generous (typical Figma layout is 15–40 KB). */
export const MAX_SVG_BYTES = 256 * 1024;

/**
 * Exported prefix list so the admin UI can mirror it in the "How to create
 * your SVG" explainer. The parser skips zone candidates whose id starts
 * with any of these — Figma's auto-generated layer names + common
 * non-zone artwork.
 */
export const DEFAULT_ZONE_EXCLUDE_PREFIXES = [
  '.',
  '_',
  'bg',
  'background',
  'guide',
  'clip',
  'mask',
];

function hasExcludedPrefix(id: string): boolean {
  const lower = id.toLowerCase();
  for (const p of DEFAULT_ZONE_EXCLUDE_PREFIXES) {
    if (lower.startsWith(p)) return true;
  }
  // Figma default "layer1", "layer42", etc.
  if (/^layer\d+$/i.test(id)) return true;
  return false;
}

// ─── Sanitizer ────────────────────────────────────────────────────────────

/**
 * Strip every known XSS vector and extract a clean SVG + the zone
 * candidates inside it. Sanitization is safe-by-default — returns
 * { ok: false } rather than throwing so callers can hand the reason
 * back to the user.
 */
export function sanitizeSvg(raw: unknown): SanitizeResult {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'SVG must be a string.' };
  }
  if (raw.length === 0) {
    return { ok: false, reason: 'SVG is empty.' };
  }
  if (raw.length > MAX_SVG_BYTES) {
    return { ok: false, reason: `SVG exceeds the ${Math.round(MAX_SVG_BYTES / 1024)} KB limit.` };
  }

  let svg = raw;

  // 1. Strip XML processing instructions (<?xml ... ?>) and DOCTYPE — XXE
  //    defence even though SQLite isn't an XML parser. Future-proofing for
  //    any code that might route this through one.
  svg = svg.replace(/<\?[\s\S]*?\?>/g, '');
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  // 2. CDATA sections — drop content but keep markup well-formed.
  svg = svg.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  // 3. HTML/XML comments — could hide payloads on older parsers.
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');

  // 4. Extract the outermost <svg ...>...</svg>. Anything outside is dropped.
  const svgMatch = svg.match(/<svg\b[\s\S]*?<\/svg\s*>/i);
  if (!svgMatch) {
    return { ok: false, reason: 'No <svg> root element found.' };
  }
  svg = svgMatch[0];

  // 5. Remove <script>, <foreignObject>, <style> blocks entirely.
  svg = svg.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  svg = svg.replace(/<script\b[^>]*\/>/gi, '');
  svg = svg.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '');
  svg = svg.replace(/<foreignObject\b[^>]*\/>/gi, '');
  svg = svg.replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
  svg = svg.replace(/<style\b[^>]*\/>/gi, '');

  // 6. Strip every event handler attribute (onclick, onload, etc.) and
  //    href/src/xlink:href values that point anywhere other than a
  //    fragment identifier (#foo).
  svg = svg.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  svg = svg.replace(
    /\s+(href|xlink:href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (full, _attr, _q, dq, sq, bare) => {
      const value = (dq ?? sq ?? bare ?? '').trim();
      if (value.startsWith('#')) return full;
      return '';
    },
  );

  // 7. Strip style="..." declarations.
  svg = svg.replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, '');

  if (svg.length > MAX_SVG_BYTES) {
    return { ok: false, reason: 'Sanitized SVG exceeds the size limit.' };
  }

  return { ok: true, svg, zones: parseSvgZones(svg) };
}

/**
 * Walk the sanitized SVG body and extract zone candidates. Accepts either:
 *   - Top-level <g id="X">...</g>  (Figma's standard layer export)
 *   - Standalone <path|rect|polygon|circle|ellipse id="X" .../>
 *
 * Shapes nested INSIDE a named <g> are ignored — the group is the zone.
 */
export function parseSvgZones(svg: string): ZoneCandidate[] {
  if (typeof svg !== 'string' || !svg) return [];

  const inner = svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/i, '')
    .replace(/<\/svg\s*>[\s\S]*$/i, '');

  const seen = new Set<string>();
  const out: ZoneCandidate[] = [];

  let depth = 0;
  let i = 0;
  const len = inner.length;

  while (i < len) {
    const lt = inner.indexOf('<', i);
    if (lt < 0) break;

    if (inner[lt + 1] === '/') {
      const gt = inner.indexOf('>', lt);
      if (gt < 0) break;
      const closeTag = inner.slice(lt + 2, gt).trim().toLowerCase();
      if (closeTag === 'g') depth = Math.max(0, depth - 1);
      i = gt + 1;
      continue;
    }

    const gt = inner.indexOf('>', lt);
    if (gt < 0) break;
    const tagBody = inner.slice(lt + 1, gt);
    const selfClosing = tagBody.endsWith('/');
    const cleanBody = selfClosing ? tagBody.slice(0, -1) : tagBody;
    const spaceIdx = cleanBody.search(/\s|$/);
    const tagName = cleanBody.slice(0, spaceIdx).toLowerCase();
    const attrs = cleanBody.slice(spaceIdx);

    const isShape = ['g', 'path', 'rect', 'polygon', 'circle', 'ellipse'].includes(tagName);
    if (isShape && depth === 0) {
      const idMatch = attrs.match(/\bid\s*=\s*("([^"]*)"|'([^']*)')/);
      const rawId = (idMatch && (idMatch[2] ?? idMatch[3])) || '';
      const id = rawId.trim();
      if (id && !hasExcludedPrefix(id) && !seen.has(id)) {
        const fillMatch = attrs.match(/\bfill\s*=\s*("([^"]*)"|'([^']*)')/);
        const color = fillMatch ? ((fillMatch[2] ?? fillMatch[3]) || '').trim() : '';
        out.push({
          id,
          label: humanizeLabel(id),
          kind: tagName as ZoneCandidate['kind'],
          color: color && color !== 'none' ? color : undefined,
        });
        seen.add(id);
      }
    }

    if (tagName === 'g' && !selfClosing) depth += 1;

    i = gt + 1;
  }

  return out;
}

function humanizeLabel(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}
