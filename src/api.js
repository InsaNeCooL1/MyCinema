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
    poster: r.poster_path, overview: r.overview || '', tmdbRating: r.vote_average || 0,
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
