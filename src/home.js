'use strict';

// ============ RECOMMENDATIONS ENGINE V2 ============
const RECS_CACHE = 'mycinema.recs.v4';
const GEN_CACHE = 'mycinema.home.general.v3';
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

function getSeeds() {
  const candidates = Object.values(lib)
    .map(x => {
      const avg = computeItemRating(x).avg;
      const isFav = !!x.favorite;
      const elo = typeof x.elo === 'number' ? x.elo : ELO_START;
      const hasHighElo = (x.eloGames || 0) > 0 && elo >= 1530;
      if (!x.id || (avg < 7 && !isFav && !hasHighElo)) return null;
      const base = avg > 0 ? avg : (isFav ? 8.6 : 8.2);
      const strength = base + (isFav ? 1.4 : 0) + (elo > ELO_START ? Math.min((elo - ELO_START) / 100, 1.5) : 0);
      return { ...x, avg, isFav, elo, strength };
    })
    .filter(Boolean);

  if (!candidates.length) return [];

  // 50% свіжі оцінки (останні дії) + 50% якірні (найсильніша любов)
  const fresh = [...candidates].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 3);
  const anchors = [...candidates].sort((a, b) => b.strength - a.strength || (b.updated || 0) - (a.updated || 0));

  const picked = [];
  const seen = new Set();
  for (const s of fresh) {
    if (!seen.has(s.key)) { seen.add(s.key); picked.push(s); }
  }
  for (const s of anchors) {
    if (picked.length >= 5) break;
    if (!seen.has(s.key)) { seen.add(s.key); picked.push(s); }
  }
  return picked;
}

function getAntiSeeds() {
  return Object.values(lib)
    .map(x => ({ ...x, avg: computeItemRating(x).avg }))
    .filter(x => x.id && (x.status === 'dropped' || (x.avg > 0 && x.avg <= 4.5)))
    .sort((a, b) => (a.avg || 3) - (b.avg || 3) || (b.updated || 0) - (a.updated || 0))
    .slice(0, 2);
}

function getDominantCriterion(taste) {
  if (!taste || taste.count < 3) return null;
  const vals = RATING_CRITERIA.map(c => ({ key: c.key, label: c.label, v: taste[c.key] || 0 }));
  const sorted = [...vals].sort((a, b) => b.v - a.v);
  const avg = vals.reduce((s, x) => s + x.v, 0) / vals.length;
  if (sorted[0].v - avg >= 0.35) return sorted[0];
  return null;
}

