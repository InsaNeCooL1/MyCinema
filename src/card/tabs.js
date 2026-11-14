/* FIX-CARD-TABS
   ─────────────────────────────────────────────────────────────
   Таби картки (Актори, Деталі, Схоже, Сезони, Нотатки) +
   рейтингові блоки + обробники оновлення оцінок.
   Спільні для mobile та desktop.
   ───────────────────────────────────────────────────────────── */

function renderDetailsTab(ctx) {
  const d = ctx.details;
  const wrap = el('div', 'details-grid');
  
  const addItem = (label, value) => {
    if (!value) return;
    const item = el('div', 'detail-item');
    item.append(el('div', 'detail-label', label));
    item.append(el('div', 'detail-value', value));
    wrap.append(item);
  };

  const directors = (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name).join(', ');
  const producers = (d.credits?.crew || []).filter(c => c.job === 'Producer').slice(0, 5).map(c => c.name).join(', ');
  const countries = (d.production_countries || []).map(c => c.name).join(', ');

  addItem('Франшиза', d.belongs_to_collection?.name || null);
  addItem('Бюджет', d.budget ? '$' + d.budget.toLocaleString('en-US') : null);
  addItem('Збори', d.revenue ? '$' + d.revenue.toLocaleString('en-US') : null);
  addItem('Дата виходу', d.release_date || d.first_air_date);
  addItem('Країна', countries);
  addItem('Режисер', directors);
  addItem('Продюсери', producers);
  if (d.vote_count) addItem('Голосів TMDB', d.vote_count.toLocaleString('en-US'));

  return [wrap];
}

function renderNotesTab(ctx) {
  const r = ctx.item;
  const s = lib[r.key] || {};
  const wrap = el('div');
  wrap.append(el('div', 'notes-hint', 'Автоматично зберігаються'));
  const textarea = document.createElement('textarea');
  textarea.className = 'notes-textarea';
  textarea.placeholder = 'Свої думки, враження, цитати...';
  textarea.value = s.notes || '';
  let notesTimer = null;

  const commitNote = () => {
    clearTimeout(notesTimer);
    notesTimer = null;
    if (_pendingNoteFlush === commitNote) _pendingNoteFlush = null;
    const val = textarea.value;
    const cur = lib[r.key] || { ...r, status: null, watchedEpisodes: [] };
    if (val.trim()) {
      if (cur.notes === val) return;
      const next = { ...cur, notes: val, updated: Date.now() };
      if (!next.createdAt) next.createdAt = Date.now();
      attachCtxMeta(next, ctx);
      _dirtyItems.add(r.key); /* SYNC-FIX-NOTES-SET */
      lib[r.key] = next;
    } else if (lib[r.key]) {
      if (!lib[r.key].notes) return;
      _dirtyItems.add(r.key); /* SYNC-FIX-NOTES-DEL */
      delete lib[r.key].notes;
      const hasR = lib[r.key].ratings && Object.values(lib[r.key].ratings).some(v => v > 0);
      const hasSR = lib[r.key].seasonRatings && Object.keys(lib[r.key].seasonRatings).length > 0;
      const hasEps = lib[r.key].watchedEpisodes && lib[r.key].watchedEpisodes.length > 0;
      const hasFav = lib[r.key].favorite === true;
      const hasElo = lib[r.key].eloGames && lib[r.key].eloGames > 0;
      const hasTasteFlags = lib[r.key].excludeFromProfile !== undefined || lib[r.key].antiSeed === true;
      if (!lib[r.key].status && !hasR && !hasSR && !hasEps && !hasFav && !hasElo && !hasTasteFlags) removeLibItem(r.key);
    } else {
      return;
    }
    save();
    const st = document.getElementById('notes-status');
    if (st) st.textContent = val.trim() ? ('Оновлено: ' + new Date().toLocaleString('uk-UA')) : '';
    const notesBtn = card.querySelector('.status-section-row .status-btn-text[title="Нотатки"]');
    if (notesBtn) notesBtn.classList.toggle('active', !!val.trim());
  };

  textarea.addEventListener('input', () => {
    clearTimeout(notesTimer);
    _pendingNoteFlush = commitNote;
    notesTimer = setTimeout(commitNote, 800);
  });
  textarea.addEventListener('blur', commitNote);

  wrap.append(textarea);
  const status = el('div', 'notes-hint'); status.id = 'notes-status';
  if (s.notes) status.textContent = 'Оновлено: ' + new Date(s.updated || Date.now()).toLocaleString('uk-UA');
  wrap.append(status);
  return [wrap];
}

