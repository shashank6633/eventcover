'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Camera QR scanner specialised for reservation tokens.
 *
 * The existing src/components/QrScanner.tsx targets *wallet* QR codes — it
 * extracts a short, human-readable transaction ID via a regex (`SKY-0516-…`).
 * Reservation QRs carry a long opaque HMAC-signed token instead
 * (`<base64url>.<base64url>`, see src/lib/signed-url.ts), so the old
 * extractor would treat every reservation scan as a "not an EventCover QR"
 * miss. Rather than overload the existing extractor — and risk wallet
 * regressions on the captain redeem screen — this is a separate scanner.
 *
 * Accepts:
 *   • bare token:    `<b64url>.<b64url>`
 *   • full URL:      `.../admin/scan?token=<b64url>.<b64url>`
 *                    `.../admin/checkin?token=<b64url>.<b64url>`
 *                    `.../r/<b64url>.<b64url>` (future deep link)
 *
 * Anything else is reported as a near-miss but the scanner keeps running.
 */
interface Props {
  onDetected: (token: string, fullText: string) => void;
  onClose: () => void;
  /** Optional override of the modal title — defaults to "Scan reservation QR". */
  title?: string;
}

type Html5QrcodeInstance = {
  stop: () => Promise<void>;
  clear: () => void;
};

export function ReservationQrScanner({ onDetected, onClose, title }: Props) {
  const containerId = 'ec-res-qr-reader';
  const readerRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  /**
   * Tracks whether scanner.start() has resolved and we haven't yet stopped.
   * html5-qrcode's stop() throws a string (not Error) if the scanner isn't
   * running. Cleanup and the detection callback can both race to stop —
   * without this flag they double-stop and crash in dev.
   */
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [lastMiss, setLastMiss] = useState<string | null>(null);

  // Stable callback ref — keeps onDetected fresh without re-triggering the
  // start effect on every parent re-render (which would tear down the camera).
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  function safeStop(): Promise<void> {
    const s = scannerRef.current;
    if (!s || !startedRef.current) return Promise.resolve();
    startedRef.current = false;
    try {
      const p = s.stop();
      return Promise.resolve(p)
        .then(() => {
          try {
            s.clear();
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          /* already stopped */
        });
    } catch {
      return Promise.resolve();
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mod = await import('html5-qrcode');
        if (cancelled) return;

        const Html5Qrcode = mod.Html5Qrcode;
        const scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner;

        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || cameras.length === 0) {
          setError('No camera detected. Paste the token manually below.');
          setStarting(false);
          return;
        }
        const back = cameras.find((c: { label: string }) => /back|rear|environment/i.test(c.label));
        const cameraId = (back || cameras[0]).id;

        await scanner.start(
          cameraId,
          {
            fps: 10,
            qrbox: { width: 260, height: 260 },
            aspectRatio: 1,
          },
          (decoded: string) => {
            if (!startedRef.current) return;
            const token = extractToken(decoded);
            if (!token) {
              setLastMiss(truncate(decoded, 60));
              return;
            }
            setLastMiss(null);
            safeStop().then(() => onDetectedRef.current(token, decoded));
          },
          () => {
            /* normal "frame without a QR" — ignore */
          },
        );
        startedRef.current = true;
        setStarting(false);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not start camera';
        if (/permission|denied/i.test(msg)) {
          setError('Camera permission denied. Enable it in your browser settings and retry.');
        } else {
          setError(msg);
        }
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      void safeStop();
    };
    // Mount-once effect — onDetected is captured via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <div className="text-[10px] tracking-widest uppercase text-slate-500">Scanner</div>
            <div className="text-sm font-semibold text-slate-900">{title || 'Scan reservation QR'}</div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 p-1"
            aria-label="Close scanner"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="relative bg-black aspect-square">
          <div id={containerId} ref={readerRef} className="w-full h-full" />
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
              Starting camera…
            </div>
          )}
          {!starting && !error && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-[260px] h-[260px] border-2 border-brand-500/80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              {error}
            </div>
          ) : lastMiss ? (
            <div className="text-xs text-amber-700">
              Scanned but not a reservation QR: <span className="font-mono">{lastMiss}</span>
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              Point at the reservation QR on the guest's pass. It will detect automatically.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Extract the signed reservation token from arbitrary QR payload.
 * Returns null when the payload doesn't look like a reservation token.
 *
 * We're permissive about wrappers (URLs, query params, path segments) but
 * strict about the token *shape* — exactly two base64url chunks joined by
 * a single dot. This matches what signReservationQrToken in
 * src/lib/signed-url.ts emits (same shape as the existing wallet tokens).
 */
export function extractToken(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  // Case 1: URL with ?token=… (deep-link from a printed pass).
  try {
    const url = new URL(raw);
    const fromQuery = url.searchParams.get('token');
    if (fromQuery && looksLikeToken(fromQuery)) return fromQuery;

    // Case 2: URL whose path ends with the token (/r/<token>).
    const pathTail = url.pathname.split('/').filter(Boolean).pop();
    if (pathTail && looksLikeToken(pathTail)) return pathTail;
  } catch {
    /* not a URL — fall through */
  }

  // Case 3: bare token (cleanest case — what we expect from the printed PNG).
  if (looksLikeToken(raw)) return raw;

  return null;
}

function looksLikeToken(s: string): boolean {
  // base64url alphabet: A-Z a-z 0-9 - _ ; payload + "." + sig.
  // Lower bound 16/16 is generous — real tokens are much longer — but it
  // protects us from matching, say, "a.b" as a token.
  return /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(s);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