async function buildSmartRecommendations(seeds, mood, mode) {
  mode = mode || 'balance';
  if (!seeds.length) return { items: [], seeds: 0, mood, mode };

  const taste = computeTasteVector();
  const domCrit = getDominantCriterion(taste);
  const antiSeeds = getAntiSeeds();

  const [seedDetails, antiDetails] = await Promise.all([
    Promise.all(seeds.map(async s => {
      try {
        const d = await tmdbFetch(`/${s.type}/${s.id}?language=uk-UA&append_to_response=credits,keywords,recommendations`);
        return { seed: s, data: d };
      } catch { return null; }
    })).then(a => a.filter(Boolean)),
    Promise.all(antiSeeds.map(async s => {
      try {
        const d = await tmdbFetch(`/${s.type}/${s.id}?language=uk-UA&append_to_response=credits,keywords`);
        return { seed: s, data: d };
      } catch { return null; }
    })).then(a => a.filter(Boolean))
  ]);

  const signals = { directors: {}, cast: {}, genres: {}, keywords: {} };
  const anti = { directors: {}, genres: {}, keywords: {} };
  const names = { directors: {}, cast: {} };

  // Позитивні сигнали (з урахуванням улюбленого, Elo, піврозпаду 180д і Taste DNA)
  for (const { seed, data } of seedDetails) {
    let w = (seed.strength / 10) * (0.4 + 0.6 * tasteDecay(seed.updated));
    if (domCrit) {
      const rr = seed.type === 'tv' ? averagedSeasonRatings(seed) : (seed.ratings || {});
      if ((rr[domCrit.key] || 0) >= 8) w *= 1.15;
    }

    const creators = new Set();
    (data.credits?.crew || []).filter(c => c.job === 'Director' || c.job === 'Creator').forEach(c => {
      creators.add(c.id); names.directors[c.id] = c.name;
    });
    (data.created_by || []).forEach(c => {
      creators.add(c.id); names.directors[c.id] = c.name;
    });
    creators.forEach(id => { signals.directors[id] = (signals.directors[id] || 0) + w * 2.5; });

    (data.credits?.cast || []).slice(0, 5).forEach(c => {
      names.cast[c.id] = c.name;
      const adj = typeof getActorAdj === 'function' ? getActorAdj(c.id) : 0;
      const mult = Math.max(0.3, 1 + adj * 0.45);
      signals.cast[c.id] = (signals.cast[c.id] || 0) + w * 2.2 * mult;
    });

    (data.genres || []).forEach(g => {
      signals.genres[g.id] = (signals.genres[g.id] || 0) + w * 1.5;
    });

    const kws = data.keywords?.keywords || data.keywords?.results || [];
    kws.slice(0, 12).forEach(k => {
      signals.keywords[k.id] = (signals.keywords[k.id] || 0) + w * 1.2;
    });
  }

  // Підмішуємо улюблених акторів із ручним бустом (🔥) або високим власним рейтингом
  for (const [aidStr, adj] of Object.entries(actorAdjust || {})) {
    const aid = parseInt(aidStr);
    if (adj > 0) signals.cast[aid] = (signals.cast[aid] || 0) + adj * 2.5;
  }

  // Негативні сигнали (оцінки <=4, Закинуто + сховані рекомендації)
  for (const { seed, data } of antiDetails) {
    const aw = seed.status === 'dropped' ? 1.1 : 1.4;
    (data.credits?.crew || []).filter(c => c.job === 'Director' || c.job === 'Creator').forEach(c => {
      anti.directors[c.id] = (anti.directors[c.id] || 0) + aw * 1.5;
    });
    (data.created_by || []).forEach(c => { anti.directors[c.id] = (anti.directors[c.id] || 0) + aw * 1.5; });
    (data.genres || []).forEach(g => { anti.genres[g.id] = (anti.genres[g.id] || 0) + aw * 0.8; });
    const kws = data.keywords?.keywords || data.keywords?.results || [];
    kws.slice(0, 10).forEach(k => { anti.keywords[k.id] = (anti.keywords[k.id] || 0) + aw; });
  }
  for (const d of Object.values(dismissedRecs || {})) {
    (d.genres || []).forEach(gid => { anti.genres[gid] = (anti.genres[gid] || 0) + 0.35; });
  }

  const moodData = mood && MOODS[mood] ? MOODS[mood] : null;
  const topKw = Object.entries(signals.keywords)
    .filter(([id]) => !anti.keywords[id])
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  const topGenres = Object.entries(signals.genres)
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => parseInt(id));
  const topCast = Object.entries(signals.cast)
    .filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => parseInt(id));
  const topDirectors = Object.entries(signals.directors)
    .filter(([id]) => !anti.directors[id])
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => parseInt(id));

  const unique = new Map();
  const ensureCandidate = (raw, type) => {
    if (!raw || !raw.poster_path) return null;
    if (isExcludedShow(raw, type)) return null;
    const key = `${type}-${raw.id}`;
    if (lib[key] || (typeof isDismissed === 'function' && isDismissed(key))) return null;
    let entry = unique.get(key);
    if (!entry) {
      const item = normalizeItem({ ...raw, media_type: type });
      entry = { ...item, _score: 0, _reasons: [], _seenTags: new Set() };
      unique.set(key, entry);
    }
    return entry;
  };
  const addReason = (entry, tag, text, priority) => {
    if (!entry || entry._seenTags.has(tag)) return;
    entry._seenTags.add(tag);
    entry._reasons.push({ priority, text });
  };

  // Джерело 1: Прямі TMDB рекомендації від наших сідів (нуль зайвих запитів!)
  for (const { seed, data } of seedDetails) {
    const recs = (data.recommendations?.results || []).slice(0, 12);
    const seedRatingLabel = seed.avg > 0 ? ` (${fmtNum(seed.avg)})` : (seed.isFav ? ' ❤️' : '');
    const boost = 2.6 * (seed.strength / 10);
    recs.forEach((r, idx) => {
      const t = r.media_type || seed.type;
      const entry = ensureCandidate(r, t);
      if (!entry) return;
      entry._score += boost * (1 - idx * 0.04);
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
  const pages = [1];

  // Movies & TV Discover за ключовими словами + жанрами
  ['movie', 'tv'].forEach(type => {
    if (topKw.length || topGenres.length) {
      pages.forEach(page => {
        const p = baseDiscover(type);
        p.set('page', String(page));
        if (topKw.length) p.set('with_keywords', topKw.join('|'));
        if (topGenres.length) p.set('with_genres', topGenres.slice(0, 3).join('|'));
        fetchPromises.push(tmdbFetch(`/discover/${type}?${p}`).then(d => ({ type, results: d.results || [], source: 'personalized' })).catch(() => ({ type, results: [], source: 'personalized' })));
      });
    }
    if (topGenres.length) {
      pages.forEach(page => {
        const pg = baseDiscover(type);
        pg.set('page', String(page));
        pg.set('with_genres', topGenres.slice(0, 3).join('|'));
        fetchPromises.push(tmdbFetch(`/discover/${type}?${pg}`).then(d => ({ type, results: d.results || [], source: 'genres' })).catch(() => ({ type, results: [], source: 'genres' })));
      });
    }
    if (moodData) {
      pages.forEach(page => {
        const pm = baseDiscover(type);
        pm.set('page', String(page));
        pm.set('with_genres', (type === 'tv' ? (moodData.tvGenres || moodData.genres) : moodData.genres).join('|'));
        fetchPromises.push(tmdbFetch(`/discover/${type}?${pm}`).then(d => ({ type, results: d.results || [], source: 'mood' })).catch(() => ({ type, results: [], source: 'mood' })));
      });
    }
  });

  // Акторські запити (фільми через discover with_cast + серіали через person/tv_credits)
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

  // Режисерські запити
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
        entry._score += 2.2;
        addReason(entry, 'mood', `${moodData.emoji} ${moodData.label}`, 8);
      } else if (batch.source === 'director') {
        entry._score += 1.9;
        const dName = names.directors[batch.dirId];
        addReason(entry, 'dir-' + batch.dirId, dName ? `Режисер: ${dName}` : 'Твій режисер', 9);
      } else if (batch.source === 'cast') {
        const adj = typeof getActorAdj === 'function' ? getActorAdj(batch.actorId) : 0;
        if (adj < 0) continue;
        entry._score += 1.6 + adj * 0.5;
        const aName = names.cast[batch.actorId];
        addReason(entry, 'cast-' + batch.actorId, aName ? `З ${aName}` : 'Актор з улюблених', 7);
      } else if (batch.source === 'personalized') {
        entry._score += 1.2;
      } else if (batch.source === 'genres') {
        entry._score += 0.6;
      }
    }
  }

  // Фінальний підрахунок скору + фільтрація під режим + легкий jitter
  const byType = { movie: [], tv: [] };
  for (const entry of unique.values()) {
    if (mode === 'gems' && (entry.votes > 2500 || entry.tmdbRating < 7.0)) continue;
    if (mode === 'fresh' && ((parseInt(entry.year) || 0) < currentYear - 2)) continue;

    // Якість + популярність (в "Перлинах" популярність не накручує скор)
    const qual = (entry.tmdbRating / 10) * 1.1;
    const pop = mode === 'gems' ? 0 : Math.min(entry.popularity / 180, 0.7);
    entry._score += qual + pop;

    // Жанровий збіг з твоїм смаком
    let genreBoost = 0;
    let bestGenreId = null, bestGenreW = 0;
    (entry.genres || []).forEach(gid => {
      const w = signals.genres[gid] || 0;
      if (w > 0) {
        genreBoost += Math.min(w * 0.25, 0.8);
        if (w > bestGenreW) { bestGenreW = w; bestGenreId = gid; }
      }
      const aw = anti.genres[gid] || 0;
      if (aw > 0) entry._score -= Math.min(aw * 0.45, 1.4);
    });
    entry._score += Math.min(genreBoost, 1.8);

    if (bestGenreId && entry._reasons.length === 0) {
      const g = GENRES.find(x => x.id === bestGenreId);
      if (g) addReason(entry, 'genre-' + g.id, `Твій жанр · ${g.name}`, 3);
    }
    if (domCrit && entry._reasons.length < 2 && entry._score >= 3.0) {
      addReason(entry, 'dom-crit', `Під «${domCrit.label}»`, 2);
    }

    entry._reasons = entry._reasons
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 2)
      .map(x => x.text);

    // Легкий jitter (±8%) щоб топ лишався сильним, але оновлення освіжали стрічку
    entry._sortScore = entry._score * (0.92 + Math.random() * 0.16);
    delete entry._seenTags;

    if (byType[entry.type]) byType[entry.type].push(entry);
  }

  const pickTop = (t) => byType[t].sort((a, b) => b._sortScore - a._sortScore).slice(0, 80);
  return { items: [...pickTop('movie'), ...pickTop('tv')], seeds: seeds.length, mood, mode };
}

