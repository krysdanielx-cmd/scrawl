import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { uuidSchema } from '../utils/notes.js';

const router = Router();
router.use(requireAuth);

const FOLDER_FIELDS = 'id, name, position, created_at';

const nameSchema = z.string().trim().min(1).max(80);
const createSchema = z.object({ name: nameSchema }).strict();
const updateSchema = z.object({
  name: nameSchema.optional(),
  position: z.number().int().min(0).max(9999).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

function conflict(res) {
  return res.status(409).json({ error: 'A folder with that name already exists.' });
}

/** Counts live-note totals per folder, plus the unfiled bucket. */
async function folderCounts(userId) {
  const { data, error } = await supabase
    .from('notes')
    .select('folder_id')
    .eq('user_id', userId)
    .eq('is_archived', false);
  if (error) throw error;

  const counts = new Map();
  let unfiled = 0;
  for (const row of data) {
    if (!row.folder_id) unfiled += 1;
    else counts.set(row.folder_id, (counts.get(row.folder_id) || 0) + 1);
  }
  return { counts, unfiled, total: data.length };
}

router.get('/', async (req, res, next) => {
  try {
    const { data: folders, error } = await supabase
      .from('folders')
      .select(FOLDER_FIELDS)
      .eq('user_id', req.user.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const { counts, unfiled, total } = await folderCounts(req.user.id);
    const { count: archivedCount, error: archivedError } = await supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('is_archived', true);
    if (archivedError) throw archivedError;

    return res.json({
      folders: folders.map((folder) => ({ ...folder, note_count: counts.get(folder.id) || 0 })),
      totals: { all: total, unfiled, archived: archivedCount || 0 },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name } = createSchema.parse(req.body);

    const { data: last, error: lastError } = await supabase
      .from('folders')
      .select('position')
      .eq('user_id', req.user.id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;

    const { data: folder, error } = await supabase
      .from('folders')
      .insert({ user_id: req.user.id, name, position: (last?.position ?? -1) + 1 })
      .select(FOLDER_FIELDS)
      .single();
    if (error) {
      if (error.code === '23505') return conflict(res);
      throw error;
    }

    return res.status(201).json({ folder: { ...folder, note_count: 0 } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const patch = updateSchema.parse(req.body);

    // Scope the write by user_id as well as id: ownership is enforced by the
    // filter itself, not by a prior read that could race.
    const { data: folder, error } = await supabase
      .from('folders')
      .update(patch)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select(FOLDER_FIELDS)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return conflict(res);
      throw error;
    }
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });

    const { counts } = await folderCounts(req.user.id);
    return res.json({ folder: { ...folder, note_count: counts.get(folder.id) || 0 } });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    // notes.folder_id is ON DELETE SET NULL, so the notes survive as unfiled.
    const { data: folder, error } = await supabase
      .from('folders')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });
    return res.json({ ok: true, id });
  } catch (error) {
    return next(error);
  }
});

export default router;
