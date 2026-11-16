/* FIX-CARD-ENGINE — двигун картки: навігація, дані, оновлення, оркестратор renderCard */

'use strict';

const DESKTOP_MQ = window.matchMedia('(min-width: 900px) and (min-height: 600px)');
function isDesktopLayout() {
  return DESKTOP_MQ.matches;
}

(function bindCardLayoutSwitch() {
  const onLayoutChange = () => {
    document.querySelectorAll('.account-menu').forEach(m => m.remove());
    if (typeof overlay !== 'undefined' && overlay.classList.contains('open') && cardStack.length) {
      saveCardScroll();
      renderCard(true);
    }
  };
  if (typeof DESKTOP_MQ.addEventListener === 'function') {
    DESKTOP_MQ.addEventListener('change', onLayoutChange);
  } else if (typeof DESKTOP_MQ.addListener === 'function') {
    DESKTOP_MQ.addListener(onLayoutChange);
  }
})();

function makeMediaCtx(item) {
  return { type: 'media', item, activeTab: item.type === 'tv' ? 'seasons' : 'cast', seasonState: {}, playingTrailer: false, overviewExpanded: false, overviewSource: 'tmdb' };
}

function hashFor(ctx) { return ctx.type === 'person' ? `#/person/${ctx.id}` : (ctx.type === 'company' ? `#/company/${ctx.id}` : `#/${ctx.item.type}/${ctx.item.id}`); }
function pushCardState() {
  const ctx = cardStack[cardStack.length - 1];
  if (!ctx) return;
  const st = { mc: cardStack.length };
  if (ctx.type === 'person') st.ctx = { type: 'person', id: ctx.id };
  else if (ctx.type === 'company') st.ctx = { type: 'company', id: ctx.id };
  else st.ctx = { type: 'media', id: ctx.item.id, media_type: ctx.item.type, key: ctx.item.key };
  history.pushState(st, '', hashFor(ctx));
}
function saveCardScroll() {
  const s = card.querySelector('.card-scroll');
  const top = cardStack[cardStack.length - 1];
  if (s && top) top.scroll = s.scrollTop;
}

let _libDirtySinceCardOpen = false;
function markCardLibDirty() {
  if (cardStack.length) _libDirtySinceCardOpen = true;
}

function refreshHeroInPlace(ctx) {
  const cur = card.querySelector('.mobile-hero');
  if (cur && window.MC?.createHero) {
    cur.replaceWith(MC.createHero(ctx));
  } else {
    renderCard(true);
  }
}

function refreshCardTitleInPlace(ctx) {
  const cur = card.querySelector('.mobile-title');
  if (cur && window.MC?.createTitle) {
    cur.replaceWith(MC.createTitle(ctx));
  }
}

function refreshCardOverviewInPlace(ctx) {
  const cur = card.querySelector('.mobile-overview');
  if (cur && window.MC?.createOverview) {
    cur.replaceWith(MC.createOverview(ctx));
  }
}

