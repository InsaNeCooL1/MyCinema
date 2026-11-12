'use strict';

// ============ RECOMMENDATIONS LOGIC ============
async function buildSmartRecommendations(seeds, mood) {
  if (!seeds.length) return { items: [], seeds: 0, mood };

  const seedDetails = await Promise.all(seeds.slice(0, 6).map(async s => {
    try { const d = await tmdbFetch(`/${s.type}/${s.id}?language=uk-UA&append_to_response=credits,keywords`); return { seed: s, data: d }; } catch { return null; }
  })).then(arr => arr.filter(Boolean));
  
  const signals = { directors: {}, cast: {}, genres: {}, keywords: {} };
  
  // Оновлені ваги: Режисер 2.5, Актор 2.2, Жанр 1.5, Ключові слова 1.2
  for (const { seed, data } of seedDetails) {
    const w = (seed.avg / 10) * tasteDecay(seed.updated); // tasteDecay тепер 3% на день
    (data.credits?.crew || []).filter(c => c.job === 'Director' || c.job === 'Creator').forEach(c => {
      signals.directors[c.id] = (signals.directors[c.id] || 0) + w * 2.5;
    });
    (data.credits?.cast || []).slice(0, 5).forEach(c => {
      signals.cast[c.id] = (signals.cast[c.id] || 0) + w * 2.2;
    });
    (data.genres || []).forEach(g => {
      signals.genres[g.id] = (signals.genres[g.id] || 0) + w * 1.5;
    });
    const kws = data.keywords?.keywords || data.keywords?.results || [];
    kws.slice(0, 12).forEach(k => {
      signals.keywords[k.id] = (signals.keywords[k.id] || 0) + w * 1.2;
    });
  }
  
  const moodData = mood && MOODS[mood] ? MOODS[mood] : null;
  const topKw = Object.entries(signals.keywords).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const topGenres = Object.entries(signals.genres).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => parseInt(id));
  const topDirectors = Object.entries(signals.directors).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
  
  const fetchPromises = [];
  const pages = [1, 2, 3, 4]; // Тягнемо 4 сторінки, щоб назбирати більше унікальних тайтлів

  // MOVIES
  {
    const p = new URLSearchParams({ language: 'uk-UA', sort_by: 'popularity.desc', 'vote_count.gte': '50', 'vote_average.gte': '5.5' });
    if (topKw.length) p.set('with_keywords', topKw.join('|'));
    if (topGenres.length) p.set('with_genres', topGenres.slice(0, 3).join('|'));
    pages.forEach(page => {
      p.set('page', page);
      fetchPromises.push(tmdbFetch(`/discover/movie?${p}`).then(d => ({ type: 'movie', results: d.results || [], source: 'personalized' })).catch(() => ({ type: 'movie', results: [], source: 'personalized' })));
    });

    if (moodData) {
      const pm = new URLSearchParams({ language: 'uk-UA', sort_by: 'popularity.desc', 'vote_count.gte': '80', 'vote_average.gte': '6', with_genres: moodData.genres.join('|') });
      pages.forEach(page => {
        pm.set('page', page);
        fetchPromises.push(tmdbFetch(`/discover/movie?${pm}`).then(d => ({ type: 'movie', results: d.results || [], source: 'mood' })).catch(() => ({ type: 'movie', results: [], source: 'mood' })));
      });
    }
  }
  
  // TV
  {
    const p = new URLSearchParams({ language: 'uk-UA', sort_by: 'popularity.desc', 'vote_count.gte': '50', 'vote_average.gte': '5.5' });
    if (topKw.length) p.set('with_keywords', topKw.join('|'));
    pages.forEach(page => {
      p.set('page', page);
      fetchPromises.push(tmdbFetch(`/discover/tv?${p}`).then(d => ({ type: 'tv', results: d.results || [], source: 'personalized' })).catch(() => ({ type: 'tv', results: [], source: 'personalized' })));
    });

    if (topGenres.length) {
      const pg = new URLSearchParams({ language: 'uk-UA', sort_by: 'popularity.desc', 'vote_count.gte': '80', 'vote_average.gte': '6', with_genres: topGenres.slice(0, 3).join('|') });
      pages.forEach(page => {
        pg.set('page', page);
        fetchPromises.push(tmdbFetch(`/discover/tv?${pg}`).then(d => ({ type: 'tv', results: d.results || [], source: 'genres' })).catch(() => ({ type: 'tv', results: [], source: 'genres' })));
      });
    }

    if (moodData) {
      const pm = new URLSearchParams({ language: 'uk-UA', sort_by: 'popularity.desc', 'vote_count.gte': '80', 'vote_average.gte': '6', with_genres: (moodData.tvGenres || moodData.genres).join('|') });
      pages.forEach(page => {
        pm.set('page', page);
        fetchPromises.push(tmdbFetch(`/discover/tv?${pm}`).then(d => ({ type: 'tv', results: d.results || [], source: 'mood' })).catch(() => ({ type: 'tv', results: [], source: 'mood' })));
      });
    }
  }
  
  topDirectors.forEach(dId => {
    fetchPromises.push(tmdbFetch(`/discover/movie?language=uk-UA&with_crew=${dId}&sort_by=popularity.desc`).then(d => ({ type: 'movie', results: d.results || [], source: 'director' })).catch(() => ({ type: 'movie', results: [], source: 'director' })));
  });
  
  const all = await Promise.all(fetchPromises);
  const unique = new Map();
  
  for (const { type, results, source } of all) {
    for (const r of results) {
      if (!r.poster_path || lib[`${type}-${r.id}`]) continue;
      const item = normalizeItem({ ...r, media_type: type });
      let entry = unique.get(item.key);
      if (!entry) { entry = { ...item, _score: 0, _reasons: new Set() }; unique.set(item.key, entry); }
      
      let score = (item.tmdbRating / 10) + Math.min(item.popularity / 100, 1);
      if (source === 'mood') { score += 2.0; entry._reasons.add(moodData.emoji + ' ' + moodData.label); }
      if (source === 'director') { score += 1.5; entry._reasons.add('той самий режисер'); }
      if (source === 'personalized') score += 0.8;
      if (source === 'genres') score += 0.5;
      
      entry._score += score;
      
      const matchedGenres = (item.genres || []).filter(g => topGenres.includes(g));
      if (matchedGenres.length && entry._reasons.size < 2) {
        const g = GENRES.find(x => matchedGenres.includes(x.id));
        if (g) entry._reasons.add(`жанр «${g.name}»`);
      }
    }
  }
  
  const byType = { movie: [], tv: [] };
  for (const item of unique.values()) { 
    item._reasons = [...item._reasons].slice(0, 2); 
    byType[item.type].push(item); 
  }
  
  // Беремо топ-200, а потім перемішуємо (Fisher-Yates)
  const pickAndShuffle = (t) => {
    const sorted = byType[t].sort((a, b) => b._score - a._score).slice(0, 200);
    for (let i = sorted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    }
    return sorted;
  };

  return { items: [...pickAndShuffle('movie'), ...pickAndShuffle('tv')], seeds: seeds.length, mood };
}

