// sw.js — service worker: keeps a copy of the app on the device so it works offline.
//
// IMPORTANT: when you change ANY app file, raise CACHE_VERSION (and APP_VERSION in js/app.js).
// The new version then downloads in the background and is used after the next reload.

const CACHE_VERSION = '0.3.0';
const CACHE = `interview-drill-${CACHE_VERSION}`;

// Every file the app needs. Paths are relative, so it works under /interview-drill/ on GitHub Pages.
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/data.js',
  'js/db.js',
  'js/fade.js',
  'js/glossary.js',
  'js/mock.js',
  'js/review.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/sample-data.json',
];

self.addEventListener('install', (event) => {
  // Download everything first; if one file fails, this version is not installed (the old one stays).
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Remove caches of older app versions (only our own caches; user data lives in IndexedDB, not here).
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('interview-drill-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Opening the app (any page navigation) → the cached index.html.
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    // Everything else: cached copy first, network as a fallback.
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
