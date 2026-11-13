'use strict';

function hashFor(ctx) { return ctx.type === 'person' ? `#/person/${ctx.id}` : `#/${ctx.item.type}/${ctx.item.id}`; }
function pushCardState() {
  const ctx = cardStack[cardStack.length - 1];
  if (!ctx) return;
  const st = { mc: cardStack.length };
  if (ctx.type === 'person') st.ctx = { type: 'person', id: ctx.id };
  else st.ctx = { type: 'media', id: ctx.item.id, media_type: ctx.item.type, key: ctx.item.key };
  history.pushState(st, '', hashFor(ctx));
}
function saveCardScroll() {
  const s = card.querySelector('.card-scroll');
  const top = cardStack[cardStack.length - 1];
  if (s && top) top.scroll = s.scrollTop;
}

async function openCard(r) {
  if (cardStack.length) return openMediaFromStack(r);
  overlay.classList.add("open");
  const ctx = { type: 'media', item: r, activeTab: 'cast', seasonState: {}, playingTrailer: false, overviewExpanded: false };
  cardStack = [ctx];
  pushCardState();
  renderLoading();
  await loadMediaCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

async function openMediaFromStack(item) {
  saveCardScroll();
  const ctx = { type: 'media', item, activeTab: 'cast', seasonState: {}, playingTrailer: false, overviewExpanded: false };
  cardStack.push(ctx);
  pushCardState();
  renderLoading();
  await loadMediaCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

// ---- Lampa ----
async function openInLampa(item) {
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ExternalPlayer;
  const webUrl = `http://lampa.mx/?card=${item.id}&media=${item.type}&source=tmdb`;

  // 1. Спробувати нативний застосунок Lampa (тільки в APK)
  if (plugin && plugin.openLampa) {
    try {
      const res = await plugin.openLampa({ id: item.id, type: item.type });
      if (res && res.via === 'launch-only') {
        showSyncToast('Lampa відкрита, але без картки — знайдіть тайтл вручну');
      }
      return; // успіх
    } catch (e) {
      const msg = String((e && e.message) || e);
      // 2. Fallback: Lampa не встановлена або помилка — відкриваємо веб-версію
      if (msg.includes('NOT_INSTALLED')) {
        showCenterToast('📺 Lampa не встановлена, відкриваю веб-версію...');
      } else {
        showCenterToast('⚠️ Не вдалося відкрити застосунок, відкриваю веб-версію...');
      }
      setTimeout(() => window.open(webUrl, '_blank'), 800);
      return;
    }
  }

  // 3. Браузер (ПК / PWA): одразу веб-версія
  window.open(webUrl, '_blank');
}

function cardBar() {
  const bar = el('div', 'card-bar');
  const back = el('button', 'card-x', '←'); back.title = 'Назад';
  back.addEventListener('click', () => history.back());
  bar.append(back);
  if (cardStack.length > 1) {
    const x = el('button', 'card-x', '✕'); x.title = 'Закрити все';
    x.addEventListener('click', closeCard);
    bar.append(x);
  } else bar.append(el('div', 'card-spacer'));
  return bar;
}

function renderLoading() {
  card.innerHTML = '';
  card.append(cardBar());
  const scroll = el('div', 'card-scroll');
  scroll.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Завантаження...</div>';
  card.append(scroll);
}

async function loadMediaCardData(ctx) {
  const r = ctx.item;
  try {
    const d = await tmdbFetch(`/${r.type}/${r.id}?language=uk-UA&include_video_language=uk,en,null&append_to_response=credits,videos,external_ids,watch/providers,recommendations,similar,images`);
    ctx.details = d;
    
    if (!r.title) {
      r.title = d.title || d.name || '';
      r.year = (d.release_date || d.first_air_date || '').slice(0, 4);
      r.poster = d.poster_path;
      r.backdrop = d.backdrop_path;
      r.overview = d.overview || '';
      r.tmdbRating = d.vote_average || 0;
      r.votes = d.vote_count || 0;
      r.popularity = d.popularity || 0;
    }
    
    const meta = typeof extractItemMeta === 'function' ? extractItemMeta(d, r.type) : {};
    if (r.type === 'tv') r.episode_count = meta.episode_count || d.number_of_episodes || 0;
    if (meta.runtime) r.runtime = meta.runtime;
    if (meta.platforms) r.platforms = meta.platforms;
    if (meta.genres) { ctx.genres = meta.genres; r.genres = meta.genres; }
    if (meta.cast) ctx.cast = meta.cast;
    if (lib[r.key]) {
      let dirty = false;
      if (meta.genres && !lib[r.key].genres?.length) { lib[r.key].genres = meta.genres; dirty = true; }
      if (meta.cast && !lib[r.key].cast?.length) { lib[r.key].cast = meta.cast; dirty = true; }
      if (meta.runtime && !lib[r.key].runtime) { lib[r.key].runtime = meta.runtime; dirty = true; }
      if (meta.episode_count && lib[r.key].episode_count !== meta.episode_count) { lib[r.key].episode_count = meta.episode_count; dirty = true; }
      if (meta.platforms && (!lib[r.key].platforms || !lib[r.key].platforms.length)) { lib[r.key].platforms = meta.platforms; dirty = true; }
      if (dirty) save();
    }
    if (d.external_ids?.imdb_id) {
      try {
        const omdbRes = await fetch(`https://www.omdbapi.com/?i=${d.external_ids.imdb_id}&apikey=${OMDB_KEY}`);
        const omdbData = await omdbRes.json();
        if (omdbData.Response === "True") ctx.omdb = omdbData;
      } catch {}
    }
    if (r.type === "tv" && d.seasons) {
      const sd = await Promise.all(d.seasons.map(s => tmdbFetch(`/tv/${r.id}/season/${s.season_number}?language=uk-UA`).catch(() => null)));
      ctx.details.seasons = d.seasons.map((s, i) => ({ ...s, episode_count: sd[i] ? sd[i].episodes.length : s.episode_count, episodes: sd[i] ? sd[i].episodes : [] }));
      const totalSeasons = d.seasons.filter(s => s.season_number !== 0).length;
      if (!r.runtime && typeof extractItemMeta === 'function') {
        const refined = extractItemMeta(ctx.details, 'tv');
        if (refined.runtime) r.runtime = refined.runtime;
      }
      if (lib[r.key]) {
        lib[r.key].totalSeasons = totalSeasons;
        if (r.runtime && !lib[r.key].runtime) lib[r.key].runtime = r.runtime;
      }
    }
    ctx.watchProviders = d['watch/providers']?.results?.UA || null;
    


    const recs = d.recommendations?.results || [];
    const sims = d.similar?.results || [];
    const pool = recs.length > 0 ? recs : sims;
    ctx.similar = pool.map(item => normalizeItem({ ...item, media_type: r.type })).filter(item => item.poster && item.id !== r.id);
  } catch (e) { ctx.error = e.message; }
}

function closeCard() {
  const iframe = card.querySelector('.card-hero-video');
  if (iframe) iframe.src = 'about:blank';

  if (cardStack.length) history.go(-cardStack.length);
  else { overlay.classList.remove('open'); refresh(); }
}

async function loadMediaForForward(s) {
  overlay.classList.add("open");
  const item = { key: s.key, id: s.id, type: s.media_type, title: '', year: '', poster: null, backdrop: null, overview: '', tmdbRating: 0, votes: 0, popularity: 0 };
  const ctx = { type: 'media', item, activeTab: 'cast', seasonState: {}, playingTrailer: false, overviewExpanded: false };
  cardStack.push(ctx);
  renderLoading();
  await loadMediaCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

window.addEventListener('popstate', async (e) => {
  const depth = (e.state && e.state.mc) || 0;
  if (depth === cardStack.length) return;

  const iframe = card.querySelector('.card-hero-video');
  if (iframe) iframe.src = 'about:blank';

  if (depth > cardStack.length) {
    const s = e.state;
    if (!s || !s.ctx || depth - cardStack.length > 1) {
      const h = s?.ctx ? (s.ctx.type === 'person' ? '#/person/' + s.ctx.id : '#/' + s.ctx.media_type + '/' + s.ctx.id) : '';
      location.hash = h;
      location.reload();
      return;
    }
    if (s.ctx.type === 'person') await loadPersonForForward(s.ctx.id);
    else if (s.ctx.type === 'media') await loadMediaForForward(s.ctx);
    return;
  }
  while (cardStack.length > depth) cardStack.pop();
  if (depth === 0) { overlay.classList.remove('open'); refresh(); }
  else renderCard(true);
});

function routeFromHash() {
  const m = location.hash.match(/^#\/(movie|tv|person)\/(\d+)$/);
  if (!m) return;
  history.replaceState({}, '', location.pathname + location.search);
  const id = parseInt(m[2]);
  if (m[1] === 'person') openPerson(id, {});
  else openCard({ key: m[1] + '-' + id, id, type: m[1], title: '', year: '', poster: null, backdrop: null, overview: '', tmdbRating: 0, votes: 0, popularity: 0 });
}

function renderCard(restore) {
  const ctx = cardStack[cardStack.length - 1];
  if (!ctx) { overlay.classList.remove('open'); refresh(); return; }

  const oldIframe = card.querySelector('.card-hero-video');
  if (oldIframe) oldIframe.src = 'about:blank';

  const prevScroll = card.querySelector('.card-scroll');
  const savedScroll = restore ? (ctx.scroll || 0) : (prevScroll ? prevScroll.scrollTop : 0);
  card.innerHTML = '';
  card.append(cardBar());
  const scroll = el('div', 'card-scroll');
  card.append(scroll);
  if (!ctx.details && !ctx.error) scroll.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Завантаження...</div>';
  else if (ctx.error) scroll.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: ${ctx.error}</div>`;
  else if (ctx.type === 'person') renderPersonCard(ctx, scroll);
  else renderMediaCard(ctx, scroll);
  if (savedScroll > 0) scroll.scrollTop = savedScroll;
}

function renderMediaCard(ctx, scroll) {
  const r = ctx.item;
  const d = ctx.details;
  const s = lib[r.key] || {};

  if (settings.posterBg && r.poster && !isLightTheme(settings.themeBg)) {
    const bg = el('div', 'card-poster-bg');
    bg.style.backgroundImage = `url(${TMDB_IMG}w500${r.poster})`;
    card.insertBefore(bg, card.firstChild);
  }

  // === ВЕРХНІЙ ПОВЕРХ ===
  const topSection = el('div', 'card-top-section');
  
  // 1. Банер
  const topLeft = el('div', 'card-top-left');
  const heroWrap = el('div', 'card-hero');
  const backdropPath = r.backdrop || d.backdrop_path || r.poster;
  const trailerList = findAllTrailers(d.videos, d.original_language);
  
  if (ctx.playingTrailer && trailerList.length > 0) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${trailerList[0].key}?autoplay=1`;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.className = 'card-hero-video';
    heroWrap.append(iframe);
  } else {
    if (backdropPath) {
      const img = el('img', 'card-hero-img');
      img.src = TMDB_IMG + 'w1280' + backdropPath;
      heroWrap.append(img);
    } else {
      heroWrap.style.background = 'var(--bg-2)';
      heroWrap.style.aspectRatio = '16/9';
    }
    
    if (trailerList.length > 0) {
      const playBtn = el('div', 'card-hero-play');
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      heroWrap.append(playBtn);
      
      heroWrap.addEventListener('click', () => {
        ctx.playingTrailer = true;
        renderCard();
      });
    }

    const userRating = computeItemRating(s);
    if (userRating.avg > 0) {
      heroWrap.append(el('div', 'hero-rating-badge', fmtNum(userRating.avg)));
    }
  }
  topLeft.append(heroWrap);
  
  // Права колонка
  const topRight = el('div', 'card-top-right');
  
  // 2. Кнопки (Дивитись, UAKino, Серце)
  const actionRowTop = el('div', 'action-row-top');
  
  const watchBtn = el('button', 'action-btn-main watch');
  watchBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;">
      <path d="M8 5v14l11-7z"/>
    </svg>
    Лампа
  `;
  watchBtn.title = 'Відкрити в Lampa';
  watchBtn.addEventListener('click', () => openInLampa(r));
  actionRowTop.append(watchBtn);
  
  const searchTitle = d.title || d.name || r.title;
  // Очищаємо назву від дужок, двокрапок, лапок та інших спецсимволів
  const cleanSearchTitle = searchTitle.replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const searchUrl = `https://uakino.best/index.php?do=search&subaction=search&story=${encodeURIComponent(cleanSearchTitle)}`;
  const uakinoBtn = el('button', 'action-btn-main uakino');
  uakinoBtn.innerHTML = '<span style="color: #0057b8; font-weight: 900; font-size: 16px; font-style: italic; letter-spacing: -0.5px;">UA</span><span style="color: #ffd700; font-weight: 900; font-size: 16px; font-style: italic; letter-spacing: -0.5px;">KINO</span>';
  uakinoBtn.style.display = 'flex';
  uakinoBtn.style.alignItems = 'center';
  uakinoBtn.style.justifyContent = 'center';
  uakinoBtn.addEventListener('click', () => window.open(searchUrl, '_blank'));
  actionRowTop.append(uakinoBtn);
  
  const favBtn = el('button', 'status-btn favorite' + (s.favorite ? ' active' : ''));
  favBtn.title = "В улюблене";
  favBtn.innerHTML = s.favorite
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  favBtn.addEventListener('click', () => update(r, { favorite: !s.favorite }));
  actionRowTop.append(favBtn);
  
  topRight.append(actionRowTop);

  // 3. Назва
  const titleWrap = el('div', 'card-title-wrap');
  titleWrap.append(el('h1', 'title', d.title || d.name || r.title));
  
  let metaStr = d.release_date ? d.release_date.slice(0, 4) : (d.first_air_date ? d.first_air_date.slice(0, 4) : "");
  if (d.runtime) metaStr += ` · ${d.runtime} хв`;
  if (d.number_of_seasons) metaStr += ` · ${d.number_of_seasons} сезонів`;
  if (d.genres) metaStr += ` · ${d.genres.map(g => g.name).join(", ")}`;
  titleWrap.append(el('div', 'meta-details', metaStr));
  topRight.append(titleWrap);

  // 4. Рейтинги + Стрімінг + Переглянуто
  const rr = el("div", "ratings-row");
  rr.style.marginTop = '0';
  rr.style.alignItems = 'center';
  let hasR = false;
  if (d.vote_average) { rr.append(el("div", "rating-badge rating-tmdb", `TMDB: ${d.vote_average.toFixed(1)}`)); hasR = true; }
  if (ctx.omdb) {
    if (ctx.omdb.imdbRating && ctx.omdb.imdbRating !== "N/A") { rr.append(el("div", "rating-badge rating-imdb", `IMDb: ${ctx.omdb.imdbRating}`)); hasR = true; }
  }
  
  if (r.type === 'tv' && ctx.watchProviders?.flatrate?.length) {
    const img = el('img', 'streaming-emblem');
    img.src = TMDB_IMG + 'w92' + ctx.watchProviders.flatrate[0].logo_path;
    img.title = ctx.watchProviders.flatrate[0].provider_name;
    img.style.width = '24px'; img.style.height = '24px';
    img.style.marginLeft = '4px';
    rr.append(img);
  } else if (d.production_companies?.length) {
    const c = d.production_companies[0];
    const b = el("div", "studio-badge");
    b.style.padding = '4px'; b.style.background = 'var(--bg-3)';
    if (c.logo_path) {
      const l = el("img", "studio-logo"); l.src = TMDB_IMG + "w92" + c.logo_path; l.loading = "lazy";
      l.style.width = '24px'; l.style.height = '24px';
      b.append(l);
    } else {
      b.append(el('span', '', c.name));
    }
    b.style.marginLeft = '4px';
    rr.append(b);
  }

  // Кнопка "Переглянуто"
  const watchedBtn = el("button", "status-btn-watched" + (s.status === "watched" ? " active" : ""), "✅ Переглянуто");
  watchedBtn.addEventListener("click", () => {
    const cur = lib[r.key] || {};
    const newStatus = cur.status === "watched" ? null : "watched";
    let newEps = cur.watchedEpisodes || [];
    if (r.type === "tv") {
      if (newStatus === "watched") {
        newEps = [];
        d.seasons.forEach(season => {
          if (season.season_number !== 0) {
            const cnt = season.episodes ? season.episodes.length : season.episode_count;
            for (let i = 1; i <= cnt; i++) newEps.push(season.season_number + "-" + i);
          }
        });
      } else if (newStatus === null) {
        newEps = [];
      }
    }
    const patch = { status: newStatus, watchedEpisodes: newEps };
    if (!lib[r.key] && ctx.genres) patch.genres = ctx.genres;
    if (!lib[r.key] && ctx.cast) patch.cast = ctx.cast;
    if (r.type === "tv" && d.seasons && !lib[r.key]?.totalSeasons) patch.totalSeasons = d.seasons.filter(x => x.season_number !== 0).length;
    update(r, patch);
  });
  rr.append(watchedBtn);

  if (hasR || rr.children.length > 0) topRight.append(rr);

  // 5. Статуси (Решта в один ряд)
  const statusRow = el('div', 'status-section-row');
  const otherStatuses = r.type === "tv" 
    ? [["watching", "▶️ Дивлюсь"], ["planned", "📅 Планую"], ["dropped", "🕸️ Закинуто"]] 
    : [["planned", "📅 Планую"], ["dropped", "🕸️ Закинуто"]];

  for (const [val, text] of otherStatuses) {
    const b = el('button', 'status-btn-text' + (s.status === val ? ' active' : ''), text);
    b.addEventListener("click", () => {
      const cur = lib[r.key] || {};
      const newStatus = cur.status === val ? null : val;
      let newEps = cur.watchedEpisodes || [];
      if (r.type === "tv") {
        if (newStatus === "planned" || newStatus === "dropped" || newStatus === null) newEps = [];
      }
      const patch = { status: newStatus, watchedEpisodes: newEps };
      if (!lib[r.key] && ctx.genres) patch.genres = ctx.genres;
      if (!lib[r.key] && ctx.cast) patch.cast = ctx.cast;
      if (r.type === "tv" && d.seasons && !lib[r.key]?.totalSeasons) patch.totalSeasons = d.seasons.filter(x => x.season_number !== 0).length;
      update(r, patch);
    });
    statusRow.append(b);
  }

  const notesBtn = el('button', 'status-btn-text', '📝');
  notesBtn.title = "Нотатки";
  notesBtn.addEventListener('click', () => { 
    ctx.activeTab = 'notes'; 
    renderCard();
    setTimeout(() => { const content = card.querySelector('.card-tab-content'); if (content) content.scrollIntoView({ behavior: 'smooth' }); }, 100);
  });
  statusRow.append(notesBtn);

  if (lib[r.key]) {
    const delBtn = el('button', 'status-btn-text delete', '🗑️');
    delBtn.title = "Видалити";
    delBtn.addEventListener("click", () => {
      if (confirm('Повністю видалити тайтл з профілю?')) {
        removeLibItem(r.key);
        saveNow(); refresh(); closeCard();
      }
    });
    statusRow.append(delBtn);
  }
  
  topRight.append(statusRow);

  // 6. Опис
  if (d.overview) {
    const overviewWrap = el('div');
    overviewWrap.style.marginTop = '8px';
    const isExpanded = !!ctx.overviewExpanded;
    
    const textEl = el('div', 'overview', d.overview);
    textEl.style.margin = '0';
    if (isExpanded) textEl.classList.add('overview-expanded');
    else textEl.classList.add('overview-clamped');
    overviewWrap.append(textEl);

    if (d.overview.length > 180) {
      const readMoreBtn = el('button', 'btn-read-more', isExpanded ? 'Згорнути' : 'Читати далі...');
      readMoreBtn.addEventListener('click', () => {
        ctx.overviewExpanded = !ctx.overviewExpanded;
        renderCard();
      });
      overviewWrap.append(readMoreBtn);
    }
    topRight.append(overviewWrap);
  }

  // 7. Оцінка
  const ratingWrap = el('div', 'card-user-rating');
  ratingWrap.style.background = 'var(--bg-1)';
  ratingWrap.style.padding = '16px';
  ratingWrap.style.borderRadius = '16px';
  ratingWrap.style.border = '1px solid rgba(255,255,255,0.04)';
  ratingWrap.style.marginTop = '12px';
  ratingWrap.style.marginBottom = '16px';

  if (r.type === 'tv') {
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
  } else {
    ratingWrap.append(el("div", "label", "Моя оцінка"));
    const rb = el("div", "ratings-block");
    const cur = s.ratings || {};
    for (const crit of RATING_CRITERIA) rb.append(renderRatingBlock(crit, cur[crit.key] || 0, r));
    rb.append(renderAverageBlock(computeAverage(cur), countFilled(cur)));
    ratingWrap.append(rb);
  }
  topRight.append(ratingWrap);

  topSection.append(topLeft, topRight);
  scroll.append(topSection);

  // === НИЖНІЙ ПОВЕРХ (ТАБИ) ===
  const tabsList = [{ id: 'cast', label: 'Актори' }, { id: 'details', label: 'Детально' }];
  if (r.type === 'tv') tabsList.push({ id: 'seasons', label: 'Сезони' });
  if (ctx.similar && ctx.similar.length > 0) tabsList.push({ id: 'similar', label: 'Схоже' });
  tabsList.push({ id: 'notes', label: '📝 Нотатки' });

  if (!ctx.activeTab) ctx.activeTab = tabsList[0].id;
  
  const tabs = el('div', 'card-tabs');
  tabs.style.margin = '24px 0 16px 0';
  for (const t of tabsList) {
    const btn = el('button', 'card-tab' + (ctx.activeTab === t.id ? ' active' : ''), t.label);
    btn.addEventListener('click', () => { ctx.activeTab = t.id; renderCard(); });
    tabs.append(btn);
  }
  scroll.append(tabs);

  const tabContent = el('div', 'card-tab-content');
  if (ctx.activeTab === 'cast') tabContent.append(...renderCastTab(ctx));
  else if (ctx.activeTab === 'details') tabContent.append(...renderDetailsTab(ctx));
  else if (ctx.activeTab === 'seasons') tabContent.append(...renderSeasonsTab(ctx));
  else if (ctx.activeTab === 'similar') tabContent.append(...renderSimilarTab(ctx));
  else if (ctx.activeTab === 'notes') tabContent.append(...renderNotesTab(ctx));
  scroll.append(tabContent);
}

// ==================== ІНШІ ВКЛАДКИ ====================
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
  let notesTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      const cur = lib[r.key] || { ...r, status: null, watchedEpisodes: [] };
      if (textarea.value.trim()) {
        lib[r.key] = { ...cur, notes: textarea.value, updated: Date.now() };
        if (!lib[r.key].createdAt) lib[r.key].createdAt = Date.now();
      } else if (lib[r.key]) {
        delete lib[r.key].notes;
        const hasR = lib[r.key].ratings && Object.values(lib[r.key].ratings).some(v => v > 0);
        const hasSR = lib[r.key].seasonRatings && Object.keys(lib[r.key].seasonRatings).length > 0;
        const hasEps = lib[r.key].watchedEpisodes && lib[r.key].watchedEpisodes.length > 0;
        if (!lib[r.key].status && !hasR && !hasSR && !hasEps) removeLibItem(r.key);
      }
      save();
    }, 800);
  });
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
    tile.addEventListener('click', () => openPerson(a.id, a));
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
      renderCard();
    });
    tabsBar.append(tab);
  });
  wrap.append(tabsBar);

  const seasonRatings = (s.seasonRatings || {})[selNum] || {};
  wrap.append(el('div', 'label', 'Оцінка сезону ' + selNum));
  const rb = el('div', 'ratings-block');
  rb.style.marginBottom = '20px';
  for (const crit of RATING_CRITERIA) rb.append(renderSeasonRatingBlock(r, selNum, crit, seasonRatings[crit.key] || 0));
  rb.append(renderSeasonAverageBlock(seasonRatings));
  wrap.append(rb);

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
    posterWrap.title = isWatched ? 'Зняти позначку' : 'Позначити переглянутим';
    if (ep.still_path) {
      const img = el('img'); img.src = TMDB_IMG + 'w300' + ep.still_path; img.loading = 'lazy'; img.alt = '';
      posterWrap.append(img);
    } else posterWrap.append(el('div', 'episode-poster-empty', String(epNum)));
    posterWrap.append(el('div', 'episode-check', isWatched ? '✓' : ''));
    posterWrap.addEventListener('click', (e) => { e.stopPropagation(); toggleEpisodeWatched(r, selNum, epNum, ctx); });
    epCard.append(posterWrap);
    
    const body = el('div', 'episode-body');
    body.append(el('div', 'episode-num', 'S' + selNum + 'E' + epNum));
    const titleRow = el('div', 'episode-title-row');
    titleRow.append(el('div', 'episode-title', ep.name || ('Серія ' + epNum)));
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
  if (!lib[r.key] && ctx?.genres) patch.genres = ctx.genres;
  if (!lib[r.key] && ctx?.cast) patch.cast = ctx.cast;
  if (ctx?.details?.seasons && !s.totalSeasons) patch.totalSeasons = ctx.details.seasons.filter(x => x.season_number !== 0).length;
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
  header.append(el("span", "rating-block-label", "Загальне (середнє)"));
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

