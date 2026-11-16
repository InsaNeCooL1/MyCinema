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
  const countries = (d.production_countries || []).map(c => c.name).join(', ');

  let dateStr = d.release_date || d.first_air_date;
  if (dateStr) {
    const dt = new Date(dateStr);
    if (!isNaN(dt)) dateStr = dt.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  addItem('Франшиза', d.belongs_to_collection?.name || null);
  addItem('Бюджет', d.budget ? '$' + d.budget.toLocaleString('en-US') : null);
  addItem('Збори', d.revenue ? '$' + d.revenue.toLocaleString('en-US') : null);
  addItem('Дата виходу', dateStr);
  addItem('Країна', countries);
  addItem('Режисер', directors);

  return [wrap];
}

function renderNotesTab(ctx) {
  /* FIX-NOTES-LEGACY-DEL */
  const r = ctx.item;
  const s = lib[r.key] || {};
  const hist = [...(s.notesHistory || [])];
  
  /* Міграція старого тексту, якщо він є, а масиву ще нема */
  if (s.notes && s.notes.trim() && !hist.some(n => n.text === s.notes)) {
    hist.unshift({ text: s.notes, ts: s.updated || Date.now() });
  }

  const wrap = el('div', 'notes-tab-wrap');
  
  // Кнопка додавання нової нотатки
  const addBtn = el('button', 'btn-add-note', '+ Додати нотатку');
  addBtn.onclick = () => { 
    if (typeof window.openQuickNoteModal === 'function') window.openQuickNoteModal(ctx); 
  };
  wrap.append(addBtn);

  if (!hist.length) {
    wrap.append(el('div', 'avail-empty', 'Тут поки немає записів. Натисни «Додати нотатку», щоб зафіксувати думку.'));
    return [wrap];
  }

  const list = el('div', 'notes-list');
  hist.forEach(n => {
    const item = el('div', 'note-item');
    const date = new Date(n.ts).toLocaleString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    
    const top = el('div', 'note-top');
    top.append(el('div', 'note-date', date));
    
    const delBtn = el('button', 'note-del-btn', '✕');
    delBtn.title = 'Видалити запис';
    delBtn.onclick = () => {
      if (confirm('Видалити цю нотатку?')) {
        const newHist = hist.filter(x => x.ts !== n.ts || x.text !== n.text);
        update(r, { notesHistory: newHist, notes: null });
      }
    };
    top.append(delBtn);
    
    item.append(top);
    item.append(el('div', 'note-content', n.text));
    list.append(item);
  });
  
  wrap.append(list);
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

function renderEpisodeReactions(r, selNum, epNum, epKey, ctx) {
  const s = lib[r.key] || {};
  const reactions = s.epReactions || {};
  const current = reactions[epKey] || null;
  
  const btn = el('button', 'ep-reaction-trigger' + (current ? ' has-reaction' : ''));
  if (current) {
    btn.textContent = current;
  } else {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
  }

  btn.onclick = (e) => {
    e.stopPropagation();
    openReactionModal(r, epKey, current);
  };

  return btn;
}

function openReactionModal(r, epKey, current) {
  document.querySelectorAll('.reaction-modal-overlay').forEach(x => x.remove());

  const overlay = el('div', 'reaction-modal-overlay');
  const content = el('div', 'reaction-modal-content');
  const row = el('div', 'reaction-emoji-row');

  const emojis = ['😴', '🥲', '😍', '😐', '🙂'];
  
  emojis.forEach(em => {
    const emBtn = el('button', 'reaction-emoji-btn' + (current === em ? ' active' : ''), em);
    emBtn.onclick = (e) => {
      e.stopPropagation();
      const s = lib[r.key] || {};
      const newReactions = { ...(s.epReactions || {}) };
      let wEps = s.watchedEpisodes || [];
      let newStatus = s.status;

      if (current === em) {
        delete newReactions[epKey];
        wEps = wEps.filter(k => k !== epKey);
        if (wEps.length === 0 && s.status === 'watching') newStatus = 'planned';
      } else {
        newReactions[epKey] = em;
        if (!wEps.includes(epKey)) wEps.push(epKey);
        if (newStatus !== 'watched') newStatus = 'watching';
      }

      update(r, { epReactions: newReactions, watchedEpisodes: wEps, status: newStatus });
      overlay.remove();
    };
    row.append(emBtn);
  });

  content.append(row);
  overlay.append(content);
  document.body.append(overlay);

  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}

function rerenderCardTabsInPlace(ctx, opts) {
  const wrap = card.querySelector('.mobile-tabs-wrap');
  const scroll = card.querySelector('.card-scroll');
  if (!wrap) { renderCard(true); return; }
  const savedTop = (ctx._pinnedScrollTop !== undefined) ? ctx._pinnedScrollTop : (scroll ? scroll.scrollTop : 0);
  const content = buildCardTabContent(ctx);
  if (opts && opts.noFade) content.classList.add('no-fade');
  if (ctx._pendingTabMinH > 0) content.style.minHeight = ctx._pendingTabMinH + 'px';
  wrap.replaceChildren(buildCardTabs(ctx), content);
  if (scroll) {
    scroll.scrollTop = savedTop;
    requestAnimationFrame(() => { if (scroll.isConnected) scroll.scrollTop = savedTop; });
  }
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
  
  if (sel && !sel.episodesLoaded && !ctx.seasonState.loadingSeason) {
    ctx.seasonState.loadingSeason = true;
    tmdbFetch(`/tv/${r.id}/season/${selNum}?language=uk-UA`).then(data => {
      sel.episodes = data.episodes || [];
      sel.episodesLoaded = true;
      ctx.seasonState.loadingSeason = false;
      delete ctx._pendingTabMinH;
      if (cardStack[cardStack.length - 1] === ctx) {
        if (ctx.activeTab === 'seasons') rerenderCardTabsInPlace(ctx, { noFade: true });
      }
      delete ctx._pinnedScrollTop;
    }).catch(() => {
      sel.episodesLoaded = true;
      ctx.seasonState.loadingSeason = false;
      delete ctx._pendingTabMinH;
      if (cardStack[cardStack.length - 1] === ctx) {
        if (ctx.activeTab === 'seasons') rerenderCardTabsInPlace(ctx, { noFade: true });
      }
      delete ctx._pinnedScrollTop;
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
      const sc = card.querySelector('.card-scroll');
      const curCont = card.querySelector('.mobile-tabs-wrap .card-tab-content');
      ctx._pinnedScrollTop = sc ? sc.scrollTop : 0;
      ctx._pendingTabMinH = (!season.episodesLoaded && curCont) ? curCont.offsetHeight : 0;
      ctx.seasonState.selectedSeason = season.season_number;
      rerenderCardTabsInPlace(ctx, { noFade: true }); // season
      if (season.episodesLoaded) { delete ctx._pendingTabMinH; delete ctx._pinnedScrollTop; }
    });
    tabsBar.append(tab);
  });
  wrap.append(tabsBar);

  const tempCls = (v100) => v100 >= 80 ? 'temp-green' : (v100 >= 66 ? 'temp-yellow' : (v100 >= 55 ? 'temp-orange' : 'temp-red'));
  const refreshTvSeasonRatingUIInPlace = () => {
    const latest = lib[r.key] || {};
    const srObj = (latest.seasonRatings || {})[selNum] || {};
    scoreWrap.querySelectorAll('.score-row').forEach((rowEl, rIdx) => {
      const crit = RATING_CRITERIA[rIdx];
      if (!crit) return;
      const v = srObj[crit.key] || 0;
      rowEl.querySelectorAll('.light').forEach((lEl, i) => {
        const on = (i + 1) <= v;
        lEl.classList.toggle('on', on);
        lEl.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      const sv = rowEl.querySelector('.score-val');
      if (sv) sv.textContent = `${v ? v : '0'}/10`;
    });
    const sAvg = computeAverage(srObj);
    const tvEl = scoreWrap.querySelector('.score-total-val');
    if (tvEl) {
      tvEl.className = 'score-total-val' + (sAvg > 0 ? ' ' + tempCls(sAvg * 10) : '');
      tvEl.textContent = sAvg > 0 ? fmtNum(sAvg) : '—';
    }
    const activeTabBtn = tabsBar.querySelector('.season-tab-btn.active');
    if (activeTabBtn) {
      let badge = activeTabBtn.querySelector('.season-tab-badge');
      if (sAvg > 0) {
        if (!badge) { badge = el('span', 'season-tab-badge', '⭐ ' + fmtNum(sAvg)); activeTabBtn.append(badge); }
        else badge.textContent = '⭐ ' + fmtNum(sAvg);
      } else if (badge) badge.remove();
    }
    const ir = computeItemRating(latest);
    const topTotalRow = Array.from(card.querySelectorAll('.tv-score-total')).find(x => !x.closest('.mobile-tabs-wrap'));
    if (topTotalRow) {
      let valEl = topTotalRow.querySelector('.tv-score-val, .score-empty-text');
      if (ir.avg > 0) {
        const cls = 'score-total-val tv-score-val ' + tempCls(ir.avg * 10);
        if (!valEl) { valEl = el('span', cls, fmtNum(ir.avg)); topTotalRow.append(valEl); }
        else { valEl.className = cls; valEl.textContent = fmtNum(ir.avg); }
      } else if (valEl) {
        valEl.className = 'score-empty-text';
        valEl.textContent = 'Оцінок ще немає';
      }
    }
    const hero = card.querySelector('.mobile-hero');
    if (hero && !ctx.playingTrailer) {
      let hBadge = hero.querySelector('.hero-badge');
      if (ir.avg > 0) {
        const hCls = 'hero-badge ' + tempCls(ir.avg * 10);
        if (!hBadge) { hBadge = el('div', hCls, fmtNum(ir.avg)); hero.append(hBadge); }
        else { hBadge.className = hCls; hBadge.textContent = fmtNum(ir.avg); }
      } else if (hBadge) hBadge.remove();
    }
    const watchBtn = card.querySelector('.title-watch-btn');
    if (watchBtn) watchBtn.classList.toggle('active', latest.status === 'watching');
    const stWrap = card.querySelector('.mobile-statuses');
    if (stWrap) {
      const hasLib = !!lib[r.key];
      const hasDel = !!stWrap.querySelector('.btn-del');
      if (hasLib !== hasDel && window.MC?.createStatuses) stWrap.replaceWith(MC.createStatuses(ctx));
    }
  };

  const seasonRatings = (s.seasonRatings || {})[selNum] || {};
  const scoreWrap = el('div', 'mobile-score');
  scoreWrap.style.marginBottom = '20px';
  
  const header = el('div', 'score-header');
  header.append(el('div', 'score-title', 'Моя оцінка (Сезон ' + selNum + ')'));
  const clearBtn = el('button', 'btn-clear-ratings', 'Очистити');
  clearBtn.onclick = () => {
    const latest = lib[r.key] || {};
    const curSeasonR = (latest.seasonRatings || {})[selNum] || {};
    if (Object.keys(curSeasonR).length > 0) {
      const sr = { ...(latest.seasonRatings || {}) };
      delete sr[selNum];
      const hasAnyRatings = Object.keys(sr).some(k => Object.keys(sr[k] || {}).length > 0);
      let newStatus = latest.status;
      if (!hasAnyRatings && latest.status === 'watching') newStatus = null;
      updateNoRender(r, { seasonRatings: sr, status: newStatus });
      refreshTvSeasonRatingUIInPlace();
    }
  };
  header.append(clearBtn);
  scoreWrap.append(header);

  RATING_CRITERIA.forEach(crit => {
    const row = el('div', 'score-row');
    row.append(el('span', 'score-label', crit.label));
    const bottomRow = el('div', 'score-bottom-row');
    const lights = el('div', 'score-lights');
    const initVal = seasonRatings[crit.key] || 0;
    
    for (let i = 1; i <= 10; i++) {
      const light = el('button', 'light' + (i <= initVal ? ' on' : ''));
      light.onclick = () => {
        const latest = lib[r.key] || {};
        const newSR = { ...(latest.seasonRatings || {}) };
        const curSR = { ...(newSR[selNum] || {}) };
        const curVal = curSR[crit.key] || 0;
        if (curVal === i) delete curSR[crit.key]; else curSR[crit.key] = i;
        if (Object.keys(curSR).length > 0) newSR[selNum] = curSR; else delete newSR[selNum];
        let newStatus = latest.status;
        const nextAvg = computeAverage(curSR);
        if (nextAvg > 0 && newStatus !== 'watched') newStatus = 'watching';
        const newTs = { ...(latest.seasonRatingTs || {}) };
        if (Object.keys(curSR).length > 0) newTs[selNum] = Date.now(); else delete newTs[selNum];
        updateNoRender(r, { seasonRatings: newSR, status: newStatus, seasonRatingTs: newTs });
        refreshTvSeasonRatingUIInPlace();
      };
      lights.append(light);
    }
    bottomRow.append(lights);
    bottomRow.append(el('span', 'score-val', `${initVal ? initVal : '0'}/10`));
    row.append(bottomRow);
    scoreWrap.append(row);
  });

  const avg = computeAverage(seasonRatings);
  const totalRow = el('div', 'score-total');
  totalRow.append(el('span', 'score-total-label', 'Загальна'));
  let avgCls = 'score-total-val' + (avg > 0 ? ' ' + tempCls(avg * 10) : '');
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
    } else {
      posterWrap.append(el('div', 'episode-poster-empty', String(epNum)));
    }
    posterWrap.title = isWatched ? 'Прибрати відмітку перегляду' : 'Позначити серію переглянутою';
    posterWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      let wEps = [...(s.watchedEpisodes || [])];
      let newStatus = s.status;
      if (isWatched) {
        if (statusIsWatched) {
          wEps = [];
          (d.seasons || []).forEach(ss => {
            if (ss.season_number !== 0) {
              const cnt = (ss.episodes && ss.episodes.length) ? ss.episodes.length : (ss.episode_count || 0);
              for (let i = 1; i <= cnt; i++) {
                const k = ss.season_number + '-' + i;
                if (k !== epKey) wEps.push(k);
              }
            }
          });
          newStatus = 'watching';
        } else {
          wEps = wEps.filter(k => k !== epKey);
          if (wEps.length === 0 && newStatus === 'watching') newStatus = 'planned';
        }
      } else {
        if (!wEps.includes(epKey)) wEps.push(epKey);
        if (newStatus !== 'watched') newStatus = 'watching';
      }
      update(r, { watchedEpisodes: wEps, status: newStatus });
    });
    epCard.append(posterWrap);
      
    const body = el('div', 'episode-body');
    body.append(el('div', 'episode-num', 'S' + selNum + 'E' + epNum));
    const titleRow = el('div', 'episode-title-row');
    titleRow.append(el('div', 'episode-title', ep.name || ('Серія ' + epNum)));
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


