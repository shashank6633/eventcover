'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Affiliate, PromoteLinkStats } from '@/lib/affiliates';
import type { PromoteTabId } from './page';

type LinkRow = Affiliate & { stats: PromoteLinkStats };

interface Props {
  eventId: string;
  eventSlug: string | null;
  initialTab: PromoteTabId;
}

/**
 * Client tab container for the Promote page. Owns URL-synced tab state
 * and mounts only the active tab so both tabs fetch lazily.
 */
export function PromoteShell({ eventId, eventSlug, initialTab }: Props) {
  const [tab, setTab] = useState<PromoteTabId>(initialTab);

  const syncUrl = useCallback((next: PromoteTabId) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url.toString());
  }, []);

  useEffect(() => { syncUrl(tab); }, [tab, syncUrl]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 border-b border-slate-200">
        <TabButton active={tab === 'tracking'} onClick={() => setTab('tracking')}>
          Tracking Links
        </TabButton>
        <TabButton active={tab === 'affiliate'} onClick={() => setTab('affiliate')}>
          Affiliate Links
        </TabButton>
      </div>

      {tab === 'tracking' ? (
        <TrackingLinksTab eventId={eventId} eventSlug={eventSlug} />
      ) : (
        <AffiliateLinksTab eventId={eventId} eventSlug={eventSlug} />
      )}
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
        active
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </button>
  );
}

// ─── Tracking Links Tab ───────────────────────────────────────────────────

function TrackingLinksTab({ eventId, eventSlug }: { eventId: string; eventSlug: string | null }) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/events/${eventId}/promote/tracking-links`, { cache: 'no-store' });
      const d = await r.json();
      if (d.ok) setLinks(d.links || []);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/events/${eventId}/promote/tracking-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, notes: notes || null }),
      });
      const d = await r.json();
      if (!d.ok) { setErr(d.message || 'Failed to create.'); return; }
      setName('');
      setNotes('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(linkId: string) {
    if (!confirm('Delete this tracking link? Existing click + sale history will be lost.')) return;
    const r = await fetch(
      `/api/events/${eventId}/promote/tracking-links?linkId=${encodeURIComponent(linkId)}`,
      { method: 'DELETE' },
    );
    const d = await r.json();
    if (!d.ok) { alert(d.message || 'Failed to delete.'); return; }
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-base font-semibold text-slate-900">Add a tracking link</h2>
        <p className="text-xs text-slate-500 mt-1">
          Channel attribution only — no commission. Use to compare Instagram, WhatsApp,
          stories, etc. against each other for this event.
        </p>
        <form onSubmit={onCreate} className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. instagram-story-1"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            required
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <button type="submit" className="btn btn-dark whitespace-nowrap" disabled={busy}>
            {busy ? 'Adding…' : 'Add link'}
          </button>
        </form>
        {err && <div className="text-xs text-rose-600 mt-2">{err}</div>}
      </div>

      <LinksList
        loading={loading}
        links={links}
        eventSlug={eventSlug}
        onDelete={onDelete}
        emptyHint="No tracking links yet — add one above to start measuring channels."
      />
    </div>
  );
}

// ─── Affiliate Links Tab ──────────────────────────────────────────────────

function AffiliateLinksTab({ eventId, eventSlug }: { eventId: string; eventSlug: string | null }) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [type, setType] = useState<'' | 'percent' | 'flat'>('');
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/events/${eventId}/promote/affiliate-links`, { cache: 'no-store' });
      const d = await r.json();
      if (d.ok) setLinks(d.links || []);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function onAttach(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/events/${eventId}/promote/affiliate-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          commissionType: type || null,
          commissionValue: value === '' ? null : Number(value),
        }),
      });
      const d = await r.json();
      if (!d.ok) { setErr(d.message || 'Failed to attach.'); return; }
      setCode('');
      setType('');
      setValue('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onUnassign(linkId: string) {
    if (!confirm('Remove this affiliate from the event? Their existing commissions on this event remain.')) return;
    const r = await fetch(
      `/api/events/${eventId}/promote/affiliate-links?linkId=${encodeURIComponent(linkId)}&mode=unassign`,
      { method: 'DELETE' },
    );
    const d = await r.json();
    if (!d.ok) { alert(d.message || 'Failed to unassign.'); return; }
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-base font-semibold text-slate-900">Attach a commission affiliate</h2>
        <p className="text-xs text-slate-500 mt-1">
          Use an existing affiliate code from{' '}
          <a href="/admin/affiliates" className="text-brand-600 hover:text-brand-700 underline">
            /admin/affiliates
          </a>
          . Override the commission below to set per-event rates, or leave blank to inherit the affiliate&apos;s default.
        </p>
        <form onSubmit={onAttach} className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Affiliate code (e.g. ALEX01)"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm uppercase focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            required
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'percent' | 'flat' | '')}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">Override type (optional)</option>
            <option value="percent">Percent</option>
            <option value="flat">Flat (₹ per pax)</option>
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Override value"
            disabled={!type}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button type="submit" className="btn btn-dark whitespace-nowrap" disabled={busy}>
            {busy ? 'Attaching…' : 'Attach'}
          </button>
        </form>
        {err && <div className="text-xs text-rose-600 mt-2">{err}</div>}
      </div>

      <LinksList
        loading={loading}
        links={links}
        eventSlug={eventSlug}
        onDelete={onUnassign}
        deleteLabel="Unassign"
        emptyHint="No commission affiliates attached to this event yet."
      />
    </div>
  );
}