function renderCastTab(ctx) {
  const cast = ctx.details.credits?.cast || [];
  if (!cast.length) return [el('div', 'avail-empty', 'Немає даних')];
  const grid = el('div', 'actor-grid');
  for (const a of cast.slice(0, 20)) {
    const tile = el('div', 'actor-tile');
    const photo = el(a.profile_path ? 'img' : 'div', 'actor-tile-photo');
    if (a.profile_path) { photo.src = TMDB_IMG + 'w185' + a.profile_path; photo.loading = 'lazy'; }
    tile.append(photo, el('div', 'actor-tile-name', a.name));
    if (a.character) tile.append(el('div', 'actor-tile-role', a.character));
    tile.addEventListener('click', () => openPerson(a.id));
    grid.append(tile);
  }
  return [grid];
}

function renderSimilarTab(ctx) {
  const similar = ctx.similar || [];
  if (!similar.length) return [el('div', 'avail-empty', 'Немає схожих')];
  const grid = el('div', 'similar-grid');
  for (const item of similar.slice(0, 20)) {
    const c = el('div', 'similar-card');
    const p = el('img', 'similar-poster'); p.src = TMDB_IMG + 'w342' + item.poster; p.loading = 'lazy';
    c.append(p, el('div', 'similar-title', item.title));
    const mr = el('div', 'similar-meta');
    if (item.year) mr.append(el('span', '', item.year));
    if (item.tmdbRating > 0) {
      if (item.year) mr.append(el('span', '', '·'));
      mr.append(el('span', 'similar-rating', item.tmdbRating.toFixed(1)));
    }
    c.append(mr);
    c.addEventListener('click', () => openMediaFromStack(item));
    grid.append(c);
  }
  return [grid];
}


/* FIX-EP-REACTIONS */
function renderEpisodeReactions(r, selNum, epNum, epKey, ctx) {
  const s = lib[r.key] || {};
  const reactions = s.epReactions || {};
  const current = reactions[epKey] || null;
  
  const wrap = el('div', 'ep-reactions');
  
  if (current) {
    const btn = el('button', 'ep-reaction-selected', current);
    btn.onclick = (e) => {
      e.stopPropagation();
      const newReactions = { ...reactions };
      delete newReactions[epKey];
      
      let wEps = s.watchedEpisodes || [];
      wEps = wEps.filter(k => k !== epKey);
      
      let newStatus = s.status;
      if (wEps.length === 0 && s.status === 'watching') newStatus = 'planned';
      
      update(r, { epReactions: newReactions, watchedEpisodes: wEps, status: newStatus });
    };
    wrap.append(btn);
  } else {
    const emojis = ['😴', '🥲', '😍', '😐', '🙂'];
    emojis.forEach(em => {
      const btn = el('button', 'ep-reaction-opt', em);
      btn.onclick = (e) => {
        e.stopPropagation();
        const newReactions = { ...reactions, [epKey]: em };
        
        let wEps = s.watchedEpisodes || [];
        if (!wEps.includes(epKey)) wEps.push(epKey);
        
        let newStatus = s.status;
        if (newStatus !== 'watched') newStatus = 'watching';
        
        update(r, { epReactions: newReactions, watchedEpisodes: wEps, status: newStatus });
      };
      wrap.append(btn);
    });
  }
  
  return wrap;
}

