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

  it('IMDb апріори: фільми й серіали мають різні C/m', () => {
    const p = window.recPriors;
    expect(p('movie')).toEqual({ C: 0.63, m: 2000 });
    expect(p('tv')).toEqual({ C: 0.72, m: 800 });
    const b = window.recBayesRating;
    // 8.8 при 200 голосах стягується до ~0.653, а не лишається 0.88
    const wr = b(8.8, 200, p('movie').C, p('movie').m);
    expect(wr).toBeCloseTo((200 * 0.88 + 2000 * 0.63) / 2200, 10);
    expect(wr).toBeLessThan(0.7);
    // серіали мають вищий апріор
    expect(b(8.0, 100, p('tv').C, p('tv').m)).toBeGreaterThan(b(8.0, 100, p('movie').C, p('movie').m));
  });

  it('recPriorsFor: TMDB-фольбек має m=200 і зберігає C за типом', () => {
    const p = window.recPriorsFor;
    expect(p('tmdb', 'movie')).toEqual({ C: 0.63, m: 200 });
    expect(p('tmdb', 'tv')).toEqual({ C: 0.72, m: 200 });
    expect(p('imdb', 'movie')).toEqual({ C: 0.63, m: 2000 });
    expect(p('imdb', 'tv')).toEqual({ C: 0.72, m: 800 });

    const b = window.recBayesRating;
    const soft = b(7.5, 30, p('tmdb', 'movie').C, p('tmdb', 'movie').m);
    const hard = b(7.5, 30, p('imdb', 'movie').C, p('imdb', 'movie').m);
    expect(soft).toBeGreaterThan(hard); // картки без IMDb не обнуляються апріором
  });

  it('recBalanceBonus: log10 голосів основний, popularity — лише 25%', () => {
    const bb = window.recBalanceBonus;
    const imdb = (v, pop = 0) => bb({ source: 'imdb', votes: v }, pop);

    expect(imdb(99, 250)).toBeCloseTo(0.05, 10);          // 10^2 → 0 + popularity 0.05
    expect(imdb(9999, 0)).toBeCloseTo(0.10, 10);          // 10^4 → 0.10
    expect(imdb(999999, 250)).toBeCloseTo(0.20, 10);      // 10^6 → кап 0.20
    expect(imdb(1e9, 1e9)).toBeCloseTo(0.20, 10);         // подвійний кап
    expect(imdb(1000, 0)).toBeGreaterThan(imdb(100, 0));

    // popularity не може перевищити 25% бонусу
    expect(bb({ source: 'tmdb', votes: 0 }, 250)).toBeCloseTo(0.05, 10);
    // TMDB-шкала м'якша за IMDb (каталог має менше голосів)
    expect(bb({ source: 'tmdb', votes: 200 }, 0)).toBeGreaterThan(imdb(200, 0));
  });

  it('recBaseScore: режимний бонус не сплющує різницю 7.1 vs 8.3', () => {
    const base = window.recBaseScore;
    const weak = base(0.71, window.recGemBonus(2000, 0.71, 'movie'), 'movie'); // gems на межі WR
    const strong = base(0.83, 0.00, 'movie'); // якісний фільм без бонусу
    expect(strong).toBeGreaterThan(weak);
    // режим може дати не більше 18% b
    const noBonus = base(0.80, 0, 'movie');
    const maxBonus = base(0.80, 0.30, 'movie');
    expect(maxBonus - noBonus).toBeCloseTo(0.18, 10);
    // серіали мають вищий центр
    expect(base(0.77, 0, 'tv')).toBeCloseTo(base(0.71, 0, 'movie'), 10);
  });

  it('recGemBonus: бонус нульовий для порожнячок і для занадто популярних', () => {
    const g = window.recGemBonus;
    expect(g(10, 0.9, 'movie')).toBe(0);       // 10 голосів
    expect(g(400, 0.65, 'movie')).toBe(0);      // WR нижче порогу
    expect(g(3000, 0.8, 'movie')).toBeGreaterThan(0);
    expect(g(50000, 0.9, 'movie')).toBe(0);     // вже не перлина
    expect(g(800, 0.8, 'tv')).toBeGreaterThan(0);
    expect(g(20000, 0.8, 'tv')).toBe(0);
  });

  it('recRankScore: бере _b, якщо він є (IMDb-шлях)', () => {
    const r = window.recRankScore;
    const entry = { _baseRaw: 0.0, _b: 0.9, _sourceRaw: 0, _profileRaw: 0, _eloRaw: 0 };
    expect(r(entry, 0)).toBeGreaterThan(r({ ...entry, _b: 0.2 }, 0));
    expect(r({ ...entry, _b: 2 }, 0)).toBeCloseTo(r({ ...entry, _b: 1 }, 0), 10); // кап
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
