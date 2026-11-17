'use strict';

// ══════════════════════════════════════════════════════════════
// Чиста математика ранжування рекомендацій (v2).
// Жодного DOM / TMDB / localStorage — легко тестувати окремо.
// Див. RECOMMENDATIONS.md за повним виведенням.
// ══════════════════════════════════════════════════════════════

// Апріори Байєса. Старі TMDB-константи лишаються для зворотної сумісності,
// активні — IMDb (різна статистика голосів для фільмів і серіалів).
const REC_PRIOR_C = 0.65; // legacy TMDB
const REC_PRIOR_M = 200;  // legacy TMDB
const REC_PRIORS = {
  movie: { C: 0.63, m: 2000 },
  tv:    { C: 0.72, m: 800 },
};

// Чистий IMDb-рейтинг і режимний бонус рахуємо ОКРЕМО, щоб бонус не
// «сплющував» різницю між 7.1 і 8.3 через круту сигмоїду.
const REC_BASE_CENTER = { movie: 0.71, tv: 0.77 };
const REC_BASE_SLOPE = 7.5;
const REC_MODE_SHARE = 0.18; // режим впливає щонайбільше на 18% b

// Ваги фінального скору (сума = 1.0), потім віднімаємо штраф anti.
const REC_WEIGHTS = { base: 0.32, source: 0.26, profile: 0.22, elo: 0.08, mood: 0.12 };

// Логістичні центри й крутизни для переведення сирих ознак у [0, 1].
const REC_CENTERS = { base: 0.70, source: 1.40, profile: 1.00, elo: 0.50 };
const REC_SLOPES  = { base: 10.0, source: 1.60, profile: 2.50, elo: 6.00 };

// moodBoost, який вважаємо «повним» впливом настрою.
const REC_MOOD_FULL = 0.60;

// Настроєвий discover більше не заливає _sourceRaw (було 2.0 * weight = 6.0).
const REC_MOOD_SOURCE_CAP = 1.2;

// WR для тайтлів без IMDb (source === 'tmdb'): м'який m, бо інакше
// 2000 голосів апріора повністю з'їдають картки з малим TMDB vote_count.
const REC_FALLBACK_WR_M = 200;

// balance: основний сигнал — log10(голосів), popularity лише слабкий додаток.
const REC_BALANCE_MAX = 0.2;
const REC_BALANCE_POP_SHARE = 0.25; // popularity дає не більше 0.05 з 0.20

function recPriors(type) {
  return REC_PRIORS[type] === REC_PRIORS.tv ? REC_PRIORS.tv : REC_PRIORS.movie;
}

// C лишається за типом, підміняємо тільки m для TMDB-фольбеку.
function recPriorsFor(source, type) {
  const p = recPriors(type);
  return source === 'tmdb' ? { C: p.C, m: REC_FALLBACK_WR_M } : p;
}

// IMDb: log10 голосів 10^2 → 0, 10^6 → 0.20.
// TMDB-фольбек: каталог має менше голосів, тому шкала 10^1 → 10^4.
// popularity додає не більше 25% бонусу й не може перевищити REC_BALANCE_MAX.
function recBalanceBonus(ref, popularity) {
  const votes = Math.max(0, Number(ref && ref.votes) || 0);
  const lg = Math.log10(1 + votes);
  const isIMDb = !!(ref && ref.source === 'imdb');
  const lo = isIMDb ? 2 : 1;
  const hi = isIMDb ? 6 : 4;
  const byVotes = REC_BALANCE_MAX * recClamp01((lg - lo) / (hi - lo));
  const byPop = REC_BALANCE_MAX * REC_BALANCE_POP_SHARE
    * recClamp01((Number(popularity) || 0) / 250);
  return Math.min(REC_BALANCE_MAX, byVotes + byPop);
}
function recClamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

