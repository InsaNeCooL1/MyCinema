/* [STREAMINGS] Сторінка стрімінгів + профіль каталогу сервісу (TMDB Watch Providers).
   Каталог береться через /discover?with_watch_providers=...&watch_region=...,
   а не через production company — інакше замість каталогу підписки видно
   кілька власних продюсерських тайтлів студії. */

'use strict';

const STREAMING_CACHE_KEY = 'mycinema.streamingCache.v1';
const STREAMING_CACHE_TTL = 3 * 24 * 60 * 60 * 1000;
const STREAMING_CACHE_MAX = 60;
const STREAMING_REGION_KEY = 'mycinema.streamingRegion.v1';

const _streamingMem = new Map();

function streamingServices() {
  return (typeof MC_STREAMINGS !== 'undefined' && MC_STREAMINGS && Array.isArray(MC_STREAMINGS.services))
    ? MC_STREAMINGS.services
    : [];
}

function streamingRegionMeta(code) {
  const list = (typeof MC_STREAMINGS !== 'undefined' && MC_STREAMINGS && MC_STREAMINGS.regions) || [];
  return list.find(r => r.code === code) || { code, name: code };
}

function streamingDefaultRegion() {
  return (typeof MC_STREAMINGS !== 'undefined' && MC_STREAMINGS && MC_STREAMINGS.defaultRegion) || 'UA';
}

function streamingServiceByKey(key) {
  return streamingServices().find(s => s.key === key) || null;
}

/* Пошук сервісу за назвою мережі/студії (для бейджа в картці тайтлу). */
function findStreamingServiceByName(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  const alias = { netflix: ['netflix'], prime: ['amazon', 'prime video'], disney: ['disney+', 'disney plus'], hbo: ['hbo max', 'max'], apple: ['apple tv+', 'apple tv'], paramount: ['paramount+', 'paramount plus'], hulu: ['hulu'], peacock: ['peacock'], sky: ['sky', 'now tv'], starz: ['starz'], mubi: ['mubi'], crunchyroll: ['crunchyroll'] };
  return streamingServices().find(s => (alias[s.key] || [s.name.toLowerCase()]).some(a => needle === a || needle.includes(a))) || null;
}

function streamingRegionsOf(service) {
  if (!service || !service.regions) return [];
  const order = ((typeof MC_STREAMINGS !== 'undefined' && MC_STREAMINGS && MC_STREAMINGS.regions) || []).map(r => r.code);
  return order.filter(code => service.regions[code]);
}

function streamingPickRegion(service, wanted) {
  if (!service || !service.regions) return '';
  const available = streamingRegionsOf(service);
  if (!available.length) return '';
  if (wanted && service.regions[wanted]) return wanted;
  const fallback = streamingDefaultRegion();
  if (service.regions[fallback]) return fallback;
  return available[0];
}

