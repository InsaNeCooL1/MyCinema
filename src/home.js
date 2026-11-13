'use strict';

// ============ RECOMMENDATIONS ENGINE V2 ============
const GEN_CACHE = 'mycinema.home.general.v6';
const RECS_TTL = 6 * 60 * 60 * 1000;  // 6 годин
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

const META_CACHE_KEY = 'mycinema.metaCache.v1';
const META_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const META_CACHE_MAX = 220;
const _memSeedRecs = new Map();


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
    genres
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

  const parts = [type === 'tv' ? 'credits,aggregate_credits,keywords' : 'credits,keywords'];
  if (needRecs) parts.push('recommendations');
  const d = await tmdbFetch(`/${type}/${id}?language=uk-UA&append_to_response=${parts.join(',')}`);
  const meta = packCompactMeta(d, type);
  cacheObj[key] = meta;

  let recs = [];
  if (needRecs) {
    recs = (d.recommendations?.results || []).slice(0, 12);
    _memSeedRecs.set(key, recs);
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
    if (lib[key] || (typeof isDismissed === 'function' && isDismissed(key))) return null;
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
        entry._sourceRaw += 1.4;
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
    entry._preScore = entry._baseRaw * 0.35 + Math.min(entry._sourceRaw, 3) * 0.2 + entry._genreMatch * 0.3 - entry._antiGenre;

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

    const enriched = list.filter(x => !!x._meta);
    const rest = list.filter(x => !x._meta);

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
        entry._sortScore = total + (rnd() - 0.5) * 0.08;
        delete entry._seenTags;
        delete entry._meta;
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
        const divPen = Math.min(0.24, Math.max(colPen, dirPen + leadPen));
        if (divPen > 0) entry._sortScore -= divPen;
      });
      enriched.sort((a, b) => b._sortScore - a._sortScore);
    }

    for (const entry of rest) {
      finalizeReasons(entry);
      entry._sortScore = entry._preScore;
      delete entry._seenTags;
      delete entry._meta;
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
  try { const c = JSON.parse(localStorage.getItem(GEN_CACHE)); if (c && Date.now() - c.ts < GEN_TTL) return c.data; } catch {}
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
function readRecsCache(sig) {
  try { const c = JSON.parse(localStorage.getItem(RECS_CACHE)); if (c && c.sig === sig && Date.now() - c.ts < RECS_TTL) return c.data; } catch {}
  return null;
}
function writeRecsCache(sig, data) { try { localStorage.setItem(RECS_CACHE, JSON.stringify({ sig, ts: Date.now(), data })); } catch {} }

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

function renderTasteSummary(taste) {
  const container = el('div', 'taste-summary-container' + (state.home.tasteExpanded ? ' is-expanded' : ''));
  const hasTaste = taste && taste.count >= 3;

  let summaryVal = '—';
  if (hasTaste) {
    const vals = RATING_CRITERIA.map(c => taste[c.key] || 0).filter(v => v > 0);
    if (vals.length) summaryVal = fmtNum(vals.reduce((a, b) => a + b, 0) / vals.length) + '/10';
  }

  const btn = el('button', 'taste-summary');
  btn.append(el('span', 'taste-summary-icon', '🧬'));
  btn.append(el('span', 'taste-summary-label', 'Твій смак у цифрах'));
  btn.append(el('span', 'taste-summary-value', summaryVal));
  const chev = el('span', 'taste-summary-chevron', '▾');
  btn.append(chev);
  if (state.home.tasteExpanded) btn.classList.add('expanded');

  const panel = el('div', 'taste-panel');
  panel.style.display = state.home.tasteExpanded ? 'block' : 'none';

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

function renderMoodSelector() {
  const sec = el('section', 'mood-section');
  sec.append(el('div', 'mood-title', '🎬 Настрій сьогодні'));
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
  sec.append(pills);
  return sec;
}

// ============ LOAD & RENDER ============
function computeRecsSignature(seeds) {
  const seedSig = seeds.map(s => `${s.key}:${s.strength.toFixed(1)}:${s.resFactor.toFixed(2)}`).join('|');
  const antiSig = getAntiSeeds().map(a => a.key).join(',');
  const exSig = Object.values(lib).filter(x => x.excludeFromProfile !== undefined).map(x => `${x.key}:${x.excludeFromProfile ? 1 : 0}`).join(',');
  const adjSig = Object.entries(actorAdjust || {}).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`).join(',');
  const castVals = Object.values(lib).map(x => typeof getItemCastRating === 'function' ? getItemCastRating(x) : 0).filter(v => v > 0);
  const castSig = `${castVals.length}:${castVals.reduce((a, b) => a + b, 0).toFixed(1)}`;
  const day = new Date().toISOString().slice(0, 10);
  return `v10|${day}|n:${state.home.refreshNonce || 0}|${seedSig}|anti:${antiSig}|ex:${exSig}|adj:${adjSig}|cast:${castSig}|mood:${state.home.mood || 'any'}|mode:${state.home.mode || 'balance'}`;
}

async function loadHome() {
  if (state.tab !== 'home') return;
  if (!state.home.mode) state.home.mode = 'balance';

  const seeds = getSeeds();
  const taste = computeTasteVector();
  const sig = computeRecsSignature(seeds);

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
        for (const r of rawList) {
          if (!r || !r.poster_path || isExcludedShow(r, type)) continue;
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
  const cached = readRecsCache(sig);
  if (cached) { state.home.recs = cached; state.home.sig = sig; renderHomeContent(taste); return; }
  if (state.home.loading === sig) return;

  state.home.loading = sig;
  box.style.padding = '0';
  box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Підбираю рекомендації під твій смак...</div>';
  try {
    const data = await buildSmartRecommendations(seeds, state.home.mood, state.home.mode);
    writeRecsCache(sig, data);
    state.home.recs = data;
    state.home.sig = sig;
    state.home.shown = { movie: 20, tv: 20 };
    renderHomeContent(taste);
  } catch (e) { box.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: ${e.message}</div>`; }
  finally { state.home.loading = false; }
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
  titleWrap.append(el('h2', 'section-title', '🎯 З твого «Планую»'));
  const subTxt = moodData
    ? (pool === allPlanned && !allPlanned.some(x => (x.genres || []).some(g => moodData.genres.includes(g)))
        ? `немає точних під ${moodData.emoji}, показую всі (${allPlanned.length})`
        : `під настрій ${moodData.emoji} ${moodData.label} (${pool.length})`)
    : `${pool.length} у списку`;
  titleWrap.append(el('span', 'section-sub', subTxt));

  const rouletteBtn = el('button', 'roulette-btn', '🎲 Вибрати за мене');
  rouletteBtn.type = 'button';
  rouletteBtn.addEventListener('click', () => {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) openCard(pick);
  });

  head.append(titleWrap, rouletteBtn);
  sec.append(head);

  const strip = el('div', 'planned-strip');
  pool.slice(0, 14).forEach(item => {
    const card = recCard(item, false);
    card.classList.add('planned-strip-card');
    strip.append(card);
  });
  sec.append(strip);
  return sec;
}

