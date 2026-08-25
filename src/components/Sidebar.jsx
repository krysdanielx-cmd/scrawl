import { useState, useEffect } from 'react';
import { IconArchive, IconFolder, IconPencil, IconPlus, IconSignOut, IconStack, IconTrash } from '../lib/icons.jsx';

function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('scrawl-theme') || 'light');
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? '' : theme);
    localStorage.setItem('scrawl-theme', theme);
    
    // Update favicon based on theme
    const isDark = theme === 'dark' || theme === 'ambient';
    const suffix = isDark ? '-dark' : '-light';
    document.querySelector('link[rel="icon"][sizes="512x512"]')?.setAttribute('href', `/icon-512${suffix}.png`);
    document.querySelector('link[rel="icon"][sizes="192x192"]')?.setAttribute('href', `/icon-192${suffix}.png`);
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', `/apple-touch-icon${suffix}.png`);
  }, [theme]);

  return (
    <div className="theme-toggle">
      <button type="button" data-on={theme === 'light'} onClick={() => setTheme('light')} title="Light">☀️</button>
      <button type="button" data-on={theme === 'dark'} onClick={() => setTheme('dark')} title="Dark">🌙</button>
      <button type="button" data-on={theme === 'ambient'} onClick={() => setTheme('ambient')} title="Ambient">🕯️</button>
    </div>
  );
}

export default function Sidebar({
  open, folders, totals, recent, view, email,
  onSelect, onNewFolder, onRenameFolder, onDeleteFolder, onOpenNote, onSignOut,
}) {
  const isOn = (type, folderId) =>
    view.type === type && (type !== 'folder' || view.folderId === folderId);

  return (
    <aside className="sidebar" data-open={open ? 'true' : 'false'} aria-label="Notes navigation">
      <div className="brand">
        <span className="mark" style={{ width: 30, height: 30, borderRadius: 9, fontSize: 17 }} aria-hidden="true">S</span>
        <span className="brand-name">Scrawl<span className="dot">.</span></span>
      </div>

      <div className="side-scroll">
        <button className="nav-item" type="button" data-on={isOn('dashboard')} onClick={() => onSelect({ type: 'dashboard' })}>
          <IconStack />
          <span className="nav-text">Desk</span>
        </button>
        <button className="nav-item" type="button" data-on={isOn('all')} onClick={() => onSelect({ type: 'all' })}>
          <IconFolder />
          <span className="nav-text">All notes</span>
          <span className="nav-count">{totals.all}</span>
        </button>

        <p className="side-label">
          Folders
          <button type="button" onClick={onNewFolder} aria-label="New folder" title="New folder"><IconPlus width={14} height={14} /></button>
        </p>

        {/* A nav item cannot contain the rename/delete buttons (nested buttons are
            invalid), so the row is a wrapper with the controls as siblings. */}
        {folders.map((folder) => (
          <div className="nav-row" key={folder.id}>
            <button
              className="nav-item"
              type="button"
              data-on={isOn('folder', folder.id)}
              onClick={() => onSelect({ type: 'folder', folderId: folder.id })}
            >
              <IconFolder />
              <span className="nav-text">{folder.name}</span>
              <span className="nav-count">{folder.note_count}</span>
            </button>
            <span className="nav-tools">
              <button
                type="button"
                className="nav-tool"
                onClick={() => onRenameFolder(folder)}
                aria-label={`Rename ${folder.name}`}
                title="Rename"
              >
                <IconPencil width={14} height={14} />
              </button>
              <button
                type="button"
                className="nav-tool nav-tool-danger"
                onClick={() => onDeleteFolder(folder)}
                aria-label={`Delete ${folder.name}`}
                title="Delete folder"
              >
                <IconTrash width={14} height={14} />
              </button>
            </span>
          </div>
        ))}

        {totals.unfiled > 0 && (
          <button className="nav-item" type="button" data-on={isOn('unfiled')} onClick={() => onSelect({ type: 'unfiled' })}>
            <IconFolder />
            <span className="nav-text">Unfiled</span>
            <span className="nav-count">{totals.unfiled}</span>
          </button>
        )}

        <p className="side-label">Everything else</p>
        <button className="nav-item" type="button" data-on={isOn('archive')} onClick={() => onSelect({ type: 'archive' })}>
          <IconArchive />
          <span className="nav-text">Archive</span>
          <span className="nav-count">{totals.archived}</span>
        </button>

        {recent && recent.length > 0 && (
          <>
            <p className="side-label">Recent</p>
            {recent.slice(0, 5).map((note) => (
              <button
                key={note.id}
                className="nav-item nav-item-compact"
                type="button"
                onClick={() => onOpenNote(note.id)}
              >
                <span className="nav-text">{note.title?.trim() || 'Untitled'}</span>
              </button>
            ))}
          </>
        )}
      </div>

      <div className="side-foot">
        <ThemeToggle />
        <p className="who" title={email}>{email}</p>
        <button className="nav-item" type="button" onClick={onSignOut}>
          <IconSignOut />
          <span className="nav-text">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
