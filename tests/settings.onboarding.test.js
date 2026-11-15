import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

describe('submitOnboarding', () => {
  beforeAll(() => {
    // submitOnboarding викликає refresh() в кінці — не тягнемо app.js
    window.refresh = vi.fn();
    expect(window.submitOnboarding).toBeTypeOf('function');
  });

  beforeEach(() => {
    window.lib = {};
    window.onbSelected = new Set();
    window.onbCategories = [];
  });

  it('movie → ratings.overall = 8', async () => {
    window.onbCategories = [{
      title: 'M',
      items: [{ key: 'movie-1', type: 'movie', title: 'A', poster: '/a.jpg' }],
    }];
    window.onbSelected.add('movie-1');

    await window.submitOnboarding();

    expect(window.lib['movie-1']).toBeDefined();
    expect(window.lib['movie-1'].ratings).toEqual({ overall: 8 });
    expect(window.lib['movie-1'].status).toBe('watched');
  });

  it('TV → seasonRatings[1].overall = 8 + totalSeasons 1', async () => {
    window.onbCategories = [{
      title: 'T',
      items: [{ key: 'tv-1', type: 'tv', title: 'B', poster: '/b.jpg' }],
    }];
    window.onbSelected.add('tv-1');

    await window.submitOnboarding();

    expect(window.lib['tv-1']).toBeDefined();
    expect(window.lib['tv-1'].seasonRatings).toEqual({ 1: { overall: 8 } });
    expect(window.lib['tv-1'].totalSeasons).toBe(1);
  });

  it('ставить onboardingDone = true', async () => {
    window.onbCategories = [{
      title: 'M',
      items: [{ key: 'movie-1', type: 'movie', title: 'A', poster: '/a.jpg' }],
    }];
    window.onbSelected.add('movie-1');

    await window.submitOnboarding();

    expect(localStorage.getItem('onboardingDone')).toBe('true');
  });
});