function renderSeasonsTab(ctx) {
  const d = ctx.details;
  const r = ctx.item;
  const s = lib[r.key] || {};
  if (!d.seasons) return [el('div', 'avail-empty', 'Немає сезонів')];
  const seasons = d.seasons.filter(x => x.season_number !== 0);
  if (!seasons.length) return [el('div', 'avail-empty', 'Немає сезонів')];
  if (!ctx.seasonState) ctx.seasonState = {};
  if (!ctx.seasonState.expandedEps) ctx.seasonState.expandedEps = {};
  if (ctx.seasonState.selectedSeason === undefined) ctx.seasonState.selectedSeason = seasons[0].season_number;
  const selNum = ctx.seasonState.selectedSeason;
  const sel = seasons.find(x => x.season_number === selNum) || seasons[0];
  const wrap = el('div');
  
  // [LAZY-SEASONS] Завантажуємо серії, якщо їх ще немає
  if (sel && !sel.episodesLoaded && !ctx.seasonState.loadingSeason) {
    ctx.seasonState.loadingSeason = true;
    tmdbFetch(`/tv/${r.id}/season/${selNum}?language=uk-UA`).then(data => {
      sel.episodes = data.episodes || [];
      sel.episodesLoaded = true;
      ctx.seasonState.loadingSeason = false;
      if (cardStack[cardStack.length - 1] === ctx) renderCard(true);
    }).catch(() => {
      sel.episodesLoaded = true;
      ctx.seasonState.loadingSeason = false;
      if (cardStack[cardStack.length - 1] === ctx) renderCard(true);
    });
  }

  const tabsBar = el('div', 'season-tabs-bar');
  seasons.forEach(season => {
    const sr = (s.seasonRatings || {})[season.season_number] || {};
    const avg = computeAverage(sr);
    const isActive = season.season_number === selNum;
    const tab = el('button', 'season-tab-btn' + (isActive ? ' active' : ''));
    tab.append(document.createTextNode('Сезон ' + season.season_number));
    if (avg > 0) tab.append(el('span', 'season-tab-badge', '⭐ ' + fmtNum(avg)));
    tab.addEventListener('click', () => {
      if (ctx.seasonState.selectedSeason === season.season_number) return;
      ctx.seasonState.selectedSeason = season.season_number;
      /* FIX-SEASON-SCROLL */
      if (typeof saveCardScroll === 'function') saveCardScroll();
      renderCard(true);
    });
    tabsBar.append(tab);
  });
  wrap.append(tabsBar);

  const seasonRatings = (s.seasonRatings || {})[selNum] || {};
  
  // Блок оцінки сезону (новий UI, як у фільмів)
  const scoreWrap = el('div', 'mobile-score');
  scoreWrap.style.marginBottom = '20px';
  
  const header = el('div', 'score-header');
  header.append(el('div', 'score-title', 'Моя оцінка (Сезон ' + selNum + ')'));
  
  const clearBtn = el('button', 'btn-clear-ratings', 'Очистити');
  clearBtn.onclick = () => {
    if (Object.keys(seasonRatings).length > 0) {
      const sr = { ...(s.seasonRatings || {}) };
      delete sr[selNum];
      update(r, { seasonRatings: sr });
    }
  };
  header.append(clearBtn);
  scoreWrap.append(header);

  RATING_CRITERIA.forEach(crit => {
    const row = el('div', 'score-row');
    row.append(el('span', 'score-label', crit.label));
    
    const bottomRow = el('div', 'score-bottom-row');
    const lights = el('div', 'score-lights');
    const val = seasonRatings[crit.key] || 0;
    
    for (let i = 1; i <= 10; i++) {
      const light = el('button', 'light' + (i <= val ? ' on' : ''));
      light.onclick = () => {
        const newSR = { ...(s.seasonRatings || {}) };
        const curSR = { ...(newSR[selNum] || {}) };
        if (val === i) delete curSR[crit.key];
        else curSR[crit.key] = i;
        
        if (Object.keys(curSR).length > 0) newSR[selNum] = curSR;
        else delete newSR[selNum];
        
        let newStatus = s.status;
        const avg = computeAverage(curSR);
        if (avg > 0 && newStatus !== 'watched') newStatus = 'watching';
        
        update(r, { seasonRatings: newSR, status: newStatus });
      };
      lights.append(light);
    }
    bottomRow.append(lights);
    bottomRow.append(el('span', 'score-val', `${val ? val : '0'}/10`));
    row.append(bottomRow);
    scoreWrap.append(row);
  });

  const avg = computeAverage(seasonRatings);
  const totalRow = el('div', 'score-total');
  totalRow.append(el('span', 'score-total-label', 'Загальна'));
  
  let avgCls = 'score-total-val';
  if (avg > 0) {
    const v100 = avg * 10;
    if (v100 >= 80) avgCls += ' temp-green';
    else if (v100 >= 66) avgCls += ' temp-yellow';
    else if (v100 >= 55) avgCls += ' temp-orange';
    else avgCls += ' temp-red';
  }
  
  totalRow.append(el('span', avgCls, avg > 0 ? fmtNum(avg) : '—'));
  scoreWrap.append(totalRow);

  wrap.append(scoreWrap);

  if (!sel.episodesLoaded) {
    wrap.append(el('div', 'avail-empty', 'Завантаження серій...'));
    return [wrap];
  }

  const episodes = sel.episodes || [];
  wrap.append(el('div', 'label', `Серії (${episodes.length || sel.episode_count || 0})`));
  if (!episodes.length) { wrap.append(el('div', 'avail-empty', 'Немає даних про серії')); return [wrap]; }
  
  const watchedSet = new Set(s.watchedEpisodes || []);
  const statusIsWatched = s.status === 'watched';
  const epList = el('div');
  episodes.forEach((ep, idx) => {
    const epNum = ep.episode_number || (idx + 1);
    const epKey = selNum + '-' + epNum;
    const isWatched = statusIsWatched || watchedSet.has(epKey);
    const isExpanded = !!ctx.seasonState.expandedEps[epKey];
    const epCard = el('div', 'episode-card' + (isWatched ? ' watched' : ''));
      const posterWrap = el('div', 'episode-poster-wrap');
      if (ep.still_path) {
        const img = el('img'); img.src = TMDB_IMG + 'w300' + ep.still_path; img.loading = 'lazy'; img.alt = '';
        posterWrap.append(img);
      } else posterWrap.append(el('div', 'episode-poster-empty', String(epNum)));
      
      epCard.append(posterWrap);
      
      const body = el('div', 'episode-body');
      body.append(el('div', 'episode-num', 'S' + selNum + 'E' + epNum));
      const titleRow = el('div', 'episode-title-row');
      titleRow.append(el('div', 'episode-title', ep.name || ('Серія ' + epNum)));
      
      /* FIX-EP-REACTIONS-INJECT */
      titleRow.append(renderEpisodeReactions(r, selNum, epNum, epKey, ctx));
      
      titleRow.append(el('span', 'episode-expand-icon', isExpanded ? '▴' : '▾'));
    body.append(titleRow);
    const descEl = el('div', 'episode-desc' + (isExpanded ? ' expanded' : ''));
    descEl.textContent = ep.overview || 'Опис відсутній';
    body.append(descEl);
    body.addEventListener('click', () => {
      const key = selNum + '-' + epNum;
      if (!ctx.seasonState.expandedEps) ctx.seasonState.expandedEps = {};
      if (ctx.seasonState.expandedEps[key]) {
        delete ctx.seasonState.expandedEps[key];
        descEl.classList.remove('expanded');
        const icon = body.querySelector('.episode-expand-icon'); if (icon) icon.textContent = '▾';
      } else {
        ctx.seasonState.expandedEps[key] = true;
        descEl.classList.add('expanded');
        const icon = body.querySelector('.episode-expand-icon'); if (icon) icon.textContent = '▴';
      }
    });
    epCard.append(body);
    epList.append(epCard);
  });
  wrap.append(epList);
  return [wrap];
}