// ─── Shared link card list ────────────────────────────────────────────────

function LinksList({
  loading, links, eventSlug, onDelete, deleteLabel = 'Delete', emptyHint,
}: {
  loading: boolean;
  links: LinkRow[];
  eventSlug: string | null;
  onDelete: (linkId: string) => void;
  deleteLabel?: string;
  emptyHint: string;
}) {
  if (loading) return <div className="text-sm text-slate-500 py-6 text-center">Loading…</div>;
  if (links.length === 0) {
    return (
      <div className="card text-center py-8">
        <div className="text-sm text-slate-500">{emptyHint}</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {links.map((l) => (
        <LinkCard key={l.id} link={l} eventSlug={eventSlug} onDelete={onDelete} deleteLabel={deleteLabel} />
      ))}
    </div>
  );
}

function LinkCard({
  link, eventSlug, onDelete, deleteLabel,
}: {
  link: LinkRow;
  eventSlug: string | null;
  onDelete: (linkId: string) => void;
  deleteLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const fullUrl = buildPromoteUrl(eventSlug, link.code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — fall back to a tiny prompt so the operator still gets the URL
      prompt('Copy this URL', fullUrl);
    }
  }

  const conv = link.stats.clicks > 0
    ? `${(link.stats.conversion_rate * 100).toFixed(1)}%`
    : '—';

  return (
    <div className="card !p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-semibold text-slate-900 truncate">{link.name}</div>
          <div className="text-xs font-mono text-slate-500 mt-0.5">{link.code}</div>
        </div>
        <button
          type="button"
          onClick={() => onDelete(link.id)}
          className="text-xs text-rose-600 hover:text-rose-700 font-medium whitespace-nowrap"
        >
          {deleteLabel}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700 truncate">
          {fullUrl}
        </div>
        <button
          type="button"
          onClick={copy}
          className="btn btn-dark whitespace-nowrap text-xs px-3 py-2"
        >
          {copied ? 'Copied!' : 'Copy URL'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Stat label="Clicks" value={link.stats.clicks.toLocaleString('en-IN')} />
        <Stat label="Sales" value={link.stats.sales.toLocaleString('en-IN')} />
        <Stat
          label="Revenue"
          value={link.stats.revenue > 0 ? `₹${link.stats.revenue.toLocaleString('en-IN')}` : '—'}
        />
        <Stat label="Conv." value={conv} />
      </div>

      {link.kind === 'commission' && (
        <div className="mt-3 text-[11px] text-slate-500">
          Commission:{' '}
          {link.commission_type === 'percent'
            ? `${link.commission_value}%`
            : `₹${link.commission_value}/pax`}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-[#FAFAF7] py-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function buildPromoteUrl(eventSlug: string | null, code: string): string {
  // Falls back to window.location.origin on the client; SSR rendering of
  // this component never happens because PromoteShell is 'use client'.
  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const path = eventSlug ? `/event/${eventSlug}` : '/';
  return `${origin}${path}?t=${encodeURIComponent(code)}`;
}
