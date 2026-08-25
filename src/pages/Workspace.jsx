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
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { IconCheck, IconMenu, IconPlus, IconSearch } from '../lib/icons.jsx';

const EMPTY_TOTALS = { all: 0, unfiled: 0, archived: 0 };
const UUID = '[0-9a-fA-F-]{36}';

/**
 * An open note is a place you can reload, bookmark and press Back out of.
 * Without this the phone's back gesture closes the whole installed app and an
 * iOS background-reload drops you at the desk mid-sentence.
 */
function pathFor(view, noteId) {
  if (noteId) return `/n/${noteId}`;
  if (view.type === 'all') return '/notes';
  if (view.type === 'unfiled') return '/unfiled';
  if (view.type === 'archive') return '/archive';
  if (view.type === 'folder') return `/f/${view.folderId}`;
  return '/';
}

function parsePath(pathname) {
  const note = pathname.match(new RegExp(`^/n/(${UUID})/?$`));
  if (note) return { view: null, noteId: note[1] };
  const folder = pathname.match(new RegExp(`^/f/(${UUID})/?$`));
  if (folder) return { view: { type: 'folder', folderId: folder[1] }, noteId: null };
  if (pathname === '/notes') return { view: { type: 'all' }, noteId: null };
  if (pathname === '/unfiled') return { view: { type: 'unfiled' }, noteId: null };
  if (pathname === '/archive') return { view: { type: 'archive' }, noteId: null };
  return { view: { type: 'dashboard' }, noteId: null };
}

function listParams(view) {
  if (view.type === 'archive') return '?archived=true';
  if (view.type === 'unfiled') return '?folder_id=unfiled';
  if (view.type === 'folder') return `?folder_id=${encodeURIComponent(view.folderId)}`;
  return '';
}

export default function Workspace({ session, onSignOut }) {
  const [folders, setFolders] = useState(session.folders || []);
  const [totals, setTotals] = useState(EMPTY_TOTALS);
  const bootPath = useRef(typeof window === 'undefined' ? '/' : window.location.pathname);
  const [view, setView] = useState(() => parsePath(bootPath.current).view || { type: 'dashboard' });
  const [notes, setNotes] = useState([]);
  const [recent, setRecent] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [openNote, setOpenNote] = useState(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [folderModal, setFolderModal] = useState({ open: false, folder: null });
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [booted, setBooted] = useState(false);
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

  // Open whatever the URL pointed at on a cold load, then start syncing.
  useEffect(() => {
    const { noteId } = parsePath(bootPath.current);
    if (!noteId) { setBooted(true); return; }
    openNoteById(noteId).finally(() => setBooted(true));
  }, [openNoteById]);

  const firstSync = useRef(true);
  useEffect(() => {
    if (!booted) return;
    const next = pathFor(view, openNote?.id);
    if (window.location.pathname === next) { firstSync.current = false; return; }
    // The first correction just tidies a stale or unknown URL, so it must not
    // add a history entry the user then has to press Back through.
    if (firstSync.current) window.history.replaceState({}, '', next);
    else window.history.pushState({}, '', next);
    firstSync.current = false;
  }, [booted, view, openNote]);

  useEffect(() => {
    function onPopState() {
      const target = parsePath(window.location.pathname);
      if (target.noteId) {
        if (target.noteId !== openNote?.id) openNoteById(target.noteId);
        return;
      }
      setOpenNote(null);
      if (target.view) setView(target.view);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [openNote, openNoteById]);

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
        setFolderModal({ open: false, folder: null });
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

  // --- destructive actions. Every one of these goes through ConfirmDialog. ---
  function askDeleteNote(note) {
    setConfirm({
      kind: 'note',
      id: note.id,
      title: 'Delete this note for good?',
      body: `"${note.title?.trim() || 'Untitled'}" and anything attached to it will be erased from the database. This cannot be undone, and it is not the same as archiving.`,
      confirmLabel: 'Delete for good',
    });
  }

  function askDeleteFolder(folder) {
    const count = folder.note_count || 0;
    setConfirm({
      kind: 'folder',
      id: folder.id,
      title: `Delete the folder "${folder.name}"?`,
      body: count
        ? `The folder is erased. Its ${count} ${count === 1 ? 'note' : 'notes'} are kept and become Unfiled, so no writing is lost. This cannot be undone.`
        : 'The folder is erased. This cannot be undone.',
      confirmLabel: 'Delete folder',
    });
  }

  async function runConfirmed() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === 'note') {
        await api(`/notes/${confirm.id}`, { method: 'DELETE' });
        setNotes((rows) => rows.filter((row) => row.id !== confirm.id));
        setRecent((rows) => rows.filter((row) => row.id !== confirm.id));
        if (openNote?.id === confirm.id) setOpenNote(null);
        showToast('Note deleted');
      } else {
        await api(`/folders/${confirm.id}`, { method: 'DELETE' });
        setFolders((rows) => rows.filter((row) => row.id !== confirm.id));
        if (view.type === 'folder' && view.folderId === confirm.id) setView({ type: 'dashboard' });
        showToast('Folder deleted');
      }
      setConfirm(null);
      await refreshAll();
    } catch (error) {
      showToast(error.message || 'That did not work.');
    } finally {
      setConfirmBusy(false);
    }
  }

  function handleFolderSaved(folder, { renamed } = {}) {
    setFolderModal({ open: false, folder: null });
    setFolders((rows) => (renamed
      ? rows.map((row) => (row.id === folder.id ? { ...row, ...folder } : row))
      : [...rows, folder]));
    showToast(renamed ? `Renamed to ${folder.name}` : `Created ${folder.name}`);
    loadFolders().catch(() => {});
    // A brand new folder is somewhere you meant to go; a rename is not.
    if (!renamed) selectView({ type: 'folder', folderId: folder.id });
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
          ? 'Archived notes rest here. Restore one, or delete it for good.'
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
      {/* Rename and delete leave the drawer open: the dialog overlays it, so
          cancelling puts you back exactly where you were. */}
      <Sidebar
        open={drawer}
        folders={folders}
        totals={totals}
        view={view}
        email={session.user?.email || ''}
        onSelect={selectView}
        onNewFolder={() => { setDrawer(false); setFolderModal({ open: true, folder: null }); }}
        onRenameFolder={(folder) => setFolderModal({ open: true, folder })}
        onDeleteFolder={(folder) => askDeleteFolder(folder)}
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
            onDelete={askDeleteNote}
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
            onNewFolder={() => setFolderModal({ open: true, folder: null })}
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
                onDelete={askDeleteNote}
                empty={emptyState}
              />
            </div>
          </div>
        )}
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onOpenNote={openNoteById} />
      <FolderModal
        key={folderModal.folder?.id || 'new-folder'}
        open={folderModal.open}
        folder={folderModal.folder}
        onClose={() => setFolderModal({ open: false, folder: null })}
        onSaved={handleFolderSaved}
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title || ''}
        body={confirm?.body || ''}
        confirmLabel={confirm?.confirmLabel || 'Delete'}
        busy={confirmBusy}
        onConfirm={runConfirmed}
        onCancel={() => { if (!confirmBusy) setConfirm(null); }}
      />

      {toast && <div className="toast" role="status"><IconCheck width={14} height={14} />{toast}</div>}
    </div>
  );
}
