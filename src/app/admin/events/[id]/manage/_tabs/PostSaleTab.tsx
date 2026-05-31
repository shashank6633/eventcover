'use client';

/**
 * POST-SALE COMMUNICATION TAB — /admin/events/[id]/manage?tab=post-sale
 *
 * UI for the per-event auto-WhatsApp message that fires immediately after a
 * successful purchase. Two modes:
 *
 *   • Text Only   — a free-form WhatsApp body. Supports {{name}} and
 *                   {{event}} placeholders which the backend substitutes at
 *                   send time.
 *
 *   • Text + Document — same text, but with an attached PDF (URL OR small
 *                       data-URL upload). Useful for receipts, brochures,
 *                       parking maps, etc.
 *
 * State is local — no upstream Save button. The "Save" button at the bottom
 * of the form persists via PUT /api/events/[id]/manage/post-sale-comm with
 * { messageText, attachmentKind, attachmentUrl, enabled }.
 *
 * The component fails soft on a 404 (backend not yet deployed) — defaults
 * render so the host can compose a draft and Save later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────
 * Types — match the backend contract.
 * ──────────────────────────────────────────────────────────────────────── */

type AttachmentKind = 'none' | 'pdf';

interface PostSaleConfig {
  messageText: string;
  attachmentKind: AttachmentKind;
  attachmentUrl: string;
  enabled: boolean;
}

interface PostSaleResponse {
  ok: boolean;
  config?: Partial<PostSaleConfig>;
  message?: string;
}

const DEFAULT_CONFIG: PostSaleConfig = {
  messageText: '',
  attachmentKind: 'none',
  attachmentUrl: '',
  enabled: false,
};

const PLACEHOLDER_HINT_TEXT =
  'Hi {{name}}, thanks for booking {{event}}! Your ticket is confirmed — see you there.';

/** Maximum size for inline PDF uploads (stored base64-encoded in the DB). */
const MAX_PDF_BYTES = 2 * 1024 * 1024; // 2 MB

type SubTab = 'text' | 'text-doc';

/* ────────────────────────────────────────────────────────────────────────
 * Component.
 * ──────────────────────────────────────────────────────────────────────── */

