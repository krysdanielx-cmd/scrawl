import { useState, useEffect, useRef } from 'react';
import { CELL_COLORS } from '../lib/editor.js';

export default function TableMenu({ editor }) {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [showColors, setShowColors] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!editor) return;

    const updateMenu = () => {
      const { selection } = editor.state;
      const isInTable = editor.isActive('table');
      
      if (isInTable) {
        const { from } = selection;
        const coords = editor.view.coordsAtPos(from);
        const editorRect = editor.view.dom.getBoundingClientRect();
        
        setPosition({
          top: coords.top - editorRect.top - 40,
          left: coords.left - editorRect.left,
        });
        setShow(true);
      } else {
        setShow(false);
        setShowColors(false);
      }
    };

    editor.on('selectionUpdate', updateMenu);
    editor.on('focus', updateMenu);
    
    return () => {
      editor.off('selectionUpdate', updateMenu);
      editor.off('focus', updateMenu);
    };
  }, [editor]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowColors(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!show || !editor) return null;

  const setCellBg = (color) => {
    editor.chain().focus().setCellAttribute('backgroundColor', color).run();
    setShowColors(false);
  };

  return (
    <div 
      ref={menuRef}
      className="table-menu" 
      style={{ top: position.top, left: position.left }}
    >
      <div className="table-menu-row">
        <button 
          type="button" 
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          title="Add column before"
        >
          ← Col
        </button>
        <button 
          type="button" 
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          title="Add column after"
        >
          Col →
        </button>
        <button 
          type="button" 
          onClick={() => editor.chain().focus().deleteColumn().run()}
          title="Delete column"
          className="danger"
        >
          ✕ Col
        </button>
      </div>
      <div className="table-menu-row">
        <button 
          type="button" 
          onClick={() => editor.chain().focus().addRowBefore().run()}
          title="Add row before"
        >
          ↑ Row
        </button>
        <button 
          type="button" 
          onClick={() => editor.chain().focus().addRowAfter().run()}
          title="Add row after"
        >
          Row ↓
        </button>
        <button 
          type="button" 
          onClick={() => editor.chain().focus().deleteRow().run()}
          title="Delete row"
          className="danger"
        >
          ✕ Row
        </button>
      </div>
      <div className="table-menu-row">
        <button 
          type="button" 
          onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          title="Toggle header row"
        >
          Header
        </button>
        <button 
          type="button" 
          onClick={() => setShowColors(!showColors)}
          title="Cell color"
        >
          🎨 Color
        </button>
        <button 
          type="button" 
          onClick={() => editor.chain().focus().deleteTable().run()}
          title="Delete table"
          className="danger"
        >
          ✕ Table
        </button>
      </div>
      
      {showColors && (
        <div className="color-picker">
          {CELL_COLORS.map((c) => (
            <button
              key={c.name}
              type="button"
              className="color-swatch"
              style={{ backgroundColor: c.value || 'transparent' }}
              onClick={() => setCellBg(c.value)}
              title={c.name}
            >
              {!c.value && '∅'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
