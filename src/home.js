'use strict';

// ============ RECOMMENDATIONS ENGINE V2 ============
const GEN_CACHE = 'mycinema.home.general.v7'; /* FIX-GEN-CACHE-BUMP */
const RECS_TTL = 48 * 60 * 60 * 1000;  // 48 годин /* FIX-RECS-CACHE-V2 */
const GEN_TTL = 12 * 60 * 60 * 1000;  // 12 годин

function isExcludedShow(raw, type) {
  if (!raw) return true;
  const gids = raw.genre_ids || (Array.isArray(raw.genres) ? raw.genres.map(g => (typeof g === 'object' ? g.id : g)) : []);
  if ((type === 'tv' || raw.media_type === 'tv') && gids.some(g => EXCLUDED_TV_GENRES.includes(g))) return true;
  if (gids.some(g => g === 10763 || g === 10764 || g === 10767)) return true;
  const title = `${raw.title || raw.name || ''} ${raw.original_title || raw.original_name || ''}`.trim();
  if (/(\b(the oscars|oscars 20\d\d|academy awards|golden globe awards|emmy awards|grammy awards|bafta awards|mtv .* awards|eurovision song contest|saturday night live|tonight show|late night with|late show with|jimmy kimmel|stephen colbert|seth meyers|graham norton)\b|церемоні(я|ї) (вручення|нагородження)|премі(я|ї) «?оскар»?|євробачення)/i.test(title)) {
    return true;
  }
  return false;
}

const META_CACHE_KEY = 'mycinema.metaCache.v2'; /* FIX-META-CACHE-BUMP */
const META_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const META_CACHE_MAX = 220;
const _memSeedRecs = new Map(); /* FIX-MEMSEED-LRU */
function _trimMemSeedRecs() {
  while (_memSeedRecs.size > 200) {
    const fk = _memSeedRecs.keys().next().value;
    _memSeedRecs.delete(fk);
  }
}


function hashString32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(str) {
  let a = hashString32(str) || 1;
  return function() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isExcludedFromTaste(x, avg) {
  if (!x) return true;
  if (x.excludeFromProfile === true) return true;
  if (x.excludeFromProfile === false) return false;
  if (x.tmdbRating > 0 && avg > 0 && Math.abs(avg - x.tmdbRating) > 3) return true;
  return false;
}

function readMetaCacheAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(META_CACHE_KEY)) || {};
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch { return {}; }
}

