import { greeting, noteTitle, relativeTime } from '../lib/format.js';
import { IconFolder, IconPlus, IconSearch } from '../lib/icons.jsx';
import { NoteListSkeleton } from './NoteList.jsx';

export default function Dashboard({
  folders, totals, recent, loading,
  onOpenSearch, onQuickCapture, onNewFolder, onOpenFolder, onOpenNote,
}) {
  return (
    <div className="pane pane-wide">
      <div className="pane-head">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1 className="display display-xl">Your desk<span className="dot">.</span></h1>
          <p className="sub">
            {totals.all} live {totals.all === 1 ? 'note' : 'notes'} across {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
            {totals.archived > 0 ? `, ${totals.archived} archived` : ''}
          </p>
        </div>
        <button className="btn btn-primary" type="button" onClick={onQuickCapture}>
          <IconPlus />Quick capture
        </button>
      </div>

      <button className="searchbar" type="button" onClick={onOpenSearch}>
        <IconSearch width={18} height={18} />
        <span>Search every note</span>
        <span className="kbd">Cmd K</span>
      </button>

      <section className="section">
        <div className="section-head">
          <h2>Folders</h2>
          <span className="count">{folders.length}</span>
        </div>
        <div className="folder-grid">
          {folders.map((folder) => (
            <button className="folder-tile" type="button" key={folder.id} onClick={() => onOpenFolder(folder.id)}>
              <span className="swatch"><IconFolder width={17} height={17} /></span>
              <span className="name">{folder.name}</span>
              <span className="meta">{folder.note_count} {folder.note_count === 1 ? 'note' : 'notes'}</span>
            </button>
          ))}
          <button className="folder-tile add" type="button" onClick={onNewFolder}>
            <IconPlus width={18} height={18} />
            <span className="name">New folder</span>
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recent</h2>
          <span className="count">Last edited</span>
        </div>

        {loading ? <NoteListSkeleton rows={3} /> : recent.length ? (
          <div className="note-list">
            {recent.map((note) => (
              <button className="note-row" type="button" key={note.id} onClick={() => onOpenNote(note.id)}>
                <span className="body">
                  <span className="title" style={{ display: 'block' }}>{noteTitle(note)}</span>
                  {note.snippet && <span className="excerpt clamp-2" style={{ display: '-webkit-box', margin: '4px 0 0' }}>{note.snippet}</span>}
                  <span className="row-meta">
                    <span>{relativeTime(note.updated_at)}</span>
                    {note.is_pinned && <span className="tag tag-accent">Pinned</span>}
                    {note.is_published && <span className="tag tag-live">Shared</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">
            <p className="folio">01</p>
            <h3>Nothing written yet</h3>
            <p>Quick capture starts a note without picking a folder. File it wherever it belongs later.</p>
            <button className="btn btn-primary btn-sm" type="button" onClick={onQuickCapture} style={{ marginTop: 14 }}>
              <IconPlus width={14} height={14} />Start a note
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
