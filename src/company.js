'use strict';

const COMPANY_CACHE_KEY = 'mycinema.companyCache.v1';
const COMPANY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const COMPANY_CACHE_MAX = 25;

const _companyInfoMem = new Map();
const _companyPageMem = new Map();

function readCompanyCacheAll() {
  const raw = typeof mcCacheGet === 'function' ? mcCacheGet(COMPANY_CACHE_KEY, {}) : {};
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

function writeCompanyCacheAll(cache) {
  try {
    const entries = Object.entries(cache);
    if (entries.length > COMPANY_CACHE_MAX) {
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      cache = Object.fromEntries(entries.slice(0, COMPANY_CACHE_MAX));
    }
    if (typeof mcCacheSet === 'function') mcCacheSet(COMPANY_CACHE_KEY, cache);
  } catch {}
}

function packCompactCompanyItems(items) {
  return (items || []).map(x => ({
    key: x.key,
    id: x.id,
    type: x.type,
    title: x.title,
    year: x.year,
    releaseDate: x.releaseDate || '',
    poster: x.poster || null,
    backdrop: x.backdrop || null,
    tmdbRating: x.tmdbRating || 0,
    votes: x.votes || 0,
    popularity: x.popularity || 0,
    genres: x.genres || []
  }));
}

async function fetchCompanyInfoCached(companyId) {
  const idStr = String(companyId);
  if (_companyInfoMem.has(idStr)) return _companyInfoMem.get(idStr);

  const cache = readCompanyCacheAll();
  const entry = cache[idStr];
  if (entry && entry.info && (Date.now() - (entry.ts || 0)) < COMPANY_CACHE_TTL) {
    entry.ts = Date.now();
    writeCompanyCacheAll(cache);
    _companyInfoMem.set(idStr, entry.info);
    return entry.info;
  }

  const d = await tmdbFetch(`/company/${companyId}`);
  const info = {
    id: d.id,
    name: d.name || '',
    description: (d.description || '').trim(),
    headquarters: d.headquarters || '',
    homepage: d.homepage || '',
    logo_path: d.logo_path || null,
    origin_country: d.origin_country || '',
    parent_company: d.parent_company ? {
      id: d.parent_company.id,
      name: d.parent_company.name || '',
      logo_path: d.parent_company.logo_path || null
    } : null
  };

  _companyInfoMem.set(idStr, info);
  cache[idStr] = { ...(cache[idStr] || {}), ts: Date.now(), info };
  writeCompanyCacheAll(cache);
  return info;
}

async function fetchCompanyDiscoverPage(companyId, mediaType, sortBy, page) {
  const idStr = String(companyId);
  const memKey = `${idStr}:${mediaType}:${sortBy}:${page}`;
  if (_companyPageMem.has(memKey)) return _companyPageMem.get(memKey);

  const isDefaultFirst = (page === 1 && sortBy === 'popularity.desc');
  const cacheField = mediaType === 'tv' ? 'tv1' : 'movie1';
  if (isDefaultFirst) {
    const cache = readCompanyCacheAll();
    const entry = cache[idStr];
    if (entry && entry[cacheField] && (Date.now() - (entry.ts || 0)) < COMPANY_CACHE_TTL) {
      const res = {
        items: entry[cacheField].items || [],
        totalResults: entry[cacheField].totalResults || 0,
        totalPages: entry[cacheField].totalPages || 1
      };
      _companyPageMem.set(memKey, res);
      return res;
    }
  }

  const apiSort = (mediaType === 'tv' && sortBy === 'primary_release_date.desc')
    ? 'first_air_date.desc'
    : sortBy;

  const p = new URLSearchParams({
    language: 'uk-UA',
    with_companies: idStr,
    sort_by: apiSort,
    include_adult: 'false',
    page: String(page)
  });
  if (sortBy === 'vote_average.desc') p.set('vote_count.gte', '50');
  if (mediaType === 'tv') p.set('without_genres', EXCLUDED_TV_GENRES.join(','));

  const d = await tmdbFetch(`/discover/${mediaType}?${p.toString()}`);
  const items = (d.results || [])
    .filter(r => r && r.poster_path && (typeof isExcludedShow !== 'function' || !isExcludedShow(r, mediaType)))
    .map(r => normalizeItem({ ...r, media_type: mediaType }));

  const res = {
    items,
    totalResults: d.total_results || items.length,
    totalPages: d.total_pages || 1
  };
  _companyPageMem.set(memKey, res);

  if (isDefaultFirst) {
    const cache = readCompanyCacheAll();
    cache[idStr] = {
      ...(cache[idStr] || {}),
      ts: Date.now(),
      [cacheField]: {
        items: packCompactCompanyItems(items),
        totalResults: res.totalResults,
        totalPages: res.totalPages
      }
    };
    writeCompanyCacheAll(cache);
  }
  return res;
}

function makeCompanyCtx(companyId) {
  return {
    type: 'company',
    id: companyId,
    companyTab: 'movie',
    companySort: 'popularity.desc',
    pages: { movie: null, tv: null },
    loadingMore: false,
    _seq: 0
  };
}

async function openCompany(companyId) {
  if (!companyId) return;
  overlay.classList.add('open');
  const top = cardStack[cardStack.length - 1];
  if (top && top.type === 'company' && top.id === companyId) return;
  saveCardScroll();
  const ctx = makeCompanyCtx(companyId);
  cardStack.push(ctx);
  pushCardState();
  renderLoading();
  await loadCompanyCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

async function loadCompanyForForward(id) {
  overlay.classList.add('open');
  const ctx = makeCompanyCtx(id);
  cardStack.push(ctx);
  renderLoading();
  await loadCompanyCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

async function loadCompanyCardData(ctx) {
  try {
    const [info, moviePage, tvPage] = await Promise.all([
      fetchCompanyInfoCached(ctx.id),
      fetchCompanyDiscoverPage(ctx.id, 'movie', ctx.companySort, 1),
      fetchCompanyDiscoverPage(ctx.id, 'tv', ctx.companySort, 1)
    ]);
    ctx.details = info;
    ctx.pages.movie = { page: 1, sort: ctx.companySort, ...moviePage, items: [...moviePage.items] };
    ctx.pages.tv = { page: 1, sort: ctx.companySort, ...tvPage, items: [...tvPage.items] };
    ctx.companyTab = (moviePage.totalResults > 0 || !tvPage.totalResults) ? 'movie' : 'tv';
  } catch (e) {
    // Екранування робить renderCard — інакше повідомлення видно з &amp;/&lt;.
    ctx.error = e.message;
  }
}

async function reloadCompanyTabData(ctx, mediaType, append) {
  if (ctx.loadingMore) return;
  const seq = ++ctx._seq;
  ctx.loadingMore = true;
  const cur = ctx.pages[mediaType];
  const nextPage = append && cur && cur.sort === ctx.companySort ? (cur.page + 1) : 1;

  if (cardStack[cardStack.length - 1] === ctx) {
    saveCardScroll();
    renderCard(true);
  }

  try {
    const res = await fetchCompanyDiscoverPage(ctx.id, mediaType, ctx.companySort, nextPage);
    if (ctx._seq !== seq) return;
    if (append && cur && cur.sort === ctx.companySort) {
      const seen = new Set(cur.items.map(x => x.key));
      res.items.forEach(x => { if (!seen.has(x.key)) { seen.add(x.key); cur.items.push(x); } });
      cur.page = nextPage;
      cur.totalResults = res.totalResults;
      cur.totalPages = res.totalPages;
    } else {
      ctx.pages[mediaType] = {
        page: 1,
        sort: ctx.companySort,
        items: [...res.items],
        totalResults: res.totalResults,
        totalPages: res.totalPages
      };
    }
  } catch (e) {
    showSyncToast('⚠ Помилка завантаження');
  } finally {
    ctx.loadingMore = false;
    if (cardStack[cardStack.length - 1] === ctx) {
      saveCardScroll();
      renderCard(true);
    }
  }
}

function renderCompanyCard(ctx, scroll) {
  const d = ctx.details;
  if (!d) return;

  const header = el('div', 'person-header company-header');
  const logoWrap = el('div', 'company-logo-box');
  if (d.logo_path) {
    const img = el('img', 'company-logo-img');
    img.src = TMDB_IMG + 'w300' + d.logo_path;
    img.alt = d.name || '';
    logoWrap.append(img);
  } else {
    logoWrap.classList.add('empty');
    logoWrap.textContent = (d.name || '?').charAt(0).toUpperCase();
  }
  header.append(logoWrap);

  const info = el('div');
  info.style.minWidth = '0';
  info.append(el('div', 'person-name', d.name || 'Студія'));

  const metaParts = [];
  if (d.origin_country) metaParts.push(d.origin_country);
  if (d.headquarters) metaParts.push(d.headquarters);
  if (metaParts.length) info.append(el('div', 'person-meta', metaParts.join(' · ')));

  const loadedAll = [
    ...(ctx.pages.movie?.items || []),
    ...(ctx.pages.tv?.items || [])
  ];
  const seenKeys = new Set();
  const inLibWatched = [];
  loadedAll.forEach(it => {
    if (seenKeys.has(it.key)) return;
    seenKeys.add(it.key);
    const saved = lib[it.key];
    if (saved && hasWatched(saved)) inLibWatched.push(saved);
  });
  if (inLibWatched.length > 0) {
    const rated = inLibWatched.map(x => computeItemRating(x).avg).filter(v => v > 0);
    const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
    const statTxt = `📚 У бібліотеці: ${inLibWatched.length}` + (avg > 0 ? ` · ⭐ ${fmtNum(avg)}` : '');
    info.append(el('div', 'person-lib-badge', statTxt));
  }

  const linksRow = el('div', 'company-links-row');
  if (d.homepage && /^https?:\/\//i.test(d.homepage)) {
    const siteLink = el('a', 'person-wiki-link', '🌐 Офіційний сайт ↗');
    siteLink.href = d.homepage;
    siteLink.target = '_blank';
    siteLink.rel = 'noopener noreferrer';
    linksRow.append(siteLink);
  }
  if (d.parent_company && d.parent_company.id) {
    const parentBtn = el('button', 'company-parent-chip', `🏢 ${d.parent_company.name} →`);
    parentBtn.type = 'button';
    parentBtn.addEventListener('click', () => openCompany(d.parent_company.id));
    linksRow.append(parentBtn);
  }
  if (linksRow.childElementCount > 0) info.append(linksRow);

  header.append(info);
  scroll.append(header);

  if (d.description) {
    scroll.append(el('div', 'company-desc', d.description));
  }

  const mTotal = ctx.pages.movie?.totalResults || 0;
  const tTotal = ctx.pages.tv?.totalResults || 0;
  const tabs = el('div', 'card-tabs');
  const mTab = el('button', 'card-tab' + (ctx.companyTab === 'movie' ? ' active' : ''), `🎬 Фільми (${mTotal})`);
  const tTab = el('button', 'card-tab' + (ctx.companyTab === 'tv' ? ' active' : ''), `📺 Серіали (${tTotal})`);

  mTab.addEventListener('click', () => {
    if (ctx.companyTab === 'movie') return;
    ctx.companyTab = 'movie';
    if (!ctx.pages.movie || ctx.pages.movie.sort !== ctx.companySort) {
      reloadCompanyTabData(ctx, 'movie', false);
    } else {
      saveCardScroll();
      renderCard(true);
    }
  });
  tTab.addEventListener('click', () => {
    if (ctx.companyTab === 'tv') return;
    ctx.companyTab = 'tv';
    if (!ctx.pages.tv || ctx.pages.tv.sort !== ctx.companySort) {
      reloadCompanyTabData(ctx, 'tv', false);
    } else {
      saveCardScroll();
      renderCard(true);
    }
  });
  tabs.append(mTab, tTab);
  scroll.append(tabs);

  // Сортування
  const sortBar = el('div', 'company-sort-bar');
  const sortDefs = [
    { id: 'popularity.desc', label: '🔥 Популярні' },
    { id: 'vote_average.desc', label: '⭐ За рейтингом' },
    { id: 'primary_release_date.desc', label: '🆕 Новіші' }
  ];
  sortDefs.forEach(sd => {
    const sb = el('button', 'recs-mode-pill' + (ctx.companySort === sd.id ? ' active' : ''), sd.label);
    sb.type = 'button';
    sb.addEventListener('click', () => {
      if (ctx.companySort === sd.id || ctx.loadingMore) return;
      ctx.companySort = sd.id;
      reloadCompanyTabData(ctx, ctx.companyTab, false);
    });
    sortBar.append(sb);
  });
  scroll.append(sortBar);

  const curData = ctx.pages[ctx.companyTab];
  if (!curData || (ctx.loadingMore && curData.sort !== ctx.companySort)) {
    scroll.append(el('div', 'avail-empty', 'Завантаження...'));
    return;
  }

  const items = curData.items || [];
  if (!items.length) {
    scroll.append(el('div', 'avail-empty', 'Немає даних'));
    return;
  }

  const grid = el('div', 'filmography-grid');
  grid.style.marginTop = '14px';
  items.forEach(item => {
    const c = el('div', 'filmography-card');
    const poster = el('img', 'filmography-poster');
    poster.src = TMDB_IMG + 'w342' + item.poster;
    poster.loading = 'lazy';
    poster.decoding = 'async';
    c.append(poster);
    c.append(el('div', 'filmography-title', item.title || ''));

    const saved = lib[item.key];
    const savedAvg = saved ? computeItemRating(saved).avg : 0;
    const parts = [];
    if (item.year) parts.push(item.year);
    if (item.tmdbRating > 0) parts.push(item.tmdbRating.toFixed(1));
    if (savedAvg > 0) parts.push('⭐ ' + fmtNum(savedAvg));
    else if (saved?.status === 'watched') parts.push('✅');
    else if (saved?.status === 'watching') parts.push('▶️');
    else if (saved?.status === 'planned') parts.push('📅');
    if (parts.length) c.append(el('div', 'filmography-year', parts.join(' · ')));

    c.addEventListener('click', () => openMediaFromStack(item));
    grid.append(c);
  });
  scroll.append(grid);

  if (curData.page < curData.totalPages) {
    const moreBtn = el('button', 'home-more', ctx.loadingMore ? 'Завантаження...' : 'Показати ще');
    moreBtn.type = 'button';
    moreBtn.disabled = ctx.loadingMore;
    moreBtn.addEventListener('click', () => reloadCompanyTabData(ctx, ctx.companyTab, true));
    scroll.append(moreBtn);
  }
}
