import { describe, it, expect } from 'vitest';

describe('computeAverage', () => {
  it('null → 0', () => {
    expect(window.computeAverage(null)).toBe(0);
  });

  it('порожній обʼєкт → 0', () => {
    expect(window.computeAverage({})).toBe(0);
  });

  it('усі нулі → 0 (нулі ігноруються як "не заповнено")', () => {
    expect(window.computeAverage({ plot: 0, cast: 0, style: 0 })).toBe(0);
  });

  it('часткові оцінки → середнє лише заповнених', () => {
    // (8 + 6) / 2 = 7; style = 0 ігнорується
    expect(window.computeAverage({ plot: 8, cast: 6, style: 0 })).toBeCloseTo(7, 5);
  });

  it('усі 5 критеріїв заповнені → середнє всіх', () => {
    const r = { plot: 8, cast: 8, style: 8, emotions: 8, overall: 8 };
    expect(window.computeAverage(r)).toBe(8);
  });
});
