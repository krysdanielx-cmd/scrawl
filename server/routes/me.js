import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { data: folders, error } = await supabase
      .from('folders')
      .select('id, name, position, created_at')
      .eq('user_id', req.user.id)
      .order('position', { ascending: true });

    if (error) throw error;
    return res.json({ user: req.user, folders });
  } catch (error) {
    return next(error);
  }
});

export default router;
