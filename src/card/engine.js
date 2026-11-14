/* FIX-CARD-ENGINE — двигун картки: навігація, дані, оновлення, оркестратор renderCard */

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
let _pendingNoteFlush = null;
function flushPendingNotes() {
  if (typeof _pendingNoteFlush === 'function') {
    const fn = _pendingNoteFlush;
    _pendingNoteFlush = null;
    fn();
  }
}

function saveCardScroll() {
  flushPendingNotes();
  const s = card.querySelector('.card-scroll');
  const top = cardStack[cardStack.length - 1];
  if (s && top) top.scroll = s.scrollTop;
}

async function openCard(r) {
  if (cardStack.length) return openMediaFromStack(r);
  overlay.classList.add("open");
  const ctx = { type: 'media', item: r, activeTab: r.type === 'tv' ? 'seasons' : 'cast', seasonState: {}, playingTrailer: false, overviewExpanded: false, overviewSource: 'tmdb' }; /* FIX-DEFAULT-TAB */ /* FIX-OVERSRC-1 */
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
  const ctx = { type: 'media', item, activeTab: item.type === 'tv' ? 'seasons' : 'cast', seasonState: {}, playingTrailer: false, overviewExpanded: false, overviewSource: 'tmdb' }; /* FIX-DEFAULT-TAB */
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
  bar.append(back, el('div', 'card-spacer'));
  return bar;
}

function renderLoading() {
  const top = cardStack[cardStack.length - 1];
  card.classList.toggle('is-person', top?.type === 'person');
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
    /* FIX-RELEASE-CARD-SAVE */
    if (r.type === 'movie') {
      const _dd = extractDigitalDate(d);
      r.digitalReleaseDate = _dd;
      if (lib[r.key]) lib[r.key].digitalReleaseDate = _dd;
    }
    const _provUA = extractProvidersUA(d);
    r.streamingUA = _provUA;
    if (lib[r.key]) lib[r.key].streamingUA = _provUA;
    _dirtyItems.add(r.key);
    if ('franchiseKey' in meta) {
      ctx.franchiseKey = meta.franchiseKey;
      r.franchiseKey = meta.franchiseKey;
    }
    if (r.type === 'movie' && 'collection' in meta) {
      ctx.collection = meta.collection;
      r.collection = meta.collection;
    }
    if (lib[r.key]) {
      let dirty = false;
      if (meta.genres && !lib[r.key].genres?.length) { lib[r.key].genres = meta.genres; dirty = true; }
      if (meta.cast && !lib[r.key].cast?.length) { lib[r.key].cast = meta.cast; dirty = true; }
      if (meta.runtime && !lib[r.key].runtime) { lib[r.key].runtime = meta.runtime; dirty = true; }
      if (meta.episode_count && lib[r.key].episode_count !== meta.episode_count) { lib[r.key].episode_count = meta.episode_count; dirty = true; }
      if (meta.platforms && (!lib[r.key].platforms || !lib[r.key].platforms.length)) { lib[r.key].platforms = meta.platforms; dirty = true; }
      if (r.type === 'movie' && 'collection' in meta && lib[r.key].collection === undefined) { lib[r.key].collection = meta.collection; dirty = true; }
      if ('franchiseKey' in meta && lib[r.key].franchiseKey === undefined) { lib[r.key].franchiseKey = meta.franchiseKey; dirty = true; }
      if (dirty) { _dirtyItems.add(r.key); save(); } /* SYNC-FIX-META-MOVIE */
    }
        if (r.type === "tv" && d.seasons) {
      // [LAZY-SEASONS] Не вантажимо всі серії одразу
      ctx.details.seasons = d.seasons.map(s => ({ ...s, episodes: [], episodesLoaded: false }));
      const totalSeasons = d.seasons.filter(s => s.season_number !== 0).length;
      /* FIX-REFINED-REMOVED */ r.totalSeasons = totalSeasons;
      if (lib[r.key]) {
        let tvDirty = false;
        if (lib[r.key].totalSeasons !== totalSeasons) { lib[r.key].totalSeasons = totalSeasons; tvDirty = true; }
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
            if (cardStack[cardStack.length - 1] === ctx) { saveCardScroll(); renderCard(true); } /* FIX-OMDB-SCROLL */
          }
        })
        .catch(e => console.warn('[MyCinema/OMDb] fetch fail:', e));
    }

    // [ASYNC-WIKI] Завантажуємо у фоні, оновлюємо картку коли прийде
    if (d.external_ids?.wikidata_id && typeof fetchWikiMediaDescription === 'function') {
      fetchWikiMediaDescription(d.external_ids.wikidata_id).then(wiki => {
        if (wiki?.text) {
          ctx.wikiOverview = wiki.text;
          ctx.wikiUrl = wiki.url || null;
          if (cardStack[cardStack.length - 1] === ctx) { saveCardScroll(); renderCard(true); } /* FIX-WIKI-SCROLL */
        }
      });
    }
  } catch (e) { ctx.error = e.message; }
}

