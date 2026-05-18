'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Me { role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry'; name: string }

type Health = 'not_configured' | 'untested' | 'healthy' | 'error';
interface StatusResponse {
  ok: boolean;
  health: Health;
  businessPhone?: string;
  lastAttempt?: {
    at: number;
    by: string;
    template?: string;
    to?: string;
    ok?: boolean;
    status?: number;
    error?: string;
  };
}

const MASKED = '••••••••';

export default function WhatsAppSettingsPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [config, setConfig] = useState<{ secretMasked: boolean; businessPhone: string }>({
    secretMasked: false,
    businessPhone: '',
  });
  const [loaded, setLoaded] = useState(false);

  // Form state
  const [apiSecret, setApiSecret] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  /** When true, OTP_PROVIDER is set to 'whatsapp' (Interakt). When false, falls back to 'console'. */
  const [useWhatsAppForOtp, setUseWhatsAppForOtp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Test-send state
  const [testTemplate, setTestTemplate] = useState<'akan_login_otp' | 'reservation_confirmed' | 'ticket_confirmed'>('akan_login_otp');
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Connection health (reads latest test-send audit row)
  const [status, setStatus] = useState<StatusResponse | null>(null);
  function refreshStatus() {
    fetch('/api/settings/whatsapp/status')
      .then((r) => r.json())
      .then((d: StatusResponse) => { if (d.ok) setStatus(d); })
      .catch(() => { /* non-blocking */ });
  }

  // ─── Role gate ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!d?.ok) { router.replace('/login'); return; }
        if (d.user.role !== 'host') { router.replace('/admin/settings'); return; }
        setMe(d.user);
        setMeLoaded(true);
      });
  }, [router]);

  // ─── Load existing config + connection health ────────────────────────────
  useEffect(() => {
    if (!meLoaded) return;
    fetch('/api/config').then((r) => r.json()).then((d) => {
      if (!d?.ok) return;
      const c = d.config as Record<string, string>;
      setConfig({
        secretMasked: c.INTERAKT_API_SECRET === MASKED,
        businessPhone: c.INTERAKT_BUSINESS_PHONE || '',
      });
      setBusinessPhone(c.INTERAKT_BUSINESS_PHONE || '');
      setApiSecret(c.INTERAKT_API_SECRET === MASKED ? MASKED : '');
      setUseWhatsAppForOtp(c.OTP_PROVIDER === 'whatsapp');
      setLoaded(true);
    });
    refreshStatus();
  }, [meLoaded]);

  if (!meLoaded || !loaded) {
    return <div className="max-w-3xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setSaved(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            INTERAKT_API_SECRET: apiSecret,
            INTERAKT_BUSINESS_PHONE: businessPhone,
            // Flip the OTP delivery channel together with credentials so the
            // host has one save button for the whole flow.
            OTP_PROVIDER: useWhatsAppForOtp ? 'whatsapp' : 'console',
          },
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.message || 'Save failed.'); return; }
      setSaved('Saved.');
      setConfig({
        secretMasked: d.config.INTERAKT_API_SECRET === MASKED,
        businessPhone: d.config.INTERAKT_BUSINESS_PHONE || '',
      });
      // Re-mask the field if a real secret is now stored
      if (d.config.INTERAKT_API_SECRET === MASKED) setApiSecret(MASKED);
      refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(null), 3000);
    }
  }

  async function testSend(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch('/api/settings/whatsapp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: testTemplate, phone: testPhone }),
      });
      const d = await res.json();
      setTestResult({
        ok: !!d.ok,
        message: d.ok
          ? `Sent to ${d.to}${d.messageId ? ` (msg ${d.messageId})` : ''}`
          : `Failed: ${d.message || 'unknown error'}`,
      });
      refreshStatus();
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
      refreshStatus();
    } finally {
      setTesting(false);
    }
  }

  function fmtAgo(ms: number): string {
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
    return new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const connected = config.secretMasked && !!config.businessPhone;
  const health: Health = status?.health ?? (connected ? 'untested' : 'not_configured');

  const statusPillClass =
    health === 'healthy'        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    health === 'error'          ? 'bg-rose-50    text-rose-700    border-rose-200'    :
    health === 'untested'       ? 'bg-amber-50   text-amber-700   border-amber-200'   :
                                  'bg-slate-50   text-slate-600   border-slate-200';
  const statusLabel =
    health === 'healthy'        ? 'Connected · Healthy' :
    health === 'error'          ? 'Connection Issue' :
    health === 'untested'       ? 'Saved · Untested' :
                                  'Not configured';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:py-8">
      <button
        type="button"
        onClick={() => router.push('/admin/settings')}
        className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 mb-2"
      >
        ← Back to Settings
      </button>

      <div className="text-[11px] tracking-widest uppercase text-slate-400">Configuration</div>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
        <h1 className="text-2xl font-bold text-slate-900">WhatsApp</h1>
        <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border ${statusPillClass}`}>
          {statusLabel}
        </span>
      </div>
      <p className="text-sm text-slate-500 mt-1 max-w-2xl">
        Configure WhatsApp delivery via Interakt. Used for OTP login, reservation
        confirmations and ticket confirmations. Only the host can edit these settings.
      </p>

      {/* Connection health banner */}
      {health === 'error' && status?.lastAttempt && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center font-bold flex-shrink-0">!</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-rose-800">Connection issue detected</div>
              <div className="text-xs text-rose-700/90 mt-1">
                <span className="font-mono">{status.lastAttempt.status ?? '—'}</span>
                {' · '}
                {status.lastAttempt.error || 'unknown error'}
              </div>
              <div className="text-[11px] text-rose-700/70 mt-1">
                Last attempt: {fmtAgo(status.lastAttempt.at)}
                {status.lastAttempt.template ? ` · template ${status.lastAttempt.template}` : ''}
                {status.lastAttempt.to ? ` · to ${status.lastAttempt.to}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={refreshStatus}
              className="text-xs font-semibold text-rose-700 hover:text-rose-900 px-2.5 py-1 rounded-full bg-white border border-rose-200 self-start"
            >
              Refresh
            </button>
          </div>
        </div>
      )}
      {health === 'healthy' && status?.lastAttempt && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold flex-shrink-0">✓</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-emerald-800">All systems go</div>
            <div className="text-[11px] text-emerald-700/80">
              Last successful send {fmtAgo(status.lastAttempt.at)}
              {status.lastAttempt.template ? ` · ${status.lastAttempt.template}` : ''}
            </div>
          </div>
        </div>
      )}
      {health === 'untested' && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Credentials saved but the integration hasn't been tested yet. Run a test send below to verify.
        </div>
      )}

      {/* Credentials */}
      <form onSubmit={save} className="card mt-6 space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">Credentials</div>

        <div>
          <label className="label">Provider</label>
          <input className="input bg-slate-50 cursor-not-allowed" value="Interakt" readOnly />
        </div>

        <div>
          <label className="label">
            API Secret <span className="text-rose-600">*</span>
          </label>
          <input
            className="input font-mono"
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder={config.secretMasked ? '••••••••  (set — replace to update)' : 'Paste Interakt API secret'}
            autoComplete="off"
          />
          <div className="text-xs text-slate-500 mt-1.5">
            From Interakt → Developer Settings → API Keys. Stored as a write-only secret;
            never returned in API responses after save.
          </div>
        </div>

        <div>
          <label className="label">WhatsApp Business phone number <span className="text-rose-600">*</span></label>
          <input
            className="input"
            value={businessPhone}
            onChange={(e) => setBusinessPhone(e.target.value)}
            placeholder="+91XXXXXXXXXX"
          />
          <div className="text-xs text-slate-500 mt-1.5">
            The verified sender number from your Interakt dashboard. Display-only —
            Interakt knows the sender from your account; this is shown on the
            Settings page so operators can confirm the right account is connected.
          </div>
        </div>

        {/* OTP delivery channel toggle */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 accent-brand-500 cursor-pointer"
              checked={useWhatsAppForOtp}
              onChange={(e) => setUseWhatsAppForOtp(e.target.checked)}
              disabled={!config.secretMasked && !apiSecret}
            />
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-900">
                Use WhatsApp for OTP login
              </div>
              <div className="text-xs text-slate-500 mt-1">
                When ON, login OTPs are sent via the approved <span className="font-mono">akan_login_otp</span>
                {' '}template (Auto-fill on Android, Copy code button). When OFF, codes print to the
                server console for dev mode.
              </div>
              {!config.secretMasked && !apiSecret && (
                <div className="text-[11px] text-amber-700 mt-1.5">
                  Save an Interakt API secret first to enable this toggle.
                </div>
              )}
            </div>
          </label>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {saved && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm">
            {saved}
          </div>
        )}

        <div className="flex gap-3">
          <button className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save credentials'}
          </button>
        </div>
      </form>

      {/* Test send */}
      <form onSubmit={testSend} className="card mt-4 space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">Test send</div>
        <p className="text-sm text-slate-500">
          Fire one of your approved templates to a phone number to confirm Interakt is wired up
          correctly. The recipient will receive a real WhatsApp message with test placeholder values.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Template</label>
            <select
              className="input"
              value={testTemplate}
              onChange={(e) => setTestTemplate(e.target.value as 'akan_login_otp' | 'reservation_confirmed' | 'ticket_confirmed')}
            >
              <option value="akan_login_otp">akan_login_otp — Login OTP (Auth)</option>
              <option value="reservation_confirmed">reservation_confirmed — Reservation Confirmation</option>
              <option value="ticket_confirmed">ticket_confirmed — Ticket Confirmation</option>
            </select>
          </div>
          <div>
            <label className="label">Send to (phone)</label>
            <input
              className="input"
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+91XXXXXXXXXX"
            />
          </div>
        </div>

        {testResult && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            testResult.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}>
            {testResult.message}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={testing || !connected}
            title={!connected ? 'Save credentials first' : ''}
          >
            {testing ? 'Sending…' : 'Send test'}
          </button>
          {!connected && (
            <span className="text-xs text-slate-500 self-center">Save credentials first to enable test send.</span>
          )}
        </div>
      </form>

      <div className="mt-6 text-xs text-slate-400">
        Logged in as <span className="font-medium text-slate-600">{me?.name}</span> (host).
        Every save and test-send is recorded in the audit log.
      </div>
    </div>
  );
}
