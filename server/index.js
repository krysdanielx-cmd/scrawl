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
app.use(helmet({ contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false }));
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
  app.use(express.static(path.join(rootDir, 'dist'), { index: false, maxAge: '1h' }));
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
