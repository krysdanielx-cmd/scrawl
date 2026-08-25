import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Extension, Mark } from '@tiptap/core';

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const Highlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      color: {
        default: '#fef08a',
        parseHTML: element => element.style.backgroundColor || '#fef08a',
        renderHTML: attributes => ({ style: `background-color: ${attributes.color}; padding: 0 2px; border-radius: 2px;` }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'mark' }, { tag: 'span[data-highlight]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', HTMLAttributes, 0];
  },
  addCommands() {
    return {
      toggleHighlight: () => ({ commands }) => commands.toggleMark(this.name),
    };
  },
});

const StrikeShortcut = Extension.create({
  name: 'strikeShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
    };
  },
});

export function buildExtensions({ placeholder } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({
      resizable: true,
      cellMinWidth: 50,
      HTMLAttributes: { class: 'prose-table' },
    }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({
      openOnClick: true,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { class: 'prose-link', target: '_blank', rel: 'noopener noreferrer' },
    }),
    Underline,
    Highlight,
    StrikeShortcut,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

export function safeContent(content) {
  if (!content || typeof content !== 'object' || content.type !== 'doc') return EMPTY_DOC;
  if (!Array.isArray(content.content) || content.content.length === 0) return EMPTY_DOC;
  return content;
}
