import { describe, it, expect, beforeEach } from 'vitest';

describe('computeActorProfiles', () => {
  it('один актор в одному оціненому фільмі → rawAvg = оцінка', () => {
    window.lib = {
      'movie-1': {
        key: 'movie-1', type: 'movie', title: 'A',
        ratings: { cast: 9 },
        cast: [{ id: 101, name: 'Actor One' }],
        tmdbRating: 7.0,
        updated: Date.now(),
        status: 'watched',
      },
    };
    const { actors, globalCastAvg } = window.computeActorProfiles();
    const a = actors.get(101);
    expect(a).toBeDefined();
    expect(a.ratedCount).toBe(1);
    expect(a.rawAvg).toBeCloseTo(9, 1);
    expect(globalCastAvg).toBeCloseTo(9, 1);
    expect(a.score).toBeGreaterThan(0);
  });

  it('актор без оцінок касту → score = 0', () => {
    window.lib = {
      'movie-1': {
        key: 'movie-1', type: 'movie', title: 'A',
        cast: [{ id: 202, name: 'Ghost Actor' }],
        tmdbRating: 7.0,
        updated: Date.now(),
        status: 'watched',
        ratings: {},
      },
    };
    const { actors } = window.computeActorProfiles();
    const a = actors.get(202);
    expect(a).toBeDefined();
    expect(a.ratedCount).toBe(0);
    expect(a.score).toBe(0);
  });
});
