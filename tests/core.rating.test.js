import { describe, it, expect } from 'vitest';

describe('computeItemRating', () => {
  it('movie: середнє з ratings', () => {
    const item = { type: 'movie', ratings: { plot: 8, cast: 6 } };
    const r = window.computeItemRating(item);
    expect(r.avg).toBeCloseTo(7, 1);
    expect(r.complete).toBe(true);
  });

  it('movie без оцінок → avg 0', () => {
    const item = { type: 'movie', ratings: null };
    expect(window.computeItemRating(item).avg).toBe(0);
  });

  it('TV без seasonRatings → avg 0', () => {
    const item = { type: 'tv', ratings: { overall: 8 } };
    expect(window.computeItemRating(item).avg).toBe(0);
  });

  it('TV з одним сезоном → avg = середнє сезону', () => {
    const item = { type: 'tv', seasonRatings: { 1: { overall: 9 } }, totalSeasons: 1 };
    const r = window.computeItemRating(item);
    expect(r.avg).toBe(9);
    expect(r.complete).toBe(true);
  });

  it('TV з двома сезонами → середнє з двох', () => {
    const item = {
      type: 'tv',
      seasonRatings: { 1: { overall: 9 }, 2: { overall: 7 } },
      totalSeasons: 2,
    };
    const r = window.computeItemRating(item);
    expect(r.avg).toBe(8);
    expect(r.complete).toBe(true);
  });

  it('null → avg 0', () => {
    expect(window.computeItemRating(null).avg).toBe(0);
  });
});
