'use client';

/**
 * Photo Gallery Tab — post-event recap photos.
 *
 * Distinct from the pre-event Media gallery (event_media) which sells the event.
 * This is the post-event recap shown to ticket buyers via a magic link — see
 * the architect spec for the public /event-recap/[id] page and signed token.
 *
 * UI structure mirrors the wizard's SectionMedia GalleryEditor (3-col grid +
 * drag-reorder + inline caption + delete), wired to the recap-media REST
 * surface under /api/events/[id]/manage/recap-media.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageUpload } from '@/components/ImageUpload';

interface RecapMediaItem {
  id: string;
  image_data: string;
  caption: string | null;
  sort_order: number;
}

interface Props {
  eventId: string;
}

export function PhotoGalleryTab({ eventId }: Props) {
  return (
    <div className="card space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Event photos</h2>
        <p className="text-sm text-slate-500 mt-1">
          Upload recap photos from the night so attendees can relive it.
        </p>
      </header>

      <RecapGalleryEditor eventId={eventId} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * RecapGalleryEditor
 *
 * Responsive 2/3/4-col grid of tiles + a trailing "+ Add image" tile.
 * Each tile supports:
 *   • inline-editable caption (blur to save)
 *   • delete (×) button with confirm
 *   • HTML5 drag-and-drop reorder
 *
 * Mirrors the wizard's media gallery editor so the host doesn't have to
 * learn a new affordance for recap photos.
 * ────────────────────────────────────────────────────────────────────── */
function RecapGalleryEditor({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<RecapMediaItem[]>([]);
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
    fetch(`/api/events/${eventId}/manage/recap-media`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) {
          setItems(sortBySortOrder(d.media || []));
        } else {
          setError(d.message || 'Could not load recap photos.');
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
      const res = await fetch(`/api/events/${eventId}/manage/recap-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: dataUrl }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not add photo.');
        return;
      }
      // Server may return either a single { media } or the full list.
      if (d.media && typeof d.media === 'object' && !Array.isArray(d.media)) {
        setItems((prev) => sortBySortOrder([...prev, d.media as RecapMediaItem]));
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
    const ok = window.confirm('Remove this recap photo? Attendees viewing the recap link will no longer see it.');
    if (!ok) return;

    // Optimistic delete with rollback on failure.
    const prev = items;
    setItems(items.filter((m) => m.id !== mediaId));
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/manage/recap-media/${mediaId}`, {
        method: 'DELETE',
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not delete photo.');
        setItems(prev);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setItems(prev);
    }
  }, [items, eventId]);

  const handleCaptionSave = useCallback(async (mediaId: string, caption: string) => {
    // Optimistic update; PATCH the single-media route directly. The
    // backend contract for caption updates is per-media PATCH (separate
    // from the collection-level reorder PATCH).
    const prev = items;
    const trimmed = caption.trim();
    setItems(items.map((m) => (m.id === mediaId ? { ...m, caption: trimmed || null } : m)));
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/manage/recap-media/${mediaId}`, {
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
      // Collection-level PATCH with { orderedIds } — same convention as
      // the wizard's media gallery so the API surface stays consistent.
      const res = await fetch(`/api/events/${eventId}/manage/recap-media`, {
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
          <RecapTile
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
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
          <div className="text-sm font-semibold text-slate-700">No recap photos yet</div>
          <div className="text-xs text-slate-500 mt-1">
            No recap photos yet — upload some after the event so attendees can relive the night.
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

interface TileProps {
  item: RecapMediaItem;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDelete: () => void;
  onCaptionSave: (caption: string) => void;
}

function RecapTile({
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
          alt={item.caption || 'Recap photo'}
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
          aria-label="Remove photo"
          title="Remove photo"
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
          and we override helperText so the tile reads as a compact
          "+ Add photo" affordance. */}
      <div className="add-tile h-full">
        <ImageUpload
          value={null}
          onChange={onPick}
          label=""
          helperText={busy ? 'Uploading…' : '+ Add photo'}
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

function sortBySortOrder(items: RecapMediaItem[]): RecapMediaItem[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}
