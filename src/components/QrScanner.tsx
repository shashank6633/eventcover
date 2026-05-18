'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  onDetected: (txnId: string, fullText: string) => void;
  onClose: () => void;
}

/**
 * Camera QR scanner modal.
 *
 * Uses html5-qrcode under the hood — it handles camera permission, device selection,
 * and the scan loop. We accept either:
 *   - a full captain URL (`.../admin/redeem?t=TXN-XXX`) — extract the `t` param
 *   - a bare transaction ID (`TXN-XXX`) — use directly
 *
 * Unrelated QRs (Wi-Fi, URLs) show an error + keep scanning.
 */
type Html5QrcodeInstance = {
  stop: () => Promise<void>;
  clear: () => void;
};

export function QrScanner({ onDetected, onClose }: Props) {
  const containerId = 'ec-qr-reader';
  const readerRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  /**
   * Tracks whether scanner.start() has resolved AND we haven't yet stopped it.
   * Required because html5-qrcode's stop() throws a string (not an Error) if
   * the scanner isn't running, which then crashes React in dev. Cleanup and
   * the detection callback can both try to stop — without this flag they race.
   */
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [lastMiss, setLastMiss] = useState<string | null>(null);

  // Stable callback ref — keeps onDetected fresh without making it a dependency
  // of the start effect (which would cause restart loops on parent re-renders).
  const onDetectedRef = useRef(onDetected);
  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);

  /** Safe stop — only runs once, swallows the library's sync-throw if any. */
  function safeStop(): Promise<void> {
    const s = scannerRef.current;
    if (!s || !startedRef.current) return Promise.resolve();
    startedRef.current = false;
    try {
      const p = s.stop();
      // Some versions return a Promise, some return non-Promise. Normalise.
      return Promise.resolve(p).then(() => { try { s.clear(); } catch { /* ignore */ } }).catch(() => { /* already stopped */ });
    } catch {
      // Synchronous throw from the library — already stopped or in a weird state
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
          setError('No camera detected. Use the manual entry field below.');
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
            // Detection callback. We may still get one stale frame after
            // safeStop() — the startedRef guard makes that a no-op.
            if (!startedRef.current) return;
            const txn = extractTxn(decoded);
            if (!txn) {
              setLastMiss(truncate(decoded, 60));
              return;
            }
            setLastMiss(null);
            // Release the camera cleanly, THEN hand off to the parent.
            // Either path (stop succeeds or already-stopped) delivers the txn.
            safeStop().then(() => onDetectedRef.current(txn, decoded));
          },
          () => { /* normal "frame without a QR" event — ignore */ },
        );
        // start() resolved → scanner is actually running now
        startedRef.current = true;
        setStarting(false);
      } catch (e) {
        // start() can throw an Error OR a plain string depending on the failure
        // mode. Both need handling.
        const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not start camera';
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
      // Don't await — React unmount can't await. Just fire safeStop and let
      // it resolve on its own; the startedRef flip prevents double-stop.
      void safeStop();
    };
    // Mount-once effect — onDetected is captured via the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <div className="text-[10px] tracking-widest uppercase text-slate-500">Scanner</div>
            <div className="text-sm font-semibold text-slate-900">Scan guest QR</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 p-1" aria-label="Close scanner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
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
              <div className="w-[260px] h-[260px] border-2 border-brand-500/80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"/>
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
              Scanned but not an EventCover QR: <span className="font-mono">{lastMiss}</span>
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              Point at the guest's QR code. It will detect automatically.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function extractTxn(text: string): string | null {
  const raw = text.trim();

  // Case 1: URL with ?t=TXN
  try {
    const url = new URL(raw);
    const t = url.searchParams.get('t');
    if (t && looksLikeTxn(t)) return t.toUpperCase();
  } catch { /* not a URL */ }

  // Case 2: bare TXN id
  if (looksLikeTxn(raw)) return raw.toUpperCase();
  return null;
}

function looksLikeTxn(s: string): boolean {
  return /^[A-Z]{2,5}-\d{2,6}-[A-Z0-9]{3,8}$/i.test(s.trim());
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
