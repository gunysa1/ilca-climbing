// Minimal offline shell: cache the app shell, always go to network for API calls. The judge pad
// must reopen without signal (results wait in its outbox), so the shell's own scripts and styles
// are cached at install too, and every page load online refreshes the cached shell.
const CACHE = 'ilca-staff-shell-v2';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(['/', '/manifest.webmanifest', '/icon.svg']);
    const html = await (await c.match('/')).text();
    await c.addAll([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); }
      return res;
    }).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && url.pathname.startsWith('/assets/')) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  })));
});
