'use strict';

/**
 * Service worker: keeps the pages and files the till needs on this computer, so the POS still opens with no internet.
 *  - Our own pages / scripts / styles: internet first (you always get the newest version), saved copy if the internet is down.
 *  - Bootstrap, icons, fonts from CDNs: saved copy first, downloaded once.
 *  - /api and /health are never touched here. Offline data lives in IndexedDB (js/offline.js).
 * Change VERSION when you want every computer to throw away its saved copies.
 */
const VERSION = 'sparehub-shell-v1';

const SHELL = [
  'login.html', 'pos.html', 'css/app.css', 'css/dashboard.css', 'css/pos.css',
  'js/api.js', 'js/layout.js', 'js/offline.js', 'js/pos.js', 'manifest.webmanifest', 'icon.svg',
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.allSettled([
        ...SHELL.map((u) => cache.add(u)),
        ...CDN.map((u) => fetch(new Request(u, { mode: 'no-cors' })).then((r) => cache.put(u, r))),
      ])
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('slow')), ms);
  promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

const OFFLINE_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>No internet</title><body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;color:#222">'
  + '<h2>No internet</h2><p>This page was not saved on this computer yet, so it cannot open without internet.</p>'
  + '<p><a href="pos.html">Go to the Point of sale</a>. It works offline.</p></body>';

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return new Response(OFFLINE_PAGE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') return; // live data: never cached here
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});
