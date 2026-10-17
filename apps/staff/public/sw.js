// Minimal offline shell: cache the app shell, always go to network for API calls. The judge pad
// must reopen without signal (results wait in its outbox), so the shell's own scripts and styles
// are cached at install too. Pages: network first, the cached shell after 3.5 s or without signal
// (a page loaded online replaces the cached shell only once all its assets are cached, then drops
// the old ones). Built assets (hashed names): cache first. Anything else (manifest, icon): network
// first, cache as fallback. The cache is named after the build (`?v=` from src/apps/staff/main.tsx):
// every deploy installs a new worker that caches the new shell completely before it takes over; if
// that fails, the old worker and its cache stay.
const CACHE = `ilca-staff-shell-${new URL(self.location.href).searchParams.get('v') || 'v3'}`;
const NAV_TIMEOUT_MS = 3500;
const assetsOf = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

/** Drop cached /assets/* the current shell doesn't load (old builds). Lazily loaded chunks go too
 *  and are fetched again when opened (only the judge pad must work offline; it's in the main bundle). */
async function prune(cache, html) {
  const keep = new Set(assetsOf(html));
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/assets/') && !keep.has(path)) await cache.delete(req);
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(['/', '/manifest.webmanifest', '/icon.svg']);
    await c.addAll(assetsOf(await (await c.match('/')).text()));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    const c = await caches.open(CACHE);
    const shell = await c.match('/');
    if (shell) await prune(c, await shell.text());
  })());
  self.clients.claim();
});

function navigate(request) {
  const network = fetch(request).then(async (res) => {
    if (res.ok) {
      const c = await caches.open(CACHE);
      const html = await res.clone().text();
      const old = await c.match('/');
      if (!old || (await old.text()) !== html) {
        // A newer shell: cache its assets first; if that fails, keep the old shell and its assets.
        try { await c.addAll(assetsOf(html)); } catch { return res; }
        await c.put('/', res.clone());
        await prune(c, html);
      }
    }
    return res;
  });
  const fallback = () => caches.match('/');
  const late = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS)).then(fallback);
  // Whichever comes first: the page (or, failing it, the shell) — or the shell after 3.5 s of weak signal.
  return Promise.race([network.catch(fallback), late]).then((res) => res || network);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(navigate(e.request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || Response.error())));
});