function writeMetaCacheAll(cache) {
  try {
    const entries = Object.entries(cache);
    if (entries.length > META_CACHE_MAX) {
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      cache = Object.fromEntries(entries.slice(0, META_CACHE_MAX));
    }
    localStorage.setItem(META_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function packCompactMeta(d, type) {
  const dirs = [];
  const seenDir = new Set();
  (d.credits?.crew || []).filter(c => c.job === 'Director' || c.job === 'Creator').forEach(c => {
    if (!seenDir.has(c.id)) { seenDir.add(c.id); dirs.push({ id: c.id, name: c.name }); }
  });
  (d.created_by || []).forEach(c => {
    if (!seenDir.has(c.id)) { seenDir.add(c.id); dirs.push({ id: c.id, name: c.name }); }
  });

  let cast = [];
  if (type === 'tv' && Array.isArray(d.aggregate_credits?.cast) && d.aggregate_credits.cast.length) {
    const rawCast = d.aggregate_credits.cast.slice(0, 12);
    const maxEps = Math.max(...rawCast.map(c => c.total_episode_count || 1), 1);
    cast = rawCast.map(c => ({
      id: c.id,
      name: c.name,
      w: clampNum((c.total_episode_count || 1) / maxEps, 0.15, 1)
    }));
  } else {
    cast = (d.credits?.cast || []).slice(0, 10).map((c, idx) => ({
      id: c.id,
      name: c.name,
      w: 1 / Math.sqrt(1 + (typeof c.order === 'number' ? c.order : idx))
    }));
  }

  const kws = (d.keywords?.keywords || d.keywords?.results || []).slice(0, 14).map(k => k.id);
  const genres = (d.genres || []).map(g => g.id);

  return {
    ts: Date.now(),
    colId: d.belongs_to_collection?.id || null,
    netId: d.networks?.[0]?.id || null,
    dirs: dirs.slice(0, 3),
    cast,
    kws,
    genres,
    /* FIX-RELEASE-PACK-META */
    digitalDate: (typeof extractDigitalDate === 'function') ? extractDigitalDate(d) : null,
    providersUA: (typeof extractProvidersUA === 'function') ? extractProvidersUA(d) : []
  };
}

async function fetchCompactMeta(type, id, needRecs, cacheObj) {
  const key = `${type}-${id}`;
  const now = Date.now();
  const cached = cacheObj[key];
  const cachedRecs = needRecs ? _memSeedRecs.get(key) : null;
  if (cached && (now - (cached.ts || 0)) < META_CACHE_TTL && (!needRecs || cachedRecs)) {
    return { meta: cached, recs: cachedRecs || [] };
  }

  /* FIX-RELEASE-COMPACT-FETCH */
  const parts = [type === 'tv' ? 'credits,aggregate_credits,keywords,watch/providers' : 'credits,keywords,release_dates,watch/providers'];
  if (needRecs) parts.push('recommendations');
  const d = await tmdbFetch(`/${type}/${id}?language=uk-UA&append_to_response=${parts.join(',')}`);
  const meta = packCompactMeta(d, type);
  cacheObj[key] = meta;

  let recs = [];
  if (needRecs) {
    recs = (d.recommendations?.results || []).slice(0, 12);
    _memSeedRecs.set(key, recs);
    _trimMemSeedRecs(); /* FIX-MEMSEED-LRU-2 */
  }
  return { meta, recs };
}

async function mapBatched(items, batchSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const res = await Promise.all(chunk.map(fn));
    out.push(...res);
  }
  return out;
}

function getSeeds() {
  const candidates = Object.values(lib)
    .map(x => {
      const avg = computeItemRating(x).avg;
      const isFav = !!x.favorite;
      const elo = typeof x.elo === 'number' ? x.elo : ELO_START;
      const hasHighElo = (x.eloGames || 0) > 0 && elo >= 1530;
      if (!x.id || x.antiSeed || isExcludedFromTaste(x, avg)) return null;
      if (avg < 6.5 && !isFav && !hasHighElo) return null;

      const base = avg > 0 ? avg : (isFav ? 8.6 : 8.2);
      const favBonus = isFav ? 1.2 : 0;
      const eloBonus = elo > ELO_START ? Math.min((elo - ELO_START) / 100, 1.5) : 0;
      const strength = Math.min(10, base + favBonus + eloBonus);

      const residual = (avg > 0 && x.tmdbRating > 0)
        ? (avg - x.tmdbRating)
        : (avg > 0 ? avg - 7.0 : 0.8);
      const resFactor = clampNum(1 + residual / 2, 0.3, 2);
      const decayMult = Math.max(0.1, tasteDecay(x.updated));
      const rankScore = (strength / 10) * resFactor * (0.35 + 0.65 * decayMult);

      return { ...x, avg, isFav, elo, strength, residual, resFactor, decayMult, rankScore };
    })
    .filter(Boolean);

  if (!candidates.length) return [];

  const fresh = [...candidates].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 3);
  const byResidual = [...candidates].sort((a, b) => b.rankScore - a.rankScore || (b.updated || 0) - (a.updated || 0));

  const picked = [];
  const seen = new Set();
  for (const s of fresh) {
    if (!seen.has(s.key)) { seen.add(s.key); picked.push(s); }
  }
  for (const s of byResidual) {
    if (picked.length >= 18) break;
    if (!seen.has(s.key)) { seen.add(s.key); picked.push(s); }
  }
  return picked;
}

function getAntiSeeds() {
  return Object.values(lib)
    .map(x => ({ ...x, avg: computeItemRating(x).avg }))
    .filter(x => x.id && (x.status === 'dropped' || x.antiSeed === true) && x.excludeFromProfile !== true)
    .sort((a, b) => ((b.antiSeed ? 1 : 0) - (a.antiSeed ? 1 : 0)) || ((b.updated || 0) - (a.updated || 0)))
    .slice(0, 5);
}

function getDominantCriterion(taste) {
  if (!taste || taste.count < 3) return null;
  const vals = RATING_CRITERIA.map(c => ({ key: c.key, label: c.label, v: taste[c.key] || 0 }));
  const sorted = [...vals].sort((a, b) => b.v - a.v);
  const avg = vals.reduce((s, x) => s + x.v, 0) / vals.length;
  if (sorted[0].v - avg >= 0.35) return sorted[0];
  return null;
}

function minMaxNorm(arr) {
  if (!arr.length) return [];
  let min = Infinity, max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  if (span <= 1e-9) return arr.map(() => 0);
  return arr.map(v => (v - min) / span);
}

async function buildSmartRecommendations(seeds, mood, mode) {
  mode = mode || 'balance';
  if (!seeds.length) return { items: [], seeds: 0, mood, mode };

  const taste = computeTasteVector();
  const domCrit = getDominantCriterion(taste);
  const antiSeeds = getAntiSeeds();
  const metaCache = readMetaCacheAll();

  const seedDetails = (await mapBatched(seeds, 8, async s => {
    try {
      const { meta, recs } = await fetchCompactMeta(s.type, s.id, true, metaCache);
      return { seed: s, meta, recs };
    } catch { return null; }
  })).filter(Boolean);

  const antiDetails = (await mapBatched(antiSeeds, 5, async s => {
    try {
      const { meta } = await fetchCompactMeta(s.type, s.id, false, metaCache);
      return { seed: s, meta };
    } catch { return null; }
  })).filter(Boolean);

  // Групування сідів тільки за колекцією або самим сідом (без мережі)
  const groups = new Map();
  const getGroup = (gKey) => {
    if (!groups.has(gKey)) groups.set(gKey, { directors: {}, cast: {}, genres: {}, keywords: {} });
    return groups.get(gKey);
  };
  const addGrp = (o, id, v) => {
    const e = o[id] || (o[id] = { sum: 0, max: 0 });
    e.sum += v;
    if (v > e.max) e.max = v;
  };
  const combGrp = e => e.max + 0.3 * (e.sum - e.max);

  const dirRes = {};
  const actorRes = {};
  const names = { directors: {}, cast: {} };

  for (const { seed, meta } of seedDetails) {
    let w = (seed.strength / 10) * seed.resFactor * seed.decayMult;
    if (domCrit) {
      const rr = seed.type === 'tv' ? averagedSeasonRatings(seed) : (seed.ratings || {});
      if ((rr[domCrit.key] || 0) >= 8) w *= 1.15;
    }

    const gKey = meta.colId ? 'col-' + meta.colId : 'seed-' + seed.key;
    const grp = getGroup(gKey);

    (meta.dirs || []).forEach(c => {
      names.directors[c.id] = c.name;
      addGrp(grp.directors, c.id, w * 2.2);
      if (!dirRes[c.id]) dirRes[c.id] = { sum: 0, n: 0 };
      dirRes[c.id].sum += seed.residual;
      dirRes[c.id].n += 1;
    });

    (meta.cast || []).forEach(c => {
      names.cast[c.id] = c.name;
      const adj = typeof getActorAdj === 'function' ? getActorAdj(c.id) : 0;
      const mult = Math.max(0.3, 1 + adj * 0.45);
      addGrp(grp.cast, c.id, w * 2.0 * (c.w || 1) * mult);
      if (!actorRes[c.id]) actorRes[c.id] = { sum: 0, n: 0 };
      actorRes[c.id].sum += seed.residual;
      actorRes[c.id].n += 1;
    });

    const gIds = (meta.genres && meta.genres.length) ? meta.genres : (seed.genres || []);
    gIds.forEach(gid => {
      addGrp(grp.genres, gid, w * 1.4);
    });

    (meta.kws || []).forEach(kid => {
      addGrp(grp.keywords, kid, w * 1.1);
    });
  }

  const signals = { directors: {}, cast: {}, genres: {}, keywords: {} };
  for (const grp of groups.values()) {
    for (const [id, e] of Object.entries(grp.directors)) signals.directors[id] = (signals.directors[id] || 0) + combGrp(e);
    for (const [id, e] of Object.entries(grp.cast)) signals.cast[id] = (signals.cast[id] || 0) + combGrp(e);
    for (const [id, e] of Object.entries(grp.genres)) signals.genres[id] = (signals.genres[id] || 0) + combGrp(e);
    for (const [id, e] of Object.entries(grp.keywords)) signals.keywords[id] = (signals.keywords[id] || 0) + combGrp(e);
  }

  // Згладжування за залишком: sum(residual) / (n + 3)
  for (const [id, stat] of Object.entries(dirRes)) {
    const smooth = stat.sum / (stat.n + 3);
    signals.directors[id] *= clampNum(1 + smooth / 2, 0.5, 1.6);
  }
  for (const [id, stat] of Object.entries(actorRes)) {
    const smooth = stat.sum / (stat.n + 3);
    signals.cast[id] *= clampNum(1 + smooth / 2, 0.5, 1.6);
  }

  // Профіль акторів (Б+В відносно G, без countMod і без подвійного обліку)
  const actorProfiles = typeof computeActorProfiles === 'function'
    ? computeActorProfiles()
    : { globalCastAvg: 7.2, actors: new Map() };
  const anti = { directors: {}, genres: {}, keywords: {}, cast: {} };

  for (const [aid, prof] of actorProfiles.actors.entries()) {
    if (prof.name && !names.cast[aid]) names.cast[aid] = prof.name;
    if (prof.isAnti) {
      if (signals.cast[aid]) signals.cast[aid] = 0;
      anti.cast[aid] = Math.min(1.4, Math.max(0.25, Math.abs(prof.recSignal) * 0.6));
    } else if (prof.ratedCount >= 1 && prof.recSignal > 0.25 && prof.shrunk >= actorProfiles.globalCastAvg) {
      const profBoost = Math.min(2.2, prof.recSignal * 0.95);
      signals.cast[aid] = Math.max(signals.cast[aid] || 0, profBoost);
    }
  }

  // Ручні оцінки акторів (🔥/😞) — без повторного множення поверх recSignal
  for (const [aidStr, adj] of Object.entries(actorAdjust || {})) {
    const aid = parseInt(aidStr);
    if (adj > 0) {
      signals.cast[aid] = Math.max(signals.cast[aid] || 0, adj * 0.85) + adj * 0.30;
      delete anti.cast[aid];
    } else if (adj < 0) {
      if (signals.cast[aid]) signals.cast[aid] = 0;
      anti.cast[aid] = Math.max(anti.cast[aid] || 0, Math.abs(adj) * 0.85);
    }
  }

  // Анти-сигнали (тільки dropped + ручне «не схоже» + сховані + анти-актори)
  for (const { seed, meta } of antiDetails) {
    const aw = seed.antiSeed ? 1.4 : 1.0;
    (meta.dirs || []).forEach(c => { anti.directors[c.id] = (anti.directors[c.id] || 0) + aw; });
    const gIds = (meta.genres && meta.genres.length) ? meta.genres : (seed.genres || []);
    gIds.forEach(gid => { anti.genres[gid] = (anti.genres[gid] || 0) + aw * 0.4; });
    (meta.kws || []).forEach(kid => { anti.keywords[kid] = (anti.keywords[kid] || 0) + aw; });
  }
  for (const d of Object.values(dismissedRecs || {})) {
    (d.genres || []).forEach(gid => { anti.genres[gid] = (anti.genres[gid] || 0) + 0.25; });
  }

  const moodData = mood && MOODS[mood] ? MOODS[mood] : null;
  const topKw = Object.entries(signals.keywords)
    .filter(([id]) => !anti.keywords[id])
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  const topGenres = Object.entries(signals.genres)
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => parseInt(id));
  const topCast = Object.entries(signals.cast)
    .filter(([id, sc]) => sc > 0 && !anti.cast[id])
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => parseInt(id));
  const topDirectors = Object.entries(signals.directors)
    .filter(([id]) => !anti.directors[id])
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => parseInt(id));

  const unique = new Map();
  const ensureCandidate = (raw, type) => {
    if (!raw || !raw.poster_path) return null;
    if (isExcludedShow(raw, type)) return null;
    const key = `${type}-${raw.id}`;
    const tracked = typeof isTrackedInLib === 'function' ? isTrackedInLib(key) : !!lib[key];
    if (tracked || (typeof isDismissed === 'function' && isDismissed(key))) return null;
    /* FIX-RELEASE-ENSURE — Level 1+2 pre-filter */
    const _today = new Date().toISOString().slice(0, 10);
    const _rel = (raw.release_date || raw.first_air_date || '').slice(0, 10);
    if (settings.digitalOnly && type === 'movie') {
      if (_rel && _rel > _today) return null;  // ще не вийшов — точно немає digital
    }
    if (settings.streamingOnlyUA) {
      if (_rel && _rel > _today) return null;  // streaming точно немає
    }
    let entry = unique.get(key);
    if (!entry) {
      const item = normalizeItem({ ...raw, media_type: type });
      entry = { ...item, _sourceRaw: 0, _eloHits: [], _reasons: [], _seenTags: new Set(), _meta: null };
      unique.set(key, entry);
    }
    return entry;
  };
  const addReason = (entry, tag, text, priority) => {
    if (!entry || entry._seenTags.has(tag)) return;
    entry._seenTags.add(tag);
    entry._reasons.push({ priority, text });
  };

  // Джерело 1: Прямі TMDB рекомендації від сідів
  for (const { seed, recs } of seedDetails) {
    const seedRatingLabel = seed.avg > 0 ? ` (${fmtNum(seed.avg)})` : (seed.isFav ? ' ❤️' : '');
    const boost = Math.min(2.2, (seed.strength / 10) * seed.resFactor * seed.decayMult);
    const seedEloNorm = (seed.eloGames || 0) > 0 ? clampNum((seed.elo - 1450) / 250, 0, 1) : 0;

    recs.forEach((r, idx) => {
      const t = r.media_type || seed.type;
      const entry = ensureCandidate(r, t);
      if (!entry) return;
      entry._sourceRaw += boost * (1 - idx * 0.045);
      if (seedEloNorm > 0) entry._eloHits.push(seedEloNorm);
      addReason(entry, 'seed-' + seed.key, `Як «${seed.title}»${seedRatingLabel}`, 10);
    });
  }

  // Джерело 2: Discover + Акторські/Режисерські запити
  const currentYear = new Date().getFullYear();
  const baseDiscover = (type) => {
    const p = new URLSearchParams({ language: 'uk-UA' });
    if (mode === 'gems') {
      p.set('sort_by', 'vote_average.desc');
      p.set('vote_count.gte', '60');
      p.set('vote_count.lte', '2200');
      p.set('vote_average.gte', '7.2');
    } else if (mode === 'fresh') {
      p.set('sort_by', 'popularity.desc');
      p.set('vote_count.gte', '40');
      p.set('vote_average.gte', '6.0');
      p.set(type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte', `${currentYear - 2}-01-01`);
    } else {
      p.set('sort_by', 'popularity.desc');
      p.set('vote_count.gte', '60');
      p.set('vote_average.gte', '5.8');
    }
    if (type === 'tv') p.set('without_genres', EXCLUDED_TV_GENRES.join(','));
    return p;
  };

  const fetchPromises = [];
  ['movie', 'tv'].forEach(type => {
    if (topKw.length || topGenres.length) {
      const p = baseDiscover(type);
      p.set('page', '1');
      if (topKw.length) p.set('with_keywords', topKw.join('|'));
      if (topGenres.length) p.set('with_genres', topGenres.slice(0, 3).join('|'));
      fetchPromises.push(tmdbFetch(`/discover/${type}?${p}`).then(d => ({ type, results: d.results || [], source: 'personalized' })).catch(() => ({ type, results: [], source: 'personalized' })));
    }
    if (topGenres.length) {
      const pg = baseDiscover(type);
      pg.set('page', '1');
      pg.set('with_genres', topGenres.slice(0, 3).join('|'));
      fetchPromises.push(tmdbFetch(`/discover/${type}?${pg}`).then(d => ({ type, results: d.results || [], source: 'genres' })).catch(() => ({ type, results: [], source: 'genres' })));
    }
    if (moodData) {
      const pm = baseDiscover(type);
      pm.set('page', '1');
      pm.set('with_genres', (type === 'tv' ? (moodData.tvGenres || moodData.genres) : moodData.genres).join('|'));
      fetchPromises.push(tmdbFetch(`/discover/${type}?${pm}`).then(d => ({ type, results: d.results || [], source: 'mood' })).catch(() => ({ type, results: [], source: 'mood' })));
    }
  });

  topCast.forEach(aid => {
    const p = baseDiscover('movie');
    p.set('with_cast', String(aid));
    p.set('page', '1');
    fetchPromises.push(
      tmdbFetch(`/discover/movie?${p}`)
        .then(d => ({ type: 'movie', results: (d.results || []).slice(0, 12), source: 'cast', actorId: aid }))
        .catch(() => ({ type: 'movie', results: [], source: 'cast' }))
    );
    fetchPromises.push(
      tmdbFetch(`/person/${aid}/tv_credits?language=uk-UA`)
        .then(d => {
          const castList = (d.cast || [])
            .filter(r => r.poster_path && (r.vote_count || 0) >= 40 && !(r.genre_ids || []).some(g => EXCLUDED_TV_GENRES.includes(g)))
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, 10);
          return { type: 'tv', results: castList, source: 'cast', actorId: aid };
        })
        .catch(() => ({ type: 'tv', results: [], source: 'cast' }))
    );
  });

  topDirectors.forEach(did => {
    const p = baseDiscover('movie');
    p.set('with_crew', String(did));
    p.set('page', '1');
    fetchPromises.push(
      tmdbFetch(`/discover/movie?${p}`)
        .then(d => ({ type: 'movie', results: (d.results || []).slice(0, 10), source: 'director', dirId: did }))
        .catch(() => ({ type: 'movie', results: [], source: 'director' }))
    );
  });

  const all = await Promise.all(fetchPromises);
  for (const batch of all) {
    for (const r of batch.results) {
      const entry = ensureCandidate(r, batch.type);
      if (!entry) continue;

      if (batch.source === 'mood') {
        /* FIX-MOOD-WEIGHT-SRC */
        const _mw = moodData.weight || 1.0;
        entry._sourceRaw += 2.0 * _mw; /* FIX-MOOD-AGGR-SRC */
        entry._moodMatch = _mw;
        addReason(entry, 'mood', `${moodData.emoji} ${moodData.label}`, 8);
      } else if (batch.source === 'director') {
        entry._sourceRaw += 0.9;
        const dName = names.directors[batch.dirId];
        addReason(entry, 'dir-' + batch.dirId, dName ? `Режисер: ${dName}` : 'Твій режисер', 9);
      } else if (batch.source === 'cast') {
        const adj = typeof getActorAdj === 'function' ? getActorAdj(batch.actorId) : 0;
        if (adj < 0 || anti.cast[batch.actorId]) continue;
        const prof = actorProfiles.actors.get(batch.actorId);
        const profBoost = prof && prof.recSignal > 0 ? Math.min(0.4, prof.recSignal * 0.16) : 0;
        entry._sourceRaw += 0.75 + profBoost;
        const aName = names.cast[batch.actorId];
        addReason(entry, 'cast-' + batch.actorId, aName ? `З ${aName}` : 'Актор з улюблених', 7);
      } else if (batch.source === 'personalized') {
        entry._sourceRaw += 0.9;
      } else if (batch.source === 'genres') {
        entry._sourceRaw += 0.45;
      }
    }
  }

  // Насичення жанрів (Lift)
  const poolGenreCounts = {};
  let totalPoolGenres = 0;
  for (const entry of unique.values()) {
    (entry.genres || []).forEach(gid => {
      poolGenreCounts[gid] = (poolGenreCounts[gid] || 0) + 1;
      totalPoolGenres++;
    });
  }
  const userGenreTotal = Object.values(signals.genres).reduce((a, b) => a + b, 0);
  const genreCountDistinct = Math.max(Object.keys(poolGenreCounts).length, 1);
  const genreLift = {};
  for (const gid of Object.keys(poolGenreCounts)) {
    const uShare = ((signals.genres[gid] || 0) + 0.5) / (userGenreTotal + 0.5 * genreCountDistinct);
    const pShare = (poolGenreCounts[gid] + 1) / (totalPoolGenres + genreCountDistinct);
    genreLift[gid] = uShare / pShare;
  }

  // Попередній фільтр по режиму + попередній скор для відбору топ-60 на credits/keywords
  const byType = { movie: [], tv: [] };
  for (const entry of unique.values()) {
    if (mode === 'gems' && (entry.votes > 2500 || entry.tmdbRating < 7.0)) continue;
    if (mode === 'fresh' && ((parseInt(entry.year) || 0) < currentYear - 2)) continue;

    let baseRaw = entry.tmdbRating / 10;
    if (mode === 'gems') baseRaw += clampNum((2500 - entry.votes) / 2500, 0, 0.3);
    else if (mode === 'fresh') baseRaw += clampNum(((parseInt(entry.year) || currentYear - 2) - (currentYear - 2)) * 0.15, 0, 0.3);
    else baseRaw += Math.min(entry.popularity / 250, 0.2);

    let liftSum = 0, liftCnt = 0;
    let bestGenreId = null, bestLift = 0;
    let antiGenre = 0;
    (entry.genres || []).forEach(gid => {
      const lf = genreLift[gid] || 1;
      if (signals.genres[gid] && lf > 1) {
        const boost = Math.min(lf - 1, 1.8);
        liftSum += boost;
        liftCnt++;
        if (lf > bestLift) { bestLift = lf; bestGenreId = gid; }
      }
      if (anti.genres[gid]) antiGenre += anti.genres[gid] * 0.12;
    });
    const genreMatch = liftCnt > 0 ? Math.min(1.4, (liftSum / liftCnt) * Math.sqrt(liftCnt)) : 0;

    entry._baseRaw = baseRaw;
    entry._genreMatch = genreMatch;
    entry._antiGenre = Math.min(0.3, antiGenre);
    entry._eloRaw = entry._eloHits.length
      ? entry._eloHits.reduce((a, b) => a + b, 0) / entry._eloHits.length
      : 0;
    entry._bestGenreId = bestGenreId;

    /* FIX-MOOD-WEIGHT-PRE — mood genre match + source bonus */
    let _moodBoost = 0;
    if (moodData) {
      const _mw2 = moodData.weight || 1.0;
      const _mg = entry.type === 'tv' ? (moodData.tvGenres || moodData.genres) : moodData.genres;
      const _hits = (entry.genres || []).filter(g => _mg.includes(g)).length;
      if (_hits > 0) _moodBoost += Math.min(0.18, _hits * 0.05) * _mw2; /* FIX-MOOD-AGGR-BOOST */
      if (entry._moodMatch) _moodBoost += 0.12 * (entry._moodMatch);
    }
    entry._moodBoost = _moodBoost;

    entry._preScore = entry._baseRaw * 0.35 + Math.min(entry._sourceRaw, 5) * 0.2 /* FIX-MOOD-AGGR-CAP */ + entry._genreMatch * 0.3 - entry._antiGenre + _moodBoost * 0.7; /* FIX-MOOD-AGGR-PRE */

    if (byType[entry.type]) byType[entry.type].push(entry);
  }

  // Топ-30 фільмів + Топ-30 серіалів (разом 60) -> дотягуємо credits + keywords з кешем
  const topMoviesForMeta = [...byType.movie].sort((a, b) => b._preScore - a._preScore).slice(0, 30);
  const topTvForMeta = [...byType.tv].sort((a, b) => b._preScore - a._preScore).slice(0, 30);
  const topCandidates = [...topMoviesForMeta, ...topTvForMeta];

  await mapBatched(topCandidates, 10, async entry => {
    try {
      const { meta } = await fetchCompactMeta(entry.type, entry.id, false, metaCache);
      entry._meta = meta;
    } catch {}
  });
  writeMetaCacheAll(metaCache);

  const todayStr = new Date().toISOString().slice(0, 10);
  const uid = (window.currentUser && window.currentUser.uid) ? window.currentUser.uid : 'guest';
  const rnd = seededRandom(`${uid}|${todayStr}|${state.home.refreshNonce || 0}`);

  const finalizeReasons = (entry) => {
    if (entry._bestGenreId && entry._reasons.length === 0) {
      const g = GENRES.find(x => x.id === entry._bestGenreId);
      if (g) addReason(entry, 'genre-' + g.id, `Твій жанр · ${g.name}`, 3);
    }
    if (domCrit && entry._reasons.length < 2 && ((entry._profileRaw || entry._genreMatch) >= 0.6)) {
      addReason(entry, 'dom-crit', `Під «${domCrit.label}»`, 2);
    }
    entry._reasons = entry._reasons
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 2)
      .map(x => x.text);
  };

  const finalizeType = (list) => {
    if (!list.length) return [];

    /* FIX-RELEASE-FINALIZE — post-filter on enriched (has _meta) */
    const _today = new Date().toISOString().slice(0, 10);
    const filtered = list.filter(x => {
      if (!x._meta) return true;  // без meta не можемо перевірити — пропускаємо
      if (settings.digitalOnly && x.type === 'movie') {
        if (x._meta.digitalDate && x._meta.digitalDate > _today) return false;
      }
      if (settings.streamingOnlyUA) {
        if (!x._meta.providersUA || x._meta.providersUA.length === 0) return false;
      }
      return true;
    });

    const enriched = filtered.filter(x => !!x._meta);
    const rest = filtered.filter(x => !x._meta); /* FIX-RELEASE-FINALIZE-REST */

    if (enriched.length) {
      for (const entry of enriched) {
        let actorMatch = 0;
        let directorMatch = 0;
        let kwMatch = 0;
        let antiDir = 0;
        let antiKw = 0;

        let bestActor = null, bestActorScore = 0;
        let antiCast = 0;
        (entry._meta.cast || []).forEach(c => {
          if (anti.cast[c.id]) {
            antiCast += anti.cast[c.id] * (c.w || 1) * 0.25;
            return;
          }
          const sig = signals.cast[c.id] || 0;
          if (sig > 0) {
            const prof = actorProfiles.actors.get(c.id);
            const leadBoost = prof && prof.shrunk >= actorProfiles.globalCastAvg + 0.5 && (c.w || 0) >= 0.5 ? 1.12 : 1.0;
            const sc = sig * (c.w || 1) * 0.25 * leadBoost;
            actorMatch += sc;
            if (sc > bestActorScore) { bestActorScore = sc; bestActor = c; }
          }
        });
        actorMatch = Math.min(0.80, actorMatch);
        if (bestActor && bestActorScore >= 0.20) {
          addReason(entry, 'cast-' + bestActor.id, `З ${bestActor.name}`, 7);
        }

        let bestDir = null, bestDirScore = 0;
        (entry._meta.dirs || []).forEach(d => {
          const sig = signals.directors[d.id] || 0;
          if (sig > 0) {
            const sc = sig * 0.4;
            directorMatch += sc;
            if (sc > bestDirScore) { bestDirScore = sc; bestDir = d; }
          }
          if (anti.directors[d.id]) antiDir += anti.directors[d.id] * 0.22;
        });
        directorMatch = Math.min(0.8, directorMatch);
        if (bestDir && bestDirScore >= 0.3) {
          addReason(entry, 'dir-' + bestDir.id, `Режисер: ${bestDir.name}`, 9);
        }

        (entry._meta.kws || []).forEach(kid => {
          if (signals.keywords[kid]) kwMatch += signals.keywords[kid] * 0.12;
          if (anti.keywords[kid]) antiKw += anti.keywords[kid] * 0.12;
        });
        kwMatch = Math.min(0.6, kwMatch);

        entry._profileRaw = entry._genreMatch + actorMatch + directorMatch + kwMatch;
        entry._antiPenalty = entry._antiGenre + Math.min(0.4, antiDir) + Math.min(0.35, antiKw) + Math.min(0.35, antiCast);
        finalizeReasons(entry);
      }

      const baseNorm = minMaxNorm(enriched.map(x => x._baseRaw));
      const sourceNorm = minMaxNorm(enriched.map(x => Math.min(x._sourceRaw, 3)));
      const profileNorm = minMaxNorm(enriched.map(x => x._profileRaw));
      const eloNorm = minMaxNorm(enriched.map(x => x._eloRaw));

      enriched.forEach((entry, i) => {
        const total = 0.35 * baseNorm[i] + 0.30 * sourceNorm[i] + 0.25 * profileNorm[i] + 0.10 * eloNorm[i] - entry._antiPenalty;
        entry._score = total;
        /* FIX-MOOD-WEIGHT-ENR */
        entry._sortScore = total + Math.min(0.40, entry._moodBoost || 0) + (rnd() - 0.5) * 0.08; /* FIX-MOOD-AGGR-SORT */
        /* FIX-RELEASE-COPY-META — copy before delete for poster badges */
        entry.digitalReleaseDate = (entry._meta && entry._meta.digitalDate) || null;
        entry.streamingUA = (entry._meta && entry._meta.providersUA) || [];
        delete entry._seenTags;
        delete entry._meta;
        delete entry._moodBoost;
      });

      enriched.sort((a, b) => b._sortScore - a._sortScore);

      // Diversity: м'яке обмеження засилля однієї франшизи, режисера або головного актора
      const colSeen = {};
      const dirSeen = {};
      const leadSeen = {};
      enriched.forEach(entry => {
        const mc = metaCache[entry.key];
        if (!mc) return;
        let colPen = 0, dirPen = 0, leadPen = 0;
        if (mc.colId) {
          colSeen[mc.colId] = (colSeen[mc.colId] || 0) + 1;
          if (colSeen[mc.colId] > 2) colPen = Math.min(0.24, 0.08 * (colSeen[mc.colId] - 2));
        }
        const dirId = mc.dirs?.[0]?.id;
        if (dirId) {
          dirSeen[dirId] = (dirSeen[dirId] || 0) + 1;
          if (dirSeen[dirId] > 2) dirPen = Math.min(0.18, 0.06 * (dirSeen[dirId] - 2));
        }
        const leadId = mc.cast?.[0]?.id;
        if (leadId) {
          leadSeen[leadId] = (leadSeen[leadId] || 0) + 1;
          if (leadSeen[leadId] > 2) leadPen = Math.min(0.15, 0.05 * (leadSeen[leadId] - 2));
        }
        const divPen = Math.min(0.28, Math.max(colPen, dirPen + leadPen)); /* FIX-MOOD-AGGR-DIV */
        if (divPen > 0) entry._sortScore -= divPen;
      });
      enriched.sort((a, b) => b._sortScore - a._sortScore);
    }

    for (const entry of rest) {
      finalizeReasons(entry);
      /* FIX-MOOD-WEIGHT-REST */
      entry._sortScore = entry._preScore + Math.min(0.40, (entry._moodBoost || 0) * 0.5); /* FIX-MOOD-AGGR-REST */
      delete entry._seenTags;
      delete entry._meta;
      delete entry._moodBoost;
    }
    rest.sort((a, b) => b._preScore - a._preScore);

    return [...enriched, ...rest].slice(0, 80);
  };

  return {
    items: [...finalizeType(byType.movie), ...finalizeType(byType.tv)],
    seeds: seeds.length,
    mood,
    mode
  };
}

