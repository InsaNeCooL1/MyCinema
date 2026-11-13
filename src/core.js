'use strict';

// ============ SETTINGS ============
const settings = {
  themeBg: localStorage.getItem('mycinema.theme.bg') || 'navy',
  themeAccent: localStorage.getItem('mycinema.theme.accent') || 'amber',
  posterBg: localStorage.getItem('mycinema.posterBg') === 'true'
};

// ============ STATE ============
let lib = load();
let actorAdjust = (() => { try { return JSON.parse(localStorage.getItem(ACTOR_ADJUST_KEY)) || {}; } catch { return {}; } })();
let state = {
  tab: 'home', typeFilter: 'all', topTypeFilter: 'all',
  filter: { query: '', type: 'all', decade: 'any', genre: 'any', minRating: 0, sortBy: 'popularity.desc', streaming: null },
  home: { 
    loading: false, 
    recs: null, 
    sig: null, 
    shown: { movie: 20, tv: 20 }, // <--- ДОДАНО ОСЬ ЦЕ
    tab: 'movie', 
    general: null, 
    mood: null, 
    mode: 'balance',
    tasteExpanded: false 
  },
  game: { active: false, type: 'movie', round: 0, totalRounds: 20, champion: null, challenger: null, history: [], finished: false, pool: [], seen: new Set(), usedPages: new Set() },
  stats: { tab: 'taste', actorTab: 'rating', castLoading: false, castProgress: { done: 0, total: 0 } },
  librarySearch: '', librarySort: 'updated',
  calendarMonth: null, calendarStatus: 'all'
};
let cardStack = [];
let filterPage = 1;
let filterLoading = false;

// ============ DOM REFS ============
const input = document.getElementById("q");
const box = document.getElementById("results");
const overlay = document.getElementById("overlay");
const card = document.getElementById("card");
const autocomplete = document.getElementById("autocomplete");
const typeFilterBar = document.getElementById("type-filter");
const syncIndicator = document.getElementById('sync-indicator');

// ============ UTILS ============
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function clampNum(v, min, max) { return Math.max(min, Math.min(max, v)); }
function fmtNum(n) { return n.toFixed(1).replace('.', ','); }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function ratingClass(avg) { return avg >= 8 ? 'green' : (avg >= 6 ? 'yellow' : 'red'); }

