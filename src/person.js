'use strict';

const PERSON_DEPT_UA = {
  Acting: 'Актор / Акторка',
  Directing: 'Режисура',
  Writing: 'Сценарії',
  Production: 'Продюсування',
  Sound: 'Музика і звук',
  Camera: 'Операторська робота',
  Editing: 'Монтаж',
  Art: 'Художня постановка'
};

function fetchJsonTimeout(url, ms = 2500) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  return fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => { if (timer) clearTimeout(timer); });
}

async function fetchWikiBio(wikidataId) {
  if (!wikidataId) return null;
  try {
    const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(wikidataId)}&props=sitelinks&sitefilter=ukwiki|enwiki&format=json&origin=*`;
    const wd = await fetchJsonTimeout(wdUrl, 2500);
    const links = wd?.entities?.[wikidataId]?.sitelinks || {};
    if (links.ukwiki?.title) {
      const slug = encodeURIComponent(links.ukwiki.title.replace(/ /g, '_'));
      const sum = await fetchJsonTimeout(`https://uk.wikipedia.org/api/rest_v1/page/summary/${slug}`, 2500);
      if (sum?.extract && sum.extract.trim().length >= 60) {
        return {
          text: sum.extract.trim(),
          source: 'Вікіпедія (UA)',
          url: sum.content_urls?.desktop?.page || null
        };
      }
    }
    if (links.enwiki?.title) {
      return { enTitle: links.enwiki.title };
    }
  } catch {}
  return null;
}

async function resolvePersonBiography(details) {
  const ukBio = (details?.biography || '').trim();
  const transList = details?.translations?.translations || [];
  const enTrans = transList.find(t => t.iso_639_1 === 'en' && t.data?.biography?.trim());
  let enBio = enTrans ? enTrans.data.biography.trim() : '';

  if (ukBio.length >= 120) {
    return { text: ukBio, source: 'TMDB (UA)', url: null };
  }

  const wid = details?.external_ids?.wikidata_id || null;
  const wikiRes = await fetchWikiBio(wid);
  if (wikiRes?.text) return wikiRes;

  if (ukBio) {
    return { text: ukBio, source: 'TMDB (UA)', url: null };
  }

  if (!enBio && details?.id) {
    try {
      const enDetails = await tmdbFetch(`/person/${details.id}?language=en-US`);
      if (enDetails?.biography?.trim()) enBio = enDetails.biography.trim();
    } catch {}
  }
  if (enBio) {
    return { text: enBio, source: 'TMDB (EN)', url: null };
  }

  if (wikiRes?.enTitle) {
    try {
      const slug = encodeURIComponent(wikiRes.enTitle.replace(/ /g, '_'));
      const sum = await fetchJsonTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, 2500);
      if (sum?.extract && sum.extract.trim().length >= 60) {
        return {
          text: sum.extract.trim(),
          source: 'Wikipedia (EN)',
          url: sum.content_urls?.desktop?.page || null
        };
      }
    } catch {}
  }

  return { text: '', source: '', url: null };
}

function calcPersonAge(birthday, deathday) {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (isNaN(b.getTime())) return null;
  const end = deathday ? new Date(deathday) : new Date();
  if (isNaN(end.getTime())) return null;
  let age = end.getFullYear() - b.getFullYear();
  const m = end.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < b.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function formatPersonDate(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

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
      tmdbFetch(`/person/${ctx.id}?language=uk-UA&append_to_response=combined_credits,translations,external_ids`),
      tmdbFetch(`/person/${ctx.id}/images`).catch(() => ({ profiles: [] }))
    ]);
    ctx.details = details;
    ctx.images = (imagesData?.profiles || []).filter(p => p.file_path);
    ctx.bioMeta = await resolvePersonBiography(details);
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

