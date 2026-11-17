import { describe, it, expect, beforeAll } from 'vitest';

describe('Ранжування рекомендацій v2 (recs-math)', () => {
  beforeAll(() => {
    window.loadScript('src/recs-math.js');
  });

  it('recSigmoid: 0.5 у центрі, монотонна, обмежена [0,1]', () => {
    const s = window.recSigmoid;
    expect(s(0.7, 0.7, 10)).toBeCloseTo(0.5, 10);
    expect(s(0.8, 0.7, 10)).toBeGreaterThan(s(0.7, 0.7, 10));
    expect(s(0.6, 0.7, 10)).toBeLessThan(s(0.7, 0.7, 10));
    expect(s(-100, 0.7, 10)).toBeGreaterThanOrEqual(0);
    expect(s(100, 0.7, 10)).toBeLessThanOrEqual(1);
    expect(Number.isFinite(s(1e6, 0.7, 10))).toBe(true);
  });

  it('recBayesRating: мало голосів тягнеться до апріора, багато — лишається', () => {
    const b = window.recBayesRating;
    expect(b(9, 10)).toBeLessThan(b(9, 4000));
    expect(b(9, 4000)).toBeCloseTo((4000 * 0.9 + 200 * 0.65) / 4200, 10);
    expect(b(9, 4000)).toBeLessThan(0.9); // апріор лишає невеликий слід
    expect(b(9, 200)).toBeCloseTo((200 * 0.9 + 200 * 0.65) / 400, 10);
    expect(b(0, 0)).toBeCloseTo(0.65, 10);
    // монотонність за рейтингом
    expect(b(8, 100)).toBeLessThan(b(9, 100));
  });

  it('recRankScore: ваги додаються до 1, anti віднімається напряму', () => {
    const r = window.recRankScore;
    expect(Object.values(window.REC_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);

    const base = { _baseRaw: 0.8, _sourceRaw: 2, _profileRaw: 1.2, _eloRaw: 0.6, _moodBoost: 0.3, _antiPenalty: 0 };
    const withAnti = { ...base, _antiPenalty: 0.2 };
    expect(r(withAnti, 0)).toBeCloseTo(r(base, 0) - 0.2, 10);
    expect(r(base, 0.05)).toBeCloseTo(r(base, 0) + 0.05, 10);
  });

  it('recRankScore: настрій враховано один раз і насичується', () => {
    const r = window.recRankScore;
    const base = { _baseRaw: 0.8, _sourceRaw: 2, _profileRaw: 1.2, _eloRaw: 0.6, _antiPenalty: 0 };
    const noMood = r({ ...base, _moodBoost: 0 }, 0);
    const half = r({ ...base, _moodBoost: 0.3 }, 0);
    const full = r({ ...base, _moodBoost: 0.6 }, 0);
    const over = r({ ...base, _moodBoost: 6.0 }, 0);

    expect(half - noMood).toBeCloseTo(0.12 * 0.5, 10);
    expect(full - noMood).toBeCloseTo(0.12, 10);
    expect(over).toBeCloseTo(full, 10); // кап 1.0, жодного подвійного бонусу
  });

  it('recRankScore: скор абсолютний і не залежить від інших кандидатів', () => {
    const r = window.recRankScore;
    const good = { _baseRaw: 0.85, _sourceRaw: 2.5, _profileRaw: 1.8, _eloRaw: 0.8 };
    const weak = { _baseRaw: 0.55, _sourceRaw: 0.2, _profileRaw: 0.1, _eloRaw: 0.1 };
    const a = r(good, 0);
    r(weak, 0); // наявність слабкого кандидата нічого не змінює
    expect(r(good, 0)).toBeCloseTo(a, 10);
    expect(a).toBeGreaterThan(r(weak, 0));
  });
});
