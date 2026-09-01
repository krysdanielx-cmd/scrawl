import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

// Clean pasted HTML - strip backgrounds, normalize structure
export function transformPastedHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  
  // Remove ALL inline styles (let Scrawl's CSS handle everything)
  div.querySelectorAll('[style]').forEach(el => {
    el.removeAttribute('style');
  });
  
  // Remove background color attributes
  div.querySelectorAll('[bgcolor]').forEach(el => {
    el.removeAttribute('bgcolor');
  });
  
  // Remove class attributes that might carry external styling
  div.querySelectorAll('[class]').forEach(el => {
    el.removeAttribute('class');
  });
  
  return div.innerHTML;
}

export function buildExtensions({ placeholder } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({
      openOnClick: true,
      autolink: true,
      linkOnPaste: true,
    }),
    Underline,
    Image.configure({
      inline: false,
      allowBase64: true,
      HTMLAttributes: { class: 'scrawl-image' },
    }),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

export function safeContent(content) {
  if (!content || typeof content !== 'object' || content.type !== 'doc') return EMPTY_DOC;
  if (!Array.isArray(content.content) || content.content.length === 0) return EMPTY_DOC;
  return content;
}