function readGeneralCache() {
  try {
    const c = JSON.parse(localStorage.getItem(GEN_CACHE));
    if (!c || !c.data) return null;
    if (Date.now() - c.ts < GEN_TTL) return c.data;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return c.data;
  } catch {}
  return null;
}
function writeGeneralCache(g) {
  try {
    if (!g) return;
    const hasMovies = (g.trMovies && g.trMovies.length) || (g.newMovies && g.newMovies.length) || (g.topMovies && g.topMovies.length);
    const hasTv = Array.isArray(g.tvStreams) && g.tvStreams.some(st => (st.pop && st.pop.length) || (st.fresh && st.fresh.length));
    if (!hasMovies && !hasTv) return;
    localStorage.setItem(GEN_CACHE, JSON.stringify({ ts: Date.now(), data: g }));
  } catch {}
}
/* FIX-RECS-CACHE-V3 */
function readRecsCache(sig, critical) {
  try {
    const c = JSON.parse(localStorage.getItem(RECS_CACHE));
    if (!c) return null;
    const age = Date.now() - c.ts;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false; /* offline-recs-ttl-bypass */
    if (age >= RECS_TTL && !offline) return null;
    if (critical && c.critical !== critical) return null;
    if (c.sig === sig || offline) {
      if (c.data && Array.isArray(c.data.items)) {
        c.data = { ...c.data, items: c.data.items.filter(x => x && !(typeof isTrackedInLib === 'function' ? isTrackedInLib(x.key) : !!lib[x.key])) };
      }
      return c.data;
    }
  } catch {}
  return null;
}
function writeRecsCache(sig, critical, data) { try { localStorage.setItem(RECS_CACHE, JSON.stringify({ sig, critical, ts: Date.now(), data })); } catch {} } /* FIX-RECS-CACHE-V2 */

