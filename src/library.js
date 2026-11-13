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
  rated.sort((a, b) => {
    const diff = b.r.avg - a.r.avg;
    if (Math.abs(diff) > 0.001) return diff;
    const eloDiff = (b.item.elo || ELO_START) - (a.item.elo || ELO_START);
    if (eloDiff !== 0) return eloDiff;
    return (b.item.updated || 0) - (a.item.updated || 0);
  });

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

function getFilteredLibraryItems() {
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
  return sortLibraryItems(items);
}

function renderLibraryItems() {
  const listWrap = document.getElementById('lib-items');
  if (!listWrap) return;
  listWrap.replaceChildren();
  const items = getFilteredLibraryItems();
  if (!items.length) {
    listWrap.append(el('div', 'avail-empty', 'Тут поки порожньо'));
    return;
  }
  items.forEach(r => listWrap.append(createListItem(r)));
}

function renderLibrary() {
  box.style.padding = '0 16px 16px';
  box.replaceChildren();

  const searchInp = document.createElement('input');
  searchInp.type = 'search';
  searchInp.className = 'lib-search';
  searchInp.placeholder = 'Пошук по бібліотеці...';
  searchInp.value = state.librarySearch;
  let libSearchTimer;
  searchInp.addEventListener('input', (e) => {
    state.librarySearch = e.target.value;
    clearTimeout(libSearchTimer);
    libSearchTimer = setTimeout(renderLibraryItems, 120);
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
    renderLibraryItems();
  });
  sortRow.append(sortSel);
  box.append(sortRow);

  const listWrap = el('div');
  listWrap.id = 'lib-items';
  box.append(listWrap);
  renderLibraryItems();
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
    if (r.type === 'tv' && saved.watchedEpisodes && saved.watchedEpisodes.length > 0) {
      const done = saved.watchedEpisodes.length;
      const totalEps = saved.episode_count || 0;
      if (totalEps > 0) {
        const pct = Math.min(100, Math.round((done / totalEps) * 100));
        const remEps = Math.max(0, totalEps - done);
        let txt = `${done} / ${totalEps} ${plural(totalEps, 'серія', 'серії', 'серій')} (${pct}%)`;
        if (remEps > 0 && saved.runtime > 0) {
          const remHrs = (remEps * saved.runtime) / 60;
          txt += ` · ~${remHrs >= 10 ? Math.round(remHrs) : fmtNum(remHrs)} год`;
        }
        info.append(el('div', 'meta', txt));
        const prog = el('div', 'item-progress');
        const fill = el('div', 'item-progress-fill');
        fill.style.width = pct + '%';
        prog.append(fill);
        info.append(prog);
      } else if (saved.totalSeasons) {
        info.append(el('div', 'meta', `${done} ${plural(done, 'серія', 'серії', 'серій')}`));
      }
    }
  }
  item.append(info);
  
  if (saved) {
    const acts = el('div', 'item-actions');
    const favBtn = el('button', 'item-fav' + (saved.favorite ? ' on' : ''), '❤');
    favBtn.title = 'В улюблене';
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextFav = !(lib[r.key] && lib[r.key].favorite);
      updateNoRender(r, { favorite: nextFav });
      favBtn.classList.toggle('on', nextFav);
      if (state.tab === 'favorites' && !nextFav) renderLibraryItems();
    });
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
  item.addEventListener("click", () => openPerson(p.id));
  return item;
}

function posterEl(r, cls) {
  const tag = r.poster ? "img" : "div";
  const e = el(tag, cls);
  if (r.poster) { e.src = TMDB_IMG + "w342" + r.poster; e.loading = "lazy"; e.decoding = "async"; }
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
  const hasFav = saved.favorite === true;
  const hasEps = saved.watchedEpisodes && saved.watchedEpisodes.length > 0;
  const hasTasteFlags = saved.excludeFromProfile !== undefined || saved.antiSeed === true;
  if (hasR || hasSR || hasNotes || hasElo || hasFav || hasEps || hasTasteFlags) {
    lib[key].status = null;
    lib[key].updated = Date.now();
    saveNow();
  } else {
    removeLibItem(key);
    saveNow();
  }
  refresh();
  const ctx = cardStack[cardStack.length - 1];
  if (ctx && ctx.type === 'media' && ctx.item.key === key) renderCard();
  showSyncToast('🗑️ Прибрано');
}

// ========== FILTER ==========
function syncFilterSelects() {
  const f = state.filter;
  const map = {
    'f-type': f.type,
    'f-decade': f.decade,
    'f-genre': String(f.genre),
    'f-rating': String(f.minRating),
    'f-streaming': f.streaming ? String(f.streaming) : 'any',
    'f-sort': f.sortBy
  };
  for (const [id, val] of Object.entries(map)) {
    const sel = document.getElementById(id);
    if (sel) sel.value = val;
  }
  if (typeof updateFilterBadge === 'function') updateFilterBadge();
}

