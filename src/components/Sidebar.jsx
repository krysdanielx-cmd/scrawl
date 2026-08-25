import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('scrawl-sidebar-collapsed') === 'true');
  const [width, setWidth] = useState(() => parseInt(localStorage.getItem('scrawl-sidebar-width') || '268', 10));
  const [isDragging, setIsDragging] = useState(false);
  const sidebarRef = useRef(null);
  
  const isOn = (type, folderId) =>
    view.type === type && (type !== 'folder' || view.folderId === folderId);

  // Update CSS variable and localStorage when width changes
  useEffect(() => {
    if (!collapsed) {
      document.documentElement.style.setProperty('--sidebar-w', `${width}px`);
      localStorage.setItem('scrawl-sidebar-width', String(width));
    }
  }, [width, collapsed]);

  // Update collapsed state
  useEffect(() => {
    localStorage.setItem('scrawl-sidebar-collapsed', String(collapsed));
    const shell = document.querySelector('.shell');
    if (shell) shell.setAttribute('data-collapsed', String(collapsed));
  }, [collapsed]);

  // Handle resize drag
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const newWidth = Math.min(Math.max(200, e.clientX), 400);
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  const toggleCollapse = () => setCollapsed(!collapsed);

  return (
    <aside 
      ref={sidebarRef}
      className="sidebar" 
      data-open={open ? 'true' : 'false'} 
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label="Notes navigation"
      style={!collapsed ? { width } : undefined}
    >
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

      {/* Collapse toggle */}
      <button 
        className="sidebar-toggle" 
        type="button" 
        onClick={toggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {/* Resize handle */}
      <div 
        className={`sidebar-resize ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}
