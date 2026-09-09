import { useState, useRef, useEffect } from 'react';
import { IconClose } from '../lib/icons.jsx';

export default function HtmlPreviewModal({ open, onClose }) {
  const [html, setHtml] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="html-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="html-preview-header">
          <h2>HTML Preview</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="html-preview-body">
          <div className="html-preview-input">
            <label htmlFor="html-input">Paste HTML</label>
            <textarea
              id="html-input"
              ref={textareaRef}
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="<div>Your HTML here...</div>"
              spellCheck={false}
            />
          </div>
          <div className="html-preview-output">
            <label>Preview</label>
            <div 
              className="html-preview-render"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
