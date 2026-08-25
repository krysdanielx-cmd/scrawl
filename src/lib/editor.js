import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

export const EMPTY_DOC = { type: 'doc', content: [] };

export function buildExtensions({ placeholder } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

/** Tiptap chokes on null/undefined content; hand it an empty doc instead. */
export function safeContent(content) {
  return content && typeof content === 'object' && content.type === 'doc' ? content : EMPTY_DOC;
}