// [ESCAPE-HTML] Безпечне екранування для вставок у HTML
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ============ RATINGS ============
function computeAverage(ratings) {
  if (!ratings) return 0;
  const vals = RATING_CRITERIA.map(c => ratings[c.key] || 0).filter(v => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
function countFilled(ratings) { return ratings ? RATING_CRITERIA.filter(c => ratings[c.key] > 0).length : 0; }
function computeItemRating(item) {
  if (!item) return { avg: 0, complete: false, rated: 0, total: 0 };
  if (item.type === 'tv') {
    const sr = item.seasonRatings || {};
    const ratedKeys = Object.keys(sr).filter(k => computeAverage(sr[k]) > 0);
    const total = item.totalSeasons || ratedKeys.length || 0;
    if (!ratedKeys.length) return { avg: 0, complete: false, rated: 0, total };
    const avgs = ratedKeys.map(k => computeAverage(sr[k]));
    return { avg: avgs.reduce((a, b) => a + b, 0) / avgs.length, complete: total > 0 && ratedKeys.length >= total, rated: ratedKeys.length, total };
  }
  const avg = computeAverage(item.ratings);
  return { avg, complete: avg > 0, rated: avg > 0 ? 1 : 0, total: 1 };
}
function hasWatched(item) {
  if (!item) return false;
  if (item.status === 'watched' || item.status === 'watching') return true;
  if (item.ratings && Object.values(item.ratings).some(v => v > 0)) return true;
  if (item.seasonRatings && Object.keys(item.seasonRatings).length > 0) return true;
  if (item.watchedEpisodes && item.watchedEpisodes.length > 0) return true;
  return false;
}
function tasteDecay(updated, halfLifeDays) {
  const days = Math.max(0, (Date.now() - (updated || Date.now())) / (24 * 60 * 60 * 1000));
  const hl = halfLifeDays || (typeof TASTE_HALFLIFE_DAYS !== 'undefined' ? TASTE_HALFLIFE_DAYS : 180);
  return Math.pow(0.5, days / hl);
}
function averagedSeasonRatings(item) {
  const sr = item.seasonRatings || {};
  const keys = Object.keys(sr).filter(k => Object.keys(sr[k] || {}).length > 0);
  if (!keys.length) return item.ratings || {};
  const sums = {}, counts = {};
  for (const k of keys) for (const crit of RATING_CRITERIA) {
    if (sr[k][crit.key]) { sums[crit.key] = (sums[crit.key] || 0) + sr[k][crit.key]; counts[crit.key] = (counts[crit.key] || 0) + 1; }
  }
  const r = {};
  for (const crit of RATING_CRITERIA) r[crit.key] = counts[crit.key] ? sums[crit.key] / counts[crit.key] : 0;
  return r;
}
function computeTasteVector() {
  const rated = Object.values(lib).map(x => ({ item: x, r: computeItemRating(x) })).filter(x => x.r.avg > 0);
  if (!rated.length) return null;
  const sums = {}, weights = {};
  for (const crit of RATING_CRITERIA) { sums[crit.key] = 0; weights[crit.key] = 0; }
  for (const { item } of rated) {
    const w = tasteDecay(item.updated);
    const rr = item.type === 'tv' ? averagedSeasonRatings(item) : (item.ratings || {});
    for (const crit of RATING_CRITERIA) if (rr[crit.key]) { sums[crit.key] += rr[crit.key] * w; weights[crit.key] += w; }
  }
  const result = { count: rated.length, movieCount: rated.filter(x => x.item.type === 'movie').length, tvCount: rated.filter(x => x.item.type === 'tv').length };
  for (const crit of RATING_CRITERIA) result[crit.key] = weights[crit.key] > 0 ? sums[crit.key] / weights[crit.key] : 0;
  return result;
}

function getItemCastRating(item) {
  if (!item) return 0;
  if (item.type === 'tv') {
    const sr = item.seasonRatings || {};
    const vals = Object.values(sr).map(s => (s && s.cast) || 0).filter(v => v > 0);
    if (vals.length) return vals.reduce((a, b) => a + b, 0) / vals.length;
    return (item.ratings && item.ratings.cast) || 0;
  }
  return (item.ratings && item.ratings.cast) || 0;
}

function getItemFranchiseKey(item) {
  if (!item) return null;
  if (item.franchiseKey) return item.franchiseKey;
  if (item.type === 'movie' && item.collection?.id) return 'col-' + item.collection.id;
  return null;
}

function computeActorProfiles() {
  const items = Object.values(lib);

  const ratedCastItems = items
    .map(item => ({ item, castRating: getItemCastRating(item) }))
    .filter(x => x.castRating > 0);

  // Історичне середнє критерію «Персонажі і каст»
  const globalCastAvg = ratedCastItems.length
    ? ratedCastItems.reduce((s, x) => s + x.castRating, 0) / ratedCastItems.length
    : 7.2;

  const tmdbPairs = ratedCastItems.filter(x => x.item.tmdbRating > 0);
  const globalTmdbAvg = tmdbPairs.length
    ? tmdbPairs.reduce((s, x) => s + x.item.tmdbRating, 0) / tmdbPairs.length
    : 6.9;

  const G = globalCastAvg;
  const hitTagDelta = Math.max(0.4, Math.min(0.8, (10 - G) * 0.55));
  const hiScale = Math.max(0.8, Math.min(1.3, 10 - G));

  const actorMap = new Map();
  items.forEach(item => {
    const castRating = getItemCastRating(item);
    const watched = hasWatched(item);
    if (castRating <= 0 && !watched) return;

    const fKey = getItemFranchiseKey(item);
    (item.cast || []).forEach((a, idx) => {
      if (!a || !a.id) return;
      if (!actorMap.has(a.id)) {
        actorMap.set(a.id, {
          id: a.id,
          name: a.name,
          profile_path: a.profile_path || null,
          watchedCount: 0,
          ratedEntries: []
        });
      }
      const entry = actorMap.get(a.id);
      if (!entry.profile_path && a.profile_path) entry.profile_path = a.profile_path;
      if (watched) entry.watchedCount++;
      if (castRating > 0) {
        entry.ratedEntries.push({ item, castRating, idx, fKey });
      }
    });
  });

  const actors = new Map();
  for (const a of actorMap.values()) {
    const rated = a.ratedEntries;
    const adj = typeof getActorAdj === 'function' ? getActorAdj(a.id) : 0;

    if (!rated.length) {
      actors.set(a.id, {
        id: a.id,
        name: a.name,
        profile_path: a.profile_path,
        watchedCount: a.watchedCount,
        ratedCount: 0,
        effCount: 0,
        rawAvg: 0,
        shrunk: 0,
        score: 0,
        leadCount: 0,
        hitCount: 0,
        missCount: 0,
        isAnti: adj < 0,
        adj,
        recSignal: adj > 0 ? adj * 0.45 : (adj < 0 ? adj * 0.85 : 0)
      });
      continue;
    }

    // Сильніша/головніша частина кожної франшизи = 1.0, далі 0.45 -> 0.25 -> 0.15
    const sorted = [...rated].sort((x, y) => {
      const lx = x.idx <= ACTOR_LEAD_MAX_INDEX ? 1 : 0;
      const ly = y.idx <= ACTOR_LEAD_MAX_INDEX ? 1 : 0;
      return (ly - lx) || (y.castRating - x.castRating) || (parseInt(x.item.year || '9999') - parseInt(y.item.year || '9999'));
    });

    const frSeen = {};
    const frEff = {};
    const frRaw = {};

    let sumW = 0;
    let sumWC = 0;
    let effCount = 0;
    let leadCount = 0;
    let leadGoodW = 0;
    let hitCount = 0;
    let hitW = 0;
    let missCount = 0;
    let penWeightedSum = 0;
    let sumRecW = 0;
    let sumRecRes = 0;

    for (const r of sorted) {
      const roleW = r.idx <= ACTOR_LEAD_MAX_INDEX ? 1.35 : (r.idx <= 6 ? 0.90 : 0.55);
      let fw = 1.0;
      if (r.fKey) {
        const k = frSeen[r.fKey] || 0;
        frSeen[r.fKey] = k + 1;
        fw = k === 0 ? 1.0 : (k === 1 ? 0.45 : (k === 2 ? 0.25 : 0.15));
        frEff[r.fKey] = (frEff[r.fKey] || 0) + fw;
        frRaw[r.fKey] = (frRaw[r.fKey] || 0) + 1;
      }

      const w = roleW * fw;
      const delta = r.castRating - G;

      sumW += w;
      sumWC += w * r.castRating;
      effCount += fw;

      if (r.idx <= ACTOR_LEAD_MAX_INDEX) {
        leadCount++;
        if (delta >= ACTOR_PENALTY_START) leadGoodW += w;
      }

      if (delta > 0.30) {
        const hitStr = clampNum((delta - 0.30) / hiScale, 0, 1);
        hitW += w * hitStr;
        if (delta >= hitTagDelta) hitCount++;
      }

      if (delta < ACTOR_PENALTY_START) {
        // Плавний % штраф: -0.85 -> 10%, -1.50 -> ~20%, кап 25%
        const projPen = Math.min(ACTOR_PENALTY_CAP, 0.10 * Math.pow((ACTOR_PENALTY_START - delta) / 0.50, 0.85));
        penWeightedSum += w * projPen;
        if (delta <= ACTOR_PENALTY_10_DELTA) missCount++;
      }

      const dec = tasteDecay(r.item.updated);
      const res = r.item.tmdbRating > 0
        ? (r.castRating - G) - (r.item.tmdbRating - globalTmdbAvg)
        : (r.castRating - G);
      sumRecW += w * dec;
      sumRecRes += w * dec * res;
    }

    const rawAvg = sumW > 0 ? sumWC / sumW : 0;
    const stabAvg = (effCount * rawAvg + 2.0 * G) / (effCount + 2.0);

    // Прогресія відносно бази 6 (тільки для Топу в Обсерваторії)
    let countMod = 0;
    if (effCount < ACTOR_REF_PROJECTS) {
      countMod = -0.95 * Math.pow((ACTOR_REF_PROJECTS - effCount) / (ACTOR_REF_PROJECTS - 1), 1.15);
    } else if (effCount > ACTOR_REF_PROJECTS) {
      const qualFactor = clampNum((rawAvg - (G - 0.6)) / 1.4, 0, 1);
      countMod = Math.min(0.40, 0.25 * Math.log(1 + (effCount - ACTOR_REF_PROJECTS) / ACTOR_REF_PROJECTS)) * qualFactor;
    }

    const leadBonusPct = 0.032 * (leadGoodW / (sumW + 2.0));
    const hitBonusPct = 0.055 * (hitW / (sumW + 2.0));
    const avgPenPct = penWeightedSum / (sumW + 0.5);

    // Посилений штраф за концентрацію в одній франшизі (> 35%, до -9%)
    let maxFrEff = 0;
    let maxFrRaw = 0;
    for (const fk of Object.keys(frEff)) {
      if (frEff[fk] > maxFrEff) {
        maxFrEff = frEff[fk];
        maxFrRaw = frRaw[fk];
      }
    }
    const frShare = effCount > 0 ? maxFrEff / effCount : 0;
    const franchisePenaltyPct = (maxFrRaw >= 2 && frShare > 0.35)
      ? Math.min(ACTOR_FRANCHISE_CAP, ((frShare - 0.35) / 0.65) * ACTOR_FRANCHISE_CAP)
      : 0;

    // Спосіб 1: відсоткові модифікатори до стабілізованої бази
    const shrunkBase = stabAvg * (1 + leadBonusPct + hitBonusPct) * (1 - avgPenPct) * (1 - franchisePenaltyPct);
    const shrunk = shrunkBase + adj * ACTOR_ADJUST_STEP;

    const avgRes = sumRecW > 0 ? sumRecRes / sumRecW : 0;
    const adjRec = adj > 0 ? adj * 0.45 : (adj < 0 ? adj * 0.85 : 0);
    const recSignal = (shrunkBase - G) * 0.75 + clampNum(avgRes, -2.5, 2.5) * 0.35 + adjRec;

    // Для Топу акторів: з countMod та стелею rawAvg + 0.5 (+ ручний 🔥)
    const rawScore = shrunk + countMod;
    const scoreCap = rawAvg + 0.5 + (adj > 0 ? adj * ACTOR_ADJUST_STEP : 0);
    const score = clampNum(Math.min(scoreCap, rawScore), 1, 10);

    const isAnti = adj < 0 || (rated.length >= 2 && (rawAvg <= G - 1.35 || (missCount >= 3 && hitCount === 0)));

    actors.set(a.id, {
      id: a.id,
      name: a.name,
      profile_path: a.profile_path,
      watchedCount: a.watchedCount,
      ratedCount: rated.length,
      effCount,
      rawAvg,
      shrunk,
      score,
      leadCount,
      hitCount,
      missCount,
      isAnti,
      adj,
      recSignal
    });
  }

  return { globalCastAvg, globalTmdbAvg, actors };
}

// ============ THEMES ============
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0,2), 16), parseInt(h.slice(2,4), 16), parseInt(h.slice(4,6), 16)].join(',');
}
function applyTheme(bgName, accentName) {
  if (!THEMES[bgName]) bgName = 'navy';
  if (!ACCENTS[accentName]) accentName = 'amber';
  const t = THEMES[bgName], a = ACCENTS[accentName];
  const r = document.documentElement.style;
  r.setProperty('--bg-0', t.bg0); r.setProperty('--bg-1', t.bg1); r.setProperty('--bg-2', t.bg2);
  r.setProperty('--bg-3', t.bg3); r.setProperty('--bg-4', t.bg4);
  r.setProperty('--bg-sidebar', t.sidebar); r.setProperty('--bg-query', t.query);
  r.setProperty('--text', t.text); r.setProperty('--text-secondary', t.textSecondary);
  r.setProperty('--text-muted', t.textMuted); r.setProperty('--text-dim', t.textDim);
  r.setProperty('--accent', a.accent); r.setProperty('--accent-hover', a.hover); r.setProperty('--accent-fg', a.fg);
  r.setProperty('--accent-rgb', hexToRgb(a.accent));
  settings.themeBg = bgName; settings.themeAccent = accentName;
  localStorage.setItem('mycinema.theme.bg', bgName);
  localStorage.setItem('mycinema.theme.accent', accentName);
}
applyTheme(settings.themeBg, settings.themeAccent);