function toggleEpisodeWatched(r, seasonNum, epNum, ctx) {
  const s = lib[r.key] || {};
  let wEps = s.watchedEpisodes || [];
  if (s.status === 'watched' && ctx?.details?.seasons) {
    const all = [];
    ctx.details.seasons.forEach(season => {
      if (season.season_number === 0) return;
      const cnt = (season.episodes?.length) || season.episode_count || 0;
      for (let i = 1; i <= cnt; i++) all.push(season.season_number + '-' + i);
    });
    const wSet = new Set(wEps);
    all.forEach(k => wSet.add(k));
    wEps = [...wSet];
  }
  const epKey = seasonNum + '-' + epNum;
  if (wEps.includes(epKey)) wEps = wEps.filter(k => k !== epKey);
  else wEps = [...wEps, epKey];
  
  let totalAllEps = 0;
  if (ctx?.details?.seasons) {
    totalAllEps = ctx.details.seasons.filter(x => x.season_number !== 0).reduce((sum, x) => sum + (x.episodes?.length || x.episode_count || 0), 0);
  }
  let newStatus = s.status;
  if (wEps.length === 0) newStatus = s.status === 'watching' ? 'planned' : s.status;
  else if (totalAllEps > 0 && wEps.length >= totalAllEps) newStatus = 'watched';
  else newStatus = 'watching';
  
  const patch = { watchedEpisodes: wEps, status: newStatus };
  update(r, patch);
}

