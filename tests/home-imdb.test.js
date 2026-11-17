import { describe, it, expect, beforeEach, vi } from 'vitest';

function workerResponse(data) {
  return {
    ok: true,
    json: () => Promise.resolve({ ok: true, data, missing: { movie: [], tv: [] }, errors: [], meta: {} }),
  };
}

function makeItem(overrides) {
  return {
    key: 'movie-278',
    id: 278,
    type: 'movie',
    title: 'Test',
    status: 'watched',
    updated: Date.now(),
    tmdbRating: 7.0,
    votes: 40,
    ratings: { plot: 9, cast: 9, style: 9, emotions: 9, overall: 9 },
    ...overrides,
  };
}

describe('Home recommendations на IMDb (big bang)', () => {
  beforeEach(() => {
    window.imdbClearCache();
    vi.restoreAllMocks();
  });

  it('getSeeds: residual рахується від IMDb, а не від tmdbRating', async () => {
    global.fetch = vi.fn().mockResolvedValue(workerResponse({
      movie: { 278: { imdbId: 'tt0111161', imdbRating: 9.3, imdbVotes: 3264913 } },
      tv: {},
    }));
    await window.imdbLoadFor([278], []);

    window.lib = { 'movie-278': makeItem() };
    const seeds = window.getSeeds();
    expect(seeds.length).toBe(1);
    // avg 9.0 - IMDb 9.3 = -0.3 (було б 9.0 - 7.0 = +2.0)
    expect(seeds[0].residual).toBeCloseTo(-0.3, 6);
    expect(seeds[0].resFactor).toBeCloseTo(Math.max(0.3, 1 + (-0.3) / 2), 6);
  });

  it('getSeeds: без IMDb-даних лишається TMDB-фольбек', () => {
    window.lib = { 'movie-278': makeItem() };
    const seeds = window.getSeeds();
    expect(seeds[0].residual).toBeCloseTo(2.0, 6);
  });

  it('ensureLibraryImdb: підтягує всю бібліотеку до сідів', async () => {
    const f = vi.fn().mockResolvedValue(workerResponse({
      movie: { 278: { imdbId: 'tt0111161', imdbRating: 9.3, imdbVotes: 3264913 } },
      tv: {},
    }));
    global.fetch = f;
    window.lib = { 'movie-278': makeItem() };

    const res = await window.ensureLibraryImdb();
    expect(res.ok).toBe(true);
    expect(res.total).toBe(1);
    expect(window.imdbLookup('movie', 278).imdbRating).toBe(9.3);

    const seeds = window.getSeeds();
    expect(seeds[0].residual).toBeCloseTo(-0.3, 6);
  });

  it('buildSmartRecommendations: TMDB-фольбек WR m=200 і balance з log10 голосів', async () => {
    window.loadScript('src/api.js');
    window.imdbClearCache();
    window.lib = { 'movie-278': makeItem() };

    const seedDetail = {
      id: 278,
      credits: { crew: [], cast: [] },
      keywords: { keywords: [] },
      genres: [{ id: 18 }],
      recommendations: {
        results: [{
          id: 999, media_type: 'movie', title: 'Candidate', poster_path: '/x.jpg',
          vote_average: 7.5, vote_count: 30, popularity: 10,
          genre_ids: [18], release_date: '2020-01-01',
        }],
      },
    };
    window.tmdbFetch = vi.fn(async (url) =>
      url.includes('/movie/278') ? seedDetail : { results: [] });
    global.fetch = vi.fn().mockResolvedValue(workerResponse({ movie: {}, tv: {} }));

    const bayesSpy = vi.spyOn(window, 'recBayesRating');
    const balSpy = vi.spyOn(window, 'recBalanceBonus');
    const res = await window.buildSmartRecommendations(window.getSeeds(), null, 'balance');

    const bayesCall = bayesSpy.mock.calls.find(c => c[1] === 30);
    expect(bayesCall).toBeTruthy();
    expect(bayesCall[2]).toBe(0.63); // C movie
    expect(bayesCall[3]).toBe(200);  // m TMDB-фольбеку
    expect(balSpy).toHaveBeenCalled();
    expect(res.items.length).toBeGreaterThan(0);
  });

  it('computeActorProfiles: globalRefAvg береться з IMDb', async () => {
    global.fetch = vi.fn().mockResolvedValue(workerResponse({
      movie: {
        278: { imdbId: 'tt0111161', imdbRating: 9.3, imdbVotes: 1000 },
        550: { imdbId: 'tt0137523', imdbRating: 8.5, imdbVotes: 1000 },
      },
      tv: {},
    }));
    await window.imdbLoadFor([278, 550], []);

    window.lib = {
      'movie-278': makeItem({
        cast: [{ id: 1, name: 'A', profile_path: null }],
        ratings: { plot: 9, cast: 9, style: 9, emotions: 9, overall: 9 },
      }),
      'movie-550': makeItem({
        key: 'movie-550', id: 550,
        cast: [{ id: 1, name: 'A', profile_path: null }],
        ratings: { plot: 8, cast: 8, style: 8, emotions: 8, overall: 8 },
      }),
    };
    const prof = window.computeActorProfiles();
    // (9.3 + 8.5) / 2 = 8.9, а не (7.0 + 7.0) / 2 = 7.0
    expect(prof.globalRefAvg).toBeCloseTo(8.9, 6);
    expect(prof.globalTmdbAvg).toBeCloseTo(8.9, 6); // alias для сумісності
  });
});
