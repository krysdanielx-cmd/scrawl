import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

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