// ============ TASTE DNA (SVG & UI) ============
function tasteRadarSVG(taste, size = 240) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 42;
  const n = RATING_CRITERIA.length;
  const pts = RATING_CRITERIA.map((c, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI / n);
    const v = (taste[c.key] || 0) / 10;
    return { x: cx + r * v * Math.cos(angle), y: cy + r * v * Math.sin(angle), ax: cx + r * Math.cos(angle), ay: cy + r * Math.sin(angle), lx: cx + (r + 22) * Math.cos(angle), ly: cy + (r + 22) * Math.sin(angle), label: c.label.split(' ')[0] };
  });
  const grid = [1, 2, 3, 4].map(level => {
    const lr = r * level / 4;
    const gpts = RATING_CRITERIA.map((c, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return `${cx + lr * Math.cos(a)},${cy + lr * Math.sin(a)}`; }).join(' ');
    return `<polygon points="${gpts}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  }).join('');
  const axes = pts.map(p => `<line x1="${cx}" y1="${cy}" x2="${p.ax}" y2="${p.ay}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`).join('');
  const labels = pts.map(p => `<text x="${p.lx}" y="${p.ly}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="9.5" font-family="system-ui">${p.label}</text>`).join('');
  const poly = pts.map(p => `${p.x},${p.y}`).join(' ');
  const dots = pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="var(--accent)"/>`).join('');
  return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:${size}px;display:block">${grid}${axes}<polygon points="${poly}" fill="rgba(var(--accent-rgb),0.18)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

function renderTasteInsight(taste) {
  if (!taste || taste.count < 3) return null;
  const vals = RATING_CRITERIA.map(c => ({ key: c.key, label: c.label, v: taste[c.key] }));
  const sorted = [...vals].sort((a, b) => b.v - a.v);
  const top = sorted[0], bottom = sorted[sorted.length - 1];
  const gap = top.v - bottom.v;
  let desc;
  if (gap < 0.8) desc = `Ти — <em>збалансований глядач</em>. Усі критерії для тебе однаково важливі.`;
  else if (top.key === 'plot') desc = `Ти — <em>наративний глядач</em>. Історія та сюжет для тебе важливіші за форму.`;
  else if (top.key === 'cast') desc = `Ти — <em>персонажний глядач</em>. Ти цінуєш акторів і хімію між ними.`;
  else if (top.key === 'style') desc = `Ти — <em>візуальний глядач</em>. Картинка, атмосфера й стиль для тебе критичні.`;
  else if (top.key === 'emotions') desc = `Ти — <em>емоційний глядач</em>. Головне — що ти відчуваєш під час перегляду.`;
  else if (top.key === 'overall') desc = `Ти — <em>інтуїтивний глядач</em>. Довіряєш загальному враженню більше за деталі.`;
  else desc = `Твій найсильніший критерій — <em>${top.label}</em>.`;
  return { top, bottom, desc };
}

function buildTasteCard(taste) {
  const card = el('div', 'taste-card');
  const header = el('div', 'taste-card-header');
  header.append(el('div', 'taste-card-title', 'Taste DNA'));
  header.append(el('div', 'taste-card-meta', 'піврозпад · 180 днів'));
  card.append(header);

  const body = el('div', 'taste-body');
  const radarWrap = el('div', 'taste-radar-wrap');
  radarWrap.innerHTML = tasteRadarSVG(taste);
  body.append(radarWrap);

  const rows = el('div', 'taste-rows');
  for (const crit of RATING_CRITERIA) {
    const v = taste[crit.key] || 0;
    const row = el('div', 'taste-row');
    const lbl = el('div', 'taste-row-label');
    lbl.append(el('span', '', crit.label));
    lbl.append(el('span', 'taste-row-val', fmtNum(v)));
    row.append(lbl);
    const bar = el('div', 'taste-row-bar');
    const fill = el('i'); fill.style.width = (v / 10 * 100) + '%';
    bar.append(fill);
    row.append(bar);
    rows.append(row);
  }
  body.append(rows);
  card.append(body);

  const insight = renderTasteInsight(taste);
  if (insight) {
    const ins = el('div', 'taste-insight');
    ins.innerHTML = insight.desc;
    card.append(ins);
  }
  return card;
}

// ============ TEMPERATURE AVATAR (Last 10 rated projects + Mood) ============
const AVATAR_MOOD_RULES = {
  fun:        { label: 'Розвага', weights: { 35: 1.0, 12: 0.9, 16: 0.85, 10751: 0.9, 10762: 0.8 } },
  intense:    { label: 'Напруга', weights: { 53: 1.1, 28: 0.95, 80: 0.9, 10768: 1.0, 9648: 0.7 } },
  dark:       { label: 'Похмуре', weights: { 27: 1.35, 80: 0.95, 53: 0.85 } },
  epic:       { label: 'Епічне',  weights: { 878: 1.15, 14: 1.1, 10765: 1.15, 10752: 1.05, 36: 0.8 } },
  chill:      { label: 'Спокій',  weights: { 10749: 1.2, 10402: 1.1, 35: 0.75, 16: 0.75 } },
  thoughtful: { label: 'Роздуми', weights: { 99: 1.35, 18: 0.58, 9648: 0.85 } }
};

/* AVATAR-V2-BASELINE */
function getLastRatedProjects(limit) {
  const entries = [];
  Object.values(lib).forEach(item => {
    if (!item || !item.key) return;
    const isEloUntracked = (item.eloUpdated && item.updated === item.eloUpdated) || (item.eloGames > 0 && !item.ratingUpdated);
    const safeBaseTs = isEloUntracked ? (item.createdAt || item.updated || 0) : (item.updated || item.createdAt || 0);
    if (item.type === 'movie') {
      const avg = computeAverage(item.ratings);
      if (avg > 0) {
        entries.push({
          key: item.key,
          item,
          title: item.title || '',
          avg,
          genres: item.genres || [],
          ts: item.ratingUpdated || safeBaseTs
        });
      }
    } else if (item.type === 'tv') {
      const sr = item.seasonRatings || {};
      const srTs = item.seasonRatingTs || {};
      Object.entries(sr).forEach(([sNum, ratings]) => {
        const avg = computeAverage(ratings);
        if (avg > 0) {
          const tvBase = (item.eloUpdated && item.updated === item.eloUpdated) || (item.eloGames > 0 && !srTs[sNum])
            ? (item.createdAt || item.updated || 0)
            : (item.updated || item.createdAt || 0);
          entries.push({
            key: `${item.key}-s${sNum}`,
            item,
            title: `${item.title} (С${sNum})`,
            avg,
            genres: item.genres || [],
            ts: srTs[sNum] || (tvBase + Number(sNum))
          });
        }
      });
    }
  });
  entries.sort((a, b) => b.ts - a.ts);
  return (limit && limit > 0) ? entries.slice(0, limit) : entries;
}

function computeTempAvatarData() {
  const all = getLastRatedProjects(0);
  if (!all.length) {
    return { empty: true, count: 0, avg: 0, baseline: 0, delta: 0, hasPureHistory: false, tempLevel: 'mild', mood: 'thoughtful', title: 'Ще спить', subtitle: 'Оціни хоча б пару фільмів або сезонів', projects: [] };
  }

  const projects = all.slice(0, 10);
  const history = all.slice(10);
  const avg = projects.reduce((s, p) => s + p.avg, 0) / projects.length;

  // Базове середнє = усі оцінки ДО останніх 10 проєктів (щоб останні 10 не зсували власну базу)
  const fallbackBase = 7.2;
  let baseline = fallbackBase;
  const hasPureHistory = history.length >= 3;
  if (hasPureHistory) {
    baseline = history.reduce((s, p) => s + p.avg, 0) / history.length;
  } else if (history.length > 0) {
    const hSum = history.reduce((s, p) => s + p.avg, 0);
    baseline = (hSum + (3 - history.length) * fallbackBase) / 3;
  }

  const delta = avg - baseline;
  // Пороги: > +0.6 золото (hot) | ±0.6 стабільний кайф (warm) | -0.6..-1.8 прохолодно (mild) | < -1.8 розчарування (cold)
  const tempLevel = delta > 0.6 ? 'hot' : (delta >= -0.6 ? 'warm' : (delta >= -1.8 ? 'mild' : 'cold'));

  const moodScores = {};
  for (const k of Object.keys(AVATAR_MOOD_RULES)) moodScores[k] = 0;

  projects.forEach((p, idx) => {
    const recencyW = 1 - idx * 0.05;
    const enjoymentW = delta >= -1.8 ? Math.max(0.35, (p.avg - 3.5) / 6.5) : 1.0;
    const w = recencyW * enjoymentW;
    for (const [mKey, rule] of Object.entries(AVATAR_MOOD_RULES)) {
      let bestG = 0;
      (p.genres || []).forEach(gid => {
        if (rule.weights[gid] && rule.weights[gid] > bestG) bestG = rule.weights[gid];
      });
      if (bestG > 0) moodScores[mKey] += w * bestG;
    }
  });

  const sortedMoods = Object.entries(moodScores).sort((a, b) => b[1] - a[1]);
  const mood = sortedMoods[0][1] > 0 ? sortedMoods[0][0] : 'thoughtful';

  const PERSONA = {
    fun: {
      hot:  ['Золотий фан', 'Останні комедії й пригоди перевершили навіть твою високу планку'],
      warm: ['Стабільний позитив', 'Легкі тайтли тримають настрій рівно у твоєму тонусі'],
      mild: ['Усмішка без захвату', 'Розважальне кіно трохи не дотягує до твоєї бази'],
      cold: ['Жарти не зайшли', 'Останні комедії чи пригоди відчутно нижче твого смаку']
    },
    intense: {
      hot:  ['Драйв на максимумі', 'Напружені трилери й екшен зайшли помітно вище середнього'],
      warm: ['Стабільний адреналін', 'Гострі сюжети впевнено тримають твій звичний рівень'],
      mild: ['Стриманий пульс', 'Екшен дивився без звичного азарту — оцінки трохи просіли'],
      cold: ['Холодний скептик', 'Останні трилери й бойовики не зачепили й розчарували']
    },
    dark: {
      hot:  ['Похмурий шедевр', 'Темна атмосфера й жорсткі історії влучили краще за все'],
      warm: ['Нуарний кайф', 'Похмурі стрічки стабільно тримають твій улюблений рівень'],
      mild: ['Сірі сутінки', 'Темного вистачило, але без вау-ефекту'],
      cold: ['Передоз мороку', 'Похмурі новинки пішли в мінус проти твоєї бази']
    },
    epic: {
      hot:  ['Золотий космос', 'Фантастика, масштаб і епік зараз на твоєму піку'],
      warm: ['На стабільній орбіті', 'Великі світи й пригоди стабільно тримають планку'],
      mild: ['Півкроку до масштабу', 'Спецефекти норм, але очікував більшого'],
      cold: ['Пафос не спрацював', 'Гучний масштаб не врятував від низьких оцінок']
    },
    chill: {
      hot:  ['Золотий дзен', 'Теплі й атмосферні історії подарували справжнє задоволення'],
      warm: ['Затишний кайф', 'Рівний, приємний ритм переглядів на твоєму рівні'],
      mild: ['Легка втома', 'Спокійне кіно трохи пішло в мінус — хочеться чогось свіжого'],
      cold: ['Заснув на титрах', 'Останній чіл виявився надто прісним для тебе']
    },
    thoughtful: {
      hot:  ['Естетичний захват', 'Глибокі драми й сенси влучили вище твоєї планки'],
      warm: ['Вдумливий баланс', 'Сильні історії стабільно підтримують твій рівень'],
      mild: ['Аналітичний скепсис', 'Цікаві задумом, але оцінки трохи нижчі за твою базу'],
      cold: ['Суворий критик', 'Останні драми не переконали — планка впала вниз']
    }
  };

  const [title, subtitle] = PERSONA[mood]?.[tempLevel] || ['Кіно-настрій', ''];
  return { empty: false, count: projects.length, historyCount: history.length, hasPureHistory, avg, baseline, delta, tempLevel, mood, moodLabel: AVATAR_MOOD_RULES[mood].label, title, subtitle, projects };
}

function buildTempAvatarSVG(data, size = 68) {
  const palettes = {
    hot:  { bg1: '#ffd166', bg2: '#ff7b5c', stroke: '#fff3c4', glow: 'rgba(255,209,102,0.52)' },
    warm: { bg1: '#ffb86c', bg2: '#9de5c3', stroke: '#f2eee9', glow: 'rgba(255,184,108,0.28)' },
    mild: { bg1: '#c5a3ff', bg2: '#6b6485', stroke: '#e5dcff', glow: 'rgba(197,163,255,0.20)' },
    cold: { bg1: '#60a5fa', bg2: '#334155', stroke: '#bfdbfe', glow: 'rgba(96,165,250,0.34)' }
  };
  const pal = palettes[data.tempLevel || 'mild'];
  const uid = 'ta' + Math.random().toString(36).slice(2, 7);
  const ink = data.tempLevel === 'cold' ? '#0f172a' : (data.mood === 'dark' ? '#140f1d' : '#1a1207');
  const lvl = data.tempLevel;

  let eyes = '';
  let mouth = '';
  let extra = '';

  if (data.empty) {
    eyes = `<path d="M22 31 Q26 34 30 31 M42 31 Q46 34 50 31" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    mouth = `<line x1="31" y1="46" x2="41" y2="46" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`;
  } else if (data.mood === 'fun') {
    if (lvl === 'hot') {
      eyes = `<path d="M20 34 Q26 25 32 34 M40 34 Q46 25 52 34" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M22 40 Q36 56 50 40 Z" fill="${ink}"/>`;
      extra = `<circle cx="18" cy="40" r="3.6" fill="#ff5c5c" opacity="0.55"/><circle cx="54" cy="40" r="3.6" fill="#ff5c5c" opacity="0.55"/><circle cx="56" cy="16" r="2.2" fill="#fff" opacity="0.9"/>`;
    } else if (lvl === 'warm') {
      eyes = `<circle cx="26" cy="32" r="3.4" fill="${ink}"/><circle cx="46" cy="32" r="3.4" fill="${ink}"/><circle cx="27" cy="30.8" r="1.1" fill="#fff"/><circle cx="47" cy="30.8" r="1.1" fill="#fff"/>`;
      mouth = `<path d="M25 42 Q36 51 47 42" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
      extra = `<circle cx="19" cy="40" r="3.2" fill="#ff7b5c" opacity="0.4"/>`;
    } else if (lvl === 'mild') {
      eyes = `<circle cx="28" cy="33" r="2.9" fill="${ink}"/><circle cx="48" cy="33" r="2.9" fill="${ink}"/><path d="M21 27 Q26 25 31 27" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M27 45 Q36 47 45 43" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    } else {
      eyes = `<path d="M21 29 L30 32 M51 29 L42 32" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><circle cx="26" cy="35" r="2.7" fill="${ink}"/><circle cx="46" cy="35" r="2.7" fill="${ink}"/>`;
      mouth = `<path d="M27 49 Q36 42 45 49" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<circle cx="19" cy="41" r="2.8" fill="#93c5fd" opacity="0.45"/><path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.8"/>`;
    }
  } else if (data.mood === 'intense') {
    if (lvl === 'hot') {
      eyes = `<rect x="17" y="27" width="16" height="10" rx="3" fill="${ink}"/><rect x="39" y="27" width="16" height="10" rx="3" fill="${ink}"/><line x1="33" y1="31" x2="39" y2="31" stroke="${ink}" stroke-width="2.6"/>`;
      mouth = `<path d="M25 44 Q37 53 49 41" stroke="${ink}" stroke-width="2.9" fill="none" stroke-linecap="round"/>`;
      extra = `<polygon points="57,10 51,21 56,21 53,30 62,18 57,18" fill="#fff3c4" opacity="0.95"/>`;
    } else if (lvl === 'warm') {
      eyes = `<rect x="18" y="28" width="15" height="9" rx="3" fill="${ink}"/><rect x="39" y="28" width="15" height="9" rx="3" fill="${ink}"/><line x1="33" y1="31" x2="39" y2="31" stroke="${ink}" stroke-width="2.4"/>`;
      mouth = `<path d="M27 45 Q37 49 46 43" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<polygon points="56,12 52,20 56,20 54,26 60,18 56,18" fill="#fef3c7" opacity="0.75"/>`;
    } else if (lvl === 'mild') {
      eyes = `<rect x="18" y="29" width="15" height="7" rx="2" fill="rgba(26,18,7,0.22)" stroke="${ink}" stroke-width="2"/><rect x="39" y="29" width="15" height="7" rx="2" fill="rgba(26,18,7,0.22)" stroke="${ink}" stroke-width="2"/><line x1="33" y1="32" x2="39" y2="32" stroke="${ink}" stroke-width="2"/><circle cx="26" cy="32.5" r="2" fill="${ink}"/><circle cx="46" cy="32.5" r="2" fill="${ink}"/>`;
      mouth = `<line x1="28" y1="46" x2="44" y2="45" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`;
    } else {
      eyes = `<g transform="rotate(-6 36 33)"><rect x="18" y="29" width="15" height="8" rx="2" fill="${ink}"/><rect x="39" y="29" width="15" height="8" rx="2" fill="${ink}"/><line x1="33" y1="32" x2="39" y2="32" stroke="${ink}" stroke-width="2.2"/></g><path d="M21 25 L30 27 M51 25 L42 27" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`;
      mouth = `<path d="M27 48 Q36 43 45 48" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.8"/>`;
    }
  } else if (data.mood === 'dark') {
    if (lvl === 'hot') {
      eyes = `<path d="M20 30 L31 33 M52 30 L41 33" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><circle cx="26" cy="34.5" r="2.9" fill="${ink}"/><circle cx="46" cy="34.5" r="2.9" fill="${ink}"/>`;
      mouth = `<path d="M25 45 Q37 51 48 42" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M55 11 A6.5 6.5 0 1 0 62 20 A4.8 4.8 0 1 1 55 11 Z" fill="#fff3c4" opacity="0.92"/>`;
    } else if (lvl === 'warm') {
      eyes = `<path d="M21 31 L30 33 M51 31 L42 33" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/><circle cx="26" cy="35" r="2.7" fill="${ink}"/><circle cx="46" cy="35" r="2.7" fill="${ink}"/>`;
      mouth = `<path d="M27 45 Q36 49 46 44" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M55 12 A5.5 5.5 0 1 0 61 19 A4.2 4.2 0 1 1 55 12 Z" fill="#fef3c7" opacity="0.72"/>`;
    } else if (lvl === 'mild') {
      eyes = `<line x1="21" y1="32" x2="31" y2="32" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><line x1="41" y1="32" x2="51" y2="32" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><circle cx="26" cy="35" r="2.3" fill="${ink}"/><circle cx="46" cy="35" r="2.3" fill="${ink}"/>`;
      mouth = `<line x1="29" y1="46" x2="43" y2="46" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`;
      extra = `<path d="M55 13 A5 5 0 1 0 60 19 A3.8 3.8 0 1 1 55 13 Z" fill="#e5dcff" opacity="0.5"/>`;
    } else {
      eyes = `<path d="M21 28 L31 32 M51 28 L41 32" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><circle cx="26" cy="35" r="2.8" fill="${ink}"/><circle cx="46" cy="35" r="2.8" fill="${ink}"/><path d="M22 39 Q26 41 30 39 M42 39 Q46 41 50 39" stroke="${ink}" stroke-width="1.4" fill="none" opacity="0.55"/>`;
      mouth = `<path d="M27 49 Q36 44 45 49" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.75"/>`;
    }
  } else if (data.mood === 'thoughtful') {
    const glasses = `<circle cx="26" cy="33" r="6.5" fill="none" stroke="${ink}" stroke-width="2.2"/><circle cx="46" cy="33" r="6.5" fill="none" stroke="${ink}" stroke-width="2.2"/><line x1="32.5" y1="33" x2="39.5" y2="33" stroke="${ink}" stroke-width="2.2"/>`;
    if (lvl === 'hot') {
      eyes = glasses + `<circle cx="26" cy="33" r="2.6" fill="${ink}"/><circle cx="46" cy="33" r="2.6" fill="${ink}"/><circle cx="23" cy="30" r="1.2" fill="#fff" opacity="0.85"/>`;
      mouth = `<path d="M25 44 Q36 53 47 44" stroke="${ink}" stroke-width="2.7" fill="none" stroke-linecap="round"/>`;
    } else if (lvl === 'warm') {
      eyes = glasses + `<circle cx="26" cy="33" r="2.4" fill="${ink}"/><circle cx="46" cy="33" r="2.4" fill="${ink}"/>`;
      mouth = `<path d="M27 45 Q36 50 45 45" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    } else if (lvl === 'mild') {
      eyes = glasses + `<circle cx="26" cy="33" r="2.3" fill="${ink}"/><circle cx="46" cy="33" r="2.3" fill="${ink}"/><path d="M20 24 Q26 21 31 24" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      mouth = `<line x1="29" y1="46" x2="43" y2="46" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`;
    } else {
      eyes = glasses + `<path d="M20 24 L30 27 M52 24 L42 27" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><circle cx="26" cy="34" r="2.3" fill="${ink}"/><circle cx="46" cy="34" r="2.3" fill="${ink}"/>`;
      mouth = `<path d="M28 49 Q36 44 44 49" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.75"/>`;
    }
  } else if (data.mood === 'chill') {
    if (lvl === 'hot') {
      eyes = `<path d="M20 34 Q26 27 32 34 M40 34 Q46 27 52 34" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M26 43 Q36 52 46 43" stroke="${ink}" stroke-width="2.7" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M14 55 Q20 52 26 55 M46 55 Q52 52 58 55" stroke="#fff" stroke-width="2" fill="none" opacity="0.65" stroke-linecap="round"/>`;
    } else if (lvl === 'warm') {
      eyes = `<path d="M21 34 Q26 30 31 34 M41 34 Q46 30 51 34" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M28 44 Q36 49 44 44" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M14 55 Q20 52 26 55" stroke="#fff" stroke-width="2" fill="none" opacity="0.45" stroke-linecap="round"/>`;
    } else if (lvl === 'mild') {
      eyes = `<line x1="21" y1="33" x2="31" y2="33" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><line x1="41" y1="33" x2="51" y2="33" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`;
      mouth = `<path d="M30 45 Q36 47 42 45" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    } else {
      eyes = `<path d="M21 29 L30 32 M51 29 L42 32" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><line x1="22" y1="35" x2="30" y2="35" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><line x1="42" y1="35" x2="50" y2="35" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
      mouth = `<circle cx="36" cy="46" r="3.6" fill="none" stroke="${ink}" stroke-width="2.5"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.8"/>`;
    }
  } else {
    // epic
    if (lvl === 'hot') {
      eyes = `<polygon points="26,26 28,31.5 34,31.5 29.5,35 31,40.5 26,37 21,40.5 22.5,35 18,31.5 24,31.5" fill="${ink}"/><polygon points="46,26 48,31.5 54,31.5 49.5,35 51,40.5 46,37 41,40.5 42.5,35 38,31.5 44,31.5" fill="${ink}"/>`;
      mouth = `<path d="M24 43 Q36 54 48 43" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
      extra = `<circle cx="14" cy="17" r="2.6" fill="#fff" opacity="0.9"/><circle cx="58" cy="15" r="2.2" fill="#fff" opacity="0.9"/>`;
    } else if (lvl === 'warm') {
      eyes = `<circle cx="26" cy="33" r="3.3" fill="${ink}"/><circle cx="46" cy="33" r="3.3" fill="${ink}"/><polygon points="26,29 27,32 30,33 27,34 26,37 25,34 22,33 25,32" fill="#fff" opacity="0.65"/>`;
      mouth = `<path d="M26 43 Q36 51 46 43" stroke="${ink}" stroke-width="2.7" fill="none" stroke-linecap="round"/>`;
      extra = `<circle cx="57" cy="17" r="2" fill="#fff" opacity="0.75"/>`;
    } else if (lvl === 'mild') {
      eyes = `<circle cx="26" cy="33" r="2.9" fill="${ink}"/><circle cx="46" cy="33" r="2.9" fill="${ink}"/>`;
      mouth = `<path d="M28 45 Q36 47 44 45" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
      extra = `<polygon points="56,14 57.5,17.5 61,18 58.2,20.2 59,23.5 56,21.5 53,23.5 53.8,20.2 51,18 54.5,17.5" fill="#e5dcff" opacity="0.7"/>`;
    } else {
      eyes = `<path d="M22 31 L30 36 M30 31 L22 36 M42 31 L50 36 M50 31 L42 36" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/>`;
      mouth = `<path d="M27 48 Q36 43 45 48" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.75"/>`;
    }
  }

  return `<svg viewBox="0 0 72 72" width="${size}" height="${size}" style="display:block;flex-shrink:0;filter:drop-shadow(0 4px 12px ${pal.glow})">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${pal.bg1}"/><stop offset="100%" stop-color="${pal.bg2}"/></linearGradient></defs>
    <circle cx="36" cy="36" r="30" fill="url(#${uid})" stroke="${pal.stroke}" stroke-opacity="0.45" stroke-width="2"/>
    ${eyes}${mouth}${extra}
  </svg>`;
}

