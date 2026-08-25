import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * Creates a folder, or renames one when `folder` is passed.
 */
export default function FolderModal({ open, folder = null, onClose, onSaved }) {
  // Initialised from props, not just patched by an effect: an effect runs after
  // the commit that reveals the dialog, so for one frame the field would still
  // show whatever was typed last time.
  const [name, setName] = useState(folder?.name || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const renaming = Boolean(folder);

  useEffect(() => {
    if (!open) return undefined;
    setName(folder?.name || '');
    setError('');
    // Focus synchronously first. A single rAF loses the race when the modal is
    // opened straight after the nav drawer closes, and the first keystroke is
    // dropped; the retries cover the mount not being painted yet.
    let frame = 0;
    let tries = 0;
    const grab = () => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        if (folder?.name) input.select();
      }
      if (document.activeElement !== inputRef.current && tries < 12) {
        tries += 1;
        frame = requestAnimationFrame(grab);
      }
    };
    grab();
    return () => cancelAnimationFrame(frame);
  }, [open, folder]);

  async function submit(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the folder a name.'); return; }
    if (renaming && trimmed === folder.name) { onClose(); return; }
    setBusy(true);
    setError('');
    try {
      const path = renaming ? `/folders/${folder.id}` : '/folders';
      const { folder: saved } = await api(path, {
        method: renaming ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: trimmed }),
      });
      onSaved(saved, { renamed: renaming });
    } catch (requestError) {
      setError(requestError.message || `Could not ${renaming ? 'rename' : 'create'} that folder.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" hidden={!open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal-card folder-modal" onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
        <h2>{renaming ? 'Rename folder' : 'New folder'}</h2>
        <p>{renaming ? 'The notes inside stay exactly where they are.' : 'Folders keep one client or project in one place.'}</p>
        <label className="sr-only" htmlFor="folder-name">Folder name</label>
        <input
          id="folder-name"
          ref={inputRef}
          className="field"
          value={name}
          maxLength={80}
          placeholder="Client name, project, anything"
          onChange={(event) => setName(event.target.value)}
        />
        {error && <p className="form-error" style={{ margin: '14px 0 0' }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
            {busy ? 'Saving' : renaming ? 'Save name' : 'Create folder'}
          </button>
        </div>
      </form>
    </div>
  );
}