function readGeneralCache() {
  try { const c = JSON.parse(localStorage.getItem(GEN_CACHE)); if (c && Date.now() - c.ts < GEN_TTL) return c.data; } catch {}
  return null;
}
function writeGeneralCache(g) {
  try {
    if (!Object.values(g).some(a => a && a.length)) return;
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
  const container = el('div', 'taste-summary-container');
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
  const seedSig = seeds.map(s => `${s.key}:${s.strength.toFixed(1)}`).join('|');
  const antiSig = getAntiSeeds().map(a => a.key).join(',');
  const adjSig = Object.entries(actorAdjust || {}).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`).join(',');
  return `${seedSig}|anti:${antiSig}|adj:${adjSig}|mood:${state.home.mood || 'any'}|mode:${state.home.mode || 'balance'}`;
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
      const [trM, newM, topM, trT, newT, topT] = await Promise.all([
        tmdbFetch('/trending/movie/week?language=uk-UA').catch(() => ({ results: [] })),
        tmdbFetch('/discover/movie?language=uk-UA&sort_by=primary_release_date.desc&vote_count.gte=50&page=1').catch(() => ({ results: [] })),
        tmdbFetch('/discover/movie?language=uk-UA&sort_by=vote_average.desc&vote_count.gte=1000&page=1').catch(() => ({ results: [] })),
        tmdbFetch('/trending/tv/week?language=uk-UA').catch(() => ({ results: [] })),
        tmdbFetch(`/discover/tv?language=uk-UA&sort_by=first_air_date.desc&vote_count.gte=50&without_genres=${EXCLUDED_TV_GENRES.join(',')}&page=1`).catch(() => ({ results: [] })),
        tmdbFetch(`/discover/tv?language=uk-UA&sort_by=vote_average.desc&vote_count.gte=500&without_genres=${EXCLUDED_TV_GENRES.join(',')}&page=1`).catch(() => ({ results: [] }))
      ]);
      const cleanGen = (res, type) => (res.results || [])
        .filter(r => r.poster_path && !isExcludedShow(r, type))
        .map(r => normalizeItem({ ...r, media_type: type }))
        .slice(0, 10);
      state.home.general = {
        trMovies: cleanGen(trM, 'movie'),
        newMovies: cleanGen(newM, 'movie'),
        topMovies: cleanGen(topM, 'movie'),
        trTV: cleanGen(trT, 'tv'),
        newTV: cleanGen(newT, 'tv'),
        topTV: cleanGen(topT, 'tv')
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
    const renderBlock = (title, sub, items) => {
      if (!items || !items.length) return;
      const s = el('section', 'home-section');
      const head = el('div', 'section-head');
      head.append(el('h2', 'section-title', title));
      head.append(el('span', 'section-sub', sub));
      s.append(head);
      const grid = el('div', 'home-grid');
      items.slice(0, 10).forEach(item => grid.append(recCard(item, false)));
      s.append(grid);
      wrap.append(s);
    };

    if (state.home.tab === 'movie') {
      renderBlock('🔥 Популярні фільми', 'сьогодні', g.trMovies);
      renderBlock('🎬 Нові фільми', 'свіже', g.newMovies);
      renderBlock('🏆 Найрейтинговіші фільми', 'класика', g.topMovies);
    } else {
      renderBlock('🔥 Популярні серіали', 'сьогодні', g.trTV);
      renderBlock('📺 Нові серіали', 'свіже', g.newTV);
      renderBlock('🏆 Найрейтинговіші серіали', 'класика', g.topTV);
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
  const sec = el('section', 'home-section');
  sec.style.maxWidth = '720px';
  sec.style.margin = '0 auto';
  sec.style.padding = '0 16px';
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