const RECS_CACHE = 'mycinema.recs.v2';
const GEN_CACHE = 'mycinema.home.general.v1';
const GEN_TTL = 24 * 60 * 60 * 1000;
function readGeneralCache() {
  try { const c = JSON.parse(localStorage.getItem(GEN_CACHE)); if (c && Date.now() - c.ts < GEN_TTL) return c.data; } catch {}
  return null;
}
function writeGeneralCache(g) {
  try {
    if (!Object.values(g).some(a => a && a.length)) return; // не кешуємо порожній результат
    localStorage.setItem(GEN_CACHE, JSON.stringify({ ts: Date.now(), data: g }));
  } catch {}
}
const RECS_TTL = 24 * 60 * 60 * 1000; // 1 раз на добу

function getSeeds() {
  return Object.values(lib).map(x => ({ ...x, avg: computeItemRating(x).avg }))
    .filter(x => x.avg >= 7 && x.id)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 10);
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
  header.append(el('div', 'taste-card-meta', 'згасання · 3% на день'));
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
  allPill.addEventListener('click', () => { state.home.mood = null; state.home.sig = null; try { localStorage.removeItem(RECS_CACHE); } catch {} refresh(); });
  pills.append(allPill);
  for (const [key, m] of Object.entries(MOODS)) {
    const p = el('button', 'mood-pill' + (state.home.mood === key ? ' active' : ''));
    p.textContent = `${m.emoji} ${m.label}`;
    p.addEventListener('click', () => {
      state.home.mood = state.home.mood === key ? null : key;
      state.home.sig = null;
      try { localStorage.removeItem(RECS_CACHE); } catch {}
      refresh();
    });
    pills.append(p);
  }
  sec.append(pills);
  return sec;
}