// ============ ACTOR ADJUST ============
const ACTOR_ADJUST_TS_KEY = 'mycinema.actorAdjustTs';
let actorAdjustTs = (() => { try { return JSON.parse(localStorage.getItem(ACTOR_ADJUST_TS_KEY)) || {}; } catch { return {}; } })();
function saveActorAdjust() {
  try {
    localStorage.setItem(ACTOR_ADJUST_KEY, JSON.stringify(actorAdjust));
    localStorage.setItem(ACTOR_ADJUST_TS_KEY, JSON.stringify(actorAdjustTs));
  } catch {}
}
function getActorAdj(actorId) { return actorAdjust[actorId] || 0; }
function setActorAdj(actorId, val) {
  if (val === 0) delete actorAdjust[actorId];
  else actorAdjust[actorId] = val;
  actorAdjustTs[String(actorId)] = Date.now();
  saveActorAdjust();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}

// ============ STORAGE ============
function load() {
  let data;
  try { data = JSON.parse(localStorage.getItem(LS)) || {}; } catch { data = {}; }
  const version = parseInt(localStorage.getItem(LS_VER)) || 1;
  if (version < 2) {
    Object.values(data).forEach(item => {
      if (typeof item.rating === 'number' && item.rating > 0 && !item.ratings) item.ratings = { overall: item.rating };
      delete item.rating;
    });
    try { localStorage.setItem(LS, JSON.stringify(data)); localStorage.setItem(LS_VER, "2"); } catch {}
  }
  return data;
}
// ---- tombstones (видалені тайтли) ----
const LS_DEL = 'mycinema.deleted';
const TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000;
let libTombstones = (() => { try { return JSON.parse(localStorage.getItem(LS_DEL)) || {}; } catch { return {}; } })();

