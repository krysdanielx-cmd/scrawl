import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Extension, Node, Mark } from '@tiptap/core';

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

// Simple highlight mark
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

// Add Cmd+Shift+X as an additional shortcut for strikethrough
const StrikeShortcut = Extension.create({
  name: 'strikeShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
    };
  },
});

// Custom TableCell with background color support
const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor || element.getAttribute('data-bg-color'),
        renderHTML: attributes => {
          if (!attributes.backgroundColor) return {};
          return {
            'data-bg-color': attributes.backgroundColor,
            style: `background-color: ${attributes.backgroundColor}`,
          };
        },
      },
      colwidth: {
        default: null,
        parseHTML: element => {
          const colwidth = element.getAttribute('colwidth');
          return colwidth ? colwidth.split(',').map(w => parseInt(w, 10)) : null;
        },
        renderHTML: attributes => {
          if (!attributes.colwidth) return {};
          return { colwidth: attributes.colwidth.join(',') };
        },
      },
    };
  },
});

// Custom TableHeader with background color support
const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor || element.getAttribute('data-bg-color'),
        renderHTML: attributes => {
          if (!attributes.backgroundColor) return {};
          return {
            'data-bg-color': attributes.backgroundColor,
            style: `background-color: ${attributes.backgroundColor}`,
          };
        },
      },
      colwidth: {
        default: null,
        parseHTML: element => {
          const colwidth = element.getAttribute('colwidth');
          return colwidth ? colwidth.split(',').map(w => parseInt(w, 10)) : null;
        },
        renderHTML: attributes => {
          if (!attributes.colwidth) return {};
          return { colwidth: attributes.colwidth.join(',') };
        },
      },
    };
  },
});

// Callout block extension (like Notion callouts)
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  
  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: element => element.getAttribute('data-callout-type') || 'info',
        renderHTML: attributes => ({ 'data-callout-type': attributes.type }),
      },
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor,
        renderHTML: attributes => {
          if (!attributes.backgroundColor) return {};
          return { style: `background-color: ${attributes.backgroundColor}` };
        },
      },
    };
  },
  
  parseHTML() {
    return [
      { tag: 'div[data-callout]' },
      { tag: 'aside' },
      { tag: 'div.callout' },
    ];
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-callout': '', class: 'callout' }, 0];
  },
  
  addCommands() {
    return {
      setCallout: (attributes) => ({ commands }) => {
        return commands.wrapIn(this.name, attributes);
      },
      toggleCallout: (attributes) => ({ commands }) => {
        return commands.toggleWrap(this.name, attributes);
      },
    };
  },
});

// Multi-column layout
const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column+',
  
  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: element => parseInt(element.getAttribute('data-columns') || '2', 10),
        renderHTML: attributes => ({ 'data-columns': attributes.count }),
      },
    };
  },
  
  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, class: 'columns' }, 0];
  },
});

const Column = Node.create({
  name: 'column',
  group: 'column',
  content: 'block+',
  
  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },
  
  renderHTML() {
    return ['div', { 'data-column': '', class: 'column' }, 0];
  },
});

// Badge/pill inline mark
const Badge = Node.create({
  name: 'badge',
  group: 'inline',
  inline: true,
  content: 'text*',
  
  addAttributes() {
    return {
      color: {
        default: 'gray',
        parseHTML: element => element.getAttribute('data-badge-color') || 'gray',
        renderHTML: attributes => ({ 'data-badge-color': attributes.color }),
      },
    };
  },
  
  parseHTML() {
    return [
      { tag: 'span[data-badge]' },
      { tag: 'span.badge' },
    ];
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-badge': '', class: 'badge' }, 0];
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

/** Tiptap chokes on null/undefined content; hand it an empty doc instead. */
export function safeContent(content) {
  if (!content || typeof content !== 'object' || content.type !== 'doc') return EMPTY_DOC;
  // Older notes were saved as a doc with zero children, which renders as a bare
  // gap cursor with no paragraph to type into.
  if (!Array.isArray(content.content) || content.content.length === 0) return EMPTY_DOC;
  return content;
}

// Cell colors palette
export const CELL_COLORS = [
  { name: 'Default', value: null },
  { name: 'Light Gray', value: '#f5f5f5' },
  { name: 'Light Blue', value: '#e3f2fd' },
  { name: 'Light Green', value: '#e8f5e9' },
  { name: 'Light Yellow', value: '#fffde7' },
  { name: 'Light Orange', value: '#fff3e0' },
  { name: 'Light Pink', value: '#fce4ec' },
  { name: 'Light Purple', value: '#f3e5f5' },
];

// Callout types
export const CALLOUT_TYPES = [
  { name: 'Info', type: 'info', icon: 'ℹ️' },
  { name: 'Success', type: 'success', icon: '✅' },
  { name: 'Warning', type: 'warning', icon: '⚠️' },
  { name: 'Error', type: 'error', icon: '❌' },
  { name: 'Note', type: 'note', icon: '📝' },
];
