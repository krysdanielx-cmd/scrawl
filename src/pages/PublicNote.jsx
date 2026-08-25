import { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildExtensions, safeContent } from '../lib/editor.js';
import { fullDate } from '../lib/format.js';

function Reader({ note }) {
  const editor = useEditor({
    editable: false,
    extensions: buildExtensions(),
    content: safeContent(note.content),
    editorProps: { attributes: { class: 'prose' } },
  }, [note]);

  return <EditorContent editor={editor} />;
}

export default function PublicNote({ slug }) {
  const [state, setState] = useState({ status: 'loading', note: null });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/notes/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('gone');
        return response.json();
      })
      .then(({ note }) => { if (!cancelled) setState({ status: 'ready', note }); })
      .catch(() => { if (!cancelled) setState({ status: 'missing', note: null }); });
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <main className="reader">
      <div className="reader-bar">
        <span className="brand-name">Scrawl<span className="dot">.</span></span>
        <span className="tag">Shared note, read only</span>
      </div>

      <div className="reader-body">
        {state.status === 'loading' && (
          <>
            <div className="skel" style={{ width: '62%', height: 38, marginBottom: 18 }} />
            <div className="skel" style={{ width: '100%', height: 13, marginBottom: 10 }} />
            <div className="skel" style={{ width: '94%', height: 13, marginBottom: 10 }} />
            <div className="skel" style={{ width: '78%', height: 13 }} />
          </>
        )}

        {state.status === 'missing' && (
          <div className="empty">
            <p className="folio">404</p>
            <h3>This link is not live</h3>
            <p>The note was unpublished, archived, or the link is wrong. Ask whoever shared it for a fresh link.</p>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <h1>{(state.note.title || '').trim() || 'Untitled note'}</h1>
            <p className="reader-stamp">Last edited {fullDate(state.note.updated_at)}</p>
            <Reader note={state.note} />
          </>
        )}
      </div>
    </main>
  );
}
