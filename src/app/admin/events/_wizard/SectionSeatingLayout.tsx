'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WizardState } from './types';
import { PhasesManager, type Phase } from './_phases/PhasesManager';
import { PricingMatrix, type ScopeRow } from './_phases/PricingMatrix';

/**
 * Seating Layout card — opt-in per-event SVG zone pricing.
 *
 * Composed at the bottom of the Tickets section. The master toggle lives in
 * WizardState so it saves with the global "Save" button; the SVG upload and
 * zone CRUD persist immediately via their dedicated endpoints because they
 * live in their own tables and we don't want a 256 KB blob round-tripping
 * through every wizard save.
 *
 * Backend contracts (mirror the architect spec):
 *   POST   /api/events/[id]/seating-svg   body { svg } → { ok, zones, sanitizedSvg }
 *   DELETE /api/events/[id]/seating-svg
 *   GET    /api/events/[id]/zones         → { ok, zones }
 *   PATCH  /api/events/[id]/zones/[zoneId] body { zone_label?, price?, capacity?, active? }
 */
interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /**
   * Persisted event id. The seating-svg + zones + ticket-phases endpoints are
   * keyed on this; before the event is first saved, the upload UI is disabled
   * with a prompt to "Save the event first".
   */
  eventId: string | null;
}

// Both SectionSeatingLayout and SectionTickets render <PhasesSubCard /> with
// the same `seating_layout_phases_enabled` field — flipping it in either
// section turns phases on event-wide.

interface ZoneRow {
  id: string;
  zone_id: string;
  zone_label: string;
  price: number;
  capacity: number;
  sold_count: number;
  active: boolean;
}

// Architect-spec sanitizer prefixes — surfaced in the explainer.
const EXCLUDED_PREFIXES = ['.', '_', 'bg', 'background', 'guide', 'clip', 'mask'];

// Mirrors the server-side hard cap from the architect spec. We enforce this
// client-side before even reading the file so the user gets immediate
// feedback on a 50 MB monster.
const MAX_SVG_BYTES = 256 * 1024; // 256 KB

