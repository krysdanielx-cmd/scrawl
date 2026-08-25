/**
 * Scrawl service worker: offline app shell only.
 *
 * Deliberately never caches anything from /api/. Note bodies are private and
 * belong in Postgres, not in a cache a shared device could read.
 * Bump VERSION whenever the shell contract changes.
 */
const VERSION = 'v5';
const SHELL = `scrawl-shell-${VERSION}`;
const ASSETS = `scrawl-assets-${VERSION}`;
const SHELL_URLS = [
  '/', '/manifest.json', 
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
  '/icon-192-light.png', '/icon-512-light.png', '/apple-touch-icon-light.png',
  '/icon-192-dark.png', '/icon-512-dark.png', '/apple-touch-icon-dark.png',
  '/fonts/fraunces-latin-var.woff2', '/fonts/plus-jakarta-sans-latin-var.woff2',
];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scrawl is offline</title>
<style>html{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f7f6f4;color:#21201e}
body{min-height:100dvh;margin:0;display:grid;place-items:center;padding:24px;text-align:center}
p{max-width:28ch;line-height:1.6;color:#6b6862}b{color:#0047AB}</style></head>
<body><div><p><b>Scrawl</b> needs a connection to load your notes. Reopen when you are back online.</p></div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' })));

    // The page loads its bundles before this worker exists, so they never pass
    // through the fetch handler on a first visit. Read the shell and precache
    // whatever it references, or the first offline load has no CSS or JS.
    try {
      const html = await (await cache.match('/', { ignoreVary: true })).text();
      const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      if (refs.length) await (await caches.open(ASSETS)).addAll(refs);
    } catch { /* offline-first is best effort; never block activation */ }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== SHELL && key !== ASSETS).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache private data

  // Navigations: network first, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put('/', fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match('/', { cacheName: SHELL, ignoreVary: true });
        return cached || new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Hashed build output is immutable: cache first, always serve from cache when available.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { cacheName: ASSETS, ignoreVary: true });
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) (await caches.open(ASSETS)).put(request, fresh.clone());
      return fresh;
    })());
    return;
  }

  // Icons, fonts and the manifest: serve from cache first for speed, update in background.
  event.respondWith((async () => {
    const cached = await caches.match(request, { cacheName: SHELL, ignoreVary: true });
    if (cached) {
      // Background refresh
      fetch(request).then(async (fresh) => {
        if (fresh.ok) (await caches.open(SHELL)).put(request, fresh.clone());
      }).catch(() => {});
      return cached;
    }
    const fresh = await fetch(request);
    if (fresh.ok) (await caches.open(SHELL)).put(request, fresh.clone());
    return fresh;
  })());
});