function saveLocalOnly() {
  try {
    localStorage.setItem(LS, JSON.stringify(lib));
    localStorage.setItem(LS_DEL, JSON.stringify(libTombstones));
  } catch (e) { console.error(e); showSyncToast('⚠ Сховище переповнене'); }
}

// Єдина точка видалення тайтлу з lib
function removeLibItem(key) {
  delete lib[key];
  libTombstones[key] = Date.now();
}

function mergeLibraries(localItems, localDel, cloudItems, cloudDel) {
  const now = Date.now();
  const del = { ...cloudDel };
  for (const [k, t] of Object.entries(localDel)) if (!(del[k] >= t)) del[k] = t;
  for (const k of Object.keys(del)) if (now - del[k] > TOMBSTONE_TTL) delete del[k];

  const items = {};
  for (const k of new Set([...Object.keys(localItems), ...Object.keys(cloudItems)])) {
    const a = localItems[k], b = cloudItems[k];
    const win = !a ? b : !b ? a : ((b.updated || 0) > (a.updated || 0) ? b : a);
    if (del[k] && del[k] >= (win.updated || 0)) continue; // видалено після останньої правки
    items[k] = win;
  }
  return { items, deleted: del };
}

// Читає хмару, зливає з локальним, застосовує і пише назад. true — якщо локальне змінилось.
function mergeCloudExtras(cloud) {
  let changed = false;

  // 1. Злиття схованих рекомендацій з урахуванням очищення
  const maxCleared = Math.max(dismissedClearedAt || 0, cloud.dismissedClearedAt || 0);
  const cloudDis = cloud.dismissed || {};
  const mergedDis = {};
  for (const k of new Set([...Object.keys(dismissedRecs), ...Object.keys(cloudDis)])) {
    const a = dismissedRecs[k], b = cloudDis[k];
    const win = !a ? b : !b ? a : ((b.ts || 0) > (a.ts || 0) ? b : a);
    if (win && (win.ts || 0) > maxCleared) mergedDis[k] = win;
  }
  if (JSON.stringify(mergedDis) !== JSON.stringify(dismissedRecs) || maxCleared !== dismissedClearedAt) {
    dismissedRecs = mergedDis;
    dismissedClearedAt = maxCleared;
    saveDismissed();
    changed = true;
  }

  // 2. Злиття ручних оцінок акторів (🔥 / 😞)
  const cAdj = cloud.actorAdjust || {};
  const cAdjTs = cloud.actorAdjustTs || {};
  const mergedAdj = {};
  const mergedAdjTs = {};
  for (const k of new Set([...Object.keys(actorAdjust), ...Object.keys(actorAdjustTs), ...Object.keys(cAdj), ...Object.keys(cAdjTs)])) {
    const lTs = actorAdjustTs[k] || (k in actorAdjust ? 1 : 0);
    const rTs = cAdjTs[k] || (k in cAdj ? 1 : 0);
    const val = rTs > lTs ? cAdj[k] : actorAdjust[k];
    const winTs = Math.max(lTs, rTs);
    if (winTs > 0) mergedAdjTs[k] = winTs;
    if (val) mergedAdj[k] = val;
  }
  if (JSON.stringify(mergedAdj) !== JSON.stringify(actorAdjust)) {
    actorAdjust = mergedAdj;
    actorAdjustTs = mergedAdjTs;
    saveActorAdjust();
    changed = true;
  } else {
    actorAdjustTs = mergedAdjTs;
  }

  if (cloud.appearance) applyCloudAppearance(cloud.appearance);

  return changed;
}