function resetAllFilters() {
  state.filter = { ...state.filter, type: 'all', decade: 'any', genre: 'any', minRating: 0, sortBy: 'popularity.desc', streaming: null };
  syncFilterSelects();
  if (state.tab === 'filter') renderFilter();
  else { setTab('filter'); }
}

function buildFilterSummaryBar() {
  const f = state.filter;
  const chips = [];
  if (f.type !== 'all') chips.push(f.type === 'movie' ? 'Фільми' : 'Серіали');
  if (f.decade !== 'any') chips.push(f.decade + '-ті');
  if (f.genre !== 'any') {
    const g = GENRES.find(x => x.id === f.genre);
    if (g) chips.push(g.name);
  }
  if (f.minRating > 0) chips.push(f.minRating + '+');
  if (f.streaming) {
    const p = STREAMING_PROVIDERS.find(x => x.id === f.streaming);
    if (p) chips.push(p.name);
  }
  if (f.sortBy !== 'popularity.desc') {
    const sorts = { 'vote_average.desc': 'Рейтинг ↓', 'primary_release_date.desc': 'Новіші', 'primary_release_date.asc': 'Старіші' };
    if (sorts[f.sortBy]) chips.push(sorts[f.sortBy]);
  }

  const bar = el('div', 'filter-summary-bar');
  const text = el('div', 'filter-summary-chips', chips.length ? chips.join(' · ') : 'Популярне · Усі фільтри за замовчуванням');
  bar.append(text);

  const actions = el('div', 'filter-summary-actions');
  const editBtn = el('button', 'filter-summary-btn', '🎛️ Фільтри');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof toggleFilterDropdown === 'function') toggleFilterDropdown(e);
  });
  actions.append(editBtn);

  if (chips.length) {
    const rstBtn = el('button', 'filter-summary-btn reset', 'Скинути');
    rstBtn.addEventListener('click', resetAllFilters);
    actions.append(rstBtn);
  }
  bar.append(actions);
  return bar;
}

function renderFilter() {
  box.replaceChildren();
  box.style.padding = '0 16px 16px';
  if (state.filter.query) {
    const qb = el("div", "query-bar");
    qb.append(el("span", "", `Результати пошуку: "${state.filter.query}"`));
    const clr = el("button", "", "✕");
    clr.addEventListener("click", () => { state.filter.query = ''; input.value = ''; renderFilter(); });
    qb.append(clr);
    box.append(qb);
  }
  box.append(buildFilterSummaryBar());
  const ra = el("div"); ra.id = "filter-results-list"; box.append(ra);
  if (typeof updateFilterBadge === 'function') updateFilterBadge();
  filterPage = 1;
  doFetchFilter(false);
}

function buildFilterPanel() {
  const panel = el("div", "filter-panel filter-dropdown-panel");
  const head = el("div", "filter-dropdown-head");
  head.append(el("span", "filter-dropdown-title", "Фільтр"));
  const closeBtn = el("button", "filter-dropdown-close", "✕");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", () => { if (typeof hideFilterDropdown === 'function') hideFilterDropdown(); });
  head.append(closeBtn);
  panel.append(head);

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
  resetBtn.type = "button";
  resetBtn.addEventListener("click", () => {
    resetAllFilters();
  });
  const applyBtn = el("button", "primary", "Показати");
  applyBtn.type = "button";
  applyBtn.addEventListener("click", () => {
    if (typeof hideFilterDropdown === 'function') hideFilterDropdown();
    if (state.tab !== "filter") setTab("filter");
    else renderFilter();
  });
  actions.append(resetBtn, applyBtn);
  panel.append(actions);
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
    if (typeof updateFilterBadge === 'function') updateFilterBadge();
    if (state.tab !== 'filter') setTab('filter', { keepFilter: true });
    else renderFilter();
  });
  row.append(sel);
  return row;
}

let filterReqId = 0;

