import { noteTitle, relativeTime } from '../lib/format.js';
import { IconPin, IconRestore, IconShare } from '../lib/icons.jsx';

export function NoteListSkeleton({ rows = 4 }) {
  return (
    <div className="note-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skel-row" key={index}>
          <div className="skel" style={{ width: `${52 + ((index * 13) % 30)}%`, height: 14 }} />
          <div className="skel" style={{ width: '88%', height: 11 }} />
          <div className="skel" style={{ width: '32%', height: 9 }} />
        </div>
      ))}
    </div>
  );
}

export function NoteRow({ note, folderName, onOpen, onRestore }) {
  return (
    <div className="note-row">
      {/* The whole card is the target. This sits above the text so a tap anywhere
          opens the note; the Restore rail sits above it again. */}
      <button
        className="row-hit"
        type="button"
        onClick={() => onOpen(note.id)}
        aria-label={`Open ${noteTitle(note)}`}
      />
      <div className="body">
        <h3 className="title">{noteTitle(note)}</h3>
        {note.snippet && <p className="excerpt clamp-2">{note.snippet}</p>}
        <div className="row-meta">
          <span>{relativeTime(note.updated_at)}</span>
          {folderName && <span className="tag">{folderName}</span>}
          {note.is_pinned && <span className="tag tag-accent"><IconPin width={11} height={11} />Pinned</span>}
          {note.is_published && <span className="tag tag-live"><IconShare width={11} height={11} />Shared</span>}
        </div>
      </div>
      {onRestore && (
        <div className="rail">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => onRestore(note.id)}>
            <IconRestore width={14} height={14} />Restore
          </button>
        </div>
      )}
    </div>
  );
}

export default function NoteList({ notes, loading, folderNameFor, onOpen, onRestore, empty }) {
  if (loading) return <NoteListSkeleton />;
  if (!notes.length) return empty;

  const pinned = notes.filter((note) => note.is_pinned);
  const rest = notes.filter((note) => !note.is_pinned);

  return (
    <>
      {pinned.length > 0 && (
        <section className="section" style={{ marginTop: 0 }}>
          <div className="section-head">
            <h2>Pinned</h2>
            <span className="count">{pinned.length}</span>
          </div>
          <div className="note-list">
            {pinned.map((note) => (
              <NoteRow key={note.id} note={note} folderName={folderNameFor?.(note)} onOpen={onOpen} onRestore={onRestore} />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section className="section" style={{ marginTop: pinned.length ? 32 : 0 }}>
          {pinned.length > 0 && (
            <div className="section-head">
              <h2>Everything else</h2>
              <span className="count">{rest.length}</span>
            </div>
          )}
          <div className="note-list">
            {rest.map((note) => (
              <NoteRow key={note.id} note={note} folderName={folderNameFor?.(note)} onOpen={onOpen} onRestore={onRestore} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
