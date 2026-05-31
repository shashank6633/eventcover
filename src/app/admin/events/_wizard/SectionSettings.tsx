'use client';

import { useEffect, useRef, useState } from 'react';
import { PhoneInput } from '@/components/PhoneInput';
import type { WizardState } from './types';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /**
   * Persisted event id. The live "What the customer pays" preview at the
   * bottom POSTs to /api/events/[id]/billing-preview when this is set so the
   * host sees the same computation the public booking flow will run. Null
   * for un-saved events — the preview card shows a hint to save first.
   */
  eventId: string | null;
}

interface FeeBreakdown {
  base: number;
  discount: number;
  subtotal: number;
  gateway_fee: number;
  platform_fee: number;
  gst: number;
  final: number;
  payer_config: {
    gateway: 'customer' | 'host';
    platform: 'customer' | 'host';
    gst_enabled: boolean;
  };
  percentages: {
    gateway_pct: number;
    platform_pct: number;
    gst_pct: number;
    discount_pct: number;
  };
}

interface PreviewResponse {
  ok: boolean;
  breakdown?: FeeBreakdown;
  pax?: number;
  message?: string;
}

const GATEWAY_FEE_HELPERS: Record<'customer' | 'host', string> = {
  customer:
    'Fee is added on top at checkout. Customer sees the ticket price plus the fee.',
  host:
    'Fee is included in the ticket price. Customer sees one all-in amount; you absorb the fee from your payout.',
};

const PLATFORM_FEE_HELPERS: Record<'customer' | 'host', string> = {
  customer:
    'Fee is added on top at checkout. Customer sees the ticket price plus the platform fee.',
  host:
    'Fee is included in the ticket price. Customer sees one all-in amount; you absorb the platform fee from your payout.',
};

/**
 * Per-event Settings — last section in the wizard side-nav.
 *
 * Holds four sub-cards:
 *   1. Inquiry contact phone — number we WhatsApp on Contact-host submissions
 *   2. Payment gateway fee  — segmented payer toggle (Customer / Host)
 *   3. Platform Fees        — segmented payer toggle (Customer / Host)
 *   4. Enable GST           — boolean toggle + GST % input when ON
 *
 * Bottom: live "What the customer pays" preview card. Fires a debounced
 * POST to /api/events/[id]/billing-preview every time the relevant
 * settings change so the host always sees the up-to-the-second total.
 *
 * All four controls feed straight into WizardState — the parent's Save
 * button POSTs the whole state via buildFullPayload(), so there's no
 * separate "Save section" CTA.
 */
export function SectionSettings({ state, onChange, eventId }: Props) {
  // ─── Preview state ───────────────────────────────────────────────────────
  // Live breakdown rendered at the bottom of the section. Fetched whenever
  // the host changes any setting that affects the customer total.
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<FeeBreakdown | null>(null);
  const previewPax = 2;
  // Debounce ref so a flurry of typed changes (e.g. GST %) collapses to one
  // network call.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!eventId) {
      setBreakdown(null);
      setPreviewError(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setPreviewBusy(true);
      setPreviewError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/billing-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pax: previewPax }),
        });
        const json = (await res.json().catch(() => ({}))) as PreviewResponse;
        if (!res.ok || !json.ok || !json.breakdown) {
          setPreviewError(json.message || 'Could not compute preview.');
          setBreakdown(null);
        } else {
          setBreakdown(json.breakdown);
        }
      } catch {
        setPreviewError('Network error.');
        setBreakdown(null);
      } finally {
        setPreviewBusy(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // We deliberately depend on each field that affects the calculation so
    // unrelated wizard edits (e.g. event name) don't re-fetch the preview.
  }, [
    eventId,
    state.payment_gateway_fee_payer,
    state.platform_fee_payer,
    state.gst_enabled,
    state.gst_percent,
    state.entry_fee_per_person,
    state.discount_percent,
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
        <p className="text-sm text-slate-500 mt-1">
          Per-event preferences for inquiry routing, fee structure, and tax.
        </p>
      </header>

      {/* ── 1. Inquiry contact phone ─────────────────────────────────────── */}
      <section className="card space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Inquiry contact phone
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Number we WhatsApp when a customer submits a Contact-host inquiry
            for this event. Leave blank to use your brand page phone.
          </p>
        </div>
        <PhoneInput
          value={state.inquiry_phone}
          onChange={(v) => onChange({ inquiry_phone: v })}
        />
      </section>

      {/* ── 2. Payment gateway fee ───────────────────────────────────────── */}
      <section className="card space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Payment gateway fee
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Small processing fee charged on each transaction.
          </p>
        </div>
        <Segmented
          value={state.payment_gateway_fee_payer}
          onChange={(v) => onChange({ payment_gateway_fee_payer: v })}
          options={[
            { value: 'customer', label: 'Customer pays' },
            { value: 'host', label: 'Host pays' },
          ]}
        />
        <p className="text-xs text-slate-600 leading-relaxed">
          {GATEWAY_FEE_HELPERS[state.payment_gateway_fee_payer]}
        </p>
      </section>

      {/* ── 3. Platform fees ─────────────────────────────────────────────── */}
      <section className="card space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Platform Fees
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Venue&apos;s commission share of each booking.
          </p>
        </div>
        <Segmented
          value={state.platform_fee_payer}
          onChange={(v) => onChange({ platform_fee_payer: v })}
          options={[
            { value: 'customer', label: 'Customer pays' },
            { value: 'host', label: 'Host pays' },
          ]}
        />
        <p className="text-xs text-slate-600 leading-relaxed">
          {PLATFORM_FEE_HELPERS[state.platform_fee_payer]}
        </p>
      </section>

      {/* ── 4. Enable GST ────────────────────────────────────────────────── */}
      <section className="card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Enable GST
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Apply GST to each booking. Uses the rate from your pricing engine.
            </p>
          </div>
          <ToggleSwitch
            checked={state.gst_enabled}
            onChange={(v) => onChange({ gst_enabled: v })}
          />
        </div>
        {state.gst_enabled && (
          <div>
            <label className="label" htmlFor="settings-gst-pct">
              GST rate
            </label>
            <div className="relative max-w-[160px]">
              <input
                id="settings-gst-pct"
                className="input pr-8"
                type="number"
                min={0}
                max={100}
                step="1"
                value={state.gst_percent}
                onChange={(e) =>
                  onChange({
                    gst_percent: Math.min(
                      100,
                      Math.max(0, Number(e.target.value) || 0),
                    ),
                  })
                }
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                %
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Applied to the post-fees subtotal at checkout. Same field as
              under Tickets → Pricing.
            </p>
          </div>
        )}
      </section>

      {/* ── Live preview ─────────────────────────────────────────────────── */}
      <section className="card space-y-3 border-brand-200 bg-brand-50/40">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            What the customer pays
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Sample: {previewPax} × ₹{formatNum(state.entry_fee_per_person)}
            {' '}
            (per-person entry fee)
          </p>
        </div>
        {!eventId ? (
          <div className="text-xs text-slate-500 italic">
            Save the event once to enable the live preview.
          </div>
        ) : previewError ? (
          <div className="text-xs text-rose-700">{previewError}</div>
        ) : breakdown ? (
          <BreakdownTable breakdown={breakdown} busy={previewBusy} />
        ) : (
          <div className="text-xs text-slate-400">Computing…</div>
        )}
      </section>
    </div>
  );
}

