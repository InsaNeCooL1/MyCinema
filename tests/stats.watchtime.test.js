import { describe, it, expect, beforeEach } from 'vitest';

describe('computeWatchTimeStats', () => {
  beforeEach(() => {
    window.lib = {};
  });

  it('порожня бібліотека → усе 0', () => {
    const w = window.computeWatchTimeStats();
    expect(w.movieMin).toBe(0);
    expect(w.tvMin).toBe(0);
    expect(w.totalMin).toBe(0);
    expect(w.tvEpsWatched).toBe(0);
  });

  it('лише фільми: сумує runtime переглянутих', () => {
    window.lib = {
      'movie-1': {
        key: 'movie-1', type: 'movie', status: 'watched',
        runtime: 120, ratings: { overall: 8 },
        updated: Date.now(),
      },
      'movie-2': {
        key: 'movie-2', type: 'movie', status: 'watched',
        runtime: 90, ratings: { overall: 7 },
        updated: Date.now(),
      },
    };
    const w = window.computeWatchTimeStats();
    expect(w.movieMin).toBe(210);
    expect(w.movieKnown).toBe(2);
    expect(w.movieTotal).toBe(2);
    expect(w.tvMin).toBe(0);
    expect(w.totalMin).toBe(210);
  });

  it('фільм без runtime: рахується в total, але 0 хвилин', () => {
    window.lib = {
      'movie-1': {
        key: 'movie-1', type: 'movie', status: 'watched',
        ratings: { overall: 8 }, updated: Date.now(),
        // runtime відсутній
      },
    };
    const w = window.computeWatchTimeStats();
    expect(w.movieMin).toBe(0);
    expect(w.movieKnown).toBe(0);
    expect(w.movieTotal).toBe(1);
  });

  it('TV у процесі: рахує лише переглянуті серії', () => {
    window.lib = {
      'tv-1': {
        key: 'tv-1', type: 'tv', status: 'watching',
        watchedEpisodes: ['1-1', '1-2', '1-3'],
        episode_count: 10,
        runtime: 45,
        updated: Date.now(),
      },
    };
    const w = window.computeWatchTimeStats();
    expect(w.tvEpsWatched).toBe(3);
    expect(w.tvMin).toBe(3 * 45); // 135
    expect(w.tvTotal).toBe(1);
  });

  it('TV зі статусом watched і більшим episode_count → бере episode_count', () => {
    window.lib = {
      'tv-1': {
        key: 'tv-1', type: 'tv', status: 'watched',
        watchedEpisodes: ['1-1'], // користувач відмітив лише одну
        episode_count: 10,        // але статус = watched → вважаємо всі 10
        runtime: 30,
        seasonRatings: { 1: { overall: 8 } },
        totalSeasons: 1,
        updated: Date.now(),
      },
    };
    const w = window.computeWatchTimeStats();
    expect(w.tvEpsWatched).toBe(10);
    expect(w.tvMin).toBe(10 * 30); // 300
  });
});
