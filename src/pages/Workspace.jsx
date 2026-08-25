import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Sidebar from '../components/Sidebar.jsx';
import Dashboard from '../components/Dashboard.jsx';
import NoteList from '../components/NoteList.jsx';
// Tiptap and ProseMirror are ~330kb of the bundle. Splitting them out keeps the
// desk and folder views on a small first payload; the chunk loads when a note
// is actually opened.
const NoteEditor = lazy(() => import('../components/NoteEditor.jsx'));
import SearchOverlay from '../components/SearchOverlay.jsx';
import FolderModal from '../components/FolderModal.jsx';
import { IconCheck, IconMenu, IconPlus, IconSearch } from '../lib/icons.jsx';

const EMPTY_TOTALS = { all: 0, unfiled: 0, archived: 0 };

function listParams(view) {
  if (view.type === 'archive') return '?archived=true';
  if (view.type === 'unfiled') return '?folder_id=unfiled';
  if (view.type === 'folder') return `?folder_id=${encodeURIComponent(view.folderId)}`;
  return '';
}

export default function Workspace({ session, onSignOut }) {
  const [folders, setFolders] = useState(session.folders || []);
  const [totals, setTotals] = useState(EMPTY_TOTALS);
  const [view, setView] = useState({ type: 'dashboard' });
  const [notes, setNotes] = useState([]);
  const [recent, setRecent] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [openNote, setOpenNote] = useState(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [folderModal, setFolderModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState('');

  const toastTimer = useRef(null);
  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const loadFolders = useCallback(async () => {
    const data = await api('/folders');
    setFolders(data.folders);
    setTotals(data.totals || EMPTY_TOTALS);
  }, []);

  const loadList = useCallback(async (current) => {
    setListLoading(true);
    try {
      if (current.type === 'dashboard') {
        const { notes: rows } = await api('/notes/recent?limit=6');
        setRecent(rows);
      } else {
        const { notes: rows } = await api(`/notes${listParams(current)}`);
        setNotes(rows);
      }
    } catch (error) {
      showToast(error.message || 'Could not load notes.');
    } finally {
      setListLoading(false);
    }
  }, [showToast]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadFolders().catch(() => {}), loadList(view)]);
  }, [loadFolders, loadList, view]);

  useEffect(() => { loadFolders().catch(() => {}); }, [loadFolders]);
  useEffect(() => { loadList(view); }, [view, loadList]);

  const openNoteById = useCallback(async (id) => {
    setSearchOpen(false);
    setDrawer(false);
    setNoteLoading(true);
    try {
      const { note } = await api(`/notes/${id}`);
      setOpenNote(note);
    } catch (error) {
      showToast(error.message || 'Could not open that note.');
    } finally {
      setNoteLoading(false);
    }
  }, [showToast]);

  const createNote = useCallback(async (folderId) => {
    try {
      const { note } = await api('/notes', {
        method: 'POST',
        body: JSON.stringify({ folder_id: folderId ?? null, title: '' }),
      });
      setOpenNote(note);
      setDrawer(false);
    } catch (error) {
      showToast(error.message || 'Could not create a note.');
    }
  }, [showToast]);

  // Cmd/Ctrl+K opens search, Cmd/Ctrl+N starts a note. Both are safe to fire
  // while an input has focus, so there is no editable-target guard here.
  useEffect(() => {
    function onKeyDown(event) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((value) => !value);
        return;
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createNote(view.type === 'folder' ? view.folderId : null);
        return;
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setFolderModal(false);
        setDrawer(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createNote, view]);

  function selectView(next) {
    setOpenNote(null);
    setDrawer(false);
    setView(next);
  }

  function handleMetaChange(updated, options = {}) {
    setNotes((rows) => rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
    setRecent((rows) => rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
    if (options.moved) refreshAll();
  }

  async function handleArchived(id) {
    setOpenNote(null);
    setNotes((rows) => rows.filter((row) => row.id !== id));
    setRecent((rows) => rows.filter((row) => row.id !== id));
    showToast('Moved to archive');
    await refreshAll();
  }

  async function restoreNote(id) {
    try {
      await api(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ is_archived: false }) });
      showToast('Restored to your desk');
      await refreshAll();
    } catch (error) {
      showToast(error.message || 'Could not restore that note.');
    }
  }

  const folderName = (note) => folders.find((folder) => folder.id === note.folder_id)?.name || null;
  const currentFolder = view.type === 'folder' ? folders.find((folder) => folder.id === view.folderId) : null;

  const heading = {
    all: 'All notes',
    unfiled: 'Unfiled',
    archive: 'Archive',
  }[view.type] || currentFolder?.name || 'Notes';

  const emptyState = (
    <div className="empty">
      <p className="folio">00</p>
      <h3>{view.type === 'archive' ? 'Archive is empty' : 'No notes here yet'}</h3>
      <p>
        {view.type === 'archive'
          ? 'Archived notes land here instead of being deleted, so nothing is ever really gone.'
          : 'Start one and it saves itself as you type.'}
      </p>
      {view.type !== 'archive' && (
        <button className="btn btn-primary btn-sm" type="button" style={{ marginTop: 14 }}
          onClick={() => createNote(view.type === 'folder' ? view.folderId : null)}>
          <IconPlus width={14} height={14} />New note
        </button>
      )}
    </div>
  );

  return (
    <div className="shell">
      <Sidebar
        open={drawer}
        folders={folders}
        totals={totals}
        view={view}
        email={session.user?.email || ''}
        onSelect={selectView}
        onNewFolder={() => { setDrawer(false); setFolderModal(true); }}
        onSignOut={onSignOut}
      />
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <div className="main">
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={() => setDrawer(true)} aria-label="Open navigation"><IconMenu /></button>
          <span className="brand-name">Scrawl<span className="dot">.</span></span>
          <span className="spacer" />
          <button className="icon-btn" type="button" onClick={() => setSearchOpen(true)} aria-label="Search notes"><IconSearch /></button>
          <button className="icon-btn" type="button" onClick={() => createNote(view.type === 'folder' ? view.folderId : null)} aria-label="New note"><IconPlus /></button>
        </div>

        {openNote ? (
          <Suspense fallback={<div className="pane pane-wide"><div className="skel" style={{ width: '46%', height: 34 }} /></div>}>
          <NoteEditor
            key={openNote.id}
            note={openNote}
            folders={folders}
            onMetaChange={handleMetaChange}
            onArchived={handleArchived}
            onBack={() => { setOpenNote(null); refreshAll(); }}
            onToast={showToast}
          />
          </Suspense>
        ) : noteLoading ? (
          <div className="pane pane-wide"><div className="skel" style={{ width: '46%', height: 34 }} /></div>
        ) : view.type === 'dashboard' ? (
          <Dashboard
            folders={folders}
            totals={totals}
            recent={recent}
            loading={listLoading}
            onOpenSearch={() => setSearchOpen(true)}
            onQuickCapture={() => createNote(null)}
            onNewFolder={() => setFolderModal(true)}
            onOpenFolder={(folderId) => selectView({ type: 'folder', folderId })}
            onOpenNote={openNoteById}
          />
        ) : (
          <div className="pane pane-wide">
            <div className="pane-head">
              <div>
                <p className="eyebrow">{view.type === 'folder' ? 'Folder' : view.type === 'archive' ? 'Kept, not deleted' : 'Everything'}</p>
                <h1 className="display display-lg">{heading}</h1>
                <p className="sub">{listLoading ? 'Loading' : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}</p>
              </div>
              {view.type !== 'archive' && (
                <button className="btn btn-primary" type="button" onClick={() => createNote(view.type === 'folder' ? view.folderId : null)}>
                  <IconPlus />New note
                </button>
              )}
            </div>

            <button className="searchbar" type="button" onClick={() => setSearchOpen(true)}>
              <IconSearch width={18} height={18} />
              <span>Search every note</span>
              <span className="kbd">Cmd K</span>
            </button>

            <div className="section">
              <NoteList
                notes={notes}
                loading={listLoading}
                folderNameFor={view.type === 'folder' ? undefined : folderName}
                onOpen={openNoteById}
                onRestore={view.type === 'archive' ? restoreNote : undefined}
                empty={emptyState}
              />
            </div>
          </div>
        )}
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onOpenNote={openNoteById} />
      <FolderModal
        open={folderModal}
        onClose={() => setFolderModal(false)}
        onCreated={(folder) => {
          setFolderModal(false);
          showToast(`Created ${folder.name}`);
          loadFolders().catch(() => {});
          selectView({ type: 'folder', folderId: folder.id });
        }}
      />

      {toast && <div className="toast" role="status"><IconCheck width={14} height={14} />{toast}</div>}
    </div>
  );
}