// ---- синхронізація налаштувань вигляду ----
const LS_APP_TS = 'mycinema.appearance.ts';

function getAppearanceTs() {
  const raw = parseInt(localStorage.getItem(LS_APP_TS), 10);
  if (!isNaN(raw) && raw > 0) return raw;
  const hasLocalPref =
    localStorage.getItem('mycinema.theme.bg') !== null ||
    localStorage.getItem('mycinema.theme.accent') !== null ||
    localStorage.getItem('mycinema.posterBg') !== null ||
    localStorage.getItem('mycinema.snowEnabled') !== null;
  return hasLocalPref ? 1 : 0;
}

function getAppearancePayload() {
  const snowRaw = localStorage.getItem('mycinema.snowEnabled');
  return {
    themeBg: settings.themeBg,
    themeAccent: settings.themeAccent,
    posterBg: !!settings.posterBg,
    snowEnabled: snowRaw === null ? true : snowRaw === 'true',
    ts: getAppearanceTs()
  };
}

function touchAppearance() {
  try { localStorage.setItem(LS_APP_TS, String(Date.now())); } catch {}
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}

function applyCloudAppearance(app) {
  if (!app || typeof app !== 'object') return false;
  const cTs = Number(app.ts) || 0;
  const lTs = getAppearanceTs();
  if (cTs <= lTs) return false;

  const bg = THEMES[app.themeBg] ? app.themeBg : settings.themeBg;
  const ac = ACCENTS[app.themeAccent] ? app.themeAccent : settings.themeAccent;
  const posterBg = typeof app.posterBg === 'boolean' ? app.posterBg : settings.posterBg;
  const snowOn = typeof app.snowEnabled === 'boolean' ? app.snowEnabled : true;

  applyTheme(bg, ac);
  settings.posterBg = posterBg;
  try {
    localStorage.setItem('mycinema.posterBg', posterBg ? 'true' : 'false');
    localStorage.setItem('mycinema.snowEnabled', snowOn ? 'true' : 'false');
    localStorage.setItem(LS_APP_TS, String(cTs));
  } catch {}

  if (typeof SnowFeature !== 'undefined') SnowFeature.apply();

  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal && settingsModal.classList.contains('open')) {
    if (typeof renderSettingsSwatches === 'function') renderSettingsSwatches();
    const pbgEl = document.getElementById('poster-bg-toggle');
    if (pbgEl) pbgEl.checked = settings.posterBg;
    const snowEl = document.getElementById('snow-toggle');
    if (snowEl) snowEl.checked = snowOn;
  }
  if (typeof cardStack !== 'undefined' && cardStack.length && typeof renderCard === 'function') {
    renderCard(true);
  }
  return true;
}

