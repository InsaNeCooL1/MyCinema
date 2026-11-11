'use strict';

// ========== MY TOP ==========
function renderMyTop() {
  box.style.padding = '0 16px 16px';
  box.replaceChildren();

  const head = el('div', 'section-head');
  head.style.marginTop = '20px';
  head.append(el('h1', 'section-title', '🏆 Мій топ'));
  box.append(head);

  const filterBar = el('div', 'filter-bar');
  filterBar.style.margin = '0 0 16px 0';
  filterBar.style.padding = '0';
  const filters = [
    { id: 'all', label: 'Всі' },
    { id: 'movie', label: '🎬 Фільми' },
    { id: 'tv', label: '📺 Серіали' }
  ];
  filters.forEach(f => {
    const btn = el('button', 'filter-btn' + (state.topTypeFilter === f.id ? ' active' : ''), f.label);
    btn.addEventListener('click', () => {
      state.topTypeFilter = f.id;
      renderMyTop();
    });
    filterBar.append(btn);
  });
  box.append(filterBar);

  let rated = Object.values(lib).map(x => ({ item: x, r: computeItemRating(x) })).filter(x => x.r.avg > 0);
  if (state.topTypeFilter !== 'all') {
    rated = rated.filter(x => x.item.type === state.topTypeFilter);
  }
  rated.sort((a, b) => b.r.avg - a.r.avg || (b.item.updated || 0) - (a.item.updated || 0));

  if (!rated.length) {
    box.append(el('div', 'avail-empty', 'Ще немає оцінених тайтлів цього типу'));
    return;
  }

  rated.forEach(({ item }, idx) => box.append(createListItem(item, true, idx + 1)));
}

// ========== LIBRARY LIST ==========
function sortLibraryItems(items) {
  const s = state.librarySort;
  return items.slice().sort((a, b) => {
    if (s === 'rating') {
      const aR = computeItemRating(a).avg;
      const bR = computeItemRating(b).avg;
      return bR - aR || (b.updated || 0) - (a.updated || 0);
    }
    if (s === 'title') {
      return (a.title || '').localeCompare(b.title || '', 'uk');
    }
    if (s === 'created') {
      return (b.createdAt || b.updated || 0) - (a.createdAt || a.updated || 0);
    }
    return (b.updated || 0) - (a.updated || 0);
  });
}

function renderLibrary() {
  let items = [];
  if (state.tab === 'favorites') {
    items = Object.values(lib).filter(x => x.favorite);
  } else {
    items = Object.values(lib).filter(x => x.status === state.tab);
  }
  if (state.typeFilter !== "all") items = items.filter(x => x.type === state.typeFilter);
  if (state.librarySearch.trim()) {
    const sq = state.librarySearch.toLowerCase().trim();
    items = items.filter(x => x.title && x.title.toLowerCase().includes(sq));
  }
  items = sortLibraryItems(items);

  box.style.padding = '0 16px 16px';
  box.replaceChildren();
  
  const searchInp = document.createElement('input');
  searchInp.type = 'search';
  searchInp.className = 'lib-search';
  searchInp.placeholder = 'Пошук по бібліотеці...';
  searchInp.value = state.librarySearch;
  searchInp.addEventListener('input', (e) => {
    state.librarySearch = e.target.value;
    const val = e.target.value;
    renderLibrary();
    const newInp = box.querySelector('.lib-search');
    if (newInp) { newInp.focus(); newInp.value = val; newInp.setSelectionRange(val.length, val.length); }
  });
  box.append(searchInp);

  const sortRow = el('div', 'library-sort-row');
  sortRow.append(el('label', '', 'Сортувати'));
  const sortSel = document.createElement('select');
  sortSel.id = 'lib-sort';
  const sortOpts = [
    ['updated', 'Останні зміни'],
    ['rating', 'За оцінкою'],
    ['created', 'За датою додавання'],
    ['title', 'За назвою']
  ];
  sortOpts.forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = l;
    if (state.librarySort === v) opt.selected = true;
    sortSel.append(opt);
  });
  sortSel.addEventListener('change', () => {
    state.librarySort = sortSel.value;
    renderLibrary();
  });
  sortRow.append(sortSel);
  box.append(sortRow);

  if (!items.length) { box.append(el('div', 'avail-empty', 'Тут поки порожньо')); return; }
  items.forEach(r => box.append(createListItem(r)));
}

