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
function tasteDecay(updated) {
  const days = (Date.now() - (updated || Date.now())) / (24 * 60 * 60 * 1000);
  return Math.pow(0.97, days); // -3% щодня
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
function saveActorAdjust() { try { localStorage.setItem(ACTOR_ADJUST_KEY, JSON.stringify(actorAdjust)); } catch {} }
function getActorAdj(actorId) { return actorAdjust[actorId] || 0; }
function setActorAdj(actorId, val) { if (val === 0) delete actorAdjust[actorId]; else actorAdjust[actorId] = val; saveActorAdjust(); }

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
async function reconcileWithCloud() {
  const ref = window.firestoreDoc(window.firestoreDB, 'libraries', window.currentUser.uid);
  const snap = await window.firestoreGetDoc(ref);
  const cloud = snap.exists() ? snap.data() : {};
  const merged = mergeLibraries(lib, libTombstones, cloud.items || {}, cloud.deleted || {});

  const changedLocal = JSON.stringify(merged.items) !== JSON.stringify(lib);
  lib = merged.items;
  libTombstones = merged.deleted;
  saveLocalOnly();

  await window.firestoreSetDoc(ref, {
    items: lib, deleted: libTombstones, updatedAt: new Date(), email: window.currentUser.email
  });
  return changedLocal;
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
