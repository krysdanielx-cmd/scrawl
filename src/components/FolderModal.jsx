import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function FolderModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setName('');
    setError('');
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the folder a name.'); return; }
    setBusy(true);
    setError('');
    try {
      const { folder } = await api('/folders', { method: 'POST', body: JSON.stringify({ name: trimmed }) });
      onCreated(folder);
    } catch (requestError) {
      setError(requestError.message || 'Could not create that folder.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" hidden={!open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal-card" onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
        <h2>New folder</h2>
        <p>Folders keep one client or project in one place.</p>
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
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? 'Creating' : 'Create folder'}</button>
        </div>
      </form>
    </div>
  );
}
