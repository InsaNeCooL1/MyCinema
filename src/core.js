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
    calendarMonth: null,
    calendarStatus: 'all',
    tab: 'movie', 
    general: null, 
    mood: null, 
    mode: 'balance',
    tasteExpanded: false 
  },
  game: { active: false, type: 'movie', round: 0, totalRounds: 20, champion: null, challenger: null, history: [], finished: false, pool: [], seen: new Set(), usedPages: new Set() },
  stats: { tab: 'taste', actorTab: 'rating', castLoading: false, castProgress: { done: 0, total: 0 } },
  librarySearch: '', librarySort: 'updated'
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
function fmtNum(n) { return n.toFixed(1).replace('.', ','); }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function ratingClass(avg) { return avg >= 8 ? 'green' : (avg >= 6 ? 'yellow' : 'red'); }

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
function isLightTheme(name) { const t = THEMES[name]; return t ? t.light : false; }
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

  return changed;
}

async function reconcileWithCloud() {
  const ref = window.firestoreDoc(window.firestoreDB, 'libraries', window.currentUser.uid);
  const snap = await window.firestoreGetDoc(ref);
  const cloud = snap.exists() ? snap.data() : {};
  const merged = mergeLibraries(lib, libTombstones, cloud.items || {}, cloud.deleted || {});

  const libChanged = JSON.stringify(merged.items) !== JSON.stringify(lib);
  lib = merged.items;
  libTombstones = merged.deleted;
  saveLocalOnly();

  const extrasChanged = mergeCloudExtras(cloud);

  await window.firestoreSetDoc(ref, {
    items: lib,
    deleted: libTombstones,
    dismissed: dismissedRecs,
    dismissedClearedAt,
    actorAdjust,
    actorAdjustTs,
    updatedAt: new Date(),
    email: window.currentUser.email
  });
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