// [SYNC-SUPABASE]
async function reconcileWithCloud() {
  const uid = window.currentUser.uid;
  
  // 1. Читаємо хмару
  const { data: cloudItems, error: err1 } = await window.supabase
    .from('user_library').select('*').eq('user_id', uid);
  if (err1) throw err1;

  const { data: profile, error: err2 } = await window.supabase
    .from('profiles').select('*').eq('id', uid).single();
  if (err2 && err2.code !== 'PGRST116') throw err2; // PGRST116 = no rows

  // 2. Формуємо об'єкт cloudLib
  const cloudLib = {};
  (cloudItems || []).forEach(row => { cloudLib[row.item_key] = row.user_data; });
  
  const cloudExtras = profile?.settings || {};

  // 3. Зливаємо
  const merged = mergeLibraries(lib, libTombstones, cloudLib, cloudExtras.deleted || {});
  const libChanged = JSON.stringify(merged.items) !== JSON.stringify(lib);
  
  lib = merged.items;
  libTombstones = merged.deleted;
  saveLocalOnly();

  const extrasChanged = mergeCloudExtras(cloudExtras);

  // 4. Пишемо назад (Upsert)
  const upsertData = Object.entries(lib).map(([key, val]) => ({
    user_id: uid,
    item_key: key,
    user_data: val
  }));

  if (upsertData.length > 0) {
    const { error: errUp } = await window.supabase
      .from('user_library')
      .upsert(upsertData, { onConflict: 'user_id,item_key' });
    if (errUp) throw errUp;
  }

  // Видаляємо tombstones з бази
  const deletedKeys = Object.keys(libTombstones);
  if (deletedKeys.length > 0) {
    await window.supabase.from('user_library').delete().eq('user_id', uid).in('item_key', deletedKeys);
  }

  const { error: errProf } = await window.supabase.from('profiles').upsert({
    id: uid,
    email: window.currentUser.email,
    settings: {
      dismissed: dismissedRecs,
      dismissedClearedAt,
      actorAdjust,
      actorAdjustTs,
      appearance: getAppearancePayload(),
      deleted: libTombstones
    },
    updated_at: new Date().toISOString()
  });
  if (errProf) throw errProf;

  return libChanged || extrasChanged;
}

let _saveTimer = null;
function save() { saveLocalOnly(); clearTimeout(_saveTimer); _saveTimer = setTimeout(saveToCloud, 800); }
function saveNow() { saveLocalOnly(); clearTimeout(_saveTimer); return saveToCloud(); }

