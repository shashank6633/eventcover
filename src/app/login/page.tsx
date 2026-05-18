'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type IdType = 'email' | 'phone';
type Step = 'identifier' | 'code';

export default function LoginPage() {
  return (
    <Suspense fallback={<Shell><div className="text-slate-500 text-sm">Loading…</div></Shell>}>
      <LoginClient />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<{ venueName: string; venueLogo: string }>({
    venueName: 'Akan',
    venueLogo: '',
  });
  useEffect(() => {
    fetch('/api/branding')
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setBranding({ venueName: d.venueName || 'Akan', venueLogo: d.venueLogo || '' }); })
      .catch(() => { /* keep default */ });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#F8F7F4]">
      <div className="max-w-sm w-full">
        <div className="text-center mb-6 flex flex-col items-center">
          {branding.venueLogo ? (
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-slate-200 shadow-elevated flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={branding.venueLogo} alt={`${branding.venueName} logo`} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-xl bg-brand-500 text-white flex items-center justify-center font-bold text-lg shadow-elevated">
              {(branding.venueName || 'A').trim().charAt(0).toUpperCase() || 'A'}
            </div>
          )}
          <div className="text-[10px] tracking-[0.4em] uppercase text-slate-500 mt-3">{branding.venueName}</div>
          <div className="text-xl font-semibold text-slate-900 mt-0.5">EventCover Wallet</div>
        </div>
        <div className="card">{children}</div>
      </div>
    </div>
  );
}

function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/admin';

  const [step, setStep] = useState<Step>('identifier');
  const [idType, setIdType] = useState<IdType>('email');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Resend cooldown countdown (server-driven)
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, []);

  function startCooldown(seconds: number) {
    setCooldown(seconds);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) { if (cooldownTimer.current) clearInterval(cooldownTimer.current); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  async function sendOtp(isResend = false) {
    setError(null);
    setInfo(null);
    if (!identifier.trim()) {
      setError(idType === 'email' ? 'Enter your email id.' : 'Enter your mobile number.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), type: idType }),
      });
      const data = await res.json();

      if (res.status === 429 && data.cooldownSeconds) {
        startCooldown(data.cooldownSeconds);
        setError(data.message);
        return;
      }
      if (!data.ok) {
        setError(data.message || 'Could not send OTP. Try again.');
        return;
      }

      setStep('code');
      setInfo(
        data.channel === 'console'
          ? `OTP sent. Check the server console (delivery provider not configured for ${idType}).`
          : `OTP sent to your ${idType === 'email' ? 'email inbox' : 'WhatsApp'}.`
      );
      // Dev-only: server echoes the code back when NODE_ENV=development AND the channel
      // is 'console'. Production builds never include this.
      setDevCode(typeof data.devCode === 'string' ? data.devCode : null);
      startCooldown(60);
      if (isResend) setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,8}$/.test(code)) {
      setError('Enter the 6-digit code from your message.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), type: idType, code }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'Verification failed.');
        return;
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  function backToIdentifier() {
    setStep('identifier');
    setCode('');
    setError(null);
    setInfo(null);
    setDevCode(null);
  }

  function switchChannel() {
    setIdType((t) => (t === 'email' ? 'phone' : 'email'));
    setIdentifier('');
    setError(null);
  }

  return (
    <Shell>
      {step === 'identifier' && (
        <>
          <div className="text-xl font-semibold text-slate-900">Log in to your account</div>
          <div className="text-sm text-slate-500 mt-1">
            Welcome back! Please enter your {idType === 'email' ? 'email id' : 'mobile number'}.
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); sendOtp(); }}
            className="mt-5 space-y-4"
          >
            {error && <ErrorBox>{error}</ErrorBox>}

            <div>
              <label className="label">
                {idType === 'email' ? 'Email Id' : 'Mobile Number'} <span className="text-rose-600">*</span>
              </label>
              <input
                key={idType}
                className="input"
                type={idType === 'email' ? 'email' : 'tel'}
                inputMode={idType === 'email' ? 'email' : 'tel'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={idType === 'email' ? 'Enter your email id' : 'Enter your mobile number (+91…)'}
                autoFocus
                autoComplete={idType === 'email' ? 'email' : 'tel'}
              />
            </div>

            <button className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Sending OTP…' : 'Send OTP'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-widest text-slate-400">
            <span className="flex-1 h-px bg-slate-200"></span>
            <span>or</span>
            <span className="flex-1 h-px bg-slate-200"></span>
          </div>

          <button
            type="button"
            onClick={switchChannel}
            className="btn btn-secondary w-full"
          >
            {idType === 'email' ? 'Use Mobile' : 'Use Email'}
          </button>
        </>
      )}

      {step === 'code' && (
        <>
          <button
            type="button"
            onClick={backToIdentifier}
            className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            Back
          </button>
          <div className="text-xl font-semibold text-slate-900 mt-2">Enter your OTP</div>
          <div className="text-sm text-slate-500 mt-1">
            Sent to <span className="font-medium text-slate-700">{maskIdentifier(identifier, idType)}</span>
          </div>

          <form onSubmit={verify} className="mt-5 space-y-4">
            {error && <ErrorBox>{error}</ErrorBox>}
            {info && !error && <InfoBox>{info}</InfoBox>}
            {devCode && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm flex items-center gap-3">
                <div className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold whitespace-nowrap">
                  Dev mode
                </div>
                <div className="font-mono text-base font-bold text-amber-900 tracking-[0.25em]">
                  {devCode}
                </div>
                <button
                  type="button"
                  onClick={() => setCode(devCode)}
                  className="ml-auto text-[11px] font-semibold text-amber-700 hover:text-amber-900 px-2.5 py-1 rounded-full bg-white border border-amber-300"
                >
                  Use this code
                </button>
              </div>
            )}

            <div>
              <label className="label">OTP <span className="text-rose-600">*</span></label>
              <input
                className="input input-pin"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                autoFocus
                autoComplete="one-time-code"
              />
            </div>

            <button className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify & Sign in'}
            </button>
          </form>

          <div className="mt-4 text-center">
            {cooldown > 0 ? (
              <span className="text-xs text-slate-500">
                Resend available in {cooldown}s
              </span>
            ) : (
              <button
                type="button"
                onClick={() => sendOtp(true)}
                disabled={busy}
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                Resend OTP
              </button>
            )}
          </div>
        </>
      )}

      <div className="mt-5 text-[11px] text-slate-400 leading-relaxed border-t border-slate-100 pt-4">
        First time? The bootstrapped Host account uses phone <span className="font-mono text-slate-600">+910000000000</span>.
        Choose <b>Use Mobile</b> and tap Send OTP — the code prints to the server console until you wire up a delivery provider.
      </div>
    </Shell>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
      {children}
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 text-brand-700 px-3 py-2 text-sm">
      {children}
    </div>
  );
}

function maskIdentifier(id: string, type: IdType): string {
  if (type === 'email') {
    const [user, domain] = id.split('@');
    if (!domain) return id;
    if (user.length <= 2) return `${user}@${domain}`;
    return `${user[0]}${'*'.repeat(Math.min(user.length - 2, 4))}${user.slice(-1)}@${domain}`;
  }
  // phone
  const cleaned = id.replace(/\s+/g, '');
  if (cleaned.length <= 4) return cleaned;
  return cleaned.slice(0, 3) + '*'.repeat(cleaned.length - 5) + cleaned.slice(-2);
}
