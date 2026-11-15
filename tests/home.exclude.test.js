import { describe, it, expect } from 'vitest';

describe('isExcludedShow', () => {
  it('виключає реаліті за жанром 10764', () => {
    expect(window.isExcludedShow({ genre_ids: [10764] }, 'tv')).toBe(true);
  });

  it('виключає "The Oscars" за назвою', () => {
    expect(window.isExcludedShow({ name: 'The Oscars 2024' }, 'tv')).toBe(true);
  });

  it('не виключає звичайний фільм', () => {
    expect(window.isExcludedShow({ genre_ids: [28], title: 'Die Hard' }, 'movie')).toBe(false);
  });

  it('null → true (виключається)', () => {
    expect(window.isExcludedShow(null, 'movie')).toBe(true);
  });
});