let _syncing = Promise.resolve();
function saveToCloud() {
  if (!window.currentUser || !window.firebaseReady) return Promise.resolve();
  _syncing = _syncing.then(async () => { // черга, щоб запити не перетиналися
    try {
      setSyncStatus('saving', 'Зберігаю...');
      const changed = await reconcileWithCloud();
      if (changed) refresh();
      setSyncStatus('saved', '✓');
    } catch (e) { setSyncStatus('error', '⚠ Помилка'); console.error(e); }
  });
  return _syncing;
}

async function syncFromCloud() {
  if (!window.currentUser || !window.firebaseReady) return;
  await saveToCloud(); // читання + злиття + запис
  if (Object.keys(lib).length === 0 && !localStorage.getItem('onboardingDone')) startOnboarding();
}

function setSyncStatus(status, text) {
  syncIndicator.className = 'sync-indicator visible ' + status;
  syncIndicator.textContent = text;
  if (status === 'saved') setTimeout(() => syncIndicator.classList.remove('visible'), 1800);
}

function showCenterToast(text) {
  const toast = document.createElement('div');
  toast.className = 'center-toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after 2 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function showSyncToast(text) {
  syncIndicator.className = 'sync-indicator visible saved';
  syncIndicator.textContent = text;
  clearTimeout(showSyncToast._t);
  showSyncToast._t = setTimeout(() => syncIndicator.classList.remove('visible'), 2000);
}

// ============ PLACEHOLDER ============
function rotatePlaceholder() {
  const current = input.placeholder;
  let next, attempts = 0;
  do { next = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]; attempts++; } while (next === current && attempts < 10);
  input.placeholder = next;
}
rotatePlaceholder();
input.addEventListener('blur', () => { if (!input.value.trim()) rotatePlaceholder(); });

// ============ META & PLATFORMS ============
function normalizePlatformInfo(raw) {
  if (!raw || !raw.name) return null;
  const n = raw.name.trim();
  const low = n.toLowerCase();
  const logo = raw.logo_path || raw.logo || null;
  if (low.includes('netflix')) return { key: 'netflix', name: 'Netflix', logo };
  if (low === 'hbo' || low.includes('hbo max') || low === 'max') return { key: 'max', name: 'Max / HBO', logo };
  if (low.includes('prime video') || low === 'amazon' || low.includes('amazon prime')) return { key: 'prime', name: 'Prime Video', logo };
  if (low.includes('apple tv')) return { key: 'apple', name: 'Apple TV+', logo };
  if (low.includes('disney')) return { key: 'disney', name: 'Disney+', logo };
  if (low.includes('hulu')) return { key: 'hulu', name: 'Hulu', logo };
  if (low.includes('peacock')) return { key: 'peacock', name: 'Peacock', logo };
  if (low.includes('paramount')) return { key: 'paramount', name: 'Paramount+', logo };
  if (low.includes('skyshowtime')) return { key: 'skyshowtime', name: 'SkyShowtime', logo };
  if (low.includes('megogo')) return { key: 'megogo', name: 'MEGOGO', logo };
  if (low.includes('sweet.tv') || low === 'sweet tv') return { key: 'sweettv', name: 'SWEET.TV', logo };
  return { key: low.replace(/[^a-z0-9а-яіїєґ]+/gi, '_'), name: n, logo };
}