function buildTempAvatarCard(data) {
  const card = el('div', 'temp-avatar-card');
  const top = el('div', 'temp-avatar-top');
  const face = el('div', 'temp-avatar-face');
  face.innerHTML = buildTempAvatarSVG(data, 64);
  top.append(face);

  const info = el('div', 'temp-avatar-info');
  const head = el('div', 'temp-avatar-head');
  head.append(el('span', 'temp-avatar-title', data.title));
  if (!data.empty) {
    const sign = data.delta >= 0 ? '+' : '−';
    const dStr = `${sign}${fmtNum(Math.abs(data.delta))}`;
    head.append(el('span', 'temp-avatar-badge ' + data.tempLevel, `${fmtNum(data.avg)}/10 (${dStr}) · ${data.moodLabel}`));
  }
  info.append(head);
  info.append(el('div', 'temp-avatar-sub', data.subtitle));
  const metaText = data.empty
    ? 'Потрібно мінімум 1 оцінка'
    : (data.hasPureHistory
        ? `База ${fmtNum(data.baseline)} (до останніх 10) · останні ${data.count} проєктів`
        : `База ${fmtNum(data.baseline)} · останні ${data.count} проєктів (фільми + сезони)`);
  info.append(el('div', 'temp-avatar-meta', metaText));
  top.append(info);
  card.append(top);

  if (data.projects && data.projects.length) {
    const chips = el('div', 'temp-avatar-chips');
    data.projects.forEach(p => {
      const chip = el('button', 'temp-proj-chip');
      chip.type = 'button';
      chip.textContent = `${p.title} · ${fmtNum(p.avg)}`;
      chip.addEventListener('click', () => openCard(p.item));
      chips.append(chip);
    });
    card.append(chips);
  }
  return card;
}

