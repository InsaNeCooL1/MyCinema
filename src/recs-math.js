'use strict';

// ══════════════════════════════════════════════════════════════
// Чиста математика ранжування рекомендацій (v2).
// Жодного DOM / TMDB / localStorage — легко тестувати окремо.
// Див. RECOMMENDATIONS.md за повним виведенням.
// ══════════════════════════════════════════════════════════════

// Апріор для оцінки TMDB: C — середнє, m — «кількість голосів» апріора.
const REC_PRIOR_C = 0.65; // 6.5 / 10
const REC_PRIOR_M = 200;

// Ваги фінального скору (сума = 1.0), потім віднімаємо штраф anti.
const REC_WEIGHTS = { base: 0.32, source: 0.26, profile: 0.22, elo: 0.08, mood: 0.12 };

// Логістичні центри й крутизни для переведення сирих ознак у [0, 1].
const REC_CENTERS = { base: 0.70, source: 1.40, profile: 1.00, elo: 0.50 };
const REC_SLOPES  = { base: 10.0, source: 1.60, profile: 2.50, elo: 6.00 };

// moodBoost, який вважаємо «повним» впливом настрою.
const REC_MOOD_FULL = 0.60;

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
  const base    = recSigmoid(entry._baseRaw, REC_CENTERS.base, REC_SLOPES.base);
  const source  = recSigmoid(Math.min(entry._sourceRaw || 0, 3), REC_CENTERS.source, REC_SLOPES.source);
  const profile = recSigmoid(entry._profileRaw || 0, REC_CENTERS.profile, REC_SLOPES.profile);
  const elo     = recSigmoid(entry._eloRaw || 0, REC_CENTERS.elo, REC_SLOPES.elo);
  const mood    = Math.max(0, Math.min(1, (entry._moodBoost || 0) / REC_MOOD_FULL));
  const w = REC_WEIGHTS;
  const score = w.base * base + w.source * source + w.profile * profile
    + w.elo * elo + w.mood * mood - (entry._antiPenalty || 0);
  return score + (Number(jitter) || 0);
}