function refreshCardControlsInPlace(ctx) {
  const r = ctx.item;
  const s = lib[r.key] || {};

  // 1. Hero fav + score badge без перемальовки hero-img або iframe трейлера
  const hero = card.querySelector('.mobile-hero');
  if (hero && !ctx.playingTrailer) {
    const favBtn = hero.querySelector('.hero-fav-btn');
    if (favBtn) {
      favBtn.classList.toggle('active', !!s.favorite);
      favBtn.innerHTML = s.favorite
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
    }
    const ir = computeItemRating(s);
    let badge = hero.querySelector('.hero-badge');
    if (ir.avg > 0) {
      const v100 = ir.avg * 10;
      const tCls = v100 >= 80 ? 'temp-green' : (v100 >= 66 ? 'temp-yellow' : (v100 >= 55 ? 'temp-orange' : 'temp-red'));
      if (!badge) {
        badge = el('div', 'hero-badge ' + tCls, fmtNum(ir.avg));
        hero.append(badge);
      } else {
        badge.className = 'hero-badge ' + tCls;
        badge.textContent = fmtNum(ir.avg);
      }
    } else if (badge) {
      badge.remove();
    }
  }

  // 2. Кнопка «Дивлюсь» у заголовку серіалу
  const watchBtn = card.querySelector('.title-watch-btn');
  if (watchBtn) watchBtn.classList.toggle('active', s.status === 'watching');

  // 3. Панель дій, статусів та оцінок (без картинок)
  if (window.MC) {
    const curAct = card.querySelector('.mobile-actions');
    if (curAct) curAct.replaceWith(MC.createActions(ctx));

    const curSt = card.querySelector('.mobile-statuses');
    if (curSt) curSt.replaceWith(MC.createStatuses(ctx));

    const curScore = Array.from(card.querySelectorAll('.mobile-score')).find(el => !el.closest('.mobile-tabs-wrap'));
    if (curScore) curScore.replaceWith(MC.createScoreBlock(ctx));
  }

  // 4. Таби оновлюємо лише якщо активна вкладка залежить від стану (сезони або нотатки)
  if ((ctx.activeTab === 'seasons' || ctx.activeTab === 'notes') && typeof rerenderCardTabsInPlace === 'function') {
    rerenderCardTabsInPlace(ctx);
  }
}