function renderTasteSummary(taste) {
  const container = el('div', 'taste-summary-container' + (state.home.tasteExpanded ? ' is-expanded' : ''));
  const hasTaste = taste && taste.count >= 3;
  const avatarData = computeTempAvatarData();

  let summaryVal = '—';
  if (hasTaste) {
    const vals = RATING_CRITERIA.map(c => taste[c.key] || 0).filter(v => v > 0);
    if (vals.length) summaryVal = fmtNum(vals.reduce((a, b) => a + b, 0) / vals.length) + '/10';
  }

  const btn = el('button', 'taste-summary');
  const iconWrap = el('span', 'taste-summary-avatar');
  iconWrap.innerHTML = buildTempAvatarSVG(avatarData, 32);
  btn.append(iconWrap);
  const labelText = avatarData.empty ? 'Твій смак у цифрах' : `Твій смак · ${avatarData.title}`;
  btn.append(el('span', 'taste-summary-label', labelText));
  btn.append(el('span', 'taste-summary-value', summaryVal));
  const chev = el('span', 'taste-summary-chevron', '▾');
  btn.append(chev);
  if (state.home.tasteExpanded) btn.classList.add('expanded');

  const panel = el('div', 'taste-panel');
  panel.style.display = state.home.tasteExpanded ? 'block' : 'none';
  panel.append(buildTempAvatarCard(avatarData));

  if (hasTaste) {
    panel.append(buildTasteCard(taste));
  } else {
    const empty = el('div', 'taste-card');
    empty.append(el('div', 'taste-empty', 'Оціни хоча б 3 тайтли — і тут з\'явиться радарна карта твого смаку.'));
    panel.append(empty);
  }

  btn.addEventListener('click', () => {
    state.home.tasteExpanded = !state.home.tasteExpanded;
    btn.classList.toggle('expanded', state.home.tasteExpanded);
    container.classList.toggle('is-expanded', state.home.tasteExpanded);
    panel.style.display = state.home.tasteExpanded ? 'block' : 'none';
  });

  container.append(btn, panel);
  return container;
}

function renderMoodPills() {
  const pills = el('div', 'mood-pills');
  const allPill = el('button', 'mood-pill' + (!state.home.mood ? ' active' : ''), '✨ Будь-який');
  allPill.addEventListener('click', () => { state.home.mood = null; state.home.sig = null; refresh(); });
  pills.append(allPill);
  for (const [key, m] of Object.entries(MOODS)) {
    const p = el('button', 'mood-pill' + (state.home.mood === key ? ' active' : ''));
    p.textContent = `${m.emoji} ${m.label}`;
    p.addEventListener('click', () => {
      state.home.mood = state.home.mood === key ? null : key;
      state.home.sig = null;
      refresh();
    });
    pills.append(p);
  }
  return pills;
}

// ============ LOAD & RENDER ============
/* FIX-RECS-CACHE-V2 */
function computeCriticalSig() {
  return `mood:${state.home.mood || 'any'}|mode:${state.home.mode || 'balance'}|dig:${settings.digitalOnly ? 1 : 0}|str:${settings.streamingOnlyUA ? 1 : 0}`;
}

function computeRecsSignature(seeds) {
  const seedSig = seeds.map(s => `${s.key}:${s.strength.toFixed(1)}:${s.resFactor.toFixed(2)}`).join('|');
  const antiSig = getAntiSeeds().map(a => a.key).join(',');
  const exSig = Object.values(lib).filter(x => x.excludeFromProfile !== undefined).map(x => `${x.key}:${x.excludeFromProfile ? 1 : 0}`).join(',');
  const adjSig = Object.entries(actorAdjust || {}).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`).join(',');
  const castVals = Object.values(lib).map(x => typeof getItemCastRating === 'function' ? getItemCastRating(x) : 0).filter(v => v > 0);
  const castSig = `${castVals.length}:${castVals.reduce((a, b) => a + b, 0).toFixed(1)}`;
  const day = new Date().toISOString().slice(0, 10);
  const moodW = state.home.mood && MOODS[state.home.mood] ? (MOODS[state.home.mood].weight || 1) : 0; /* FIX-MOOD-AGGR-SIG */
  return `v13|${day}|n:${state.home.refreshNonce || 0}|${seedSig}|anti:${antiSig}|ex:${exSig}|adj:${adjSig}|cast:${castSig}|mood:${state.home.mood || 'any'}:${moodW}|mode:${state.home.mode || 'balance'}|dig:${settings.digitalOnly ? 1 : 0}|str:${settings.streamingOnlyUA ? 1 : 0}`; /* FIX-RELEASE-SIG */
}

async function loadHome() {
  if (state.tab !== 'home') return;
  if (!state.home.mode || !window.matchMedia('(min-width: 900px) and (min-height: 600px)').matches) state.home.mode = 'balance';

  const seeds = getSeeds();
  const taste = computeTasteVector();
  const sig = computeRecsSignature(seeds);
  const critical = computeCriticalSig(); /* FIX-RECS-CACHE-V2 */

  if (!state.home.general) { const gc = readGeneralCache(); if (gc) state.home.general = gc; }
  if (!state.home.general) {
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const twoYearsAgoIso = `${new Date().getFullYear() - 2}-01-01`;
      const exGenres = EXCLUDED_TV_GENRES.join(',');
      const TV_STREAMS_DEF = [
        { id: 'netflix', title: 'Netflix',     net: '213',     logoNet: 213 },
        { id: 'hbo',     title: 'HBO / Max',   net: '49|3186', logoNet: 49 },
        { id: 'apple',   title: 'Apple TV+',   net: '2552',    logoNet: 2552 },
        { id: 'disney',  title: 'Disney+',     net: '2739',    logoNet: 2739 },
        { id: 'prime',   title: 'Prime Video', net: '1024',    logoNet: 1024 }
      ];

      const fetchPages = async (buildPath, pages) => {
        const res = await Promise.all(pages.map(pg => tmdbFetch(buildPath(pg)).catch(() => ({ results: [] }))));
        return res.flatMap(d => d.results || []);
      };

      const cleanGen = (rawList, type, limit = 50) => {
        const seen = new Set();
        const out = [];
        /* FIX-RELEASE-CLEANGEN — Level 1 filter for general sections */
        const _todayIso = new Date().toISOString().slice(0, 10);
        for (const r of rawList) {
          if (!r || !r.poster_path || isExcludedShow(r, type)) continue;
          if ((settings.digitalOnly || settings.streamingOnlyUA) && type === 'movie') {
            const _rd = (r.release_date || '').slice(0, 10);
            if (_rd && _rd > _todayIso) continue;
          }
          const item = normalizeItem({ ...r, media_type: type });
          if (seen.has(item.key)) continue;
          seen.add(item.key);
          item.overview = '';
          out.push(item);
          if (out.length >= limit) break;
        }
        return out;
      };

      const [trM, newM, topM] = await Promise.all([
        fetchPages(pg => `/trending/movie/week?language=uk-UA&page=${pg}`, [1, 2, 3]),
        fetchPages(pg => `/discover/movie?language=uk-UA&sort_by=primary_release_date.desc&primary_release_date.lte=${todayIso}&vote_count.gte=40&page=${pg}`, [1, 2, 3]),
        fetchPages(pg => `/discover/movie?language=uk-UA&sort_by=vote_average.desc&vote_count.gte=1000&page=${pg}`, [1, 2, 3])
      ]);

      const streamRaw = await mapBatched(TV_STREAMS_DEF, 2, async st => {
        const [popRaw, newRaw, netRes] = await Promise.all([
          fetchPages(pg => `/discover/tv?language=uk-UA&sort_by=popularity.desc&vote_count.gte=30&vote_average.gte=6.0&with_networks=${encodeURIComponent(st.net)}&without_genres=${exGenres}&page=${pg}`, [1, 2]),
          fetchPages(pg => `/discover/tv?language=uk-UA&sort_by=first_air_date.desc&first_air_date.gte=${twoYearsAgoIso}&first_air_date.lte=${todayIso}&vote_count.gte=5&with_networks=${encodeURIComponent(st.net)}&without_genres=${exGenres}&page=${pg}`, [1, 2]),
          tmdbFetch(`/network/${st.logoNet}`).catch(() => null)
        ]);
        return {
          id: st.id,
          title: st.title,
          logo: netRes?.logo_path || null,
          pop: cleanGen(popRaw, 'tv', 36),
          fresh: cleanGen(newRaw, 'tv', 20)
        };
      });

      const knownStreamTvIds = new Set();
      streamRaw.forEach(st => {
        st.pop.forEach(x => knownStreamTvIds.add(x.id));
        st.fresh.forEach(x => knownStreamTvIds.add(x.id));
      });

      const [otherPopRaw, otherNewRaw] = await Promise.all([
        fetchPages(pg => `/discover/tv?language=uk-UA&sort_by=popularity.desc&vote_count.gte=50&vote_average.gte=6.2&without_genres=${exGenres}&page=${pg}`, [1, 2, 3]),
        fetchPages(pg => `/discover/tv?language=uk-UA&sort_by=first_air_date.desc&first_air_date.gte=${twoYearsAgoIso}&first_air_date.lte=${todayIso}&vote_count.gte=10&without_genres=${exGenres}&page=${pg}`, [1, 2])
      ]);

      streamRaw.push({
        id: 'other',
        title: 'Інші платформи',
        logo: null,
        pop: cleanGen(otherPopRaw.filter(x => !knownStreamTvIds.has(x.id)), 'tv', 36),
        fresh: cleanGen(otherNewRaw.filter(x => !knownStreamTvIds.has(x.id)), 'tv', 20)
      });

      state.home.general = {
        trMovies: cleanGen(trM, 'movie', 50),
        newMovies: cleanGen(newM, 'movie', 50),
        topMovies: cleanGen(topM, 'movie', 50),
        tvStreams: streamRaw
      };
      writeGeneralCache(state.home.general);
    } catch (e) { console.error(e); }
  }

  if (!seeds.length) {
    state.home.recs = { items: [], seeds: 0, mood: state.home.mood, mode: state.home.mode };
    state.home.sig = sig;
    renderHomeContent(taste);
    return;
  }
  if (state.home.recs && state.home.sig === sig) { renderHomeContent(taste); return; }
  const cached = readRecsCache(sig, critical); /* FIX-RECS-CACHE-V2 */
  if (cached) { /* FIX-CACHE-RESET */ state.home.recs = cached; state.home.sig = sig; state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */; renderHomeContent(taste); return; }
  if (state.home.loading === sig) return;

  state.home.loading = sig;
  renderHomeSkeleton(taste);
  try {
    const data = await buildSmartRecommendations(seeds, state.home.mood, state.home.mode);
    if (state.home.loading !== sig) return; // [LOADHOME-RACE-FIX] застарілий запит
    writeRecsCache(sig, critical, data); /* FIX-RECS-CACHE-V2 */
    state.home.recs = data;
    state.home.sig = sig;
    state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */;
    renderHomeContent(taste);
  } catch (e) {
    if (state.home.loading !== sig) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      state.home.recs = { items: [], seeds: seeds.length, mood: state.home.mood, mode: state.home.mode };
      renderHomeContent(taste);
      showSyncToast('📴 Офлайн-режим');
    } else {
      box.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: ${escapeHtml(e.message)}</div>`; /* FIX-HOME-ERR-ESC */
    }
  }
  finally { if (state.home.loading === sig) state.home.loading = false; }
}

