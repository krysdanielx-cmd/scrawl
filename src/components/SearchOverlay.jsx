import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { noteTitle, relativeTime } from '../lib/format.js';
import { IconSearch } from '../lib/icons.jsx';

export default function SearchOverlay({ open, onClose, onOpenNote }) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    setTerm('');
    setHits([]);
    setActive(0);
    // One rAF was not enough: if the click that opened the panel unmounts its own
    // button, focus can land back on <body> after our call. Retry briefly until
    // the input really holds focus.
    // Focus synchronously first: effects run after the DOM is updated but before
    // paint, so the input is already focusable and no keystroke can be dropped.
    inputRef.current?.focus();
    let frame = 0;
    let tries = 0;
    const grab = () => {
      const input = inputRef.current;
      if (!input) return;
      if (document.activeElement !== input) input.focus();
      tries += 1;
      if (document.activeElement !== input && tries < 12) frame = requestAnimationFrame(grab);
    };
    frame = requestAnimationFrame(grab);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const query = term.trim();
    if (query.length < 2) { setHits([]); setLoading(false); return undefined; }

    setLoading(true);
    const mine = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const { notes } = await api(`/notes?q=${encodeURIComponent(query)}&limit=30`);
        // Out-of-order responses would otherwise show results for an older term.
        if (mine !== requestId.current) return;
        setHits(notes);
        setActive(0);
      } catch {
        if (mine === requestId.current) setHits([]);
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [term, open]);

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (event.key === 'Enter' && hits[active]) { event.preventDefault(); onOpenNote(hits[active].id); }
  }

  const query = term.trim();

  return (
    <div className="overlay" hidden={!open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="Search notes" onKeyDown={onKeyDown}>
        <div className="search-input-row">
          <IconSearch width={18} height={18} />
          <input
            ref={inputRef}
            type="text"
            value={term}
            placeholder="Search titles and note text"
            aria-label="Search notes"
            onChange={(event) => setTerm(event.target.value)}
          />
          <button className="btn btn-quiet btn-sm" type="button" onClick={onClose}>Close</button>
        </div>

        <div className="search-results">
          {query.length < 2 && <p className="lede" style={{ padding: '18px 12px', fontSize: '.8125rem' }}>Type at least two characters.</p>}
          {query.length >= 2 && loading && <p className="lede" style={{ padding: '18px 12px', fontSize: '.8125rem' }}>Searching...</p>}
          {query.length >= 2 && !loading && !hits.length && (
            <p className="lede" style={{ padding: '18px 12px', fontSize: '.8125rem' }}>Nothing matches that yet.</p>
          )}
          {hits.map((note, index) => (
            <button
              key={note.id}
              className="search-hit"
              type="button"
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => onOpenNote(note.id)}
            >
              <span className="title">{noteTitle(note)}</span>
              <span className="excerpt">{note.snippet || 'Empty note'} </span>
              <span className="excerpt" style={{ fontSize: '.6875rem' }}>{relativeTime(note.updated_at)}</span>
            </button>
          ))}
        </div>

        <div className="search-foot">
          <span>Up and Down to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