export function SectionSeatingLayout({ state, onChange, eventId }: Props) {
  const enabled = state.seating_layout_enabled;

  return (
    <div className="card space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            Seating Layout
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
              New
            </span>
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Upload your venue as an SVG and let customers pick a specific zone
            (VIP, Stage P1, etc.) at booking time. When on, the zone&apos;s
            price overrides the flat entry fee above.
          </p>
        </div>
        <Toggle
          checked={enabled}
          onChange={(v) => onChange({ seating_layout_enabled: v })}
          label="Enable seating layout"
        />
      </header>

      {enabled && (
        <div className="space-y-4 pt-1">
          {/*
            NOTE: <PhasesSubCard /> intentionally NOT rendered here even though
            seating zones ARE one of the matrix's scopes. The card is rendered
            once in SectionTickets (the canonical home for ticket pricing); the
            seating section just contributes its zones to the matrix's scope
            rows there. Rendering PhasesSubCard in both places caused two live
            instances to fetch + re-render in response to the same parent state
            change, producing visible flicker on every toggle/edit. Single
            instance keeps the UI stable.
          */}
          {eventId ? (
            <LayoutSubCard eventId={eventId} />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <div className="text-sm font-semibold text-slate-700 mb-1">
                Save the event first to upload a seating layout.
              </div>
              <div className="text-xs text-slate-500">
                We need an event ID before we can store the SVG and zone prices.
              </div>
            </div>
          )}
        </div>
      )}

      {!enabled && (
        <div className="text-xs text-slate-500 italic">
          Off — bookings use the flat entry fee above.
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sub-card: "Ticket Release Phases"
 *
 * Wraps the toggle + (when on) the PhasesManager + PricingMatrix. Same
 * toggle field as the Tickets section so flipping it in either place
 * unlocks the matrix everywhere.
 *
 * Exported because SectionTickets renders the very same card below its
 * pricing card.
 * ────────────────────────────────────────────────────────────────────── */
export function PhasesSubCard({
  state,
  onChange,
  eventId,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  eventId: string | null;
}) {
  const phasesOn = state.seating_layout_phases_enabled;
  const onToggle = (v: boolean) => onChange({ seating_layout_phases_enabled: v });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            Ticket Release Phases
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
              New
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Release pricing in waves — Early Bird → Phase 1 → Phase 2. Each
            phase ends on a date, when it sells out, or both, and auto-promotes
            the next one.
          </div>
        </div>
        <Toggle
          checked={phasesOn}
          onChange={onToggle}
          label="Enable ticket release phases"
        />
      </div>

      {phasesOn && eventId && (
        <PhasesAndMatrix
          state={state}
          eventId={eventId}
        />
      )}

      {phasesOn && !eventId && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <div className="text-sm font-semibold text-slate-700 mb-1">
            Save the event first to configure phases.
          </div>
          <div className="text-xs text-slate-500">
            We need an event ID before we can store phases and prices.
          </div>
        </div>
      )}

      {!phasesOn && (
        <div className="text-[11px] text-slate-500 italic">
          Off — bookings use the prices configured above.
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * PhasesAndMatrix — loads zones, derives scopes, renders both UIs.
 *
 * Lives here (alongside SectionSeatingLayout) so the zone-fetch logic is
 * co-located with the rest of the seating-layer code. SectionTickets reuses
 * this same component via the PhasesSubCard export.
 * ────────────────────────────────────────────────────────────────────── */
function PhasesAndMatrix({
  state,
  eventId,
}: {
  state: WizardState;
  eventId: string;
}) {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);

  // Hydrate zones once when the matrix mounts. We don't poll — the zone list
  // only changes when the host edits LayoutSubCard (same page) so a refresh
  // on next mount is fine in the wizard context.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/zones`)
      .then(safeJson)
      .then((d) => {
        if (cancelled) return;
        if (d && d.ok && Array.isArray(d.zones)) {
          setZones(normalizeZones(d.zones));
        }
      })
      .catch(() => {
        // Non-fatal — matrix just shows fewer rows.
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const scopes = useMemo<ScopeRow[]>(() => {
    const out: ScopeRow[] = [];
    // 1. Flat entry — always present so the host can phase-price the global
    //    entry_fee_per_person even without any tables or zones.
    out.push({
      scope: 'flat_entry',
      scopeId: null,
      label: 'Entry fee (per person)',
      sublabel: `Default ₹${state.entry_fee_per_person}`,
    });
    // 2. Each table type from state — id from table_types JSON, label from name.
    for (const t of state.table_types || []) {
      out.push({
        scope: 'table_type',
        scopeId: t.id,
        label: t.name,
        sublabel: `Default ₹${t.entry_fee} · capacity ${t.capacity}`,
      });
    }
    // 3. Each seating zone — only present when the host has uploaded an SVG.
    for (const z of zones) {
      out.push({
        scope: 'zone',
        scopeId: z.id,
        label: z.zone_label || z.zone_id,
        sublabel: `Default ₹${z.price} · capacity ${z.capacity}`,
      });
    }
    return out;
  }, [state.entry_fee_per_person, state.table_types, zones]);

  return (
    <div className="space-y-4">
      <PhasesManager
        eventId={eventId}
        onPhasesChange={(next) => setPhases(next)}
      />
      <PricingMatrix
        eventId={eventId}
        phases={phases}
        scopes={scopes}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sub-card: "Layout — Upload your venue SVG"
 *
 * Owns the SVG dropzone, the parsed-layout preview, the "How to create your
 * SVG" explainer, and the zone pricing table below the SVG.
 *
 * Wire-up:
 *   • POST /api/events/[id]/seating-svg with { svg } on upload — server
 *     sanitizes, parses zones, and returns the canonical zone list.
 *   • DELETE /api/events/[id]/seating-svg on Remove.
 *   • GET /api/events/[id]/zones on mount for hydration.
 *   • PATCH /api/events/[id]/zones/[zoneId] on blur for per-cell edits.
 * ────────────────────────────────────────────────────────────────────── */
function LayoutSubCard({ eventId }: { eventId: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initial hydration: pull the saved SVG + zones in parallel. The seating-svg
  // GET returns the markup; the zones endpoint returns the editable rows.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/events/${eventId}/seating-svg`).then(safeJson),
      fetch(`/api/events/${eventId}/zones`).then(safeJson),
    ])
      .then(([svgResp, zoneResp]) => {
        if (cancelled) return;
        if (svgResp && svgResp.ok && typeof svgResp.svg === 'string') {
          setSvg(svgResp.svg);
        } else {
          setSvg(null);
        }
        if (zoneResp && zoneResp.ok && Array.isArray(zoneResp.zones)) {
          setZones(normalizeZones(zoneResp.zones));
        } else {
          setZones([]);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load layout.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setWarning(null);
      // Strict accept — image/svg+xml is the standard mime; some browsers
      // emit empty type for files dragged off the desktop, so we fall back
      // to the .svg extension check.
      const isSvg =
        file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
      if (!isSvg) {
        setError('File must be an SVG (.svg).');
        return;
      }
      if (file.size > MAX_SVG_BYTES) {
        setError(
          `SVG must be smaller than 256 KB. This one is ${(file.size / 1024).toFixed(0)} KB.`,
        );
        return;
      }
      let raw: string;
      try {
        raw = await file.text();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read file.');
        return;
      }
      if (!raw.trim().toLowerCase().includes('<svg')) {
        setError('That file does not look like an SVG (no <svg> tag found).');
        return;
      }
      setBusy(true);
      try {
        const res = await fetch(`/api/events/${eventId}/seating-svg`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ svg: raw }),
        });
        const d = await safeJson(res);
        if (!d || !d.ok) {
          setError(pickMessage(d, 'Upload failed.'));
          return;
        }
        // Server returns the sanitized SVG + the canonical zone list.
        if (typeof d.sanitizedSvg === 'string') {
          setSvg(d.sanitizedSvg);
        } else {
          setSvg(raw); // fallback — server didn't re-emit; trust local copy
        }
        if (Array.isArray(d.zones)) {
          const next = normalizeZones(d.zones);
          setZones(next);
          if (next.length === 0) {
            setWarning(
              'No named layers found in this SVG. Double-check that you exported with "Include id attribute" enabled, or add zones manually below.',
            );
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
      } finally {
        setBusy(false);
      }
    },
    [eventId],
  );

  const handleRemove = useCallback(async () => {
    if (!confirm('Remove this layout? Zone prices will be kept but the SVG will be cleared.')) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/seating-svg`, {
        method: 'DELETE',
      });
      const d = await safeJson(res);
      if (!d || !d.ok) {
        setError(pickMessage(d, 'Could not remove layout.'));
        return;
      }
      setSvg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }, [eventId]);

  const handleZoneFieldChange = useCallback(
    async (zoneId: string, patch: Partial<ZoneRow>) => {
      // Optimistic local update first.
      setZones((prev) =>
        prev.map((z) => (z.id === zoneId ? { ...z, ...patch } : z)),
      );
    },
    [],
  );

  const handleZoneFieldCommit = useCallback(
    async (zone: ZoneRow, patch: Partial<ZoneRow>) => {
      // Compose the API payload — the backend accepts only these keys.
      const body: Record<string, unknown> = {};
      if (patch.zone_label !== undefined) body.zone_label = patch.zone_label;
      if (patch.price !== undefined) body.price = patch.price;
      if (patch.capacity !== undefined) body.capacity = patch.capacity;
      if (patch.active !== undefined) body.active = patch.active;
      if (Object.keys(body).length === 0) return;

      // Client-side guard for the capacity-below-sold case the architect spec
      // calls out (`capacity < sold_count` → 400). We still send the request
      // so the server can authoritative-reject it, but we surface a friendly
      // inline error first.
      if (
        patch.capacity !== undefined &&
        typeof patch.capacity === 'number' &&
        patch.capacity < zone.sold_count
      ) {
        setError(
          `Cannot lower capacity of "${zone.zone_label}" below ${zone.sold_count} — that many seats are already sold.`,
        );
        // Roll back the optimistic update
        setZones((prev) =>
          prev.map((z) => (z.id === zone.id ? { ...z, capacity: zone.capacity } : z)),
        );
        return;
      }

      try {
        const res = await fetch(
          `/api/events/${eventId}/zones/${encodeURIComponent(zone.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        const d = await safeJson(res);
        if (!d || !d.ok) {
          setError(pickMessage(d, 'Could not save zone.'));
          // Roll back to the original on server reject so the UI doesn't lie.
          setZones((prev) =>
            prev.map((z) => (z.id === zone.id ? zone : z)),
          );
          return;
        }
        // Adopt the server-canonical row if returned (in case the server
        // clamps / re-sanitizes values).
        if (d.zone && typeof d.zone === 'object') {
          const merged = normalizeZones([d.zone])[0];
          if (merged) {
            setZones((prev) =>
              prev.map((z) => (z.id === merged.id ? merged : z)),
            );
          }
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
        setZones((prev) => prev.map((z) => (z.id === zone.id ? zone : z)));
      }
    },
    [eventId],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            Layout — Upload your venue SVG
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Each named layer becomes a bookable zone.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExplainerOpen((v) => !v)}
          className="text-xs text-brand-600 hover:text-brand-700 underline-offset-2 hover:underline"
        >
          {explainerOpen ? 'Hide' : 'How to create your SVG'}
        </button>
      </div>

      {explainerOpen && <Explainer />}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}
      {warning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-xs">
          {warning}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-400">
          Loading layout…
        </div>
      ) : svg ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 max-w-2xl">
            <SvgPreview svg={svg} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="btn btn-secondary text-xs !px-4 !py-2"
            >
              {busy ? 'Working…' : 'Replace'}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="text-xs font-medium text-rose-600 hover:text-rose-700 px-3 py-2 rounded-md border border-rose-200 hover:bg-rose-50 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition select-none ${
            dragging
              ? 'border-brand-500 bg-brand-50/50'
              : 'border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/30'
          }`}
        >
          <div className="flex justify-center mb-2 text-brand-600">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-slate-700">
            {busy ? 'Uploading…' : 'Drop your SVG here, or click to browse'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Each named layer becomes a bookable zone. Max 256 KB.
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          // Clear so re-picking the same file fires onChange again.
          if (e.target) e.target.value = '';
        }}
      />

      {/* Zone pricing table — shown whenever we have at least one zone, even
          if the host hasn't uploaded an SVG yet (manually-added zones via the
          power-user POST /zones endpoint also surface here). */}
      {zones.length > 0 && (
        <ZoneTable
          zones={zones}
          onLocalChange={handleZoneFieldChange}
          onCommit={handleZoneFieldCommit}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Zone pricing table
 *
 * Each row's edits are persisted immediately (onBlur for text/number inputs,
 * onChange for the active toggle). Optimistic local state means typing feels
 * instant even on a slow connection.
 * ────────────────────────────────────────────────────────────────────── */
interface ZoneTableProps {
  zones: ZoneRow[];
  onLocalChange: (zoneId: string, patch: Partial<ZoneRow>) => void;
  onCommit: (zone: ZoneRow, patch: Partial<ZoneRow>) => void;
}

function ZoneTable({ zones, onLocalChange, onCommit }: ZoneTableProps) {
  return (
    <div className="pt-2">
      <div className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
        Zones ({zones.length})
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <th className="text-left px-2 py-2 font-semibold">Zone ID</th>
              <th className="text-left px-2 py-2 font-semibold">Label</th>
              <th className="text-left px-2 py-2 font-semibold">Price (₹)</th>
              <th className="text-left px-2 py-2 font-semibold">Capacity</th>
              <th className="text-left px-2 py-2 font-semibold">Sold</th>
              <th className="text-left px-2 py-2 font-semibold">Active</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <ZoneRowEditor
                key={z.id}
                zone={z}
                onLocalChange={(patch) => onLocalChange(z.id, patch)}
                onCommit={(patch) => onCommit(z, patch)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 italic mt-2">
        Changes save automatically. Sold count is read-only — derived from
        confirmed bookings.
      </p>
    </div>
  );
}

function ZoneRowEditor({
  zone,
  onLocalChange,
  onCommit,
}: {
  zone: ZoneRow;
  onLocalChange: (patch: Partial<ZoneRow>) => void;
  onCommit: (patch: Partial<ZoneRow>) => void;
}) {
  // Track the un-committed input values locally so blurring an unchanged
  // field doesn't fire a needless PATCH. We commit only when the value
  // differs from the row's last-known-good state.
  const [labelDraft, setLabelDraft] = useState(zone.zone_label);
  const [priceDraft, setPriceDraft] = useState(String(zone.price));
  const [capacityDraft, setCapacityDraft] = useState(String(zone.capacity));

  // Keep drafts in sync when the parent updates the row (e.g. after a
  // server-side adoption of canonical values).
  useEffect(() => setLabelDraft(zone.zone_label), [zone.zone_label]);
  useEffect(() => setPriceDraft(String(zone.price)), [zone.price]);
  useEffect(() => setCapacityDraft(String(zone.capacity)), [zone.capacity]);

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60">
      <td className="px-2 py-2">
        <code className="text-[11px] font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
          {zone.zone_id}
        </code>
      </td>
      <td className="px-2 py-2">
        <input
          className="input !py-1.5 !px-2 !text-sm"
          value={labelDraft}
          onChange={(e) => {
            setLabelDraft(e.target.value);
            onLocalChange({ zone_label: e.target.value });
          }}
          onBlur={() => {
            const next = labelDraft.trim();
            if (next && next !== zone.zone_label) {
              onCommit({ zone_label: next });
            } else if (!next) {
              // Reject empty — revert.
              setLabelDraft(zone.zone_label);
            }
          }}
          maxLength={60}
          placeholder="Zone label"
        />
      </td>
      <td className="px-2 py-2 w-32">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className="input !py-1.5 !px-2 !text-sm"
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={() => {
            const n = Number(priceDraft);
            if (!Number.isFinite(n) || n < 0) {
              setPriceDraft(String(zone.price));
              return;
            }
            if (n !== zone.price) onCommit({ price: n });
          }}
        />
      </td>
      <td className="px-2 py-2 w-28">
        <input
          type="number"
          inputMode="numeric"
          min={zone.sold_count}
          step={1}
          className="input !py-1.5 !px-2 !text-sm"
          value={capacityDraft}
          onChange={(e) => setCapacityDraft(e.target.value)}
          onBlur={() => {
            const n = Number(capacityDraft);
            if (!Number.isFinite(n) || n < 0) {
              setCapacityDraft(String(zone.capacity));
              return;
            }
            if (n !== zone.capacity) onCommit({ capacity: n });
          }}
        />
      </td>
      <td className="px-2 py-2 text-xs text-slate-600 whitespace-nowrap">
        {zone.sold_count} <span className="text-slate-400">/ {zone.capacity}</span>
      </td>
      <td className="px-2 py-2">
        <Toggle
          checked={zone.active}
          onChange={(v) => {
            onLocalChange({ active: v });
            onCommit({ active: v });
          }}
          label={`Toggle active for ${zone.zone_label}`}
          compact
        />
      </td>
    </tr>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * SVG preview
 *
 * The server already sanitized the markup before storage; we still render via
 * dangerouslySetInnerHTML in a constrained container with overflow:auto so a
 * huge layout doesn't break the page. Sizing rules:
 *   • max width = parent container (max-w-2xl up the tree)
 *   • height auto by aspect ratio
 *   • inline svg attrs get a hard width=100% / height=auto override via CSS
 * ────────────────────────────────────────────────────────────────────── */
function SvgPreview({ svg }: { svg: string }) {
  return (
    <div
      className="seating-svg-preview w-full overflow-auto"
      // Server has sanitized; we trust storage. The public booking flow will
      // re-sanitize before rendering as defense in depth.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Explainer
 *
 * 5-step "How to create your SVG" guide pulled verbatim from the spec, plus
 * the excluded-id-prefix list so power users know which layer names get
 * skipped (bg, _guide, etc.).
 * ────────────────────────────────────────────────────────────────────── */
function Explainer() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-3">
      <div>
        <div className="font-semibold text-slate-900 mb-1">
          How to create your SVG
        </div>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Open your venue photo or floor plan in Figma (free).</li>
          <li>
            Trace each zone (VIP, P1, Lounge, etc.) as a shape on a separate
            layer.
          </li>
          <li>
            Name each layer with the zone code customers will see — e.g.{' '}
            <code className="text-[11px] font-mono bg-white px-1 py-0.5 rounded border border-slate-200">
              P1
            </code>
            ,{' '}
            <code className="text-[11px] font-mono bg-white px-1 py-0.5 rounded border border-slate-200">
              VIP
            </code>
            ,{' '}
            <code className="text-[11px] font-mono bg-white px-1 py-0.5 rounded border border-slate-200">
              LOUNGE_A
            </code>
            .
          </li>
          <li>
            Export the frame as <strong>SVG</strong> with{' '}
            <strong>&ldquo;Include id attribute&rdquo;</strong> checked.
          </li>
          <li>Upload it here. We&apos;ll extract each named layer as a zone.</li>
        </ol>
      </div>
      <div className="text-xs text-slate-500">
        Layer names that start with{' '}
        {EXCLUDED_PREFIXES.map((p, i) => (
          <span key={p}>
            <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">
              {p}
            </code>
            {i < EXCLUDED_PREFIXES.length - 1 ? ', ' : ''}
          </span>
        ))}{' '}
        are ignored (so background frames and guide lines won&apos;t become
        bookable).
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Toggle
 *
 * Minimal pill toggle — matches the on/off switches used elsewhere in the
 * wizard. Brand-colour fill when active.
 * ────────────────────────────────────────────────────────────────────── */
function Toggle({
  checked,
  onChange,
  label,
  compact,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center rounded-full transition-colors flex-shrink-0 ${
        compact ? 'h-5 w-9' : 'h-6 w-11'
      } ${checked ? 'bg-brand-500' : 'bg-slate-300'}`}
    >
      <span
        className={`inline-block rounded-full bg-white shadow transform transition-transform ${
          compact ? 'h-4 w-4' : 'h-5 w-5'
        } ${checked ? (compact ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0.5'}`}
      />
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Coerces whatever the server sends into our local ZoneRow shape. Defensive
 * about field naming (active stored as 0/1 in SQLite) and numeric coercion.
 */
function normalizeZones(raw: unknown[]): ZoneRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const id = typeof o.id === 'string' ? o.id : null;
      const zone_id = typeof o.zone_id === 'string' ? o.zone_id : null;
      if (!id || !zone_id) return null;
      return {
        id,
        zone_id,
        zone_label:
          typeof o.zone_label === 'string' && o.zone_label
            ? o.zone_label
            : zone_id,
        price: toNumber(o.price, 0),
        capacity: toNumber(o.capacity, 0),
        sold_count: toNumber(o.sold_count, 0),
        active:
          o.active === undefined || o.active === null
            ? true
            : !!o.active && o.active !== 0,
      } satisfies ZoneRow;
    })
    .filter((z): z is ZoneRow => z !== null);
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Safely parse a Response body as JSON. Some failure modes (HTML 500 pages
 * from upstream proxies) would crash response.json(); fall back to a shape
 * that downstream code treats as a soft failure.
 */
async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Pull a string `message` field out of a server response, falling back to the
 * provided default. Centralised because `safeJson` returns
 * `Record<string, unknown>` and TypeScript won't widen `unknown` to `string`
 * implicitly — every call-site would otherwise have to repeat this guard.
 */
function pickMessage(
  resp: Record<string, unknown> | null,
  fallback: string,
): string {
  if (resp && typeof resp.message === 'string' && resp.message) {
    return resp.message;
  }
  return fallback;
}