function buildRecsControlsBar() {
  const controlsBar = el('div', 'recs-controls-bar');
  const modesBar = el('div', 'recs-mode-pills');
  const modeDefs = [
    { id: 'balance', label: '✨ Баланс' },
    { id: 'gems', label: '💎 Перлини' },
    { id: 'fresh', label: '🆕 Свіже' }
  ];
  modeDefs.forEach(m => {
    const mb = el('button', 'recs-mode-pill' + ((state.home.mode || 'balance') === m.id ? ' active' : ''), m.label);
    mb.type = 'button';
    mb.addEventListener('click', () => {
      if ((state.home.mode || 'balance') === m.id) return;
      state.home.mode = m.id;
      try { localStorage.setItem('mycinema.home.mode', m.id); } catch (e) {} /* FIX-MODE-SAVE */
      state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */;
      refresh();
    });
    modesBar.append(mb);
  });
  controlsBar.append(modesBar, renderMoodPills());
  return controlsBar;
}

function renderHomeSkeleton(taste) {
  box.style.padding = '0';
  box.replaceChildren();

  box.append(renderTasteSummary(taste || computeTasteVector()));
  const cwSection = buildContinueWatchingSection();
  if (cwSection) box.append(cwSection);

  const wrap = el('div', 'home-wrap');
  const factCard = buildFactOfDayCard();
  if (factCard) wrap.append(factCard);
  const sec = el('section', 'home-section');
  const head = el('div', 'section-head');
  head.append(el('h2', 'section-title', '✨ Для тебе'));
  sec.append(head);
  sec.append(buildRecsControlsBar());

  const grid = el('div', 'home-grid');
  for (let i = 0; i < 14; i++) {
    const sk = el('div', 'rec-card skeleton-card');
    sk.append(el('div', 'skeleton-poster'));
    sk.append(el('div', 'skeleton-bar skeleton-line-1'));
    sk.append(el('div', 'skeleton-bar skeleton-line-2'));
    sk.append(el('div', 'skeleton-bar skeleton-line-3'));
    grid.append(sk);
  }
  sec.append(grid);
  wrap.append(sec);

  const plannedSec = buildPlannedByMoodSection();
  if (plannedSec) wrap.append(plannedSec);

  box.append(wrap);
}

function recCard(item, allowDismiss) {
  const c = el('div', 'rec-card');
  const wrap = el('div', 'rec-poster-wrap');
  const p = el('img', 'rec-poster'); p.src = TMDB_IMG + 'w342' + item.poster; p.loading = 'lazy'; p.decoding = 'async';
  wrap.append(p);
  if (allowDismiss && typeof dismissRec === 'function') {
    const disBtn = el('button', 'rec-dismiss', '✕');
    disBtn.type = 'button';
    disBtn.title = 'Не цікавить (сховати)';
    disBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissRec(item);
      c.classList.add('dismissing');
      setTimeout(() => {
        c.remove();
        if (state.home.recs?.items) {
          state.home.recs.items = state.home.recs.items.filter(x => x.key !== item.key);
        }
      }, 180);
      showSyncToast('🙈 Приховано');
    });
    wrap.append(disBtn);
  }
  /* FIX-RELEASE-REC-BADGE — badge on poster */
  if (settings.showStatusBadges !== false) try {
    const _today = new Date().toISOString().slice(0, 10);
    const _rel = (item.releaseDate || (item.year ? item.year + '-01-01' : '')).slice(0, 10);
    const _libItem = (typeof lib !== 'undefined' && lib[item.key]) || {}; /* FIX-RELEASE-REC-BADGE-LIB */
    const _dig = _libItem.digitalReleaseDate || item.digitalReleaseDate || null;
    const _str = (_libItem.streamingUA && _libItem.streamingUA.length ? _libItem.streamingUA : item.streamingUA) || [];
    let _b = null;
    /* FIX-RELEASE-OLD-FALLBACK */
    const _oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (_str && _str.length > 0) _b = { cls: 'stream', txt: '📺 UA' };
    else if (_dig && _dig <= _today) _b = { cls: 'ok', txt: '💾 Цифра' };
    else if (_rel && _rel > _today) _b = { cls: 'wait', txt: '⏳ Скоро' };
    else if (_rel && _rel <= _today && _rel < _oldDate) _b = { cls: 'ok', txt: '💾 Цифра' };
    else if (_rel && _rel <= _today && (!_dig || _dig > _today) && item.type === 'movie') _b = { cls: 'cinema', txt: '🎬 Кіно' };
    if (_b) wrap.append(el('span', 'rec-badge ' + _b.cls, _b.txt));
  } catch (e) {}
  c.append(wrap);
  c.append(el('div', 'row-title', item.title));
  let meta = item.year || '';
  if (item.tmdbRating) meta += (meta ? ' · ' : '') + item.tmdbRating.toFixed(1);
  c.append(el('div', 'row-meta', meta));
  if (item._reasons && item._reasons.length) {
    c.append(el('div', 'rec-why', item._reasons.join(' · ')));
  }
  c.addEventListener('click', () => openCard(item));
  return c;
}

function buildPlannedByMoodSection() {
  const allPlanned = Object.values(lib)
    .filter(x => x.status === 'planned' && x.poster)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (!allPlanned.length) return null;

  const moodKey = state.home.mood;
  const moodData = moodKey && MOODS[moodKey] ? MOODS[moodKey] : null;

  let pool = allPlanned;
  if (moodData) {
    const matched = allPlanned.filter(x => {
      if (!x.genres || !x.genres.length) return false;
      const targetGenres = x.type === 'tv' ? (moodData.tvGenres || moodData.genres) : moodData.genres;
      return x.genres.some(g => targetGenres.includes(g));
    });
    if (matched.length) pool = matched;
  }

  const sec = el('section', 'home-section planned-mood-sec');
  const head = el('div', 'section-head');
  const titleWrap = el('div', 'planned-head-left');
  titleWrap.append(el('h2', 'section-title', '🎯 З твого «Планую»')); /* FIX-HOME-NO-SUB-PLANNED */

  const rouletteBtn = el('button', 'roulette-btn', '🎲 Вибрати за мене');
  rouletteBtn.type = 'button';
  rouletteBtn.addEventListener('click', () => {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) openCard(pick);
  });

  head.append(titleWrap, rouletteBtn);
  sec.append(head);

  const strip = el('div', 'home-grid'); /* FIX-PLANNED-GRID */
  pool.slice(0, 14).forEach(item => {
    strip.append(recCard(item, false));
  });
  sec.append(strip);
  return sec;
}

