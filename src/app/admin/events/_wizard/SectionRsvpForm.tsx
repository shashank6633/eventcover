'use client';

import { useMemo } from 'react';
import { nanoid } from 'nanoid';
import type { WizardState } from './types';
import type { FieldDef, RsvpFieldType } from '@/lib/events';

/**
 * RSVP Form section (Phase 4).
 *
 * Lets the host compose custom questions that get rendered after the
 * standard name/phone/pax/notes inputs on the public booking form
 * (/event/[slug]). Each field is one of:
 *   • text       — single-line input
 *   • textarea   — multi-line input
 *   • dropdown   — <select> with the host's options
 *   • radio      — radio button group with the host's options
 *   • checkbox   — checkbox group (multi-select) with the host's options
 *
 * Answers are persisted into reservations.rsvp_answers_json keyed by the
 * field id, so renaming a label later doesn't break historical data.
 *
 * Wiring:
 *   • State lives in WizardState.rsvp_fields
 *   • Persistence happens via the global wizard Save button (buildFullPayload
 *     in /admin/events/page.tsx pushes the whole array on PATCH).
 *   • This component is pure controlled — no fetch calls of its own.
 */

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

const TYPE_OPTIONS: { value: RsvpFieldType; label: string; choice: boolean }[] = [
  { value: 'text',     label: 'Text',     choice: false },
  { value: 'textarea', label: 'Textarea', choice: false },
  { value: 'dropdown', label: 'Dropdown', choice: true  },
  { value: 'radio',    label: 'Radio',    choice: true  },
  { value: 'checkbox', label: 'Checkbox', choice: true  },
];

const CHOICE_TYPES = new Set<RsvpFieldType>(['dropdown', 'radio', 'checkbox']);

function isChoiceType(t: RsvpFieldType): boolean {
  return CHOICE_TYPES.has(t);
}

/** Build a fresh blank field of the given type. */
function newField(type: RsvpFieldType = 'text'): FieldDef {
  return {
    id: nanoid(10),
    label: '',
    type,
    required: false,
    ...(isChoiceType(type) ? { options: [] } : {}),
  };
}

function optionsToText(options: string[] | undefined): string {
  return (options || []).join('\n');
}

function textToOptions(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 50);
}