function renderStudiosTab(ctx) {
  const companies = (ctx.details.production_companies || []).filter(c => c.name);
  if (!companies.length) return [el('div', 'avail-empty', 'Немає даних про студії')];
  
  const wrap = el('div', 'studios-grid');
  companies.forEach(c => {
    const btn = el('button', 'studio-chip');
    btn.type = 'button';
    if (c.logo_path) {
      const logo = el('img', 'studio-chip-logo');
      logo.src = TMDB_IMG + 'w92' + c.logo_path;
      logo.alt = '';
      logo.loading = 'lazy';
      btn.append(logo);
    }
    btn.append(el('span', '', c.name));
    btn.onclick = () => {
      if (typeof openCompany === 'function') openCompany(c.id);
    };
    wrap.append(btn);
  });
  return [wrap];
}

function buildCardTabs(ctx) {
  const r = ctx.item;
  const isDesktop = typeof isDesktopLayout === 'function' ? isDesktopLayout() : window.matchMedia('(min-width: 900px) and (min-height: 600px)').matches;
  let tabsList;
  if (r.type === 'tv') {
    tabsList = [{ id: 'seasons', label: 'Сезони' }, { id: 'cast', label: 'Актори' }];
  } else {
    tabsList = [{ id: 'cast', label: 'Актори' }];
  }
  if (!isDesktop) tabsList.push({ id: 'details', label: 'Деталі' });
  tabsList.push({ id: 'studios', label: 'Студії' });
  if (ctx.similar && ctx.similar.length > 0) tabsList.push({ id: 'similar', label: 'Схоже' });
  tabsList.push({ id: 'notes', label: 'Нотатки' });

  if (!ctx.activeTab || !tabsList.some(t => t.id === ctx.activeTab)) ctx.activeTab = tabsList[0].id;

  const tabs = el('div', 'card-tabs');
  for (const t of tabsList) {
    const btn = el('button', 'card-tab' + (ctx.activeTab === t.id ? ' active' : ''), t.label);
    btn.addEventListener('click', () => {
      if (ctx.activeTab === t.id) return;
      ctx.activeTab = t.id;
      rerenderCardTabsInPlace(ctx); // tab
    });
    tabs.append(btn);
  }
  return tabs;
}

function buildCardTabContent(ctx) {
  const tabContent = el('div', 'card-tab-content');
  if (ctx.activeTab === 'cast') tabContent.append(...renderCastTab(ctx));
  else if (ctx.activeTab === 'seasons') tabContent.append(...renderSeasonsTab(ctx));
  else if (ctx.activeTab === 'details') tabContent.append(...renderDetailsTab(ctx));
  else if (ctx.activeTab === 'studios') tabContent.append(...renderStudiosTab(ctx));
  else if (ctx.activeTab === 'similar') tabContent.append(...renderSimilarTab(ctx));
  else if (ctx.activeTab === 'notes') tabContent.append(...renderNotesTab(ctx));
  return tabContent;
}
