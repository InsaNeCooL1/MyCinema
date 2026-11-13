'use strict';

function tmdbFetch(path) {
  return fetch(PROXY_URL + path)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
}

function normalizeItem(r) {
  const type = r.media_type || (r.first_air_date ? 'tv' : 'movie');
  return {
    key: type + '-' + r.id, id: r.id, type,
    title: r.title || r.name, year: (r.release_date || r.first_air_date || '').slice(0, 4),
    poster: r.poster_path, 
    backdrop: r.backdrop_path, // <--- ДОДАЙ ЦЕ
    overview: r.overview || '', tmdbRating: r.vote_average || 0,
    votes: r.vote_count || 0, popularity: r.popularity || 0,
    genres: r.genre_ids || (r.genres ? r.genres.map(g => g.id) : [])
  };
}

function findAllTrailers(videos, originalLang) {
  const list = (videos?.results || []).filter(v => v.site === 'YouTube' && v.key && (v.type === 'Trailer' || v.type === 'Teaser'));
  const langRank = v => v.iso_639_1 === 'uk' ? 0 : (v.iso_639_1 === originalLang ? 1 : (v.iso_639_1 === 'en' ? 2 : 3));
  const typeRank = v => v.type === 'Trailer' ? 0 : 1;
  const seen = new Set();
  return list.sort((a, b) =>
      typeRank(a) - typeRank(b) || langRank(a) - langRank(b) ||
      (b.official ? 1 : 0) - (a.official ? 1 : 0) || new Date(b.published_at) - new Date(a.published_at))
    .filter(v => { if (seen.has(v.key)) return false; seen.add(v.key); return true; }).slice(0, 5);
}

function trailerLabel(t) {
  const lang = t.iso_639_1 === 'uk' ? 'UA' : (t.iso_639_1 ? t.iso_639_1.toUpperCase() : '—');
  return (t.type === 'Teaser' ? 'Тізер' : 'Трейлер') + ' · ' + lang;
}

// ============ WIKIDATA / WIKIPEDIA ============
const _wikiSitelinksCache = new Map();
const _wikiMediaCache = new Map();

function fetchJsonTimeout(url, ms = 2500) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  return fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => { if (timer) clearTimeout(timer); });
}

async function fetchWikiSitelinks(wikidataId) {
  if (!wikidataId) return null;
  if (_wikiSitelinksCache.has(wikidataId)) return _wikiSitelinksCache.get(wikidataId);
  try {
    const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(wikidataId)}&props=sitelinks&sitefilter=ukwiki|enwiki&format=json&origin=*`;
    const wd = await fetchJsonTimeout(wdUrl, 2500);
    const links = wd?.entities?.[wikidataId]?.sitelinks || null;
    if (links) _wikiSitelinksCache.set(wikidataId, links);
    return links;
  } catch {
    return null;
  }
}

function extractWikiOverviewFromText(extract) {
  if (!extract || !extract.trim()) return '';
  const re = /^==\s*([^=\n]+?)\s*==$/gm;
  const sections = [];
  let lastIdx = 0;
  let lastTitle = '__lead__';
  let m;
  while ((m = re.exec(extract)) !== null) {
    sections.push({ title: lastTitle, body: extract.slice(lastIdx, m.index).trim() });
    lastTitle = m[1].trim();
    lastIdx = re.lastIndex;
  }
  sections.push({ title: lastTitle, body: extract.slice(lastIdx).trim() });

  const cleanBody = (txt) => txt
    .replace(/^===\s*([^=\n]+?)\s*===$/gm, '$1:')
    .replace(/^====\s*([^=\n]+?)\s*====$/gm, '$1:')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const pickByNames = (names) => {
    for (const sec of sections) {
      const low = sec.title.toLowerCase();
      if (names.some(n => low === n || low.startsWith(n + ' '))) {
        const cleaned = cleanBody(sec.body);
        if (cleaned.length >= 60) return cleaned;
      }
    }
    return '';
  };

  const lead = cleanBody((sections.find(s => s.title === '__lead__') || {}).body || '');
  const synopsis = pickByNames([
    'синопсис', 'короткий зміст', 'опис', 'про фільм',
    'про серіал', 'фабула', 'передісторія', 'передумова', 'концепція'
  ]);
  if (synopsis) return synopsis;

  const plot = pickByNames(['сюжет', 'опис сюжету', 'сюжетна лінія']);
  if (plot) return plot;

  return lead.length >= 60 ? lead : '';
}

async function fetchWikiMediaDescription(wikidataId) {
  if (!wikidataId) return null;
  if (_wikiMediaCache.has(wikidataId)) return _wikiMediaCache.get(wikidataId);
  try {
    const links = await fetchWikiSitelinks(wikidataId);
    const ukTitle = links?.ukwiki?.title;
    if (!ukTitle) { _wikiMediaCache.set(wikidataId, null); return null; }

    const apiUrl = `https://uk.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(ukTitle)}&prop=extracts|info&inprop=url&explaintext=1&exsectionformat=wiki&format=json&origin=*`;
    const data = await fetchJsonTimeout(apiUrl, 2500);
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    const text = extractWikiOverviewFromText(page?.extract || '');
    if (!text) { _wikiMediaCache.set(wikidataId, null); return null; }

    const url = page?.fullurl || ('https://uk.wikipedia.org/wiki/' + encodeURIComponent(ukTitle.replace(/ /g, '_')));
    const res = { text, url };
    _wikiMediaCache.set(wikidataId, res);
    return res;
  } catch {
    return null;
  }
}