function renderRatingBlock(crit, value, r) {
  const block = el("div", "rating-block");
  block.dataset.crit = crit.key;
  const header = el("div", "rating-block-header");
  header.append(el("span", "rating-block-label", crit.label));
  header.append(el("span", "rating-block-value" + (value ? "" : " empty"), value ? String(value) : "—"));
  block.append(header);
  const lights = el("div", "rating-lights");
  for (let i = 1; i <= 10; i++) {
    const light = el("span", "light" + (i <= value ? " on" : ""));
    light.addEventListener("click", () => setCriterion(r, crit.key, value === i ? 0 : i));
    lights.append(light);
  }
  block.append(lights);
  return block;
}

function renderAverageBlock(avg, filled) {
  const block = el("div", "rating-block average");
  const header = el("div", "rating-block-header");
  header.append(el("span", "rating-block-label", "Підсумок"));
  let text = avg > 0 ? fmtNum(avg) : "—";
  if (filled > 0 && filled < 5) text += ` (${filled}/5)`;
  header.append(el("span", "rating-block-value " + (avg > 0 ? ratingClass(avg) : 'empty'), text));
  block.append(header);
  const lights = el("div", "rating-lights");
  const full = Math.floor(avg);
  const frac = avg - full;
  for (let i = 1; i <= 10; i++) {
    const light = el("span", "light readonly");
    if (i <= full) light.classList.add("on");
    else if (i === full + 1 && frac > 0.01) {
      light.classList.add("partial");
      light.style.setProperty("--fill", (frac * 100).toFixed(0) + "%");
    }
    lights.append(light);
  }
  block.append(lights);
  return block;
}

function renderSeasonRatingBlock(r, seasonNum, crit, value) {
  const block = el("div", "rating-block");
  block.dataset.season = seasonNum;
  block.dataset.crit = crit.key;
  const header = el("div", "rating-block-header");
  header.append(el("span", "rating-block-label", crit.label));
  header.append(el("span", "rating-block-value" + (value ? "" : " empty"), value ? String(value) : "—"));
  block.append(header);
  const lights = el("div", "rating-lights");
  for (let i = 1; i <= 10; i++) {
    const light = el("span", "light" + (i <= value ? " on" : ""));
    light.addEventListener("click", () => setSeasonCriterion(r, seasonNum, crit.key, value === i ? 0 : i));
    lights.append(light);
  }
  block.append(lights);
  return block;
}

