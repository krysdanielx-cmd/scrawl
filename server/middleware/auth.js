import { supabase } from '../config/supabase.js';
import { verifyToken } from '../utils/tokens.js';

export async function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = verifyToken(match[1]);
    if (!payload.sub || typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'Invalid session.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, created_at')
      .eq('id', payload.sub)
      .maybeSingle();

    if (error) return next(error);
    if (!user) return res.status(401).json({ error: 'Invalid session.' });

    req.user = user;
    return next();
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
    return next(error);
  }
}
