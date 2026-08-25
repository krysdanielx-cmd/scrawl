import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { createToken } from '../utils/tokens.js';

const router = Router();
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128),
}).strict();

router.post('/signup', async (req, res, next) => {
  try {
    const credentials = credentialsSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(credentials.password, 12);

    const { data: user, error } = await supabase
      .from('users')
      .insert({ email: credentials.email, password_hash: passwordHash })
      .select('id, email, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Scrawl already has an owner.' });
      }
      throw error;
    }

    const { error: folderError } = await supabase.from('folders').insert([
      { user_id: user.id, name: 'OGTool', position: 0 },
      { user_id: user.id, name: 'Vision', position: 1 },
    ]);

    if (folderError) {
      await supabase.from('users').delete().eq('id', user.id);
      throw folderError;
    }

    return res.status(201).json({
      token: createToken(user.id),
      user,
      folders: [
        { name: 'OGTool', position: 0 },
        { name: 'Vision', position: 1 },
      ],
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const credentials = credentialsSchema.parse(req.body);
    const { data: userWithPassword, error } = await supabase
      .from('users')
      .select('id, email, password_hash, created_at')
      .eq('email', credentials.email)
      .maybeSingle();

    if (error) throw error;

    const matches = userWithPassword
      ? await bcrypt.compare(credentials.password, userWithPassword.password_hash)
      : await bcrypt.compare(credentials.password, '$2b$12$JqpfZJUIjI0xlncqWy5J6OHHObPiYra/K6j2iTQ2FzCO8.i7lbqMi');

    if (!userWithPassword || !matches) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const { password_hash, ...user } = userWithPassword;
    const { data: folders, error: foldersError } = await supabase
      .from('folders')
      .select('id, name, position, created_at')
      .eq('user_id', user.id)
      .order('position', { ascending: true });

    if (foldersError) throw foldersError;
    return res.json({ token: createToken(user.id), user, folders });
  } catch (error) {
    return next(error);
  }
});

export default router;
