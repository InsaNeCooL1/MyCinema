'use strict';

async function openPerson(personId, fromItem) {
  overlay.classList.add("open");
  const top = cardStack[cardStack.length - 1];
  if (top && top.type === 'person' && top.id === personId) return;
  saveCardScroll();
  const ctx = { type: 'person', id: personId, item: fromItem, personTab: 'bio' };
  cardStack.push(ctx);
  pushCardState();
  renderLoading();
  await loadPersonCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

async function loadPersonCardData(ctx) {
  try {
    const [details, imagesData] = await Promise.all([
      tmdbFetch(`/person/${ctx.id}?language=uk-UA&append_to_response=combined_credits`),
      tmdbFetch(`/person/${ctx.id}/images`).catch(() => ({ profiles: [] }))
    ]);
    ctx.details = details;
    ctx.images = (imagesData?.profiles || []).filter(p => p.file_path);
  } catch (e) { ctx.error = e.message; }
}

async function loadPersonForForward(id) {
  overlay.classList.add("open");
  const ctx = { type: 'person', id, item: {}, personTab: 'bio' };
  cardStack.push(ctx);
  renderLoading();
  await loadPersonCardData(ctx);
  if (cardStack[cardStack.length - 1] !== ctx) return;
  renderCard();
}

function renderPersonCard(ctx, scroll) {
  const d = ctx.details;
  if (!d) return;
  const header = el('div', 'person-header');
  const photo = el(d.profile_path ? 'img' : 'div', 'person-photo');
  if (d.profile_path) {
    photo.src = TMDB_IMG + 'w342' + d.profile_path;
    photo.classList.add('zoomable');
    photo.addEventListener('click', () => openImageZoom(d.profile_path, 'w500'));
  }
  header.append(photo);
  const info = el('div');
  info.append(el('div', 'person-name', d.name || ''));
  if (d.known_for_department) info.append(el('div', 'person-meta', d.known_for_department));
  if (d.birthday) {
    let b = d.birthday;
    if (d.deathday) b += ' — ' + d.deathday;
    info.append(el('div', 'person-meta', 'Народження: ' + b));
  }
  if (d.place_of_birth) info.append(el('div', 'person-meta', d.place_of_birth));
  header.append(info);
  scroll.append(header);
  
  if (!ctx.personTab) ctx.personTab = 'bio';
  const tabs = el('div', 'card-tabs');
  const tabDefs = [
    { id: 'bio', label: '📖 Біографія' },
    { id: 'filmography', label: '🎬 Фільмографія' },
    { id: 'gallery', label: '📸 Галерея' }
  ];
  for (const t of tabDefs) {
    const btn = el('button', 'card-tab' + (ctx.personTab === t.id ? ' active' : ''), t.label);
    btn.addEventListener('click', () => { if (ctx.personTab === t.id) return; ctx.personTab = t.id; renderCard(); });
    tabs.append(btn);
  }
  scroll.append(tabs);
  
  const content = el('div'); content.style.marginTop = '16px';
  if (ctx.personTab === 'bio') {
    if (d.biography) content.append(el('div', 'person-bio', d.biography));
    else content.append(el('div', 'avail-empty', 'Біографія відсутня'));
  } else if (ctx.personTab === 'filmography') {
    content.append(...renderPersonFilmography(ctx));
  } else if (ctx.personTab === 'gallery') {
    content.append(...renderPersonGallery(ctx));
  }
  scroll.append(content);
}

function renderPersonFilmography(ctx) {
  const d = ctx.details;
  const allCast = (d.combined_credits?.cast || []).filter(c => c.poster_path);
  const filtered = allCast.filter(c => {
    const genres = c.genre_ids || [];
    if (genres.includes(ANIMATION_GENRE_ID)) return false;
    if (c.media_type === 'tv' && genres.some(g => EXCLUDED_TV_GENRES.includes(g))) return false;
    return true;
  });
  
  const yearOf = c => { const date = c.release_date || c.first_air_date || ''; return parseInt(date.slice(0, 4)) || 0; };
  const sortFn = (a, b) => yearOf(b) - yearOf(a) || (b.popularity || 0) - (a.popularity || 0);
  const movies = filtered.filter(c => c.media_type === 'movie'); movies.sort(sortFn);
  const tvs = filtered.filter(c => c.media_type === 'tv'); tvs.sort(sortFn);
  
  if (!ctx.filmTab) ctx.filmTab = movies.length > 0 ? 'movies' : 'tv';
  const wrap = el('div');
  
  const subTabs = el('div', 'card-tabs');
  const mTab = el('button', 'card-tab' + (ctx.filmTab === 'movies' ? ' active' : ''), `🎬 Фільми (${movies.length})`);
  const tTab = el('button', 'card-tab' + (ctx.filmTab === 'tv' ? ' active' : ''), `📺 Серіали (${tvs.length})`);
  mTab.addEventListener('click', () => { if (ctx.filmTab === 'movies') return; ctx.filmTab = 'movies'; renderCard(); });
  tTab.addEventListener('click', () => { if (ctx.filmTab === 'tv') return; ctx.filmTab = 'tv'; renderCard(); });
  subTabs.append(mTab, tTab);
  wrap.append(subTabs);
  
  const items = ctx.filmTab === 'movies' ? movies : tvs;
  if (!items.length) { wrap.append(el('div', 'avail-empty', 'Немає даних')); return [wrap]; }
  
  const grid = el('div', 'filmography-grid');
  grid.style.marginTop = '16px';
  for (const credit of items.slice(0, 100)) {
    const c = el('div', 'filmography-card');
    const poster = el('img', 'filmography-poster');
    poster.src = TMDB_IMG + 'w185' + credit.poster_path;
    poster.loading = 'lazy';
    c.append(poster);
    c.append(el('div', 'filmography-title', credit.title || credit.name || ''));
    const year = yearOf(credit);
    if (year) c.append(el('div', 'filmography-year', year));
    c.addEventListener('click', () => {
      const item = normalizeItem({ ...credit, media_type: credit.media_type });
      openMediaFromStack(item);
    });
    grid.append(c);
  }
  wrap.append(grid);
  return [wrap];
}

function renderPersonGallery(ctx) {
  if (!ctx.images || ctx.images.length === 0) return [el('div', 'avail-empty', 'Фотографій немає')];
  const gallery = el('div', 'photo-gallery');
  ctx.images.slice(0, 30).forEach(img => {
    const imgEl = el('img', 'gallery-photo');
    imgEl.src = TMDB_IMG + 'w185' + img.file_path;
    imgEl.loading = 'lazy';
    imgEl.alt = '';
    imgEl.addEventListener('click', () => openImageZoom(img.file_path, 'w500'));
    gallery.append(imgEl);
  });
  return [gallery];
}
