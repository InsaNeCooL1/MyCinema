import { describe, it, expect } from 'vitest';

describe('hasWatched', () => {
  it('null → false', () => {
    expect(window.hasWatched(null)).toBe(false);
  });

  it('порожній обʼєкт → false', () => {
    expect(window.hasWatched({})).toBe(false);
  });

  it('status "watched" → true', () => {
    expect(window.hasWatched({ status: 'watched' })).toBe(true);
  });

  it('status "watching" → true', () => {
    expect(window.hasWatched({ status: 'watching' })).toBe(true);
  });

  it('status "planned" без інших позначок → false', () => {
    expect(window.hasWatched({ status: 'planned' })).toBe(false);
  });

  it('є оцінка в ratings → true (навіть без статусу)', () => {
    expect(window.hasWatched({ ratings: { plot: 8 } })).toBe(true);
  });

  it('є оцінка в seasonRatings → true', () => {
    expect(window.hasWatched({ seasonRatings: { 1: { overall: 8 } } })).toBe(true);
  });

  it('є watchedEpisodes → true', () => {
    expect(window.hasWatched({ watchedEpisodes: ['1-1', '1-2'] })).toBe(true);
  });
});
