'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ImageUpload } from '@/components/ImageUpload';

interface Me { role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry' }

export default function SettingsPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => { if (d?.ok) setMe(d.user); });
    fetch('/api/config').then((r) => r.json()).then((d) => {
      if (d.ok) {
        setConfig(d.config || {});
        // Sensitive keys come back as '••••••••' when set, '' when not.
        setWhatsappConnected(
          d.config?.INTERAKT_API_SECRET === '••••••••' && !!d.config?.INTERAKT_BUSINESS_PHONE,
        );
        setLoaded(true);
      }
    });
  }, []);

  function set(key: string, value: string) {
    setConfig((c) => ({ ...c, [key]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            VENUE_NAME:        config.VENUE_NAME        ?? '',
            VENUE_ADDRESS:     config.VENUE_ADDRESS     ?? '',
            VENUE_CITY:        config.VENUE_CITY        ?? '',
            HOST_EMAIL:        config.HOST_EMAIL        ?? '',
            HOST_PHONE:        config.HOST_PHONE        ?? '',
            VENUE_DESCRIPTION: config.VENUE_DESCRIPTION ?? '',
            VENUE_LOGO:        config.VENUE_LOGO        ?? '',
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.message || 'Save failed');
      else {
        setSaved(true);
        setConfig(data.config || config);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <div className="max-w-3xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Configuration</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Settings</h1>
      <p className="text-sm text-slate-500 mt-1">
        Your venue's identity — used across event invites, customer receipts and the
        admin shell. Event dates, cover charges and entry fees are configured per-event
        on the <a href="/admin" className="text-brand-600 hover:underline">Events</a> page.
      </p>

      <form onSubmit={save} className="mt-6 space-y-6">
        {/* ─── Venue Details ──────────────────────────────────────────────── */}
        <div className="card space-y-4">
          <div className="text-xs uppercase tracking-widest text-slate-500">Venue Details</div>

          <div>
            <label className="label">Venue name <span className="text-rose-600">*</span></label>
            <input
              className="input"
              value={config.VENUE_NAME || ''}
              onChange={(e) => set('VENUE_NAME', e.target.value)}
              placeholder="e.g. Akan Hyderabad"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
            <div>
              <label className="label">Address</label>
              <input
                className="input"
                value={config.VENUE_ADDRESS || ''}
                onChange={(e) => set('VENUE_ADDRESS', e.target.value)}
                placeholder="Street / area"
              />
            </div>
            <div>
              <label className="label">City</label>
              <input
                className="input"
                value={config.VENUE_CITY || ''}
                onChange={(e) => set('VENUE_CITY', e.target.value)}
                placeholder="Hyderabad"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Host email</label>
              <input
                className="input"
                type="email"
                value={config.HOST_EMAIL || ''}
                onChange={(e) => set('HOST_EMAIL', e.target.value)}
                placeholder="host@venue.com"
              />
            </div>
            <div>
              <label className="label">Host phone</label>
              <input
                className="input"
                type="tel"
                value={config.HOST_PHONE || ''}
                onChange={(e) => set('HOST_PHONE', e.target.value)}
                placeholder="+91…"
              />
            </div>
          </div>
        </div>

        {/* ─── Venue Description ──────────────────────────────────────────── */}
        <div className="card space-y-4">
          <div className="text-xs uppercase tracking-widest text-slate-500">Venue Description</div>
          <div>
            <label className="label">About the venue</label>
            <textarea
              className="input"
              rows={5}
              value={config.VENUE_DESCRIPTION || ''}
              onChange={(e) => set('VENUE_DESCRIPTION', e.target.value)}
              placeholder="A few lines about your venue — the vibe, what makes it special, what guests can expect."
            />
            <div className="text-xs text-slate-500 mt-1.5">
              Used on customer-facing event invites and booking pages.
            </div>
          </div>
        </div>

        {/* ─── Venue Logo ─────────────────────────────────────────────────── */}
        <div className="card space-y-4">
          <div className="text-xs uppercase tracking-widest text-slate-500">Venue Logo</div>
          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-5 items-start">
            <ImageUpload
              value={config.VENUE_LOGO || ''}
              onChange={(d) => set('VENUE_LOGO', d ?? '')}
              label="Logo"
              helperText="Click or drop. Square works best."
            />
            <div className="text-sm text-slate-500 leading-relaxed">
              Your venue's logo — appears on the admin shell, customer-facing event
              invites, receipts and share previews. A square format with a
              transparent background reads best.
            </div>
          </div>
        </div>

        {/* ─── Integrations (host-only) ───────────────────────────────────── */}
        {me?.role === 'host' && (
          <div className="card space-y-3">
            <div className="text-xs uppercase tracking-widest text-slate-500">Integrations</div>
            <p className="text-sm text-slate-500">
              These sub-pages are restricted to host accounts — they hold secrets used
              for sending WhatsApp messages and processing payments.
            </p>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/admin/settings/whatsapp"
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition"
                >
                  <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
                    {/* WhatsApp glyph */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M20.52 3.48A11.85 11.85 0 0 0 12.07 0C5.48 0 .12 5.36.12 11.95c0 2.1.55 4.16 1.6 5.97L0 24l6.27-1.65a11.94 11.94 0 0 0 5.8 1.48h.01c6.59 0 11.95-5.36 11.95-11.95a11.86 11.86 0 0 0-3.51-8.4ZM12.08 21.8h-.01a9.92 9.92 0 0 1-5.06-1.39l-.36-.21-3.72.98 1-3.62-.24-.37a9.91 9.91 0 0 1-1.51-5.24c0-5.48 4.46-9.94 9.95-9.94 2.66 0 5.15 1.04 7.03 2.92a9.87 9.87 0 0 1 2.91 7.03c0 5.48-4.46 9.94-9.99 9.94Zm5.46-7.43c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.48-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.14.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.46s1.07 2.85 1.22 3.05c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.48 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z"/>
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900">WhatsApp (Interakt)</div>
                    <div className="text-xs text-slate-500">OTP login, reservation &amp; ticket confirmations</div>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    whatsappConnected
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}>
                    {whatsappConnected ? 'Connected' : 'Not configured'}
                  </span>
                  <span className="text-slate-400 text-sm">→</span>
                </Link>
              </li>
              <li>
                <div
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50 opacity-60 cursor-not-allowed"
                  title="Coming next"
                >
                  <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0 font-bold text-sm">
                    Rz
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Razorpay</div>
                    <div className="text-xs text-slate-500">Payment links for ticketed events</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border bg-slate-50 text-slate-500 border-slate-200">
                    Coming soon
                  </span>
                </div>
              </li>
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {saved && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm">
            Settings saved.
          </div>
        )}

        <div className="flex gap-3">
          <button className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
