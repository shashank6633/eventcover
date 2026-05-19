'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Me { role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry'; name: string }

type Health = 'not_configured' | 'untested' | 'healthy' | 'error';
interface WebhookStatus {
  ok: boolean;
  health: Health;
  configured: boolean;
  lastAt: number;
  lastAction: string;
  lastStatus: string;
  reservationCountThisMonth: number;
}

const MASKED = '••••••••';

export default function ReservegoSettingsPage() {
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [secret, setSecret] = useState<string>(MASKED);
  const [secretLoaded, setSecretLoaded] = useState(false);
  const [revealSecret, setRevealSecret] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [origin, setOrigin] = useState<string>('');

  const [regenerating, setRegenerating] = useState(false);
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
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, [router]);

  useEffect(() => {
    if (!meLoaded) return;
    refreshSecret();
    refreshStatus();
  }, [meLoaded]);

  function refreshSecret() {
    fetch('/api/config').then((r) => r.json()).then((d) => {
      if (!d?.ok) return;
      const c = d.config as Record<string, string>;
      setSecret(c.RESERVEGO_WEBHOOK_SECRET || '');
      setSecretLoaded(true);
    });
  }

  function refreshStatus() {
    fetch('/api/reservations/webhook-status').then((r) => r.json()).then((d) => {
      if (d.ok) setStatus(d);
    });
  }

  async function regenerate() {
    if (!confirm('Regenerate the webhook secret? You will need to update it in your Reservego dashboard immediately or future webhooks will be rejected.')) return;
    setRegenerating(true); setError(null);
    try {
      const res = await fetch('/api/settings/reservego/regenerate', { method: 'POST' });
      const d = await res.json();
      if (!d.ok) { setError(d.message); return; }
      setSecret(d.secret);
      setRevealSecret(true);
      setFlash('New secret generated. Copy it now — once you leave this page it will be masked.');
      refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setRegenerating(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFlash(`${label} copied.`);
      setTimeout(() => setFlash(null), 3000);
    } catch {
      setFlash(`Couldn't copy automatically — select and copy manually.`);
    }
  }

  /**
   * Fetch the actual secret value (not masked) from the host-only endpoint.
   * Called when the user clicks Reveal — replaces the displayed •••••••• with
   * the real secret, audit-logged on the server.
   */
  async function revealActualSecret() {
    setRevealing(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/reservego/secret');
      const d = await res.json();
      if (!d.ok) { setError(d.message || 'Failed to fetch secret.'); return; }
      setSecret(d.secret);
      setRevealSecret(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setRevealing(false);
    }
  }

  /**
   * Copy the actual secret value (fetch fresh from server if currently masked).
   * Means the host can copy without first clicking Reveal.
   */
  async function copySecret() {
    if (secret && secret !== MASKED) {
      copy(secret, 'Secret');
      return;
    }
    // Need to fetch first
    setRevealing(true);
    try {
      const res = await fetch('/api/settings/reservego/secret');
      const d = await res.json();
      if (!d.ok) { setError(d.message || 'Failed to fetch secret.'); return; }
      setSecret(d.secret);
      copy(d.secret, 'Secret');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setRevealing(false);
    }
  }

  function fmtAgo(ms: number): string {
    if (!ms) return 'never';
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
    return new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  if (!meLoaded || !secretLoaded) {
    return <div className="max-w-3xl mx-auto px-4 py-8 text-slate-400">Loading…</div>;
  }

  const webhookUrl = `${origin}/api/reservations/webhook/reservego`;
  const health = status?.health || (secret ? 'untested' : 'not_configured');

  const pillCls =
    health === 'healthy'        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    health === 'error'          ? 'bg-rose-50 text-rose-700 border-rose-200' :
    health === 'untested'       ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  'bg-slate-50 text-slate-600 border-slate-200';
  const pillLabel =
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

      <div className="text-[11px] tracking-widest uppercase text-slate-400">Integrations</div>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
        <h1 className="text-2xl font-bold text-slate-900">Reservego webhook</h1>
        <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border ${pillCls}`}>
          {pillLabel}
        </span>
      </div>
      <p className="text-sm text-slate-500 mt-1 max-w-2xl">
        Reservego pushes new reservations and status updates to this URL. The shared secret
        below authenticates incoming requests. Only the host can view or rotate it.
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

      {/* Connection status panel */}
      {status && health === 'healthy' && status.lastAt > 0 && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold flex-shrink-0">✓</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-emerald-800">Webhook receiving cleanly</div>
            <div className="text-[11px] text-emerald-700/80">
              Last delivery {fmtAgo(status.lastAt)} · {status.lastAction} · {status.reservationCountThisMonth} reservation(s) this month
            </div>
          </div>
        </div>
      )}
      {status && health === 'error' && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center font-bold flex-shrink-0">!</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-rose-800">Last delivery failed</div>
              <div className="text-xs text-rose-700/90 mt-1">{status.lastAction}</div>
              <div className="text-[11px] text-rose-700/70 mt-1">
                {fmtAgo(status.lastAt)} · check the secret matches your Reservego dashboard.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Webhook URL */}
      <div className="card mt-6 space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">Endpoint</div>
        <div>
          <label className="label">Webhook URL — paste into BOTH fields</label>
          <div className="flex gap-2 items-stretch">
            <input
              className="input font-mono text-xs flex-1"
              value={webhookUrl}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={() => copy(webhookUrl, 'URL')}
              className="btn btn-secondary !px-4 whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <div className="text-xs text-slate-500 mt-1.5">
            In Reservego, paste this <strong>same URL</strong> into both <span className="font-mono">New Booking</span>{' '}
            and <span className="font-mono">Update Booking</span> fields. Our endpoint handles both events via
            upsert (same <span className="font-mono">reservation_id</span> updates the existing row).
          </div>
        </div>

        <div>
          <label className="label">Authorization Token (Reservego field)</label>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-2">
            <div>
              Paste the <strong>shared secret below</strong> (just the secret — no <span className="font-mono">Bearer</span>{' '}
              prefix) into Reservego&apos;s <span className="font-mono">Authorization Token</span> field.
            </div>
            <div className="text-slate-500">
              Our receiver accepts the token in any of these header forms, so it works regardless of how Reservego sends it:
              <ul className="mt-1.5 ml-4 space-y-0.5 list-disc">
                <li><span className="font-mono">Authorization: &lt;token&gt;</span> (raw, Reservego style)</li>
                <li><span className="font-mono">Authorization: Bearer &lt;token&gt;</span></li>
                <li><span className="font-mono">Authorization: Token &lt;token&gt;</span></li>
                <li><span className="font-mono">X-Webhook-Secret: &lt;token&gt;</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Behavior explainer (no toggle — reservations are now first-class) */}
      <div className="card mt-4">
        <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">How it works</div>
        <div className="text-sm text-slate-600 leading-relaxed">
          Reservations from Reservego are stored regardless of whether an event exists for the booking
          date. If the date already has an event, the reservation auto-attaches. Otherwise it appears in
          the <strong>Unassigned</strong> section on the <a href="/admin/reservations" className="text-brand-600 hover:text-brand-700 font-medium">Reservations</a> page.
          When you later create an event for that date, all unassigned reservations for it auto-link with
          entry + cover applied.
        </div>
      </div>

      {/* Shared secret */}
      <div className="card mt-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">Shared secret</div>
            <div className="text-xs text-slate-500 mt-1">
              Treat like a password — anyone with this can push reservations.
            </div>
          </div>
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating}
            className="btn btn-secondary !py-1.5 !px-3 text-xs"
          >
            {regenerating ? 'Generating…' : 'Regenerate'}
          </button>
        </div>

        <div className="flex gap-2 items-stretch">
          <input
            className="input font-mono text-xs flex-1"
            type={revealSecret ? 'text' : 'password'}
            value={secret}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button
            type="button"
            onClick={() => {
              if (revealSecret) {
                // Hide: restore mask, don't touch server
                setRevealSecret(false);
                setSecret(MASKED);
              } else {
                revealActualSecret();
              }
            }}
            disabled={revealing}
            className="btn btn-secondary !px-3 whitespace-nowrap"
          >
            {revealing ? '…' : revealSecret ? 'Hide' : 'Reveal'}
          </button>
          <button
            type="button"
            onClick={copySecret}
            disabled={revealing || !secret}
            className="btn btn-secondary !px-4 whitespace-nowrap"
          >
            Copy
          </button>
        </div>
        <div className="text-xs text-slate-500">
          Reveal and Copy both work as many times as you need — the secret is fetched fresh from the
          server, not regenerated. Every reveal is audit-logged.
        </div>
      </div>

      {/* Payload format reference */}
      <div className="card mt-4 space-y-3">
        <div className="text-xs uppercase tracking-widest text-slate-500">Payload format · Reservego shape</div>
        <div className="text-sm text-slate-600">
          The receiver natively understands Reservego&apos;s schema. No transform needed in Reservego — they
          can send the raw payload as-is. Example of what Reservego pushes:
        </div>
        <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded-lg overflow-x-auto">
{`{
  "bookingId":     "68d6a48a4c2aaa8ebf658ea1",
  "guestName":     "Arul Webhook",
  "guestPhone":    912455432432,
  "guestEmail":    "test@asd.in",
  "guestComments": "Birthday, Anniversary, Age - 40 & above",
  "guestCount":    4,
  "status":        3,
  "bookingTime":   "2025-09-26T15:45:00.000Z",
  "tableNames":    [ "A10", "A12" ],
  "rsrvTags":      [ "Birthday", "Anniversary" ],
  "preferences":   [ "Kids Friendly", "Low Music" ],
  "outletId":      "63beb74e93d2bcc63dcd6de8",
  "outletName":    "Akan Hyderabad"
}`}
        </pre>
        <div className="text-xs text-slate-500 space-y-1.5">
          <div>
            <strong>How fields map:</strong>
          </div>
          <ul className="ml-4 list-disc space-y-0.5">
            <li><span className="font-mono">bookingId</span> → unique external ref for idempotent upsert</li>
            <li><span className="font-mono">guestPhone</span> (number) → normalized to E.164 (e.g. +91…)</li>
            <li><span className="font-mono">bookingTime</span> (UTC ISO) → split into <span className="font-mono">event_date</span> + <span className="font-mono">arrival_time</span> in IST</li>
            <li><span className="font-mono">guestComments</span> + <span className="font-mono">tableNames</span> + <span className="font-mono">preferences</span> → merged into the notes field</li>
            <li><span className="font-mono">status</span> (numeric code): 4 → cancelled · 5 → no-show · 6/7 → converted · others → pending</li>
            <li><span className="font-mono">outletId</span> / <span className="font-mono">outletName</span> → kept in the raw payload for audit</li>
          </ul>
          <div>
            Repeated deliveries with the same <span className="font-mono">bookingId</span> update the
            existing row in place — perfect for Reservego&apos;s separate &quot;New Booking&quot; and
            &quot;Update Booking&quot; webhooks pointing at this same URL.
          </div>
        </div>
      </div>

      {/* Step-by-step Reservego setup */}
      <div className="card mt-4 space-y-3">
        <div className="text-xs uppercase tracking-widest text-slate-500">Reservego dashboard setup</div>
        <ol className="text-sm text-slate-600 space-y-2 list-decimal ml-5">
          <li>In Reservego: <strong>Settings → Integrations → Webhooks</strong> (or wherever the Webhooks panel lives in your account).</li>
          <li>Toggle <strong>Enable Webhook</strong> ON.</li>
          <li>Paste the <strong>Webhook URL</strong> from above into <strong>both</strong>:
            <ul className="ml-4 list-disc text-slate-500 mt-1">
              <li><span className="font-mono text-xs">New Booking</span> — fires when a guest books</li>
              <li><span className="font-mono text-xs">Update Booking</span> — fires on status changes, edits</li>
            </ul>
          </li>
          <li>Paste the <strong>Shared secret</strong> (from this page) into <strong>Authorization Token</strong>.</li>
          <li>Save in Reservego, then run the test curl below to confirm the connection.</li>
        </ol>
      </div>

      {/* Test curl — uses Reservego's actual field names */}
      <div className="card mt-4 space-y-3">
        <div className="text-xs uppercase tracking-widest text-slate-500">Test from terminal</div>
        <div className="text-sm text-slate-600">
          Sends a Reservego-shaped payload to confirm the webhook is reachable. Replace{' '}
          <span className="font-mono text-xs">YOUR_SECRET</span> with the value above, and adjust{' '}
          <span className="font-mono text-xs">bookingTime</span> to a date when you have an active event.
        </div>
        <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded-lg overflow-x-auto">
{`curl -X POST '${webhookUrl}' \\
  -H 'Authorization: YOUR_SECRET' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "bookingId":     "test-001",
    "guestName":     "Test Guest",
    "guestPhone":    919999999999,
    "guestEmail":    "test@example.com",
    "guestComments": "Birthday — please reserve corner booth",
    "guestCount":    2,
    "status":        2,
    "bookingTime":   "2026-05-22T15:30:00.000Z",
    "tableNames":    ["T1"],
    "preferences":   ["Quiet table"]
  }'`}
        </pre>
        <div className="text-xs text-slate-500">
          Expected response: <span className="font-mono">200 {`{ ok: true, action: 'created', reservationId: ... }`}</span>.
          Status pill above will flip to <span className="text-emerald-700">Connected · Healthy</span> after the test fires.
        </div>
      </div>

      <div className="mt-6 text-xs text-slate-400">
        Logged in as <span className="font-medium text-slate-600">{me?.name}</span> (host).
        Webhook receives are recorded in the audit log.
      </div>
    </div>
  );
}