// Доля режимного бонусу в b: бонус 0.30 = 1.0.
function recModeShare(bonus) {
  return recClamp01((Number(bonus) || 0) / 0.30);
}

// b = 0.82 * σ(IMDb WR; x0, 7.5) + 0.18 * modeBonus/0.30
function recBaseScore(wr, modeBonus, type) {
  const center = (type === 'tv') ? REC_BASE_CENTER.tv : REC_BASE_CENTER.movie;
  const quality = recSigmoid(wr, center, REC_BASE_SLOPE);
  return recClamp01((1 - REC_MODE_SHARE) * quality + REC_MODE_SHARE * recModeShare(modeBonus));
}

// Gems: кап на вплив і нижній поріг голосів, щоб фільми з 10 голосами
// не отримували максимальний бонус.
function recGemBonus(votes, wr, type) {
  const v = Math.max(0, Number(votes) || 0);
  if ((Number(wr) || 0) < 0.68) return 0;
  const isTV = type === 'tv';
  const confGate = recClamp01((v - (isTV ? 200 : 500)) / (isTV ? 1000 : 1500));
  const gemZone = recClamp01(((isTV ? 15000 : 45000) - v) / (isTV ? 14000 : 40000));
  return 0.25 * confGate * gemZone;
}

// σ(z) = 1 / (1 + e^(-z)), z = k·(x - x0). Чисельно стабільна форма.
function recSigmoid(x, center, slope) {
  const z = slope * ((Number(x) || 0) - center);
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

// Байєсовське стиснення рейтингу до апріора:
// WR = (v·R + m·C) / (v + m)
function recBayesRating(rating10, votes, priorC, priorM) {
  const R = Math.max(0, Math.min(10, Number(rating10) || 0)) / 10;
  const v = Math.max(0, Number(votes) || 0);
  const C = priorC == null ? REC_PRIOR_C : priorC;
  const m = priorM == null ? REC_PRIOR_M : priorM;
  return (v * R + m * C) / (v + m);
}

// Фінальний скор кандидата. Усі ознаки вже в [0, 1], anti — абсолютний штраф.
function recRankScore(entry, jitter) {
  // За наявності _b (IMDb-шлях) беремо вже розрахований чистий b;
  // інакше — стара сигмоїда від _baseRaw (для сумісності).
  const base = (typeof entry._b === 'number' && Number.isFinite(entry._b))
    ? recClamp01(entry._b)
    : recSigmoid(entry._baseRaw, REC_CENTERS.base, REC_SLOPES.base);
  const source  = recSigmoid(Math.min(entry._sourceRaw || 0, 3), REC_CENTERS.source, REC_SLOPES.source);
  const profile = recSigmoid(entry._profileRaw || 0, REC_CENTERS.profile, REC_SLOPES.profile);
  const elo     = recSigmoid(entry._eloRaw || 0, REC_CENTERS.elo, REC_SLOPES.elo);
  const mood    = Math.max(0, Math.min(1, (entry._moodBoost || 0) / REC_MOOD_FULL));
  const w = REC_WEIGHTS;
  const score = w.base * base + w.source * source + w.profile * profile
    + w.elo * elo + w.mood * mood - (entry._antiPenalty || 0);
  return score + (Number(jitter) || 0);
}

// Публічний API для home.js і тестів (classic script, без модулів).
window.REC_PRIORS = REC_PRIORS;
window.REC_MOOD_SOURCE_CAP = REC_MOOD_SOURCE_CAP;
window.REC_FALLBACK_WR_M = REC_FALLBACK_WR_M;
window.REC_BALANCE_MAX = REC_BALANCE_MAX;
window.REC_BALANCE_POP_SHARE = REC_BALANCE_POP_SHARE;
window.recPriors = recPriors;
window.recPriorsFor = recPriorsFor;
window.recBalanceBonus = recBalanceBonus;
window.recBaseScore = recBaseScore;
window.recGemBonus = recGemBonus;
