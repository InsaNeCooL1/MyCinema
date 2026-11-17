'use strict';

// ════════════════════════════════════════════════════════════════
// Клієнтська частина IMDb-рейтингів.
// TMDB лишається каталогом; тут ми лише зв'язуємо tmdb_id → IMDb
// rating/votes через воркер POST /imdb/batch і кешуємо на 7 днів.
//
// НЕ підключено до математики рекомендацій — поки що тільки база.
// ════════════════════════════════════════════════════════════════

const IMDB_CACHE_KEY = 'mycinema.imdbRatings.v1';
const IMDB_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 днів (позитивні записи)
const IMDB_MISS_TTL = 24 * 60 * 60 * 1000;      // 1 доба (негативний кеш промахів)
const IMDB_CACHE_MAX = 3000;                    // стеля записів у кеші
const IMDB_SEND_MAX = 400;                      // стеля ID на тип за запит

function imdbType(t) {
  return (t === 'tv' || t === 'show' || t === 'series') ? 'tv' : 'movie';
}

function imdbParseId(v) {
  if (v == null) return 0;
  const n = (typeof v === 'number') ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function imdbKey(type, id) {
  return imdbType(type) + ':' + String(imdbParseId(id));
}

function imdbReadCache() {
  const raw = (typeof mcCacheGet === 'function')
    ? mcCacheGet(IMDB_CACHE_KEY, {})
    : (() => { try { return JSON.parse(localStorage.getItem(IMDB_CACHE_KEY)) || {}; } catch { return {}; } })();
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

function imdbWriteCache(cache) {
  try {
    const entries = Object.entries(cache);
    if (entries.length > IMDB_CACHE_MAX) {
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      cache = Object.fromEntries(entries.slice(0, IMDB_CACHE_MAX));
    }
    if (typeof mcCacheSet === 'function') mcCacheSet(IMDB_CACHE_KEY, cache);
    else localStorage.setItem(IMDB_CACHE_KEY, JSON.stringify(cache));
  } catch (_) { /* кеш не критичний */ }
}

function imdbEntryFrom(val, now) {
  return {
    imdbId: val.imdbId || null,
    imdbRating: Number(val.imdbRating),
    imdbVotes: Math.max(0, Number(val.imdbVotes) || 0),
    ts: now || Date.now(),
  };
}

/** Синхронний lookup. Повертає entry або null, якщо даних немає/прострочені. */
function imdbLookup(type, id) {
  const key = imdbKey(type, id);
  if (!key || key.endsWith(':0')) return null;
  const entry = imdbReadCache()[key];
  if (!entry || !(Number(entry.imdbRating) > 0)) return null;
  if (Date.now() - (entry.ts || 0) > IMDB_CACHE_TTL) return null;
  return entry;
}

/** Негативний кеш: відомий промах MDBList, ще не прострочений. */
function imdbIsKnownMissing(type, id) {
  const key = imdbKey(type, id);
  if (!key || key.endsWith(':0')) return false;
  const entry = imdbReadCache()[key];
  return !!(entry && entry.miss && (Date.now() - (entry.ts || 0)) < IMDB_MISS_TTL);
}

function imdbStore(data, want) {
  if (!data || typeof data !== 'object') return 0;
  const cache = imdbReadCache();
  const now = Date.now();
  let added = 0;
  for (const [type, bucket] of [['movie', data.movie], ['tv', data.tv]]) {
    if (!bucket || typeof bucket !== 'object') continue;
    // Кешуємо лише те, що справді просили — зайві ID з відповіді не цікаві.
    const allowed = want && want[type] ? new Set(want[type].map(String)) : null;
    for (const [id, val] of Object.entries(bucket)) {
      if (!val || !(Number(val.imdbRating) > 0)) continue;
      if (allowed && !allowed.has(String(id))) continue;
      const key = imdbKey(type, id);
      if (key.endsWith(':0')) continue;
      cache[key] = imdbEntryFrom(val, now);
      added++;
    }
  }
  if (added) imdbWriteCache(cache);
  return added;
}

/** Кешує підтверджені воркером промахи, щоб не спамити MDBList при кожному старті. */
function imdbStoreMissing(missing, want) {
  if (!missing || typeof missing !== 'object') return 0;
  const cache = imdbReadCache();
  const now = Date.now();
  let added = 0;
  for (const type of ['movie', 'tv']) {
    const ids = missing[type];
    if (!Array.isArray(ids)) continue;
    const allowed = want && want[type] ? new Set(want[type].map(String)) : null;
    for (const id of ids) {
      if (allowed && !allowed.has(String(id))) continue;
      const key = imdbKey(type, id);
      if (key.endsWith(':0')) continue;
      const old = cache[key];
      // Не перетираємо свіжий позитивний запис помилковим «missing».
      if (old && Number(old.imdbRating) > 0 && (now - (old.ts || 0)) < IMDB_CACHE_TTL) continue;
      cache[key] = { miss: true, ts: now };
      added++;
    }
  }
  if (added) imdbWriteCache(cache);
  return added;
}

function imdbCleanIds(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const id = imdbParseId(v);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
    if (out.length >= IMDB_SEND_MAX) break;
  }
  return out;
}

/** Пакетний виклик воркера. Ніколи не кидає — повертає ok:false при будь-якій помилці. */
async function imdbFetchBatch(movies, tv) {
  const body = { movies: imdbCleanIds(movies), tv: imdbCleanIds(tv) };
  if (!body.movies.length && !body.tv.length) {
    return { ok: false, error: 'no ids', data: { movie: {}, tv: {} }, missing: body, errors: [] };
  }
  try {
    const base = (typeof PROXY_URL === 'string' && PROXY_URL) ? PROXY_URL.replace(/\/$/, '') : '';
    const res = await fetch(base + '/imdb/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
    const j = await res.json();
    if (!j || typeof j !== 'object') throw new Error('bad response');
    return {
      ok: j.ok !== false,
      data: (j.data && typeof j.data === 'object') ? j.data : { movie: {}, tv: {} },
      missing: j.missing || { movie: [], tv: [] },
      errors: Array.isArray(j.errors) ? j.errors : [],
      meta: j.meta || null,
      error: j.error || null,
    };
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      data: { movie: {}, tv: {} },
      missing: body,
      errors: [],
      meta: null,
    };
  }
}

/**
 * Головний вхід: підтягує IMDb для перелічених tmdb_id, використовуючи
 * локальний кеш. При ok:false (квота/мережа/воркер) повертає лише те,
 * що вже є в кеші, і fallback:true — викликач має впасти на TMDB.
 */
async function imdbLoadFor(movies, tv) {
  const want = { movie: imdbCleanIds(movies), tv: imdbCleanIds(tv) };
  const todo = { movie: [], tv: [] };
  const knownMissing = { movie: [], tv: [] };
  const data = {};

  for (const type of ['movie', 'tv']) {
    for (const id of want[type]) {
      const hit = imdbLookup(type, id);
      if (hit) data[imdbKey(type, id)] = hit;
      else if (imdbIsKnownMissing(type, id)) knownMissing[type].push(id);
      else todo[type].push(id);
    }
  }

  if (!todo.movie.length && !todo.tv.length) {
    return { ok: true, fallback: false, data, missing: knownMissing, errors: [], fetched: 0 };
  }

  const res = await imdbFetchBatch(todo.movie, todo.tv);
  const fetched = imdbStore(res.data, want);

  // FIX-IMDB-RETURN: imdbStore пише в кеш, але результат мав повертати
  // щойно завантажені елементи й при холодному старті (fetched > 0, data: {}).
  const now = Date.now();
  for (const type of ['movie', 'tv']) {
    const bucket = res.data && res.data[type];
    if (!bucket || typeof bucket !== 'object') continue;
    const allowed = want[type] ? new Set(want[type].map(String)) : null;
    for (const [id, val] of Object.entries(bucket)) {
      if (!val || !(Number(val.imdbRating) > 0)) continue;
      if (allowed && !allowed.has(String(id))) continue;
      const key = imdbKey(type, id);
      if (key.endsWith(':0')) continue;
      data[key] = imdbEntryFrom(val, now);
    }
  }

  // Промахи кешуємо тільки для валідної відповіді воркера: при ok:false
  // (квота/мережа) res.missing = усе, що не вдалося з'ясувати — не підтвердження.
  if (res.ok !== false) imdbStoreMissing(res.missing, want);

  const missing = { movie: [...knownMissing.movie], tv: [...knownMissing.tv] };
  for (const type of ['movie', 'tv']) {
    const ids = res.missing && res.missing[type];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (!missing[type].includes(id)) missing[type].push(id);
    }
  }

  return {
    ok: res.ok,
    fallback: !res.ok,
    data,
    raw: res.data,
    missing,
    errors: res.errors,
    meta: res.meta,
    error: res.error,
    fetched,
    requested: want,
    todo,
  };
}

