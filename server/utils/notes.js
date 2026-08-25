import crypto from 'node:crypto';
import { z } from 'zod';

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const MAX_NODES = 20000;
const MAX_DEPTH = 24;
const MAX_DOC_BYTES = 600 * 1024;

/**
 * Tiptap/ProseMirror JSON is recursive, so it cannot be described usefully by a
 * flat schema. Validate it structurally instead: every node must be an object
 * with a string `type`, and the whole tree has to stay inside sane bounds so a
 * malformed or hostile payload cannot blow up the editor or the row size.
 */
export function validateDoc(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new z.ZodError([{ code: 'custom', path: ['content'], message: 'Content must be a document.' }]);
  }
  if (value.type !== 'doc') {
    throw new z.ZodError([{ code: 'custom', path: ['content'], message: 'Content must be a doc node.' }]);
  }

  let nodes = 0;
  const walk = (node, depth) => {
    if (depth > MAX_DEPTH) throw new z.ZodError([{ code: 'custom', path: ['content'], message: 'Content is nested too deeply.' }]);
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new z.ZodError([{ code: 'custom', path: ['content'], message: 'Invalid content node.' }]);
    }
    if (typeof node.type !== 'string' || node.type.length === 0 || node.type.length > 64) {
      throw new z.ZodError([{ code: 'custom', path: ['content'], message: 'Invalid content node type.' }]);
    }
    nodes += 1;
    if (nodes > MAX_NODES) throw new z.ZodError([{ code: 'custom', path: ['content'], message: 'Content is too large.' }]);
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) {
        throw new z.ZodError([{ code: 'custom', path: ['content'], message: 'Invalid content node.' }]);
      }
      for (const child of node.content) walk(child, depth + 1);
    }
  };

  walk(value, 0);

  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_DOC_BYTES) {
    throw new z.ZodError([{ code: 'custom', path: ['content'], message: 'Content is too large.' }]);
  }

  return value;
}

/** Flatten a ProseMirror doc to searchable plain text. */
export function extractText(doc) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') out.push(node.text);
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
      // Block boundaries need whitespace or "one\ntwo" searches as "onetwo".
      if (node.type && node.type !== 'doc') out.push('\n');
    }
  };
  walk(doc);
  return out.join('').replace(/\n{2,}/g, '\n').trim().slice(0, 200000);
}

export function snippet(text, length = 180) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}...` : flat;
}

/** 22 url-safe chars, comfortably inside the [A-Za-z0-9_-]{12,64} check. */
export function makePublicSlug() {
  return crypto.randomBytes(16).toString('base64url').slice(0, 22);
}

export const uuidSchema = z.string().uuid();
