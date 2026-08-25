import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

// Strip background colors and other unwanted styles from pasted content
export function transformPastedHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  
  // Remove background colors and other unwanted inline styles
  div.querySelectorAll('[style]').forEach(el => {
    const style = el.style;
    style.backgroundColor = '';
    style.background = '';
    style.color = ''; // Let Scrawl's theme handle text color
  });
  
  // Remove background color attributes
  div.querySelectorAll('[bgcolor]').forEach(el => {
    el.removeAttribute('bgcolor');
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
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

export function safeContent(content) {
  if (!content || typeof content !== 'object' || content.type !== 'doc') return EMPTY_DOC;
  if (!Array.isArray(content.content) || content.content.length === 0) return EMPTY_DOC;
  return content;
}
