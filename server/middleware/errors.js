import { ZodError } from 'zod';

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }

  console.error('[scrawl]', error);
  return res.status(500).json({ error: 'Something went wrong.' });
}
