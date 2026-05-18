'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect } from 'react';

interface Props {
  value: string;                       // HTML
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}

/**
 * Lightweight Tiptap-based rich text editor with an Akan-themed toolbar.
 *
 * Output: HTML string. Empty content collapses to `''` (so we don't store the
 * "empty paragraph" Tiptap emits by default).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Insert text here…',
  minHeight = 160,
  className = '',
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'rte-content focus:outline-none px-4 py-3 text-sm text-slate-700',
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML();
      // Treat empty paragraph as empty string so consumers can null-check.
      onChange(html === '<p></p>' ? '' : html);
    },
    immediatelyRender: false, // avoids SSR hydration mismatch in Next.js
  });

  // Sync external value changes (e.g. when loading existing event content)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || '';
    if (current !== next && current !== '<p></p>') return; // only overwrite if editor is "empty"
    if (current !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return <EditorSkeleton minHeight={minHeight} />;

  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white overflow-hidden ${className}`}
    >
      <Toolbar editor={editor} />
      <div style={{ minHeight }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs);

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50/60">
      <Btn label="B" title="Bold" active={isActive('bold')}
           onClick={() => editor.chain().focus().toggleBold().run()} bold />
      <Btn label="I" title="Italic" active={isActive('italic')}
           onClick={() => editor.chain().focus().toggleItalic().run()} italic />
      <Btn label="U" title="Underline" active={isActive('strike')}
           onClick={() => editor.chain().focus().toggleStrike().run()} />

      <Sep />

      <Select
        value={
          editor.isActive('heading', { level: 1 }) ? 'h1'
          : editor.isActive('heading', { level: 2 }) ? 'h2'
          : editor.isActive('heading', { level: 3 }) ? 'h3'
          : 'p'
        }
        onChange={(v) => {
          if (v === 'p') editor.chain().focus().setParagraph().run();
          else editor.chain().focus().toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
        }}
      />

      <Sep />

      <Btn label={<IconBulletList />} title="Bulleted list" active={isActive('bulletList')}
           onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Btn label={<IconOrderedList />} title="Numbered list" active={isActive('orderedList')}
           onClick={() => editor.chain().focus().toggleOrderedList().run()} />

      <Sep />

      <Btn label={<IconLink />} title="Add link" active={isActive('link')}
           onClick={() => {
             const prev = editor.getAttributes('link').href as string | undefined;
             const url = window.prompt('URL', prev || 'https://');
             if (url === null) return;
             if (url === '') {
               editor.chain().focus().extendMarkRange('link').unsetLink().run();
             } else {
               editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
             }
           }} />

      <Btn label={<IconClear />} title="Clear formatting"
           onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} />
    </div>
  );
}

function Btn({
  label, title, active, onClick, bold, italic,
}: {
  label: React.ReactNode; title: string; active?: boolean;
  onClick: () => void; bold?: boolean; italic?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`min-w-[28px] h-7 px-1.5 rounded text-sm transition ${
        active
          ? 'bg-brand-100 text-brand-700'
          : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
      } ${bold ? 'font-bold' : ''} ${italic ? 'italic' : ''}`}
    >
      {label}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 w-px h-5 bg-slate-200" aria-hidden />;
}

function Select({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 text-xs bg-transparent text-slate-600 hover:text-slate-900 rounded px-1 cursor-pointer focus:outline-none"
    >
      <option value="p">Normal</option>
      <option value="h1">Heading 1</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
    </select>
  );
}

function EditorSkeleton({ minHeight }: { minHeight: number }) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50 text-slate-400 text-sm flex items-center px-4"
      style={{ minHeight }}
    >
      Loading editor…
    </div>
  );
}

function IconBulletList() {
  return svg(<><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/><path d="M9 6h11M9 12h11M9 18h11"/></>);
}
function IconOrderedList() {
  return svg(<><path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 18h2M4 14h2M4 22h2"/></>);
}
function IconLink() {
  return svg(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>);
}
function IconClear() {
  return svg(<><path d="M4 7V4h16v3"/><path d="M5 20h6M13 4l-2 16"/></>);
}
function svg(children: React.ReactNode) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
