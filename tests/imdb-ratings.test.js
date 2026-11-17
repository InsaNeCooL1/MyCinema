import { describe, it, expect, beforeEach, vi } from 'vitest';

function okResponse(data, extra) {
  return {
    ok: true,
    json: () => Promise.resolve({ ok: true, data, missing: { movie: [], tv: [] }, errors: [], meta: {}, ...extra }),
  };
}

const IMDbData = {
  movie: {
    278: { imdbId: 'tt0111161', imdbRating: 9.3, imdbVotes: 3264913 },
    550: { imdbId: 'tt0137523', imdbRating: 8.8, imdbVotes: 2683725 },
  },
  tv: {
    1396: { imdbId: 'tt0903747', imdbRating: 9.5, imdbVotes: 2705323 },
  },
};

describe('IMDb ratings client (imdb-ratings)', () => {
  beforeEach(() => {
    window.imdbClearCache();
    vi.restoreAllMocks();
  });

  it('imdbFetchBatch: шле POST на /imdb/batch і нормалізує відповідь', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(IMDbData));
    global.fetch = f;

    const res = await window.imdbFetchBatch([278, 550], [1396]);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe(String(window.PROXY_URL).replace(/\/$/, '') + '/imdb/batch');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ movies: [278, 550], tv: [1396] });
    expect(res.ok).toBe(true);
    expect(res.data.movie['278'].imdbRating).toBe(9.3);
  });

  it('imdbFetchBatch: не кидає помилку при офлайні/квоті', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const res = await window.imdbFetchBatch([278], []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/offline/);
    expect(res.data).toEqual({ movie: {}, tv: {} });
  });

  it('imdbLoadFor: кешує на 7 днів і не ходить у мережу вдруге', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(IMDbData));
    global.fetch = f;

    const first = await window.imdbLoadFor([278, 550], [1396]);
    expect(first.ok).toBe(true);
    expect(first.fetched).toBe(3);
    expect(f).toHaveBeenCalledTimes(1);

    const second = await window.imdbLoadFor([278, 550], [1396]);
    expect(f).toHaveBeenCalledTimes(1); // жодного нового запиту
    expect(second.fetched).toBe(0);
    expect(second.missing).toEqual({ movie: [], tv: [] });
    expect(second.data[window.imdbKey('movie', 278)].imdbRating).toBe(9.3);
    expect(second.data[window.imdbKey('tv', 1396)].imdbVotes).toBe(2705323);
  });

  it('imdbLoadFor: ok:false → fallback:true, кешоване не втрачається', async () => {
    global.fetch = vi.fn().mockResolvedValue(okResponse(IMDbData));
    await window.imdbLoadFor([278], [1396]); // прогріли кеш

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, error: 'quota', data: { movie: {}, tv: {} }, missing: { movie: [550], tv: [] }, errors: [] }),
    });
    const res = await window.imdbLoadFor([278, 550], [1396]);
    expect(res.ok).toBe(false);
    expect(res.fallback).toBe(true);
    expect(res.data[window.imdbKey('movie', 278)].imdbRating).toBe(9.3); // з кешу
    expect(res.data[window.imdbKey('movie', 550)]).toBeUndefined();        // немає → TMDB fallback
  });

  it('imdbLookup: прострочений запис не повертається', async () => {
    global.fetch = vi.fn().mockResolvedValue(okResponse(IMDbData));
    await window.imdbLoadFor([278], []);
    expect(window.imdbLookup('movie', 278)).not.toBeNull();

    const key = window.imdbKey('movie', 278);
    const cache = JSON.parse(localStorage.getItem(window.IMDB_CACHE_KEY) || '{}');
    cache[key].ts = Date.now() - window.IMDB_CACHE_TTL - 1000;
    localStorage.setItem(window.IMDB_CACHE_KEY, JSON.stringify(cache));

    expect(window.imdbLookup('movie', 278)).toBeNull();
  });

  it('imdbRef: IMDb має пріоритет, інакше TMDB з явним source', async () => {
    global.fetch = vi.fn().mockResolvedValue(okResponse(IMDbData));
    await window.imdbLoadFor([278], [1396]);

    expect(window.imdbRef({ id: 278, type: 'movie', tmdbRating: 8.6, votes: 1000 })).toEqual({
      rating: 9.3, votes: 3264913, imdbId: 'tt0111161', source: 'imdb',
    });
    expect(window.imdbRef({ id: 999, type: 'movie', tmdbRating: 7.2, votes: 50 })).toEqual({
      rating: 7.2, votes: 50, imdbId: null, source: 'tmdb',
    });
    expect(window.imdbRef({ id: 1396, name: 'Breaking Bad', tmdbRating: 8.9 })).toEqual({
      rating: 9.5, votes: 2705323, imdbId: 'tt0903747', source: 'imdb',
    });
  });

  it('дедуп і кап ID', async () => {
    const f = vi.fn().mockResolvedValue(okResponse({ movie: {}, tv: {} }));
    global.fetch = f;
    const ids = Array.from({ length: 500 }, (_, i) => i + 1).concat([1, 2, -5, 'abc']);
    await window.imdbFetchBatch(ids, []);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.movies.length).toBe(400);
    expect(body.movies[0]).toBe(1);
    expect(body.movies).not.toContain(-5);
  });
});