function extractItemMeta(d, type) {
  if (!d) return {};
  const meta = {};
  if (d.genres) meta.genres = d.genres.map(g => g.id);
  if (d.credits?.cast?.length) {
    meta.cast = d.credits.cast.slice(0, CAST_LIMIT).map(a => ({ id: a.id, name: a.name, profile_path: a.profile_path }));
  }

  if (type === 'movie') {
    if (d.runtime > 0) meta.runtime = d.runtime;
    meta.collection = d.belongs_to_collection
      ? {
          id: d.belongs_to_collection.id,
          name: d.belongs_to_collection.name,
          poster: d.belongs_to_collection.poster_path || null
        }
      : null;
  } else if (type === 'tv') {
    if (d.number_of_episodes > 0) meta.episode_count = d.number_of_episodes;
    if (d.seasons) meta.totalSeasons = d.seasons.filter(s => s.season_number !== 0).length;
    let epRuntime = 0;
    if (Array.isArray(d.episode_run_time) && d.episode_run_time.length) {
      const valid = d.episode_run_time.filter(x => x > 0);
      if (valid.length) epRuntime = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    }
    if (!epRuntime && d.last_episode_to_air?.runtime > 0) epRuntime = d.last_episode_to_air.runtime;
    if (!epRuntime && d.next_episode_to_air?.runtime > 0) epRuntime = d.next_episode_to_air.runtime;
    if (!epRuntime && Array.isArray(d.seasons)) {
      const epRuntimes = [];
      d.seasons.forEach(s => (s.episodes || []).forEach(e => { if (e.runtime > 0) epRuntimes.push(e.runtime); }));
      if (epRuntimes.length) epRuntime = Math.round(epRuntimes.reduce((a, b) => a + b, 0) / epRuntimes.length);
    }
    if (epRuntime > 0) meta.runtime = epRuntime;
  }

  const platMap = new Map();
  const addPlat = (raw) => {
    const info = normalizePlatformInfo(raw);
    if (!info) return;
    if (!platMap.has(info.key)) platMap.set(info.key, info);
    else if (!platMap.get(info.key).logo && info.logo) platMap.get(info.key).logo = info.logo;
  };

  // 1. Оригінальні мережі для серіалів (Netflix, HBO, Apple TV+, FX...)
  if (Array.isArray(d.networks)) d.networks.forEach(addPlat);

  // 2. watch/providers: UA пріоритетно, або fallback US/PL/GB (тільки підписка flatrate)
  const wp = d['watch/providers']?.results || {};
  const uaFlat = wp.UA?.flatrate || [];
  if (uaFlat.length) {
    uaFlat.forEach(p => addPlat({ name: p.provider_name, logo_path: p.logo_path }));
  } else {
    ['US', 'PL', 'GB'].forEach(reg => {
      if (platMap.size < 3 && wp[reg]?.flatrate?.length) {
        wp[reg].flatrate.slice(0, 3).forEach(p => addPlat({ name: p.provider_name, logo_path: p.logo_path }));
      }
    });
  }

  if (platMap.size > 0) meta.platforms = [...platMap.values()].slice(0, 5);

  const mcuIds = typeof MCU_COMPANY_IDS !== 'undefined' ? MCU_COMPANY_IDS : [420, 38679];
  const prodIds = Array.isArray(d.production_companies) ? d.production_companies.map(c => c.id) : [];
  if (prodIds.some(id => mcuIds.includes(id))) {
    meta.franchiseKey = 'mcu';
  } else if (type === 'movie' && d.belongs_to_collection?.id) {
    meta.franchiseKey = 'col-' + d.belongs_to_collection.id;
  } else {
    meta.franchiseKey = null;
  }

  return meta;
}

// ============ DISMISSED RECS ============
const DISMISSED_KEY = 'mycinema.dismissed';
const DISMISSED_CLEARED_KEY = 'mycinema.dismissedClearedAt';
let dismissedClearedAt = parseInt(localStorage.getItem(DISMISSED_CLEARED_KEY)) || 0;
let dismissedRecs = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY)) || {};
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch { return {}; }
})();
function saveDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedRecs));
    localStorage.setItem(DISMISSED_CLEARED_KEY, String(dismissedClearedAt));
  } catch {}
}
function isDismissed(key) { return !!dismissedRecs[key]; }
function dismissRec(item) {
  if (!item || !item.key) return;
  dismissedRecs[item.key] = { ts: Date.now(), genres: item.genres || [], title: item.title || '' };
  saveDismissed();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}
function undismissRec(key) {
  delete dismissedRecs[key];
  saveDismissed();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}
function clearDismissed() {
  dismissedRecs = {};
  dismissedClearedAt = Date.now();
  saveDismissed();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}

// ============ ELO ============
function getElo(item) {
  if (!item || !item.key) return ELO_START;
  const saved = lib[item.key];
  return (saved && typeof saved.elo === 'number') ? saved.elo : ELO_START;
}

function recordEloMatch(winner, loser) {
  if (!winner || !loser || !winner.key || !loser.key) return null;

  const ensureEntry = (item) => {
    if (!lib[item.key]) {
      lib[item.key] = {
        ...item,
        status: null,
        ratings: null,
        watchedEpisodes: [],
        createdAt: Date.now()
      };
    }
    return lib[item.key];
  };

  const w = ensureEntry(winner);
  const l = ensureEntry(loser);

  const wElo = typeof w.elo === 'number' ? w.elo : ELO_START;
  const lElo = typeof l.elo === 'number' ? l.elo : ELO_START;

  const expectedWin = 1 / (1 + Math.pow(10, (lElo - wElo) / 400));
  const delta = Math.round(ELO_K * (1 - expectedWin));

  w.elo = Math.round(wElo + delta);
  w.eloGames = (w.eloGames || 0) + 1;
  w.updated = Date.now();

  l.elo = Math.round(lElo - delta);
  l.eloGames = (l.eloGames || 0) + 1;
  l.updated = Date.now();

  save();
  return { delta, winnerElo: w.elo, loserElo: l.elo };
}