function getPersonLibraryStats(personId, details) {
  const creditKeys = new Set();
  (details?.combined_credits?.cast || []).forEach(c => {
    if (c.id && (c.media_type === 'movie' || c.media_type === 'tv')) creditKeys.add(c.media_type + '-' + c.id);
  });
  (details?.combined_credits?.crew || []).forEach(c => {
    if (c.id && (c.media_type === 'movie' || c.media_type === 'tv') && (c.job === 'Director' || c.job === 'Creator')) {
      creditKeys.add(c.media_type + '-' + c.id);
    }
  });

  const matched = Object.values(lib).filter(x =>
    hasWatched(x) && (creditKeys.has(x.key) || (x.cast || []).some(a => a.id === personId))
  );
  const rated = matched.map(x => computeItemRating(x).avg).filter(v => v > 0);
  const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
  return { count: matched.length, avg };
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
  info.style.minWidth = '0';
  info.append(el('div', 'person-name', d.name || ''));
  if (d.known_for_department) {
    info.append(el('div', 'person-meta', PERSON_DEPT_UA[d.known_for_department] || d.known_for_department));
  }
  if (d.birthday) {
    const age = calcPersonAge(d.birthday, d.deathday);
    let b = formatPersonDate(d.birthday);
    if (d.deathday) b += ' — ' + formatPersonDate(d.deathday);
    if (age !== null) b += ` (${age} р.)`;
    info.append(el('div', 'person-meta', b));
  }
  if (d.place_of_birth) info.append(el('div', 'person-meta', d.place_of_birth));

  const libStat = getPersonLibraryStats(ctx.id, d);
  if (libStat.count > 0) {
    const statTxt = `📚 У бібліотеці: ${libStat.count}` + (libStat.avg > 0 ? ` · ⭐ ${fmtNum(libStat.avg)}` : '');
    info.append(el('div', 'person-lib-badge', statTxt));
  }

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
    const bioText = ctx.bioMeta?.text || (d.biography || '').trim();
    if (bioText) {
      if (ctx.bioMeta?.source || ctx.bioMeta?.url) {
        const metaBar = el('div', 'person-bio-meta');
        if (ctx.bioMeta.source) metaBar.append(el('span', 'person-bio-source', `Джерело: ${ctx.bioMeta.source}`));
        if (ctx.bioMeta.url) {
          const link = el('a', 'person-wiki-link', 'Читати повністю ↗');
          link.href = ctx.bioMeta.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          metaBar.append(link);
        }
        content.append(metaBar);
      }
      content.append(el('div', 'person-bio', bioText));
    } else {
      content.append(el('div', 'avail-empty', 'Біографія відсутня'));
    }
  } else if (ctx.personTab === 'filmography') {
    content.append(...renderPersonFilmography(ctx));
  } else if (ctx.personTab === 'gallery') {
    content.append(...renderPersonGallery(ctx));
  }
  scroll.append(content);
}

function dedupCredits(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const k = (c.media_type || 'movie') + '-' + c.id;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function renderPersonFilmography(ctx) {
  const d = ctx.details;
  const filterItem = c => {
    if (!c.poster_path) return false;
    const genres = c.genre_ids || [];
    if (genres.includes(ANIMATION_GENRE_ID)) return false;
    if (c.media_type === 'tv' && genres.some(g => EXCLUDED_TV_GENRES.includes(g))) return false;
    return true;
  };

  const allCast = dedupCredits((d.combined_credits?.cast || []).filter(filterItem));
  const allDirected = dedupCredits(
    (d.combined_credits?.crew || []).filter(c => (c.job === 'Director' || c.job === 'Creator') && filterItem(c))
  );

  const yearOf = c => { const date = c.release_date || c.first_air_date || ''; return parseInt(date.slice(0, 4)) || 0; };
  const sortFn = (a, b) => yearOf(b) - yearOf(a) || (b.popularity || 0) - (a.popularity || 0);
  const movies = allCast.filter(c => c.media_type === 'movie').sort(sortFn);
  const tvs = allCast.filter(c => c.media_type === 'tv').sort(sortFn);
  allDirected.sort(sortFn);

  if (!ctx.filmTab) {
    if (d.known_for_department === 'Directing' && allDirected.length > 0) ctx.filmTab = 'directed';
    else ctx.filmTab = movies.length > 0 ? 'movies' : (tvs.length > 0 ? 'tv' : 'directed');
  }
  const wrap = el('div');

  const subTabs = el('div', 'card-tabs');
  const mTab = el('button', 'card-tab' + (ctx.filmTab === 'movies' ? ' active' : ''), `🎬 Фільми (${movies.length})`);
  const tTab = el('button', 'card-tab' + (ctx.filmTab === 'tv' ? ' active' : ''), `📺 Серіали (${tvs.length})`);
  mTab.addEventListener('click', () => { if (ctx.filmTab === 'movies') return; ctx.filmTab = 'movies'; renderCard(); });
  tTab.addEventListener('click', () => { if (ctx.filmTab === 'tv') return; ctx.filmTab = 'tv'; renderCard(); });
  subTabs.append(mTab, tTab);
  if (allDirected.length > 0) {
    const dTab = el('button', 'card-tab' + (ctx.filmTab === 'directed' ? ' active' : ''), `🎥 Режисура (${allDirected.length})`);
    dTab.addEventListener('click', () => { if (ctx.filmTab === 'directed') return; ctx.filmTab = 'directed'; renderCard(); });
    subTabs.append(dTab);
  }
  wrap.append(subTabs);

  const items = ctx.filmTab === 'movies' ? movies : (ctx.filmTab === 'tv' ? tvs : allDirected);
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
    const saved = lib[(credit.media_type || 'movie') + '-' + credit.id];
    const savedAvg = saved ? computeItemRating(saved).avg : 0;
    let yText = year ? String(year) : '';
    if (savedAvg > 0) yText += (yText ? ' · ' : '') + '⭐ ' + fmtNum(savedAvg);
    else if (saved?.status === 'watched') yText += (yText ? ' · ' : '') + '✅';
    if (yText) c.append(el('div', 'filmography-year', yText));
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
