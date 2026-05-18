'use client';

import { useEffect, useState } from 'react';

const DEFAULT_TNC = `Entry fee is converted into a cover wallet redeemable at this venue only.

The QR code and QR Code ID issued at entry are required together to redeem. Guests must keep the QR Code ID private — do not share with anyone except the captain at your table.

Cover wallets expire at 2:00 AM IST on the day following the event date. Unredeemed balance after expiry is non-refundable and non-transferable.

Captains may refuse redemption if the wallet has expired, been flagged for suspicious activity, or cannot produce the correct QR Code ID after 3 attempts (QR Code ID is locked for 5 minutes).

The venue reserves the right to revoke any wallet found to be shared, screenshotted in public, or used fraudulently. Management's decision on disputes is final.

By accepting entry, the guest agrees to these terms.`;

export default function TnCPage() {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((d) => {
      if (d.ok) {
        setText(d.config?.TNC_TEXT || DEFAULT_TNC);
        setLoaded(true);
      }
    });
  }, []);

  async function save() {
    setSaving(true); setSaved(false);
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { TNC_TEXT: text } }),
    });
    setSaved(true);
    setSaving(false);
  }

  function resetToDefault() {
    setText(DEFAULT_TNC);
    setSaved(false);
  }

  if (!loaded) return <div className="max-w-3xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Legal</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Terms & Conditions</h1>
      <p className="text-sm text-slate-400 mt-1">
        Shown to guests at entry (printed on slip or linked from QR pass). Keep it short and
        legally tight.
      </p>

      <div className="card mt-6">
        <label className="label">Terms text</label>
        <textarea
          className="input min-h-[360px] font-mono text-xs leading-relaxed"
          value={text}
          onChange={(e) => { setText(e.target.value); setSaved(false); }}
        />
        <div className="mt-3 flex gap-3 items-center">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-secondary" onClick={resetToDefault}>
            Reset to default
          </button>
          {saved && (
            <span className="text-emerald-700 text-sm">Saved ✓</span>
          )}
        </div>
      </div>

      <div className="card mt-4">
        <div className="font-semibold text-slate-900">Preview</div>
        <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      </div>
    </div>
  );
}
