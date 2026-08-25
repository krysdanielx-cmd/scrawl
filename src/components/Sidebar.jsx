import { IconArchive, IconFolder, IconPlus, IconSignOut, IconStack } from '../lib/icons.jsx';

export default function Sidebar({
  open, folders, totals, view, email,
  onSelect, onNewFolder, onSignOut,
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

        {folders.map((folder) => (
          <button
            key={folder.id}
            className="nav-item"
            type="button"
            data-on={isOn('folder', folder.id)}
            onClick={() => onSelect({ type: 'folder', folderId: folder.id })}
          >
            <IconFolder />
            <span className="nav-text">{folder.name}</span>
            <span className="nav-count">{folder.note_count}</span>
          </button>
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
      </div>

      <div className="side-foot">
        <p className="who" title={email}>{email}</p>
        <button className="nav-item" type="button" onClick={onSignOut}>
          <IconSignOut />
          <span className="nav-text">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