function renderNotesList() {
  const items = Object.values(lib).filter(x => x.notes && x.notes.trim()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  box.style.padding = '0 16px 16px';
  box.replaceChildren();
  if (!items.length) {
    box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Ще немає нотаток. Відкрий тайтл і перейди на вкладку «📝 Нотатки»</div>';
    return;
  }
  items.forEach(item => box.append(createNoteCard(item)));
}

// ========== LIST ITEMS HELPERS ==========
function createNoteCard(item) {
  const c = el('div', 'note-card');
  c.append(posterEl(item, 'note-poster'));
  const body = el('div', 'note-body');
  body.append(el('div', 'note-title', item.title));
  const meta = (item.type === 'tv' ? 'Серіал' : 'Фільм') + (item.year ? ' · ' + item.year : '');
  body.append(el('div', 'note-meta', meta));
  body.append(el('div', 'note-text', item.notes));
  c.append(body);
  c.addEventListener('click', () => openCard(item));
  return c;
}

function createListItem(r, showNumber, number) {
  const item = el("div", "item" + (showNumber ? " has-number" : ""));
  if (showNumber) item.append(el("div", "top-number", String(number)));
  item.append(posterEl(r, "poster"));
  const info = el("div", "info");
  info.append(el("div", "title", r.title));
  
  let metaText = (r.type === "tv" ? "Серіал" : "Фільм") + (r.year ? " · " + r.year : "");
  if (r.tmdbRating > 0) metaText += ` · ${r.tmdbRating.toFixed(1)}`;
  info.append(el("div", "meta", metaText));
  
  const saved = lib[r.key];
  if (saved) {
    const ir = computeItemRating(saved);
    if (ir.avg > 0) {
      const suffix = ir.complete ? '' : '-...';
      info.append(el("span", "badge rated " + ratingClass(ir.avg), `${fmtNum(ir.avg)}${suffix}`));
    } else if (saved.status) {
      const labels = { watched: "✅", planned: "📅", watching: "▶️", dropped: "🕸️" };
      info.append(el("span", "badge", labels[saved.status] || ""));
    }
    if (saved.elo && saved.eloGames > 1) {
      info.append(el("span", "badge elo", `🏆 ${saved.elo}`));
    }
    if (r.type === 'tv' && saved.watchedEpisodes && saved.watchedEpisodes.length > 0 && saved.totalSeasons) {
      const total = saved.watchedEpisodes.length;
      info.append(el('div', 'meta', `${total} ${plural(total, 'серія', 'серії', 'серій')}`));
    }
  }
  item.append(info);
  
  if (saved) {
    const acts = el('div', 'item-actions');
    const favBtn = el('button', 'item-fav' + (saved.favorite ? ' on' : ''), '❤');
    favBtn.title = 'В улюблене';
    favBtn.addEventListener('click', (e) => { e.stopPropagation(); update(r, { favorite: !saved.favorite }); });
    acts.append(favBtn);
    const del = el("button", "item-delete", "×");
    del.title = "Прибрати зі списку";
    del.addEventListener("click", (e) => { e.stopPropagation(); removeFromLibrary(r.key); });
    acts.append(del);
    item.append(acts);
  }
  item.addEventListener("click", () => openCard(r));
  return item;
}

function createPersonResult(p) {
  const item = el("div", "item");
  const photo = p.profile_path ? el("img", "poster") : el("div", "poster");
  if (p.profile_path) { photo.src = TMDB_IMG + "w185" + p.profile_path; photo.loading = "lazy"; }
  item.append(photo);
  const info = el("div", "info");
  info.append(el("div", "title", p.name));
  info.append(el("div", "meta", "Актор/Акторка"));
  if (p.known_for?.length) {
    const titles = p.known_for.slice(0, 3).map(k => k.title || k.name).filter(Boolean).join(', ');
    if (titles) info.append(el("div", "meta", titles));
  }
  item.append(info);
  item.addEventListener("click", () => openPerson(p.id, p));
  return item;
}

function posterEl(r, cls) {
  const tag = r.poster ? "img" : "div";
  const e = el(tag, cls);
  if (r.poster) { e.src = TMDB_IMG + "w342" + r.poster; e.loading = "lazy"; }
  else e.classList.add('poster-empty');
  return e;
}

function removeFromLibrary(key) {
  if (!lib[key]) return;
  if (!confirm('Прибрати цей тайтл зі списку?\nОцінки та нотатки збережуться.')) return;
  const saved = lib[key];
  const hasR = saved.ratings && Object.values(saved.ratings).some(v => v > 0);
  const hasSR = saved.seasonRatings && Object.keys(saved.seasonRatings).length > 0;
  const hasNotes = saved.notes && saved.notes.trim();
  const hasElo = saved.eloGames && saved.eloGames > 0;
  if (hasR || hasSR || hasNotes || hasElo) {
    lib[key].status = null;
    lib[key].updated = Date.now();
    saveNow();
  } else {
    delete lib[key];
    saveNow();
  }
  refresh();
  const ctx = cardStack[cardStack.length - 1];
  if (ctx && ctx.type === 'media' && ctx.item.key === key) renderCard();
  showSyncToast('🗑️ Прибрано');
}

// ========== FILTER ==========
function renderFilter() {
  if (box.querySelector('.filter-panel')) {
    filterPage = 1;
    const list = document.getElementById('filter-results-list'); if (list) list.innerHTML = '';
    doFetchFilter(false); return;
  }
  box.replaceChildren(); box.style.padding = '0 16px 16px';
  if (state.filter.query) {
    const qb = el("div", "query-bar");
    qb.append(el("span", "", `Результати пошуку: "${state.filter.query}"`));
    const clr = el("button", "", "✕");
    clr.addEventListener("click", () => { state.filter.query = ''; input.value = ''; renderFilter(); });
    qb.append(clr); box.append(qb);
  }
  box.append(buildFilterPanel());
  const ra = el("div"); ra.id = "filter-results-list"; box.append(ra);
  filterPage = 1; doFetchFilter(false);
}

function buildFilterPanel() {
  const panel = el("div", "filter-panel");
  const decades = [['any', 'Будь-яке'], ['2020', '2020-ті'], ['2010', '2010-ті'], ['2000', '2000-ті'], ['1990', '1990-ті'], ['1980', '1980-ті'], ['1970', '1970-ті']];
  const ratings = [[0, 'Будь-який'], [5, '5+'], [6, '6+'], [7, '7+'], [8, '8+'], [9, '9+']];
  const sorts = [['popularity.desc', 'Популярність ↓'], ['vote_average.desc', 'Рейтинг ↓'], ['primary_release_date.desc', 'Новіші'], ['primary_release_date.asc', 'Старіші']];
  const streams = [['any', 'Будь-який'], ...STREAMING_PROVIDERS.map(p => [String(p.id), p.name])];
  
  panel.append(makeSelectRow('Тип', 'f-type', [['all', 'Всі'], ['movie', 'Фільми'], ['tv', 'Серіали']], state.filter.type));
  panel.append(makeSelectRow('Десятиліття', 'f-decade', decades, state.filter.decade));
  panel.append(makeSelectRow('Жанр', 'f-genre', [['any', 'Будь-який'], ...GENRES.map(g => [String(g.id), g.name])], String(state.filter.genre)));
  panel.append(makeSelectRow('Мін. рейтинг', 'f-rating', ratings, String(state.filter.minRating)));
  panel.append(makeSelectRow('Стрімінг', 'f-streaming', streams, state.filter.streaming ? String(state.filter.streaming) : 'any'));
  panel.append(makeSelectRow('Сортування', 'f-sort', sorts, state.filter.sortBy));
  
  const actions = el("div", "filter-actions");
  const resetBtn = el("button", "", "Скинути");
  resetBtn.addEventListener("click", () => {
    state.filter = { ...state.filter, type: 'all', decade: 'any', genre: 'any', minRating: 0, sortBy: 'popularity.desc', streaming: null };
    ['f-type','f-decade','f-genre','f-rating','f-sort','f-streaming'].forEach(id => document.getElementById(id).value = id === 'f-type' ? 'all' : id === 'f-decade' ? 'any' : id === 'f-genre' ? 'any' : id === 'f-rating' ? '0' : id === 'f-sort' ? 'popularity.desc' : 'any');
    filterPage = 1;
    const list = document.getElementById('filter-results-list'); if (list) list.innerHTML = '';
    doFetchFilter(false);
  });
  actions.append(resetBtn); panel.append(actions);
  return panel;
}

function makeSelectRow(label, id, options, currentVal) {
  const row = el("div", "filter-row");
  row.append(el("label", "", label));
  const sel = document.createElement("select"); sel.id = id;
  for (const [val, text] of options) {
    const opt = document.createElement("option"); opt.value = val; opt.textContent = text;
    if (String(val) === String(currentVal)) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener("change", () => {
    if (id === 'f-type') state.filter.type = sel.value;
    else if (id === 'f-decade') state.filter.decade = sel.value;
    else if (id === 'f-genre') state.filter.genre = sel.value === 'any' ? 'any' : parseInt(sel.value);
    else if (id === 'f-rating') state.filter.minRating = parseInt(sel.value);
    else if (id === 'f-sort') state.filter.sortBy = sel.value;
    else if (id === 'f-streaming') state.filter.streaming = sel.value === 'any' ? null : parseInt(sel.value);
    filterPage = 1;
    const list = document.getElementById('filter-results-list'); if (list) list.innerHTML = '';
    doFetchFilter(false);
  });
  row.append(sel);
  return row;
}

async function doFetchFilter(append) {
  if (filterLoading) return;
  filterLoading = true;
  const resultsList = document.getElementById('filter-results-list');
  if (!resultsList) { filterLoading = false; return; }
  if (!append) resultsList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Пошук...</div>';
  const f = state.filter;
  
  try {
    let hasMore = false;
    const people = [], media = [];
    if (f.query) {
      const data = await tmdbFetch(`/search/multi?language=uk-UA&query=${encodeURIComponent(f.query)}&include_adult=false&page=${filterPage}`);
      if (!append) data.results.filter(r => r.media_type === 'person').forEach(p => people.push(p));
      data.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv').map(normalizeItem).forEach(x => media.push(x));
      hasMore = filterPage < (data.total_pages || 1);
    } else {
      const bp = { language: 'uk-UA', sort_by: (f.sortBy.includes('release_date') && f.type === 'all') ? 'popularity.desc' : f.sortBy, page: String(filterPage) };
      if (f.minRating > 0) bp['vote_average.gte'] = String(f.minRating);
      if (f.genre !== "any") bp['with_genres'] = String(f.genre);
      if (f.streaming) { bp['with_watch_providers'] = String(f.streaming); bp['watch_region'] = 'UA'; }
      
      const fetches = [];
      let mP = 0, tP = 0;
      if (f.type === "movie" || f.type === "all") {
        const p = { ...bp };
        if (f.decade !== "any") { p['primary_release_date.gte'] = `${f.decade}-01-01`; p['primary_release_date.lte'] = `${parseInt(f.decade) + 9}-12-31`; }
        fetches.push(tmdbFetch(`/discover/movie?${new URLSearchParams(p)}`).then(d => { mP = d.total_pages || 1; return d.results.map(r => normalizeItem({ ...r, media_type: 'movie' })); }).catch(() => []));
      }
      if (f.type === "tv" || f.type === "all") {
        const p = { ...bp };
        if (f.decade !== "any") { p['first_air_date.gte'] = `${f.decade}-01-01`; p['first_air_date.lte'] = `${parseInt(f.decade) + 9}-12-31`; }
        fetches.push(tmdbFetch(`/discover/tv?${new URLSearchParams(p)}`).then(d => { tP = d.total_pages || 1; return d.results.map(r => normalizeItem({ ...r, media_type: 'tv' })); }).catch(() => []));
      }
      const all = await Promise.all(fetches);
      all.flat().forEach(x => media.push(x));
      hasMore = filterPage < Math.max(mP, tP);
      if (f.type === "all") {
        if (f.sortBy === 'popularity.desc') media.sort((a, b) => b.popularity - a.popularity);
        else if (f.sortBy === 'vote_average.desc') media.sort((a, b) => b.tmdbRating - a.tmdbRating);
      }
    }
    
    if (!append) resultsList.innerHTML = '';
    if (f.minRating > 0) for (let i = media.length - 1; i >= 0; i--) if (media[i].tmdbRating < f.minRating) media.splice(i, 1);
    if (f.decade !== "any") {
      const yS = parseInt(f.decade), yE = yS + 9;
      for (let i = media.length - 1; i >= 0; i--) { const y = parseInt(media[i].year); if (!(y >= yS && y <= yE)) media.splice(i, 1); }
    }
    
    for (const p of people) resultsList.append(createPersonResult(p));
    for (const r of media) resultsList.append(createListItem(r, false));
    
    const old = document.getElementById('filter-more-btn'); if (old) old.remove();
    if (hasMore) {
      const more = el('button', 'home-more', 'Показати ще'); more.id = 'filter-more-btn';
      more.addEventListener('click', () => { filterPage++; doFetchFilter(true); });
      resultsList.append(more);
    }
    if (!resultsList.children.length) resultsList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Нічого не знайдено</div>';
  } catch (e) {
    resultsList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--danger);">Помилка: ${e.message}</div>`;
  } finally { filterLoading = false; }
}