function renderHomeContent(taste) {
  if (state.tab !== 'home') return;
  box.replaceChildren(); box.style.padding = '0';

  box.append(renderTasteSummary(taste || computeTasteVector()));
  box.append(renderMoodSelector());

  const cwSection = buildContinueWatchingSection();
  if (cwSection) box.append(cwSection);

  const wrap = el('div', 'home-wrap');

  const factCard = buildFactOfDayCard();
  if (factCard) wrap.append(factCard);

  const plannedSec = buildPlannedByMoodSection();
  if (plannedSec) wrap.append(plannedSec);

  const recs = state.home.recs;

  // === БЛОК РЕКОМЕНДАЦІЙ ===
  if (recs && recs.items && recs.items.length) {
    const sec = el('section', 'home-section');
    const head = el('div', 'section-head');
    const moodLabel = recs.mood && MOODS[recs.mood] ? ` · ${MOODS[recs.mood].emoji} ${MOODS[recs.mood].label}` : '';
    head.append(el('h2', 'section-title', '✨ Для тебе'));
    head.append(el('span', 'section-sub', `на основі ${recs.seeds} якорів${moodLabel}`));
    sec.append(head);

    // Перемикач режимів видачі
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
        state.home.shown = { movie: 20, tv: 20 };
        refresh();
      });
      modesBar.append(mb);
    });
    sec.append(modesBar);

    const type = state.home.tab;
    const allItems = recs.items.filter(x => x.type === type && !(typeof isDismissed === 'function' && isDismissed(x.key)));
    const shownCount = state.home.shown[type] || 20;
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
      moreBtn.addEventListener('click', () => {
        state.home.shown[type] += 20;
        renderHomeContent(taste);
      });
      sec.append(moreBtn);
    }

    const refreshBtn = el('button', 'home-more', '🔄 Оновити рекомендації');
    refreshBtn.style.marginTop = '12px';
    refreshBtn.style.background = 'transparent';
    refreshBtn.style.border = '1px solid var(--bg-3)';
    refreshBtn.addEventListener('click', () => {
      try { localStorage.removeItem(RECS_CACHE); } catch {}
      state.home.refreshNonce = (state.home.refreshNonce || 0) + 1;
      state.home.sig = null; state.home.recs = null;
      state.home.shown = { movie: 20, tv: 20 };
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

  // Плаваючі таби (доступні і для персональних, і для загальних добірок)
  if ((recs && recs.items && recs.items.length) || state.home.general) {
    const tabsWrap = el('div', 'home-tabs-wrap');
    const tabs = el('div', 'home-tabs');
    const mTab = el('button', 'home-tab' + (state.home.tab === 'movie' ? ' active' : ''), '🎬 Фільми');
    const tTab = el('button', 'home-tab' + (state.home.tab === 'tv' ? ' active' : ''), '📺 Серіали');

    mTab.addEventListener('click', () => {
      if (state.home.tab !== 'movie') {
        state.home.tab = 'movie';
        state.home.shown.movie = 20;
        renderHomeContent(taste);
      }
    });
    tTab.addEventListener('click', () => {
      if (state.home.tab !== 'tv') {
        state.home.tab = 'tv';
        state.home.shown.tv = 20;
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

function buildContinueWatchingSection() {
  const watching = Object.values(lib).filter(x => x.type === 'tv' && x.status === 'watching' && x.watchedEpisodes && x.watchedEpisodes.length > 0).sort((a, b) => b.updated - a.updated).slice(0, 6);
  if (!watching.length) return null;
  const sec = el('section', 'home-section continue-watching-sec');
  const head = el('div', 'section-head');
  head.append(el('h2', 'section-title', '⏯️ Продовжити'));
  sec.append(head);
  const grid = el('div', 'home-grid');
  watching.forEach(item => {
    const c = el('div', 'rec-card');
    const p = el('img', 'rec-poster');
    if (item.poster) p.src = TMDB_IMG + 'w342' + item.poster;
    c.append(p, el('div', 'row-title', item.title));
    const eps = item.watchedEpisodes || [];
    if (eps.length) {
      const last = eps[eps.length - 1];
      const tot = item.episode_count || 0;
      const pct = tot > 0 ? Math.min(100, Math.round((eps.length / tot) * 100)) : 0;
      c.append(el('div', 'rec-why', 'на ' + last.replace('-', '×') + (tot > 0 ? ` · ${pct}%` : '')));
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
