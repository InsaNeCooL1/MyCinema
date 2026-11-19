/* FIX-TITLE-LOGOS — українські логотипи назв замість тексту (опційно). */
'use strict';

const TITLE_LOGO_CACHE = 'mycinema.titleLogos.v1';
const TITLE_LOGO_TTL = 30 * 24 * 60 * 60 * 1000;
const TITLE_LOGO_MAX = 800;
const _titleLogoMem = new Map();
const _titleLogoPending = new Map();

function readTitleLogoCache() {
  const c = typeof mcCacheGet === 'function' ? mcCacheGet(TITLE_LOGO_CACHE, {}) : {};
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

function writeTitleLogoCache(cache) {
  try {
    const entries = Object.entries(cache);
    if (entries.length > TITLE_LOGO_MAX) {
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      cache = Object.fromEntries(entries.slice(0, TITLE_LOGO_MAX));
    }
    if (typeof mcCacheSet === 'function') mcCacheSet(TITLE_LOGO_CACHE, cache);
  } catch (e) {}
}

/* Лише українські логотипи. Якщо їх немає — повертаємо null і лишаємо назву. */
function pickUkrainianLogo(logos) {
  if (!Array.isArray(logos)) return null;
  const uk = logos.filter(l => l && l.iso_639_1 === 'uk' && l.file_path);
  return uk.length ? uk[0].file_path : null;
}

function fetchTitleLogo(item) {
  if (!item || !item.id || !item.type) return Promise.resolve(null);
  const key = item.type + '-' + item.id;
  const cache = readTitleLogoCache();
  const hit = cache[key];
  if (hit && Date.now() - (hit.ts || 0) < TITLE_LOGO_TTL) return Promise.resolve(hit.path || null);
  if (_titleLogoMem.has(key)) return Promise.resolve(_titleLogoMem.get(key));
  if (_titleLogoPending.has(key)) return _titleLogoPending.get(key);

  const promise = (typeof tmdbFetch === 'function'
    ? tmdbFetch('/' + encodeURIComponent(item.type) + '/' + item.id + '/images?include_image_language=uk')
    : Promise.resolve(null))
    .then(data => pickUkrainianLogo(data && data.logos))
    .catch(() => null)
    .then(path => {
      _titleLogoMem.set(key, path);
      const c = readTitleLogoCache();
      c[key] = { ts: Date.now(), path: path };
      writeTitleLogoCache(c);
      return path;
    })
    .finally(() => { _titleLogoPending.delete(key); });

  _titleLogoPending.set(key, promise);
  return promise;
}

function applyTitleLogo(item, titleEl, className) {
  if (typeof settings === 'undefined' || !settings.titleLogos || !titleEl || !item) return;
  fetchTitleLogo(item).then(path => {
    if (!path || !titleEl.isConnected) return;
    const img = document.createElement('img');
    img.className = className || 'rec-title-logo';
    img.src = TMDB_IMG + (/\.svg$/i.test(path) ? 'original' : 'w300') + path;
    img.alt = String(titleEl.textContent || item.title || '');
    img.loading = 'lazy';
    titleEl.replaceChildren(img);
  });
}

window._titleLogos = { pickUkrainianLogo, fetchTitleLogo, applyTitleLogo };
