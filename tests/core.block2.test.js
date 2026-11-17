import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

describe('Stage 2 & 3: Directors, Wrapped & World Map', () => {
  beforeAll(() => {
    window.loadScript('src/world-map-data.js');
    window.loadScript('src/world-map.js');
  });

  beforeEach(() => {
    localStorage.clear();
    window.lib = {};
  });

  it('computeDirectorProfiles рахує режисерів із рейтингом і кількістю', () => {
    const now = Date.now();
    window.lib = {
      'movie-1': {
        key: 'movie-1', type: 'movie', title: 'Oppenheimer', status: 'watched',
        ratings: { overall: 9 }, directors: [{ id: 525, name: 'Christopher Nolan' }], updated: now
      },
      'movie-2': {
        key: 'movie-2', type: 'movie', title: 'Inception', status: 'watched',
        ratings: { overall: 10 }, directors: [{ id: 525, name: 'Christopher Nolan' }], updated: now
      }
    };
    const { directors } = window.computeDirectorProfiles();
    expect(directors).toHaveLength(1);
    expect(directors[0].name).toBe('Christopher Nolan');
    expect(directors[0].watchedCount).toBe(2);
    expect(directors[0].rawAvg).toBeCloseTo(9.5, 2);
  });

  it('computeWrappedStats агрегує підсумки за обраний місяць і рік', () => {
    const d = new Date('2026-11-10T12:00:00Z').getTime();
    window.lib = {
      'movie-1': {
        key: 'movie-1', type: 'movie', title: 'Film A', status: 'watched',
        runtime: 120, ratings: { overall: 9 }, tmdbRating: 7.5,
        genres: [18], countries: ['UA'], statusDate: d, ratingUpdated: d
      },
      'movie-2': {
        key: 'movie-2', type: 'movie', title: 'Film B', status: 'watched',
        runtime: 90, ratings: { overall: 6 }, tmdbRating: 7.8,
        genres: [35], countries: ['US'], statusDate: d, ratingUpdated: d
      }
    };
    const wMonth = window.computeWrappedStats('month', '2026-11');
    expect(wMonth.total).toBe(2);
    expect(wMonth.movies).toBe(2);
    expect(wMonth.mins).toBe(210);
    expect(wMonth.periodAvg).toBeCloseTo(7.5, 1);
    expect(wMonth.top3[0].item.title).toBe('Film A');

    const wYear = window.computeWrappedStats('year', '2026');
    expect(wYear.total).toBe(2);
    expect(wYear.monthBins[10]).toBe(2); // Листопад (index 10)
  });

  it('SVG мапа світу містить реальні контури та Україну з Кримом', () => {
    expect(window.MC_WORLD_PATHS.length).toBeGreaterThan(150);
    const ua = window.MC_WORLD_PATHS.find(p => p.a2 === 'UA');
    expect(ua).toBeDefined();
    // Крим: субшлях з південною точкою ~44.4°N → y ≈ 126.7 у проєкції 1000x500
    const ys = [...ua.d.matchAll(/,(\d+\.\d)/g)].map(m => Number(m[1]));
    expect(Math.max(...ys)).toBeGreaterThan(126);
    expect((ua.d.match(/M/g) || []).length).toBeGreaterThanOrEqual(2); // материк + Крим
  });

  it('контури не мають сегментів через всю карту (артефакт 180° довготи)', () => {
    let bad = 0;
    for (const p of window.MC_WORLD_PATHS) {
      for (const sub of p.d.split(/(?=M)/).filter(Boolean)) {
        const pts = [...sub.matchAll(/(\d+\.\d),(\d+\.\d)/g)].map(m => [Number(m[1]), Number(m[2])]);
        for (let i = 1; i <= pts.length; i++) {
          const a = pts[i - 1], b = pts[i % pts.length]; // включно з неявним Z
          if (Math.abs(b[0] - a[0]) > 500) bad++;
        }
      }
    }
    expect(bad).toBe(0);
  });
});
