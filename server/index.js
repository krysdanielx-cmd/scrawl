import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import folderRoutes from './routes/folders.js';
import noteRoutes from './routes/notes.js';
import publicRoutes from './routes/public.js';
import { errorHandler, notFound } from './middleware/errors.js';

const app = express();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

app.disable('x-powered-by');
app.set('trust proxy', 1);
// Helmet's defaults plus a tighter CSP. 'unsafe-inline' stays on style-src only
// because React writes inline styles; scripts stay strictly same-origin.
app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'script-src': ["'self'"],
      'script-src-attr': ["'none'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'worker-src': ["'self'"],
      'manifest-src': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'upgrade-insecure-requests': [],
    },
  } : false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === env.CLIENT_ORIGIN) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 600,
}));
// Notes carry a full ProseMirror document; 64kb was too tight for a long one.
// server/utils/notes.js caps a single doc at 600kb before it reaches Postgres.
app.use(express.json({ limit: '1mb', strict: true }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
}), authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/public', rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
}), publicRoutes);

if (env.NODE_ENV === 'production') {
  // The worker must never be cached, or a stale one pins an old shell forever.
  app.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Service-Worker-Allowed', '/');
    res.type('application/javascript');
    res.sendFile(path.join(rootDir, 'dist', 'sw.js'));
  });
  app.use(express.static(path.join(rootDir, 'dist'), {
    index: false,
    setHeaders(res, filePath) {
      // Hashed bundles are immutable; the shell and icons must revalidate.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      else res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    },
  }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(rootDir, 'dist', 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler);

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Scrawl API listening on ${env.PORT}`);
});
