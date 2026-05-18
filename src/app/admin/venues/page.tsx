'use client';

import { useEffect, useState } from 'react';
import type { Venue } from '@/lib/venues';

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Venue | 'new' | null>(null);
  const [me, setMe] = useState<{ role: string } | null>(null);

  async function load() {
    setLoading(true);
    const data = await fetch('/api/venues', { cache: 'no-store' }).then((r) => r.json());
    if (data.ok) setVenues(data.venues || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch('/api/auth/me').then((r) => r.json()).then((d) => { if (d.ok) setMe(d.user); });
  }, []);

  async function remove(v: Venue) {
    if (!confirm(`Delete "${v.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/venues/${v.id}`, { method: 'DELETE' }).then((r) => r.json());
    if (!res.ok) { alert(res.message); return; }
    load();
  }

  const canDelete = me?.role === 'host';

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 py-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] tracking-widest uppercase text-slate-500">Locations</div>
          <h2 className="text-xl font-semibold text-slate-900 mt-1">Venues</h2>
        </div>
        {!editing && (
          <button className="btn btn-dark inline-flex items-center gap-2" onClick={() => setEditing('new')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add New Venue
          </button>
        )}
      </div>

      {editing && (
        <VenueForm
          initial={editing === 'new' ? null : editing}
          onSave={async () => { await load(); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {!editing && (
        <div className="card mt-6 overflow-x-auto">
          {loading ? (
            <div className="text-slate-500 text-sm">Loading…</div>
          ) : venues.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-sm text-slate-500">No venues yet.</div>
              <button className="mt-3 text-sm font-medium text-brand-600 hover:text-brand-700" onClick={() => setEditing('new')}>
                + Add your first venue
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-200">
                  <th className="pb-3 font-semibold">Name</th>
                  <th className="pb-3 font-semibold">City</th>
                  <th className="pb-3 font-semibold">Google Maps URL</th>
                  <th className="pb-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((v) => (
                  <tr key={v.id} className="border-b border-slate-100 last:border-0 group">
                    <td className="py-4 text-slate-900 font-semibold">
                      {v.name}
                      {!v.active && <span className="ml-2 tag tag-exhausted">Disabled</span>}
                    </td>
                    <td className="py-4 text-slate-700">{v.city}</td>
                    <td className="py-4 text-slate-500">
                      {v.google_maps_url ? (
                        <a
                          href={v.google_maps_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-brand-600 hover:text-brand-700 hover:underline truncate inline-block max-w-[280px] align-bottom"
                          title={v.google_maps_url}
                        >
                          {v.google_maps_url}
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-4 text-right whitespace-nowrap">
                      <button
                        className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100 transition"
                        onClick={() => setEditing(v)}
                        aria-label={`Edit ${v.name}`}
                      >
                        <IconPencil />
                      </button>
                      {canDelete && (
                        <button
                          className="text-slate-500 hover:text-rose-600 p-1.5 rounded hover:bg-rose-50 transition ml-1"
                          onClick={() => remove(v)}
                          aria-label={`Delete ${v.name}`}
                        >
                          <IconTrash />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function VenueForm({ initial, onSave, onCancel }: {
  initial: Venue | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [mapsUrl, setMapsUrl] = useState(initial?.google_maps_url ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) { setError('Name is required.'); return; }
    if (!city.trim()) { setError('City is required.'); return; }
    if (mapsUrl.trim() && !isValidUrl(mapsUrl.trim())) {
      setError('Google Maps URL is not a valid URL (must start with http:// or https://).');
      return;
    }

    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        city: city.trim(),
        google_maps_url: mapsUrl.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
      };
      const url = isEdit ? `/api/venues/${initial!.id}` : '/api/venues';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.message || 'Save failed.'); return; }
      onSave();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mt-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-900">
          {isEdit ? `Edit ${initial!.name}` : 'Add new venue'}
        </div>
        <button type="button" className="text-xs text-slate-500 hover:text-slate-900" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Name <span className="text-rose-600">*</span></label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Akan Hyderabad"
            autoFocus
          />
        </div>
        <div>
          <label className="label">City <span className="text-rose-600">*</span></label>
          <input
            className="input"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Hyderabad"
          />
        </div>
      </div>

      <div>
        <label className="label">Google Maps URL</label>
        <input
          className="input"
          type="url"
          value={mapsUrl}
          onChange={(e) => setMapsUrl(e.target.value)}
          placeholder="https://www.google.com/maps/place/..."
        />
        <div className="mt-1.5 text-xs text-slate-500">
          Open Google Maps → search your venue → tap Share → copy link. Paste it here.
        </div>
      </div>

      <div>
        <label className="label">Address (optional)</label>
        <input
          className="input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Plot 23, Road 12, Banjara Hills, Hyderabad 500034"
        />
      </div>

      <div>
        <label className="label">Internal notes (optional)</label>
        <textarea
          className="input min-h-[80px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Capacity, parking, AC, anything your team should know"
        />
      </div>

      <div className="flex gap-3">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create venue')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

function IconPencil() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
    </svg>
  );
}