export function PostSaleTab({ eventId }: { eventId: string }) {
  const [tab, setTab] = useState<SubTab>('text');

  // Authoritative server state — what was last successfully saved.
  const [saved, setSaved] = useState<PostSaleConfig>(DEFAULT_CONFIG);
  // Draft state — what the user is currently editing.
  const [draft, setDraft] = useState<PostSaleConfig>(DEFAULT_CONFIG);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [error, setError]   = useState<string | null>(null);
  const [info, setInfo]     = useState<string | null>(null);
  const infoTimer = useRef<number | null>(null);

  // Inline file-upload state (Text + Document tab).
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const flashInfo = useCallback((msg: string) => {
    setInfo(msg);
    if (infoTimer.current) window.clearTimeout(infoTimer.current);
    infoTimer.current = window.setTimeout(() => setInfo(null), 2500);
  }, []);

  useEffect(() => () => {
    if (infoTimer.current) window.clearTimeout(infoTimer.current);
  }, []);

  /* ── Load ───────────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manage/post-sale-comm`,
        { cache: 'no-store' },
      );
      if (res.status === 404) {
        // Backend not live yet — render defaults so the form is still usable.
        setSaved(DEFAULT_CONFIG);
        setDraft(DEFAULT_CONFIG);
        return;
      }
      const d: PostSaleResponse = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load post-sale configuration.');
        return;
      }
      const fromServer: PostSaleConfig = {
        messageText:    String(d.config?.messageText ?? ''),
        attachmentKind: (d.config?.attachmentKind === 'pdf' ? 'pdf' : 'none') as AttachmentKind,
        attachmentUrl:  String(d.config?.attachmentUrl ?? ''),
        enabled:        Boolean(d.config?.enabled ?? false),
      };
      setSaved(fromServer);
      setDraft(fromServer);
      // Open the tab that matches the saved attachment kind.
      setTab(fromServer.attachmentKind === 'pdf' ? 'text-doc' : 'text');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  /* ── Save ───────────────────────────────────────────────────────────── */

  /**
   * Build the payload from the draft + active sub-tab. The active tab is the
   * source of truth for attachmentKind — switching tabs implicitly changes
   * the type of message we send (text vs. text+document).
   */
  const payload = useMemo<PostSaleConfig>(() => {
    const kind: AttachmentKind = tab === 'text-doc' ? 'pdf' : 'none';
    return {
      messageText: draft.messageText.trim(),
      attachmentKind: kind,
      // Only persist a URL when we're in the document sub-tab; otherwise
      // clear it so the server doesn't keep a stale link around.
      attachmentUrl: kind === 'pdf' ? draft.attachmentUrl.trim() : '',
      enabled: draft.enabled,
    };
  }, [tab, draft]);

  /** True when the draft differs from what was last saved to the server. */
  const dirty = useMemo(() => {
    return (
      payload.messageText    !== saved.messageText    ||
      payload.attachmentKind !== saved.attachmentKind ||
      payload.attachmentUrl  !== saved.attachmentUrl  ||
      payload.enabled        !== saved.enabled
    );
  }, [payload, saved]);

  async function save() {
    // Client-side validation.
    if (payload.enabled && !payload.messageText) {
      setError('Add a message before enabling post-sale communication.');
      return;
    }
    if (payload.attachmentKind === 'pdf' && !payload.attachmentUrl) {
      setError('Add a PDF URL or upload a document.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manage/post-sale-comm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const d: PostSaleResponse = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not save.');
        return;
      }
      // Server may echo back the canonical config; otherwise trust our draft.
      const next: PostSaleConfig = {
        messageText:    String(d.config?.messageText    ?? payload.messageText),
        attachmentKind: (d.config?.attachmentKind === 'pdf' ? 'pdf' : payload.attachmentKind) as AttachmentKind,
        attachmentUrl:  String(d.config?.attachmentUrl  ?? payload.attachmentUrl),
        enabled:        Boolean(d.config?.enabled ?? payload.enabled),
      };
      setSaved(next);
      setDraft(next);
      flashInfo('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  /* ── PDF upload (inline data-URL) ───────────────────────────────────── */

  async function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });
  }

  async function onPdfPicked(file: File | null) {
    if (!file) return;
    setError(null);

    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported.');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(`PDF is too large (max ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB). Host it externally and paste the URL instead.`);
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setDraft((prev) => ({
        ...prev,
        attachmentKind: 'pdf',
        attachmentUrl: dataUrl,
      }));
      flashInfo(`Loaded ${file.name} (${Math.round(file.size / 1024)} KB) — click Save to persist.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read PDF.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  /* ── Derived ────────────────────────────────────────────────────────── */

  /** Pretty label for the currently-attached document (URL vs. data URL). */
  const attachmentSummary = useMemo(() => {
    const url = draft.attachmentUrl;
    if (!url) return null;
    if (url.startsWith('data:application/pdf')) {
      // Estimate size from base64 payload length.
      const idx = url.indexOf(',');
      const body = idx >= 0 ? url.slice(idx + 1) : url;
      const bytes = Math.floor((body.length * 3) / 4);
      return { kind: 'upload' as const, label: `Uploaded PDF · ~${Math.round(bytes / 1024)} KB` };
    }
    return { kind: 'url' as const, label: url };
  }, [draft.attachmentUrl]);

  function clearAttachment() {
    setDraft((prev) => ({ ...prev, attachmentUrl: '' }));
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Post Sale Communication</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Auto-send WhatsApp message after purchase. Use{' '}
              <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">{'{{name}}'}</code>{' '}
              and{' '}
              <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">{'{{event}}'}</code>{' '}
              to personalize the message.
            </p>
          </div>
          {/* Master enable toggle */}
          <label className="inline-flex items-center gap-2 cursor-pointer shrink-0 pt-1">
            <span className="text-[11px] font-medium text-slate-600 select-none">
              {draft.enabled ? 'On' : 'Off'}
            </span>
            <span className="relative inline-block w-10 h-6">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={draft.enabled}
                disabled={loading}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              <span className="absolute inset-0 rounded-full bg-slate-200 peer-checked:bg-brand-500 transition" />
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
            </span>
          </label>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="card !p-0 overflow-hidden">
        <div className="flex border-b border-slate-200">
          <TabButton active={tab === 'text'}     onClick={() => setTab('text')}>Text Only</TabButton>
          <TabButton active={tab === 'text-doc'} onClick={() => setTab('text-doc')}>Text + Document</TabButton>
        </div>

        <div className="p-5 space-y-4">
          {/* Shared: message body */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              Message body
            </label>
            <textarea
              className="input !min-h-[140px] !py-2 !leading-snug font-normal"
              value={draft.messageText}
              onChange={(e) => setDraft({ ...draft, messageText: e.target.value })}
              placeholder={PLACEHOLDER_HINT_TEXT}
              disabled={loading}
              maxLength={1024}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-slate-400">
                Tip: use{' '}
                <code className="bg-slate-100 px-1 py-0.5 rounded">{'{{name}}'}</code>{' '}
                and{' '}
                <code className="bg-slate-100 px-1 py-0.5 rounded">{'{{event}}'}</code>{' '}
                — they&apos;ll be replaced when the message is sent.
              </span>
              <span className="text-[11px] text-slate-400 tabular-nums shrink-0 ml-2">
                {draft.messageText.length} / 1024
              </span>
            </div>
          </div>

          {/* Document fields — only on the Text + Document sub-tab */}
          {tab === 'text-doc' && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                  Document URL (PDF)
                </label>
                <input
                  type="url"
                  className="input"
                  value={
                    // Hide data-URLs from the URL field — they're displayed
                    // as a separate "uploaded" pill below.
                    draft.attachmentUrl.startsWith('data:')
                      ? ''
                      : draft.attachmentUrl
                  }
                  onChange={(e) => setDraft({ ...draft, attachmentUrl: e.target.value })}
                  placeholder="https://example.com/receipt.pdf"
                  disabled={loading || draft.attachmentUrl.startsWith('data:')}
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Paste a publicly accessible PDF link, or upload a small file below.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-500 mr-1">or</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => void onPdfPicked(e.target.files?.[0] ?? null)}
                  className="hidden"
                  id="post-sale-pdf-upload"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || loading}
                  className="btn btn-secondary !py-1.5 !px-3 text-sm"
                >
                  {uploading ? 'Reading…' : 'Upload PDF'}
                </button>
                <span className="text-[11px] text-slate-400">
                  Max {Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB · stored inline
                </span>
              </div>

              {/* Currently-attached document pill */}
              {attachmentSummary && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">📄</span>
                  <span className="text-xs text-slate-700 truncate flex-1">{attachmentSummary.label}</span>
                  <button
                    type="button"
                    onClick={clearAttachment}
                    className="text-[11px] text-rose-600 hover:text-rose-700 font-medium shrink-0"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Save button + status */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading || !dirty}
              className="btn btn-primary"
              title={!dirty ? 'No changes to save' : 'Save post-sale configuration'}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {dirty && !saving && (
              <span className="text-[11px] text-amber-700 font-medium">
                Unsaved changes
              </span>
            )}
            {info && !error && (
              <span className="text-[12px] text-emerald-600 font-medium ml-auto">
                {info}
              </span>
            )}
            {error && (
              <span className="text-[12px] text-rose-600 font-medium ml-auto">
                {error}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer status line */}
      <div className="text-[11px] text-slate-500 flex items-center gap-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
          saved.enabled && saved.messageText ? 'bg-emerald-500' : 'bg-slate-300'
        }`} />
        {saved.enabled && saved.messageText
          ? 'Sent via WhatsApp after payment'
          : 'Not yet sending — save an enabled message to start.'}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Local presentational helper.
 * ──────────────────────────────────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition ${
        active
          ? 'border-brand-500 text-brand-700 bg-brand-50/40'
          : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
