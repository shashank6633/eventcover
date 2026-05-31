'use client';

import { useRef, useState } from 'react';

interface Props {
  value: string | null;                    // current data URL (or null)
  onChange: (dataUrl: string | null) => void;
  /** Max dimension after resize (longest edge). Default 800px. */
  maxDim?: number;
  /** JPEG quality (0–1). Default 0.85. */
  quality?: number;
  /** Reject raw source files larger than this. Default 10 MB. */
  maxRawBytes?: number;
  label?: string;
  helperText?: string;
  /** CSS aspect ratio for the drop tile (e.g. '1 / 1', '2 / 3'). Default '1 / 1'. */
  aspectRatio?: string;
  /** Max tile width in px. Default 220. Bump for hero shots. */
  maxWidth?: number;
}

/**
 * Drag-drop or click-to-upload image input with client-side resize.
 *
 * Why client-side:
 *   • Cap upload size before it hits the wire (keeps APIs cheap, payloads predictable)
 *   • Square-crop to a sensible thumbnail dimension (artists look better when uniform)
 *   • Sends as compressed JPEG data URL, persisted to SQLite directly
 *
 * When you migrate to S3/R2: replace the onChange consumer to POST the dataURL
 * (or the raw File) to a /upload endpoint and store the returned URL.
 */
export function ImageUpload({
  value,
  onChange,
  maxDim = 800,
  quality = 0.85,
  maxRawBytes = 10 * 1024 * 1024,
  label = 'Artist image',
  helperText = 'PNG or JPG. Auto-resized to 800×800. Max 10 MB source.',
  aspectRatio = '1 / 1',
  maxWidth = 220,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG, JPG, or WebP).');
      return;
    }
    if (file.size > maxRawBytes) {
      setError(`Image is too large (${Math.round(file.size / 1024 / 1024)} MB). Max ${Math.round(maxRawBytes / 1024 / 1024)} MB.`);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await resizeToDataUrl(file, maxDim, quality);
      onChange(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process image.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="label">{label}</label>

      <div
        onClick={() => !value && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={`relative rounded-xl border-2 border-dashed transition cursor-pointer overflow-hidden ${
          dragOver ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
        } ${value ? 'cursor-default' : ''}`}
        style={{ aspectRatio, maxWidth }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-center px-3">
            {busy ? (
              <>
                <Spinner />
                <span className="text-xs mt-2">Compressing…</span>
              </>
            ) : (
              <>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <path d="M17 8l-5-5-5 5M12 3v12"/>
                </svg>
                <span className="text-xs mt-2 font-medium">Click or drop an image</span>
                <span className="text-[10px] mt-1 text-slate-400">PNG · JPG · WebP</span>
              </>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
      </div>

      {value && (
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-rose-600 hover:text-rose-700 font-medium"
          >
            Remove
          </button>
        </div>
      )}

      {error ? (
        <div className="mt-2 text-xs text-rose-600">{error}</div>
      ) : (
        <div className="mt-2 text-xs text-slate-500">{helperText}</div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="#C1551A" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="#C1551A" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/**
 * Read a File → draw to a canvas at a max edge length → export as JPEG data URL.
 * Preserves aspect ratio. No external deps.
 */
async function resizeToDataUrl(file: File, maxDim: number, quality: number): Promise<string> {
  const rawUrl = await fileToDataUrl(file);
  const img = await loadImage(rawUrl);

  const { naturalWidth: w, naturalHeight: h } = img;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, tw, th);

  // Use JPEG output for predictable file size — PNG would balloon for photographs.
  return canvas.toDataURL('image/jpeg', quality);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image file.'));
    img.src = src;
  });
}
