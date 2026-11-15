import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

describe('recordEloMatch', () => {
  beforeAll(() => {
    // recordEloMatch викликає save() — замінюємо, щоб не лишати setTimeout
    window.save = vi.fn();
  });

  beforeEach(() => {
    window.lib = {};
  });

  it('переможець +delta, лузер -delta', () => {
    const w = { key: 'movie-1', title: 'W', type: 'movie', poster: null };
    const l = { key: 'movie-2', title: 'L', type: 'movie', poster: null };

    const res = window.recordEloMatch(w, l);

    expect(res.delta).toBeGreaterThan(0);
    expect(window.lib['movie-1'].elo).toBe(1500 + res.delta);
    expect(window.lib['movie-2'].elo).toBe(1500 - res.delta);
  });

  it('обидва отримують +1 гру в eloGames', () => {
    const w = { key: 'movie-1', title: 'W', type: 'movie', poster: null };
    const l = { key: 'movie-2', title: 'L', type: 'movie', poster: null };

    window.recordEloMatch(w, l);

    expect(window.lib['movie-1'].eloGames).toBe(1);
    expect(window.lib['movie-2'].eloGames).toBe(1);
  });
});
