'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageUpload } from '@/components/ImageUpload';
import type { WizardState } from './types';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /**
   * Persisted event id (only present once the event has been saved at least
   * once). The gallery API is keyed by event id, so we hide the gallery UI
   * with a prompt to "Save the event first" until this becomes a real id.
   */
  eventId?: string | null;
}

interface MediaItem {
  id: string;
  kind?: 'image' | 'video';
  image_data: string;
  caption: string | null;
  sort_order: number;
}

/**
 * Media section — hero image (events.image_data) + Phase-2 gallery
 * (event_media table). Hero stays on the wizard's WizardState so it saves
 * with the rest of the event PATCH; gallery items are persisted immediately
 * via /api/events/[id]/media because they're heavy base64 blobs we don't
 * want to round-trip through the main save payload.
 */
export function SectionMedia({ state, onChange, eventId }: Props) {
  const [aiOpen, setAiOpen] = useState<'card' | 'cover' | 'gallery' | null>(null);

  return (
    <div className="card space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Media</h2>
        <p className="text-sm text-slate-500 mt-1">
          Three image slots used across listings, the public page hero, and the in-page gallery carousel.
        </p>
      </header>

      {/* ── Card Image · 2:3 portrait (800×1200) ───────────────────────────── */}
      <MediaSlot
        label="Card Image"
        required
        ratio="2:3 vertical"
        pixelSize="800 × 1200 px"
        description="Displayed on listing cards when customers browse your offerings. Also used as the preview when shared on social media."
        hint="Think: Instagram story or movie poster format"
        value={state.card_image}
        onChange={(d) => onChange({ card_image: d })}
        aspectRatio="2 / 3"
        maxWidth={180}
        addLabel="Upload"
        onAiClick={() => setAiOpen('card')}
      />

      {/* ── Cover Image · 1:1 square (1080×1080) ───────────────────────────── */}
      <div className="pt-2 border-t border-slate-100" />
      <MediaSlot
        label="Cover Image"
        required
        ratio="1:1 square"
        pixelSize="1080 × 1080 px"
        description="The hero image on your landing page. This is the first thing visitors see when they open your event or tour page."
        hint="Think: Instagram feed photo format"
        value={state.image_data}
        onChange={(d) => onChange({ image_data: d })}
        aspectRatio="1 / 1"
        maxWidth={200}
        addLabel="Upload"
        onAiClick={() => setAiOpen('cover')}
      />

      {/* ── Gallery · 1:1 square (1080×1080) — multi ───────────────────────── */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <label className="label !mb-0 flex items-center gap-2">
            Gallery
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
              1:1 square
            </span>
          </label>
          <span className="text-[11px] text-slate-400">1080 × 1080 px</span>
        </div>
        <p className="text-sm text-slate-600 mb-1">
          Additional photos shown in a carousel on your landing page. Use these to highlight different
          aspects, venues, past events, or what attendees can expect.
        </p>
        <p className="text-[11px] text-slate-400 italic mb-3">
          Think: Instagram feed photo format
        </p>

        {eventId ? (
          <GalleryEditor eventId={eventId} />
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <div className="text-sm font-semibold text-slate-700 mb-1">
              Save the event first to add gallery images.
            </div>
            <div className="text-xs text-slate-500">
              We need an event ID before we can attach extra images.
            </div>
          </div>
        )}
      </div>

      {/* AI Generate stub modal — closes once Claude API is wired in a future phase */}
      {aiOpen && (
        <AiGenerateModal slot={aiOpen} onClose={() => setAiOpen(null)} />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * MediaSlot
 *
 * Reusable upload tile with the Growezzy-style header row:
 *   Label · ratio chip · pixel size (right)
 *   Description paragraph
 *   "Think: …" italic hint
 *   Upload tile + Browse + AI Generate buttons row
 *
 * Used for both Card Image and Cover Image (single-image slots). The
 * Gallery section composes its own header above + the GalleryEditor below
 * because it manages multiple items, not a single image.
 * ────────────────────────────────────────────────────────────────────── */
interface MediaSlotProps {
  label: string;
  required?: boolean;
  ratio: string;          // e.g. "2:3 vertical" — small chip next to label
  pixelSize: string;      // e.g. "800 × 1200 px" — right-aligned
  description: string;
  hint: string;           // italic "Think: …"
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  aspectRatio: string;    // CSS aspect-ratio passed to ImageUpload
  maxWidth: number;       // tile width — narrower for the 2:3 card
  addLabel: string;       // 'Upload' or 'Add'
  onAiClick: () => void;
}

function MediaSlot({
  label, required, ratio, pixelSize, description, hint,
  value, onChange, aspectRatio, maxWidth, addLabel, onAiClick,
}: MediaSlotProps) {
  const inputId = `media-slot-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <label htmlFor={inputId} className="label !mb-0 flex items-center gap-2">
          {label}
          {required && <span className="text-rose-600" aria-label="Required">*</span>}
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
            {ratio}
          </span>
        </label>
        <span className="text-[11px] text-slate-400">{pixelSize}</span>
      </div>
      <p className="text-sm text-slate-600 mb-1">{description}</p>
      <p className="text-[11px] text-slate-400 italic mb-3">{hint}</p>

      <div className="flex items-start gap-3 flex-wrap">
        <ImageUpload
          value={value}
          onChange={onChange}
          aspectRatio={aspectRatio}
          maxWidth={maxWidth}
          label={label}
        />
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              // Click the hidden file input inside ImageUpload (it queries
              // 'input[type=file]' inside the closest tile).
              const tile = document.querySelector(`[data-media-slot="${inputId}"] input[type="file"]`) as HTMLInputElement | null;
              tile?.click();
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5M12 3v12" />
            </svg>
            Browse
          </button>
          <button
            type="button"
            onClick={onAiClick}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 px-3 py-1.5 rounded-md border border-brand-200 bg-white hover:bg-brand-50/40 transition"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4z" />
            </svg>
            AI Generate
          </button>
        </div>
      </div>
      {/* invisible marker so the Browse button can find the right input */}
      <div data-media-slot={inputId} className="hidden" />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * AI Generate stub modal
 *
 * The AI image generation pipeline isn't wired yet — this matches the same
 * "Coming · Phase 2" UX the Description "Enhance with AI" button uses on
 * the Basic Info section, so users get consistent expectations.
 * ────────────────────────────────────────────────────────────────────── */
function AiGenerateModal({ slot, onClose }: { slot: 'card' | 'cover' | 'gallery'; onClose: () => void }) {
  const slotLabel =
    slot === 'card' ? 'Card Image' :
    slot === 'cover' ? 'Cover Image' : 'Gallery Image';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-lg font-semibold text-slate-900">✨ AI Generate · {slotLabel}</h3>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
            Coming soon
          </span>
        </div>
        <p className="text-sm text-slate-600">
          Once enabled, this will generate a {slotLabel.toLowerCase()} from your event title,
          description, and genre using an image model (DALL-E / SDXL). We&apos;ll need an
          image-generation API key configured under{' '}
          <span className="font-mono">Settings → AI</span> before turning this on.
        </p>
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-primary">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Gallery editor
 *
 * Renders a responsive grid (2/3/4 cols), one tile per media item plus an
 * "+ Add image" tile at the end. Tiles support:
 *   • inline-editable caption (blur to save)
 *   • delete (×) button
 *   • HTML5 drag-and-drop reorder (no external dep — matches the
 *     existing wizard's table-types reorder pattern)
 *
 * All mutations hit /api/events/[id]/media routes immediately so the
 * gallery state is independent of the main wizard "Save" button.
 * ────────────────────────────────────────────────────────────────────── */
function GalleryEditor({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Drag state — index of the tile currently being dragged.
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/events/${eventId}/media`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) {
          setItems(sortBySortOrder(d.media || []));
        } else {
          setError(d.message || 'Could not load gallery.');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [eventId]);

  const handleAdd = useCallback(async (dataUrl: string | null) => {
    if (!dataUrl) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: dataUrl }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not add image.');
        return;
      }
      // Server returns either { media: MediaItem } or the full list — handle both.
      if (d.media && typeof d.media === 'object' && !Array.isArray(d.media)) {
        setItems((prev) => sortBySortOrder([...prev, d.media as MediaItem]));
      } else if (Array.isArray(d.media)) {
        setItems(sortBySortOrder(d.media));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setAdding(false);
    }
  }, [eventId]);

  const handleDelete = useCallback(async (mediaId: string) => {
    // Optimistic: drop locally first; on failure, restore.
    const prev = items;
    setItems(items.filter((m) => m.id !== mediaId));
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/media/${mediaId}`, {
        method: 'DELETE',
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not delete image.');
        setItems(prev);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setItems(prev);
    }
  }, [items, eventId]);

  const handleCaptionSave = useCallback(async (mediaId: string, caption: string) => {
    // Optimistic update with rollback on failure.
    const prev = items;
    const trimmed = caption.trim();
    setItems(items.map((m) => (m.id === mediaId ? { ...m, caption: trimmed || null } : m)));
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/media/${mediaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: trimmed || null }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not save caption.');
        setItems(prev);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setItems(prev);
    }
  }, [items, eventId]);

  const persistOrder = useCallback(async (orderedIds: string[]) => {
    setError(null);
    try {
      // Architect spec settled on PATCH .../media with { orderedIds }.
      // (POST .../media/reorder also exists per the broader API surface —
      // PATCH on the collection is simpler from the client's POV.)
      const res = await fetch(`/api/events/${eventId}/media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not save order.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }, [eventId]);

  function onDragStart(index: number) {
    dragIndex.current = index;
  }

  function onDragOver(e: React.DragEvent, index: number) {
    // Required so onDrop fires on the target.
    e.preventDefault();
    setDragOver(index);
  }

  function onDragLeave() {
    setDragOver(null);
  }

  function onDrop(index: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOver(null);
    if (from === null || from === index) return;

    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    setItems(next);
    void persistOrder(next.map((m) => m.id));
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="aspect-square rounded-lg bg-slate-100 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((m, idx) => (
          <GalleryTile
            key={m.id}
            item={m}
            isDragOver={dragOver === idx}
            onDragStart={() => onDragStart(idx)}
            onDragOver={(e) => onDragOver(e, idx)}
            onDragLeave={onDragLeave}
            onDrop={() => onDrop(idx)}
            onDelete={() => handleDelete(m.id)}
            onCaptionSave={(c) => handleCaptionSave(m.id, c)}
          />
        ))}

        <AddTile onPick={handleAdd} busy={adding} />
      </div>

      {items.length === 0 && !adding && (
        <p className="text-xs text-slate-400 text-center">
          No gallery images yet. Add a few vibe shots above.
        </p>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

interface TileProps {
  item: MediaItem;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDelete: () => void;
  onCaptionSave: (caption: string) => void;
}

function GalleryTile({
  item,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDelete,
  onCaptionSave,
}: TileProps) {
  const [caption, setCaption] = useState(item.caption ?? '');
  const [editing, setEditing] = useState(false);

  // Keep local input in sync if parent replaces the item (e.g. on reload).
  useEffect(() => {
    setCaption(item.caption ?? '');
  }, [item.caption]);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group relative rounded-lg overflow-hidden border bg-white transition ${
        isDragOver
          ? 'border-brand-500 ring-2 ring-brand-200'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="relative aspect-square bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.image_data}
          alt={item.caption || 'Gallery image'}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />

        {/* Drag handle (top-left) */}
        <div
          className="absolute top-1.5 left-1.5 w-7 h-7 rounded-md bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="6" r="1.2" />
            <circle cx="15" cy="6" r="1.2" />
            <circle cx="9" cy="12" r="1.2" />
            <circle cx="15" cy="12" r="1.2" />
            <circle cx="9" cy="18" r="1.2" />
            <circle cx="15" cy="18" r="1.2" />
          </svg>
        </div>

        {/* Delete (top-right) */}
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/50 text-white hover:bg-rose-600 transition flex items-center justify-center opacity-0 group-hover:opacity-100"
          aria-label="Remove image"
          title="Remove image"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-2">
        {editing ? (
          <input
            autoFocus
            className="w-full text-xs px-1.5 py-1 border border-brand-300 rounded outline-none focus:border-brand-500"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if ((caption.trim() || '') !== (item.caption ?? '')) {
                onCaptionSave(caption);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setCaption(item.caption ?? '');
                setEditing(false);
              }
            }}
            maxLength={120}
            placeholder="Add a caption…"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full text-left text-xs text-slate-600 truncate hover:text-brand-600"
            title={caption || 'Click to add caption'}
          >
            {caption || <span className="text-slate-400 italic">Add caption</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function AddTile({
  onPick,
  busy,
}: {
  onPick: (dataUrl: string | null) => void;
  busy: boolean;
}) {
  return (
    <div className="aspect-square">
      {/* ImageUpload renders its own dropzone tile. We wrap it in a 1:1
          container so it sits flush in the grid. The label is suppressed
          via an empty string and a wrapper hides the helper text — we want
          a compact "+ Add image" tile, not the full ImageUpload chrome. */}
      <div className="add-tile h-full">
        <ImageUpload
          value={null}
          onChange={onPick}
          label=""
          helperText={busy ? 'Uploading…' : '+ Add image'}
        />
      </div>
      <style jsx>{`
        .add-tile :global(label.label) { display: none; }
        .add-tile :global(> div > div) { max-width: 100% !important; }
      `}</style>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function sortBySortOrder(items: MediaItem[]): MediaItem[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}