export function SectionRsvpForm({ state, onChange }: Props) {
  const fields = state.rsvp_fields;

  const fieldCount = fields.length;
  const incompleteCount = useMemo(
    () =>
      fields.filter(
        (f) =>
          !f.label.trim() ||
          (isChoiceType(f.type) && (!f.options || f.options.length === 0)),
      ).length,
    [fields],
  );

  function updateFields(next: FieldDef[]) {
    onChange({ rsvp_fields: next });
  }

  function addField() {
    updateFields([...fields, newField('text')]);
  }

  function removeField(id: string) {
    updateFields(fields.filter((f) => f.id !== id));
  }

  function patchField(id: string, patch: Partial<FieldDef>) {
    updateFields(
      fields.map((f) => {
        if (f.id !== id) return f;
        const next: FieldDef = { ...f, ...patch };
        // When the user switches into a choice-type, make sure options is
        // an array (so the textarea has something to bind to). When they
        // switch OUT of a choice-type, drop the options so the persisted
        // payload stays clean.
        if (patch.type) {
          if (isChoiceType(patch.type)) {
            next.options = Array.isArray(next.options) ? next.options : [];
          } else {
            delete next.options;
          }
        }
        return next;
      }),
    );
  }

  function move(id: string, direction: -1 | 1) {
    const idx = fields.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= fields.length) return;
    const next = fields.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    updateFields(next);
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">RSVP Form</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Add custom questions to your public booking form. Answers are saved
            with each reservation and visible on the Reservations page.
          </p>
        </div>
        <button
          type="button"
          onClick={addField}
          className="btn btn-secondary whitespace-nowrap"
        >
          + Add field
        </button>
      </div>

      {fieldCount === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
          <p className="text-sm text-slate-600">
            No custom fields yet. Click <span className="font-semibold">+ Add field</span> to
            ask your attendees something extra (dietary preferences, T-shirt
            size, plus-one name, etc.).
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {fields.map((f, idx) => (
            <FieldRow
              key={f.id}
              field={f}
              index={idx}
              total={fieldCount}
              onPatch={(patch) => patchField(f.id, patch)}
              onRemove={() => removeField(f.id)}
              onMove={(dir) => move(f.id, dir)}
            />
          ))}
        </ul>
      )}

      {fieldCount > 0 && (
        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {fieldCount} field{fieldCount === 1 ? '' : 's'} configured
          </span>
          {incompleteCount > 0 && (
            <span className="text-amber-700">
              {incompleteCount} need{incompleteCount === 1 ? 's' : ''} a label or
              options before saving
            </span>
          )}
          <span className="text-slate-400">
            · Changes save when you press the global Save button at the top.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── FieldRow ────────────────────────────────────────────────────────────

interface RowProps {
  field: FieldDef;
  index: number;
  total: number;
  onPatch: (patch: Partial<FieldDef>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

function FieldRow({ field, index, total, onPatch, onRemove, onMove }: RowProps) {
  const showOptions = isChoiceType(field.type);
  const optionsText = optionsToText(field.options);
  const needsLabel = !field.label.trim();
  const needsOptions = showOptions && (!field.options || field.options.length === 0);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center pt-1 text-slate-400">
          <button
            type="button"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="disabled:opacity-30 hover:text-slate-700"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
          <span className="text-[11px] font-mono text-slate-400 my-1">
            {index + 1}
          </span>
          <button
            type="button"
            aria-label="Move down"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="disabled:opacity-30 hover:text-slate-700"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          {/* Row 1 — Label + Type + Required + Delete */}
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-12 md:col-span-6">
              <label className="label" htmlFor={`rsvp-label-${field.id}`}>
                Label
              </label>
              <input
                id={`rsvp-label-${field.id}`}
                type="text"
                className="input"
                value={field.label}
                onChange={(e) => onPatch({ label: e.target.value.slice(0, 80) })}
                placeholder="e.g. Dietary preferences"
                maxLength={80}
              />
            </div>
            <div className="col-span-7 md:col-span-3">
              <label className="label" htmlFor={`rsvp-type-${field.id}`}>
                Type
              </label>
              <select
                id={`rsvp-type-${field.id}`}
                className="input"
                value={field.type}
                onChange={(e) =>
                  onPatch({ type: e.target.value as RsvpFieldType })
                }
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-3 md:col-span-2 flex flex-col items-start">
              <span className="label">Required</span>
              <label className="inline-flex items-center gap-2 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={!!field.required}
                  onChange={(e) => onPatch({ required: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">
                  {field.required ? 'Yes' : 'No'}
                </span>
              </label>
            </div>
            <div className="col-span-2 md:col-span-1 flex justify-end">
              <button
                type="button"
                onClick={onRemove}
                aria-label="Delete field"
                className="text-slate-400 hover:text-rose-600 mt-6"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Row 2 — Options textarea (only for choice types) */}
          {showOptions && (
            <div>
              <label className="label" htmlFor={`rsvp-opts-${field.id}`}>
                Options
                <span className="text-slate-400 font-normal ml-1">
                  (one per line)
                </span>
              </label>
              <textarea
                id={`rsvp-opts-${field.id}`}
                className="input min-h-[80px] font-mono text-sm"
                value={optionsText}
                onChange={(e) =>
                  onPatch({ options: textToOptions(e.target.value) })
                }
                placeholder={'Vegetarian\nVegan\nNo restrictions'}
                rows={4}
              />
            </div>
          )}

          {/* Validation hint */}
          {(needsLabel || needsOptions) && (
            <div className="text-xs text-amber-700">
              {needsLabel && <div>· A label is required.</div>}
              {needsOptions && (
                <div>
                  · Add at least one option (one per line) for{' '}
                  {field.type} fields.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
