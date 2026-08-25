import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { hasContentText } from '../config/capabilities.js';
import { EMPTY_DOC, extractText, makePublicSlug, snippet, uuidSchema, validateDoc } from '../utils/notes.js';

const router = Router();
router.use(requireAuth);

const META = 'id, folder_id, title, is_pinned, is_archived, is_published, public_slug, created_at, updated_at';
const titleSchema = z.string().max(300);

const createSchema = z.object({
  title: titleSchema.optional(),
  folder_id: uuidSchema.nullable().optional(),
  content: z.unknown().optional(),
}).strict();

const updateSchema = z.object({
  title: titleSchema.optional(),
  folder_id: uuidSchema.nullable().optional(),
  content: z.unknown().optional(),
  is_pinned: z.boolean().optional(),
  is_archived: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

const listQuerySchema = z.object({
  folder_id: z.union([uuidSchema, z.literal('unfiled')]).optional(),
  archived: z.enum(['true', 'false']).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).strip();

/**
 * PostgREST parses `or=(...)` itself, so an unquoted comma or paren in the
 * search term would be read as filter syntax. Quoting the value handles those;
 * the strip only has to remove what can escape the quotes, plus the LIKE
 * wildcard `%`. `_` is left alone: it widens the match harmlessly.
 */
function safeSearchTerm(term) {
  return term.replace(/[\\"%]/g, '').trim();
}

function toListItem(row) {
  const text = row.content_text !== undefined ? row.content_text : extractText(row.content);
  const { content, content_text, ...meta } = row;
  return { ...meta, snippet: snippet(text) };
}

async function loadFolderIds(userId) {
  const { data, error } = await supabase.from('folders').select('id').eq('user_id', userId);
  if (error) throw error;
  return new Set(data.map((folder) => folder.id));
}

router.get('/', async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const useColumn = await hasContentText();
    const term = query.q ? safeSearchTerm(query.q) : '';

    let builder = supabase
      .from('notes')
      .select(useColumn ? `${META}, content_text` : `${META}, content`)
      .eq('user_id', req.user.id)
      .eq('is_archived', query.archived === 'true');

    if (query.folder_id === 'unfiled') builder = builder.is('folder_id', null);
    else if (query.folder_id) builder = builder.eq('folder_id', query.folder_id);

    if (term && useColumn) {
      builder = builder.or(`title.ilike."%${term}%",content_text.ilike."%${term}%"`);
    }

    builder = builder
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(query.limit ?? 200);

    const { data, error } = await builder;
    if (error) throw error;

    let notes = data.map(toListItem);
    if (term && !useColumn) {
      const needle = term.toLowerCase();
      notes = notes.filter((note) =>
        note.title.toLowerCase().includes(needle) || note.snippet.toLowerCase().includes(needle));
    }

    return res.json({ notes });
  } catch (error) {
    return next(error);
  }
});

router.get('/recent', async (req, res, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(50).default(8).parse(req.query.limit ?? 8);
    const useColumn = await hasContentText();

    const { data, error } = await supabase
      .from('notes')
      .select(useColumn ? `${META}, content_text` : `${META}, content`)
      .eq('user_id', req.user.id)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    return res.json({ notes: data.map(toListItem) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { data: note, error } = await supabase
      .from('notes')
      .select(`${META}, content`)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!note) return res.status(404).json({ error: 'Note not found.' });
    return res.json({ note });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const content = body.content === undefined ? EMPTY_DOC : validateDoc(body.content);

    if (body.folder_id) {
      const owned = await loadFolderIds(req.user.id);
      if (!owned.has(body.folder_id)) return res.status(404).json({ error: 'Folder not found.' });
    }

    const row = {
      user_id: req.user.id,
      folder_id: body.folder_id ?? null,
      title: body.title ?? '',
      content,
    };
    if (await hasContentText()) row.content_text = extractText(content);

    const { data: note, error } = await supabase
      .from('notes')
      .insert(row)
      .select(`${META}, content`)
      .single();
    if (error) throw error;

    return res.status(201).json({ note });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const body = updateSchema.parse(req.body);
    const patch = {};

    if (body.title !== undefined) patch.title = body.title;
    if (body.is_pinned !== undefined) patch.is_pinned = body.is_pinned;
    if (body.is_archived !== undefined) {
      patch.is_archived = body.is_archived;
      // Archiving revokes the public link; a shared note should not stay
      // readable on the internet after it is taken off the desk.
      if (body.is_archived) {
        patch.is_published = false;
        patch.public_slug = null;
      }
    }
    if (body.folder_id !== undefined) {
      if (body.folder_id !== null) {
        const owned = await loadFolderIds(req.user.id);
        if (!owned.has(body.folder_id)) return res.status(404).json({ error: 'Folder not found.' });
      }
      patch.folder_id = body.folder_id;
    }
    if (body.content !== undefined) {
      const content = validateDoc(body.content);
      patch.content = content;
      if (await hasContentText()) patch.content_text = extractText(content);
    }

    const { data: note, error } = await supabase
      .from('notes')
      .update(patch)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select(META)
      .maybeSingle();
    if (error) throw error;
    if (!note) return res.status(404).json({ error: 'Note not found.' });

    return res.json({ note });
  } catch (error) {
    return next(error);
  }
});

/**
 * Destructive. The row is gone and its attachments cascade with it; there is no
 * undo. Archiving is a PATCH of is_archived, deliberately a different verb.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { data: note, error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!note) return res.status(404).json({ error: 'Note not found.' });
    return res.json({ ok: true, id });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/publish', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { data: existing, error: readError } = await supabase
      .from('notes')
      .select('id, is_published, public_slug, is_archived')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return res.status(404).json({ error: 'Note not found.' });
    if (existing.is_archived) return res.status(409).json({ error: 'Restore the note before publishing it.' });

    if (existing.is_published && existing.public_slug) {
      return res.json({ note: existing, url: `/p/${existing.public_slug}` });
    }

    const { data: note, error } = await supabase
      .from('notes')
      .update({ is_published: true, public_slug: makePublicSlug() })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select(META)
      .maybeSingle();
    if (error) throw error;
    if (!note) return res.status(404).json({ error: 'Note not found.' });

    return res.json({ note, url: `/p/${note.public_slug}` });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id/publish', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { data: note, error } = await supabase
      .from('notes')
      .update({ is_published: false, public_slug: null })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select(META)
      .maybeSingle();
    if (error) throw error;
    if (!note) return res.status(404).json({ error: 'Note not found.' });
    return res.json({ note });
  } catch (error) {
    return next(error);
  }
});

export default router;