async function openCard(r) {
  if (cardStack.length) return openMediaFromStack(r);
  _libDirtySinceCardOpen = false;
  overlay.classList.add("open");
  const ctx = makeMediaCtx(r);
  cardStack = [ctx];
  pushCardState();
  renderLoading();
  await loadMediaCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

async function openMediaFromStack(item) {
  /* FIX-OMFS */
  overlay.classList.add("open");
  saveCardScroll();
  const ctx = makeMediaCtx(item);
  cardStack.push(ctx);
  pushCardState();
  renderLoading();
  await loadMediaCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

// ---- Lampa ----


function cardBar() {
  const bar = el('div', 'card-bar');
  const back = el('button', 'card-x', '←'); back.title = 'Назад';
  back.addEventListener('click', () => history.back());
  bar.append(back, el('div', 'card-spacer'));
  return bar;
}

function renderLoading() {
  const top = cardStack[cardStack.length - 1];
  card.classList.toggle('is-person', top?.type === 'person' || top?.type === 'company');
  card.innerHTML = '';
  card.append(cardBar());
  const scroll = el('div', 'card-scroll');
  scroll.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Завантаження...</div>';
  card.append(scroll);
}

async function loadMediaCardData(ctx) {
  const r = ctx.item;
  try {
    /* FIX-RELEASE-CARD-FETCH */
    const _extraParts = r.type === 'movie' ? ',release_dates' : '';
    const d = await tmdbFetch(`/${r.type}/${r.id}?language=uk-UA&include_video_language=uk,en,null&append_to_response=credits,videos,external_ids,watch/providers,recommendations,similar,content_ratings,keywords${_extraParts}`);
    ctx.details = d;
    const wikiPromise = (d.external_ids?.wikidata_id && typeof fetchWikiMediaDescription === 'function')
      ? fetchWikiMediaDescription(d.external_ids.wikidata_id)
      : Promise.resolve(null);
    
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
    if (meta.countries !== undefined) { ctx.countries = meta.countries; r.countries = meta.countries; }
    /* FIX-RELEASE-CARD-SAVE */
    let releaseDirty = false;
    if (r.type === 'movie') {
      const _dd = extractDigitalDate(d);
      r.digitalReleaseDate = _dd;
      if (lib[r.key] && lib[r.key].digitalReleaseDate !== _dd) { lib[r.key].digitalReleaseDate = _dd; releaseDirty = true; }
    }
    const _provUA = extractProvidersUA(d);
    r.streamingUA = _provUA;
    if (lib[r.key] && JSON.stringify(lib[r.key].streamingUA || []) !== JSON.stringify(_provUA)) {
      lib[r.key].streamingUA = _provUA;
      releaseDirty = true;
    }
    if ('franchiseKey' in meta) {
      ctx.franchiseKey = meta.franchiseKey;
      r.franchiseKey = meta.franchiseKey;
    }
    if (r.type === 'movie' && 'collection' in meta) {
      ctx.collection = meta.collection;
      r.collection = meta.collection;
    }
    if (lib[r.key]) {
      let dirty = releaseDirty;
      if (meta.genres && !lib[r.key].genres?.length) { lib[r.key].genres = meta.genres; dirty = true; }
      if (meta.cast && !lib[r.key].cast?.length) { lib[r.key].cast = meta.cast; dirty = true; }
      if (lib[r.key].countries === undefined && meta.countries !== undefined) { lib[r.key].countries = meta.countries; dirty = true; }
      if (meta.runtime && !lib[r.key].runtime) { lib[r.key].runtime = meta.runtime; dirty = true; }
      if (meta.episode_count && lib[r.key].episode_count !== meta.episode_count) { lib[r.key].episode_count = meta.episode_count; dirty = true; }
      if (meta.platforms && (!lib[r.key].platforms || !lib[r.key].platforms.length)) { lib[r.key].platforms = meta.platforms; dirty = true; }
      if (r.type === 'movie' && 'collection' in meta && lib[r.key].collection === undefined) { lib[r.key].collection = meta.collection; dirty = true; }
      if ('franchiseKey' in meta && lib[r.key].franchiseKey === undefined) { lib[r.key].franchiseKey = meta.franchiseKey; dirty = true; }
      if (dirty) { _dirtyItems.add(r.key); save(); } /* SYNC-FIX-META-MOVIE */
    }
        if (r.type === 'tv' && d.seasons) {
      // [LAZY-SEASONS] Не вантажимо всі серії одразу
      ctx.details.seasons = d.seasons.map(s => ({ ...s, episodes: [], episodesLoaded: false }));
      const totalSeasons = d.seasons.filter(s => s.season_number !== 0).length;
      const seasonCounts = {};
      d.seasons.forEach(s => { if (s.season_number > 0 && s.episode_count > 0) seasonCounts[s.season_number] = s.episode_count; });
      r.totalSeasons = totalSeasons;
      r.seasonCounts = seasonCounts;
      if (lib[r.key]) {
        let tvDirty = false;
        if (lib[r.key].totalSeasons !== totalSeasons) { lib[r.key].totalSeasons = totalSeasons; tvDirty = true; }
        if (JSON.stringify(lib[r.key].seasonCounts || {}) !== JSON.stringify(seasonCounts)) { lib[r.key].seasonCounts = seasonCounts; tvDirty = true; }
        if (r.runtime && !lib[r.key].runtime) { lib[r.key].runtime = r.runtime; tvDirty = true; }
        if (tvDirty) { _dirtyItems.add(r.key); save(); } /* SYNC-FIX-META-TV */
      }
    }
    ctx.watchProviders = d['watch/providers']?.results?.UA || null;
    
    const recs = d.recommendations?.results || [];
    const sims = d.similar?.results || [];
    const pool = recs.length > 0 ? recs : sims;
    ctx.similar = pool.map(item => normalizeItem({ ...item, media_type: r.type })).filter(item => item.poster && item.id !== r.id);

    // [ASYNC-OMDB] Завантажуємо у фоні, оновлюємо картку коли прийде
    /* FIX-CONTENT-RATINGS */
    if (d.external_ids?.imdb_id) {
      fetch(`${PROXY_URL}/omdb?i=${d.external_ids.imdb_id}`)
        .then(res => res.json())
        .then(omdbData => {
          if (omdbData.Response === "True") {
            ctx.omdb = omdbData;
            if (cardStack[cardStack.length - 1] === ctx) refreshCardTitleInPlace(ctx);
          }
        })
        .catch(e => console.warn('[MyCinema/OMDb] fetch fail:', e));
    }

    // [ASYNC-WIKI] Завантажуємо у фоні, оновлюємо картку коли прийде
    if (d.external_ids?.wikidata_id && typeof fetchWikiMediaDescription === 'function') {
      wikiPromise.then(wiki => {
        if (wiki?.text) {
          ctx.wikiOverview = wiki.text;
          ctx.wikiUrl = wiki.url || null;
          if (cardStack[cardStack.length - 1] === ctx) refreshCardOverviewInPlace(ctx);
        }
      });
    }
  } catch (e) { ctx.error = e.message; }
}

function popTopCardFromBack() {
  if (!cardStack.length) return false;
  const before = cardStack.length;
  try { history.back(); } catch {}
  setTimeout(() => {
    if (cardStack.length === before && before > 0) {
      cardStack.pop();
      const iframe = card.querySelector('.card-hero-video');
      if (iframe) iframe.src = 'about:blank';
      if (!cardStack.length) {
        overlay.classList.remove('open');
        if (!(typeof _flushPendingSetTab === 'function' && _flushPendingSetTab())) refresh();
      } else {
        renderCard(true);
      }
    }
  }, 140);
  return true;
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
  const ctx = makeMediaCtx(item);
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
      const h = s?.ctx ? (s.ctx.type === 'person' ? '#/person/' + s.ctx.id : (s.ctx.type === 'company' ? '#/company/' + s.ctx.id : '#/' + s.ctx.media_type + '/' + s.ctx.id)) : '';
      location.hash = h;
      location.reload();
      return;
    }
    if (s.ctx.type === 'person') await loadPersonForForward(s.ctx.id);
    else if (s.ctx.type === 'company') await loadCompanyForForward(s.ctx.id);
    else if (s.ctx.type === 'media') await loadMediaForForward(s.ctx);
    return;
  }
  while (cardStack.length > depth) cardStack.pop();
  if (depth === 0) {
      overlay.classList.remove('open');
    /* FIX-POPSTATE-FLUSH */
    var _didFlush = (typeof _flushPendingSetTab === 'function') ? _flushPendingSetTab() : false;
    if (!_didFlush) refresh();
  }
  else renderCard(true);
});

