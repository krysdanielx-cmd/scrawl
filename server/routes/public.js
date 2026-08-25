import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';

const router = Router();
const slugSchema = z.string().regex(/^[A-Za-z0-9_-]{12,64}$/);

/**
 * The only unauthenticated data route. It returns the note body and nothing
 * that identifies the owner, and it filters on is_published as well as the
 * slug so unpublishing takes effect immediately.
 */
router.get('/notes/:slug', async (req, res, next) => {
  try {
    const slug = slugSchema.safeParse(req.params.slug);
    if (!slug.success) return res.status(404).json({ error: 'Not found.' });

    const { data: note, error } = await supabase
      .from('notes')
      .select('title, content, created_at, updated_at')
      .eq('public_slug', slug.data)
      .eq('is_published', true)
      .eq('is_archived', false)
      .maybeSingle();
    if (error) throw error;
    if (!note) return res.status(404).json({ error: 'Not found.' });

    res.set('Cache-Control', 'no-store');
    return res.json({ note });
  } catch (error) {
    return next(error);
  }
});

export default router;
