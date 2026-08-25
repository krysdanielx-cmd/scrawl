import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { api } from '../api.js';
import { buildExtensions, safeContent, transformPastedHTML } from '../lib/editor.js';
import { fullDate } from '../lib/format.js';
// import TableMenu from './TableMenu.jsx';
import {
  IconArchive, IconBack, IconBullets, IconChecklist, IconCode, IconCopy,
  IconNumbers, IconPin, IconQuote, IconRedo, IconShare, IconStrike, IconTable, IconTrash, IconUndo,
  IconLink, IconUnderline,
} from '../lib/icons.jsx';

const AUTOSAVE_MS = 500;

const SAVE_LABEL = { idle: 'All changes saved', saving: 'Saving', saved: 'Saved', error: 'Not saved' };

export default function NoteEditor({ note, folders, onMetaChange, onArchived, onDelete, onBack, onToast }) {
  const [title, setTitle] = useState(note.title || '');
  const [meta, setMeta] = useState(note);
  const [saveState, setSaveState] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [showPublishBar, setShowPublishBar] = useState(false);

  const titleRef = useRef(null);
  const pending = useRef({});
  const timer = useRef(null);
  const metaChangeRef = useRef(onMetaChange);
  metaChangeRef.current = onMetaChange;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return null;

    try {
      const { note: updated } = await api(`/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setMeta(updated);
      setSaveState('saved');
      metaChangeRef.current?.(updated);
      return updated;
    } catch (error) {
      setSaveState('error');
      onToast?.(error.message || 'Could not save.');
      return null;
    }
  }, [note.id, onToast]);

  const queue = useCallback((patch) => {
    Object.assign(pending.current, patch);
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }, [flush]);

  const editor = useEditor({
    extensions: buildExtensions({ placeholder: 'Start writing.' }),
    content: safeContent(note.content),
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      transformPastedHTML,
      handlePaste: (view, event) => {
        console.log('[scrawl] paste event, types:', event.clipboardData?.types);
        return false; // let default handling continue
      },
    },
    onUpdate: ({ editor: instance }) => queue({ content: instance.getJSON() }),
  }, [note.id]);

  // A pending debounce must never outlive the editor: flush on unmount and when
  // the tab is hidden, which is the only reliable "closing" signal on iOS.
  useEffect(() => {
    const onHide = () => { if (Object.keys(pending.current).length) flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      if (Object.keys(pending.current).length) flush();
      clearTimeout(timer.current);
    };
  }, [flush]);

  // Grow the title box to fit its content; a textarea will not do this itself.
  useEffect(() => {
    const node = titleRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [title]);

  async function act(fn) {
    setBusy(true);
    try {
      await flush();
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const togglePin = () => act(async () => {
    const { note: updated } = await api(`/notes/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_pinned: !meta.is_pinned }),
    });
    setMeta(updated);
    metaChangeRef.current?.(updated);
  });

  const moveTo = (value) => act(async () => {
    const { note: updated } = await api(`/notes/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ folder_id: value || null }),
    });
    setMeta(updated);
    metaChangeRef.current?.(updated, { moved: true });
  });

  const togglePublish = () => act(async () => {
    if (meta.is_published) {
      const { note: updated } = await api(`/notes/${note.id}/publish`, { method: 'DELETE' });
      setMeta(updated);
      metaChangeRef.current?.(updated);
      onToast?.('Link revoked');
    } else {
      const { note: updated } = await api(`/notes/${note.id}/publish`, { method: 'POST' });
      setMeta(updated);
      metaChangeRef.current?.(updated);
      setShowPublishBar(true);
      onToast?.('Public link created');
    }
  });

  // Archive is a state change, NOT a delete. DELETE erases the row for good.
  const archive = () => act(async () => {
    await api(`/notes/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_archived: true }),
    });
    onArchived?.(note.id);
  });

  const restore = () => act(async () => {
    const { note: updated } = await api(`/notes/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_archived: false }),
    });
    setMeta(updated);
    metaChangeRef.current?.(updated, { moved: true });
    onToast?.('Restored to your desk');
  });

  const publicUrl = meta.public_slug ? `${window.location.origin}/p/${meta.public_slug}` : '';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      onToast?.('Link copied');
    } catch {
      onToast?.('Copy failed, select the link instead');
    }
  }

  const can = (name, ...args) => Boolean(editor?.can()[name]?.(...args));
  const on = (name, ...args) => Boolean(editor?.isActive(name, ...args));
  const run = (fn) => () => { if (editor) fn(editor.chain().focus()).run(); };
  // Keep the caret in the document: without this the button takes focus on
  // mousedown, the selection collapses, and both the format and the next
  // keystrokes go missing.
  const keepFocus = (event) => event.preventDefault();

  return (
    <div className="editor-shell">
      <div className="editor-bar">
        <button className="icon-btn" type="button" onClick={onBack} aria-label="Back to notes" title="Back"><IconBack /></button>

        <select
          className="select"
          value={meta.folder_id || ''}
          onChange={(event) => moveTo(event.target.value)}
          disabled={busy || meta.is_archived}
          aria-label="Folder"
        >
          <option value="">Unfiled</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>

        <span className="spacer" />

        <span className="save-state" data-state={saveState} aria-live="polite" title={SAVE_LABEL[saveState]}>
          <span className="save-dot" /><span className="save-text">{SAVE_LABEL[saveState]}</span>
        </span>

        {meta.is_archived ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={restore} disabled={busy}>Restore</button>
        ) : (
          <>
            <button className="icon-btn" type="button" data-on={meta.is_pinned} onClick={togglePin} disabled={busy}
              aria-pressed={meta.is_pinned} aria-label={meta.is_pinned ? 'Unpin note' : 'Pin note'} title={meta.is_pinned ? 'Unpin' : 'Pin'}>
              <IconPin />
            </button>
            <button className="icon-btn" type="button" data-on={meta.is_published} onClick={togglePublish} disabled={busy}
              aria-pressed={meta.is_published} aria-label={meta.is_published ? 'Unpublish note' : 'Publish note'} title={meta.is_published ? 'Unpublish' : 'Publish'}>
              <IconShare />
            </button>
            <button className="icon-btn" type="button" onClick={archive} disabled={busy} aria-label="Archive note" title="Archive"><IconArchive /></button>
          </>
        )}
        <button className="icon-btn icon-btn-danger" type="button" onClick={() => onDelete(meta)} disabled={busy}
          aria-label="Delete note" title="Delete for good"><IconTrash /></button>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Formatting">
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('bold')} onClick={run((c) => c.toggleBold())} aria-label="Bold" title="Bold (⌘B)"><span className="serif-b">B</span></button>
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('italic')} onClick={run((c) => c.toggleItalic())} aria-label="Italic" title="Italic (⌘I)"><span className="serif-i">I</span></button>
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('underline')} onClick={run((c) => c.toggleUnderline())} aria-label="Underline" title="Underline (⌘U)"><IconUnderline /></button>
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('strike')} onClick={run((c) => c.toggleStrike())} aria-label="Strikethrough" title="Strikethrough (⌘⇧X)"><IconStrike /></button>

        <span className="divider" />
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('heading', { level: 1 })} onClick={run((c) => c.toggleHeading({ level: 1 }))} aria-label="Heading 1" title="Heading 1">H1</button>
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('heading', { level: 2 })} onClick={run((c) => c.toggleHeading({ level: 2 }))} aria-label="Heading 2" title="Heading 2">H2</button>
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('heading', { level: 3 })} onClick={run((c) => c.toggleHeading({ level: 3 }))} aria-label="Heading 3" title="Heading 3">H3</button>
        <span className="divider" />
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('bulletList')} onClick={run((c) => c.toggleBulletList())} aria-label="Bulleted list" title="Bulleted list"><IconBullets /></button>
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('orderedList')} onClick={run((c) => c.toggleOrderedList())} aria-label="Numbered list" title="Numbered list"><IconNumbers /></button>
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('taskList')} onClick={run((c) => c.toggleTaskList())} aria-label="Checklist" title="Checklist"><IconChecklist /></button>
        <span className="divider" />
        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('blockquote')} onClick={run((c) => c.toggleBlockquote())} aria-label="Quote" title="Quote"><IconQuote /></button>

        <button className="tool" type="button" onMouseDown={keepFocus} data-on={on('codeBlock')} onClick={run((c) => c.toggleCodeBlock())} aria-label="Code block" title="Code block"><IconCode /></button>
        <button className="tool" type="button" onMouseDown={keepFocus} onClick={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))} aria-label="Insert table" title="Insert table"><IconTable /></button>
        <span className="divider" />
        <button className="tool" type="button" onMouseDown={keepFocus} onClick={run((c) => c.undo())} disabled={!can('undo')} aria-label="Undo" title="Undo"><IconUndo /></button>
        <button className="tool" type="button" onMouseDown={keepFocus} onClick={run((c) => c.redo())} disabled={!can('redo')} aria-label="Redo" title="Redo"><IconRedo /></button>
      </div>



      {/* Clicking the empty space under the text should put the cursor at the end,
          the way every native notes app behaves. */}
      <div
        className="editor-body"
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget && !event.target.classList?.contains('editor-inner')) return;
          event.preventDefault();
          editor?.commands.focus('end');
        }}
      >
        <div className="editor-inner">
          <label className="sr-only" htmlFor="note-title">Note title</label>
          <textarea
            id="note-title"
            ref={titleRef}
            className="title-input"
            rows={1}
            value={title}
            placeholder="Untitled"
            maxLength={300}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); editor?.commands.focus(); } }}
            onChange={(event) => { setTitle(event.target.value); queue({ title: event.target.value }); }}
          />
          <p className="stamp">
            Edited {fullDate(meta.updated_at)}
            {meta.is_archived ? ' - archived' : ''}
          </p>

          {showPublishBar && publicUrl && (
            <div className="publish-bar">
              <IconShare width={15} height={15} style={{ color: 'var(--cobalt)' }} />
              <code>{publicUrl}</code>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => { copyLink(); setShowPublishBar(false); }}><IconCopy width={14} height={14} />Copy</button>
              <a className="btn btn-ghost btn-sm" href={publicUrl} target="_blank" rel="noreferrer">Open</a>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowPublishBar(false)}>×</button>
            </div>
          )}

          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