function routeFromHash() {
  const m = location.hash.match(/^#\/(movie|tv|person|company)\/(\d+)$/);
  if (!m) return;
  history.replaceState({ mc: 0 }, '', location.pathname + location.search);
  const id = parseInt(m[2]);
  if (m[1] === 'person') openPerson(id);
  else if (m[1] === 'company') openCompany(id);
  else openCard({ key: m[1] + '-' + id, id, type: m[1], title: '', year: '', poster: null, backdrop: null, overview: '', tmdbRating: 0, votes: 0, popularity: 0 });
}

function renderCard(restore) {
  const ctx = cardStack[cardStack.length - 1];
  if (!ctx) { overlay.classList.remove('open'); refresh(); return; }

  const oldIframe = card.querySelector('.card-hero-video');
  if (oldIframe) oldIframe.src = 'about:blank';

  const prevScroll = card.querySelector('.card-scroll');
  const savedScroll = restore ? (ctx.scroll || 0) : (prevScroll ? prevScroll.scrollTop : 0);
  card.classList.toggle('is-person', ctx.type === 'person' || ctx.type === 'company');
  card.innerHTML = '';
  if (settings.posterBg && ctx.type === 'media') {
    const bgPath = ctx.item?.poster || ctx.details?.poster_path;
    if (bgPath) {
      const pbg = el('div', 'card-poster-bg');
      pbg.style.backgroundImage = `url("${TMDB_IMG}w780${bgPath}")`;
      card.append(pbg);
    }
  }
  card.append(cardBar());
  const scroll = el('div', 'card-scroll');
  card.append(scroll);
  if (!ctx.details && !ctx.error) scroll.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Завантаження...</div>';
  else if (ctx.error) scroll.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: ${escapeHtml(ctx.error)}</div>`; /* FIX-CARD-ERR-ESC */
  else if (ctx.type === 'person') renderPersonCard(ctx, scroll);
  else if (ctx.type === 'company') renderCompanyCard(ctx, scroll);
  else {
    const _isDesktop = isDesktopLayout();
    if (_isDesktop && typeof renderDesktopCard === 'function') {
      renderDesktopCard(ctx, scroll);
    } else if (!_isDesktop && typeof renderMobileCard === 'function') {
      renderMobileCard(ctx, scroll);
    } else {
      scroll.innerHTML = '<div style="text-align:center; padding:40px; color:var(--danger);">UI картки не завантажено</div>';
    }
  }
  if (savedScroll > 0) {
    scroll.scrollTop = savedScroll;
    requestAnimationFrame(() => { if (scroll.isConnected) scroll.scrollTop = savedScroll; });
  }
}

/* FIX-CARD-EMPTY-BASE
   ─────────────────────────────────────────────────────────────
   ЧИСТИЙ АРКУШ.
   Тут буде новий UI картки (Mobile/Desktop).
   Поки що — порожня заглушка, щоб перевірити, що навігація та
   завантаження даних працюють.
   ───────────────────────────────────────────────────────────── */

function attachCtxMeta(entry, ctx) {
  if (!entry || !ctx || ctx.type !== 'media' || ctx.item?.key !== entry.key) return;
  if (ctx.genres?.length && !entry.genres?.length) entry.genres = ctx.genres;
  if (ctx.cast?.length && !entry.cast?.length) entry.cast = ctx.cast;
  if (entry.countries === undefined && ctx.countries !== undefined) entry.countries = ctx.countries;
  if (entry.type === 'tv' && !entry.totalSeasons && ctx.details?.seasons) {
    entry.totalSeasons = ctx.details.seasons.filter(x => x.season_number !== 0).length;
  }
  // [FIX-BUG-6] Переносимо episode_count одразу, щоб прогрес-бар не був без знаменника
  if (entry.type === 'tv' && !entry.episode_count && ctx.details?.number_of_episodes) {
    entry.episode_count = ctx.details.number_of_episodes;
  }
  if (entry.type === 'tv' && ctx.item?.seasonCounts && !entry.seasonCounts) {
    entry.seasonCounts = ctx.item.seasonCounts;
  }
  if (entry.type === 'movie' && entry.collection === undefined && ctx.collection !== undefined) {
    entry.collection = ctx.collection;
  }
  if (entry.franchiseKey === undefined && ctx.franchiseKey !== undefined) {
    entry.franchiseKey = ctx.franchiseKey;
  }
}

function updateCore(r, patch) {
  const cur = lib[r.key] || { ...r, status: null, ratings: null, watchedEpisodes: [] };
  if (!cur.createdAt) cur.createdAt = Date.now();
  const merged = { ...cur, ...patch, updated: Date.now() };
  if (patch.status !== undefined && patch.status !== cur.status) merged.statusDate = Date.now();
  const ctx = cardStack[cardStack.length - 1];
  attachCtxMeta(merged, ctx);
  lib[r.key] = merged;
  _dirtyItems.add(r.key); // Позначаємо для синхронізації
  markCardLibDirty(); // updateCore
  const hasR = lib[r.key].ratings && Object.values(lib[r.key].ratings).some(v => v > 0);
  const hasSR = lib[r.key].seasonRatings && Object.keys(lib[r.key].seasonRatings).length > 0;
  const hasEps = lib[r.key].watchedEpisodes && lib[r.key].watchedEpisodes.length > 0;
  const hasNotes = (lib[r.key].notes && lib[r.key].notes.trim()) || (lib[r.key].notesHistory && lib[r.key].notesHistory.length > 0);
  const hasElo = lib[r.key].eloGames && lib[r.key].eloGames > 0;
  const hasFav = lib[r.key].favorite === true;
  const hasTasteFlags = lib[r.key].excludeFromProfile !== undefined || lib[r.key].antiSeed === true;
  if (!lib[r.key].status && !hasR && !hasSR && !hasEps && !hasNotes && !hasElo && !hasFav && !hasTasteFlags) removeLibItem(r.key);
  save();
}
function update(r, patch) {
  updateCore(r, patch);
  const ctx = cardStack[cardStack.length - 1];
  if (ctx && ctx.type === 'media' && ctx.item?.key === r.key && card.querySelector('.mobile-hero')) {
    refreshCardControlsInPlace(ctx);
  } else {
    renderCard();
  }
}
function updateNoRender(r, patch) { updateCore(r, patch); }

