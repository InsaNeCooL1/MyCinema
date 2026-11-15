import { describe, it, expect } from 'vitest';

describe('tasteDecay', () => {
  it('свіжа оцінка (0 днів) → ~1.0', () => {
    const now = Date.now();
    expect(window.tasteDecay(now)).toBeCloseTo(1.0, 2);
  });

  it('180 днів → ~0.5 (один період напіврозпаду)', () => {
    const now = Date.now();
    const halfYearAgo = now - 180 * 24 * 60 * 60 * 1000;
    expect(window.tasteDecay(halfYearAgo)).toBeCloseTo(0.5, 2);
  });

  it('360 днів → ~0.25 (два періоди)', () => {
    const now = Date.now();
    const yearAgo = now - 360 * 24 * 60 * 60 * 1000;
    expect(window.tasteDecay(yearAgo)).toBeCloseTo(0.25, 2);
  });

  it('null → 1.0 (свіже за замовчуванням)', () => {
    expect(window.tasteDecay(null)).toBeCloseTo(1.0, 2);
  });
});