function closeCard() {
  flushPendingNotes();
  const iframe = card.querySelector('.card-hero-video');
  if (iframe) iframe.src = 'about:blank';

  if (cardStack.length) history.go(-cardStack.length);
  else { overlay.classList.remove('open'); refresh(); }
}

async function loadMediaForForward(s) {
  overlay.classList.add("open");
  const item = { key: s.key, id: s.id, type: s.media_type, title: '', year: '', poster: null, backdrop: null, overview: '', tmdbRating: 0, votes: 0, popularity: 0 };
  const ctx = { type: 'media', item, activeTab: item.type === 'tv' ? 'seasons' : 'cast', seasonState: {}, playingTrailer: false, overviewExpanded: false, overviewSource: 'tmdb' }; /* FIX-DEFAULT-TAB */ /* FIX-LMFF */
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
  if (depth === 0) {
    flushPendingNotes();
    overlay.classList.remove('open');
    /* FIX-POPSTATE-FLUSH */
    var _didFlush = (typeof _flushPendingSetTab === 'function') ? _flushPendingSetTab() : false;
    if (!_didFlush) refresh();
  }
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
  flushPendingNotes();
  const ctx = cardStack[cardStack.length - 1];
  if (!ctx) { overlay.classList.remove('open'); refresh(); return; }

  const oldIframe = card.querySelector('.card-hero-video');
  if (oldIframe) oldIframe.src = 'about:blank';

  const prevScroll = card.querySelector('.card-scroll');
  const savedScroll = restore ? (ctx.scroll || 0) : (prevScroll ? prevScroll.scrollTop : 0);
  card.classList.toggle('is-person', ctx.type === 'person');
  card.innerHTML = '';
  card.append(cardBar());
  const scroll = el('div', 'card-scroll');
  card.append(scroll);
  if (!ctx.details && !ctx.error) scroll.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Завантаження...</div>';
  else if (ctx.error) scroll.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: ${escapeHtml(ctx.error)}</div>`; /* FIX-CARD-ERR-ESC */
  else if (ctx.type === 'person') renderPersonCard(ctx, scroll);
  else {
    const _isDesktop = window.matchMedia('(min-width: 900px) and (min-height: 600px)').matches;
    if (_isDesktop && typeof renderDesktopCard === 'function') {
      renderDesktopCard(ctx, scroll);
    } else if (!_isDesktop && typeof renderMobileCard === 'function') {
      renderMobileCard(ctx, scroll);
    } else {
      scroll.innerHTML = '<div style="text-align:center; padding:40px; color:var(--danger);">UI картки не завантажено</div>';
    }
  }
  if (savedScroll > 0) scroll.scrollTop = savedScroll;
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
  if (entry.type === 'tv' && !entry.totalSeasons && ctx.details?.seasons) {
    entry.totalSeasons = ctx.details.seasons.filter(x => x.season_number !== 0).length;
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
  const hasR = lib[r.key].ratings && Object.values(lib[r.key].ratings).some(v => v > 0);
  const hasSR = lib[r.key].seasonRatings && Object.keys(lib[r.key].seasonRatings).length > 0;
  const hasEps = lib[r.key].watchedEpisodes && lib[r.key].watchedEpisodes.length > 0;
  const hasNotes = lib[r.key].notes && lib[r.key].notes.trim();
  const hasElo = lib[r.key].eloGames && lib[r.key].eloGames > 0;
  const hasFav = lib[r.key].favorite === true;
  const hasTasteFlags = lib[r.key].excludeFromProfile !== undefined || lib[r.key].antiSeed === true;
  if (!lib[r.key].status && !hasR && !hasSR && !hasEps && !hasNotes && !hasElo && !hasFav && !hasTasteFlags) removeLibItem(r.key);
  save();
}
function update(r, patch) { updateCore(r, patch); renderCard(); }
function updateNoRender(r, patch) { updateCore(r, patch); }

