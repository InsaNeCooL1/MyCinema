'use strict';

const SW_VER = 'v3';
const SHELL_CACHE = 'mycinema-shell-' + SW_VER;
const IMG_CACHE = 'mycinema-img-' + SW_VER;
const CDN_CACHE = 'mycinema-cdn-' + SW_VER;
const IMG_LIMIT = 250;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './bundle.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_ASSETS.map(url =>
      fetch(url, { cache: 'reload' })
        .then(res => { if (res && res.ok) return cache.put(url, res); })
        .catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const keep = new Set([SHELL_CACHE, IMG_CACHE, CDN_CACHE]);
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const delCount = keys.length - maxItems;
      for (let i = 0; i < delCount; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch {}
}

async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
    ]);
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
      return res;
    }
    throw new Error('bad status');
  } catch {
    const cached = await cache.match(req, { ignoreSearch: false });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || (await cache.match('./'));
    }
    return Response.error();
  }
}

async function cacheFirstImage(req) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone()).then(() => trimCache(IMG_CACHE, IMG_LIMIT)).catch(() => {});
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Ізольована кімнатка Lampa — не перехоплюємо через SW MyCinema
  if (url.origin === self.location.origin && (url.pathname.includes('/lampa/') || url.pathname.endsWith('/lampa'))) return;

  // Ніколи не кешуємо API / Auth / зовнішні запити даних
  if (
    url.hostname.endsWith('supabase.co') ||
    url.hostname.endsWith('workers.dev') ||
    url.hostname.endsWith('wikidata.org') ||
    url.hostname.endsWith('wikipedia.org') ||
    url.hostname.includes('youtube.com') ||
    url.hostname.includes('youtu.be')
  ) {
    return;
  }

  // Постери TMDB — Cache-First з лімітом 250 картинок
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(cacheFirstImage(req));
    return;
  }

  // Supabase ESM модулі (щоб офлайн не падав <script type="module">)
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }

  // Власні файли додатку (HTML / CSS / JS / Manifest)
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE, 2500));
  }
});