function renderHomeContent(taste) {
  if (state.tab !== 'home') return;
  box.replaceChildren(); box.style.padding = '0';

  box.append(renderTasteSummary(taste || computeTasteVector()));

  const cwSection = buildContinueWatchingSection();
  if (cwSection) box.append(cwSection);

  const wrap = el('div', 'home-wrap');

  const factCard = buildFactOfDayCard();
  if (factCard) wrap.append(factCard);

  const recs = state.home.recs;

  // === БЛОК РЕКОМЕНДАЦІЙ ===
  if (recs && recs.seeds > 0) {
    const sec = el('section', 'home-section');
    const head = el('div', 'section-head');
    head.append(el('h2', 'section-title', '✨ Для тебе')); /* FIX-HOME-NO-SUB-FORYOU */
    sec.append(head);

    // Єдиний блок режимів видачі та настрою під «Для тебе»
    const controlsBar = el('div', 'recs-controls-bar');
    const modesBar = el('div', 'recs-mode-pills');
    const modeDefs = [
      { id: 'balance', label: '✨ Баланс' },
      { id: 'gems', label: '💎 Перлини' },
      { id: 'fresh', label: '🆕 Свіже' }
    ];
    modeDefs.forEach(m => {
      const mb = el('button', 'recs-mode-pill' + ((state.home.mode || 'balance') === m.id ? ' active' : ''), m.label);
      mb.type = 'button';
      mb.addEventListener('click', () => {
        if ((state.home.mode || 'balance') === m.id) return;
        state.home.mode = m.id;
        try { localStorage.setItem('mycinema.home.mode', m.id); } catch (e) {} /* FIX-MODE-SAVE */
        state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */;
        refresh();
      });
      modesBar.append(mb);
    });
    controlsBar.append(modesBar, renderMoodPills());
    sec.append(controlsBar);

    const type = state.home.tab;
    const allItems = recs.items.filter(x => x.type === type && !(typeof isTrackedInLib === 'function' ? isTrackedInLib(x.key) : !!lib[x.key]) && !(typeof isDismissed === 'function' && isDismissed(x.key)));
    const shownCount = state.home.shown[type] || 14 /* FIX-SHOWN-14 */;
    const visibleItems = allItems.slice(0, shownCount);

    if (visibleItems.length) {
      const grid = el('div', 'home-grid');
      visibleItems.forEach(item => grid.append(recCard(item, true)));
      sec.append(grid);
    } else {
      sec.append(el('div', 'home-note', 'Немає рекомендацій у цьому режимі. Спробуй «Баланс» або інший настрій.'));
    }

    if (allItems.length > shownCount) {
      const moreBtn = el('button', 'home-more', 'Показати ще');
      /* FIX-SHOWMORE */
      moreBtn.addEventListener('click', () => {
        const grid = sec.querySelector('.home-grid');
        const current = state.home.shown[type] || 14 /* FIX-SHOWN-14 */;
        const fresh = (state.home.recs?.items || []).filter(x => x.type === type && !(typeof isTrackedInLib === 'function' ? isTrackedInLib(x.key) : !!lib[x.key]) && !(typeof isDismissed === 'function' && isDismissed(x.key)));
        const nextShown = Math.min(fresh.length, current + 14) /* FIX-SHOWN-14 */;
        if (grid) fresh.slice(current, nextShown).forEach(item => grid.append(recCard(item, true)));
        state.home.shown[type] = nextShown;
        if (nextShown >= fresh.length) moreBtn.remove();
      });
      sec.append(moreBtn);
    }

    /* FIX-RECS-AGE */
    let _cacheAge = '';
    try {
      const _c = JSON.parse(localStorage.getItem(RECS_CACHE));
      if (_c && _c.ts) {
        const _hrs = Math.floor((Date.now() - _c.ts) / 3600000);
        if (_hrs < 1) _cacheAge = ' (щойно)';
        else if (_hrs < 24) _cacheAge = ` (${_hrs} год. тому)`;
        else _cacheAge = ` (${Math.floor(_hrs / 24)} дн. тому)`;
      }
    } catch (e) {}
    const refreshBtn = el('button', 'home-more', '🔄 Оновити рекомендації' + _cacheAge);
    refreshBtn.style.marginTop = '12px';
    refreshBtn.style.background = 'transparent';
    refreshBtn.style.border = '1px solid var(--bg-3)';
    refreshBtn.addEventListener('click', () => {
      try { localStorage.removeItem(RECS_CACHE); } catch {}
      state.home.refreshNonce = (state.home.refreshNonce || 0) + 1;
      state.home.sig = null; state.home.recs = null;
      state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */;
      state.home.genShown = {}; /* FIX-GENSHOWN-RESET */
      refresh();
      showSyncToast('✨ Оновлено');
    });
    sec.append(refreshBtn);
    wrap.append(sec);

  } else if (recs && recs.seeds === 0) {
    const sec = el('section', 'home-section');
    sec.append(el('h2', 'section-title', '✨ Для тебе'));
    sec.append(el('div', 'home-note', 'Постав оцінку 7+ або ❤️ улюбленому фільму чи серіалу — і тут з\'являться персональні рекомендації.'));
    wrap.append(sec);
  }

  const plannedSec = buildPlannedByMoodSection();
  if (plannedSec) wrap.append(plannedSec);

  // Плаваючі таби (доступні і для персональних, і для загальних добірок)
  if ((recs && recs.items && recs.items.length) || state.home.general) {
    const tabsWrap = el('div', 'home-tabs-wrap');
    const tabs = el('div', 'home-tabs');
    const mTab = el('button', 'home-tab' + (state.home.tab === 'movie' ? ' active' : ''), '🎬 Фільми');
    const tTab = el('button', 'home-tab' + (state.home.tab === 'tv' ? ' active' : ''), '📺 Серіали');

    mTab.addEventListener('click', () => {
      if (state.home.tab !== 'movie') {
        state.home.tab = 'movie';
        try { localStorage.setItem('mycinema.home.tab', 'movie'); } catch (e) {} /* FIX-TAB-SAVE-M */
        state.home.shown.movie = 14; /* FIX-SHOWN-14 */
        renderHomeContent(taste);
      }
    });
    tTab.addEventListener('click', () => {
      if (state.home.tab !== 'tv') {
        state.home.tab = 'tv';
        try { localStorage.setItem('mycinema.home.tab', 'tv'); } catch (e) {} /* FIX-TAB-SAVE-T */
        state.home.shown.tv = 14; /* FIX-SHOWN-14 */
        renderHomeContent(taste);
      }
    });

    tabs.append(mTab, tTab);
    tabsWrap.append(tabs);
    wrap.append(tabsWrap);
  }

  // === БЛОК ЗАГАЛЬНИХ ПІДБІРОК ===
  if (state.home.general) {
    const g = state.home.general;
    if (!state.home.genShown) state.home.genShown = {};

    const renderBlock = (blockId, title, sub, items, opts) => {
      if (!items || !items.length) return;
      const s = el('section', 'home-section');
      const head = el('div', 'section-head');
      const h2 = el('h2', 'section-title');
      if (opts && opts.logo) {
        const img = el('img', 'stream-head-logo');
        img.src = TMDB_IMG + 'w154' + opts.logo;
        img.alt = title;
        img.loading = 'lazy';
        h2.append(img);
      } else if (opts && opts.isOther) {
        const ic = document.createElement('span');
        ic.className = 'stream-head-icon';
        ic.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>';
        h2.append(ic);
      }
      h2.append(el('span', '', title));
      head.append(h2);
      if (sub) head.append(el('span', 'section-sub', sub));
      s.append(head);

      const grid = el('div', 'home-grid');
      let shown = state.home.genShown[blockId] || 10;
      items.slice(0, shown).forEach(item => grid.append(recCard(item, false)));
      s.append(grid);

      if (items.length > shown) {
        const moreBtn = el('button', 'home-more', 'Показати ще');
        moreBtn.type = 'button';
        moreBtn.addEventListener('click', () => {
          const nextShown = Math.min(items.length, shown + 20);
          items.slice(shown, nextShown).forEach(item => grid.append(recCard(item, false)));
          shown = nextShown;
          state.home.genShown[blockId] = shown;
          if (shown >= items.length) moreBtn.remove();
        });
        s.append(moreBtn);
      }
      wrap.append(s);
    };

    const tvGenrePref = {};
    Object.values(lib).forEach(x => {
      if (x.type !== 'tv') return;
      const avg = computeItemRating(x).avg;
      if (avg < 7 && !x.favorite) return;
      const w = ((avg || 8) / 10) * Math.max(0.2, tasteDecay(x.updated));
      (x.genres || []).forEach(gid => { tvGenrePref[gid] = (tvGenrePref[gid] || 0) + w; });
    });

    const mixTvStreamItems = (stream) => {
      const popPool = (stream.pop || []).filter(x => !(typeof isDismissed === 'function' && isDismissed(x.key)));
      const newPool = (stream.fresh || []).filter(x => !(typeof isDismissed === 'function' && isDismissed(x.key)));

      // Легка персоналізація популярного блоку: улюблені жанри вище, уже переглянуті/закинуті нижче
      const rankedPop = popPool
        .map((x, idx) => {
          const saved = lib[x.key];
          const seenPenalty = saved && (saved.status === 'watched' || saved.status === 'dropped') ? 100 : 0;
          let gBoost = 0;
          (x.genres || []).forEach(gid => { gBoost += (tvGenrePref[gid] || 0); });
          return { x, sortVal: idx - Math.min(gBoost, 4) * 1.2 + seenPenalty };
        })
        .sort((a, b) => a.sortVal - b.sortVal)
        .map(o => o.x);

      const maxItems = 50;
      const popPick = rankedPop.slice(0, 36);
      const usedKeys = new Set(popPick.map(x => x.key));
      const newPick = newPool.filter(x => !usedKeys.has(x.key)).slice(0, 20);

      // Пропорція 2:1 до maxItems (до 50 карток)
      const mixed = [];
      let pi = 0, ni = 0;
      while (mixed.length < maxItems && (pi < popPick.length || ni < newPick.length)) {
        if (pi < popPick.length && mixed.length < maxItems) mixed.push(popPick[pi++]);
        if (pi < popPick.length && mixed.length < maxItems) mixed.push(popPick[pi++]);
        if (ni < newPick.length && mixed.length < maxItems) mixed.push(newPick[ni++]);
      }
      return mixed;
    };

    if (state.home.tab === 'movie') {
      renderBlock('trMovies', '🔥 Популярні фільми', 'сьогодні', g.trMovies);
      renderBlock('newMovies', '🎬 Нові фільми', 'свіже', g.newMovies);
      renderBlock('topMovies', '🏆 Найрейтинговіші фільми', 'класика', g.topMovies);
    } else if (Array.isArray(g.tvStreams)) {
      g.tvStreams.forEach(st => {
        const mixed = mixTvStreamItems(st);
        renderBlock('tv-' + st.id, st.title, '', mixed, { logo: st.logo, isOther: st.id === 'other' });
      });
    }
  }

  box.append(wrap);
}

function buildFactOfDayCard() {
  if (typeof getFactOfDay !== 'function' || typeof isFactDismissedToday !== 'function') return null;
  if (isFactDismissedToday()) return null;
  const fact = getFactOfDay();
  if (!fact) return null;

  const card = el('div', 'fact-card');
  const head = el('div', 'fact-card-head');
  head.append(el('span', 'fact-card-badge', '🎞️ Факт дня'));

  const closeBtn = el('button', 'fact-card-close', '✕');
  closeBtn.type = 'button';
  closeBtn.title = 'Сховати до завтра';
  closeBtn.addEventListener('click', () => {
    dismissFactToday();
    card.classList.add('dismissing');
    setTimeout(() => card.remove(), 180);
  });
  head.append(closeBtn);
  card.append(head);

  card.append(el('div', 'fact-card-text', fact.text));

  if (fact.title && typeof openFactMedia === 'function') {
    const linkBtn = el('button', 'fact-card-link', `🎬 ${fact.title}${fact.year ? ' (' + fact.year + ')' : ''} →`);
    linkBtn.type = 'button';
    linkBtn.addEventListener('click', () => openFactMedia(fact));
    card.append(linkBtn);
  }
  return card;
}

const _nextEpSeasonCache = new Map();

function computeNextEpisode(item) {
  const eps = item.watchedEpisodes || [];
  if (!eps.length) return null;
  const parsed = eps.map(k => {
    const parts = String(k).split('-').map(Number);
    return (parts[0] > 0 && parts[1] > 0) ? { s: parts[0], e: parts[1] } : null;
  }).filter(Boolean).sort((a, b) => a.s - b.s || a.e - b.e);
  if (!parsed.length) return null;

  const last = parsed[parsed.length - 1];
  const sc = item.seasonCounts || {};
  const curMax = sc[last.s] || 0;
  let nextS = last.s;
  let nextE = last.e + 1;

  if (curMax > 0 && nextE > curMax) {
    const nextSeasonNum = last.s + 1;
    if (item.totalSeasons && nextSeasonNum > item.totalSeasons) {
      return { finished: true, s: last.s, e: last.e };
    }
    nextS = nextSeasonNum;
    nextE = 1;
  }
  return { finished: false, s: nextS, e: nextE, code: `S${nextS}E${String(nextE).padStart(2, '0')}` };
}

function buildContinueWatchingSection() {
  const watching = Object.values(lib).filter(x => x.type === 'tv' && x.status === 'watching' && x.watchedEpisodes && x.watchedEpisodes.length > 0).sort((a, b) => b.updated - a.updated).slice(0, 6);
  if (!watching.length) return null;
  const sec = el('section', 'home-section continue-watching-sec');
  const head = el('div', 'section-head');
  head.append(el('h2', 'section-title', '⏯️ Продовжити'));
  sec.append(head);
  const grid = el('div', 'home-grid');
  const todayIso = new Date().toISOString().slice(0, 10);

  watching.forEach(item => {
    const c = el('div', 'rec-card');
    const p = el('img', 'rec-poster');
    if (item.poster) p.src = TMDB_IMG + 'w342' + item.poster;
    c.append(p, el('div', 'row-title', item.title));

    const eps = item.watchedEpisodes || [];
    const tot = item.episode_count || 0;
    const pct = tot > 0 ? Math.min(100, Math.round((eps.length / tot) * 100)) : 0;
    const next = computeNextEpisode(item);

    if (next) {
      const baseText = next.finished
        ? 'Усі серії переглянуто'
        : `Далі: ${next.code}` + (tot > 0 ? ` · ${pct}%` : '');
      const labelEl = el('div', 'rec-why', baseText);
      c.append(labelEl);

      if (!next.finished && item.id) {
        const cacheKey = `${item.id}:${next.s}`;
        const applySeasonData = (episodes) => {
          if (!episodes || !labelEl.isConnected) return;
          if (!item.seasonCounts?.[next.s] && episodes.length && lib[item.key]) {
            lib[item.key].seasonCounts = { ...(lib[item.key].seasonCounts || {}), [next.s]: episodes.length };
          }
          const epObj = episodes.find(ep => ep.episode_number === next.e);
          if (epObj) {
            if (epObj.air_date && epObj.air_date > todayIso) {
              const dt = new Date(epObj.air_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
              labelEl.textContent = `Чекаємо ${next.code} · ${dt}`;
            } else if (epObj.name) {
              labelEl.textContent = `Далі: ${next.code} · ${epObj.name}`;
            }
          } else if (episodes.length > 0 && next.e > episodes.length) {
            const nextS = next.s + 1;
            const hasMoreSeasons = !item.totalSeasons || nextS <= item.totalSeasons;
            labelEl.textContent = hasMoreSeasons
              ? `Далі: S${nextS}E01` + (tot > 0 ? ` · ${pct}%` : '')
              : 'Сезон завершено';
          }
        };

        if (_nextEpSeasonCache.has(cacheKey)) {
          applySeasonData(_nextEpSeasonCache.get(cacheKey));
        } else {
          tmdbFetch(`/tv/${item.id}/season/${next.s}?language=uk-UA`)
            .then(d => {
              const epsArr = d.episodes || [];
              _nextEpSeasonCache.set(cacheKey, epsArr);
              applySeasonData(epsArr);
            })
            .catch(() => {});
        }
      }

      if (tot > 0) {
        const prog = el('div', 'item-progress');
        const fill = el('div', 'item-progress-fill');
        fill.style.width = pct + '%';
        prog.append(fill);
        c.append(prog);
      }
    }
    c.addEventListener('click', () => openCard(item));
    grid.append(c);
  });
  sec.append(grid);
  return sec;
}
