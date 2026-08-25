import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Extension } from '@tiptap/core';

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

// Add Cmd+Shift+X as an additional shortcut for strikethrough
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
