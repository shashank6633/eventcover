/**
 * Shared types + validators for the per-event RSVP form (Growezzy P4).
 *
 * Used by:
 *   • src/lib/events.ts hydrate()           — parses events.rsvp_fields_json
 *   • src/app/api/events/by-slug/[slug]/public — projects rsvpFields[] for the
 *     public booking form
 *   • src/app/api/reservations/public       — validates incoming answers
 *   • Wizard SectionRsvpForm + PublicBookingForm — render + collect answers
 *
 * Field IDs are nanoid()s assigned by the editor when the host first adds a
 * field. They're stable across saves so reservations.rsvp_answers_json can
 * reference them even after the host renames a label. If the host deletes a
 * field after answers exist, the orphan answers stay in the JSON blob but
 * are shown under a muted "Removed fields" section by the admin view.
 *
 * The `FieldDef` interface here intentionally mirrors the one re-exported
 * from `src/lib/events.ts` (which is the canonical home for wizard-facing
 * types). Keep the two in sync if you add a new field type.
 */

import { nanoid } from 'nanoid';

/**
 * Narrow union of supported field types. Mirrors the labels in the wizard
 * editor dropdown: Text / Textarea / Dropdown / Radio / Checkbox.
 */
export type RsvpFieldType =
  | 'text'
  | 'textarea'
  | 'dropdown'
  | 'radio'
  | 'checkbox';

export interface FieldDef {
  id: string;
  label: string;
  type: RsvpFieldType;
  required: boolean;
  /** Required for 'dropdown', 'radio', 'checkbox'. Ignored for text/textarea. */
  options?: string[];
}

const VALID_TYPES: ReadonlySet<RsvpFieldType> = new Set([
  'text',
  'textarea',
  'dropdown',
  'radio',
  'checkbox',
]);

/** Field types that REQUIRE a non-empty options array to be usable. */
const CHOICE_TYPES: ReadonlySet<RsvpFieldType> = new Set([
  'dropdown',
  'radio',
  'checkbox',
]);

const MAX_LABEL_LEN = 80;
const MAX_OPTIONS = 50;
const MAX_OPTION_LEN = 80;
const MAX_TEXT_ANSWER = 1000;
const MAX_FIELDS = 30;

/**
 * Parse a stringified rsvp_fields JSON column into a safe FieldDef[].
 * Drops malformed entries and assigns nanoid() ids to any entries missing
 * one (lets the wizard create fields client-side without forcing a server
 * round-trip to mint an id).
 */
export function parseRsvpFields(json: string | null | undefined): FieldDef[] {
  if (!json) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: FieldDef[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const type = String(r.type || '');
    if (!VALID_TYPES.has(type as RsvpFieldType)) continue;
    const label = String(r.label || '').trim().slice(0, MAX_LABEL_LEN);
    if (!label) continue;
    const options = Array.isArray(r.options)
      ? (r.options as unknown[])
          .map((o) => String(o ?? '').trim().slice(0, MAX_OPTION_LEN))
          .filter((o) => o.length > 0)
          .slice(0, MAX_OPTIONS)
      : undefined;
    // Choice-type fields without options are silently dropped — the editor's
    // save path also refuses them, but we belt-and-suspenders this so a
    // hand-edited JSON column doesn't blow up rendering.
    if (CHOICE_TYPES.has(type as RsvpFieldType)) {
      if (!options || options.length === 0) continue;
    }
    out.push({
      id: typeof r.id === 'string' && r.id.length > 0 ? r.id : nanoid(10),
      label,
      type: type as RsvpFieldType,
      required: !!r.required,
      ...(options && options.length > 0 ? { options } : {}),
    });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

export interface ValidationResult {
  ok: boolean;
  /** Per-field-id error message. Empty when ok. */
  errors: Record<string, string>;
  /** Sanitized answers — only contains entries for known fields. */
  cleaned: Record<string, string | string[]>;
}

/**
 * Validate a public-side answers map against the event's field defs.
 *
 * Rules:
 *   • required: must be present + non-empty
 *   • dropdown / radio: string must be one of the options
 *   • checkbox: array of strings, each must be one of the options. Empty
 *     array allowed when not required.
 *   • text / textarea: stringified + length-capped to 1000 chars
 */
export function validateRsvpAnswers(
  fields: FieldDef[],
  answers: Record<string, unknown> | null | undefined,
): ValidationResult {
  const errors: Record<string, string> = {};
  const cleaned: Record<string, string | string[]> = {};
  const ans = answers && typeof answers === 'object' ? answers : {};

  for (const f of fields) {
    const raw = (ans as Record<string, unknown>)[f.id];
    const isRequired = !!f.required;

    if (f.type === 'checkbox') {
      const arr = Array.isArray(raw)
        ? raw.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
        : [];
      const opts = new Set(f.options || []);
      const filtered = arr.filter((v) => opts.has(v));
      if (isRequired && filtered.length === 0) {
        errors[f.id] = 'Please pick at least one option.';
        continue;
      }
      if (filtered.length > 0) cleaned[f.id] = filtered;
      continue;
    }

    const value = raw == null ? '' : String(raw).trim();
    if (!value) {
      if (isRequired) errors[f.id] = 'This field is required.';
      continue;
    }

    if (f.type === 'dropdown' || f.type === 'radio') {
      const opts = new Set(f.options || []);
      if (!opts.has(value)) {
        errors[f.id] = 'Please pick one of the options.';
        continue;
      }
      cleaned[f.id] = value;
      continue;
    }

    // text / textarea
    cleaned[f.id] = value.slice(0, MAX_TEXT_ANSWER);
  }

  return { ok: Object.keys(errors).length === 0, errors, cleaned };
}

/**
 * Serialize for the events column. Strips unknown keys and reasserts the
 * shape — useful when accepting host input from the admin save path.
 */
export function stringifyRsvpFields(fields: FieldDef[]): string {
  return JSON.stringify(
    fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: !!f.required,
      ...(f.options ? { options: f.options } : {}),
    })),
  );
}

/** Generate a new, unsaved field def with a freshly minted id. */
export function newFieldDef(type: RsvpFieldType = 'text'): FieldDef {
  return {
    id: nanoid(10),
    label: '',
    type,
    required: false,
    ...(CHOICE_TYPES.has(type) ? { options: [] } : {}),
  };
}

/** Convenience — true when this field type requires the options array. */
export function isChoiceType(type: RsvpFieldType): boolean {
  return CHOICE_TYPES.has(type);
}
