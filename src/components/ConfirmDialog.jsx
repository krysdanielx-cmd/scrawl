import { useEffect, useRef } from 'react';

/**
 * Confirmation for actions that cannot be undone.
 *
 * The cancel button takes focus, not the confirm button, so a stray Enter can
 * never destroy anything. Escape and a backdrop click both cancel.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Keep it',
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    let tries = 0;
    const grab = () => {
      cancelRef.current?.focus();
      if (document.activeElement !== cancelRef.current && tries < 12) {
        tries += 1;
        frame = requestAnimationFrame(grab);
      }
    };
    grab();
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onCancel]);

  return (
    <div
      className="overlay"
      hidden={!open}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" type="button" ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`btn btn-sm ${destructive ? 'btn-danger' : 'btn-primary'}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