/**
 * Уніфіковане джерело рейтингу для математики (пізніше):
 * IMDb якщо є, інакше TMDB — з явним полем source.
 */
function imdbRef(item) {
  if (!item || typeof item !== 'object') {
    return { rating: 0, votes: 0, imdbId: null, source: 'none' };
  }
  const type = imdbType(item.type || item.media_type || (item.name && !item.title ? 'tv' : 'movie'));
  const id = imdbParseId(item.id != null ? item.id : item.tmdbId);
  const hit = id ? imdbLookup(type, id) : null;
  if (hit && Number(hit.imdbRating) > 0) {
    return {
      rating: Number(hit.imdbRating),
      votes: Number(hit.imdbVotes) || 0,
      imdbId: hit.imdbId || null,
      source: 'imdb',
    };
  }
  const imdbRating = Number(item.imdbRating) || 0;
  if (imdbRating > 0) {
    return {
      rating: imdbRating,
      votes: Number(item.imdbVotes) || Number(item.votes) || 0,
      imdbId: item.imdbId || null,
      source: 'imdb',
    };
  }
  return {
    rating: Number(item.tmdbRating) || 0,
    votes: Number(item.votes) || 0,
    imdbId: item.imdbId || null,
    source: 'tmdb',
  };
}

function imdbClearCache() {
  try {
    if (typeof mcCacheDel === 'function') mcCacheDel(IMDB_CACHE_KEY);
    else localStorage.removeItem(IMDB_CACHE_KEY);
  } catch (_) {}
}

// Публічний API (classic script + зручно для тестів)
window.IMDB_CACHE_KEY = IMDB_CACHE_KEY;
window.IMDB_CACHE_TTL = IMDB_CACHE_TTL;
window.IMDB_MISS_TTL = IMDB_MISS_TTL;
window.imdbType = imdbType;
window.imdbKey = imdbKey;
window.imdbLookup = imdbLookup;
window.imdbIsKnownMissing = imdbIsKnownMissing;
window.imdbFetchBatch = imdbFetchBatch;
window.imdbLoadFor = imdbLoadFor;
window.imdbRef = imdbRef;
window.imdbClearCache = imdbClearCache;