// ─── Segmented control ─────────────────────────────────────────────────────

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}

function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`text-sm font-semibold py-2 rounded-md transition
              ${active
                ? 'bg-brand-500 text-white shadow-sm'
                : 'text-slate-700 hover:bg-white'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Toggle switch ─────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition flex-shrink-0
        ${checked ? 'bg-brand-500' : 'bg-slate-300'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition
          ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

// ─── Breakdown table ───────────────────────────────────────────────────────

function BreakdownTable({
  breakdown,
  busy,
}: {
  breakdown: FeeBreakdown;
  busy: boolean;
}) {
  const showGateway = breakdown.payer_config.gateway === 'customer';
  const showPlatform = breakdown.payer_config.platform === 'customer';
  const showGst = breakdown.payer_config.gst_enabled;
  return (
    <div className={`text-sm ${busy ? 'opacity-60' : ''}`}>
      <Row label="Base (entry × pax)" value={breakdown.base} />
      {breakdown.discount > 0 && (
        <Row
          label={`Discount (${formatNum(breakdown.percentages.discount_pct)}%)`}
          value={-breakdown.discount}
        />
      )}
      <Row label="Subtotal" value={breakdown.subtotal} subtle />
      {showGateway && (
        <Row
          label={`Gateway fee (${formatNum(breakdown.percentages.gateway_pct)}%)`}
          value={breakdown.gateway_fee}
        />
      )}
      {showPlatform && (
        <Row
          label={`Platform fee (${formatNum(breakdown.percentages.platform_pct)}%)`}
          value={breakdown.platform_fee}
        />
      )}
      {showGst && (
        <Row
          label={`GST (${formatNum(breakdown.percentages.gst_pct)}%)`}
          value={breakdown.gst}
        />
      )}
      <div className="border-t border-brand-200 mt-2 pt-2">
        <Row label="Total" value={breakdown.final} strong />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  subtle,
}: {
  label: string;
  value: number;
  strong?: boolean;
  subtle?: boolean;
}) {
  return (
    <div className="flex justify-between py-0.5">
      <span
        className={`${strong ? 'font-semibold text-slate-900' : ''} ${subtle ? 'text-slate-500' : 'text-slate-700'}`}
      >
        {label}
      </span>
      <span
        className={`${strong ? 'font-semibold text-slate-900' : ''} ${subtle ? 'text-slate-500' : 'text-slate-700'} tabular-nums`}
      >
        {value < 0 ? '−' : ''}₹{formatNum(Math.abs(value))}
      </span>
    </div>
  );
}

function formatNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0';
  const isWhole = Math.round(n) === n;
  return isWhole
    ? n.toLocaleString('en-IN')
    : n.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}