function renderSeasonAverageBlock(sr) {
  const avg = computeAverage(sr);
  const filled = RATING_CRITERIA.filter(c => sr[c.key] > 0).length;
  const block = el("div", "rating-block average");
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

function updateCore(r, patch) {
  const cur = lib[r.key] || { ...r, status: null, ratings: null, watchedEpisodes: [] };
  if (!cur.createdAt) cur.createdAt = Date.now();
  const merged = { ...cur, ...patch, updated: Date.now() };
  if (patch.status !== undefined && patch.status !== cur.status) merged.statusDate = Date.now();
  lib[r.key] = merged;
  const ctx = cardStack[cardStack.length - 1];
  if (ctx?.cast && !lib[r.key].cast) lib[r.key].cast = ctx.cast;
  const hasR = lib[r.key].ratings && Object.values(lib[r.key].ratings).some(v => v > 0);
  const hasSR = lib[r.key].seasonRatings && Object.keys(lib[r.key].seasonRatings).length > 0;
  const hasEps = lib[r.key].watchedEpisodes && lib[r.key].watchedEpisodes.length > 0;
  const hasNotes = lib[r.key].notes && lib[r.key].notes.trim();
  const hasElo = lib[r.key].eloGames && lib[r.key].eloGames > 0;
  const hasFav = lib[r.key].favorite === true;
  if (!lib[r.key].status && !hasR && !hasSR && !hasEps && !hasNotes && !hasElo && !hasFav) removeLibItem(r.key);
  save();
}
function update(r, patch) { updateCore(r, patch); renderCard(); }
function updateNoRender(r, patch) { updateCore(r, patch); }

function setCriterion(r, criterionKey, value) {
  const s = lib[r.key] || {};
  const ratings = { ...(s.ratings || {}) };
  if (value > 0) ratings[criterionKey] = value;
  else delete ratings[criterionKey];
  const avg = computeAverage(ratings);
  let newStatus = s.status;
  if (avg > 0) {
    if (r.type === "tv") { if (s.status !== "watched") newStatus = "watching"; }
    else newStatus = "watched";
  } else if (avg === 0 && s.status === "watched") newStatus = null;
  const patch = { ratings, status: newStatus };
  const ctx = cardStack[cardStack.length - 1];
  if (!lib[r.key] && ctx?.genres) patch.genres = ctx.genres;
  if (!lib[r.key] && ctx?.cast) patch.cast = ctx.cast;
  updateNoRender(r, patch);
  const scroll = card.querySelector('.card-scroll');
  if (!scroll) return;
  refreshRatingBlockDOM(scroll, criterionKey, value);
  refreshAverageBlockDOM(scroll, r);
}

function refreshRatingBlockDOM(scroll, critKey, value) {
  const block = scroll.querySelector(`.rating-block[data-crit="${critKey}"]`);
  if (!block) return;
  const lights = block.querySelectorAll('.light');
  lights.forEach((l, i) => l.classList.toggle('on', i + 1 <= value));
  const valEl = block.querySelector('.rating-block-value');
  if (valEl) { valEl.textContent = value || '—'; valEl.classList.toggle('empty', !value); }
}

function refreshAverageBlockDOM(scroll, r) {
  const block = scroll.querySelector('.rating-block.average');
  if (!block) return;
  const s = lib[r.key] || {};
  const ratings = s.ratings || {};
  const avg = computeAverage(ratings);
  const filled = countFilled(ratings);
  let text = avg > 0 ? fmtNum(avg) : "—";
  if (filled > 0 && filled < 5) text += ` (${filled}/5)`;
  const valEl = block.querySelector('.rating-block-value');
  if (valEl) {
    valEl.textContent = text;
    valEl.className = 'rating-block-value ' + (avg > 0 ? ratingClass(avg) : 'empty');
  }
  const lights = block.querySelectorAll('.light');
  const full = Math.floor(avg);
  const frac = avg - full;
  lights.forEach((l, i) => {
    const idx = i + 1;
    l.classList.remove('on', 'partial');
    l.style.removeProperty('--fill');
    if (idx <= full) l.classList.add('on');
    else if (idx === full + 1 && frac > 0.01) {
      l.classList.add('partial');
      l.style.setProperty('--fill', (frac * 100).toFixed(0) + '%');
    }
  });
}

function setSeasonCriterion(r, seasonNum, criterionKey, value) {
  const s = lib[r.key] || {};
  const sr = { ...(s.seasonRatings || {}) };
  const cur = { ...(sr[seasonNum] || {}) };
  if (value > 0) cur[criterionKey] = value;
  else delete cur[criterionKey];
  if (Object.keys(cur).length > 0) sr[seasonNum] = cur;
  else delete sr[seasonNum];
  const patch = { seasonRatings: sr };
  if (value > 0 && s.status !== 'watched') patch.status = 'watching'; // оцінка сезону -> «Дивлюсь»
  const ctx = cardStack[cardStack.length - 1];
  if (ctx?.details?.seasons && !s.totalSeasons) patch.totalSeasons = ctx.details.seasons.filter(x => x.season_number !== 0).length;
  if (!lib[r.key] && ctx?.genres) patch.genres = ctx.genres;
  if (!lib[r.key] && ctx?.cast) patch.cast = ctx.cast;
  update(r, patch);
}