function renderTvRatingSummaryDOM(ratingWrap, s, ctx) {
  ratingWrap.replaceChildren();
  const ir = computeItemRating(s);
  ratingWrap.append(el("div", "label", "Моя оцінка"));
  if (ir.avg > 0) {
    const block = el("div", "ratings-block");
    const infoEl = el("div");
    infoEl.style.padding = "8px 0"; infoEl.style.fontSize = "15px"; infoEl.style.color = "var(--text-secondary)";
    const suffix = ir.complete ? '' : ` <span style="color:var(--warning)">(${ir.rated}/${ir.total} сезонів)</span>`;
    infoEl.innerHTML = `${fmtNum(ir.avg)}/10${suffix}`;
    block.append(infoEl);
    block.append(renderAverageBlock(ir.avg, 5));
    ratingWrap.append(block);
  }
  const row = el("div", "row"); row.style.marginTop = "8px";
  const btn = el("button", "btn", ir.avg > 0 ? "⭐ Змінити оцінки" : "⭐ Оцінити сезони");
  btn.addEventListener('click', () => { ctx.activeTab = 'seasons'; renderCard(); });
  row.append(btn);
  ratingWrap.append(row);
}

function renderSeasonAverageBlock(sr) {
  const avg = computeAverage(sr);
  const filled = RATING_CRITERIA.filter(c => sr[c.key] > 0).length;
  const block = el("div", "rating-block average season-average");
  const header = el("div", "rating-block-header");
  header.append(el("span", "rating-block-label", "Середня оцінка сезону"));
  let vt = avg > 0 ? fmtNum(avg) : "—";
  if (filled > 0 && filled < 5) vt += ` (${filled}/5)`;
  header.append(el("span", "rating-block-value " + (avg > 0 ? ratingClass(avg) : 'empty'), vt));
  block.append(header);
  const lights = el("div", "rating-lights");
  const full = Math.floor(avg);
  const frac = avg - full;
  for (let i = 1; i <= 10; i++) {
    const light = el("span", "light readonly");
    if (i <= full) light.classList.add("on");
    else if (i === full + 1 && frac > 0.01) {
      light.classList.add("partial");
      light.style.setProperty("--fill", (frac * 100).toFixed(0) + "%");
    }
    lights.append(light);
  }
  block.append(lights);
  return block;
}

/* FIX-TABS-FUNCS — відновлені функції для малювання табів */
function buildCardTabs(ctx) {
  const r = ctx.item;

  /* FIX-TV-TABS-SCORE — зміна порядку табів */
  let tabsList;
  if (r.type === 'tv') {
    tabsList = [{ id: 'seasons', label: 'Сезони' }, { id: 'cast', label: 'Актори' }, { id: 'details', label: 'Детально' }];
  } else {
    tabsList = [{ id: 'cast', label: 'Актори' }, { id: 'details', label: 'Детально' }];
  }
  if (ctx.similar && ctx.similar.length > 0) tabsList.push({ id: 'similar', label: 'Схоже' });
  tabsList.push({ id: 'notes', label: 'Нотатки' });

  if (!ctx.activeTab) ctx.activeTab = tabsList[0].id;

  const tabs = el('div', 'card-tabs');
  for (const t of tabsList) {
    const btn = el('button', 'card-tab' + (ctx.activeTab === t.id ? ' active' : ''), t.label);
    btn.addEventListener('click', () => { 
      ctx.activeTab = t.id; 
      renderCard(); 
    });
    tabs.append(btn);
  }
  return tabs;
}

function buildCardTabContent(ctx) {
  const tabContent = el('div', 'card-tab-content');
  if (ctx.activeTab === 'cast') tabContent.append(...renderCastTab(ctx));
  else if (ctx.activeTab === 'details') tabContent.append(...renderDetailsTab(ctx));
  else if (ctx.activeTab === 'seasons') tabContent.append(...renderSeasonsTab(ctx));
  else if (ctx.activeTab === 'similar') tabContent.append(...renderSimilarTab(ctx));
  else if (ctx.activeTab === 'notes') tabContent.append(...renderNotesTab(ctx));
  return tabContent;
}
