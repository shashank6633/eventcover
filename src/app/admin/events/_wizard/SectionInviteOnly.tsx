'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { WizardState } from './types';

/**
 * Invite Only section (Phase 3).
 *
 * Three access modes, picked via radio cards:
 *   • 'public'      — open booking, today's behaviour (default).
 *   • 'invite_link' — visitors must arrive with ?invite=<invite_secret>.
 *                     The wizard surfaces the shareable URL + a "Rotate
 *                     link" button that PATCHes the event to regenerate
 *                     the secret (invalidates every previously-shared
 *                     URL — useful when an invite leaks).
 *   • 'phone_list'  — booking POSTs are validated against an event_invitees
 *                     whitelist keyed by normalized phone. The wizard
 *                     loads the list on mount and offers inline add /
 *                     delete and a CSV paste-import modal.
 *
 * Server contract:
 *   GET    /api/events/[id]/invitees                 → { ok, invitees: Invitee[] }
 *   POST   /api/events/[id]/invitees                 → { ok, invitee }
 *   DELETE /api/events/[id]/invitees/[inviteeId]     → { ok }
 *   POST   /api/events/[id]/invitees/import          → { ok, inserted, skipped, errors[] }
 *   PATCH  /api/events/[id] { access_mode, invite_message }
 *   PATCH  /api/events/[id] { rotate_invite_secret: true } → mints a fresh secret
 *
 * Access-mode + invite_message live in WizardState and ride along with
 * the wizard's main Save button — no per-section save needed. The
 * invitee table + rotate-secret button hit the API directly because
 * they mutate sibling resources (event_invitees rows / the event's
 * invite_secret column) that the wizard's Save path doesn't touch.
 */

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /** May be null on a brand-new event that hasn't been saved yet. */
  eventId: string | null;
}

interface Invitee {
  id: string;
  event_id: string;
  phone: string;
  name: string | null;
  plus_ones_allowed: number;
  used: 0 | 1 | boolean;
  used_at: number | null;
  used_reservation_id: string | null;
  notes: string | null;
  created_at: number;
}

type AccessMode = WizardState['access_mode'];

/**
 * The public booking page lives at wallet.akanhyd.com. Hardcoding the
 * host here keeps the wizard usable on staging / preview deployments
 * where window.location.host would otherwise point at a non-prod URL
 * that the host wouldn't want to share with guests.
 */
const PUBLIC_HOST = 'https://wallet.akanhyd.com';

export function SectionInviteOnly({ state, onChange, eventId: eventIdProp }: Props) {
  // The task spec prescribes useSearchParams; the prop is the authoritative
  // value once the wizard has minted an id, so prefer the prop and fall
  // back to the URL param (which is what the wizard rewrites the URL to
  // immediately after the first Save).
  const params = useSearchParams();
  const eventIdFromUrl = params.get('edit');
  const eventId = eventIdProp || eventIdFromUrl;

  // ─── No event id yet ──────────────────────────────────────────────────────
  if (!eventId) {
    return (
      <div className="card space-y-3">
        <header>
          <h2 className="text-lg font-semibold text-slate-900">Invite Only</h2>
          <p className="text-sm text-slate-500 mt-1">
            Restrict who can book this event.
          </p>
        </header>
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center">
          <div className="text-sm text-slate-600 font-medium">Save the event first.</div>
          <div className="text-[12px] text-slate-500 mt-1">
            Invite settings attach to the event id — give it a name and date,
            click Save, then come back here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AccessModeCard
        accessMode={state.access_mode}
        onModeChange={(m) => onChange({ access_mode: m })}
      />

      {state.access_mode === 'invite_link' && (
        <InviteLinkCard
          eventId={eventId}
          slug={state.slug}
          inviteSecret={state.invite_secret}
          inviteMessage={state.invite_message}
          onSecretRotated={(s) => onChange({ invite_secret: s })}
          onInviteMessageChange={(v) => onChange({ invite_message: v })}
        />
      )}

      {state.access_mode === 'phone_list' && (
        <PhoneListCard
          eventId={eventId}
          inviteMessage={state.invite_message}
          onInviteMessageChange={(v) => onChange({ invite_message: v })}
        />
      )}
    </div>
  );
}

// ─── Access mode radio cards ─────────────────────────────────────────────────

interface ModeOpt {
  value: AccessMode;
  label: string;
  description: string;
  icon: string;
}

const MODES: ModeOpt[] = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone with the link can book. Default behaviour.',
    icon: '🌐',
  },
  {
    value: 'invite_link',
    label: 'Invite link only',
    description: 'Only visitors who arrive with the secret URL can see the booking form.',
    icon: '🔗',
  },
  {
    value: 'phone_list',
    label: 'Phone whitelist',
    description: 'Only booking requests from numbers you upload can complete a reservation.',
    icon: '📱',
  },
];