function readStreamingCacheAll() {
  const raw = typeof mcCacheGet === 'function' ? mcCacheGet(STREAMING_CACHE_KEY, {}) : {};
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

function writeStreamingCacheAll(cache) {
  try {
    const entries = Object.entries(cache);
    if (entries.length > STREAMING_CACHE_MAX) {
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      cache = Object.fromEntries(entries.slice(0, STREAMING_CACHE_MAX));
    }
    if (typeof mcCacheSet === 'function') mcCacheSet(STREAMING_CACHE_KEY, cache);
  } catch {}
}

function packStreamingItems(items) {
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

async function fetchStreamingPage(serviceKey, region, mediaType, sortBy, page) {
  const svc = streamingServiceByKey(serviceKey);
  const reg = svc && svc.regions ? svc.regions[region] : null;
  if (!reg || !Array.isArray(reg.ids) || !reg.ids.length) {
    return { items: [], totalResults: 0, totalPages: 0, unavailable: true };
  }

  const memKey = `${serviceKey}:${region}:${mediaType}:${sortBy}:${page}`;
  if (_streamingMem.has(memKey)) return _streamingMem.get(memKey);

  const isDefaultFirst = (page === 1 && sortBy === 'popularity.desc');
  const cacheField = mediaType === 'tv' ? 'tv1' : 'movie1';
  const cacheFieldKey = `${serviceKey}:${region}`;
  if (isDefaultFirst) {
    const cache = readStreamingCacheAll();
    const entry = cache[cacheFieldKey];
    if (entry && entry[cacheField] && (Date.now() - (entry.ts || 0)) < STREAMING_CACHE_TTL) {
      const res = {
        items: entry[cacheField].items || [],
        totalResults: entry[cacheField].totalResults || 0,
        totalPages: entry[cacheField].totalPages || 1
      };
      _streamingMem.set(memKey, res);
      return res;
    }
  }

  const apiSort = (mediaType === 'tv' && sortBy === 'primary_release_date.desc')
    ? 'first_air_date.desc'
    : sortBy;

  const p = new URLSearchParams({
    language: 'uk-UA',
    watch_region: region,
    with_watch_providers: reg.ids.join('|'),
    with_watch_monetization_types: 'flatrate',
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
  _streamingMem.set(memKey, res);

  if (isDefaultFirst) {
    const cache = readStreamingCacheAll();
    cache[cacheFieldKey] = {
      ...(cache[cacheFieldKey] || {}),
      ts: Date.now(),
      [cacheField]: {
        items: packStreamingItems(items),
        totalResults: res.totalResults,
        totalPages: res.totalPages
      }
    };
    writeStreamingCacheAll(cache);
  }
  return res;
}

function makeStreamingCtx(service, region) {
  return {
    type: 'streaming',
    key: service.key,
    id: service.key,
    service,
    streamingRegion: streamingPickRegion(service, region),
    streamingTab: 'tv',
    streamingSort: 'popularity.desc',
    pages: { movie: null, tv: null },
    loadingMore: false,
    _seq: 0
  };
}

async function openStreaming(key, region) {
  const service = streamingServiceByKey(key);
  if (!service) return;
  overlay.classList.add('open');
  const top = cardStack[cardStack.length - 1];
  if (top && top.type === 'streaming' && top.key === key && (!region || top.streamingRegion === region)) return;
  saveCardScroll();
  const ctx = makeStreamingCtx(service, region);
  cardStack.push(ctx);
  pushCardState();
  renderLoading();
  await loadStreamingCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

async function loadStreamingForForward(key, region) {
  const service = streamingServiceByKey(key);
  if (!service) return;
  overlay.classList.add('open');
  const ctx = makeStreamingCtx(service, region);
  cardStack.push(ctx);
  renderLoading();
  await loadStreamingCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

async function loadStreamingCardData(ctx) {
  const region = ctx.streamingRegion;
  const seq = ++ctx._seq;
  try {
    const [moviePage, tvPage] = await Promise.all([
      fetchStreamingPage(ctx.key, region, 'movie', ctx.streamingSort, 1),
      fetchStreamingPage(ctx.key, region, 'tv', ctx.streamingSort, 1)
    ]);
    if (ctx.streamingRegion !== region || ctx._seq !== seq) return;
    ctx.pages.movie = { page: 1, sort: ctx.streamingSort, ...moviePage, items: [...moviePage.items] };
    ctx.pages.tv = { page: 1, sort: ctx.streamingSort, ...tvPage, items: [...tvPage.items] };
  } catch (e) {
    if (ctx.streamingRegion === region && ctx._seq === seq) ctx.error = e.message;
  }
}

async function reloadStreamingTabData(ctx, mediaType, append) {
  if (ctx.loadingMore) return;
  const seq = ++ctx._seq;
  ctx.loadingMore = true;
  const cur = ctx.pages[mediaType];
  const nextPage = append && cur && cur.sort === ctx.streamingSort ? (cur.page + 1) : 1;

  if (cardStack[cardStack.length - 1] === ctx) {
    saveCardScroll();
    renderCard(true);
  }

  try {
    const res = await fetchStreamingPage(ctx.key, ctx.streamingRegion, mediaType, ctx.streamingSort, nextPage);
    if (ctx._seq !== seq) return;
    if (append && cur && cur.sort === ctx.streamingSort) {
      const seen = new Set(cur.items.map(x => x.key));
      res.items.forEach(x => { if (!seen.has(x.key)) { seen.add(x.key); cur.items.push(x); } });
      cur.page = nextPage;
      cur.totalResults = res.totalResults;
      cur.totalPages = res.totalPages;
    } else {
      ctx.pages[mediaType] = {
        page: 1,
        sort: ctx.streamingSort,
        items: [...res.items],
        totalResults: res.totalResults,
        totalPages: res.totalPages
      };
    }
  } catch (e) {
    showSyncToast('⚠ Помилка завантаження каталогу');
  } finally {
    ctx.loadingMore = false;
    if (cardStack[cardStack.length - 1] === ctx) {
      saveCardScroll();
      renderCard(true);
    }
  }
}

async function switchStreamingRegion(ctx, region) {
  if (!region || ctx.streamingRegion === region) return;
  ctx.streamingRegion = region;
  ctx._seq++;
  ctx.loadingMore = false;
  ctx.pages = { movie: null, tv: null };
  if (cardStack[cardStack.length - 1] === ctx) {
    saveCardScroll();
    renderCard(true);
  }
  await loadStreamingCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  saveCardScroll();
  renderCard(true);
}

function renderStreamings() {
  box.style.padding = 'var(--mc-home-pad, 0 16px)';
  box.replaceChildren();

  const services = streamingServices();
  if (!services.length) {
    box.append(el('div', 'avail-empty', 'Дані стрімінгів недоступні.'));
    return;
  }

  const wrap = el('div', 'collections-page');
  const head = el('div', 'section-head');
  head.append(el('h1', 'section-title', '📺 Стріммінги'));
  head.append(el('span', 'section-sub', `${services.length} сервісів · каталоги TMDB`));
  wrap.append(head);

  const grid = el('div', 'collections-masonry streaming-masonry');
  services.forEach(service => {
    const card = el('button', 'collection-card streaming-card');
    card.type = 'button';
    const logoWrap = el('div', 'streaming-logo-wrap');
    if (service.logo) {
      const img = el('img');
      img.src = TMDB_IMG + 'w185' + service.logo;
      img.alt = service.name;
      img.loading = 'lazy';
      logoWrap.append(img);
    } else {
      logoWrap.append(el('div', 'collections-cover-empty', '📺'));
    }
    card.append(logoWrap);
    card.append(el('div', 'collection-card-title', service.name));

    const regions = streamingRegionsOf(service);
    const defaultRegion = streamingDefaultRegion();
    const hasDefault = !!service.regions[defaultRegion];
    const hint = hasDefault
      ? `${defaultRegion} · ${regions.length} рег.`
      : `немає в ${defaultRegion} · ${regions[0] || '—'}`;
    card.append(el('div', 'collection-card-desc streaming-card-region', hint));
    card.addEventListener('click', () => openStreaming(service.key));
    grid.append(card);
  });
  wrap.append(grid);

  box.append(wrap);
}

function renderStreamingCard(ctx, scroll) {
  const service = ctx.service || streamingServiceByKey(ctx.key);
  if (!service) return;
  const region = ctx.streamingRegion;
  const regionMeta = streamingRegionMeta(region);
  const regionData = service.regions ? service.regions[region] : null;

  const header = el('div', 'person-header company-header');
  const logoWrap = el('div', 'company-logo-box');
  const logo = (regionData && regionData.logo) || service.logo;
  if (logo) {
    const img = el('img', 'company-logo-img');
    img.src = TMDB_IMG + 'w300' + logo;
    img.alt = service.name;
    logoWrap.append(img);
  } else {
    logoWrap.classList.add('empty');
    logoWrap.textContent = service.name.charAt(0).toUpperCase();
  }
  header.append(logoWrap);

  const info = el('div');
  info.style.minWidth = '0';
  info.append(el('div', 'person-name', service.name));
  info.append(el('div', 'person-meta', `Каталог підписки · ${regionMeta.name} (${region})`));

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

  // Регіон каталогу: у кожного сервісу свій набір доступних країн.
  const allRegions = streamingRegionsOf(service);
  if (allRegions.length > 1) {
    const regionRow = el('div', 'streaming-region-bar');
    regionRow.append(el('span', 'streaming-region-label', 'Регіон'));
    const sel = el('select', 'streams-select');
    allRegions.forEach(code => {
      const meta = streamingRegionMeta(code);
      const opt = el('option', '', `${meta.name} (${code})`);
      opt.value = code;
      if (code === region) opt.selected = true;
      sel.append(opt);
    });
    sel.addEventListener('change', () => { switchStreamingRegion(ctx, sel.value); });
    regionRow.append(sel);
    info.append(regionRow);
  }

  header.append(info);
  scroll.append(header);

  const defaultRegion = streamingDefaultRegion();
  const defaultMeta = streamingRegionMeta(defaultRegion);
  if (!service.regions[defaultRegion]) {
    scroll.append(el('div', 'streaming-note',
      `ℹ️ ${service.name} не представлений у регіоні «${defaultMeta.name}». Показано каталог: ${regionMeta.name}. Регіон можна змінити вручну.`));
  }
  scroll.append(el('div', 'streaming-note',
    'Дані каталогу надає TMDB (JustWatch). Склад підписки може відрізнятися від застосунку сервісу й оновлюється із затримкою.'));

  if (ctx.error) {
    scroll.append(el('div', 'avail-empty', 'Не вдалося завантажити каталог: ' + ctx.error));
    return;
  }

  const mTotal = ctx.pages.movie?.totalResults || 0;
  const tTotal = ctx.pages.tv?.totalResults || 0;
  const tabs = el('div', 'card-tabs');
  const mTab = el('button', 'card-tab' + (ctx.streamingTab === 'movie' ? ' active' : ''), `🎬 Фільми (${mTotal})`);
  const tTab = el('button', 'card-tab' + (ctx.streamingTab === 'tv' ? ' active' : ''), `📺 Серіали (${tTotal})`);

  mTab.addEventListener('click', () => {
    if (ctx.streamingTab === 'movie') return;
    ctx.streamingTab = 'movie';
    if (!ctx.pages.movie || ctx.pages.movie.sort !== ctx.streamingSort) {
      reloadStreamingTabData(ctx, 'movie', false);
    } else {
      saveCardScroll();
      renderCard(true);
    }
  });
  tTab.addEventListener('click', () => {
    if (ctx.streamingTab === 'tv') return;
    ctx.streamingTab = 'tv';
    if (!ctx.pages.tv || ctx.pages.tv.sort !== ctx.streamingSort) {
      reloadStreamingTabData(ctx, 'tv', false);
    } else {
      saveCardScroll();
      renderCard(true);
    }
  });
  tabs.append(mTab, tTab);
  scroll.append(tabs);

  const sortBar = el('div', 'company-sort-bar');
  const sortDefs = [
    { id: 'popularity.desc', label: '🔥 Популярні' },
    { id: 'vote_average.desc', label: '⭐ За рейтингом' },
    { id: 'primary_release_date.desc', label: '🆕 Новіші' }
  ];
  sortDefs.forEach(sd => {
    const sb = el('button', 'recs-mode-pill' + (ctx.streamingSort === sd.id ? ' active' : ''), sd.label);
    sb.type = 'button';
    sb.addEventListener('click', () => {
      if (ctx.streamingSort === sd.id || ctx.loadingMore) return;
      ctx.streamingSort = sd.id;
      reloadStreamingTabData(ctx, ctx.streamingTab, false);
    });
    sortBar.append(sb);
  });
  scroll.append(sortBar);

  if (!regionData) {
    scroll.append(el('div', 'avail-empty', `${service.name} недоступний у регіоні ${regionMeta.name}.`));
    return;
  }

  const curData = ctx.pages[ctx.streamingTab];
  if (!curData || (ctx.loadingMore && curData.sort !== ctx.streamingSort)) {
    scroll.append(el('div', 'avail-empty', 'Завантаження...'));
    return;
  }

  const items = curData.items || [];
  if (!items.length) {
    scroll.append(el('div', 'avail-empty', 'Немає даних для цього регіону'));
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
    moreBtn.addEventListener('click', () => reloadStreamingTabData(ctx, ctx.streamingTab, true));
    scroll.append(moreBtn);
  }
}
