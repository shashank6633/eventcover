'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Me { role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry'; name: string }

type Mode = 'test' | 'live';
type Health = 'not_configured' | 'test_mode' | 'live_mode';

interface RazorpayState {
  ok: boolean;
  mode: Mode;
  keyId: string;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
}

const MASKED = '••••••••';

export default function RazorpaySettingsPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [mode, setMode] = useState<Mode>('test');
  const [keyId, setKeyId] = useState<string>('');

  const [hasKeySecret, setHasKeySecret] = useState<boolean>(false);
  const [keySecret, setKeySecret] = useState<string>('');
  const [keySecretEdited, setKeySecretEdited] = useState<boolean>(false);

  const [hasWebhookSecret, setHasWebhookSecret] = useState<boolean>(false);
  const [webhookSecret, setWebhookSecret] = useState<string>('');
  const [webhookSecretEdited, setWebhookSecretEdited] = useState<boolean>(false);

  const [stateLoaded, setStateLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // ─── Role gate ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (!d?.ok) { router.replace('/login'); return; }
      if (d.user.role !== 'host') { router.replace('/admin/settings'); return; }
      setMe(d.user);
      setMeLoaded(true);
    });
  }, [router]);

  useEffect(() => {
    if (!meLoaded) return;
    refreshState();
  }, [meLoaded]);

  function refreshState() {
    fetch('/api/settings/razorpay').then((r) => r.json()).then((d: RazorpayState) => {
      if (!d?.ok) return;
      setMode((d.mode as Mode) || 'test');
      setKeyId(d.keyId || '');
      setHasKeySecret(!!d.hasKeySecret);
      setHasWebhookSecret(!!d.hasWebhookSecret);
      setStateLoaded(true);
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setFlash(null);
    try {
      const body: Record<string, string> = {
        mode,
        keyId: keyId.trim(),
      };
      if (keySecretEdited) body.keySecret = keySecret;
      if (webhookSecretEdited) body.webhookSecret = webhookSecret;
      const res = await fetch('/api/settings/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.message || 'Save failed.'); return; }
      setMode((d.mode as Mode) || mode);
      setKeyId(d.keyId || '');
      setHasKeySecret(!!d.hasKeySecret);
      setHasWebhookSecret(!!d.hasWebhookSecret);
      setKeySecret(''); setKeySecretEdited(false);
      setWebhookSecret(''); setWebhookSecretEdited(false);
      setFlash('Saved. Your Razorpay credentials are stored encrypted at rest.');
      setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  if (!meLoaded || !stateLoaded) {
    return <div className="max-w-3xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;
  }

  // ─── Status derivation ──────────────────────────────────────────────────
  // not_configured: keyId empty
  // test_mode:      keyId set + mode='test'
  // live_mode:      keyId set + mode='live' + hasKeySecret
  const health: Health =
    !keyId ? 'not_configured' :
    mode === 'live' && hasKeySecret ? 'live_mode' :
    'test_mode';

  const pillCls =
    health === 'live_mode' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    health === 'test_mode' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                             'bg-slate-50 text-slate-600 border-slate-200';
  const pillLabel =
    health === 'live_mode' ? 'Live · Connected' :
    health === 'test_mode' ? 'Test mode' :
                             'Not configured';

  const expectedPrefix = mode === 'live' ? 'rzp_live_' : 'rzp_test_';
  const keyIdMismatch = keyId !== '' && !keyId.startsWith(expectedPrefix);

  const keySecretInputValue = keySecretEdited
    ? keySecret
    : (hasKeySecret ? MASKED : '');
  const webhookSecretInputValue = webhookSecretEdited
    ? webhookSecret
    : (hasWebhookSecret ? MASKED : '');

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:py-8">
      <button
        type="button"
        onClick={() => router.push('/admin/settings')}
        className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 mb-2"
      >
        ← Back to Settings
      </button>

      <div className="text-[11px] tracking-widest uppercase text-slate-400">Integrations</div>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
        <h1 className="text-2xl font-bold text-slate-900">Razorpay</h1>
        <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border ${pillCls}`}>
          {pillLabel}
        </span>
      </div>
      <p className="text-sm text-slate-500 mt-1 max-w-2xl">
        Razorpay processes payments for your public event pages. Customers can pay a deposit
        to lock in a booking, or pay the full entry + cover upfront and receive their wallet
        pass on WhatsApp automatically. Only the host can view or change these credentials.
      </p>

      {flash && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm break-all">
          {flash}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Test mode warning */}
      {mode === 'test' && keyId && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold mb-1">Test mode — no real money moves</div>
          <div className="text-amber-800/90 text-xs leading-relaxed">
            Test keys won't move real money. To simulate a successful payment, use Razorpay's
            test cards: <span className="font-mono">4111 1111 1111 1111</span>, any CVV, any
            future expiry. Switch to <strong>Live</strong> once you've verified the end-to-end
            booking flow.
          </div>
        </div>
      )}

      {/* Configuration */}
      <form onSubmit={save} className="card mt-6 space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">Configuration</div>

        <div>
          <label className="label">Mode</label>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode('test')}
              className={`px-4 py-1.5 rounded-md font-medium transition ${
                mode === 'test'
                  ? 'bg-white text-amber-700 shadow-sm border border-amber-200'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
              aria-pressed={mode === 'test'}
            >
              Test
            </button>
            <button
              type="button"
              onClick={() => setMode('live')}
              className={`px-4 py-1.5 rounded-md font-medium transition ${
                mode === 'live'
                  ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
              aria-pressed={mode === 'live'}
            >
              Live
            </button>
          </div>
          <div className="text-xs text-slate-500 mt-1.5">
            Test keys start with <span className="font-mono">rzp_test_</span> and use fake
            money. Live keys start with <span className="font-mono">rzp_live_</span> and charge
            real cards. You can flip between them anytime — only the matching key pair is used.
          </div>
        </div>

        <div>
          <label className="label">Key ID</label>
          <input
            className="input font-mono text-xs"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value.trim())}
            placeholder={mode === 'live' ? 'rzp_live_XXXXXXXXXXXX' : 'rzp_test_XXXXXXXXXXXX'}
            autoComplete="off"
          />
          {keyIdMismatch && (
            <div className="text-xs text-amber-700 mt-1">
              Heads up — this Key ID doesn't start with <span className="font-mono">{expectedPrefix}</span>.
              Make sure it matches the selected mode.
            </div>
          )}
          <div className="text-xs text-slate-500 mt-1.5">
            Find it in Razorpay Dashboard → Settings → API Keys. Generate a separate key pair
            for Test mode and Live mode.
          </div>
        </div>

        <div>
          <label className="label">Key Secret</label>
          <input
            className="input font-mono text-xs"
            type="password"
            value={keySecretInputValue}
            onChange={(e) => {
              setKeySecretEdited(true);
              setKeySecret(e.target.value);
            }}
            onFocus={() => {
              if (!keySecretEdited && hasKeySecret) {
                setKeySecretEdited(true);
                setKeySecret('');
              }
            }}
            placeholder={hasKeySecret ? '' : 'Paste your Key Secret'}
            autoComplete="off"
          />
          <div className="text-xs text-slate-500 mt-1.5">
            Shown only once in the Razorpay dashboard — copy it immediately on generation.
            {hasKeySecret && !keySecretEdited && ' Stored secret left in place unless you type a new one.'}
          </div>
        </div>

        <div>
          <label className="label">Webhook Secret</label>
          <input
            className="input font-mono text-xs"
            type="password"
            value={webhookSecretInputValue}
            onChange={(e) => {
              setWebhookSecretEdited(true);
              setWebhookSecret(e.target.value);
            }}
            onFocus={() => {
              if (!webhookSecretEdited && hasWebhookSecret) {
                setWebhookSecretEdited(true);
                setWebhookSecret('');
              }
            }}
            placeholder={hasWebhookSecret ? '' : 'Paste your Webhook Secret'}
            autoComplete="off"
          />
          <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Set this in Razorpay Dashboard → Webhooks → Add new → Active events:
            <span className="font-mono"> payment.captured</span>,
            <span className="font-mono"> payment.failed</span> → Webhook URL:
            <span className="font-mono"> https://wallet.akanhyd.com/api/payments/webhook</span>.
            {hasWebhookSecret && !webhookSecretEdited && ' Stored secret left in place unless you type a new one.'}
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {/* How it works */}
      <div className="card mt-4 space-y-2">
        <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">How it works</div>
        <ul className="text-sm text-slate-600 space-y-2 leading-relaxed list-disc ml-5">
          <li>
            Customer fills the public booking form on{' '}
            <span className="font-mono text-xs">/event/[slug]</span>.
          </li>
          <li>
            Razorpay Checkout opens with your branded color — they pay with UPI, card, netbanking
            or wallet.
          </li>
          <li>
            On success, a wallet is auto-issued and the cover pass is sent to the customer's
            WhatsApp instantly.
          </li>
          <li>
            Webhooks provide a backup confirmation path — handles the rare browser-crash-mid-payment
            scenario, so a paid customer always gets their pass.
          </li>
        </ul>
      </div>

      <div className="mt-6 text-xs text-slate-400">
        Logged in as <span className="font-medium text-slate-600">{me?.name}</span> (host).
        Secret reveals and saves are recorded in the audit log.
      </div>
    </div>
  );
}