function AccessModeCard({
  accessMode,
  onModeChange,
}: {
  accessMode: AccessMode;
  onModeChange: (m: AccessMode) => void;
}) {
  return (
    <div className="card space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Access Mode</h2>
        <p className="text-sm text-slate-500 mt-1">
          Who can book this event? Switch anytime — settings save with the wizard.
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Access mode">
        {MODES.map((m) => {
          const active = m.value === accessMode;
          return (
            <label
              key={m.value}
              className={`relative cursor-pointer rounded-xl border p-3 transition ${
                active
                  ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-500/30'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="access_mode"
                value={m.value}
                checked={active}
                onChange={() => onModeChange(m.value)}
                className="sr-only"
              />
              <div className="flex items-start gap-2">
                <span className="text-xl leading-none">{m.icon}</span>
                <div className="min-w-0">
                  <div className={`text-sm font-semibold ${active ? 'text-brand-700' : 'text-slate-900'}`}>
                    {m.label}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    {m.description}
                  </div>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Invite-link mode ────────────────────────────────────────────────────────

function InviteLinkCard({
  eventId,
  slug,
  inviteSecret,
  inviteMessage,
  onSecretRotated,
  onInviteMessageChange,
}: {
  eventId: string;
  slug: string;
  inviteSecret: string | null;
  inviteMessage: string;
  onSecretRotated: (s: string) => void;
  onInviteMessageChange: (v: string) => void;
}) {
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server mints invite_secret on first switch to 'invite_link' + save.
  // If the wizard state hasn't reflected that yet (e.g. user just toggled
  // the radio but hasn't hit Save), the secret will be null until the
  // next reload — surface a helpful hint instead of a broken URL.
  const url = inviteSecret && slug
    ? `${PUBLIC_HOST}/event/${slug}?invite=${inviteSecret}`
    : '';

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback for browsers that block clipboard from non-https contexts.
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* swallow */ }
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  async function rotate() {
    if (rotating) return;
    if (!confirm(
      'Rotate the invite link?\n\n' +
      'The current link will stop working immediately. Anyone already booked is unaffected; anyone trying to book with the old link will see the locked screen.',
    )) return;

    setRotating(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotate_invite_secret: true }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Failed to rotate.');
      const fresh = d.event?.invite_secret as string | null | undefined;
      if (fresh) onSecretRotated(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rotate.');
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="card space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Shareable invite link</h2>
        <p className="text-sm text-slate-500 mt-1">
          Send this URL to invited guests. Anyone without it sees a locked screen.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {!slug ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
          Save the event so a public slug is generated, then the invite URL will appear here.
        </div>
      ) : !inviteSecret ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
          Click <span className="font-semibold">Save</span> at the top to mint your invite secret —
          the link will appear here after the next save.
        </div>
      ) : (
        <div>
          <label className="label">Invite URL</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              readOnly
              value={url}
              className="input font-mono text-[12px] flex-1 select-all"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copy}
                className="btn btn-primary whitespace-nowrap"
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={rotate}
                disabled={rotating}
                className="btn btn-secondary whitespace-nowrap"
                title="Generate a fresh secret. The old link stops working."
              >
                {rotating ? 'Rotating…' : 'Rotate link'}
              </button>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 leading-snug">
            Anyone with this URL can reach the booking form. Treat it like a password —
            rotating instantly revokes every previously shared copy.
          </div>
        </div>
      )}

      <InviteMessageField value={inviteMessage} onChange={onInviteMessageChange} />
    </div>
  );
}

// ─── Phone-list mode ─────────────────────────────────────────────────────────

function PhoneListCard({
  eventId,
  inviteMessage,
  onInviteMessageChange,
}: {
  eventId: string;
  inviteMessage: string;
  onInviteMessageChange: (v: string) => void;
}) {
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  // Inline "+ Add invitee" mini-form state.
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newPlusOnes, setNewPlusOnes] = useState(0);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/invitees`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Failed to load invitees.');
      setInvitees(Array.isArray(d.invitees) ? d.invitees : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invitees.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function addInvitee(e: React.FormEvent) {
    e.preventDefault();
    if (adding) return;
    const phone = newPhone.trim();
    if (!phone) { setError('Phone is required.'); return; }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/invitees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          name: newName.trim() || null,
          plus_ones_allowed: Math.max(0, Math.floor(Number(newPlusOnes) || 0)),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Failed to add invitee.');
      setNewPhone('');
      setNewName('');
      setNewPlusOnes(0);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add invitee.');
    } finally {
      setAdding(false);
    }
  }

  async function removeInvitee(inv: Invitee) {
    if (busyId) return;
    if (!confirm(`Remove ${inv.name || inv.phone} from the guest list?`)) return;
    setBusyId(inv.id);
    try {
      const res = await fetch(`/api/events/${eventId}/invitees/${inv.id}`, {
        method: 'DELETE',
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Failed to remove invitee.');
      setInvitees((xs) => xs.filter((x) => x.id !== inv.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove invitee.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="card space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Guest list</h2>
            <p className="text-sm text-slate-500 mt-1">
              Only the phone numbers below can complete a booking. Bookings POST'd
              with any other number are rejected at submit.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="btn btn-secondary whitespace-nowrap"
          >
            Import CSV
          </button>
        </header>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {/* ─── Inline add row ─────────────────────────────────────────────── */}
        <form
          onSubmit={addInvitee}
          className="rounded-xl border border-slate-200 bg-slate-50/40 p-3"
        >
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-12 sm:col-span-4">
              <label className="label">Phone</label>
              <input
                type="tel"
                inputMode="tel"
                className="input"
                placeholder="+91 98765 43210"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                required
              />
            </div>
            <div className="col-span-8 sm:col-span-4">
              <label className="label">Name (optional)</label>
              <input
                type="text"
                className="input"
                placeholder="Riya Mehra"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="col-span-4 sm:col-span-2">
              <label className="label">+1s</label>
              <input
                type="number"
                min={0}
                step={1}
                className="input"
                value={newPlusOnes}
                onChange={(e) => setNewPlusOnes(Number(e.target.value))}
              />
            </div>
            <div className="col-span-12 sm:col-span-2">
              <button
                type="submit"
                disabled={adding}
                className="btn btn-primary w-full"
              >
                {adding ? 'Adding…' : '+ Add'}
              </button>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-1.5">
            Total guests this invitee can bring = 1 + plus-ones. Phones normalize
            on save, so +91 98… and 98… are treated as the same number.
          </div>
        </form>

        {/* ─── Invitee table ──────────────────────────────────────────────── */}
        {loading && invitees.length === 0 ? (
          <div className="text-sm text-slate-500 py-8 text-center">Loading…</div>
        ) : invitees.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center">
            <div className="text-sm text-slate-600 font-medium">No invitees yet.</div>
            <div className="text-[12px] text-slate-500 mt-1">
              Add one above or import a CSV. Bookings will be blocked until you do.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-3 sm:mx-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2 font-semibold">Phone</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold text-center">+1s</th>
                  <th className="px-3 py-2 font-semibold text-center">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invitees.map((inv) => {
                  const used = !!inv.used;
                  return (
                    <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-mono text-[12px] text-slate-900">{inv.phone}</td>
                      <td className="px-3 py-2 text-slate-700">{inv.name || <span className="text-slate-400 italic">—</span>}</td>
                      <td className="px-3 py-2 text-center text-slate-700">{inv.plus_ones_allowed}</td>
                      <td className="px-3 py-2 text-center">
                        {used ? (
                          <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                            Used
                          </span>
                        ) : (
                          <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 font-semibold">
                            Open
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeInvitee(inv)}
                          disabled={busyId === inv.id}
                          aria-label={`Remove ${inv.name || inv.phone}`}
                          className="text-slate-400 hover:text-rose-600 disabled:opacity-50 px-2 py-0.5 rounded hover:bg-rose-50"
                        >
                          {busyId === inv.id ? '…' : '×'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-[11px] text-slate-400 mt-2 px-3 sm:px-0">
              {invitees.length} invitee{invitees.length === 1 ? '' : 's'} ·{' '}
              {invitees.filter((i) => !i.used).length} open ·{' '}
              {invitees.filter((i) => !!i.used).length} used
            </div>
          </div>
        )}

        <InviteMessageField value={inviteMessage} onChange={onInviteMessageChange} />
      </div>

      {showImport && (
        <ImportCsvModal
          eventId={eventId}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); void load(); }}
        />
      )}
    </>
  );
}

// ─── Shared invite-message textarea (shown to gated visitors) ────────────────

function InviteMessageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const MAX = 500;
  return (
    <div>
      <label className="label">Message for invited guests (optional)</label>
      <textarea
        className="input min-h-[80px]"
        rows={3}
        maxLength={MAX}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX))}
        placeholder="Shown above the booking form. e.g. Welcome — this is a closed event for friends and family of Aanya & Rohan."
      />
      <div className="text-[11px] text-slate-400 mt-1">
        Plain text. Shown on the public page above the booking form (and on the
        locked screen for invite-link mode when the URL is missing or wrong).
      </div>
    </div>
  );
}

// ─── CSV import modal ───────────────────────────────────────────────────────

interface ImportResult {
  inserted?: number;
  skipped?: number;
  errors?: string[];
}

function ImportCsvModal({
  eventId,
  onClose,
  onImported,
}: {
  eventId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit() {
    if (busy) return;
    const csv = text.trim();
    if (!csv) { setError('Paste at least one row.'); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // The server expects structured rows: { rows: BulkImportRow[] }.
      // Parse the textarea client-side into { phone, name, plus_ones_allowed }
      // tuples before POSTing — sending raw { csv: text } returns a 400
      // ("rows must be an array...") because the import route doesn't
      // parse CSV server-side.
      const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const rows = lines.map((line) => {
        const [phone = '', name = '', plusStr = ''] = line.split(',').map((s) => s.trim());
        return {
          phone,
          name: name || null,
          plus_ones_allowed: Number(plusStr) || 0,
        };
      });
      const res = await fetch(`/api/events/${eventId}/invitees/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || 'Import failed.');
      setResult({
        inserted: Number(d.inserted) || 0,
        skipped: Number(d.skipped) || 0,
        errors: Array.isArray(d.errors) ? d.errors.map(String) : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  function done() {
    onImported();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-title"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-xl w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 id="csv-import-title" className="text-base font-semibold text-slate-900">
              Import invitees from CSV
            </h3>
            <p className="text-[12px] text-slate-500 mt-1">
              One per line. Order: <code className="font-mono">phone,name,plus_ones</code>.
              Name + plus_ones are optional.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-900 p-1"
          >
            ×
          </button>
        </header>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <span className="font-semibold">Inserted: {result.inserted ?? 0}</span>
              {' · '}
              <span>Skipped (duplicates): {result.skipped ?? 0}</span>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 max-h-40 overflow-auto">
                <div className="font-semibold mb-1">Row errors ({result.errors.length}):</div>
                <ul className="space-y-0.5 list-disc list-inside">
                  {result.errors.slice(0, 50).map((e, i) => (<li key={i}>{e}</li>))}
                  {result.errors.length > 50 && (
                    <li className="italic">…and {result.errors.length - 50} more</li>
                  )}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={done} className="btn btn-primary">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <textarea
              className="input font-mono text-[12px] min-h-[200px]"
              rows={10}
              placeholder={'+91 9876543210,Riya Mehra,1\n+91 9123456780,Karthik,0\n9876543212'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoFocus
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-slate-400">
                Duplicate phones (already in the list) are skipped, not overwritten.
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || !text.trim()}
                  className="btn btn-primary"
                >
                  {busy ? 'Importing…' : 'Import'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