async function doFetchFilter(append) {
  if (append && filterLoading) return;
  const reqId = ++filterReqId;
  filterLoading = true;
  const resultsList = document.getElementById('filter-results-list');
  if (!resultsList) { filterLoading = false; return; }
  if (!append) resultsList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Пошук...</div>';
  const f = state.filter;

  const sortMediaList = (arr) => {
    const dStr = (x) => x.releaseDate || (x.year ? x.year + '-01-01' : '');
    if (f.sortBy === 'vote_average.desc') arr.sort((a, b) => b.tmdbRating - a.tmdbRating || b.popularity - a.popularity);
    else if (f.sortBy === 'primary_release_date.desc') arr.sort((a, b) => dStr(b).localeCompare(dStr(a)));
    else if (f.sortBy === 'primary_release_date.asc') arr.sort((a, b) => (dStr(a) || '9999').localeCompare(dStr(b) || '9999'));
    else arr.sort((a, b) => b.popularity - a.popularity);
  };

  try {
    let hasMore = false;
    const people = [], media = [];
    if (f.query) {
      const endpoint = f.type === 'movie'
        ? '/search/movie'
        : (f.type === 'tv' ? '/search/tv' : '/search/multi');
      const data = await tmdbFetch(`${endpoint}?language=uk-UA&query=${encodeURIComponent(f.query)}&include_adult=false&page=${filterPage}`);
      if (reqId !== filterReqId) return;

      if (!append && f.type === 'all') {
        (data.results || []).filter(r => r.media_type === 'person').forEach(p => people.push(p));
      }
      const rawMedia = f.type === 'all'
        ? (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv')
        : (data.results || []).map(r => ({ ...r, media_type: f.type }));
      rawMedia.map(normalizeItem).forEach(x => media.push(x));
      hasMore = filterPage < (data.total_pages || 1);
    } else {
      const tvSort = f.sortBy === 'primary_release_date.desc'
        ? 'first_air_date.desc'
        : (f.sortBy === 'primary_release_date.asc' ? 'first_air_date.asc' : f.sortBy);
      const bp = { language: 'uk-UA', page: String(filterPage) };
      if (f.minRating > 0) bp['vote_average.gte'] = String(f.minRating);
      if (f.genre !== "any") bp['with_genres'] = String(f.genre);
      if (f.streaming) { bp['with_watch_providers'] = String(f.streaming); bp['watch_region'] = 'UA'; }

      const fetches = [];
      let mP = 0, tP = 0;
      if (f.type === "movie" || f.type === "all") {
        const p = { ...bp, sort_by: f.sortBy };
        if (f.decade !== "any") { p['primary_release_date.gte'] = `${f.decade}-01-01`; p['primary_release_date.lte'] = `${parseInt(f.decade) + 9}-12-31`; }
        fetches.push(tmdbFetch(`/discover/movie?${new URLSearchParams(p)}`).then(d => { mP = d.total_pages || 1; return (d.results || []).map(r => normalizeItem({ ...r, media_type: 'movie' })); }).catch(() => []));
      }
      if (f.type === "tv" || f.type === "all") {
        const p = { ...bp, sort_by: tvSort };
        if (f.decade !== "any") { p['first_air_date.gte'] = `${f.decade}-01-01`; p['first_air_date.lte'] = `${parseInt(f.decade) + 9}-12-31`; }
        fetches.push(tmdbFetch(`/discover/tv?${new URLSearchParams(p)}`).then(d => { tP = d.total_pages || 1; return (d.results || []).map(r => normalizeItem({ ...r, media_type: 'tv' })); }).catch(() => []));
      }
      const all = await Promise.all(fetches);
      if (reqId !== filterReqId) return;
      all.flat().forEach(x => media.push(x));
      hasMore = filterPage < Math.max(mP, tP);
      if (f.type === "all") sortMediaList(media);
    }

    if (!append) resultsList.innerHTML = '';
    if (f.query && f.streaming && !append) {
      resultsList.append(el('div', 'notes-hint', 'ℹ️ Фільтр за стрімінгом застосовується лише без текстового запиту'));
    }
    if (f.query) {
      if (f.genre !== 'any') {
        for (let i = media.length - 1; i >= 0; i--) if (!(media[i].genres || []).includes(f.genre)) media.splice(i, 1);
      }
      if (f.minRating > 0) {
        for (let i = media.length - 1; i >= 0; i--) if (media[i].tmdbRating < f.minRating) media.splice(i, 1);
      }
      if (f.decade !== 'any') {
        const yS = parseInt(f.decade), yE = yS + 9;
        for (let i = media.length - 1; i >= 0; i--) { const y = parseInt(media[i].year); if (!(y >= yS && y <= yE)) media.splice(i, 1); }
      }
      sortMediaList(media);
    } else {
      if (f.minRating > 0) for (let i = media.length - 1; i >= 0; i--) if (media[i].tmdbRating < f.minRating) media.splice(i, 1);
      if (f.decade !== "any") {
        const yS = parseInt(f.decade), yE = yS + 9;
        for (let i = media.length - 1; i >= 0; i--) { const y = parseInt(media[i].year); if (!(y >= yS && y <= yE)) media.splice(i, 1); }
      }
    }

    for (const p of people) resultsList.append(createPersonResult(p));
    for (const r of media) resultsList.append(createListItem(r, false));

    const old = document.getElementById('filter-more-btn'); if (old) old.remove();
    if (hasMore) {
      const more = el('button', 'home-more', 'Показати ще'); more.id = 'filter-more-btn';
      more.addEventListener('click', () => { filterPage++; doFetchFilter(true); });
      resultsList.append(more);
    }
    if (!resultsList.querySelector('.item')) {
      resultsList.append(el('div', 'avail-empty', hasMore ? 'На цій сторінці немає збігів під фільтри. Натисни «Показати ще».' : 'Нічого не знайдено'));
    }
  } catch (e) {
    if (reqId === filterReqId) resultsList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--danger);">Помилка: ${e.message}</div>`;
  } finally {
    if (reqId === filterReqId) filterLoading = false;
  }
}