// ============ LOAD & RENDER ============
async function loadHome() {
  if (state.tab !== 'home') return;
  const seeds = getSeeds();
  const taste = computeTasteVector();
  const sig = (seeds.map(s => s.key + ':' + s.avg.toFixed(1)).join('|')) + '|mood:' + (state.home.mood || 'any');

  if (!state.home.general) { const gc = readGeneralCache(); if (gc) state.home.general = gc; }
  if (!state.home.general) {
    try {
      const [trM, newM, topM, trT, newT, topT] = await Promise.all([
        tmdbFetch('/trending/movie/week?language=uk-UA').catch(() => ({ results: [] })),
        tmdbFetch('/discover/movie?language=uk-UA&sort_by=primary_release_date.desc&vote_count.gte=50&page=1').catch(() => ({ results: [] })),
        tmdbFetch('/discover/movie?language=uk-UA&sort_by=vote_average.desc&vote_count.gte=1000&page=1').catch(() => ({ results: [] })),
        tmdbFetch('/trending/tv/week?language=uk-UA').catch(() => ({ results: [] })),
        tmdbFetch('/discover/tv?language=uk-UA&sort_by=first_air_date.desc&vote_count.gte=50&page=1').catch(() => ({ results: [] })),
        tmdbFetch('/discover/tv?language=uk-UA&sort_by=vote_average.desc&vote_count.gte=500&page=1').catch(() => ({ results: [] }))
      ]);
      state.home.general = {
        trMovies: trM.results.map(r => normalizeItem({ ...r, media_type: 'movie' })).filter(x => x.poster).slice(0, 10),
        newMovies: newM.results.map(r => normalizeItem({ ...r, media_type: 'movie' })).filter(x => x.poster).slice(0, 10),
        topMovies: topM.results.map(r => normalizeItem({ ...r, media_type: 'movie' })).filter(x => x.poster).slice(0, 10),
        trTV: trT.results.map(r => normalizeItem({ ...r, media_type: 'tv' })).filter(x => x.poster).slice(0, 10),
        newTV: newT.results.map(r => normalizeItem({ ...r, media_type: 'tv' })).filter(x => x.poster).slice(0, 10),
        topTV: topT.results.map(r => normalizeItem({ ...r, media_type: 'tv' })).filter(x => x.poster).slice(0, 10)
      };
      writeGeneralCache(state.home.general);
    } catch (e) { console.error(e); }
  }

  if (!seeds.length) {
    state.home.recs = { items: [], seeds: 0, mood: state.home.mood };
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
  box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Підбираю рекомендації...</div>';
  try {
    const data = await buildSmartRecommendations(seeds, state.home.mood);
    writeRecsCache(sig, data);
    state.home.recs = data;
    state.home.sig = sig;
    state.home.shown = { movie: 20, tv: 20 }; // Скидаємо лічильник при новому завантаженні
    renderHomeContent(taste);
  } catch (e) { box.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: ${e.message}</div>`; }
  finally { state.home.loading = false; }
}

function recCard(item) {
  const c = el('div', 'rec-card');
  const p = el('img', 'rec-poster'); p.src = TMDB_IMG + 'w342' + item.poster; p.loading = 'lazy';
  c.append(p);
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

function renderHomeContent(taste) {
  if (state.tab !== 'home') return;
  box.replaceChildren(); box.style.padding = '0';

  box.append(renderTasteSummary(taste || computeTasteVector()));
  box.append(renderMoodSelector());

  const cwSection = buildContinueWatchingSection();
  if (cwSection) box.append(cwSection);

  const wrap = el('div', 'home-wrap');
  const recs = state.home.recs;

  // === БЛОК РЕКОМЕНДАЦІЙ ===
  if (recs && recs.items && recs.items.length) {
    const sec = el('section', 'home-section');
    const head = el('div', 'section-head');
    const moodLabel = recs.mood && MOODS[recs.mood] ? ` · ${MOODS[recs.mood].emoji} ${MOODS[recs.mood].label}` : '';
    head.append(el('h2', 'section-title', '✨ Для тебе'));
    head.append(el('span', 'section-sub', `на основі ${recs.seeds} оцінок${moodLabel}`));
    sec.append(head);

    const type = state.home.tab;
    const allItems = recs.items.filter(x => x.type === type);
    const shownCount = state.home.shown[type] || 20;
    const visibleItems = allItems.slice(0, shownCount);

    if (visibleItems.length) {
      const grid = el('div', 'home-grid');
      visibleItems.forEach(item => grid.append(recCard(item)));
      sec.append(grid);
    } else {
      sec.append(el('div', 'home-note', 'Немає рекомендацій цього типу. Спробуй інший настрій.'));
    }

    // Кнопка "Показати ще"
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

    // Плаваючі таби
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
  } else if (recs && recs.seeds === 0) {
    const sec = el('section', 'home-section');
    sec.append(el('h2', 'section-title', '✨ Для тебе'));
    sec.append(el('div', 'home-note', 'Постав оцінку 7+ хоча б одному фільму чи серіалу — і тут з\'являться персональні рекомендації.'));
    wrap.append(sec);
  }

  // === БЛОК ЗАГАЛЬНИХ ПІДБІРОК (Розділено за табами) ===
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
      items.slice(0, 10).forEach(item => grid.append(recCard(item)));
      s.append(grid);
      wrap.append(s);
    };

    // Якщо вкладка "Фільми" - показуємо тільки фільми
    if (state.home.tab === 'movie') {
      renderBlock('🔥 Популярні фільми', 'сьогодні', g.trMovies);
      renderBlock('🎬 Нові фільми', 'свіже', g.newMovies);
      renderBlock('🏆 Найрейтинговіші фільми', 'класика', g.topMovies);
    } 
    // Якщо вкладка "Серіали" - показуємо тільки серіали
    else {
      renderBlock('🔥 Популярні серіали', 'сьогодні', g.trTV);
      renderBlock('📺 Нові серіали', 'свіже', g.newTV);
      renderBlock('🏆 Найрейтинговіші серіали', 'класика', g.topTV);
    }
  }
  
  box.append(wrap);
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
      c.append(el('div', 'rec-why', 'на ' + last.replace('-', '×')));
    }
    c.addEventListener('click', () => openCard(item));
    grid.append(c);
  });
  sec.append(grid);
  return sec;
}
