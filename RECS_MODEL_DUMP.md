# Дамп моделі рекомендацій MyCinema

Згенеровано: 2026-11-17 · Commit: `bdc6e15` — feat(recs): soft WR prior for TMDB fallback and log-vote balance bonus

Один файл для перенесення/аудиту: специфікація, вихідні коди всього ланцюга (бібліотека → TMDB → IMDb → скор), воркер і тести.

## Мапа файлів

| # | Файл | Роль | Рядків |
|---:|---|---|---:|
| 1 | `RECOMMENDATIONS.md` | Поточна специфікація математики (12 секцій, формули) | 448 |
| 2 | `src/config.js` | Константи: PROXY_URL, MOODS, TASTE_HALFLIFE_DAYS, EXCLUDED_TV_GENRES, RATING_CRITERIA, ELO_START, ACTOR_* константи | 99 |
| 3 | `src/recs-math.js` | Чиста математика: PRIORS, WR, recPriorsFor, recBalanceBonus, recGemBonus, recBaseScore, recRankScore | 143 |
| 4 | `src/imdb-ratings.js` | IMDb-шар: /imdb/batch, 7денний кеш, imdbLoadFor, imdbRef (IMDb→TMDB fallback) | 229 |
| 5 | `src/api.js` | tmdbFetch + normalizeItem — каталог TMDB і нормалізація кандидатів | 148 |
| 6 | `src/core.js` | computeItemRating, computeTasteVector, computeActorProfiles, globalRefAvg (gT), затухання смаку | 1433 |
| 7 | `src/home.js` | Конвеєр: getSeeds, сигнали, discover, pre-score, фінальний скор, diversity, computeRecsSignature | 2110 |
| 8 | `worker/README.md` | Контракт /imdb/batch, формат MDBList, порядок ротації ключів | 146 |
| 9 | `worker/index.js` | Вихідний код CF Worker (gitignored у репо; ключі лише в CF secrets) | 290 |
| 10 | `tests/recs-math.test.js` | Тести чистих формул, включно з m=200 і log10-бонусом | 134 |
| 11 | `tests/imdb-ratings.test.js` | Тести батчу/кешу/fallback IMDb-шару | 119 |
| 12 | `tests/home-imdb.test.js` | Тести конвеєра: residual, backfill, gT, TMDB-фольбек у WR | 130 |

> Не включено: `bundle.js`, `styles.css`, `www/` (збірка), ключі API (лише CF secrets), історію змін. Дамп є знімком зазначеного коміту.

---

## 1. `RECOMMENDATIONS.md`

Поточна специфікація математики (12 секцій, формули)

````markdown
# MyCinema — математика рекомендацій

Стрічка «Рекомендації» формується з бібліотеки користувача, каталогу TMDB і рейтингів IMDb.

- **Локальна бібліотека** (`lib`) — оцінки, статуси, ❤️, ELO, акторські корекції, виключення з профілю.
- **TMDB** — каталог: постери, назви, жанри, актори, ключові слова, колекції, discover, дати релізу, провайдери UA.
- **IMDb** — рейтинг, кількість голосів і залишок (residual). Клієнт отримує їх пакетом `POST /imdb/batch` із Cloudflare Worker (MDBList) і кешує на 7 днів.

Код: `src/core.js` (оцінки, смак, профілі), `src/home.js` (конвеєр), `src/recs-math.js` (чиста математика), `src/imdb-ratings.js` (IMDb-шар), `src/config.js` (константи, настрої).

---

## 1. Оцінка тайтлу

Критерії `C = {plot, cast, style, emotions, overall}`.

**Фільм:** середнє по заповнених критеріях

\[
\bar r(i)=\frac{1}{|C_i|}\sum_{c\in C_i} r_{i,c},\qquad C_i=\{c\in C:\ r_{i,c}>0\}
\]

**Серіал:** спочатку середнє по сезонах, потім середнє по оцінених сезонах

\[
\bar r(i)=\frac{1}{|S_i|}\sum_{s\in S_i}\bar r_{i,s},\qquad
\bar r_{i,s}=\frac{1}{|C_{i,s}|}\sum_{c\in C_{i,s}} r_{i,s,c},\qquad
S_i=\{s:\bar r_{i,s}>0\}
\]

Для критерію «каст» у серіалу береться середнє по сезонах, де є оцінка.

---

## 2. Часове затухання й вектор смаку

Вага перегляду віком `d_i` днів (період напіврозпаду `TASTE_HALFLIFE_DAYS = 180`):

\[
w_i = 0.5^{\,d_i/180},\qquad d_i=\max\!\left(0,\frac{\text{now}-t_i}{24\text{ год}}\right)
\]

Для серіалів критерій береться з усереднених сезонних оцінок. Середнє за критерієм `c`:

\[
T_c = \frac{\sum_i w_i\, r_{i,c}}{\sum_i w_i}
\]

Вектор смаку містить усі оцінені тайтли з `avg > 0`.

**Домінуючий критерій** `domCrit`: існує при `count ≥ 3`, якщо

\[
\max_c T_c - \frac{1}{5}\sum_c T_c \ge 0.35
\]

Він дає множник `×1.15` до ваги сіду, якщо в цьому сіді оцінка критерію `≥ 8`.

---

## 3. IMDb-шар

`imdbRef(item)` повертає єдине джерело рейтингу:

\[
\text{imdbRef}(i)=
\begin{cases}
(r_{\text{IMDb}},\ v_{\text{IMDb}},\ \texttt{imdb}, id_{\text{IMDb}}) & \text{якщо дані IMDb є}\\
(r_{\text{TMDB}},\ v_{\text{TMDB}},\ \texttt{tmdb}, null) & \text{інакше}
\end{cases}
\]

Пакетний запит `imdbLoadFor(movies, tv)` надсилає до **400** унікальних `tmdb_id` на тип за виклик, зберігає результат у кеші на **7 днів** (`mcCacheGet/mcCacheSet`, стеля 3000 записів). При помилці воркера/квоти повертається `ok:false`, кешовані значення лишаються, а відсутні тайтли обробляються як `source: 'tmdb'`.

Перед розрахунком сідів виконується `ensureLibraryImdb()` — пакетний backfill усієї бібліотеки. Перед pre-score таким самим чином підтягується весь пул кандидатів.

Типові значення, коли рейтингу взагалі немає: `6.9` для фільмів, `7.6` для серіалів.

---

## 4. Сіди

Кандидат у сіди: `avg ≥ 6.5`, або ❤️, або (`eloGames > 0` і `elo ≥ 1530`). Тайтл виключається, якщо `excludeFromProfile === true`, або (за відсутності явного прапорця) якщо `|avg − r_IMDb| > 3`.

```
base      = avg  (або 8.6 якщо ❤️ без оцінки, 8.2 інакше)
favBonus  = 1.2 · [favorite]
eloBonus  = min((elo − 1500)/100, 1.5)  при elo > 1500
strength  = min(10, base + favBonus + eloBonus)

residual  = avg − r_IMDb   (або avg − r_TMDB, або avg − 6.9/7.6)
resFactor = clamp(1 + residual/2, 0.3, 2)
decayMult = max(0.1, 0.5^(days/180))

rankScore = (strength/10) · resFactor · (0.35 + 0.65·decayMult)
```

Відбір: **3 найсвіжіші** + добір до **10** найвищих `rankScore`.

Антисіди: `dropped` або `antiSeed`, не більше **5**, спочатку явні `antiSeed`, потім за свіжістю.

---

## 5. Сигнали смаку

Базова вага сіду:

\[
w_s=\frac{\text{strength}_s}{10}\cdot\text{resFactor}_s\cdot\text{decayMult}_s
\]

(×1.15 для домінуючого критерію). Сіди групуються за колекцією (`col-<id>`), інакше за самим сідом. Для кожної сутності `e` в групі:

\[
\text{sum}_e=\sum_s v_{s,e},\qquad \text{max}_e=\max_s v_{s,e},\qquad
\text{comb}(e)=\text{max}_e+0.3(\text{sum}_e-\text{max}_e)
\]

Внески: режисер `2.2·w_s`, актор `2.0·w_s·c_w·\max(0.3,\,1+0.45\,\text{adj})`, жанр `1.4·w_s`, ключове слово `1.1·w_s`. Сигнал — сума `comb(e)` по всіх групах.

Для режисерів і акторів сигнал додатково масштабується за залишком:

\[
S_e \mathrel{*}= \mathrm{clamp}\!\left(1+\frac{\sum_s \text{residual}_s/(n_e+3)}{2},\;0.5,\;1.6\right)
\]

### Профіль актора

Нехай `G` — середнє оцінки «каст» по бібліотеці, `gT` — середній IMDb-рейтинг оцінених тайтлів:

\[
G=\frac{1}{n}\sum_i r_{c,i},\qquad
gT=\frac{1}{n'}\sum_{i:\,r_{\text{IMDb}}>0} r_{\text{IMDb},i}
\]

Вага появи в тайтлі:

\[
w=\text{roleW}\cdot\text{fw},\qquad
\text{roleW}=\begin{cases}1.35 & idx\le3\\0.90 & idx\le6\\0.55 & \text{інакше}\end{cases},\qquad
\text{fw}=1,\,0.45,\,0.25,\,0.15\ \text{для 1..4+ фільмів франшизи}
\]

\[
\text{rawAvg}=\frac{\sum w\,r_c}{\sum w},\qquad
\text{stabAvg}=\frac{n_{\text{eff}}\,\text{rawAvg}+2G}{n_{\text{eff}}+2},\qquad n_{\text{eff}}=\sum \text{fw}
\]

Відсоткові модифікатори:

\[
\text{lead}\%=0.032\,\frac{\sum_{\text{лід}} w}{\sum w+2},\qquad
\text{hit}\%=0.055\,\frac{\sum_{\delta>0.30} w\cdot\mathrm{clamp}\!\left(\frac{\delta-0.30}{h},0,1\right)}{\sum w+2}
\]

\[
\text{pen}\%=\frac{\sum_{\delta<-0.35} w\cdot\min\!\left(0.25,\;0.10\left(\frac{-0.35-\delta}{0.50}\right)^{0.85}\right)}{\sum w+0.5}
\]

де `h = clamp(10−G, 0.8, 1.3)`. Штраф за концентрацію у франшизі `fr% ≤ 0.09` застосовується при ≥2 фільмах однієї франшизи й частці її ефективних ваг понад 0.35.

\[
\text{shrunkBase}=\text{stabAvg}\,(1+\text{lead}\%+\text{hit}\%)\,(1-\text{pen}\%)\,(1-\text{fr}\%)
\]

Залишок актора:

\[
\text{res}_i=(r_{c,i}-G)-(r_{\text{IMDb},i}-gT),\qquad d_i=0.5^{\,\text{days}_i/180}
\]

\[
\text{avgRes}=\frac{\sum w_i d_i\,\text{res}_i}{\sum w_i d_i},\qquad
\text{recSignal}=0.75(\text{shrunkBase}-G)+0.35\,\mathrm{clamp}(\text{avgRes},-2.5,2.5)+\text{adjRec}
\]

де `adjRec = 0.45·adj` при `adj > 0` і `0.85·adj` при `adj < 0`.

Актор із негативним профілем (`adj < 0`, або при ≥2 оцінках `rawAvg ≤ G−1.35`, або ≥3 промахах без хітів) вимикається з позитивних сигналів і додається в `anti.cast`:

\[
\text{anti.cast}=\min(1.4,\max(0.25,\,0.6|\text{recSignal}|))
\]

Позитивний профіль (`ratedCount ≥ 1`, `recSignal > 0.25`, `shrunk ≥ G`) дає

\[
S_{\text{cast}}=\max(S_{\text{cast}},\ \min(2.2,\ 0.95\,\text{recSignal}))
\]

Ручні корекції: `adj > 0` → `S = max(S, 0.85 adj) + 0.30 adj` і зняття anti; `adj < 0` → `S = 0`, `anti.cast = max(anti.cast, 0.85|adj|)`.

### Анти-сигнали

Для кожного антисіду з вагою `aw = 1.4` (явний) або `1.0` (dropped):

\[
\text{anti.directors} += aw,\qquad \text{anti.genres} += 0.4\,aw,\qquad \text{anti.keywords} += aw
\]

Сховані рекомендації додають `+0.25` до відповідних жанрів.

---

## 6. Генерація кандидатів

| Джерело | Що робить | `_sourceRaw` |
|---|---|---|
| TMDB recommendations сідів | до 12 на сід, індекс `idx` | `min(2.2, (strength/10)·resFactor·decayMult)·(1 − 0.045·idx)` |
| discover за keywords + genres | топ-6 keyword, топ-3 жанри | `+0.9` |
| discover за жанрами | топ-3 жанри | `+0.45` |
| discover за настроєм | жанри настрою | `+min(1.2, 0.4·weight)` |
| discover за актором | `with_cast`, топ-3 (movie + tv-кредити) | `+0.75 + min(0.4, 0.16·max(0, recSignal))` |
| discover за режисером | `with_crew`, топ-3 | `+0.9` |

Налаштування настрою задається в `MOODS`: набір жанрів (`genres` / `tvGenres`) і `weight = 3.0`. Окрім `_sourceRaw`, настрій формує

\[
\text{moodBoost}=\min(0.6,\ 0.05\,n_{\text{genreHits}}\,\text{weight} + 0.12\,\text{weight}\cdot[\text{з discover-за-настроєм}])
\]

де `n_genreHits` — кількість жанрів тайтлу зі списку настрою; окремий внесок `_sourceRaw` від настрою обмежений `REC_MOOD_SOURCE_CAP = 1.2`.

Параметри TMDB discover: м'який поріг `vote_count.gte = 20` (фільми) / `10` (серіали), без обмеження за середнім рейтингом. Режим `gems` сортує за `vote_average.desc`, `fresh` — за популярністю з датою релізу не раніше `Y−2`; для серіалів виключаються жанри `10763, 10764, 10767`.

Фільтри кандидатів: наявність постера, не в бібліотеці, не схований, не в майбутньому релізі при `digitalOnly`/`streamingOnlyUA`.

ELO сіду, якщо є ігри, дає внесок у `_eloHits`:

\[
\text{eloHit}=\mathrm{clamp}\!\left(\frac{elo-1450}{250},0,1\right),\qquad
\text{eloRaw}=\text{mean}(\text{eloHits})
\]

---

## 7. TF-IDF жанрів

Нехай `S_g` — сигнал жанру в користувача, `N_g` — число кандидатів із цим жанром у пулі, `D` — число унікальних жанрів:

\[
u_g=\frac{S_g+0.5}{\sum_g S_g+0.5D},\qquad
p_g=\frac{N_g+1}{\sum_g N_g+D},\qquad
\text{lift}_g=\frac{u_g}{p_g}
\]

Для кандидата:

\[
\text{genreMatch}=\min\!\left(1.4,\ \frac{\sum_g \min(\text{lift}_g-1,\,1.8)}{n}\,\sqrt n\right)
\]

де сума — тільки по жанрах із `S_g > 0` і `lift_g > 1`, `n` — їх кількість. Жанрений anti-штраф `antiGenre = min(0.3, Σ anti.genres[g]·0.12)`.

---

## 8. Pre-score

Рейтинг і голоси кандидата беруться з IMDb (`imdbRef`). Байєсовське стиснення:

\[
R=\frac{r}{10},\qquad v=v_{\text{ref}},\qquad
\text{WR}=\frac{vR+mC}{v+m}
\]

| джерело | тип | `C` | `m` |
|---|---|---:|---:|
| IMDb | movie | 0.63 | 2000 |
| IMDb | tv | 0.72 | 800 |
| TMDB (фолбек) | movie | 0.63 | **200** |
| TMDB (фолбек) | tv | 0.72 | **200** |

`C` залежить лише від типу; для `source === 'tmdb'` підміняється тільки `m` (`recPriorsFor`), щоб малий `vote_count` каталогу не з'їдався апріором у 2000 голосів.

Режимний бонус:

\[
\text{modeBonus}=
\begin{cases}
0.25\,g_v\,g_{\text{zone}} & \text{gems (IMDb), див. нижче}\\
\mathrm{clamp}\!\left(\frac{2500-v_{\text{TMDB}}}{2500},0,0.3\right) & \text{gems (TMDB-фольбек)}\\
\mathrm{clamp}\!\left(0.15\,(y-(Y-2)),0,0.3\right) & \text{fresh}\\
\mathrm{recBalanceBonus}(v_{\text{ref}},\text{popularity}) & \text{balance}
\end{cases}
\]

Для `balance` основний сигнал — логарифм голосів, а не голий TMDB popularity:

\[
\text{recBalanceBonus}=\min\!\left(0.2,\ 0.2\,\mathrm{clamp}\!\left(\frac{\log_{10}(1+v)-\ell_0}{\ell_1-\ell_0},0,1\right)
+0.05\,\mathrm{clamp}\!\left(\frac{\text{popularity}}{250},0,1\right)\right)
\]

де `(\ell_0,\ell_1)=(2,6)` для IMDb (`10²→0`, `10⁶→0.20`) і `(1,4)` для TMDB-фольбеку. Popularity дає не більше 25 % бонусу (`0.05` з `0.20`) і слугує лише слабким додатком.

Для `gems` з даними IMDb вимагається `v ≥ 500` (movie) / `200` (tv) і `WR ≥ 0.68`; інакше кандидат відсіюється. Коефіцієнти:

\[
g_v=\mathrm{clamp}\!\left(\frac{v-v_{\min}}{v_{\text{gate}}},0,1\right),\qquad
g_{\text{zone}}=\mathrm{clamp}\!\left(\frac{v_{\max}-v}{v_{\text{zone}}},0,1\right)
\]

з `(v_min, v_gate, v_max, v_zone)` = `(500, 1500, 45000, 40000)` для movie та `(200, 1000, 15000, 14000)` для tv. Без даних IMDb у режимі `gems` кандидат відсіюється при `votes > 2500` або `tmdbRating < 7.0`.

\[
\text{baseRaw}=\text{WR}+\text{modeBonus}
\]

\[
\text{pre}=0.35\,\text{baseRaw}+0.20\min(\text{sourceRaw},5)+0.30\,\text{genreMatch}
-\text{antiGenre}+0.70\,\text{moodBoost}
\]

Pre-score використовується лише для відбору топ-30 фільмів + топ-30 серіалів, яким дотягуються кредити й ключові слова.

---

## 9. Фінальний скор

### 9.1 База `b`

Sigmoїда:

\[
\sigma(x;x_0,k)=\frac{1}{1+e^{-k(x-x_0)}}
\]

Чиста якість IMDb і режимний бонус обчислюються окремо:

\[
b=\mathrm{clamp}\!\left(0.82\,\sigma(\text{WR};x_0,7.5)+0.18\min\!\left(\frac{\text{modeBonus}}{0.30},1\right),\ 0,\ 1\right)
\]

з `x₀ = 0.71` для movie, `0.77` для tv. Частка режиму в `b` — не більше 18 %, якості IMDb — не менше 82 %.

### 9.2 Профіль і anti кандидата

```
actorMatch    = min(0.80, Σ S_cast[c] · c.w · 0.25 · leadBoost)   leadBoost = 1.12 при shrunk ≥ G+0.5 та c.w ≥ 0.5
directorMatch = min(0.80, Σ S_dir[d] · 0.4)
kwMatch       = min(0.60, Σ S_kw[k] · 0.12)
profileRaw    = genreMatch + actorMatch + directorMatch + kwMatch
antiPenalty   = antiGenre + min(0.4, antiDir) + min(0.35, antiKw) + min(0.35, antiCast)
```

Для кандидатів без метаданих: `profileRaw = genreMatch`, `antiPenalty = antiGenre`, `jitter = 0`.

### 9.3 Логістичне нормування

| ознака | `x` | `x₀` | `k` | результат |
|---|---:|---:|---:|---|
| база | `WR`, `modeBonus` | 0.71 movie / 0.77 tv | 7.5 | `b` (див. 9.1) |
| джерело | `min(sourceRaw, 3)` | 1.40 | 1.6 | `s` |
| профіль | `profileRaw` | 1.00 | 2.5 | `p` |
| ELO | `eloRaw` | 0.50 | 6.0 | `e` |
| настрій | `moodBoost / 0.60` | — | — | `m = clamp(·, 0, 1)` |

### 9.4 Підсумкова формула

\[
\boxed{\;
\text{score}=0.32\,b+0.26\,s+0.22\,p+0.08\,e+0.12\,m-\text{antiPenalty}+\varepsilon
\;}
\]

\[
\varepsilon=(u-0.5)\cdot0.08,\qquad u=\text{seededRandom}(\text{userId}\,|\,\text{date}\,|\,\text{refreshNonce})
\]

Скор абсолютний: він не залежить від складу поточного пулу кандидатів.

### 9.5 Різноманіття

Лічильники за франшизою (`colId`), першим режисером і першим актором. Для третього й далі входження:

\[
\text{colPen}=\min(0.24,\,0.08(n_{\text{col}}-2)),\quad
\text{dirPen}=\min(0.18,\,0.06(n_{\text{dir}}-2)),\quad
\text{leadPen}=\min(0.15,\,0.05(n_{\text{lead}}-2))
\]

\[
\text{divPen}=\min\!\left(0.28,\ \max(\text{colPen},\text{dirPen},\text{leadPen})\right)
\]

`divPen` віднімається від `_sortScore`, після чого виконується фінальне пересортування разом із кандидатами без метаданих. Результат: `[...топ-80 фільмів, ...топ-80 серіалів]`.

---

## 10. Кешування

| Кеш | TTL | Ключ |
|---|---:|---|
| IMDb-рейтинги | 7 днів | `mycinema.imdbRatings.v1` |
| Метадані (`credits`, `keywords`) | 7 днів, 220 записів | `mycinema.metaCache.v2` |
| Загальні добірки | 12 год | `mycinema.home.general.v7` |
| Рекомендації | 48 год | `mycinema.recs.v5` |

Підпис рекомендацій:

```
v15-imdb | дата | nonce | сіди(strength,resFactor) | антисіди | виключення |
акторські корекції | сума акторських оцінок | настрій(weight) | режим |
digitalOnly | streamingOnlyUA
```

Офлайн-режим продовжує термін дії кешу recommendation і general.

---

## 11. Практичний приклад

Кандидат (movie): IMDb `8.8` при `15 000` голосах, популярність `120`, 2 recommendation-сіди, `genreMatch = 0.80`, актор `0.30`, режисер `0.20`, keyword `0.12`, `eloRaw = 0.7`, `moodBoost = 0.18`, `antiPenalty = 0.05`.

1. **Байєс:** `WR = (15000·0.88 + 2000·0.63)/17000 ≈ 0.8506`.
2. **balance:** `log₁₀(15001) ≈ 4.176 → 0.2·(4.176−2)/4 ≈ 0.1088`; `popularity` додає `0.05·(120/250) = 0.024`. `modeBonus ≈ 0.1328`, `baseRaw ≈ 0.9834`.
3. **База:** `b = 0.82·σ(0.8506; 0.71, 7.5) + 0.18·(0.1328/0.30) ≈ 0.6878`.
4. **Ознаки:** `s = σ(2.65; 1.40, 1.6) ≈ 0.8808`, `p = σ(1.42; 1.00, 2.5) ≈ 0.7408`, `e = σ(0.70; 0.50, 6) ≈ 0.7685`, `m = 0.18/0.60 = 0.30`.
5. **Скор:** `0.32·0.6878 + 0.26·0.8808 + 0.22·0.7408 + 0.08·0.7685 + 0.12·0.30 − 0.05 ≈ 0.6596`.
6. **Jitter:** `0.6196 … 0.6996`. Третій фільм тієї самої франшизи: `−0.08 → ≈ 0.5796`.

Для порівняння, картка без IMDb з `vote_count = 30`, `tmdbRating = 7.5` і тим самим popularity:

- `m = 200` дає `WR = (30·0.75 + 200·0.63)/230 ≈ 0.6457` (з `m = 2000` було б `≈ 0.6318`);
- `balance` використовує TMDB-шкалу `(1,4)` і popularity, тому не обнулюється.

---

## 12. Де крутити ручки

| Хочеш… | Де міняти |
|---|---|
| вплив настрою | `MOODS.weight`, `REC_MOOD_FULL`, `REC_MOOD_SOURCE_CAP` |
| баланс ознак | `REC_WEIGHTS` у `src/recs-math.js` (сума = 1.0) |
| різкість ознак | `REC_SLOPES`, `REC_CENTERS` у `src/recs-math.js` |
| апріори IMDb | `REC_PRIORS` (окремо movie/tv) у `src/recs-math.js` |
| апріор TMDB-фольбеку | `REC_FALLBACK_WR_M`, `recPriorsFor()` у `src/recs-math.js` |
| balance-бонус | `recBalanceBonus()`, `REC_BALANCE_MAX`, `REC_BALANCE_POP_SHARE` у `src/recs-math.js` |
| силу режиму в `b` | `REC_BASE_CENTER`, `REC_BASE_SLOPE`, `REC_MODE_SHARE` |
| планку перлин | `recGemBonus()` у `src/recs-math.js` |
| затухання смаку | `TASTE_HALFLIFE_DAYS` у `src/config.js` |
| число/вагу сідів | `getSeeds()` у `src/home.js` |
| різноманіття | блок `Diversity` у `src/home.js` |
| TTL IMDb-кешу | `IMDB_CACHE_TTL`, `IMDB_CACHE_MAX` у `src/imdb-ratings.js` |
| воркер/key | `PROXY_URL` у `src/config.js`, CF secret `MDBLIST_KEY` на воркері |

Чисті функції й IMDb-шар покриті тестами `tests/recs-math.test.js`, `tests/imdb-ratings.test.js`, `tests/home-imdb.test.js`.
````

---

## 2. `src/config.js`

Константи: PROXY_URL, MOODS, TASTE_HALFLIFE_DAYS, EXCLUDED_TV_GENRES, RATING_CRITERIA, ELO_START, ACTOR_* константи

````js
'use strict';

// ============ API ============
const DEFAULT_PROXY_URL = "https://mycinema-proxy.insaneteresh123.workers.dev";
let PROXY_URL = (() => { try { return localStorage.getItem('mycinema.tmdbProxy') || DEFAULT_PROXY_URL; } catch { return DEFAULT_PROXY_URL; } })();
const TMDB_IMG = "https://image.tmdb.org/t/p/";

// ============ CONSTANTS ============
const LS = "mycinema.library";
const LS_VER = "mycinema.library.v";
const RECS_CACHE = "mycinema.recs.v5"; /* FIX-CACHE-BUMP */
const EXCLUDED_TV_GENRES = [10763, 10764, 10767];
const ANIMATION_GENRE_ID = 16;
const CAST_LIMIT = 10;
const ELO_START = 1500;
const ELO_K = 32;
const TASTE_HALFLIFE_DAYS = 180;
const ACTOR_ADJUST_STEP = 0.35;
const ACTOR_ADJUST_KEY = 'mycinema.actorAdjustments';
const ACTOR_REF_PROJECTS = 6;
const ACTOR_LEAD_MAX_INDEX = 3;
const ACTOR_PENALTY_START = -0.35;
const ACTOR_PENALTY_10_DELTA = -0.85;
const ACTOR_PENALTY_CAP = 0.25;
const ACTOR_FRANCHISE_CAP = 0.09;
const MCU_COMPANY_IDS = [420, 38679];
/* FIX-LOCAL-KEYS */
window.MC_LOCAL_KEYS = ['mycinema.library','mycinema.library.v','mycinema.deleted','mycinema.dismissed','mycinema.dismissedClearedAt','mycinema.actorAdjustments','mycinema.actorAdjustTs','mycinema.search_history','kingOfTheHillHistory','mycinema.recs.v5','mycinema.home.general.v7','mycinema.metaCache.v2','mycinema.colCache.v1','mycinema.appearance.ts','mycinema.splashPool.v1','mycinema.factDismissedDate','onboardingDone','mycinema.librarySort','mycinema.home.tab','mycinema.home.mode','mycinema.activeTab','mycinema.activityLog.v1','mycinema.releaseCache.v1','mycinema.streamPrefs.v1','mycinema.streamResume.v1']; /* FIX-PERSIST-KEYS */ // Marvel Studios (420), Marvel Television (38679) // Marvel Studios (420), Marvel Television (38679)

// ============ MOODS ============
/* FIX-MOOD-WEIGHT-CFG
   weight — наскільки сильно настрій впливає на рекомендації.
   1.0 = нейтрально. 1.5 = сильно тягне вгору. 0.5 = слабкий біас.
   Зміна weight інвалідовує кеш (потрібен reload + клік mood-pill). */
const MOODS = {
  chill:      { label: 'Спокій',  emoji: '🌊', genres: [35, 10749, 16], tvGenres: [35, 16, 18], weight: 3.0 },
  intense:    { label: 'Напруга', emoji: '⚡', genres: [53, 80, 28], tvGenres: [80, 9648, 10768], weight: 3.0 },
  thoughtful: { label: 'Роздуми', emoji: '🕯️', genres: [18, 99, 9648], tvGenres: [18, 99, 9648], weight: 3.0 },
  fun:        { label: 'Розвага', emoji: '🎈', genres: [12, 35, 16], tvGenres: [35, 16, 10751, 10762], weight: 3.0 },
  dark:       { label: 'Похмуре', emoji: '🌑', genres: [80, 27, 53], tvGenres: [80, 9648, 18], weight: 3.0 },
  epic:       { label: 'Епічне',  emoji: '🌋', genres: [12, 14, 10752], tvGenres: [10765, 10768, 18], weight: 3.0 } /* FIX-MOOD-WEIGHT-23 */
};

// ============ STREAMING ============
const STREAMING_PROVIDERS = [
  { id: 8, name: 'Netflix' }, { id: 1899, name: 'Max / HBO' }, { id: 9, name: 'Prime Video' },
  { id: 350, name: 'Apple TV+' }, { id: 15, name: 'Hulu' }, { id: 386, name: 'Peacock' }, { id: 29, name: 'Sky' }
];

// ============ RATING CRITERIA ============
const RATING_CRITERIA = [
  { key: 'plot', label: 'Сюжет' }, { key: 'cast', label: 'Персонажі' },
  { key: 'style', label: 'Візуал' }, { key: 'emotions', label: 'Емоції' },
  { key: 'overall', label: 'Враження' }
];

// ============ GENRES ============
const GENRES = [
  { id: 28, name: 'Бойовик' }, { id: 12, name: 'Пригоди' }, { id: 16, name: 'Анімація' },
  { id: 35, name: 'Комедія' }, { id: 80, name: 'Кримінал' }, { id: 99, name: 'Документальне' },
  { id: 18, name: 'Драма' }, { id: 10751, name: 'Сімейне' }, { id: 14, name: 'Фентезі' },
  { id: 36, name: 'Історія' }, { id: 27, name: 'Жахи' }, { id: 10402, name: 'Музика' },
  { id: 9648, name: 'Детектив' }, { id: 10749, name: 'Романтика' }, { id: 878, name: 'Фантастика' },
  { id: 53, name: 'Трилер' }, { id: 10752, name: 'Війна' }, { id: 37, name: 'Вестерн' }
];

// ============ PLACEHOLDERS ============
const PLACEHOLDERS = [
  'Від чого кайфонем сьогодні?', 'Що дивимось сьогодні?', 'Знайди свій наступний улюблений фільм',
  'Серіал на вечір?', 'Шукаєш щось конкретне?', 'Ну що, кіно?',
  'Який настрій сьогодні?', 'Знайти щось нове?', 'Твій наступний улюблений серіал?',
  'Хочу щось атмосферне…', 'Що глянемо на вихідних?'
];

// ============ THEMES ============
const THEMES = {
  navy:  { name: 'Navy',  bg0:'#08070a', bg1:'#0f0e13', bg2:'#16141b', bg3:'#201d28', bg4:'#2a2635', sidebar:'#06050a', query:'#040308', text:'#f2eee9', textSecondary:'#cfc8c0', textMuted:'#8d877f', textDim:'#575349' },
  black: { name: 'Black', bg0:'#000000', bg1:'#0a0a0a', bg2:'#141414', bg3:'#1e1e1e', bg4:'#2a2a2a', sidebar:'#050505', query:'#000000', text:'#f0f0f0', textSecondary:'#c0c0c0', textMuted:'#888', textDim:'#444' },
  plum:  { name: 'Plum',  bg0:'#0c0512', bg1:'#150a20', bg2:'#1f0e2f', bg3:'#301848', bg4:'#422458', sidebar:'#0a0410', query:'#070310', text:'#f0e8f5', textSecondary:'#d8cfe6', textMuted:'#9a8fb5', textDim:'#5a4f7a' },
  forest:{ name: 'Forest', bg0:'#030b06', bg1:'#0a1510', bg2:'#0f2018', bg3:'#183020', bg4:'#22432f', sidebar:'#050d08', query:'#020705', text:'#e8f2ec', textSecondary:'#cfe6d8', textMuted:'#8fb5a0', textDim:'#4f7a5a' },
  mocha: { name: 'Mocha', bg0:'#0b0805', bg1:'#150f0a', bg2:'#1f1710', bg3:'#2f2618', bg4:'#403522', sidebar:'#0a0705', query:'#060403', text:'#f2ebe0', textSecondary:'#e6d8c7', textMuted:'#b5a08f', textDim:'#7a5f4a' },
  /* FIX-THEMES-2 — Ocean, Wine */
  ocean: { name: 'Ocean', bg0:'#050a14', bg1:'#0a1320', bg2:'#0f1c2e', bg3:'#182a42', bg4:'#223a56', sidebar:'#040810', query:'#03060c', text:'#e6eef8', textSecondary:'#c5d5e8', textMuted:'#7a8fa8', textDim:'#4a5a70' },
  wine:  { name: 'Wine',  bg0:'#0a0508', bg1:'#14080f', bg2:'#1e0c18', bg3:'#2e1426', bg4:'#421e35', sidebar:'#080407', query:'#050203', text:'#f5e8ee', textSecondary:'#e6c8d8', textMuted:'#a88098', textDim:'#704a62' }
};

// ============ ACCENTS ============
const ACCENTS = {
  amber:  { name: 'Amber',  accent:'#ffb86c', hover:'#ffc98a', fg:'#1a1207' },
  lime:   { name: 'Lime',   accent:'#c6f432', hover:'#d6ff42', fg:'#111' },
  cyan:   { name: 'Cyan',   accent:'#22d3ee', hover:'#3ddcf5', fg:'#0a1a1e' },
  coral:  { name: 'Coral',  accent:'#ff7b5c', hover:'#ff9578', fg:'#1a0703' },
  violet: { name: 'Violet', accent:'#c5a3ff', hover:'#d4b8ff', fg:'#1a0a3a' },
  emerald:{ name: 'Emerald',accent:'#10b981', hover:'#22c997', fg:'#ffffff' },
  rose:   { name: 'Rose',   accent:'#ff6b9d', hover:'#ff85ad', fg:'#2a0520' }
};
````

---

## 3. `src/recs-math.js`

Чиста математика: PRIORS, WR, recPriorsFor, recBalanceBonus, recGemBonus, recBaseScore, recRankScore

````js
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
````

---

## 4. `src/imdb-ratings.js`

IMDb-шар: /imdb/batch, 7денний кеш, imdbLoadFor, imdbRef (IMDb→TMDB fallback)

````js
'use strict';

// ════════════════════════════════════════════════════════════════
// Клієнтська частина IMDb-рейтингів.
// TMDB лишається каталогом; тут ми лише зв'язуємо tmdb_id → IMDb
// rating/votes через воркер POST /imdb/batch і кешуємо на 7 днів.
//
// НЕ підключено до математики рекомендацій — поки що тільки база.
// ════════════════════════════════════════════════════════════════

const IMDB_CACHE_KEY = 'mycinema.imdbRatings.v1';
const IMDB_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 днів
const IMDB_CACHE_MAX = 3000;                    // стеля записів у кеші
const IMDB_SEND_MAX = 400;                      // стеля ID на тип за запит

function imdbType(t) {
  return (t === 'tv' || t === 'show' || t === 'series') ? 'tv' : 'movie';
}

function imdbParseId(v) {
  if (v == null) return 0;
  const n = (typeof v === 'number') ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function imdbKey(type, id) {
  return imdbType(type) + ':' + String(imdbParseId(id));
}

function imdbReadCache() {
  const raw = (typeof mcCacheGet === 'function')
    ? mcCacheGet(IMDB_CACHE_KEY, {})
    : (() => { try { return JSON.parse(localStorage.getItem(IMDB_CACHE_KEY)) || {}; } catch { return {}; } })();
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

function imdbWriteCache(cache) {
  try {
    const entries = Object.entries(cache);
    if (entries.length > IMDB_CACHE_MAX) {
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      cache = Object.fromEntries(entries.slice(0, IMDB_CACHE_MAX));
    }
    if (typeof mcCacheSet === 'function') mcCacheSet(IMDB_CACHE_KEY, cache);
    else localStorage.setItem(IMDB_CACHE_KEY, JSON.stringify(cache));
  } catch (_) { /* кеш не критичний */ }
}

/** Синхронний lookup. Повертає entry або null, якщо даних немає/прострочені. */
function imdbLookup(type, id) {
  const key = imdbKey(type, id);
  if (!key || key.endsWith(':0')) return null;
  const entry = imdbReadCache()[key];
  if (!entry || !(Number(entry.imdbRating) > 0)) return null;
  if (Date.now() - (entry.ts || 0) > IMDB_CACHE_TTL) return null;
  return entry;
}

function imdbStore(data, want) {
  if (!data || typeof data !== 'object') return 0;
  const cache = imdbReadCache();
  const now = Date.now();
  let added = 0;
  for (const [type, bucket] of [['movie', data.movie], ['tv', data.tv]]) {
    if (!bucket || typeof bucket !== 'object') continue;
    // Кешуємо лише те, що справді просили — зайві ID з відповіді не цікаві.
    const allowed = want && want[type] ? new Set(want[type].map(String)) : null;
    for (const [id, val] of Object.entries(bucket)) {
      if (!val || !(Number(val.imdbRating) > 0)) continue;
      if (allowed && !allowed.has(String(id))) continue;
      const key = imdbKey(type, id);
      if (key.endsWith(':0')) continue;
      cache[key] = {
        imdbId: val.imdbId || null,
        imdbRating: Number(val.imdbRating),
        imdbVotes: Math.max(0, Number(val.imdbVotes) || 0),
        ts: now,
      };
      added++;
    }
  }
  if (added) imdbWriteCache(cache);
  return added;
}

function imdbCleanIds(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const id = imdbParseId(v);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
    if (out.length >= IMDB_SEND_MAX) break;
  }
  return out;
}

/** Пакетний виклик воркера. Ніколи не кидає — повертає ok:false при будь-якій помилці. */
async function imdbFetchBatch(movies, tv) {
  const body = { movies: imdbCleanIds(movies), tv: imdbCleanIds(tv) };
  if (!body.movies.length && !body.tv.length) {
    return { ok: false, error: 'no ids', data: { movie: {}, tv: {} }, missing: body, errors: [] };
  }
  try {
    const base = (typeof PROXY_URL === 'string' && PROXY_URL) ? PROXY_URL.replace(/\/$/, '') : '';
    const res = await fetch(base + '/imdb/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
    const j = await res.json();
    if (!j || typeof j !== 'object') throw new Error('bad response');
    return {
      ok: j.ok !== false,
      data: (j.data && typeof j.data === 'object') ? j.data : { movie: {}, tv: {} },
      missing: j.missing || { movie: [], tv: [] },
      errors: Array.isArray(j.errors) ? j.errors : [],
      meta: j.meta || null,
      error: j.error || null,
    };
  } catch (e) {
    return {
      ok: false,
      error: String((e && e.message) || e),
      data: { movie: {}, tv: {} },
      missing: body,
      errors: [],
      meta: null,
    };
  }
}

/**
 * Головний вхід: підтягує IMDb для перелічених tmdb_id, використовуючи
 * локальний кеш. При ok:false (квота/мережа/воркер) повертає лише те,
 * що вже є в кеші, і fallback:true — викликач має впасти на TMDB.
 */
async function imdbLoadFor(movies, tv) {
  const want = { movie: imdbCleanIds(movies), tv: imdbCleanIds(tv) };
  const todo = { movie: [], tv: [] };
  const data = {};

  for (const type of ['movie', 'tv']) {
    for (const id of want[type]) {
      const hit = imdbLookup(type, id);
      if (hit) data[imdbKey(type, id)] = hit;
      else todo[type].push(id);
    }
  }

  if (!todo.movie.length && !todo.tv.length) {
    return { ok: true, fallback: false, data, missing: { movie: [], tv: [] }, errors: [], fetched: 0 };
  }

  const res = await imdbFetchBatch(todo.movie, todo.tv);
  const fetched = imdbStore(res.data, want);

  return {
    ok: res.ok,
    fallback: !res.ok,
    data,
    raw: res.data,
    missing: res.missing,
    errors: res.errors,
    meta: res.meta,
    error: res.error,
    fetched,
    requested: want,
    todo,
  };
}

/**
 * Уніфіковане джерело рейтингу для математики (пізніше):
 * IMDb якщо є, інакше TMDB — з явним полем source.
 */
function imdbRef(item) {
  if (!item || typeof item !== 'object') {
    return { rating: 0, votes: 0, imdbId: null, source: 'none' };
  }
  const type = imdbType(item.type || item.media_type || (item.name && !item.title ? 'tv' : 'movie'));
  const id = imdbParseId(item.id != null ? item.id : item.tmdbId);
  const hit = id ? imdbLookup(type, id) : null;
  if (hit && Number(hit.imdbRating) > 0) {
    return {
      rating: Number(hit.imdbRating),
      votes: Number(hit.imdbVotes) || 0,
      imdbId: hit.imdbId || null,
      source: 'imdb',
    };
  }
  const imdbRating = Number(item.imdbRating) || 0;
  if (imdbRating > 0) {
    return {
      rating: imdbRating,
      votes: Number(item.imdbVotes) || Number(item.votes) || 0,
      imdbId: item.imdbId || null,
      source: 'imdb',
    };
  }
  return {
    rating: Number(item.tmdbRating) || 0,
    votes: Number(item.votes) || 0,
    imdbId: item.imdbId || null,
    source: 'tmdb',
  };
}

function imdbClearCache() {
  try {
    if (typeof mcCacheDel === 'function') mcCacheDel(IMDB_CACHE_KEY);
    else localStorage.removeItem(IMDB_CACHE_KEY);
  } catch (_) {}
}

// Публічний API (classic script + зручно для тестів)
window.IMDB_CACHE_TTL = IMDB_CACHE_TTL;
window.imdbType = imdbType;
window.imdbKey = imdbKey;
window.imdbLookup = imdbLookup;
window.imdbFetchBatch = imdbFetchBatch;
window.imdbLoadFor = imdbLoadFor;
window.imdbRef = imdbRef;
window.imdbClearCache = imdbClearCache;
````

---

## 5. `src/api.js`

tmdbFetch + normalizeItem — каталог TMDB і нормалізація кандидатів

````js
'use strict';

/* TMDB_FETCH_TIMEOUT */
function tmdbFetch(path, timeoutMs = 8500) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const tmr = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  return fetch(PROXY_URL + path, ctrl ? { signal: ctrl.signal } : {})
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => { if (tmr) clearTimeout(tmr); });
}

function normalizeItem(r) {
  const type = r.media_type || (r.first_air_date ? 'tv' : 'movie');
  return {
    key: type + '-' + r.id, id: r.id, type,
    title: r.title || r.name, year: (r.release_date || r.first_air_date || '').slice(0, 4),
    releaseDate: r.release_date || r.first_air_date || '',
    poster: r.poster_path, 
    backdrop: r.backdrop_path, // <--- ДОДАЙ ЦЕ
    overview: r.overview || '', tmdbRating: r.vote_average || 0,
    votes: r.vote_count || 0, popularity: r.popularity || 0,
    genres: r.genre_ids || (r.genres ? r.genres.map(g => g.id) : [])
  };
}

function findAllTrailers(videos, originalLang) {
  const list = (videos?.results || []).filter(v => v.site === 'YouTube' && v.key && (v.type === 'Trailer' || v.type === 'Teaser'));
  const langRank = v => v.iso_639_1 === 'uk' ? 0 : (v.iso_639_1 === originalLang ? 1 : (v.iso_639_1 === 'en' ? 2 : 3));
  const typeRank = v => v.type === 'Trailer' ? 0 : 1;
  const seen = new Set();
  return list.sort((a, b) =>
      typeRank(a) - typeRank(b) || langRank(a) - langRank(b) ||
      (b.official ? 1 : 0) - (a.official ? 1 : 0) || new Date(b.published_at) - new Date(a.published_at))
    .filter(v => { if (seen.has(v.key)) return false; seen.add(v.key); return true; }).slice(0, 5);
}

function trailerLabel(t) {
  const lang = t.iso_639_1 === 'uk' ? 'UA' : (t.iso_639_1 ? t.iso_639_1.toUpperCase() : '—');
  return (t.type === 'Teaser' ? 'Тізер' : 'Трейлер') + ' · ' + lang;
}

// ============ WIKIDATA / WIKIPEDIA ============
const _wikiSitelinksCache = new Map();
const _wikiMediaCache = new Map();
const _WIKI_CACHE_MAX = 500; /* FIX-WIKI-LRU-DECL */
function _lruTrimWiki(map) {
  while (map.size > _WIKI_CACHE_MAX) {
    const fk = map.keys().next().value;
    map.delete(fk);
  }
}

function fetchJsonTimeout(url, ms = 2500) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  return fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => { if (timer) clearTimeout(timer); });
}

async function fetchWikiSitelinks(wikidataId) {
  if (!wikidataId) return null;
  if (_wikiSitelinksCache.has(wikidataId)) return _wikiSitelinksCache.get(wikidataId);
  try {
    // [WIKI-API-FIX] URLSearchParams для коректного кодування |
    const wdParams = new URLSearchParams({
      action: 'wbgetentities', ids: wikidataId, props: 'sitelinks',
      sitefilter: 'ukwiki|enwiki', format: 'json', origin: '*'
    });
    const wdUrl = `https://www.wikidata.org/w/api.php?${wdParams.toString()}`;
    const wd = await fetchJsonTimeout(wdUrl, 3000);
    const links = wd?.entities?.[wikidataId]?.sitelinks || null;
    if (links) { _wikiSitelinksCache.set(wikidataId, links); _lruTrimWiki(_wikiSitelinksCache); } /* FIX-WIKI-LRU-SET-1 */
    return links;
  } catch {
    return null;
  }
}

function extractWikiOverviewFromText(extract) {
  if (!extract || !extract.trim()) return '';
  const re = /^==\s*([^=\n]+?)\s*==$/gm;
  const sections = [];
  let lastIdx = 0;
  let lastTitle = '__lead__';
  let m;
  while ((m = re.exec(extract)) !== null) {
    sections.push({ title: lastTitle, body: extract.slice(lastIdx, m.index).trim() });
    lastTitle = m[1].trim();
    lastIdx = re.lastIndex;
  }
  sections.push({ title: lastTitle, body: extract.slice(lastIdx).trim() });

  const cleanBody = (txt) => txt
    .replace(/^===\s*([^=\n]+?)\s*===$/gm, '$1:')
    .replace(/^====\s*([^=\n]+?)\s*====$/gm, '$1:')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const pickByNames = (names) => {
    for (const sec of sections) {
      const low = sec.title.toLowerCase();
      if (names.some(n => low === n || low.startsWith(n + ' '))) {
        const cleaned = cleanBody(sec.body);
        if (cleaned.length >= 60) return cleaned;
      }
    }
    return '';
  };

  const lead = cleanBody((sections.find(s => s.title === '__lead__') || {}).body || '');
  const synopsis = pickByNames([
    'синопсис', 'короткий зміст', 'опис', 'про фільм',
    'про серіал', 'фабула', 'передісторія', 'передумова', 'концепція'
  ]);
  if (synopsis) return synopsis;

  const plot = pickByNames(['сюжет', 'опис сюжету', 'сюжетна лінія']);
  if (plot) return plot;

  return lead.length >= 60 ? lead : '';
}

async function fetchWikiMediaDescription(wikidataId) {
  if (!wikidataId) return null;
  if (_wikiMediaCache.has(wikidataId)) return _wikiMediaCache.get(wikidataId);
  try {
    const links = await fetchWikiSitelinks(wikidataId);
    const ukTitle = links?.ukwiki?.title;
    if (!ukTitle) { _wikiMediaCache.set(wikidataId, null); return null; }

    const apiUrl = `https://uk.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(ukTitle)}&prop=extracts|info&inprop=url&explaintext=1&exsectionformat=wiki&format=json&origin=*`;
    const data = await fetchJsonTimeout(apiUrl, 2500);
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    const text = extractWikiOverviewFromText(page?.extract || '');
    if (!text) { _wikiMediaCache.set(wikidataId, null); return null; }

    const url = page?.fullurl || ('https://uk.wikipedia.org/wiki/' + encodeURIComponent(ukTitle.replace(/ /g, '_')));
    const res = { text, url };
    _wikiMediaCache.set(wikidataId, res);
    _lruTrimWiki(_wikiMediaCache); /* FIX-WIKI-LRU-SET-2 */
    return res;
  } catch {
    return null;
  }
}
````

---

## 6. `src/core.js`

computeItemRating, computeTasteVector, computeActorProfiles, globalRefAvg (gT), затухання смаку

````js
'use strict';

// ============ INDEXEDDB CACHE LAYER ============
const _idbMem = new Map();
const _IDB_NAME = 'mycinema_cache_db';
const _IDB_STORE = 'kv';
const _IDB_KEYS = [
  typeof RECS_CACHE !== 'undefined' ? RECS_CACHE : 'mycinema.recs.v5',
  'mycinema.home.general.v7',
  'mycinema.metaCache.v2',
  'mycinema.colCache.v1',
  'mycinema.companyCache.v1',
  'mycinema.releaseCache.v1'
];
let _idbDbPromise = null;

function _openIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (_idbDbPromise) return _idbDbPromise;
  _idbDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(_IDB_STORE)) db.createObjectStore(_IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return _idbDbPromise;
}

function mcCacheGet(key, fallback) {
  if (typeof indexedDB === 'undefined') {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  if (_idbMem.has(key)) return _idbMem.get(key);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      _idbMem.set(key, parsed);
      return parsed;
    }
  } catch {}
  return fallback;
}

function mcCacheSet(key, val) {
  if (typeof indexedDB === 'undefined') {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    return;
  }
  _idbMem.set(key, val);
  try { localStorage.removeItem(key); } catch {}
  _openIdb().then(db => {
    if (!db) return;
    try {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).put(val, key);
    } catch {}
  });
}

function mcCacheDel(key) {
  _idbMem.delete(key);
  try { localStorage.removeItem(key); } catch {}
  if (typeof indexedDB === 'undefined') return;
  _openIdb().then(db => {
    if (!db) return;
    try {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).delete(key);
    } catch {}
  });
}

window.mcCacheReady = (function initIdbCache() {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return _openIdb().then(db => {
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(_IDB_STORE, 'readwrite');
        const store = tx.objectStore(_IDB_STORE);
        _IDB_KEYS.forEach(k => {
          const req = store.get(k);
          req.onsuccess = () => {
            if (req.result !== undefined) {
              if (!_idbMem.has(k)) _idbMem.set(k, req.result);
              try { localStorage.removeItem(k); } catch {}
            } else {
              try {
                const raw = localStorage.getItem(k);
                if (raw) {
                  const parsed = JSON.parse(raw);
                  _idbMem.set(k, parsed);
                  store.put(parsed, k);
                  localStorage.removeItem(k);
                }
              } catch {}
            }
          };
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  });
})();

// ============ SETTINGS ============
const settings = {
  themeBg: localStorage.getItem('mycinema.theme.bg') || 'navy',
  themeAccent: localStorage.getItem('mycinema.theme.accent') || 'amber',
  posterBg: localStorage.getItem('mycinema.posterBg') === 'true',
  /* FIX-RELEASE-SETTINGS */
  digitalOnly: localStorage.getItem('mycinema.digitalOnly') !== 'false',       // default true
  streamingOnlyUA: localStorage.getItem('mycinema.streamingOnlyUA') === 'true', // default false
  showStatusBadges: localStorage.getItem('mycinema.showStatusBadges') !== 'false', // FIX-STATUS-TOGGLE
  enableStreams: localStorage.getItem('mycinema.enableStreams') !== 'false'
};

/* FIX-RELEASE-HELPERS — спільні для card.js і home.js */
function extractDigitalDate(d) {
  const results = (d && d.release_dates && d.release_dates.results) || [];
  const regions = ['UA', 'US', 'GB', 'PL'];
  for (let i = 0; i < regions.length; i++) {
    const reg = results.find(x => x.iso_3166_1 === regions[i]);
    const dig = reg && reg.release_dates && reg.release_dates.find(x => x.type === 4 && x.release_date);
    if (dig) return dig.release_date.slice(0, 10);
  }
  return null;
}
function extractProvidersUA(d) {
  const wp = (d && d['watch/providers'] && d['watch/providers'].results) || {};
  const ua = (wp.UA && wp.UA.flatrate) || [];
  return ua.map(p => {
    const info = typeof normalizePlatformInfo === 'function'
      ? normalizePlatformInfo({ name: p.provider_name, logo_path: p.logo_path })
      : null;
    if (typeof normalizePlatformInfo === 'function' && !info) return null;
    return {
      key: info ? info.key : p.provider_name,
      name: info ? info.name : p.provider_name,
      logo: (info && info.logo) || p.logo_path || null
    };
  }).filter(Boolean);
}

// ============ STATE ============
let lib = load();
/* FIX-HOIST */
let _dirtyItems = new Set();
let _saveTimer = null;
let actorAdjust = (() => { try { return JSON.parse(localStorage.getItem(ACTOR_ADJUST_KEY)) || {}; } catch { return {}; } })();
const VALID_TABS = new Set(['home', 'watching', 'watched', 'planned', 'dropped', 'favorites', 'notes', 'top', 'calendar', 'activity', 'statistics', 'game']);
let _savedTab = 'home';
try {
  const t = localStorage.getItem('mycinema.activeTab');
  if (t && VALID_TABS.has(t)) _savedTab = t;
} catch {}
let state = {
  tab: _savedTab, typeFilter: 'all', topTypeFilter: 'all',
  filter: { query: '', type: 'all', decade: 'any', genre: 'any', minRating: 0, sortBy: 'popularity.desc', streaming: null },
  home: { 
    loading: false, 
    recs: null, 
    sig: null, 
    shown: { movie: 14, tv: 14 }, /* FIX-SHOWN-14-INIT */ // <--- ДОДАНО ОСЬ ЦЕ
    tab: localStorage.getItem('mycinema.home.tab') || 'movie', /* FIX-TAB-PERSIST */ 
    general: null, 
    mood: null, 
    mode: localStorage.getItem('mycinema.home.mode') || 'balance', /* FIX-MODE-PERSIST */
    tasteExpanded: false 
  },
  game: { active: false, type: 'movie', round: 0, totalRounds: 20, champion: null, challenger: null, history: [], finished: false, pool: [], seen: new Set(), usedPages: new Set() },
  stats: { tab: 'taste', actorTab: 'rating', castLoading: false, castProgress: { done: 0, total: 0 } },
  librarySearch: '', librarySort: localStorage.getItem('mycinema.librarySort') || 'updated', /* FIX-SORT-PERSIST */
  calendarMonth: null, calendarStatus: 'all',
  activityFilter: 'all', activitySort: 'newest'
};
let cardStack = [];
let filterPage = 1;
let filterLoading = false;

// ============ DOM REFS ============
const input = document.getElementById("q");
const box = document.getElementById("results");
const overlay = document.getElementById("overlay");
const card = document.getElementById("card");
const autocomplete = document.getElementById("autocomplete");
const typeFilterBar = document.getElementById("type-filter");
const syncIndicator = document.getElementById('sync-indicator');

// ============ UTILS ============
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function clampNum(v, min, max) { return Math.max(min, Math.min(max, v)); }
function fmtNum(n) { return n.toFixed(1).replace('.', ','); }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function ratingClass(avg) { return avg >= 8 ? 'green' : (avg >= 6 ? 'yellow' : 'red'); }

// [ESCAPE-HTML] Безпечне екранування для вставок у HTML
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ============ RATINGS ============
function computeAverage(ratings) {
  if (!ratings) return 0;
  const vals = RATING_CRITERIA.map(c => ratings[c.key] || 0).filter(v => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
function countFilled(ratings) { return ratings ? RATING_CRITERIA.filter(c => ratings[c.key] > 0).length : 0; }
function computeItemRating(item) {
  if (!item) return { avg: 0, complete: false, rated: 0, total: 0 };
  if (item.type === 'tv') {
    const sr = item.seasonRatings || {};
    const ratedKeys = Object.keys(sr).filter(k => computeAverage(sr[k]) > 0);
    const total = item.totalSeasons || ratedKeys.length || 0;
    if (!ratedKeys.length) return { avg: 0, complete: false, rated: 0, total };
    const avgs = ratedKeys.map(k => computeAverage(sr[k]));
    return { avg: avgs.reduce((a, b) => a + b, 0) / avgs.length, complete: total > 0 && ratedKeys.length >= total, rated: ratedKeys.length, total };
  }
  const avg = computeAverage(item.ratings);
  return { avg, complete: avg > 0, rated: avg > 0 ? 1 : 0, total: 1 };
}
function hasWatched(item) {
  if (!item) return false;
  if (item.status === 'watched' || item.status === 'watching') return true;
  if (item.ratings && Object.values(item.ratings).some(v => v > 0)) return true;
  if (item.seasonRatings && Object.keys(item.seasonRatings).length > 0) return true;
  if (item.watchedEpisodes && item.watchedEpisodes.length > 0) return true;
  return false;
}
function isTrackedInLib(keyOrItem) {
  const item = typeof keyOrItem === 'string' ? lib[keyOrItem] : keyOrItem;
  if (!item) return false;
  if (item.status || item.favorite || hasWatched(item)) return true;
  if ((item.notes && item.notes.trim()) || (item.notesHistory && item.notesHistory.length > 0)) return true;
  return false;
}
function tasteDecay(updated, halfLifeDays) {
  const days = Math.max(0, (Date.now() - (updated || Date.now())) / (24 * 60 * 60 * 1000));
  const hl = halfLifeDays || (typeof TASTE_HALFLIFE_DAYS !== 'undefined' ? TASTE_HALFLIFE_DAYS : 180);
  return Math.pow(0.5, days / hl);
}
function averagedSeasonRatings(item) {
  const sr = item.seasonRatings || {};
  const keys = Object.keys(sr).filter(k => Object.keys(sr[k] || {}).length > 0);
  if (!keys.length) return item.ratings || {};
  const sums = {}, counts = {};
  for (const k of keys) for (const crit of RATING_CRITERIA) {
    if (sr[k][crit.key]) { sums[crit.key] = (sums[crit.key] || 0) + sr[k][crit.key]; counts[crit.key] = (counts[crit.key] || 0) + 1; }
  }
  const r = {};
  for (const crit of RATING_CRITERIA) r[crit.key] = counts[crit.key] ? sums[crit.key] / counts[crit.key] : 0;
  return r;
}
function computeTasteVector() {
  const rated = Object.values(lib).map(x => ({ item: x, r: computeItemRating(x) })).filter(x => x.r.avg > 0);
  if (!rated.length) return null;
  const sums = {}, weights = {};
  for (const crit of RATING_CRITERIA) { sums[crit.key] = 0; weights[crit.key] = 0; }
  for (const { item } of rated) {
    const w = tasteDecay(item.updated);
    const rr = item.type === 'tv' ? averagedSeasonRatings(item) : (item.ratings || {});
    for (const crit of RATING_CRITERIA) if (rr[crit.key]) { sums[crit.key] += rr[crit.key] * w; weights[crit.key] += w; }
  }
  const result = { count: rated.length, movieCount: rated.filter(x => x.item.type === 'movie').length, tvCount: rated.filter(x => x.item.type === 'tv').length };
  for (const crit of RATING_CRITERIA) result[crit.key] = weights[crit.key] > 0 ? sums[crit.key] / weights[crit.key] : 0;
  return result;
}

function getItemCastRating(item) {
  if (!item) return 0;
  if (item.type === 'tv') {
    const sr = item.seasonRatings || {};
    const vals = Object.values(sr).map(s => (s && s.cast) || 0).filter(v => v > 0);
    if (vals.length) return vals.reduce((a, b) => a + b, 0) / vals.length;
    return (item.ratings && item.ratings.cast) || 0;
  }
  return (item.ratings && item.ratings.cast) || 0;
}

function getItemFranchiseKey(item) {
  if (!item) return null;
  if (item.franchiseKey) return item.franchiseKey;
  if (item.type === 'movie' && item.collection?.id) return 'col-' + item.collection.id;
  return null;
}

function computeActorProfiles() {
  const items = Object.values(lib);

  // IMDb як джерело залишку; якщо даних немає — tmdbRating (timely fallback).
  const refOf = (item) => (typeof imdbRef === 'function')
    ? imdbRef(item).rating
    : (Number(item && item.tmdbRating) || 0);

  const ratedCastItems = items
    .map(item => ({ item, castRating: getItemCastRating(item), refRating: refOf(item) }))
    .filter(x => x.castRating > 0);

  // Історичне середнє критерію «Персонажі і каст»
  const globalCastAvg = ratedCastItems.length
    ? ratedCastItems.reduce((s, x) => s + x.castRating, 0) / ratedCastItems.length
    : 7.2;

  // gT тепер перераховується на IMDb-базі (інакше серіали з їхнім
  // завищеним IMDb викривили б recSignal).
  const refPairs = ratedCastItems.filter(x => x.refRating > 0);
  const globalRefAvg = refPairs.length
    ? refPairs.reduce((s, x) => s + x.refRating, 0) / refPairs.length
    : 6.9;

  const G = globalCastAvg;
  const hitTagDelta = Math.max(0.4, Math.min(0.8, (10 - G) * 0.55));
  const hiScale = Math.max(0.8, Math.min(1.3, 10 - G));

  const actorMap = new Map();
  items.forEach(item => {
    const castRating = getItemCastRating(item);
    const watched = hasWatched(item);
    if (castRating <= 0 && !watched) return;

    const fKey = getItemFranchiseKey(item);
    (item.cast || []).forEach((a, idx) => {
      if (!a || !a.id) return;
      if (!actorMap.has(a.id)) {
        actorMap.set(a.id, {
          id: a.id,
          name: a.name,
          profile_path: a.profile_path || null,
          watchedCount: 0,
          ratedEntries: []
        });
      }
      const entry = actorMap.get(a.id);
      if (!entry.profile_path && a.profile_path) entry.profile_path = a.profile_path;
      if (watched) entry.watchedCount++;
      if (castRating > 0) {
        entry.ratedEntries.push({ item, castRating, idx, fKey });
      }
    });
  });

  const actors = new Map();
  for (const a of actorMap.values()) {
    const rated = a.ratedEntries;
    const adj = typeof getActorAdj === 'function' ? getActorAdj(a.id) : 0;

    if (!rated.length) {
      actors.set(a.id, {
        id: a.id,
        name: a.name,
        profile_path: a.profile_path,
        watchedCount: a.watchedCount,
        ratedCount: 0,
        effCount: 0,
        rawAvg: 0,
        shrunk: 0,
        score: 0,
        leadCount: 0,
        hitCount: 0,
        missCount: 0,
        isAnti: adj < 0,
        adj,
        recSignal: adj > 0 ? adj * 0.45 : (adj < 0 ? adj * 0.85 : 0)
      });
      continue;
    }

    // Сильніша/головніша частина кожної франшизи = 1.0, далі 0.45 -> 0.25 -> 0.15
    const sorted = [...rated].sort((x, y) => {
      const lx = x.idx <= ACTOR_LEAD_MAX_INDEX ? 1 : 0;
      const ly = y.idx <= ACTOR_LEAD_MAX_INDEX ? 1 : 0;
      return (ly - lx) || (y.castRating - x.castRating) || (parseInt(x.item.year || '9999') - parseInt(y.item.year || '9999'));
    });

    const frSeen = {};
    const frEff = {};
    const frRaw = {};

    let sumW = 0;
    let sumWC = 0;
    let effCount = 0;
    let leadCount = 0;
    let leadGoodW = 0;
    let hitCount = 0;
    let hitW = 0;
    let missCount = 0;
    let penWeightedSum = 0;
    let sumRecW = 0;
    let sumRecRes = 0;

    for (const r of sorted) {
      const roleW = r.idx <= ACTOR_LEAD_MAX_INDEX ? 1.35 : (r.idx <= 6 ? 0.90 : 0.55);
      let fw = 1.0;
      if (r.fKey) {
        const k = frSeen[r.fKey] || 0;
        frSeen[r.fKey] = k + 1;
        fw = k === 0 ? 1.0 : (k === 1 ? 0.45 : (k === 2 ? 0.25 : 0.15));
        frEff[r.fKey] = (frEff[r.fKey] || 0) + fw;
        frRaw[r.fKey] = (frRaw[r.fKey] || 0) + 1;
      }

      const w = roleW * fw;
      const delta = r.castRating - G;

      sumW += w;
      sumWC += w * r.castRating;
      effCount += fw;

      if (r.idx <= ACTOR_LEAD_MAX_INDEX) {
        leadCount++;
        if (delta >= ACTOR_PENALTY_START) leadGoodW += w;
      }

      if (delta > 0.30) {
        const hitStr = clampNum((delta - 0.30) / hiScale, 0, 1);
        hitW += w * hitStr;
        if (delta >= hitTagDelta) hitCount++;
      }

      if (delta < ACTOR_PENALTY_START) {
        // Плавний % штраф: -0.85 -> 10%, -1.50 -> ~20%, кап 25%
        const projPen = Math.min(ACTOR_PENALTY_CAP, 0.10 * Math.pow((ACTOR_PENALTY_START - delta) / 0.50, 0.85));
        penWeightedSum += w * projPen;
        if (delta <= ACTOR_PENALTY_10_DELTA) missCount++;
      }

      const dec = tasteDecay(r.item.updated);
      const res = r.refRating > 0
        ? (r.castRating - G) - (r.refRating - globalRefAvg)
        : (r.castRating - G);
      sumRecW += w * dec;
      sumRecRes += w * dec * res;
    }

    const rawAvg = sumW > 0 ? sumWC / sumW : 0;
    const stabAvg = (effCount * rawAvg + 2.0 * G) / (effCount + 2.0);

    // Прогресія відносно бази 6 (тільки для Топу в Обсерваторії)
    let countMod = 0;
    if (effCount < ACTOR_REF_PROJECTS) {
      countMod = -2.20 * Math.pow((ACTOR_REF_PROJECTS - effCount) / (ACTOR_REF_PROJECTS - 1), 1.65);
    } else if (effCount > ACTOR_REF_PROJECTS) {
      const qualFactor = clampNum((rawAvg - (G - 0.6)) / 1.4, 0, 1);
      countMod = Math.min(0.40, 0.25 * Math.log(1 + (effCount - ACTOR_REF_PROJECTS) / ACTOR_REF_PROJECTS)) * qualFactor;
    }

    const leadBonusPct = 0.032 * (leadGoodW / (sumW + 2.0));
    const hitBonusPct = 0.055 * (hitW / (sumW + 2.0));
    const avgPenPct = penWeightedSum / (sumW + 0.5);

    // Посилений штраф за концентрацію в одній франшизі (> 35%, до -9%)
    let maxFrEff = 0;
    let maxFrRaw = 0;
    for (const fk of Object.keys(frEff)) {
      if (frEff[fk] > maxFrEff) {
        maxFrEff = frEff[fk];
        maxFrRaw = frRaw[fk];
      }
    }
    const frShare = effCount > 0 ? maxFrEff / effCount : 0;
    const franchisePenaltyPct = (maxFrRaw >= 2 && frShare > 0.35)
      ? Math.min(ACTOR_FRANCHISE_CAP, ((frShare - 0.35) / 0.65) * ACTOR_FRANCHISE_CAP)
      : 0;

    // Спосіб 1: відсоткові модифікатори до стабілізованої бази
    const shrunkBase = stabAvg * (1 + leadBonusPct + hitBonusPct) * (1 - avgPenPct) * (1 - franchisePenaltyPct);
    const shrunk = shrunkBase + adj * ACTOR_ADJUST_STEP;

    const avgRes = sumRecW > 0 ? sumRecRes / sumRecW : 0;
    const adjRec = adj > 0 ? adj * 0.45 : (adj < 0 ? adj * 0.85 : 0);
    const recSignal = (shrunkBase - G) * 0.75 + clampNum(avgRes, -2.5, 2.5) * 0.35 + adjRec;

    // Для Топу акторів: з countMod та стелею rawAvg + 0.5 (+ ручний 🔥)
    const rawScore = shrunk + countMod;
    const scoreCap = rawAvg + 0.5 + (adj > 0 ? adj * ACTOR_ADJUST_STEP : 0);
    const score = clampNum(Math.min(scoreCap, rawScore), 1, 10);

    const isAnti = adj < 0 || (rated.length >= 2 && (rawAvg <= G - 1.35 || (missCount >= 3 && hitCount === 0)));

    actors.set(a.id, {
      id: a.id,
      name: a.name,
      profile_path: a.profile_path,
      watchedCount: a.watchedCount,
      ratedCount: rated.length,
      effCount,
      rawAvg,
      shrunk,
      score,
      leadCount,
      hitCount,
      missCount,
      isAnti,
      adj,
      recSignal
    });
  }

  return { globalCastAvg, globalRefAvg, globalTmdbAvg: globalRefAvg, actors };
}

function computeDirectorProfiles() {
  const DIR_REF_PROJECTS = 4;
  const items = Object.values(lib);
  const ratedItems = items.map(x => ({ item: x, avg: computeItemRating(x).avg })).filter(x => x.avg > 0);
  const G = ratedItems.length ? ratedItems.reduce((s, x) => s + x.avg, 0) / ratedItems.length : 7.2;
  const hitTagDelta = Math.max(0.4, Math.min(0.8, (10 - G) * 0.55));
  const hiScale = Math.max(0.8, Math.min(1.3, 10 - G));

  const dirMap = new Map();
  items.forEach(item => {
    if (!Array.isArray(item.directors) || !item.directors.length) return;
    const watched = hasWatched(item);
    const avg = computeItemRating(item).avg;
    if (!watched && avg <= 0) return;
    const fKey = getItemFranchiseKey(item);
    item.directors.forEach(d => {
      if (!d || !d.id) return;
      if (!dirMap.has(d.id)) {
        dirMap.set(d.id, { id: d.id, name: d.name, profile_path: d.profile_path || null, watchedCount: 0, rated: [] });
      }
      const e = dirMap.get(d.id);
      if (!e.profile_path && d.profile_path) e.profile_path = d.profile_path;
      if (watched) e.watchedCount++;
      if (avg > 0) e.rated.push({ item, avg, fKey });
    });
  });

  const out = [];
  for (const d of dirMap.values()) {
    const rated = d.rated;
    const n = rated.length;
    if (!n) {
      out.push({
        id: d.id, name: d.name, profile_path: d.profile_path,
        watchedCount: d.watchedCount, ratedCount: 0, effCount: 0,
        rawAvg: 0, score: 0, hitCount: 0, missCount: 0, bestItem: null, bestAvg: 0
      });
      continue;
    }

    const sorted = [...rated].sort((x, y) => (y.avg - x.avg) || (parseInt(x.item.year || '9999') - parseInt(y.item.year || '9999')));
    const frSeen = {}, frEff = {}, frRaw = {};
    let sumW = 0, sumWR = 0, effCount = 0, hitCount = 0, hitW = 0, missCount = 0, penWeightedSum = 0;

    for (const r of sorted) {
      let fw = 1.0;
      if (r.fKey) {
        const k = frSeen[r.fKey] || 0;
        frSeen[r.fKey] = k + 1;
        fw = k === 0 ? 1.0 : (k === 1 ? 0.45 : (k === 2 ? 0.25 : 0.15));
        frEff[r.fKey] = (frEff[r.fKey] || 0) + fw;
        frRaw[r.fKey] = (frRaw[r.fKey] || 0) + 1;
      }
      const delta = r.avg - G;
      sumW += fw;
      sumWR += fw * r.avg;
      effCount += fw;

      if (delta > 0.30) {
        hitW += fw * clampNum((delta - 0.30) / hiScale, 0, 1);
        if (delta >= hitTagDelta) hitCount++;
      }
      if (delta < -0.35) {
        const projPen = Math.min(0.22, 0.09 * Math.pow((-0.35 - delta) / 0.50, 0.85));
        penWeightedSum += fw * projPen;
        if (delta <= -0.85) missCount++;
      }
    }

    const rawAvg = sumW > 0 ? sumWR / sumW : 0;
    const stabAvg = (effCount * rawAvg + 1.5 * G) / (effCount + 1.5);

    let countMod = 0;
    if (effCount < DIR_REF_PROJECTS) {
      countMod = -0.85 * Math.pow((DIR_REF_PROJECTS - effCount) / (DIR_REF_PROJECTS - 1), 1.45);
    } else if (effCount > DIR_REF_PROJECTS) {
      const qualFactor = clampNum((rawAvg - (G - 0.6)) / 1.4, 0, 1);
      countMod = Math.min(0.35, 0.22 * Math.log(1 + (effCount - DIR_REF_PROJECTS) / DIR_REF_PROJECTS)) * qualFactor;
    }

    const hitBonusPct = 0.055 * (hitW / (sumW + 1.5));
    const avgPenPct = penWeightedSum / (sumW + 0.5);

    let maxFrEff = 0, maxFrRaw = 0;
    for (const fk of Object.keys(frEff)) {
      if (frEff[fk] > maxFrEff) { maxFrEff = frEff[fk]; maxFrRaw = frRaw[fk]; }
    }
    const frShare = effCount > 0 ? maxFrEff / effCount : 0;
    const franchisePenaltyPct = (maxFrRaw >= 3 && frShare > 0.50)
      ? Math.min(0.06, ((frShare - 0.50) / 0.50) * 0.06)
      : 0;

    const shrunk = stabAvg * (1 + hitBonusPct) * (1 - avgPenPct) * (1 - franchisePenaltyPct);
    const score = clampNum(Math.min(rawAvg + 0.45, shrunk + countMod), 1, 10);
    const best = sorted[0];

    out.push({
      id: d.id, name: d.name, profile_path: d.profile_path,
      watchedCount: d.watchedCount, ratedCount: n, effCount,
      rawAvg, score, hitCount, missCount,
      bestItem: best ? best.item : null, bestAvg: best ? best.avg : 0
    });
  }
  return { globalAvg: G, directors: out };
}

// ============ THEMES ============
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0,2), 16), parseInt(h.slice(2,4), 16), parseInt(h.slice(4,6), 16)].join(',');
}
function applyTheme(bgName, accentName) {
  if (!THEMES[bgName]) bgName = 'navy';
  if (!ACCENTS[accentName]) accentName = 'amber';
  const t = THEMES[bgName], a = ACCENTS[accentName];
  const r = document.documentElement.style;
  r.setProperty('--bg-0', t.bg0); r.setProperty('--bg-1', t.bg1); r.setProperty('--bg-2', t.bg2);
  r.setProperty('--bg-3', t.bg3); r.setProperty('--bg-4', t.bg4);
  r.setProperty('--bg-sidebar', t.sidebar); r.setProperty('--bg-query', t.query);
  r.setProperty('--text', t.text); r.setProperty('--text-secondary', t.textSecondary);
  r.setProperty('--text-muted', t.textMuted); r.setProperty('--text-dim', t.textDim);
  r.setProperty('--accent', a.accent); r.setProperty('--accent-hover', a.hover); r.setProperty('--accent-fg', a.fg);
  r.setProperty('--accent-rgb', hexToRgb(a.accent));
  settings.themeBg = bgName; settings.themeAccent = accentName;
  localStorage.setItem('mycinema.theme.bg', bgName);
  localStorage.setItem('mycinema.theme.accent', accentName);
}
applyTheme(settings.themeBg, settings.themeAccent);

// ============ ACTOR ADJUST ============
const ACTOR_ADJUST_TS_KEY = 'mycinema.actorAdjustTs';
let actorAdjustTs = (() => { try { return JSON.parse(localStorage.getItem(ACTOR_ADJUST_TS_KEY)) || {}; } catch { return {}; } })();
function saveActorAdjust() {
  try {
    localStorage.setItem(ACTOR_ADJUST_KEY, JSON.stringify(actorAdjust));
    localStorage.setItem(ACTOR_ADJUST_TS_KEY, JSON.stringify(actorAdjustTs));
  } catch {}
}
function getActorAdj(actorId) { return actorAdjust[actorId] || 0; }
function setActorAdj(actorId, val) {
  if (val === 0) delete actorAdjust[actorId];
  else actorAdjust[actorId] = val;
  actorAdjustTs[String(actorId)] = Date.now();
  saveActorAdjust();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}

// ============ STORAGE ============
function load() {
  let data;
  try { data = JSON.parse(localStorage.getItem(LS)) || {}; } catch { data = {}; }
  const version = parseInt(localStorage.getItem(LS_VER)) || 1;
  if (version < 2) {
    Object.values(data).forEach(item => {
      if (typeof item.rating === 'number' && item.rating > 0 && !item.ratings) item.ratings = { overall: item.rating };
      delete item.rating;
    });
    try { localStorage.setItem(LS, JSON.stringify(data)); localStorage.setItem(LS_VER, "2"); } catch {}
  }
  return data;
}
// ---- tombstones (видалені тайтли) ----
const LS_DEL = 'mycinema.deleted';
const TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000;
let libTombstones = (() => { try { return JSON.parse(localStorage.getItem(LS_DEL)) || {}; } catch { return {}; } })();

function evictHeavyCaches() {
  const legacy = ['mycinema.recs.v4', 'mycinema.home.general.v6', 'mycinema.metaCache.v1'];
  const expendable = [RECS_CACHE, 'mycinema.home.general.v7', 'mycinema.metaCache.v2', 'mycinema.companyCache.v1', 'mycinema.colCache.v1', 'mycinema.releaseCache.v1'];
  legacy.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  expendable.forEach(k => mcCacheDel(k));
}

function saveLocalOnly() {
  try {
    localStorage.setItem(LS, JSON.stringify(lib));
    localStorage.setItem(LS_DEL, JSON.stringify(libTombstones));
  } catch (e) {
    evictHeavyCaches();
    try {
      localStorage.setItem(LS, JSON.stringify(lib));
      localStorage.setItem(LS_DEL, JSON.stringify(libTombstones));
    } catch (e2) {
      console.error(e2);
      showSyncToast('⚠ Сховище переповнене');
    }
  }
}

// ============ ACTIVITY LOG ============
const ACTIVITY_LOG_KEY = 'mycinema.activityLog.v1';
const ACTIVITY_LOG_MAX = 500;

function readActivityLog() {
  try {
    const arr = JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeActivityLog(arr) {
  try {
    localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(arr.slice(0, ACTIVITY_LOG_MAX)));
  } catch {}
}

function clearActivityLog() {
  try { localStorage.removeItem(ACTIVITY_LOG_KEY); } catch {}
}

function logActivity(entry) {
  if (!entry || !entry.cat || !entry.text) return;
  const now = Date.now();
  const list = readActivityLog();
  const item = entry.item || null;
  const itemKey = entry.key || (item && item.key) || '';
  const rec = {
    id: now + '-' + Math.random().toString(36).slice(2, 6),
    ts: now,
    cat: entry.cat,
    sub: entry.sub || '',
    icon: entry.icon || '•',
    text: entry.text,
    key: itemKey,
    title: entry.title || (item && item.title) || '',
    poster: entry.poster !== undefined ? entry.poster : (item && item.poster) || null,
    type: entry.type || (item && item.type) || ''
  };
  // Склеюємо швидкі повторні оцінки одного тайтлу (протягом 25с) в один запис
  if (entry.coalesceKey && list.length && list[0].coalesceKey === entry.coalesceKey && (now - list[0].ts) < 25000) {
    rec.coalesceKey = entry.coalesceKey;
    list[0] = rec;
  } else {
    if (entry.coalesceKey) rec.coalesceKey = entry.coalesceKey;
    list.unshift(rec);
  }
  writeActivityLog(list);
}

// Єдина точка видалення тайтлу з lib
function removeLibItem(key) {
  delete lib[key];
  libTombstones[key] = Date.now();
  if (typeof markCardLibDirty === 'function') markCardLibDirty();
}

function mergeLibraries(localItems, localDel, cloudItems, cloudDel) {
  const now = Date.now();
  const del = { ...cloudDel };
  for (const [k, t] of Object.entries(localDel)) if (!(del[k] >= t)) del[k] = t;
  for (const k of Object.keys(del)) if (now - del[k] > TOMBSTONE_TTL) delete del[k];

  const items = {};
  for (const k of new Set([...Object.keys(localItems), ...Object.keys(cloudItems)])) {
    const a = localItems[k], b = cloudItems[k];
    const win = !a ? b : !b ? a : ((b.updated || 0) > (a.updated || 0) ? b : a);
    if (del[k] && del[k] >= (win.updated || 0)) continue; // видалено після останньої правки
    items[k] = win;
  }
  return { items, deleted: del };
}

// Читає хмару, зливає з локальним, застосовує і пише назад. true — якщо локальне змінилось.
function mergeCloudExtras(cloud) {
  let changed = false;

  // 1. Злиття схованих рекомендацій з урахуванням очищення
  const maxCleared = Math.max(dismissedClearedAt || 0, cloud.dismissedClearedAt || 0);
  const cloudDis = cloud.dismissed || {};
  const mergedDis = {};
  for (const k of new Set([...Object.keys(dismissedRecs), ...Object.keys(cloudDis)])) {
    const a = dismissedRecs[k], b = cloudDis[k];
    const win = !a ? b : !b ? a : ((b.ts || 0) > (a.ts || 0) ? b : a);
    if (win && (win.ts || 0) > maxCleared) mergedDis[k] = win;
  }
  if (JSON.stringify(mergedDis) !== JSON.stringify(dismissedRecs) || maxCleared !== dismissedClearedAt) {
    dismissedRecs = mergedDis;
    dismissedClearedAt = maxCleared;
    saveDismissed();
    changed = true;
  }

  // 2. Злиття ручних оцінок акторів (🔥 / 😞)
  const cAdj = cloud.actorAdjust || {};
  const cAdjTs = cloud.actorAdjustTs || {};
  const mergedAdj = {};
  const mergedAdjTs = {};
  for (const k of new Set([...Object.keys(actorAdjust), ...Object.keys(actorAdjustTs), ...Object.keys(cAdj), ...Object.keys(cAdjTs)])) {
    const lTs = actorAdjustTs[k] || (k in actorAdjust ? 1 : 0);
    const rTs = cAdjTs[k] || (k in cAdj ? 1 : 0);
    const val = rTs > lTs ? cAdj[k] : actorAdjust[k];
    const winTs = Math.max(lTs, rTs);
    if (winTs > 0) mergedAdjTs[k] = winTs;
    if (val) mergedAdj[k] = val;
  }
  if (JSON.stringify(mergedAdj) !== JSON.stringify(actorAdjust)) {
    actorAdjust = mergedAdj;
    actorAdjustTs = mergedAdjTs;
    saveActorAdjust();
    changed = true;
  } else {
    actorAdjustTs = mergedAdjTs;
  }

  if (cloud.appearance) applyCloudAppearance(cloud.appearance);
  if (cloud.online) { if (applyCloudOnline(cloud.online)) changed = true; }

  return changed;
}

// ---- синхронізація налаштувань вигляду ----
const LS_APP_TS = 'mycinema.appearance.ts';

function getAppearanceTs() {
  const raw = parseInt(localStorage.getItem(LS_APP_TS), 10);
  if (!isNaN(raw) && raw > 0) return raw;
  const hasLocalPref =
    localStorage.getItem('mycinema.theme.bg') !== null ||
    localStorage.getItem('mycinema.theme.accent') !== null ||
    localStorage.getItem('mycinema.posterBg') !== null ||
    localStorage.getItem('mycinema.snowEnabled') !== null;
  return hasLocalPref ? 1 : 0;
}

/* THEME-SYNC-DISABLED */
function getAppearancePayload() {
  const snowRaw = localStorage.getItem('mycinema.snowEnabled');
  return {
    posterBg: !!settings.posterBg,
    snowEnabled: snowRaw === null ? (typeof SnowFeature !== 'undefined' ? SnowFeature.isEnabled() : false) : snowRaw === 'true',
    showStatusBadges: settings.showStatusBadges !== false, /* FIX-STATUS-TOGGLE */
    ts: getAppearanceTs()
  };
}

function touchAppearance() {
  try { localStorage.setItem(LS_APP_TS, String(Date.now())); } catch {}
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}

const LS_ONLINE = 'mycinema.online';
function getOnlineConfig() {
  try {
    var o = JSON.parse(localStorage.getItem(LS_ONLINE) || '{}') || {};
    if (!o.roomUrl) {
      try { var old = JSON.parse(localStorage.getItem('mycinema.room') || '{}') || {}; if (old.url) o.roomUrl = String(old.url); } catch (e2) {}
    }
    return o;
  } catch (e) { return {}; }
}
function setOnlineConfig(patch, opts) {
  opts = opts || {};
  var cur = getOnlineConfig();
  var next = Object.assign({}, cur, patch || {});
  if (!opts.keepTs) next.ts = Date.now();
  try { localStorage.setItem(LS_ONLINE, JSON.stringify(next)); } catch (e) {}
  if (next.roomUrl != null) {
    try { localStorage.setItem('mycinema.room', JSON.stringify({ url: String(next.roomUrl || '') })); } catch (e) {}
  }
  if (!opts.skipSync) {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function(){ if (typeof saveToCloud === 'function') saveToCloud().catch(function(e){ console.warn('[saveToCloud]', e); }); }, 800);
  }
  return next;
}
function applyCloudOnline(c) {
  if (!c || typeof c !== 'object') return false;
  var local = getOnlineConfig();
  var cTs = Number(c.ts) || 0, lTs = Number(local.ts) || 0;
  if (cTs <= lTs) return false;
  var next = {
    roomUrl: String(c.roomUrl || ''),
    parserUrl: String(c.parserUrl || ''),
    parserApi: String(c.parserApi || ''),
    serverUrl: String(c.serverUrl || ''),
    ts: cTs
  };
  try { localStorage.setItem(LS_ONLINE, JSON.stringify(next)); } catch (e) {}
  try { localStorage.setItem('mycinema.room', JSON.stringify({ url: next.roomUrl })); } catch (e) {}
  return true;
}

function applyCloudAppearance(app) {
  if (!app || typeof app !== 'object') return false;
  const cTs = Number(app.ts) || 0;
  const lTs = getAppearanceTs();
  if (cTs <= lTs) return false;

  const posterBg = typeof app.posterBg === 'boolean' ? app.posterBg : settings.posterBg;
  const snowOn = typeof app.snowEnabled === 'boolean' ? app.snowEnabled : true;
  const statusBadgesOn = typeof app.showStatusBadges === 'boolean' ? app.showStatusBadges : settings.showStatusBadges; /* FIX-STATUS-TOGGLE */

  settings.posterBg = posterBg;
  try {
    localStorage.setItem('mycinema.posterBg', posterBg ? 'true' : 'false');
    localStorage.setItem('mycinema.snowEnabled', snowOn ? 'true' : 'false');
    localStorage.setItem('mycinema.showStatusBadges', statusBadgesOn ? 'true' : 'false'); /* FIX-STATUS-TOGGLE */
    settings.showStatusBadges = statusBadgesOn;
    localStorage.setItem(LS_APP_TS, String(cTs));
  } catch {}

  if (typeof SnowFeature !== 'undefined') SnowFeature.apply();

  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal && settingsModal.classList.contains('open')) {
    if (typeof renderSettingsSwatches === 'function') renderSettingsSwatches();
    const pbgEl = document.getElementById('poster-bg-toggle');
    if (pbgEl) pbgEl.checked = settings.posterBg;
    const sbEl = document.getElementById('status-badge-toggle');
    if (sbEl) sbEl.checked = settings.showStatusBadges !== false;
    const snowEl = document.getElementById('snow-toggle');
    if (snowEl) snowEl.checked = snowOn;
  }
  if (typeof cardStack !== 'undefined' && cardStack.length && typeof renderCard === 'function') {
    /* FIX-APPCLOUD-SCROLL */ if (typeof saveCardScroll === 'function') saveCardScroll();
    renderCard(true);
  }
  return true;
}

// [SYNC-SUPABASE]
async function reconcileWithCloud() {
  const uid = window.currentUser.uid;
  
  // 1. Читаємо хмару
  const { data: cloudItems, error: err1 } = await window.supabase
    .from('user_library').select('*').eq('user_id', uid);
  if (err1) throw err1;

  const { data: profile, error: err2 } = await window.supabase
    .from('profiles').select('*').eq('id', uid).single();
  if (err2 && err2.code !== 'PGRST116') throw err2; // PGRST116 = no rows

  // 2. Формуємо об'єкт cloudLib
  const cloudLib = {};
  (cloudItems || []).forEach(row => { cloudLib[row.item_key] = row.user_data; });
  
  const cloudExtras = profile?.settings || {};

  // 3. Зливаємо
  const merged = mergeLibraries(lib, libTombstones, cloudLib, cloudExtras.deleted || {});
  const libChanged = JSON.stringify(merged.items) !== JSON.stringify(lib);
  
  lib = merged.items;
  libTombstones = merged.deleted;
  saveLocalOnly();

  /* FIX-SYNC-RESIDUAL */
  for (const k of Object.keys(merged.items)) {
    const localUpd = merged.items[k].updated || 0;
    const cloudUpd = cloudLib[k]?.updated || 0;
    if (localUpd > cloudUpd) _dirtyItems.add(k);
  }

  const extrasChanged = mergeCloudExtras(cloudExtras);

  // 4. Пишемо назад ТІЛЬКИ ЗМІНЕНІ елементи (Upsert)
  const keysToUpsert = Array.from(_dirtyItems);
  const upsertData = keysToUpsert.map(key => {
    if (!lib[key]) return null; // Якщо видалено
    return {
      user_id: uid,
      item_key: key,
      user_data: lib[key]
    };
  }).filter(Boolean);

  if (upsertData.length > 0) {
    const { error: errUp } = await window.supabase
      .from('user_library')
      .upsert(upsertData, { onConflict: 'user_id,item_key' });
    if (errUp) throw errUp;
  }
  _dirtyItems.clear(); // Очищаємо після успішного запису

  // Видаляємо tombstones з бази
  const deletedKeys = Object.keys(libTombstones);
  if (deletedKeys.length > 0) {
    await window.supabase.from('user_library').delete().eq('user_id', uid).in('item_key', deletedKeys);
  }

  const { error: errProf } = await window.supabase.from('profiles').upsert({
    id: uid,
    email: window.currentUser.email,
    settings: {
      dismissed: dismissedRecs,
      dismissedClearedAt,
      actorAdjust,
      actorAdjustTs,
      appearance: getAppearancePayload(),
      deleted: libTombstones,
      online: getOnlineConfig()
    },
    updated_at: new Date().toISOString()
  });
  if (errProf) throw errProf;

  return libChanged || extrasChanged;
}

/* FIX-HOIST-REMOVED */
function save() { saveLocalOnly(); clearTimeout(_saveTimer); _saveTimer = setTimeout(function(){ saveToCloud().catch(function(e){ console.warn('[saveToCloud]', e); }); }, 800); } /* FIX-SAVE-CLOUD-ERR */
function saveNow() { saveLocalOnly(); clearTimeout(_saveTimer); return saveToCloud(); }

let _syncing = Promise.resolve();
function saveToCloud(isManual = false) {
  if (!window.currentUser || !window.firebaseReady) return Promise.resolve();
  _syncing = _syncing.then(async () => {
    try {
      setSyncStatus('saving', isManual ? 'Синхронізую...' : 'Зберігаю...');
      const changed = await reconcileWithCloud();
      if (changed) refresh();
      setSyncStatus('saved', isManual ? '✓ Синхронізовано' : '✓');
    } catch (e) { 
      setSyncStatus('error', typeof navigator !== 'undefined' && navigator.onLine === false ? '📴 Офлайн' : '⚠ Помилка'); 
      console.error(e); 
    }
  });
  return _syncing;
}

async function pullFromCloud() {
  if (!window.currentUser || !window.firebaseReady) {
    showSyncToast('❌ Увійдіть в акаунт');
    return;
  }
  try {
    setSyncStatus('saving', 'Оновлюю...');
    const changed = await reconcileWithCloud();
    /* NO-CLOUD-CENTER-TOAST */
    if (changed) {
      refresh();
    }
    setSyncStatus('saved', '✓');
  } catch (e) {
    setSyncStatus('error', typeof navigator !== 'undefined' && navigator.onLine === false ? '📴 Офлайн' : '⚠ Помилка');
    console.error(e);
    
  }
}

async function syncFromCloud() {
  if (!window.currentUser || !window.firebaseReady) return;
  await saveToCloud(); // читання + злиття + запис
  if (Object.keys(lib).length === 0 && !localStorage.getItem('onboardingDone')) startOnboarding();
}

function setSyncStatus(status, text) {
  syncIndicator.className = 'sync-indicator visible ' + status;
  syncIndicator.textContent = text;
  if (status === 'saved') setTimeout(() => syncIndicator.classList.remove('visible'), 1800);
}

function showCenterToast(text) {
  /* FIX-TOAST-STACK */
  document.querySelectorAll('.center-toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = 'center-toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after 2 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function showSyncToast(text) {
  syncIndicator.className = 'sync-indicator visible saved';
  syncIndicator.textContent = text;
  clearTimeout(showSyncToast._t);
  showSyncToast._t = setTimeout(() => syncIndicator.classList.remove('visible'), 2000);
}

// ============ PLACEHOLDER ============
function rotatePlaceholder() {
  const current = input.placeholder;
  let next, attempts = 0;
  do { next = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]; attempts++; } while (next === current && attempts < 10);
  input.placeholder = next;
}
rotatePlaceholder();
input.addEventListener('blur', () => { if (!input.value.trim()) rotatePlaceholder(); });

// ============ META & PLATFORMS ============
function normalizePlatformInfo(raw) {
  if (!raw || !raw.name) return null;
  const n = raw.name.trim();
  const low = n.toLowerCase();
  if (/\b(amazon|apple tv|roku)\s+channel\b/i.test(low)) return null;
  const logo = raw.logo_path || raw.logo || null;
  if (low.includes('netflix')) return { key: 'netflix', name: 'Netflix', logo };
  if (low === 'hbo' || low === 'hbo max' || low === 'max') return { key: 'max', name: 'Max / HBO', logo };
  if (low.includes('prime video') || low === 'amazon' || low.includes('amazon prime')) return { key: 'prime', name: 'Prime Video', logo };
  if (low.includes('apple tv')) return { key: 'apple', name: 'Apple TV+', logo };
  if (low.includes('disney')) return { key: 'disney', name: 'Disney+', logo };
  if (low.includes('hulu')) return { key: 'hulu', name: 'Hulu', logo };
  if (low.includes('peacock')) return { key: 'peacock', name: 'Peacock', logo };
  if (low.includes('paramount')) return { key: 'paramount', name: 'Paramount+', logo };
  if (low.includes('skyshowtime')) return { key: 'skyshowtime', name: 'SkyShowtime', logo };
  if (low.includes('megogo')) return { key: 'megogo', name: 'MEGOGO', logo };
  if (low.includes('sweet.tv') || low === 'sweet tv') return { key: 'sweettv', name: 'SWEET.TV', logo };
  return { key: low.replace(/[^a-z0-9а-яіїєґ]+/gi, '_'), name: n, logo };
}

function extractItemMeta(d, type) {
  if (!d) return {};
  const meta = {};
  if (d.genres) meta.genres = d.genres.map(g => g.id);
  if (d.credits?.cast?.length) {
    meta.cast = d.credits.cast.slice(0, CAST_LIMIT).map(a => ({ id: a.id, name: a.name, profile_path: a.profile_path }));
  }
  const dirSeen = new Set();
  const dirs = [];
  (d.credits?.crew || []).filter(c => c.job === 'Director').forEach(c => {
    if (c.id && !dirSeen.has(c.id)) { dirSeen.add(c.id); dirs.push({ id: c.id, name: c.name, profile_path: c.profile_path || null }); }
  });
  (d.created_by || []).forEach(c => {
    if (c.id && !dirSeen.has(c.id)) { dirSeen.add(c.id); dirs.push({ id: c.id, name: c.name, profile_path: c.profile_path || null }); }
  });
  if (dirs.length) meta.directors = dirs.slice(0, 4);
  const countrySet = new Set();
  if (Array.isArray(d.production_countries)) {
    d.production_countries.forEach(c => { if (c && c.iso_3166_1) countrySet.add(c.iso_3166_1.toUpperCase()); });
  }
  if (!countrySet.size && Array.isArray(d.origin_country)) {
    d.origin_country.forEach(code => { if (typeof code === 'string' && code) countrySet.add(code.toUpperCase()); });
  }
  meta.countries = [...countrySet];

  if (type === 'movie') {
    if (d.runtime > 0) meta.runtime = d.runtime;
    meta.collection = d.belongs_to_collection
      ? {
          id: d.belongs_to_collection.id,
          name: d.belongs_to_collection.name,
          poster: d.belongs_to_collection.poster_path || null
        }
      : null;
  } else if (type === 'tv') {
    if (d.number_of_episodes > 0) meta.episode_count = d.number_of_episodes;
    if (d.seasons) meta.totalSeasons = d.seasons.filter(s => s.season_number !== 0).length;
    let epRuntime = 0;
    if (Array.isArray(d.episode_run_time) && d.episode_run_time.length) {
      const valid = d.episode_run_time.filter(x => x > 0);
      if (valid.length) epRuntime = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    }
    if (!epRuntime && d.last_episode_to_air?.runtime > 0) epRuntime = d.last_episode_to_air.runtime;
    if (!epRuntime && d.next_episode_to_air?.runtime > 0) epRuntime = d.next_episode_to_air.runtime;
    if (!epRuntime && Array.isArray(d.seasons)) {
      const epRuntimes = [];
      d.seasons.forEach(s => (s.episodes || []).forEach(e => { if (e.runtime > 0) epRuntimes.push(e.runtime); }));
      if (epRuntimes.length) epRuntime = Math.round(epRuntimes.reduce((a, b) => a + b, 0) / epRuntimes.length);
    }
    if (epRuntime > 0) meta.runtime = epRuntime;
  }

  const platMap = new Map();
  const addPlat = (raw) => {
    const info = normalizePlatformInfo(raw);
    if (!info) return;
    if (!platMap.has(info.key)) platMap.set(info.key, info);
    else if (!platMap.get(info.key).logo && info.logo) platMap.get(info.key).logo = info.logo;
  };

  // 1. Оригінальні мережі для серіалів (Netflix, HBO, Apple TV+, FX...)
  if (Array.isArray(d.networks)) d.networks.forEach(addPlat);

  // 2. watch/providers: UA пріоритетно, або fallback US/PL/GB (тільки підписка flatrate)
  const wp = d['watch/providers']?.results || {};
  const uaFlat = wp.UA?.flatrate || [];
  if (uaFlat.length) {
    uaFlat.forEach(p => addPlat({ name: p.provider_name, logo_path: p.logo_path }));
  } else {
    ['US', 'PL', 'GB'].forEach(reg => {
      if (platMap.size < 3 && wp[reg]?.flatrate?.length) {
        wp[reg].flatrate.slice(0, 3).forEach(p => addPlat({ name: p.provider_name, logo_path: p.logo_path }));
      }
    });
  }

  if (platMap.size > 0) meta.platforms = [...platMap.values()].slice(0, 5);

  const mcuIds = typeof MCU_COMPANY_IDS !== 'undefined' ? MCU_COMPANY_IDS : [420, 38679];
  const prodIds = Array.isArray(d.production_companies) ? d.production_companies.map(c => c.id) : [];
  if (prodIds.some(id => mcuIds.includes(id))) {
    meta.franchiseKey = 'mcu';
  } else if (type === 'movie' && d.belongs_to_collection?.id) {
    meta.franchiseKey = 'col-' + d.belongs_to_collection.id;
  } else {
    meta.franchiseKey = null;
  }

  return meta;
}

// ============ DISMISSED RECS ============
const DISMISSED_KEY = 'mycinema.dismissed';
const DISMISSED_CLEARED_KEY = 'mycinema.dismissedClearedAt';
let dismissedClearedAt = parseInt(localStorage.getItem(DISMISSED_CLEARED_KEY)) || 0;
let dismissedRecs = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY)) || {};
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch { return {}; }
})();
function saveDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedRecs));
    localStorage.setItem(DISMISSED_CLEARED_KEY, String(dismissedClearedAt));
  } catch {}
}
function isDismissed(key) { return !!dismissedRecs[key]; }
function dismissRec(item) {
  if (!item || !item.key) return;
  dismissedRecs[item.key] = { ts: Date.now(), genres: item.genres || [], title: item.title || '' };
  logActivity({ cat: 'dismiss', sub: 'dismiss', icon: '🙈', text: 'Сховано з рекомендацій', item });
  saveDismissed();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}
function undismissRec(key) {
  const old = dismissedRecs[key];
  delete dismissedRecs[key];
  logActivity({ cat: 'dismiss', sub: 'undismiss', icon: '👁️', text: 'Повернуто в рекомендації', key, title: old?.title || key });
  saveDismissed();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}
function clearDismissed() {
  const cnt = Object.keys(dismissedRecs || {}).length;
  dismissedRecs = {};
  dismissedClearedAt = Date.now();
  if (cnt > 0) logActivity({ cat: 'dismiss', sub: 'clear', icon: '👁️', text: `Повернуто схованих рекомендацій: ${cnt}`, title: 'Рекомендації' });
  saveDismissed();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}

// ============ ELO ============
function getElo(item) {
  if (!item || !item.key) return ELO_START;
  const saved = lib[item.key];
  return (saved && typeof saved.elo === 'number') ? saved.elo : ELO_START;
}

function preserveItemTimestamps(entry) {
  /* PRESERVE_TS_GUARD */
  if (!entry) return;
  const fallbackTs = entry.statusDate || entry.createdAt || entry.updated || 0;
  if (entry.status && !entry.statusDate && fallbackTs > 0) {
    entry.statusDate = fallbackTs;
  }
  if (entry.type === 'movie' && computeAverage(entry.ratings) > 0 && !entry.ratingUpdated && fallbackTs > 0) {
    entry.ratingUpdated = fallbackTs;
  }
  if (entry.type === 'tv' && entry.seasonRatings) {
    const srTs = entry.seasonRatingTs ? { ...entry.seasonRatingTs } : {};
    let tsChanged = false;
    for (const [sNum, rObj] of Object.entries(entry.seasonRatings)) {
      if (computeAverage(rObj) > 0 && !srTs[sNum] && fallbackTs > 0) {
        srTs[sNum] = fallbackTs + Number(sNum);
        tsChanged = true;
      }
    }
    if (tsChanged) entry.seasonRatingTs = srTs;
  }
}

function recordEloMatch(winner, loser) {
  if (!winner || !loser || !winner.key || !loser.key) return null;

  const ensureEntry = (item) => {
    if (!lib[item.key]) {
      lib[item.key] = {
        ...item,
        status: null,
        ratings: null,
        watchedEpisodes: [],
        createdAt: Date.now()
      };
    }
    return lib[item.key];
  };

  const w = ensureEntry(winner);
  const l = ensureEntry(loser);

  const wElo = typeof w.elo === 'number' ? w.elo : ELO_START;
  const lElo = typeof l.elo === 'number' ? l.elo : ELO_START;

  const expectedWin = 1 / (1 + Math.pow(10, (lElo - wElo) / 400));
  const delta = Math.round(ELO_K * (1 - expectedWin));

  const eloNow = Date.now();
  preserveItemTimestamps(w);
  preserveItemTimestamps(l);

  /* ELO_AUTONOMY_APPLIED */
  w.elo = Math.round(wElo + delta);
  _dirtyItems.add(w.key);
  w.eloGames = (w.eloGames || 0) + 1;
  w.eloUpdated = eloNow;
  // w.updated НЕ чіпаємо, щоб не збивати дату перегляду і сортування бібліотеки

  l.elo = Math.round(lElo - delta);
  _dirtyItems.add(l.key);
  l.eloGames = (l.eloGames || 0) + 1;
  l.eloUpdated = eloNow;
  // l.updated НЕ чіпаємо

  // Перемоги Elo більше не засмічують загальний журнал дій
  save();
  return { delta, winnerElo: w.elo, loserElo: l.elo };
}


// [SAFE-A11Y] Локальне керування клавіатурою (без синхронізації в хмару)
const KBD_NAV_KEY = 'mycinema.kbdNav';
function isKbdNavEnabled() {
  const v = localStorage.getItem(KBD_NAV_KEY);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return window.matchMedia('(pointer: fine)').matches;
}
function setKbdNavEnabled(on) {
  localStorage.setItem(KBD_NAV_KEY, on ? 'true' : 'false');
  if (!on) {
    document.documentElement.classList.remove('mc-kbd');
    if (typeof window._disableSafeA11y === 'function') window._disableSafeA11y();
  } else {
    if (typeof window._enableSafeA11y === 'function') window._enableSafeA11y();
  }
}

(function initSafeA11y() {
  const selectors = [
    '.item', '.rec-card', '.light', '.actor-tile', '.episode-body',
    '.elo-row', '.actor-rank-item', '.franchise-head', '.series-prog-row',
    '.mood-pill', '.card-tab', '.top-number', '.episode-poster-wrap'
  ].join(', ');

  let active = false;
  let observer = null;

  const makeFocusable = (node) => {
    if (node.nodeType === 1 && node.matches(selectors) && !node.hasAttribute('tabindex')) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.dataset.mcA11y = '1';
    }
  };

  const activate = () => {
    if (active || !isKbdNavEnabled()) return;
    active = true;
    document.querySelectorAll(selectors).forEach(makeFocusable);
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1 || node.classList.contains('ripple')) continue;
          if (node.matches(selectors)) makeFocusable(node);
          node.querySelectorAll(selectors).forEach(makeFocusable);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const deactivate = () => {
    active = false;
    if (observer) { observer.disconnect(); observer = null; }
    document.querySelectorAll('[data-mc-a11y="1"]').forEach(el => {
      el.removeAttribute('tabindex');
      el.removeAttribute('role');
      delete el.dataset.mcA11y;
    });
  };

  window._enableSafeA11y = activate;
  window._disableSafeA11y = deactivate;

  if (isKbdNavEnabled() && window.matchMedia('(pointer: fine)').matches) {
    activate();
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'mouse') {
      document.documentElement.classList.remove('mc-kbd');
    }
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!isKbdNavEnabled()) return;
    if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
      document.documentElement.classList.add('mc-kbd');
      activate();
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Select' || e.keyCode === 23) {
      const focused = document.activeElement;
      if (focused && focused.matches(selectors)) {
        e.preventDefault();
        focused.click();
      }
    }
  });
})();
````

---

## 7. `src/home.js`

Конвеєр: getSeeds, сигнали, discover, pre-score, фінальний скор, diversity, computeRecsSignature

````js
'use strict';

// ============ RECOMMENDATIONS ENGINE V2 ============
const GEN_CACHE = 'mycinema.home.general.v7'; /* FIX-GEN-CACHE-BUMP */
const RECS_TTL = 48 * 60 * 60 * 1000;  // 48 годин /* FIX-RECS-CACHE-V2 */
const GEN_TTL = 12 * 60 * 60 * 1000;  // 12 годин

function isExcludedShow(raw, type) {
  if (!raw) return true;
  const gids = raw.genre_ids || (Array.isArray(raw.genres) ? raw.genres.map(g => (typeof g === 'object' ? g.id : g)) : []);
  if ((type === 'tv' || raw.media_type === 'tv') && gids.some(g => EXCLUDED_TV_GENRES.includes(g))) return true;
  if (gids.some(g => g === 10763 || g === 10764 || g === 10767)) return true;
  const title = `${raw.title || raw.name || ''} ${raw.original_title || raw.original_name || ''}`.trim();
  if (/(\b(the oscars|oscars 20\d\d|academy awards|golden globe awards|emmy awards|grammy awards|bafta awards|mtv .* awards|eurovision song contest|saturday night live|tonight show|late night with|late show with|jimmy kimmel|stephen colbert|seth meyers|graham norton)\b|церемоні(я|ї) (вручення|нагородження)|премі(я|ї) «?оскар»?|євробачення)/i.test(title)) {
    return true;
  }
  return false;
}

const META_CACHE_KEY = 'mycinema.metaCache.v2'; /* FIX-META-CACHE-BUMP */
const META_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const META_CACHE_MAX = 220;
const _memSeedRecs = new Map(); /* FIX-MEMSEED-LRU */
function _trimMemSeedRecs() {
  while (_memSeedRecs.size > 200) {
    const fk = _memSeedRecs.keys().next().value;
    _memSeedRecs.delete(fk);
  }
}


function hashString32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(str) {
  let a = hashString32(str) || 1;
  return function() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isExcludedFromTaste(x, avg) {
  if (!x) return true;
  if (x.excludeFromProfile === true) return true;
  if (x.excludeFromProfile === false) return false;
  // Порівнюємо з IMDb, якщо він уже підтягнутий; інакше лишається TMDB.
  const ref = (typeof imdbRef === 'function') ? imdbRef(x).rating : (x.tmdbRating || 0);
  if (ref > 0 && avg > 0 && Math.abs(avg - ref) > 3) return true;
  return false;
}

// Одноразовий backfill IMDb для всієї бібліотеки — має завершитися ДО getSeeds().
async function ensureLibraryImdb() {
  if (typeof imdbLoadFor !== 'function') return { ok: false, total: 0 };
  const movies = [], tv = [];
  for (const x of Object.values(lib || {})) {
    if (!x || !x.id) continue;
    const t = (x.type === 'tv') ? 'tv' : 'movie';
    if (typeof imdbLookup === 'function' && imdbLookup(t, x.id)) continue;
    (t === 'tv' ? tv : movies).push(x.id);
  }
  let ok = true;
  const groups = [];
  for (const [t, arr] of [['movie', movies], ['tv', tv]]) {
    for (let i = 0; i < arr.length; i += 400) groups.push([t, arr.slice(i, i + 400)]);
  }
  for (const [t, arr] of groups) {
    const res = (t === 'tv') ? await imdbLoadFor([], arr) : await imdbLoadFor(arr, []);
    if (!res.ok) ok = false;
  }
  return { ok, total: movies.length + tv.length };
}

function readMetaCacheAll() {
  const raw = typeof mcCacheGet === 'function' ? mcCacheGet(META_CACHE_KEY, {}) : {};
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

function writeMetaCacheAll(cache) {
  try {
    const entries = Object.entries(cache);
    if (entries.length > META_CACHE_MAX) {
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      cache = Object.fromEntries(entries.slice(0, META_CACHE_MAX));
    }
    if (typeof mcCacheSet === 'function') mcCacheSet(META_CACHE_KEY, cache);
  } catch {}
}

function packCompactMeta(d, type) {
  const dirs = [];
  const seenDir = new Set();
  (d.credits?.crew || []).filter(c => c.job === 'Director' || c.job === 'Creator').forEach(c => {
    if (!seenDir.has(c.id)) { seenDir.add(c.id); dirs.push({ id: c.id, name: c.name }); }
  });
  (d.created_by || []).forEach(c => {
    if (!seenDir.has(c.id)) { seenDir.add(c.id); dirs.push({ id: c.id, name: c.name }); }
  });

  let cast = [];
  if (type === 'tv' && Array.isArray(d.aggregate_credits?.cast) && d.aggregate_credits.cast.length) {
    const rawCast = d.aggregate_credits.cast.slice(0, 12);
    const maxEps = Math.max(...rawCast.map(c => c.total_episode_count || 1), 1);
    cast = rawCast.map(c => ({
      id: c.id,
      name: c.name,
      w: clampNum((c.total_episode_count || 1) / maxEps, 0.15, 1)
    }));
  } else {
    cast = (d.credits?.cast || []).slice(0, 10).map((c, idx) => ({
      id: c.id,
      name: c.name,
      w: 1 / Math.sqrt(1 + (typeof c.order === 'number' ? c.order : idx))
    }));
  }

  const kws = (d.keywords?.keywords || d.keywords?.results || []).slice(0, 14).map(k => k.id);
  const genres = (d.genres || []).map(g => g.id);

  return {
    ts: Date.now(),
    colId: d.belongs_to_collection?.id || null,
    netId: d.networks?.[0]?.id || null,
    dirs: dirs.slice(0, 3),
    cast,
    kws,
    genres,
    /* FIX-RELEASE-PACK-META */
    digitalDate: (typeof extractDigitalDate === 'function') ? extractDigitalDate(d) : null,
    providersUA: (typeof extractProvidersUA === 'function') ? extractProvidersUA(d) : []
  };
}

async function fetchCompactMeta(type, id, needRecs, cacheObj) {
  const key = `${type}-${id}`;
  const now = Date.now();
  const cached = cacheObj[key];
  const cachedRecs = needRecs ? _memSeedRecs.get(key) : null;
  if (cached && (now - (cached.ts || 0)) < META_CACHE_TTL && (!needRecs || cachedRecs)) {
    return { meta: cached, recs: cachedRecs || [] };
  }

  /* FIX-RELEASE-COMPACT-FETCH */
  const parts = [type === 'tv' ? 'credits,aggregate_credits,keywords,watch/providers' : 'credits,keywords,release_dates,watch/providers'];
  if (needRecs) parts.push('recommendations');
  const d = await tmdbFetch(`/${type}/${id}?language=uk-UA&append_to_response=${parts.join(',')}`);
  const meta = packCompactMeta(d, type);
  cacheObj[key] = meta;

  let recs = [];
  if (needRecs) {
    recs = (d.recommendations?.results || []).slice(0, 12);
    _memSeedRecs.set(key, recs);
    _trimMemSeedRecs(); /* FIX-MEMSEED-LRU-2 */
  }
  return { meta, recs };
}

async function mapBatched(items, batchSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const res = await Promise.all(chunk.map(fn));
    out.push(...res);
  }
  return out;
}

function getSeeds() {
  const candidates = Object.values(lib)
    .map(x => {
      const avg = computeItemRating(x).avg;
      const isFav = !!x.favorite;
      const elo = typeof x.elo === 'number' ? x.elo : ELO_START;
      const hasHighElo = (x.eloGames || 0) > 0 && elo >= 1530;
      if (!x.id || x.antiSeed || isExcludedFromTaste(x, avg)) return null;
      if (avg < 6.5 && !isFav && !hasHighElo) return null;

      const base = avg > 0 ? avg : (isFav ? 8.6 : 8.2);
      const favBonus = isFav ? 1.2 : 0;
      const eloBonus = elo > ELO_START ? Math.min((elo - ELO_START) / 100, 1.5) : 0;
      const strength = Math.min(10, base + favBonus + eloBonus);

      // Big bang: residual рахуємо від IMDb. Якщо даних немає — TMDB як
      // тимчасовий фольбек (головне, щоб обидва боки були з одного джерела).
      const ref = (typeof imdbRef === 'function') ? imdbRef(x) : null;
      const refVal = ref ? ref.rating : (x.tmdbRating || 0);
      const defaultRef = x.type === 'tv' ? 7.6 : 6.9; // типові IMDb-середні
      const residual = (avg > 0 && refVal > 0)
        ? (avg - refVal)
        : (avg > 0 ? avg - defaultRef : 0.8);
      const resFactor = clampNum(1 + residual / 2, 0.3, 2);
      const decayMult = Math.max(0.1, tasteDecay(x.updated));
      const rankScore = (strength / 10) * resFactor * (0.35 + 0.65 * decayMult);

      return { ...x, avg, isFav, elo, strength, residual, resFactor, decayMult, rankScore };
    })
    .filter(Boolean);

  if (!candidates.length) return [];

  const fresh = [...candidates].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 3);
  const byResidual = [...candidates].sort((a, b) => b.rankScore - a.rankScore || (b.updated || 0) - (a.updated || 0));

  const picked = [];
  const seen = new Set();
  for (const s of fresh) {
    if (!seen.has(s.key)) { seen.add(s.key); picked.push(s); }
  }
  /* REDUCE_SEED_OVERLOAD */
  for (const s of byResidual) {
    if (picked.length >= 10) break; // Топ-10 сідів дають точний зріз без перевантаження мережі
    if (!seen.has(s.key)) { seen.add(s.key); picked.push(s); }
  }
  return picked;
}

function getAntiSeeds() {
  return Object.values(lib)
    .map(x => ({ ...x, avg: computeItemRating(x).avg }))
    .filter(x => x.id && (x.status === 'dropped' || x.antiSeed === true) && x.excludeFromProfile !== true)
    .sort((a, b) => ((b.antiSeed ? 1 : 0) - (a.antiSeed ? 1 : 0)) || ((b.updated || 0) - (a.updated || 0)))
    .slice(0, 5);
}

function getDominantCriterion(taste) {
  if (!taste || taste.count < 3) return null;
  const vals = RATING_CRITERIA.map(c => ({ key: c.key, label: c.label, v: taste[c.key] || 0 }));
  const sorted = [...vals].sort((a, b) => b.v - a.v);
  const avg = vals.reduce((s, x) => s + x.v, 0) / vals.length;
  if (sorted[0].v - avg >= 0.35) return sorted[0];
  return null;
}

async function buildSmartRecommendations(seeds, mood, mode) {
  mode = mode || 'balance';
  if (!seeds.length) return { items: [], seeds: 0, mood, mode };

  const taste = computeTasteVector();
  const domCrit = getDominantCriterion(taste);
  const antiSeeds = getAntiSeeds();
  const metaCache = readMetaCacheAll();

  const seedDetails = (await mapBatched(seeds, 8, async s => {
    try {
      const { meta, recs } = await fetchCompactMeta(s.type, s.id, true, metaCache);
      return { seed: s, meta, recs };
    } catch { return null; }
  })).filter(Boolean);

  const antiDetails = (await mapBatched(antiSeeds, 5, async s => {
    try {
      const { meta } = await fetchCompactMeta(s.type, s.id, false, metaCache);
      return { seed: s, meta };
    } catch { return null; }
  })).filter(Boolean);

  // Групування сідів тільки за колекцією або самим сідом (без мережі)
  const groups = new Map();
  const getGroup = (gKey) => {
    if (!groups.has(gKey)) groups.set(gKey, { directors: {}, cast: {}, genres: {}, keywords: {} });
    return groups.get(gKey);
  };
  const addGrp = (o, id, v) => {
    const e = o[id] || (o[id] = { sum: 0, max: 0 });
    e.sum += v;
    if (v > e.max) e.max = v;
  };
  const combGrp = e => e.max + 0.3 * (e.sum - e.max);

  const dirRes = {};
  const actorRes = {};
  const names = { directors: {}, cast: {} };

  for (const { seed, meta } of seedDetails) {
    let w = (seed.strength / 10) * seed.resFactor * seed.decayMult;
    if (domCrit) {
      const rr = seed.type === 'tv' ? averagedSeasonRatings(seed) : (seed.ratings || {});
      if ((rr[domCrit.key] || 0) >= 8) w *= 1.15;
    }

    const gKey = meta.colId ? 'col-' + meta.colId : 'seed-' + seed.key;
    const grp = getGroup(gKey);

    (meta.dirs || []).forEach(c => {
      names.directors[c.id] = c.name;
      addGrp(grp.directors, c.id, w * 2.2);
      if (!dirRes[c.id]) dirRes[c.id] = { sum: 0, n: 0 };
      dirRes[c.id].sum += seed.residual;
      dirRes[c.id].n += 1;
    });

    (meta.cast || []).forEach(c => {
      names.cast[c.id] = c.name;
      const adj = typeof getActorAdj === 'function' ? getActorAdj(c.id) : 0;
      const mult = Math.max(0.3, 1 + adj * 0.45);
      addGrp(grp.cast, c.id, w * 2.0 * (c.w || 1) * mult);
      if (!actorRes[c.id]) actorRes[c.id] = { sum: 0, n: 0 };
      actorRes[c.id].sum += seed.residual;
      actorRes[c.id].n += 1;
    });

    const gIds = (meta.genres && meta.genres.length) ? meta.genres : (seed.genres || []);
    gIds.forEach(gid => {
      addGrp(grp.genres, gid, w * 1.4);
    });

    (meta.kws || []).forEach(kid => {
      addGrp(grp.keywords, kid, w * 1.1);
    });
  }

  const signals = { directors: {}, cast: {}, genres: {}, keywords: {} };
  for (const grp of groups.values()) {
    for (const [id, e] of Object.entries(grp.directors)) signals.directors[id] = (signals.directors[id] || 0) + combGrp(e);
    for (const [id, e] of Object.entries(grp.cast)) signals.cast[id] = (signals.cast[id] || 0) + combGrp(e);
    for (const [id, e] of Object.entries(grp.genres)) signals.genres[id] = (signals.genres[id] || 0) + combGrp(e);
    for (const [id, e] of Object.entries(grp.keywords)) signals.keywords[id] = (signals.keywords[id] || 0) + combGrp(e);
  }

  // Згладжування за залишком: sum(residual) / (n + 3)
  for (const [id, stat] of Object.entries(dirRes)) {
    const smooth = stat.sum / (stat.n + 3);
    signals.directors[id] *= clampNum(1 + smooth / 2, 0.5, 1.6);
  }
  for (const [id, stat] of Object.entries(actorRes)) {
    const smooth = stat.sum / (stat.n + 3);
    signals.cast[id] *= clampNum(1 + smooth / 2, 0.5, 1.6);
  }

  // Профіль акторів (Б+В відносно G, без countMod і без подвійного обліку)
  const actorProfiles = typeof computeActorProfiles === 'function'
    ? computeActorProfiles()
    : { globalCastAvg: 7.2, actors: new Map() };
  const anti = { directors: {}, genres: {}, keywords: {}, cast: {} };

  for (const [aid, prof] of actorProfiles.actors.entries()) {
    if (prof.name && !names.cast[aid]) names.cast[aid] = prof.name;
    if (prof.isAnti) {
      if (signals.cast[aid]) signals.cast[aid] = 0;
      anti.cast[aid] = Math.min(1.4, Math.max(0.25, Math.abs(prof.recSignal) * 0.6));
    } else if (prof.ratedCount >= 1 && prof.recSignal > 0.25 && prof.shrunk >= actorProfiles.globalCastAvg) {
      const profBoost = Math.min(2.2, prof.recSignal * 0.95);
      signals.cast[aid] = Math.max(signals.cast[aid] || 0, profBoost);
    }
  }

  // Ручні оцінки акторів (🔥/😞) — без повторного множення поверх recSignal
  for (const [aidStr, adj] of Object.entries(actorAdjust || {})) {
    const aid = parseInt(aidStr);
    if (adj > 0) {
      signals.cast[aid] = Math.max(signals.cast[aid] || 0, adj * 0.85) + adj * 0.30;
      delete anti.cast[aid];
    } else if (adj < 0) {
      if (signals.cast[aid]) signals.cast[aid] = 0;
      anti.cast[aid] = Math.max(anti.cast[aid] || 0, Math.abs(adj) * 0.85);
    }
  }

  // Анти-сигнали (тільки dropped + ручне «не схоже» + сховані + анти-актори)
  for (const { seed, meta } of antiDetails) {
    const aw = seed.antiSeed ? 1.4 : 1.0;
    (meta.dirs || []).forEach(c => { anti.directors[c.id] = (anti.directors[c.id] || 0) + aw; });
    const gIds = (meta.genres && meta.genres.length) ? meta.genres : (seed.genres || []);
    gIds.forEach(gid => { anti.genres[gid] = (anti.genres[gid] || 0) + aw * 0.4; });
    (meta.kws || []).forEach(kid => { anti.keywords[kid] = (anti.keywords[kid] || 0) + aw; });
  }
  for (const d of Object.values(dismissedRecs || {})) {
    (d.genres || []).forEach(gid => { anti.genres[gid] = (anti.genres[gid] || 0) + 0.25; });
  }

  const moodData = mood && MOODS[mood] ? MOODS[mood] : null;
  const topKw = Object.entries(signals.keywords)
    .filter(([id]) => !anti.keywords[id])
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  const topGenres = Object.entries(signals.genres)
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => parseInt(id));
  const topCast = Object.entries(signals.cast)
    .filter(([id, sc]) => sc > 0 && !anti.cast[id])
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => parseInt(id));
  const topDirectors = Object.entries(signals.directors)
    .filter(([id]) => !anti.directors[id])
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => parseInt(id));

  const unique = new Map();
  const ensureCandidate = (raw, type) => {
    if (!raw || !raw.poster_path) return null;
    if (isExcludedShow(raw, type)) return null;
    const key = `${type}-${raw.id}`;
    const tracked = typeof isTrackedInLib === 'function' ? isTrackedInLib(key) : !!lib[key];
    if (tracked || (typeof isDismissed === 'function' && isDismissed(key))) return null;
    /* FIX-RELEASE-ENSURE — Level 1+2 pre-filter */
    const _today = new Date().toISOString().slice(0, 10);
    const _rel = (raw.release_date || raw.first_air_date || '').slice(0, 10);
    if (settings.digitalOnly && type === 'movie') {
      if (_rel && _rel > _today) return null;  // ще не вийшов — точно немає digital
    }
    if (settings.streamingOnlyUA) {
      if (_rel && _rel > _today) return null;  // streaming точно немає
    }
    let entry = unique.get(key);
    if (!entry) {
      const item = normalizeItem({ ...raw, media_type: type });
      entry = { ...item, _sourceRaw: 0, _eloHits: [], _reasons: [], _seenTags: new Set(), _meta: null };
      unique.set(key, entry);
    }
    return entry;
  };
  const addReason = (entry, tag, text, priority) => {
    if (!entry || entry._seenTags.has(tag)) return;
    entry._seenTags.add(tag);
    entry._reasons.push({ priority, text });
  };

  // Джерело 1: Прямі TMDB рекомендації від сідів
  for (const { seed, recs } of seedDetails) {
    const seedRatingLabel = seed.avg > 0 ? ` (${fmtNum(seed.avg)})` : (seed.isFav ? ' ❤️' : '');
    const boost = Math.min(2.2, (seed.strength / 10) * seed.resFactor * seed.decayMult);
    const seedEloNorm = (seed.eloGames || 0) > 0 ? clampNum((seed.elo - 1450) / 250, 0, 1) : 0;

    recs.forEach((r, idx) => {
      const t = r.media_type || seed.type;
      const entry = ensureCandidate(r, t);
      if (!entry) return;
      entry._sourceRaw += boost * (1 - idx * 0.045);
      if (seedEloNorm > 0) entry._eloHits.push(seedEloNorm);
      addReason(entry, 'seed-' + seed.key, `Як «${seed.title}»${seedRatingLabel}`, 10);
    });
  }

  // Джерело 2: Discover + Акторські/Режисерські запити
  const currentYear = new Date().getFullYear();
  const baseDiscover = (type) => {
    const p = new URLSearchParams({ language: 'uk-UA' });
    // TMDB лишається лише каталогом: м'який поріг голосів, ніякого
    // vote_average.gte — справжню якість тепер перевіряє IMDb у pre-score.
    p.set('vote_count.gte', type === 'movie' ? '20' : '10');
    if (mode === 'gems') {
      p.set('sort_by', 'vote_average.desc');
    } else if (mode === 'fresh') {
      p.set('sort_by', 'popularity.desc');
      p.set(type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte', `${currentYear - 2}-01-01`);
    } else {
      p.set('sort_by', 'popularity.desc');
    }
    if (type === 'tv') p.set('without_genres', EXCLUDED_TV_GENRES.join(','));
    return p;
  };

  const fetchPromises = [];
  ['movie', 'tv'].forEach(type => {
    if (topKw.length || topGenres.length) {
      const p = baseDiscover(type);
      p.set('page', '1');
      if (topKw.length) p.set('with_keywords', topKw.join('|'));
      if (topGenres.length) p.set('with_genres', topGenres.slice(0, 3).join('|'));
      fetchPromises.push(tmdbFetch(`/discover/${type}?${p}`).then(d => ({ type, results: d.results || [], source: 'personalized' })).catch(() => ({ type, results: [], source: 'personalized' })));
    }
    if (topGenres.length) {
      const pg = baseDiscover(type);
      pg.set('page', '1');
      pg.set('with_genres', topGenres.slice(0, 3).join('|'));
      fetchPromises.push(tmdbFetch(`/discover/${type}?${pg}`).then(d => ({ type, results: d.results || [], source: 'genres' })).catch(() => ({ type, results: [], source: 'genres' })));
    }
    if (moodData) {
      const pm = baseDiscover(type);
      pm.set('page', '1');
      pm.set('with_genres', (type === 'tv' ? (moodData.tvGenres || moodData.genres) : moodData.genres).join('|'));
      fetchPromises.push(tmdbFetch(`/discover/${type}?${pm}`).then(d => ({ type, results: d.results || [], source: 'mood' })).catch(() => ({ type, results: [], source: 'mood' })));
    }
  });

  topCast.forEach(aid => {
    const p = baseDiscover('movie');
    p.set('with_cast', String(aid));
    p.set('page', '1');
    fetchPromises.push(
      tmdbFetch(`/discover/movie?${p}`)
        .then(d => ({ type: 'movie', results: (d.results || []).slice(0, 12), source: 'cast', actorId: aid }))
        .catch(() => ({ type: 'movie', results: [], source: 'cast' }))
    );
    fetchPromises.push(
      tmdbFetch(`/person/${aid}/tv_credits?language=uk-UA`)
        .then(d => {
          const castList = (d.cast || [])
            .filter(r => r.poster_path && (r.vote_count || 0) >= 10 && !(r.genre_ids || []).some(g => EXCLUDED_TV_GENRES.includes(g)))
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, 10);
          return { type: 'tv', results: castList, source: 'cast', actorId: aid };
        })
        .catch(() => ({ type: 'tv', results: [], source: 'cast' }))
    );
  });

  topDirectors.forEach(did => {
    const p = baseDiscover('movie');
    p.set('with_crew', String(did));
    p.set('page', '1');
    fetchPromises.push(
      tmdbFetch(`/discover/movie?${p}`)
        .then(d => ({ type: 'movie', results: (d.results || []).slice(0, 10), source: 'director', dirId: did }))
        .catch(() => ({ type: 'movie', results: [], source: 'director' }))
    );
  });

  const all = await Promise.all(fetchPromises);
  for (const batch of all) {
    for (const r of batch.results) {
      const entry = ensureCandidate(r, batch.type);
      if (!entry) continue;

      if (batch.source === 'mood') {
        /* FIX-MOOD-SOURCE-LEAK */
        const _mw = moodData.weight || 1.0;
        // Було 2.0 * 3.0 = 6.0 — настрій витісняв усе з pre-score.
        // Тепер не більше REC_MOOD_SOURCE_CAP, як у інших discover-джерел.
        entry._sourceRaw += (typeof REC_MOOD_SOURCE_CAP !== 'undefined')
          ? Math.min(REC_MOOD_SOURCE_CAP, 0.4 * _mw)
          : Math.min(1.2, 0.4 * _mw);
        entry._moodMatch = _mw;
        addReason(entry, 'mood', `${moodData.emoji} ${moodData.label}`, 8);
      } else if (batch.source === 'director') {
        entry._sourceRaw += 0.9;
        const dName = names.directors[batch.dirId];
        addReason(entry, 'dir-' + batch.dirId, dName ? `Режисер: ${dName}` : 'Твій режисер', 9);
      } else if (batch.source === 'cast') {
        const adj = typeof getActorAdj === 'function' ? getActorAdj(batch.actorId) : 0;
        if (adj < 0 || anti.cast[batch.actorId]) continue;
        const prof = actorProfiles.actors.get(batch.actorId);
        const profBoost = prof && prof.recSignal > 0 ? Math.min(0.4, prof.recSignal * 0.16) : 0;
        entry._sourceRaw += 0.75 + profBoost;
        const aName = names.cast[batch.actorId];
        addReason(entry, 'cast-' + batch.actorId, aName ? `З ${aName}` : 'Актор з улюблених', 7);
      } else if (batch.source === 'personalized') {
        entry._sourceRaw += 0.9;
      } else if (batch.source === 'genres') {
        entry._sourceRaw += 0.45;
      }
    }
  }

  // Пакетне підтягування IMDb для всього пулу — ДО pre-score,
  // щоб якість оцінювалась за IMDb, а не за «дутими» TMDB-голосами.
  if (typeof imdbLoadFor === 'function') {
    const candMovies = [], candTv = [];
    for (const entry of unique.values()) {
      (entry.type === 'tv' ? candTv : candMovies).push(entry.id);
    }
    try { await imdbLoadFor(candMovies, candTv); }
    catch (e) { console.warn('[MyCinema/IMDb] candidate batch fail:', e); }
  }

  // Насичення жанрів (Lift)
  const poolGenreCounts = {};
  let totalPoolGenres = 0;
  for (const entry of unique.values()) {
    (entry.genres || []).forEach(gid => {
      poolGenreCounts[gid] = (poolGenreCounts[gid] || 0) + 1;
      totalPoolGenres++;
    });
  }
  const userGenreTotal = Object.values(signals.genres).reduce((a, b) => a + b, 0);
  const genreCountDistinct = Math.max(Object.keys(poolGenreCounts).length, 1);
  const genreLift = {};
  for (const gid of Object.keys(poolGenreCounts)) {
    const uShare = ((signals.genres[gid] || 0) + 0.5) / (userGenreTotal + 0.5 * genreCountDistinct);
    const pShare = (poolGenreCounts[gid] + 1) / (totalPoolGenres + genreCountDistinct);
    genreLift[gid] = uShare / pShare;
  }

  // Попередній фільтр по режиму + попередній скор для відбору топ-60 на credits/keywords
  const byType = { movie: [], tv: [] };
  for (const entry of unique.values()) {
    if (mode === 'fresh' && ((parseInt(entry.year) || 0) < currentYear - 2)) continue;

    // ── IMDb як джерело рейтингу й голосів ──────────────────────
    const ref = (typeof imdbRef === 'function') ? imdbRef(entry) : null;
    const refRating = ref ? ref.rating : (entry.tmdbRating || 0);
    const refVotes = ref ? ref.votes : (entry.votes || 0);
    const priors = (typeof recPriorsFor === 'function')
      ? recPriorsFor(ref && ref.source, entry.type)
      : ((typeof recPriors === 'function') ? recPriors(entry.type) : { C: 0.65, m: 200 });

    // Байєс: 8.8 при 200 голосах IMDb < 8.2 при 15 000 голосах.
    const wr = recBayesRating(refRating, refVotes, priors.C, priors.m);
    let modeBonus = 0;

    if (mode === 'gems') {
      if (ref && ref.source === 'imdb') {
        // Справжні перлини: не порожнячки з 10 голосами.
        const minV = entry.type === 'tv' ? 200 : 500;
        if (refVotes < minV || wr < 0.68) continue;
        modeBonus = (typeof recGemBonus === 'function')
          ? recGemBonus(refVotes, wr, entry.type)
          : clampNum((2500 - refVotes) / 2500, 0, 0.3);
      } else {
        // Тимчасовий TMDB-фольбек, поки IMDb даних немає.
        if (entry.votes > 2500 || entry.tmdbRating < 7.0) continue;
        modeBonus = clampNum((2500 - entry.votes) / 2500, 0, 0.3);
      }
    } else if (mode === 'fresh') {
      modeBonus = clampNum(((parseInt(entry.year) || currentYear - 2) - (currentYear - 2)) * 0.15, 0, 0.3);
    } else {
      modeBonus = (typeof recBalanceBonus === 'function')
        ? recBalanceBonus(ref, entry.popularity)
        : Math.min(entry.popularity / 250, 0.2);
    }

    const baseRaw = wr + modeBonus;
    // Чистий IMDb WR і режимний бонус ідуть у b окремо, щоб бонус не
    // забивав різницю між 7.1 і 8.3 через круту сигмоїду.
    entry._b = (typeof recBaseScore === 'function')
      ? recBaseScore(wr, modeBonus, entry.type)
      : undefined;

    let liftSum = 0, liftCnt = 0;
    let bestGenreId = null, bestLift = 0;
    let antiGenre = 0;
    (entry.genres || []).forEach(gid => {
      const lf = genreLift[gid] || 1;
      if (signals.genres[gid] && lf > 1) {
        const boost = Math.min(lf - 1, 1.8);
        liftSum += boost;
        liftCnt++;
        if (lf > bestLift) { bestLift = lf; bestGenreId = gid; }
      }
      if (anti.genres[gid]) antiGenre += anti.genres[gid] * 0.12;
    });
    const genreMatch = liftCnt > 0 ? Math.min(1.4, (liftSum / liftCnt) * Math.sqrt(liftCnt)) : 0;

    entry._baseRaw = baseRaw;
    entry._genreMatch = genreMatch;
    entry._antiGenre = Math.min(0.3, antiGenre);
    entry._eloRaw = entry._eloHits.length
      ? entry._eloHits.reduce((a, b) => a + b, 0) / entry._eloHits.length
      : 0;
    entry._bestGenreId = bestGenreId;

    /* FIX-MOOD-WEIGHT-PRE — mood genre match + source bonus */
    let _moodBoost = 0;
    if (moodData) {
      const _mw2 = moodData.weight || 1.0;
      const _mg = entry.type === 'tv' ? (moodData.tvGenres || moodData.genres) : moodData.genres;
      const _hits = (entry.genres || []).filter(g => _mg.includes(g)).length;
      if (_hits > 0) _moodBoost += Math.min(0.18, _hits * 0.05) * _mw2; /* FIX-MOOD-AGGR-BOOST */
      if (entry._moodMatch) _moodBoost += 0.12 * (entry._moodMatch);
    }
    entry._moodBoost = Math.min(0.6, _moodBoost);

    entry._preScore = entry._baseRaw * 0.35 + Math.min(entry._sourceRaw, 5) * 0.2 /* FIX-MOOD-AGGR-CAP */ + entry._genreMatch * 0.3 - entry._antiGenre + _moodBoost * 0.7; /* FIX-MOOD-AGGR-PRE */

    if (byType[entry.type]) byType[entry.type].push(entry);
  }

  // Топ-30 фільмів + Топ-30 серіалів (разом 60) -> дотягуємо credits + keywords з кешем
  const topMoviesForMeta = [...byType.movie].sort((a, b) => b._preScore - a._preScore).slice(0, 30);
  const topTvForMeta = [...byType.tv].sort((a, b) => b._preScore - a._preScore).slice(0, 30);
  const topCandidates = [...topMoviesForMeta, ...topTvForMeta];

  await mapBatched(topCandidates, 10, async entry => {
    try {
      const { meta } = await fetchCompactMeta(entry.type, entry.id, false, metaCache);
      entry._meta = meta;
    } catch {}
  });
  writeMetaCacheAll(metaCache);

  const todayStr = new Date().toISOString().slice(0, 10);
  const uid = (window.currentUser && window.currentUser.uid) ? window.currentUser.uid : 'guest';
  const rnd = seededRandom(`${uid}|${todayStr}|${state.home.refreshNonce || 0}`);

  const finalizeReasons = (entry) => {
    if (entry._bestGenreId && entry._reasons.length === 0) {
      const g = GENRES.find(x => x.id === entry._bestGenreId);
      if (g) addReason(entry, 'genre-' + g.id, `Твій жанр · ${g.name}`, 3);
    }
    if (domCrit && entry._reasons.length < 2 && ((entry._profileRaw || entry._genreMatch) >= 0.6)) {
      addReason(entry, 'dom-crit', `Під «${domCrit.label}»`, 2);
    }
    entry._reasons = entry._reasons
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 2)
      .map(x => x.text);
  };

  const finalizeType = (list) => {
    if (!list.length) return [];

    /* FIX-RELEASE-FINALIZE — post-filter on enriched (has _meta) */
    const _today = new Date().toISOString().slice(0, 10);
    const filtered = list.filter(x => {
      if (!x._meta) return true;  // без meta не можемо перевірити — пропускаємо
      if (settings.digitalOnly && x.type === 'movie') {
        if (x._meta.digitalDate && x._meta.digitalDate > _today) return false;
      }
      if (settings.streamingOnlyUA) {
        if (!x._meta.providersUA || x._meta.providersUA.length === 0) return false;
      }
      return true;
    });

    const enriched = filtered.filter(x => !!x._meta);
    const rest = filtered.filter(x => !x._meta); /* FIX-RELEASE-FINALIZE-REST */

    if (enriched.length) {
      for (const entry of enriched) {
        let actorMatch = 0;
        let directorMatch = 0;
        let kwMatch = 0;
        let antiDir = 0;
        let antiKw = 0;

        let bestActor = null, bestActorScore = 0;
        let antiCast = 0;
        (entry._meta.cast || []).forEach(c => {
          if (anti.cast[c.id]) {
            antiCast += anti.cast[c.id] * (c.w || 1) * 0.25;
            return;
          }
          const sig = signals.cast[c.id] || 0;
          if (sig > 0) {
            const prof = actorProfiles.actors.get(c.id);
            const leadBoost = prof && prof.shrunk >= actorProfiles.globalCastAvg + 0.5 && (c.w || 0) >= 0.5 ? 1.12 : 1.0;
            const sc = sig * (c.w || 1) * 0.25 * leadBoost;
            actorMatch += sc;
            if (sc > bestActorScore) { bestActorScore = sc; bestActor = c; }
          }
        });
        actorMatch = Math.min(0.80, actorMatch);
        if (bestActor && bestActorScore >= 0.20) {
          addReason(entry, 'cast-' + bestActor.id, `З ${bestActor.name}`, 7);
        }

        let bestDir = null, bestDirScore = 0;
        (entry._meta.dirs || []).forEach(d => {
          const sig = signals.directors[d.id] || 0;
          if (sig > 0) {
            const sc = sig * 0.4;
            directorMatch += sc;
            if (sc > bestDirScore) { bestDirScore = sc; bestDir = d; }
          }
          if (anti.directors[d.id]) antiDir += anti.directors[d.id] * 0.22;
        });
        directorMatch = Math.min(0.8, directorMatch);
        if (bestDir && bestDirScore >= 0.3) {
          addReason(entry, 'dir-' + bestDir.id, `Режисер: ${bestDir.name}`, 9);
        }

        (entry._meta.kws || []).forEach(kid => {
          if (signals.keywords[kid]) kwMatch += signals.keywords[kid] * 0.12;
          if (anti.keywords[kid]) antiKw += anti.keywords[kid] * 0.12;
        });
        kwMatch = Math.min(0.6, kwMatch);

        entry._profileRaw = entry._genreMatch + actorMatch + directorMatch + kwMatch;
        entry._antiPenalty = entry._antiGenre + Math.min(0.4, antiDir) + Math.min(0.35, antiKw) + Math.min(0.35, antiCast);
        finalizeReasons(entry);
      }

      // Абсолютне логістичне нормування (без min-max по поточному пулу),
      // щоб скор не «їхав» при зміні складу кандидатів між оновленнями.
      // Настрій входить один раз як п'ята ознака, а не додається вдруге зверху.
      enriched.forEach((entry) => {
        entry._sortScore = recRankScore(entry, (rnd() - 0.5) * 0.08);
        /* FIX-RELEASE-COPY-META — copy before delete for poster badges */
        entry.digitalReleaseDate = (entry._meta && entry._meta.digitalDate) || null;
        entry.streamingUA = (entry._meta && entry._meta.providersUA) || [];
        delete entry._seenTags;
        delete entry._meta;
        delete entry._moodBoost;
      });

      enriched.sort((a, b) => b._sortScore - a._sortScore);

      // Diversity: м'яке обмеження засилля однієї франшизи, режисера або головного актора
      const colSeen = {};
      const dirSeen = {};
      const leadSeen = {};
      enriched.forEach(entry => {
        const mc = metaCache[entry.key];
        if (!mc) return;
        let colPen = 0, dirPen = 0, leadPen = 0;
        if (mc.colId) {
          colSeen[mc.colId] = (colSeen[mc.colId] || 0) + 1;
          if (colSeen[mc.colId] > 2) colPen = Math.min(0.24, 0.08 * (colSeen[mc.colId] - 2));
        }
        const dirId = mc.dirs?.[0]?.id;
        if (dirId) {
          dirSeen[dirId] = (dirSeen[dirId] || 0) + 1;
          if (dirSeen[dirId] > 2) dirPen = Math.min(0.18, 0.06 * (dirSeen[dirId] - 2));
        }
        const leadId = mc.cast?.[0]?.id;
        if (leadId) {
          leadSeen[leadId] = (leadSeen[leadId] || 0) + 1;
          if (leadSeen[leadId] > 2) leadPen = Math.min(0.15, 0.05 * (leadSeen[leadId] - 2));
        }
        // max, а не dirPen + leadPen: інакше режисер і актор з одного фільму
        // подвійно каралися б за той самий «заліт».
        const divPen = Math.min(0.28, Math.max(colPen, dirPen, leadPen));
        if (divPen > 0) entry._sortScore -= divPen;
      });
      // Фінальне пересортування робимо після злиття з rest (див. нижче).
    }

    for (const entry of rest) {
      finalizeReasons(entry);
      // Ті самі ваги, що й для «збагачених»: інакше кандидат без метаданих
      // завжди опинявся б нижче, навіть якщо він об'єктивно кращий.
      entry._profileRaw = entry._genreMatch || 0;
      entry._antiPenalty = entry._antiGenre || 0;
      entry._sortScore = recRankScore(entry, 0);
      delete entry._seenTags;
      delete entry._meta;
      delete entry._moodBoost;
    }

    return [...enriched, ...rest].sort((a, b) => b._sortScore - a._sortScore).slice(0, 80);
  };

  return {
    items: [...finalizeType(byType.movie), ...finalizeType(byType.tv)],
    seeds: seeds.length,
    mood,
    mode
  };
}

function readGeneralCache() {
  try {
    const c = typeof mcCacheGet === 'function' ? mcCacheGet(GEN_CACHE, null) : JSON.parse(localStorage.getItem(GEN_CACHE));
    if (!c || !c.data) return null;
    if (Date.now() - c.ts < GEN_TTL) return c.data;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return c.data;
  } catch {}
  return null;
}
function writeGeneralCache(g) {
  try {
    if (!g) return;
    const hasMovies = (g.trMovies && g.trMovies.length) || (g.newMovies && g.newMovies.length) || (g.topMovies && g.topMovies.length);
    const hasTv = Array.isArray(g.tvStreams) && g.tvStreams.some(st => (st.pop && st.pop.length) || (st.fresh && st.fresh.length));
    if (!hasMovies && !hasTv) return;
    if (typeof mcCacheSet === 'function') mcCacheSet(GEN_CACHE, { ts: Date.now(), data: g });
  } catch {}
}
/* FIX-RECS-CACHE-V3 */
function readRecsCache(sig, critical) {
  try {
    const c = typeof mcCacheGet === 'function' ? mcCacheGet(RECS_CACHE, null) : JSON.parse(localStorage.getItem(RECS_CACHE));
    if (!c) return null;
    const age = Date.now() - c.ts;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false; /* offline-recs-ttl-bypass */
    if (age >= RECS_TTL && !offline) return null;
    if (critical && c.critical !== critical) return null;
    if (c.sig === sig || offline) {
      if (c.data && Array.isArray(c.data.items)) {
        c.data = { ...c.data, items: c.data.items.filter(x => x && !(typeof isTrackedInLib === 'function' ? isTrackedInLib(x.key) : !!lib[x.key])) };
      }
      return c.data;
    }
  } catch {}
  return null;
}
function writeRecsCache(sig, critical, data) { if (typeof mcCacheSet === 'function') mcCacheSet(RECS_CACHE, { sig, critical, ts: Date.now(), data }); } /* FIX-RECS-CACHE-V2 */

// ============ TASTE DNA (SVG & UI) ============
function tasteRadarSVG(taste, size = 240) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 42;
  const n = RATING_CRITERIA.length;
  const pts = RATING_CRITERIA.map((c, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI / n);
    const v = (taste[c.key] || 0) / 10;
    return { x: cx + r * v * Math.cos(angle), y: cy + r * v * Math.sin(angle), ax: cx + r * Math.cos(angle), ay: cy + r * Math.sin(angle), lx: cx + (r + 22) * Math.cos(angle), ly: cy + (r + 22) * Math.sin(angle), label: c.label.split(' ')[0] };
  });
  const grid = [1, 2, 3, 4].map(level => {
    const lr = r * level / 4;
    const gpts = RATING_CRITERIA.map((c, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return `${cx + lr * Math.cos(a)},${cy + lr * Math.sin(a)}`; }).join(' ');
    return `<polygon points="${gpts}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  }).join('');
  const axes = pts.map(p => `<line x1="${cx}" y1="${cy}" x2="${p.ax}" y2="${p.ay}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`).join('');
  const labels = pts.map(p => `<text x="${p.lx}" y="${p.ly}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="9.5" font-family="system-ui">${p.label}</text>`).join('');
  const poly = pts.map(p => `${p.x},${p.y}`).join(' ');
  const dots = pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="var(--accent)"/>`).join('');
  return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:${size}px;display:block">${grid}${axes}<polygon points="${poly}" fill="rgba(var(--accent-rgb),0.18)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

function renderTasteInsight(taste) {
  if (!taste || taste.count < 3) return null;
  const vals = RATING_CRITERIA.map(c => ({ key: c.key, label: c.label, v: taste[c.key] }));
  const sorted = [...vals].sort((a, b) => b.v - a.v);
  const top = sorted[0], bottom = sorted[sorted.length - 1];
  const gap = top.v - bottom.v;
  let desc;
  if (gap < 0.8) desc = `Ти — <em>збалансований глядач</em>. Усі критерії для тебе однаково важливі.`;
  else if (top.key === 'plot') desc = `Ти — <em>наративний глядач</em>. Історія та сюжет для тебе важливіші за форму.`;
  else if (top.key === 'cast') desc = `Ти — <em>персонажний глядач</em>. Ти цінуєш акторів і хімію між ними.`;
  else if (top.key === 'style') desc = `Ти — <em>візуальний глядач</em>. Картинка, атмосфера й стиль для тебе критичні.`;
  else if (top.key === 'emotions') desc = `Ти — <em>емоційний глядач</em>. Головне — що ти відчуваєш під час перегляду.`;
  else if (top.key === 'overall') desc = `Ти — <em>інтуїтивний глядач</em>. Довіряєш загальному враженню більше за деталі.`;
  else desc = `Твій найсильніший критерій — <em>${top.label}</em>.`;
  return { top, bottom, desc };
}

function buildTasteCard(taste) {
  const card = el('div', 'taste-card');
  const header = el('div', 'taste-card-header');
  header.append(el('div', 'taste-card-title', 'Taste DNA'));
  header.append(el('div', 'taste-card-meta', 'піврозпад · 180 днів'));
  card.append(header);

  const body = el('div', 'taste-body');
  const radarWrap = el('div', 'taste-radar-wrap');
  radarWrap.innerHTML = tasteRadarSVG(taste);
  body.append(radarWrap);

  const rows = el('div', 'taste-rows');
  for (const crit of RATING_CRITERIA) {
    const v = taste[crit.key] || 0;
    const row = el('div', 'taste-row');
    const lbl = el('div', 'taste-row-label');
    lbl.append(el('span', '', crit.label));
    lbl.append(el('span', 'taste-row-val', fmtNum(v)));
    row.append(lbl);
    const bar = el('div', 'taste-row-bar');
    const fill = el('i'); fill.style.width = (v / 10 * 100) + '%';
    bar.append(fill);
    row.append(bar);
    rows.append(row);
  }
  body.append(rows);
  card.append(body);

  const insight = renderTasteInsight(taste);
  if (insight) {
    const ins = el('div', 'taste-insight');
    ins.innerHTML = insight.desc;
    card.append(ins);
  }
  return card;
}

// ============ TEMPERATURE AVATAR (Last 10 rated projects + Mood) ============
const AVATAR_MOOD_RULES = {
  fun:        { label: 'Розвага', weights: { 35: 1.0, 12: 0.9, 16: 0.85, 10751: 0.9, 10762: 0.8 } },
  intense:    { label: 'Напруга', weights: { 53: 1.1, 28: 0.95, 80: 0.9, 10768: 1.0, 9648: 0.7 } },
  dark:       { label: 'Похмуре', weights: { 27: 1.35, 80: 0.95, 53: 0.85 } },
  epic:       { label: 'Епічне',  weights: { 878: 1.15, 14: 1.1, 10765: 1.15, 10752: 1.05, 36: 0.8 } },
  chill:      { label: 'Спокій',  weights: { 10749: 1.2, 10402: 1.1, 35: 0.75, 16: 0.75 } },
  thoughtful: { label: 'Роздуми', weights: { 99: 1.35, 18: 0.58, 9648: 0.85 } }
};

/* AVATAR-V2-BASELINE */
function getLastRatedProjects(limit) {
  const entries = [];
  Object.values(lib).forEach(item => {
    if (!item || !item.key) return;
    const isEloUntracked = (item.eloUpdated && item.updated === item.eloUpdated) || (item.eloGames > 0 && !item.ratingUpdated);
    const safeBaseTs = isEloUntracked ? (item.createdAt || item.updated || 0) : (item.updated || item.createdAt || 0);
    if (item.type === 'movie') {
      const avg = computeAverage(item.ratings);
      if (avg > 0) {
        entries.push({
          key: item.key,
          item,
          title: item.title || '',
          avg,
          genres: item.genres || [],
          ts: item.ratingUpdated || safeBaseTs
        });
      }
    } else if (item.type === 'tv') {
      const sr = item.seasonRatings || {};
      const srTs = item.seasonRatingTs || {};
      Object.entries(sr).forEach(([sNum, ratings]) => {
        const avg = computeAverage(ratings);
        if (avg > 0) {
          const tvBase = (item.eloUpdated && item.updated === item.eloUpdated) || (item.eloGames > 0 && !srTs[sNum])
            ? (item.createdAt || item.updated || 0)
            : (item.updated || item.createdAt || 0);
          entries.push({
            key: `${item.key}-s${sNum}`,
            item,
            title: `${item.title} (С${sNum})`,
            avg,
            genres: item.genres || [],
            ts: srTs[sNum] || (tvBase + Number(sNum))
          });
        }
      });
    }
  });
  entries.sort((a, b) => b.ts - a.ts);
  return (limit && limit > 0) ? entries.slice(0, limit) : entries;
}

function computeTempAvatarData() {
  const all = getLastRatedProjects(0);
  if (!all.length) {
    return { empty: true, count: 0, avg: 0, baseline: 0, delta: 0, hasPureHistory: false, tempLevel: 'mild', mood: 'thoughtful', title: 'Ще спить', subtitle: 'Оціни хоча б пару фільмів або сезонів', projects: [] };
  }

  const projects = all.slice(0, 10);
  const history = all.slice(10);
  const avg = projects.reduce((s, p) => s + p.avg, 0) / projects.length;

  // Базове середнє = усі оцінки ДО останніх 10 проєктів (щоб останні 10 не зсували власну базу)
  const fallbackBase = 7.2;
  let baseline = fallbackBase;
  const hasPureHistory = history.length >= 3;
  if (hasPureHistory) {
    baseline = history.reduce((s, p) => s + p.avg, 0) / history.length;
  } else if (history.length > 0) {
    const hSum = history.reduce((s, p) => s + p.avg, 0);
    baseline = (hSum + (3 - history.length) * fallbackBase) / 3;
  }

  const delta = avg - baseline;
  // Пороги: > +0.6 золото (hot) | ±0.6 стабільний кайф (warm) | -0.6..-1.8 прохолодно (mild) | < -1.8 розчарування (cold)
  const tempLevel = delta > 0.6 ? 'hot' : (delta >= -0.6 ? 'warm' : (delta >= -1.8 ? 'mild' : 'cold'));

  const moodScores = {};
  for (const k of Object.keys(AVATAR_MOOD_RULES)) moodScores[k] = 0;

  projects.forEach((p, idx) => {
    const recencyW = 1 - idx * 0.05;
    const enjoymentW = delta >= -1.8 ? Math.max(0.35, (p.avg - 3.5) / 6.5) : 1.0;
    const w = recencyW * enjoymentW;
    for (const [mKey, rule] of Object.entries(AVATAR_MOOD_RULES)) {
      let bestG = 0;
      (p.genres || []).forEach(gid => {
        if (rule.weights[gid] && rule.weights[gid] > bestG) bestG = rule.weights[gid];
      });
      if (bestG > 0) moodScores[mKey] += w * bestG;
    }
  });

  const sortedMoods = Object.entries(moodScores).sort((a, b) => b[1] - a[1]);
  const mood = sortedMoods[0][1] > 0 ? sortedMoods[0][0] : 'thoughtful';

  const PERSONA = {
    fun: {
      hot:  ['Золотий фан', 'Останні комедії й пригоди перевершили навіть твою високу планку'],
      warm: ['Стабільний позитив', 'Легкі тайтли тримають настрій рівно у твоєму тонусі'],
      mild: ['Усмішка без захвату', 'Розважальне кіно трохи не дотягує до твоєї бази'],
      cold: ['Жарти не зайшли', 'Останні комедії чи пригоди відчутно нижче твого смаку']
    },
    intense: {
      hot:  ['Драйв на максимумі', 'Напружені трилери й екшен зайшли помітно вище середнього'],
      warm: ['Стабільний адреналін', 'Гострі сюжети впевнено тримають твій звичний рівень'],
      mild: ['Стриманий пульс', 'Екшен дивився без звичного азарту — оцінки трохи просіли'],
      cold: ['Холодний скептик', 'Останні трилери й бойовики не зачепили й розчарували']
    },
    dark: {
      hot:  ['Похмурий шедевр', 'Темна атмосфера й жорсткі історії влучили краще за все'],
      warm: ['Нуарний кайф', 'Похмурі стрічки стабільно тримають твій улюблений рівень'],
      mild: ['Сірі сутінки', 'Темного вистачило, але без вау-ефекту'],
      cold: ['Передоз мороку', 'Похмурі новинки пішли в мінус проти твоєї бази']
    },
    epic: {
      hot:  ['Золотий космос', 'Фантастика, масштаб і епік зараз на твоєму піку'],
      warm: ['На стабільній орбіті', 'Великі світи й пригоди стабільно тримають планку'],
      mild: ['Півкроку до масштабу', 'Спецефекти норм, але очікував більшого'],
      cold: ['Пафос не спрацював', 'Гучний масштаб не врятував від низьких оцінок']
    },
    chill: {
      hot:  ['Золотий дзен', 'Теплі й атмосферні історії подарували справжнє задоволення'],
      warm: ['Затишний кайф', 'Рівний, приємний ритм переглядів на твоєму рівні'],
      mild: ['Легка втома', 'Спокійне кіно трохи пішло в мінус — хочеться чогось свіжого'],
      cold: ['Заснув на титрах', 'Останній чіл виявився надто прісним для тебе']
    },
    thoughtful: {
      hot:  ['Естетичний захват', 'Глибокі драми й сенси влучили вище твоєї планки'],
      warm: ['Вдумливий баланс', 'Сильні історії стабільно підтримують твій рівень'],
      mild: ['Аналітичний скепсис', 'Цікаві задумом, але оцінки трохи нижчі за твою базу'],
      cold: ['Суворий критик', 'Останні драми не переконали — планка впала вниз']
    }
  };

  const [title, subtitle] = PERSONA[mood]?.[tempLevel] || ['Кіно-настрій', ''];
  return { empty: false, count: projects.length, historyCount: history.length, hasPureHistory, avg, baseline, delta, tempLevel, mood, moodLabel: AVATAR_MOOD_RULES[mood].label, title, subtitle, projects };
}

function buildTempAvatarSVG(data, size = 68) {
  const palettes = {
    hot:  { bg1: '#ffd166', bg2: '#ff7b5c', stroke: '#fff3c4', glow: 'rgba(255,209,102,0.52)' },
    warm: { bg1: '#ffb86c', bg2: '#9de5c3', stroke: '#f2eee9', glow: 'rgba(255,184,108,0.28)' },
    mild: { bg1: '#c5a3ff', bg2: '#6b6485', stroke: '#e5dcff', glow: 'rgba(197,163,255,0.20)' },
    cold: { bg1: '#60a5fa', bg2: '#334155', stroke: '#bfdbfe', glow: 'rgba(96,165,250,0.34)' }
  };
  const pal = palettes[data.tempLevel || 'mild'];
  const uid = 'ta' + Math.random().toString(36).slice(2, 7);
  const ink = data.tempLevel === 'cold' ? '#0f172a' : (data.mood === 'dark' ? '#140f1d' : '#1a1207');
  const lvl = data.tempLevel;

  let eyes = '';
  let mouth = '';
  let extra = '';

  if (data.empty) {
    eyes = `<path d="M22 31 Q26 34 30 31 M42 31 Q46 34 50 31" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    mouth = `<line x1="31" y1="46" x2="41" y2="46" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`;
  } else if (data.mood === 'fun') {
    if (lvl === 'hot') {
      eyes = `<path d="M20 34 Q26 25 32 34 M40 34 Q46 25 52 34" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M22 40 Q36 56 50 40 Z" fill="${ink}"/>`;
      extra = `<circle cx="18" cy="40" r="3.6" fill="#ff5c5c" opacity="0.55"/><circle cx="54" cy="40" r="3.6" fill="#ff5c5c" opacity="0.55"/><circle cx="56" cy="16" r="2.2" fill="#fff" opacity="0.9"/>`;
    } else if (lvl === 'warm') {
      eyes = `<circle cx="26" cy="32" r="3.4" fill="${ink}"/><circle cx="46" cy="32" r="3.4" fill="${ink}"/><circle cx="27" cy="30.8" r="1.1" fill="#fff"/><circle cx="47" cy="30.8" r="1.1" fill="#fff"/>`;
      mouth = `<path d="M25 42 Q36 51 47 42" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
      extra = `<circle cx="19" cy="40" r="3.2" fill="#ff7b5c" opacity="0.4"/>`;
    } else if (lvl === 'mild') {
      eyes = `<circle cx="28" cy="33" r="2.9" fill="${ink}"/><circle cx="48" cy="33" r="2.9" fill="${ink}"/><path d="M21 27 Q26 25 31 27" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M27 45 Q36 47 45 43" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    } else {
      eyes = `<path d="M21 29 L30 32 M51 29 L42 32" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><circle cx="26" cy="35" r="2.7" fill="${ink}"/><circle cx="46" cy="35" r="2.7" fill="${ink}"/>`;
      mouth = `<path d="M27 49 Q36 42 45 49" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<circle cx="19" cy="41" r="2.8" fill="#93c5fd" opacity="0.45"/><path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.8"/>`;
    }
  } else if (data.mood === 'intense') {
    if (lvl === 'hot') {
      eyes = `<rect x="17" y="27" width="16" height="10" rx="3" fill="${ink}"/><rect x="39" y="27" width="16" height="10" rx="3" fill="${ink}"/><line x1="33" y1="31" x2="39" y2="31" stroke="${ink}" stroke-width="2.6"/>`;
      mouth = `<path d="M25 44 Q37 53 49 41" stroke="${ink}" stroke-width="2.9" fill="none" stroke-linecap="round"/>`;
      extra = `<polygon points="57,10 51,21 56,21 53,30 62,18 57,18" fill="#fff3c4" opacity="0.95"/>`;
    } else if (lvl === 'warm') {
      eyes = `<rect x="18" y="28" width="15" height="9" rx="3" fill="${ink}"/><rect x="39" y="28" width="15" height="9" rx="3" fill="${ink}"/><line x1="33" y1="31" x2="39" y2="31" stroke="${ink}" stroke-width="2.4"/>`;
      mouth = `<path d="M27 45 Q37 49 46 43" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<polygon points="56,12 52,20 56,20 54,26 60,18 56,18" fill="#fef3c7" opacity="0.75"/>`;
    } else if (lvl === 'mild') {
      eyes = `<rect x="18" y="29" width="15" height="7" rx="2" fill="rgba(26,18,7,0.22)" stroke="${ink}" stroke-width="2"/><rect x="39" y="29" width="15" height="7" rx="2" fill="rgba(26,18,7,0.22)" stroke="${ink}" stroke-width="2"/><line x1="33" y1="32" x2="39" y2="32" stroke="${ink}" stroke-width="2"/><circle cx="26" cy="32.5" r="2" fill="${ink}"/><circle cx="46" cy="32.5" r="2" fill="${ink}"/>`;
      mouth = `<line x1="28" y1="46" x2="44" y2="45" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`;
    } else {
      eyes = `<g transform="rotate(-6 36 33)"><rect x="18" y="29" width="15" height="8" rx="2" fill="${ink}"/><rect x="39" y="29" width="15" height="8" rx="2" fill="${ink}"/><line x1="33" y1="32" x2="39" y2="32" stroke="${ink}" stroke-width="2.2"/></g><path d="M21 25 L30 27 M51 25 L42 27" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`;
      mouth = `<path d="M27 48 Q36 43 45 48" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.8"/>`;
    }
  } else if (data.mood === 'dark') {
    if (lvl === 'hot') {
      eyes = `<path d="M20 30 L31 33 M52 30 L41 33" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><circle cx="26" cy="34.5" r="2.9" fill="${ink}"/><circle cx="46" cy="34.5" r="2.9" fill="${ink}"/>`;
      mouth = `<path d="M25 45 Q37 51 48 42" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M55 11 A6.5 6.5 0 1 0 62 20 A4.8 4.8 0 1 1 55 11 Z" fill="#fff3c4" opacity="0.92"/>`;
    } else if (lvl === 'warm') {
      eyes = `<path d="M21 31 L30 33 M51 31 L42 33" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/><circle cx="26" cy="35" r="2.7" fill="${ink}"/><circle cx="46" cy="35" r="2.7" fill="${ink}"/>`;
      mouth = `<path d="M27 45 Q36 49 46 44" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M55 12 A5.5 5.5 0 1 0 61 19 A4.2 4.2 0 1 1 55 12 Z" fill="#fef3c7" opacity="0.72"/>`;
    } else if (lvl === 'mild') {
      eyes = `<line x1="21" y1="32" x2="31" y2="32" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><line x1="41" y1="32" x2="51" y2="32" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><circle cx="26" cy="35" r="2.3" fill="${ink}"/><circle cx="46" cy="35" r="2.3" fill="${ink}"/>`;
      mouth = `<line x1="29" y1="46" x2="43" y2="46" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`;
      extra = `<path d="M55 13 A5 5 0 1 0 60 19 A3.8 3.8 0 1 1 55 13 Z" fill="#e5dcff" opacity="0.5"/>`;
    } else {
      eyes = `<path d="M21 28 L31 32 M51 28 L41 32" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><circle cx="26" cy="35" r="2.8" fill="${ink}"/><circle cx="46" cy="35" r="2.8" fill="${ink}"/><path d="M22 39 Q26 41 30 39 M42 39 Q46 41 50 39" stroke="${ink}" stroke-width="1.4" fill="none" opacity="0.55"/>`;
      mouth = `<path d="M27 49 Q36 44 45 49" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.75"/>`;
    }
  } else if (data.mood === 'thoughtful') {
    const glasses = `<circle cx="26" cy="33" r="6.5" fill="none" stroke="${ink}" stroke-width="2.2"/><circle cx="46" cy="33" r="6.5" fill="none" stroke="${ink}" stroke-width="2.2"/><line x1="32.5" y1="33" x2="39.5" y2="33" stroke="${ink}" stroke-width="2.2"/>`;
    if (lvl === 'hot') {
      eyes = glasses + `<circle cx="26" cy="33" r="2.6" fill="${ink}"/><circle cx="46" cy="33" r="2.6" fill="${ink}"/><circle cx="23" cy="30" r="1.2" fill="#fff" opacity="0.85"/>`;
      mouth = `<path d="M25 44 Q36 53 47 44" stroke="${ink}" stroke-width="2.7" fill="none" stroke-linecap="round"/>`;
    } else if (lvl === 'warm') {
      eyes = glasses + `<circle cx="26" cy="33" r="2.4" fill="${ink}"/><circle cx="46" cy="33" r="2.4" fill="${ink}"/>`;
      mouth = `<path d="M27 45 Q36 50 45 45" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    } else if (lvl === 'mild') {
      eyes = glasses + `<circle cx="26" cy="33" r="2.3" fill="${ink}"/><circle cx="46" cy="33" r="2.3" fill="${ink}"/><path d="M20 24 Q26 21 31 24" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      mouth = `<line x1="29" y1="46" x2="43" y2="46" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`;
    } else {
      eyes = glasses + `<path d="M20 24 L30 27 M52 24 L42 27" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><circle cx="26" cy="34" r="2.3" fill="${ink}"/><circle cx="46" cy="34" r="2.3" fill="${ink}"/>`;
      mouth = `<path d="M28 49 Q36 44 44 49" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.75"/>`;
    }
  } else if (data.mood === 'chill') {
    if (lvl === 'hot') {
      eyes = `<path d="M20 34 Q26 27 32 34 M40 34 Q46 27 52 34" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M26 43 Q36 52 46 43" stroke="${ink}" stroke-width="2.7" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M14 55 Q20 52 26 55 M46 55 Q52 52 58 55" stroke="#fff" stroke-width="2" fill="none" opacity="0.65" stroke-linecap="round"/>`;
    } else if (lvl === 'warm') {
      eyes = `<path d="M21 34 Q26 30 31 34 M41 34 Q46 30 51 34" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M28 44 Q36 49 44 44" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M14 55 Q20 52 26 55" stroke="#fff" stroke-width="2" fill="none" opacity="0.45" stroke-linecap="round"/>`;
    } else if (lvl === 'mild') {
      eyes = `<line x1="21" y1="33" x2="31" y2="33" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/><line x1="41" y1="33" x2="51" y2="33" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`;
      mouth = `<path d="M30 45 Q36 47 42 45" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    } else {
      eyes = `<path d="M21 29 L30 32 M51 29 L42 32" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><line x1="22" y1="35" x2="30" y2="35" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><line x1="42" y1="35" x2="50" y2="35" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
      mouth = `<circle cx="36" cy="46" r="3.6" fill="none" stroke="${ink}" stroke-width="2.5"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.8"/>`;
    }
  } else {
    // epic
    if (lvl === 'hot') {
      eyes = `<polygon points="26,26 28,31.5 34,31.5 29.5,35 31,40.5 26,37 21,40.5 22.5,35 18,31.5 24,31.5" fill="${ink}"/><polygon points="46,26 48,31.5 54,31.5 49.5,35 51,40.5 46,37 41,40.5 42.5,35 38,31.5 44,31.5" fill="${ink}"/>`;
      mouth = `<path d="M24 43 Q36 54 48 43" stroke="${ink}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
      extra = `<circle cx="14" cy="17" r="2.6" fill="#fff" opacity="0.9"/><circle cx="58" cy="15" r="2.2" fill="#fff" opacity="0.9"/>`;
    } else if (lvl === 'warm') {
      eyes = `<circle cx="26" cy="33" r="3.3" fill="${ink}"/><circle cx="46" cy="33" r="3.3" fill="${ink}"/><polygon points="26,29 27,32 30,33 27,34 26,37 25,34 22,33 25,32" fill="#fff" opacity="0.65"/>`;
      mouth = `<path d="M26 43 Q36 51 46 43" stroke="${ink}" stroke-width="2.7" fill="none" stroke-linecap="round"/>`;
      extra = `<circle cx="57" cy="17" r="2" fill="#fff" opacity="0.75"/>`;
    } else if (lvl === 'mild') {
      eyes = `<circle cx="26" cy="33" r="2.9" fill="${ink}"/><circle cx="46" cy="33" r="2.9" fill="${ink}"/>`;
      mouth = `<path d="M28 45 Q36 47 44 45" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
      extra = `<polygon points="56,14 57.5,17.5 61,18 58.2,20.2 59,23.5 56,21.5 53,23.5 53.8,20.2 51,18 54.5,17.5" fill="#e5dcff" opacity="0.7"/>`;
    } else {
      eyes = `<path d="M22 31 L30 36 M30 31 L22 36 M42 31 L50 36 M50 31 L42 36" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/>`;
      mouth = `<path d="M27 48 Q36 43 45 48" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M16 14 L18 19 L23 19 L19 22 L20 27 L16 24 L12 27 L13 22 L9 19 L14 19 Z" fill="#e0f2fe" opacity="0.75"/>`;
    }
  }

  return `<svg viewBox="0 0 72 72" width="${size}" height="${size}" style="display:block;flex-shrink:0;filter:drop-shadow(0 4px 12px ${pal.glow})">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${pal.bg1}"/><stop offset="100%" stop-color="${pal.bg2}"/></linearGradient></defs>
    <circle cx="36" cy="36" r="30" fill="url(#${uid})" stroke="${pal.stroke}" stroke-opacity="0.45" stroke-width="2"/>
    ${eyes}${mouth}${extra}
  </svg>`;
}

function buildTempAvatarCard(data) {
  const card = el('div', 'temp-avatar-card');
  const top = el('div', 'temp-avatar-top');
  const face = el('div', 'temp-avatar-face');
  face.innerHTML = buildTempAvatarSVG(data, 64);
  top.append(face);

  const info = el('div', 'temp-avatar-info');
  const head = el('div', 'temp-avatar-head');
  head.append(el('span', 'temp-avatar-title', data.title));
  if (!data.empty) {
    const sign = data.delta >= 0 ? '+' : '−';
    const dStr = `${sign}${fmtNum(Math.abs(data.delta))}`;
    head.append(el('span', 'temp-avatar-badge ' + data.tempLevel, `${fmtNum(data.avg)}/10 (${dStr}) · ${data.moodLabel}`));
  }
  info.append(head);
  info.append(el('div', 'temp-avatar-sub', data.subtitle));
  const metaText = data.empty
    ? 'Потрібно мінімум 1 оцінка'
    : (data.hasPureHistory
        ? `База ${fmtNum(data.baseline)} (до останніх 10) · останні ${data.count} проєктів`
        : `База ${fmtNum(data.baseline)} · останні ${data.count} проєктів (фільми + сезони)`);
  info.append(el('div', 'temp-avatar-meta', metaText));
  top.append(info);
  card.append(top);

  if (data.projects && data.projects.length) {
    const chips = el('div', 'temp-avatar-chips');
    data.projects.forEach(p => {
      const chip = el('button', 'temp-proj-chip');
      chip.type = 'button';
      chip.textContent = `${p.title} · ${fmtNum(p.avg)}`;
      chip.addEventListener('click', () => openCard(p.item));
      chips.append(chip);
    });
    card.append(chips);
  }
  return card;
}

function renderTasteSummary(taste) {
  const container = el('div', 'taste-summary-container' + (state.home.tasteExpanded ? ' is-expanded' : ''));
  const hasTaste = taste && taste.count >= 3;
  const avatarData = computeTempAvatarData();

  let summaryVal = '—';
  if (hasTaste) {
    const vals = RATING_CRITERIA.map(c => taste[c.key] || 0).filter(v => v > 0);
    if (vals.length) summaryVal = fmtNum(vals.reduce((a, b) => a + b, 0) / vals.length) + '/10';
  }

  const btn = el('button', 'taste-summary');
  const iconWrap = el('span', 'taste-summary-avatar');
  iconWrap.innerHTML = buildTempAvatarSVG(avatarData, 32);
  btn.append(iconWrap);
  const labelText = avatarData.empty ? 'Твій смак у цифрах' : `Твій смак · ${avatarData.title}`;
  btn.append(el('span', 'taste-summary-label', labelText));
  btn.append(el('span', 'taste-summary-value', summaryVal));
  const chev = el('span', 'taste-summary-chevron', '▾');
  btn.append(chev);
  if (state.home.tasteExpanded) btn.classList.add('expanded');

  const panel = el('div', 'taste-panel');
  panel.style.display = state.home.tasteExpanded ? 'block' : 'none';
  panel.append(buildTempAvatarCard(avatarData));

  if (hasTaste) {
    panel.append(buildTasteCard(taste));
  } else {
    const empty = el('div', 'taste-card');
    empty.append(el('div', 'taste-empty', 'Оціни хоча б 3 тайтли — і тут з\'явиться радарна карта твого смаку.'));
    panel.append(empty);
  }

  btn.addEventListener('click', () => {
    state.home.tasteExpanded = !state.home.tasteExpanded;
    btn.classList.toggle('expanded', state.home.tasteExpanded);
    container.classList.toggle('is-expanded', state.home.tasteExpanded);
    panel.style.display = state.home.tasteExpanded ? 'block' : 'none';
  });

  container.append(btn, panel);
  return container;
}

function renderMoodPills() {
  const pills = el('div', 'mood-pills');
  const allPill = el('button', 'mood-pill' + (!state.home.mood ? ' active' : ''), '✨ Будь-який');
  allPill.addEventListener('click', () => { state.home.mood = null; state.home.sig = null; refresh(); });
  pills.append(allPill);
  for (const [key, m] of Object.entries(MOODS)) {
    const p = el('button', 'mood-pill' + (state.home.mood === key ? ' active' : ''));
    p.textContent = `${m.emoji} ${m.label}`;
    p.addEventListener('click', () => {
      state.home.mood = state.home.mood === key ? null : key;
      state.home.sig = null;
      refresh();
    });
    pills.append(p);
  }
  return pills;
}

// ============ LOAD & RENDER ============
/* FIX-RECS-CACHE-V2 */
function computeCriticalSig() {
  return `mood:${state.home.mood || 'any'}|mode:${state.home.mode || 'balance'}|dig:${settings.digitalOnly ? 1 : 0}|str:${settings.streamingOnlyUA ? 1 : 0}`;
}

function computeRecsSignature(seeds) {
  const seedSig = seeds.map(s => `${s.key}:${s.strength.toFixed(1)}:${s.resFactor.toFixed(2)}`).join('|');
  const antiSig = getAntiSeeds().map(a => a.key).join(',');
  const exSig = Object.values(lib).filter(x => x.excludeFromProfile !== undefined).map(x => `${x.key}:${x.excludeFromProfile ? 1 : 0}`).join(',');
  const adjSig = Object.entries(actorAdjust || {}).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`).join(',');
  const castVals = Object.values(lib).map(x => typeof getItemCastRating === 'function' ? getItemCastRating(x) : 0).filter(v => v > 0);
  const castSig = `${castVals.length}:${castVals.reduce((a, b) => a + b, 0).toFixed(1)}`;
  const day = new Date().toISOString().slice(0, 10);
  const moodW = state.home.mood && MOODS[state.home.mood] ? (MOODS[state.home.mood].weight || 1) : 0; /* FIX-MOOD-AGGR-SIG */
  return `v15-imdb|${day}|n:${state.home.refreshNonce || 0}|${seedSig}|anti:${antiSig}|ex:${exSig}|adj:${adjSig}|cast:${castSig}|mood:${state.home.mood || 'any'}:${moodW}|mode:${state.home.mode || 'balance'}|dig:${settings.digitalOnly ? 1 : 0}|str:${settings.streamingOnlyUA ? 1 : 0}`; /* FIX-IMDB-SIG */
}

async function loadHome() {
  if (state.tab !== 'home') return;
  if (!state.home.mode || !window.matchMedia('(min-width: 900px) and (min-height: 600px)').matches) state.home.mode = 'balance';

  // Спочатку підтягуємо IMDb для бібліотеки, бо getSeeds() і профілі акторів
  // вже рахують residual на його основі. При помилці — тихий TMDB-фольбек.
  try { await ensureLibraryImdb(); } catch (e) { console.warn('[MyCinema/IMDb] library backfill fail:', e); }

  const seeds = getSeeds();
  const taste = computeTasteVector();
  const sig = computeRecsSignature(seeds);
  const critical = computeCriticalSig(); /* FIX-RECS-CACHE-V2 */

  if (!state.home.general) { const gc = readGeneralCache(); if (gc) state.home.general = gc; }
  /* LAZY_GENERAL_FETCH */
  // Не завантажуємо важкі 39 сторінок трендів/стрімінгів, якщо користувач на вкладці «Для мене»
  if (!state.home.general && state.home.view === 'explore') {
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const twoYearsAgoIso = `${new Date().getFullYear() - 2}-01-01`;
      const exGenres = EXCLUDED_TV_GENRES.join(',');
      const TV_STREAMS_DEF = [
        { id: 'netflix', title: 'Netflix',     net: '213',     logoNet: 213 },
        { id: 'hbo',     title: 'HBO / Max',   net: '49|3186', logoNet: 49 },
        { id: 'apple',   title: 'Apple TV+',   net: '2552',    logoNet: 2552 },
        { id: 'disney',  title: 'Disney+',     net: '2739',    logoNet: 2739 },
        { id: 'prime',   title: 'Prime Video', net: '1024',    logoNet: 1024 }
      ];

      const fetchPages = async (buildPath, pages) => {
        const res = await Promise.all(pages.map(pg => tmdbFetch(buildPath(pg)).catch(() => ({ results: [] }))));
        return res.flatMap(d => d.results || []);
      };

      const cleanGen = (rawList, type, limit = 50) => {
        const seen = new Set();
        const out = [];
        /* FIX-RELEASE-CLEANGEN — Level 1 filter for general sections */
        const _todayIso = new Date().toISOString().slice(0, 10);
        for (const r of rawList) {
          if (!r || !r.poster_path || isExcludedShow(r, type)) continue;
          if ((settings.digitalOnly || settings.streamingOnlyUA) && type === 'movie') {
            const _rd = (r.release_date || '').slice(0, 10);
            if (_rd && _rd > _todayIso) continue;
          }
          const item = normalizeItem({ ...r, media_type: type });
          if (seen.has(item.key)) continue;
          seen.add(item.key);
          item.overview = '';
          out.push(item);
          if (out.length >= limit) break;
        }
        return out;
      };

      const [trM, newM, topM] = await Promise.all([
        fetchPages(pg => `/trending/movie/week?language=uk-UA&page=${pg}`, [1, 2, 3]),
        fetchPages(pg => `/discover/movie?language=uk-UA&sort_by=primary_release_date.desc&primary_release_date.lte=${todayIso}&vote_count.gte=40&page=${pg}`, [1, 2, 3]),
        fetchPages(pg => `/discover/movie?language=uk-UA&sort_by=vote_average.desc&vote_count.gte=1000&page=${pg}`, [1, 2, 3])
      ]);

      const streamRaw = await mapBatched(TV_STREAMS_DEF, 2, async st => {
        const [popRaw, newRaw, netRes] = await Promise.all([
          fetchPages(pg => `/discover/tv?language=uk-UA&sort_by=popularity.desc&vote_count.gte=30&vote_average.gte=6.0&with_networks=${encodeURIComponent(st.net)}&without_genres=${exGenres}&page=${pg}`, [1, 2]),
          fetchPages(pg => `/discover/tv?language=uk-UA&sort_by=first_air_date.desc&first_air_date.gte=${twoYearsAgoIso}&first_air_date.lte=${todayIso}&vote_count.gte=5&with_networks=${encodeURIComponent(st.net)}&without_genres=${exGenres}&page=${pg}`, [1, 2]),
          tmdbFetch(`/network/${st.logoNet}`).catch(() => null)
        ]);
        return {
          id: st.id,
          title: st.title,
          logo: netRes?.logo_path || null,
          pop: cleanGen(popRaw, 'tv', 36),
          fresh: cleanGen(newRaw, 'tv', 20)
        };
      });

      const knownStreamTvIds = new Set();
      streamRaw.forEach(st => {
        st.pop.forEach(x => knownStreamTvIds.add(x.id));
        st.fresh.forEach(x => knownStreamTvIds.add(x.id));
      });

      const [otherPopRaw, otherNewRaw] = await Promise.all([
        fetchPages(pg => `/discover/tv?language=uk-UA&sort_by=popularity.desc&vote_count.gte=50&vote_average.gte=6.2&without_genres=${exGenres}&page=${pg}`, [1, 2, 3]),
        fetchPages(pg => `/discover/tv?language=uk-UA&sort_by=first_air_date.desc&first_air_date.gte=${twoYearsAgoIso}&first_air_date.lte=${todayIso}&vote_count.gte=10&without_genres=${exGenres}&page=${pg}`, [1, 2])
      ]);

      streamRaw.push({
        id: 'other',
        title: 'Інші платформи',
        logo: null,
        pop: cleanGen(otherPopRaw.filter(x => !knownStreamTvIds.has(x.id)), 'tv', 36),
        fresh: cleanGen(otherNewRaw.filter(x => !knownStreamTvIds.has(x.id)), 'tv', 20)
      });

      state.home.general = {
        trMovies: cleanGen(trM, 'movie', 50),
        newMovies: cleanGen(newM, 'movie', 50),
        topMovies: cleanGen(topM, 'movie', 50),
        tvStreams: streamRaw
      };
      writeGeneralCache(state.home.general);
    } catch (e) { console.error(e); }
  }

  if (!seeds.length) {
    state.home.recs = { items: [], seeds: 0, mood: state.home.mood, mode: state.home.mode };
    state.home.sig = sig;
    renderHomeContent(taste);
    return;
  }
  if (state.home.recs && state.home.sig === sig) { renderHomeContent(taste); return; }
  const cached = readRecsCache(sig, critical); /* FIX-RECS-CACHE-V2 */
  if (cached) { /* FIX-CACHE-RESET */ state.home.recs = cached; state.home.sig = sig; state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */; renderHomeContent(taste); return; }
  if (state.home.loading === sig) return;

  state.home.loading = sig;
  renderHomeSkeleton(taste);
  try {
    const data = await buildSmartRecommendations(seeds, state.home.mood, state.home.mode);
    if (state.home.loading !== sig) return; // [LOADHOME-RACE-FIX] застарілий запит
    writeRecsCache(sig, critical, data); /* FIX-RECS-CACHE-V2 */
    state.home.recs = data;
    state.home.sig = sig;
    state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */;
    renderHomeContent(taste);
  } catch (e) {
    if (state.home.loading !== sig) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      state.home.recs = { items: [], seeds: seeds.length, mood: state.home.mood, mode: state.home.mode };
      renderHomeContent(taste);
      showSyncToast('📴 Офлайн-режим');
    } else {
      box.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: ${escapeHtml(e.message)}</div>`; /* FIX-HOME-ERR-ESC */
    }
  }
  finally { if (state.home.loading === sig) state.home.loading = false; }
}

function buildRecsControlsBar() {
  const controlsBar = el('div', 'recs-controls-bar');
  const modesBar = el('div', 'recs-mode-pills');
  const modeDefs = [
    { id: 'balance', label: '✨ Баланс' },
    { id: 'gems', label: '💎 Перлини' },
    { id: 'fresh', label: '🆕 Свіже' }
  ];
  modeDefs.forEach(m => {
    const mb = el('button', 'recs-mode-pill' + ((state.home.mode || 'balance') === m.id ? ' active' : ''), m.label);
    mb.type = 'button';
    mb.addEventListener('click', () => {
      if ((state.home.mode || 'balance') === m.id) return;
      state.home.mode = m.id;
      try { localStorage.setItem('mycinema.home.mode', m.id); } catch (e) {} /* FIX-MODE-SAVE */
      state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */;
      refresh();
    });
    modesBar.append(mb);
  });
  controlsBar.append(modesBar, renderMoodPills());
  return controlsBar;
}

function renderHomeSkeleton(taste) {
  box.style.padding = '0';
  box.replaceChildren();

  box.append(renderTasteSummary(taste || computeTasteVector()));

  const wrap = el('div', 'home-wrap');
  const factCard = buildFactOfDayCard();
  if (factCard) wrap.append(factCard);
  const sec = el('section', 'home-section');
  const head = el('div', 'section-head');
  head.append(el('h2', 'section-title', '✨ Для тебе'));
  sec.append(head);
  sec.append(buildRecsControlsBar());

  const grid = el('div', 'home-grid');
  for (let i = 0; i < 14; i++) {
    const sk = el('div', 'rec-card skeleton-card');
    sk.append(el('div', 'skeleton-poster'));
    sk.append(el('div', 'skeleton-bar skeleton-line-1'));
    sk.append(el('div', 'skeleton-bar skeleton-line-2'));
    sk.append(el('div', 'skeleton-bar skeleton-line-3'));
    grid.append(sk);
  }
  sec.append(grid);
  wrap.append(sec);

  const plannedSec = buildPlannedByMoodSection();
  if (plannedSec) wrap.append(plannedSec);

  box.append(wrap);
}

function recCard(item, allowDismiss) {
  const c = el('div', 'rec-card');
  const wrap = el('div', 'rec-poster-wrap');
  const p = el('img', 'rec-poster'); p.src = TMDB_IMG + 'w342' + item.poster; p.loading = 'lazy'; p.decoding = 'async';
  wrap.append(p);
  if (allowDismiss && typeof dismissRec === 'function') {
    const disBtn = el('button', 'rec-dismiss', '✕');
    disBtn.type = 'button';
    disBtn.title = 'Не цікавить (сховати)';
    disBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissRec(item);
      c.classList.add('dismissing');
      setTimeout(() => {
        c.remove();
        if (state.home.recs?.items) {
          state.home.recs.items = state.home.recs.items.filter(x => x.key !== item.key);
        }
      }, 180);
      showSyncToast('🙈 Приховано');
    });
    wrap.append(disBtn);
  }
  /* FIX-RELEASE-REC-BADGE — badge on poster */
  if (settings.showStatusBadges !== false) try {
    const _today = new Date().toISOString().slice(0, 10);
    const _rel = (item.releaseDate || (item.year ? item.year + '-01-01' : '')).slice(0, 10);
    const _libItem = (typeof lib !== 'undefined' && lib[item.key]) || {}; /* FIX-RELEASE-REC-BADGE-LIB */
    const _dig = _libItem.digitalReleaseDate || item.digitalReleaseDate || null;
    const _str = (_libItem.streamingUA && _libItem.streamingUA.length ? _libItem.streamingUA : item.streamingUA) || [];
    let _b = null;
    /* FIX-RELEASE-OLD-FALLBACK */
    const _oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (_str && _str.length > 0) _b = { cls: 'stream', txt: '📺 UA' };
    else if (_dig && _dig <= _today) _b = { cls: 'ok', txt: '💾 Цифра' };
    else if (_rel && _rel > _today) _b = { cls: 'wait', txt: '⏳ Скоро' };
    else if (_rel && _rel <= _today && _rel < _oldDate) _b = { cls: 'ok', txt: '💾 Цифра' };
    else if (_rel && _rel <= _today && (!_dig || _dig > _today) && item.type === 'movie') _b = { cls: 'cinema', txt: '🎬 Кіно' };
    if (_b) wrap.append(el('span', 'rec-badge ' + _b.cls, _b.txt));
  } catch (e) {}
  c.append(wrap);
  c.append(el('div', 'row-title', item.title));
  let meta = item.year || '';
  if (item.tmdbRating) meta += (meta ? ' · ' : '') + item.tmdbRating.toFixed(1);
  c.append(el('div', 'row-meta', meta));
  if (item._reasons && item._reasons.length) {
    c.append(el('div', 'rec-why', item._reasons.join(' · ')));
  }
  c.addEventListener('click', () => openCard(item));
  return c;
}

function buildPlannedByMoodSection() {
  const allPlanned = Object.values(lib)
    .filter(x => x.status === 'planned' && x.poster)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (!allPlanned.length) return null;

  const moodKey = state.home.mood;
  const moodData = moodKey && MOODS[moodKey] ? MOODS[moodKey] : null;
  if (!state.home.planFilter) state.home.planFilter = 'all';

  let moodPool = allPlanned;
  if (moodData) {
    const matched = allPlanned.filter(x => {
      if (!x.genres || !x.genres.length) return false;
      const targetGenres = x.type === 'tv' ? (moodData.tvGenres || moodData.genres) : moodData.genres;
      return x.genres.some(g => targetGenres.includes(g));
    });
    if (matched.length) moodPool = matched;
  }

  const applyTimeFilter = (arr, f) => {
    if (f === 'short') return arr.filter(x => x.type === 'movie' && x.runtime > 0 && x.runtime <= 105);
    if (f === 'movie') return arr.filter(x => x.type === 'movie');
    if (f === 'mini') return arr.filter(x => x.type === 'tv' && (x.totalSeasons === 1 || (!x.totalSeasons && x.episode_count > 0 && x.episode_count <= 10)));
    return arr;
  };

  const pool = applyTimeFilter(moodPool, state.home.planFilter);
  const sec = el('section', 'home-section planned-mood-sec');
  const head = el('div', 'section-head');
  const titleWrap = el('div', 'planned-head-left');
  titleWrap.append(el('h2', 'section-title', '🎯 З твого «Планую»'));

  const rouletteBtn = el('button', 'roulette-btn', '🎲 Вибрати за мене');
  rouletteBtn.type = 'button';
  rouletteBtn.addEventListener('click', () => {
    const p = pool.length ? pool : moodPool;
    const pick = p[Math.floor(Math.random() * p.length)];
    if (pick) openCard(pick);
  });

  head.append(titleWrap, rouletteBtn);
  sec.append(head);

  const pfBar = el('div', 'plan-filter-bar');
  [
    ['all', 'Усі'],
    ['short', '⚡ До 100 хв'],
    ['movie', '🎬 Фільми'],
    ['mini', '📺 Міні-серіали']
  ].forEach(([fid, lbl]) => {
    const b = el('button', 'recs-mode-pill' + (state.home.planFilter === fid ? ' active' : ''), lbl);
    b.type = 'button';
    b.addEventListener('click', () => {
      state.home.planFilter = fid;
      const fresh = buildPlannedByMoodSection();
      if (fresh) sec.replaceWith(fresh);
    });
    pfBar.append(b);
  });
  sec.append(pfBar);

  if (!pool.length) {
    sec.append(el('div', 'home-note', 'Немає тайтлів у «Планую» під цей фільтр (або ще не підвантажено хронометраж).'));
    return sec;
  }

  const strip = el('div', 'home-grid');
  pool.slice(0, 14).forEach(item => strip.append(recCard(item, false)));
  sec.append(strip);
  return sec;
}

function buildHomeTypeSwitch(taste) {
  const sw = el('div', 'home-inline-type-switch');
  const mBtn = el('button', 'home-inline-pill' + (state.home.tab === 'movie' ? ' active' : ''), '🎬 Фільми');
  const tBtn = el('button', 'home-inline-pill' + (state.home.tab === 'tv' ? ' active' : ''), '📺 Серіали');
  mBtn.type = 'button'; tBtn.type = 'button';
  mBtn.addEventListener('click', () => {
    if (state.home.tab === 'movie') return;
    state.home.tab = 'movie';
    try { localStorage.setItem('mycinema.home.tab', 'movie'); } catch (e) {}
    state.home.shown.movie = 14;
    renderHomeContent(taste);
  });
  tBtn.addEventListener('click', () => {
    if (state.home.tab === 'tv') return;
    state.home.tab = 'tv';
    try { localStorage.setItem('mycinema.home.tab', 'tv'); } catch (e) {}
    state.home.shown.tv = 14;
    renderHomeContent(taste);
  });
  sw.append(mBtn, tBtn);
  return sw;
}

function renderHomeContent(taste) {
  if (state.tab !== 'home') return;
  if (!state.home.view) {
    try { state.home.view = localStorage.getItem('mycinema.home.view') || 'my'; } catch { state.home.view = 'my'; }
  }
  box.replaceChildren(); box.style.padding = '0';

  const viewBarWrap = el('div', 'home-view-switch-wrap');
  const viewBar = el('div', 'home-view-switch');
  const myPill = el('button', 'home-view-pill' + (state.home.view === 'my' ? ' active' : ''), '✨ Для мене');
  const trPill = el('button', 'home-view-pill' + (state.home.view === 'explore' ? ' active' : ''), '🌍 Тренди');
  myPill.type = 'button'; trPill.type = 'button';
  myPill.addEventListener('click', () => {
    if (state.home.view === 'my') return;
    state.home.view = 'my';
    try { localStorage.setItem('mycinema.home.view', 'my'); } catch {}
    renderHomeContent(taste);
  });
  /* EXPLORE_CLICK_TRIGGER */
  trPill.addEventListener('click', () => {
    if (state.home.view === 'explore') return;
    state.home.view = 'explore';
    try { localStorage.setItem('mycinema.home.view', 'explore'); } catch {}
    if (!state.home.general) {
      loadHome();
    } else {
      renderHomeContent(taste);
    }
  });
  viewBar.append(myPill, trPill);
  viewBarWrap.append(viewBar);
  box.append(viewBarWrap);

  if (state.home.view === 'my') {
    box.append(renderTasteSummary(taste || computeTasteVector()));
  }

  const wrap = el('div', 'home-wrap');

  if (state.home.view === 'my') {
    const factCard = buildFactOfDayCard();
    if (factCard) wrap.append(factCard);

    const recs = state.home.recs;
    if (recs && recs.seeds > 0) {
      const sec = el('section', 'home-section');
      const head = el('div', 'section-head');
      head.style.alignItems = 'center';
      head.append(el('h2', 'section-title', '✨ Для тебе'));
      head.append(buildHomeTypeSwitch(taste));
      sec.append(head);

    // Єдиний блок режимів видачі та настрою під «Для тебе»
    const controlsBar = el('div', 'recs-controls-bar');
    const modesBar = el('div', 'recs-mode-pills');
    const modeDefs = [
      { id: 'balance', label: '✨ Баланс' },
      { id: 'gems', label: '💎 Перлини' },
      { id: 'fresh', label: '🆕 Свіже' }
    ];
    modeDefs.forEach(m => {
      const mb = el('button', 'recs-mode-pill' + ((state.home.mode || 'balance') === m.id ? ' active' : ''), m.label);
      mb.type = 'button';
      mb.addEventListener('click', () => {
        if ((state.home.mode || 'balance') === m.id) return;
        state.home.mode = m.id;
        try { localStorage.setItem('mycinema.home.mode', m.id); } catch (e) {} /* FIX-MODE-SAVE */
        state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */;
        refresh();
      });
      modesBar.append(mb);
    });
    controlsBar.append(modesBar, renderMoodPills());
    sec.append(controlsBar);

    const type = state.home.tab;
    const allItems = recs.items.filter(x => x.type === type && !(typeof isTrackedInLib === 'function' ? isTrackedInLib(x.key) : !!lib[x.key]) && !(typeof isDismissed === 'function' && isDismissed(x.key)));
    const shownCount = state.home.shown[type] || 14 /* FIX-SHOWN-14 */;
    const visibleItems = allItems.slice(0, shownCount);

    if (visibleItems.length) {
      const grid = el('div', 'home-grid');
      visibleItems.forEach(item => grid.append(recCard(item, true)));
      sec.append(grid);
    } else {
      sec.append(el('div', 'home-note', 'Немає рекомендацій у цьому режимі. Спробуй «Баланс» або інший настрій.'));
    }

    if (allItems.length > shownCount) {
      const moreBtn = el('button', 'home-more', 'Показати ще');
      /* FIX-SHOWMORE */
      moreBtn.addEventListener('click', () => {
        const grid = sec.querySelector('.home-grid');
        const current = state.home.shown[type] || 14 /* FIX-SHOWN-14 */;
        const fresh = (state.home.recs?.items || []).filter(x => x.type === type && !(typeof isTrackedInLib === 'function' ? isTrackedInLib(x.key) : !!lib[x.key]) && !(typeof isDismissed === 'function' && isDismissed(x.key)));
        const nextShown = Math.min(fresh.length, current + 14) /* FIX-SHOWN-14 */;
        if (grid) fresh.slice(current, nextShown).forEach(item => grid.append(recCard(item, true)));
        state.home.shown[type] = nextShown;
        if (nextShown >= fresh.length) moreBtn.remove();
      });
      sec.append(moreBtn);
    }

    /* FIX-RECS-AGE */
    let _cacheAge = '';
    try {
      const _c = typeof mcCacheGet === 'function' ? mcCacheGet(RECS_CACHE, null) : JSON.parse(localStorage.getItem(RECS_CACHE));
      if (_c && _c.ts) {
        const _hrs = Math.floor((Date.now() - _c.ts) / 3600000);
        if (_hrs < 1) _cacheAge = ' (щойно)';
        else if (_hrs < 24) _cacheAge = ` (${_hrs} год. тому)`;
        else _cacheAge = ` (${Math.floor(_hrs / 24)} дн. тому)`;
      }
    } catch (e) {}
    const refreshBtn = el('button', 'home-more', '🔄 Оновити рекомендації' + _cacheAge);
    refreshBtn.style.marginTop = '12px';
    refreshBtn.style.background = 'transparent';
    refreshBtn.style.border = '1px solid var(--bg-3)';
    refreshBtn.addEventListener('click', () => {
      if (typeof mcCacheDel === 'function') mcCacheDel(RECS_CACHE);
      state.home.refreshNonce = (state.home.refreshNonce || 0) + 1;
      state.home.sig = null; state.home.recs = null;
      state.home.shown = { movie: 14, tv: 14 } /* FIX-SHOWN-14 */;
      state.home.genShown = {}; /* FIX-GENSHOWN-RESET */
      refresh();
      showSyncToast('✨ Оновлено');
    });
    sec.append(refreshBtn);
    wrap.append(sec);

  } else if (recs && recs.seeds === 0) {
    const sec = el('section', 'home-section');
    sec.append(el('h2', 'section-title', '✨ Для тебе'));
    sec.append(el('div', 'home-note', 'Постав оцінку 7+ або ❤️ улюбленому фільму чи серіалу — і тут з\'являться персональні рекомендації.'));
    wrap.append(sec);
  }

    const plannedSec = buildPlannedByMoodSection();
    if (plannedSec) wrap.append(plannedSec);
  }

  if (state.home.view === 'explore' && !state.home.general) {
    wrap.append(el('div', 'avail-empty', 'Підбірки зараз недоступні офлайн або ще завантажуються.'));
  }
  if (state.home.view === 'explore' && state.home.general) {
    const exploreHead = el('div', 'section-head');
    exploreHead.style.alignItems = 'center';
    exploreHead.append(el('h2', 'section-title', '🌍 Тренди і платформи'));
    exploreHead.append(buildHomeTypeSwitch(taste));
    wrap.append(exploreHead);
    const g = state.home.general;
    if (!state.home.genShown) state.home.genShown = {};

    const renderBlock = (blockId, title, sub, items, opts) => {
      if (!items || !items.length) return;
      const s = el('section', 'home-section');
      const head = el('div', 'section-head');
      const h2 = el('h2', 'section-title');
      if (opts && opts.logo) {
        const img = el('img', 'stream-head-logo');
        img.src = TMDB_IMG + 'w154' + opts.logo;
        img.alt = title;
        img.loading = 'lazy';
        h2.append(img);
      } else if (opts && opts.isOther) {
        const ic = document.createElement('span');
        ic.className = 'stream-head-icon';
        ic.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>';
        h2.append(ic);
      }
      h2.append(el('span', '', title));
      head.append(h2);
      if (sub) head.append(el('span', 'section-sub', sub));
      s.append(head);

      const grid = el('div', 'home-grid');
      let shown = state.home.genShown[blockId] || 10;
      items.slice(0, shown).forEach(item => grid.append(recCard(item, false)));
      s.append(grid);

      if (items.length > shown) {
        const moreBtn = el('button', 'home-more', 'Показати ще');
        moreBtn.type = 'button';
        moreBtn.addEventListener('click', () => {
          const nextShown = Math.min(items.length, shown + 20);
          items.slice(shown, nextShown).forEach(item => grid.append(recCard(item, false)));
          shown = nextShown;
          state.home.genShown[blockId] = shown;
          if (shown >= items.length) moreBtn.remove();
        });
        s.append(moreBtn);
      }
      wrap.append(s);
    };

    const tvGenrePref = {};
    Object.values(lib).forEach(x => {
      if (x.type !== 'tv') return;
      const avg = computeItemRating(x).avg;
      if (avg < 7 && !x.favorite) return;
      const w = ((avg || 8) / 10) * Math.max(0.2, tasteDecay(x.updated));
      (x.genres || []).forEach(gid => { tvGenrePref[gid] = (tvGenrePref[gid] || 0) + w; });
    });

    const mixTvStreamItems = (stream) => {
      const popPool = (stream.pop || []).filter(x => !(typeof isDismissed === 'function' && isDismissed(x.key)));
      const newPool = (stream.fresh || []).filter(x => !(typeof isDismissed === 'function' && isDismissed(x.key)));

      // Легка персоналізація популярного блоку: улюблені жанри вище, уже переглянуті/закинуті нижче
      const rankedPop = popPool
        .map((x, idx) => {
          const saved = lib[x.key];
          const seenPenalty = saved && (saved.status === 'watched' || saved.status === 'dropped') ? 100 : 0;
          let gBoost = 0;
          (x.genres || []).forEach(gid => { gBoost += (tvGenrePref[gid] || 0); });
          return { x, sortVal: idx - Math.min(gBoost, 4) * 1.2 + seenPenalty };
        })
        .sort((a, b) => a.sortVal - b.sortVal)
        .map(o => o.x);

      const maxItems = 50;
      const popPick = rankedPop.slice(0, 36);
      const usedKeys = new Set(popPick.map(x => x.key));
      const newPick = newPool.filter(x => !usedKeys.has(x.key)).slice(0, 20);

      // Пропорція 2:1 до maxItems (до 50 карток)
      const mixed = [];
      let pi = 0, ni = 0;
      while (mixed.length < maxItems && (pi < popPick.length || ni < newPick.length)) {
        if (pi < popPick.length && mixed.length < maxItems) mixed.push(popPick[pi++]);
        if (pi < popPick.length && mixed.length < maxItems) mixed.push(popPick[pi++]);
        if (ni < newPick.length && mixed.length < maxItems) mixed.push(newPick[ni++]);
      }
      return mixed;
    };

    if (state.home.tab === 'movie') {
      renderBlock('trMovies', '🔥 Популярні фільми', 'сьогодні', g.trMovies);
      renderBlock('newMovies', '🎬 Нові фільми', 'свіже', g.newMovies);
      renderBlock('topMovies', '🏆 Найрейтинговіші фільми', 'класика', g.topMovies);
    } else if (Array.isArray(g.tvStreams)) {
      g.tvStreams.forEach(st => {
        const mixed = mixTvStreamItems(st);
        renderBlock('tv-' + st.id, st.title, '', mixed, { logo: st.logo, isOther: st.id === 'other' });
      });
    }
  }

  box.append(wrap);
}

function buildFactOfDayCard() {
  if (typeof getFactOfDay !== 'function' || typeof isFactDismissedToday !== 'function') return null;
  if (isFactDismissedToday()) return null;
  const fact = getFactOfDay();
  if (!fact) return null;

  const card = el('div', 'fact-card');
  const head = el('div', 'fact-card-head');
  head.append(el('span', 'fact-card-badge', '🎞️ Факт дня'));

  const closeBtn = el('button', 'fact-card-close', '✕');
  closeBtn.type = 'button';
  closeBtn.title = 'Сховати до завтра';
  closeBtn.addEventListener('click', () => {
    dismissFactToday();
    card.classList.add('dismissing');
    setTimeout(() => card.remove(), 180);
  });
  head.append(closeBtn);
  card.append(head);

  card.append(el('div', 'fact-card-text', fact.text));

  if (fact.title && typeof openFactMedia === 'function') {
    const linkBtn = el('button', 'fact-card-link', `🎬 ${fact.title}${fact.year ? ' (' + fact.year + ')' : ''} →`);
    linkBtn.type = 'button';
    linkBtn.addEventListener('click', () => openFactMedia(fact));
    card.append(linkBtn);
  }
  return card;
}

const _nextEpSeasonCache = new Map();

function computeNextEpisode(item) {
  const eps = item.watchedEpisodes || [];
  if (!eps.length) return null;
  const parsed = eps.map(k => {
    const parts = String(k).split('-').map(Number);
    return (parts[0] > 0 && parts[1] > 0) ? { s: parts[0], e: parts[1] } : null;
  }).filter(Boolean).sort((a, b) => a.s - b.s || a.e - b.e);
  if (!parsed.length) return null;

  const last = parsed[parsed.length - 1];
  const sc = item.seasonCounts || {};
  const curMax = sc[last.s] || 0;
  let nextS = last.s;
  let nextE = last.e + 1;

  if (curMax > 0 && nextE > curMax) {
    const nextSeasonNum = last.s + 1;
    if (item.totalSeasons && nextSeasonNum > item.totalSeasons) {
      return { finished: true, s: last.s, e: last.e };
    }
    nextS = nextSeasonNum;
    nextE = 1;
  }
  return { finished: false, s: nextS, e: nextE, code: `S${nextS}E${String(nextE).padStart(2, '0')}` };
}

function buildContinueWatchingSection() {
  const watching = Object.values(lib).filter(x => x.type === 'tv' && x.status === 'watching' && x.watchedEpisodes && x.watchedEpisodes.length > 0).sort((a, b) => b.updated - a.updated).slice(0, 6);
  if (!watching.length) return null;
  const sec = el('section', 'home-section continue-watching-sec');
  const head = el('div', 'section-head');
  head.append(el('h2', 'section-title', '⏯️ Продовжити'));
  sec.append(head);
  const grid = el('div', 'home-grid');
  const todayIso = new Date().toISOString().slice(0, 10);

  watching.forEach(item => {
    const c = el('div', 'rec-card');
    const pWrap = el('div', 'rec-poster-wrap');
    const p = el('img', 'rec-poster');
    if (item.poster) p.src = TMDB_IMG + 'w342' + item.poster;
    pWrap.append(p);
    c.append(pWrap, el('div', 'row-title', item.title));

    const eps = item.watchedEpisodes || [];
    const tot = item.episode_count || 0;
    const pct = tot > 0 ? Math.min(100, Math.round((eps.length / tot) * 100)) : 0;
    const next = computeNextEpisode(item);

    if (next) {
      let targetS = next.s, targetE = next.e, targetCode = next.code;
      let qBtn = null;
      if (!next.finished) {
        qBtn = el('button', 'cw-next-btn', '+ ' + targetCode);
        qBtn.type = 'button';
        qBtn.title = `Позначити ${targetCode} переглянутою`;
        qBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const latest = lib[item.key] || item;
          const curEps = [...(latest.watchedEpisodes || [])];
          const epKey = `${targetS}-${targetE}`;
          if (!curEps.includes(epKey)) curEps.push(epKey);
          if (typeof updateCore === 'function') {
            updateCore(latest, { watchedEpisodes: curEps, status: latest.status === 'watched' ? 'watched' : 'watching' });
          }
          if (typeof showSyncToast === 'function') showSyncToast(`✅ ${targetCode}`);
          const freshCw = buildContinueWatchingSection();
          if (freshCw) sec.replaceWith(freshCw);
        });
        pWrap.append(qBtn);
      }

      const baseText = next.finished
        ? 'Усі серії переглянуто'
        : `Далі: ${next.code}` + (tot > 0 ? ` · ${pct}%` : '');
      const labelEl = el('div', 'rec-why', baseText);
      c.append(labelEl);

      if (!next.finished && item.id) {
        const cacheKey = `${item.id}:${next.s}`;
        const applySeasonData = (episodes) => {
          if (!episodes || !labelEl.isConnected) return;
          if (!item.seasonCounts?.[next.s] && episodes.length && lib[item.key]) {
            lib[item.key].seasonCounts = { ...(lib[item.key].seasonCounts || {}), [next.s]: episodes.length };
          }
          const epObj = episodes.find(ep => ep.episode_number === next.e);
          if (epObj) {
            if (epObj.air_date && epObj.air_date > todayIso) {
              const dt = new Date(epObj.air_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
              labelEl.textContent = `Чекаємо ${next.code} · ${dt}`;
              if (qBtn) qBtn.remove();
            } else if (epObj.name) {
              labelEl.textContent = `Далі: ${next.code} · ${epObj.name}`;
            }
          } else if (episodes.length > 0 && next.e > episodes.length) {
            const nextS = next.s + 1;
            const hasMoreSeasons = !item.totalSeasons || nextS <= item.totalSeasons;
            if (hasMoreSeasons) {
              targetS = nextS; targetE = 1; targetCode = `S${nextS}E01`;
              if (qBtn) { qBtn.textContent = '+ ' + targetCode; qBtn.title = `Позначити ${targetCode} переглянутою`; }
              labelEl.textContent = `Далі: ${targetCode}` + (tot > 0 ? ` · ${pct}%` : '');
            } else {
              labelEl.textContent = 'Сезон завершено';
              if (qBtn) qBtn.remove();
            }
          }
        };

        if (_nextEpSeasonCache.has(cacheKey)) {
          applySeasonData(_nextEpSeasonCache.get(cacheKey));
        } else {
          tmdbFetch(`/tv/${item.id}/season/${next.s}?language=uk-UA`)
            .then(d => {
              const epsArr = d.episodes || [];
              _nextEpSeasonCache.set(cacheKey, epsArr);
              applySeasonData(epsArr);
            })
            .catch(() => {});
        }
      }

      if (tot > 0) {
        const prog = el('div', 'item-progress');
        const fill = el('div', 'item-progress-fill');
        fill.style.width = pct + '%';
        prog.append(fill);
        c.append(prog);
      }
    }
    c.addEventListener('click', () => openCard(item));
    grid.append(c);
  });
  sec.append(grid);
  return sec;
}
````

---

## 8. `worker/README.md`

Контракт /imdb/batch, формат MDBList, порядок ротації ключів

````markdown
# MyCinema Worker — IMDb batch

Локальна база для ендпоїнту `/imdb/batch`. Ендпоїнт **задеплоєно** на
`https://mycinema-proxy.insaneteresh123.workers.dev/imdb/batch` (URL не змінився);
цей файл — вихідник, який вставляється в Cloudflare Worker
(Dashboard → Workers → `mycinema-proxy` → Edit code).

`worker/index.js` — повна заміна поточного воркера: логіка TMDB/OMDb-проксі
не змінилася, додано `POST /imdb/batch`. Усі ключі тепер читаються тільки з
CF secrets — у коді немає жодного ключа.

## Секрети (усі три обов'язкові)

| Secret | Використовується | Що ламається без нього |
|---|---|---|
| `MDBLIST_KEY` | `POST /imdb/batch` | `500 MDBLIST_KEY not configured`, клієнт падає на TMDB |
| `TMDB_KEY` | `GET /*` (каталог, discover, постери) | `500 TMDB_KEY not configured`, стрічка рекомендацій порожня |
| `OMDB_KEY` | `GET /omdb?i=...` | `500 OMDB_KEY not configured`, не працює пошук по IMDb-id |

```bash
wrangler secret put MDBLIST_KEY
wrangler secret put TMDB_KEY
wrangler secret put OMDB_KEY
```

> 🔑 Старі значення (MDBList потрапив у публічний коміт і чат; TMDB/OMDb були
> константами у вихідному коді воркера) — **ротуємо всі**. Живий воркер зараз
> ще працює на старих константах у задеплоєному коді, тому після ротації треба
> **спочатку виставити три нові секрети, а потім задеплоїти цей `index.js`**.
> Помилка в цьому порядку = усі маршрути воркера повертають помилку.
> APK перезбирати не потрібно: ключі в APK немає, він ходить на той самий URL.

## Що додано

| Метод | Шлях | Що робить |
|---|---|---|
| `POST` | `/imdb/batch` | `tmdb_id → { imdbId, imdbRating, imdbVotes }` пачкою |
| `OPTIONS` | будь-який | CORS preflight (додано `POST` до `Allow-Methods`) |

Старі шляхи (`/movie/550`, `/tv/1396`, `/omdb?i=tt...`) працюють як і раніше.

## Контракт

### Запит

```http
POST /imdb/batch
Content-Type: application/json

{ "movies": [278, 550, 155], "tv": [1396] }
```

Альтернативна форма (один тип):

```json
{ "ids": [278, 550], "type": "movie" }   // type: "movie" | "tv"
```

- до **400** унікальних ID на тип за один запит (різбито на чанки по 200 —
  ліміт MDBList);
- некоректні ID ігноруються, дублікати прибираються;
- якщо обидва масиви порожні → `400`.

### Відповідь

```json
{
  "ok": true,
  "data": {
    "movie": {
      "278": { "imdbId": "tt0111161", "imdbRating": 9.3, "imdbVotes": 3264913 }
    },
    "tv": {
      "1396": { "imdbId": "tt0903747", "imdbRating": 9.5, "imdbVotes": 2705323 }
    }
  },
  "missing": { "movie": [], "tv": [] },
  "errors": [],
  "meta": {
    "source": "mdblist",
    "requested": { "movie": 2, "tv": 1 },
    "found":     { "movie": 1, "tv": 1 },
    "cached":    { "movie": 0, "tv": 1 },
    "fetched":   { "movie": 1, "tv": 0 },
    "ts": 1763390000000
  }
}
```

- `imdbRating` — шкала **0..10** (як в IMDb), `imdbVotes` — кількість голосів;
- `missing` — ID, яких немає в MDBList або для яких немає `source: "imdb"`;
- `ok: false` означає, що **всі** чанки впали (квота/мережа) → клієнт робить
  fallback на TMDB для цього прогону;
- частковий успіх → `ok: true` + заповнений `errors[]` (клієнт бере що є,
  решту — з TMDB).

### Джерело й кеш

- MDBList: `POST https://api.mdblist.com/tmdb/{movie|show}?apikey=KEY`
  з тілом `{ "ids": [...], "append_to_response": ["ratings"] }`.
- Ключ читається **тільки** як `env.MDBLIST_KEY` (Cloudflare secret).
  Без нього `/imdb/batch` повертає `500 {"ok":false,"error":"MDBLIST_KEY not configured"}`.
- Кеш **7 днів**: якщо є KV-бinding `IMDB_CACHE` — використовується він;
  інакше — `caches.default` з синтетичним GET-ключем (працює одразу, без KV).
- Витрата квоти: 1 запит на кожні 200 ID на тип. Перевірено:
  `X-RateLimit-Remaining` зменшується на 1 за чанк; `/user` можна викликати
  для перевірки квоти без витрати.

## Деплой (порядок — важливо)

1. **Ротувати всі три ключі** в кабінетах MDBList / TMDB / OMDb.
2. **Виставити три нові секрети** (не вставляти ключі в код!):
   ```bash
   wrangler secret put MDBLIST_KEY
   wrangler secret put TMDB_KEY
   wrangler secret put OMDB_KEY
   ```
3. Вставити `worker/index.js` у `mycinema-proxy` у Cloudflare Dashboard, Deploy.
   ⚠️ Поки секрети не виставлені — не деплоїти: усі маршрути повертають `500`.
4. Опційно створити KV namespace `IMDB_CACHE` і прив'язати його в налаштуваннях
   воркера (інакше працює Cache API).
5. Перевірка всіх трьох маршрутів:
   ```bash
   curl -s -X POST https://mycinema-proxy.insaneteresh123.workers.dev/imdb/batch \
     -H 'Content-Type: application/json' \
     -d '{"movies":[278,550],"tv":[1396]}'
   curl -s 'https://mycinema-proxy.insaneteresh123.workers.dev/movie/550?language=uk-UA'
   curl -s 'https://mycinema-proxy.insaneteresh123.workers.dev/omdb?i=tt0903747'
   ```
   Усі мають повернути дані (не `500 ... not configured`). Старі ключі після
   ротації повертатимуть 401/429 — якщо таке бачиш, у задеплоєному коді ще константи.

## Наступні кроки (поки не робив)

- [x] `src/imdb-ratings.js` — клієнтський хелпер: виклик батчу, локальний
      кеш на 7 днів (`mcCacheGet/Set`), `ok:false` → fallback на TMDB.
      Покритий `tests/imdb-ratings.test.js` (7 тестів).
- [x] Підключення хелпера в `build.js` **перед** `src/home.js`.
- [x] Big-bang перехід математики на IMDb (residual у сідах і профілях акторів,
      `REC_PRIORS`, `imdbLoadFor()` для бібліотеки й пулу кандидатів).
- [x] Два фікси: насичення `b` режимними бонусами (`recBaseScore`) + mood-витік
      у `_sourceRaw` (`REC_MOOD_SOURCE_CAP`).
- [ ] Ротація **всіх трьох** ключів (MDBList / TMDB / OMDb) і виставлення CF
      secret `MDBLIST_KEY`, `TMDB_KEY`, `OMDB_KEY`, потім перезадеплой воркера
      (поза репо). APK перезбирати не потрібно — ключів у ньому немає.
````

---

## 9. `worker/index.js`

Вихідний код CF Worker (gitignored у репо; ключі лише в CF secrets)

````js
'use strict';

// ════════════════════════════════════════════════════════════════
// MyCinema Cloudflare Worker
//   • GET  /*              → TMDB proxy        (як було)
//   • GET  /omdb?i=tt...   → OMDb proxy        (як було)
//   • POST /imdb/batch     → IMDb rating+votes через MDBList (НОВЕ)
//
// ⚠️  Ключів у коді НЕМАЄ. Усі три читаються з CF secrets:
//       MDBLIST_KEY → POST /imdb/batch
//       TMDB_KEY    → GET /*         (TMDB proxy)
//       OMDB_KEY    → GET /omdb?...  (OMDb proxy)
//     Файл лишається в .gitignore, але навіть локально ключі не зберігаються.
//     Перед деплоєм: wrangler secret put <NAME> для кожного з трьох.
// ════════════════════════════════════════════════════════════════

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const OMDB_API_BASE = 'https://www.omdbapi.com';
const MDBLIST_API_BASE = 'https://api.mdblist.com';

const MDB_BATCH_SIZE = 200;      // ліміт MDBList: до 200 ID за запит
const MAX_IDS_PER_TYPE = 400;    // стеля на тип за один /imdb/batch (2 чанки)
const IMDB_CACHE_TTL = 604800;   // 7 днів, сек
const TTL_TMDB = 14400;
const TTL_OMDB = 86400;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...CORS, 'Content-Type': 'application/json;charset=utf-8' },
  });
}

// ── утиліти ─────────────────────────────────────────────────────
function parseId(v) {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function cleanIds(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const id = parseId(v);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
    if (out.length >= MAX_IDS_PER_TYPE) break;
  }
  return out;
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function cacheKey(type, id) { return `imdb:${type}:${id}`; }

// Кеш: KV, якщо є binding IMDB_CACHE; інакше Cache API (працює одразу після
// вставки воркера в CF Dashboard, без створення KV namespace).
async function cacheGet(env, type, id) {
  const k = cacheKey(type, id);
  try {
    if (env.IMDB_CACHE) {
      const v = await env.IMDB_CACHE.get(k, 'json');
      return v && Number(v.imdbRating) > 0 ? v : null;
    }
    const r = await caches.default.match(new Request(`https://imdb-cache.local/${k}`));
    return r ? await r.json() : null;
  } catch (_) {
    return null;
  }
}

async function cachePut(env, type, id, value) {
  const k = cacheKey(type, id);
  try {
    if (env.IMDB_CACHE) {
      await env.IMDB_CACHE.put(k, JSON.stringify(value), { expirationTtl: IMDB_CACHE_TTL });
    } else {
      await caches.default.put(
        new Request(`https://imdb-cache.local/${k}`),
        new Response(JSON.stringify(value), {
          headers: { 'Cache-Control': `public, max-age=${IMDB_CACHE_TTL}` },
        })
      );
    }
  } catch (_) {
    /* кеш не критичний — головне віддати відповідь */
  }
}

// MDBList: { ids:{ imdb, tmdb, ... }, ratings:[ { source:'imdb', value, votes } ] }
function pickImdb(item) {
  const rating = (item && Array.isArray(item.ratings))
    ? item.ratings.find(r => r && r.source === 'imdb' && Number(r.value) > 0)
    : null;
  if (!rating) return null;
  return {
    imdbId: (item.ids && item.ids.imdb) || null,
    imdbRating: Number(rating.value),                    // 0..10
    imdbVotes: Math.max(0, Number(rating.votes) || 0),
  };
}

async function fetchMdbBatch(apiKey, mdbType, ids) {
  const u = new URL(`${MDBLIST_API_BASE}/tmdb/${mdbType}`);
  u.searchParams.set('apikey', apiKey);
  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ ids, append_to_response: ['ratings'] }),
  });
  if (!res.ok) {
    throw new Error(`MDBList ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('MDBList: unexpected response shape');
  return data; // неіснуючі ID просто відсутні в масиві
}

async function resolveType(env, type, ids, apiKey, errors) {
  const mdbType = type === 'tv' ? 'show' : 'movie';
  const found = {};
  const stats = { cached: 0, fetched: 0 };
  const todo = [];

  const hits = await Promise.all(ids.map(id => cacheGet(env, type, id).then(v => [id, v])));
  for (const [id, hit] of hits) {
    if (hit) {
      found[String(id)] = hit;
      stats.cached++;
    } else {
      todo.push(id);
    }
  }

  await Promise.all(chunks(todo, MDB_BATCH_SIZE).map(async (group) => {
    try {
      const items = await fetchMdbBatch(apiKey, mdbType, group);
      for (const item of items) {
        const tmdbId = item && item.ids && parseId(item.ids.tmdb);
        if (!tmdbId) continue;
        const picked = pickImdb(item);
        if (!picked) continue;
        found[String(tmdbId)] = picked;
        stats.fetched++;
        await cachePut(env, type, tmdbId, picked);
      }
    } catch (e) {
      errors.push({ type, ids: group, error: String((e && e.message) || e) });
    }
  }));

  return {
    found,
    missing: ids.filter(id => !found[String(id)]),
    stats,
  };
}

async function handleImdbBatch(request, env, apiKey) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const buckets = { movie: cleanIds(body.movies), tv: cleanIds(body.tv) };
  if (!buckets.movie.length && !buckets.tv.length && Array.isArray(body.ids)) {
    const t = (body.type === 'tv' || body.type === 'show') ? 'tv' : 'movie';
    buckets[t] = cleanIds(body.ids);
  }
  if (!buckets.movie.length && !buckets.tv.length) {
    return json({ ok: false, error: 'No valid ids. Send { movies:[...], tv:[...] }' }, 400);
  }

  const errors = [];
  const [mv, tv] = await Promise.all([
    buckets.movie.length ? resolveType(env, 'movie', buckets.movie, apiKey, errors) : Promise.resolve(null),
    buckets.tv.length    ? resolveType(env, 'tv',    buckets.tv,    apiKey, errors) : Promise.resolve(null),
  ]);

  const data    = { movie: mv ? mv.found : {}, tv: tv ? tv.found : {} };
  const missing = { movie: mv ? mv.missing : [], tv: tv ? tv.missing : [] };
  const count = o => Object.keys(o).length;
  const anyFound = count(data.movie) + count(data.tv) > 0;

  return json({
    ok: errors.length ? anyFound : true, // частковий успіх → ok:true + errors[]
    data,
    missing,
    errors,
    meta: {
      source: 'mdblist',
      requested: { movie: buckets.movie.length, tv: buckets.tv.length },
      found:     { movie: count(data.movie), tv: count(data.tv) },
      cached:    { movie: mv ? mv.stats.cached : 0, tv: tv ? tv.stats.cached : 0 },
      fetched:   { movie: mv ? mv.stats.fetched : 0, tv: tv ? tv.stats.fetched : 0 },
      ts: Date.now(),
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    let path = url.pathname;

    // ── НОВЕ: IMDb batch ─────────────────────────────────────────
    if (path === '/imdb/batch' || path === '/imdb/batch/') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Use POST /imdb/batch' }, 405);
      }
      const apiKey = env.MDBLIST_KEY;
      if (!apiKey) {
        return json({ ok: false, error: 'MDBLIST_KEY not configured' }, 500);
      }
      return handleImdbBatch(request, env, apiKey);
    }

    // ── далі — незмінний старий проксі ──────────────────────────
    let targetUrl;
    let cacheTtl = TTL_TMDB;

    if (path.startsWith('/omdb')) {
      if (!env.OMDB_KEY) {
        return json({ ok: false, error: 'OMDB_KEY not configured' }, 500);
      }
      let omdbPath = path.slice('/omdb'.length) || '/';
      if (!omdbPath.startsWith('/')) omdbPath = '/' + omdbPath;
      targetUrl = new URL(OMDB_API_BASE + omdbPath);
      url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));
      targetUrl.searchParams.set('apikey', env.OMDB_KEY);
      cacheTtl = TTL_OMDB;
    } else {
      if (!env.TMDB_KEY) {
        return json({ ok: false, error: 'TMDB_KEY not configured' }, 500);
      }
      if (path.startsWith('/3/')) path = path.slice(2);
      targetUrl = new URL(TMDB_API_BASE + path);
      url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));
      targetUrl.searchParams.set('api_key', env.TMDB_KEY);
    }

    const cache = caches.default;
    const cacheKeyReq = new Request(targetUrl.toString(), request);
    const cachedResponse = await cache.match(cacheKeyReq);
    if (cachedResponse) return cachedResponse;

    const originResponse = await fetch(targetUrl.toString(), {
      headers: { 'Accept': 'application/json' },
      cf: { cacheTtl, cacheEverything: true },
    });

    const bodyText = await originResponse.text();
    const clientResponse = new Response(bodyText, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': `public, max-age=${cacheTtl}, stale-while-revalidate=86400`,
        'cf-cache-status': originResponse.status === 200 ? 'HIT' : 'MISS',
      },
    });

    if (originResponse.status === 200) {
      ctx.waitUntil(cache.put(cacheKeyReq, clientResponse.clone()));
    }
    return clientResponse;
  },
};
````

---

## 10. `tests/recs-math.test.js`

Тести чистих формул, включно з m=200 і log10-бонусом

````js
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
````

---

## 11. `tests/imdb-ratings.test.js`

Тести батчу/кешу/fallback IMDb-шару

````js
import { describe, it, expect, beforeEach, vi } from 'vitest';

function okResponse(data, extra) {
  return {
    ok: true,
    json: () => Promise.resolve({ ok: true, data, missing: { movie: [], tv: [] }, errors: [], meta: {}, ...extra }),
  };
}

const IMDbData = {
  movie: {
    278: { imdbId: 'tt0111161', imdbRating: 9.3, imdbVotes: 3264913 },
    550: { imdbId: 'tt0137523', imdbRating: 8.8, imdbVotes: 2683725 },
  },
  tv: {
    1396: { imdbId: 'tt0903747', imdbRating: 9.5, imdbVotes: 2705323 },
  },
};

describe('IMDb ratings client (imdb-ratings)', () => {
  beforeEach(() => {
    window.imdbClearCache();
    vi.restoreAllMocks();
  });

  it('imdbFetchBatch: шле POST на /imdb/batch і нормалізує відповідь', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(IMDbData));
    global.fetch = f;

    const res = await window.imdbFetchBatch([278, 550], [1396]);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe(String(window.PROXY_URL).replace(/\/$/, '') + '/imdb/batch');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ movies: [278, 550], tv: [1396] });
    expect(res.ok).toBe(true);
    expect(res.data.movie['278'].imdbRating).toBe(9.3);
  });

  it('imdbFetchBatch: не кидає помилку при офлайні/квоті', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const res = await window.imdbFetchBatch([278], []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/offline/);
    expect(res.data).toEqual({ movie: {}, tv: {} });
  });

  it('imdbLoadFor: кешує на 7 днів і не ходить у мережу вдруге', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(IMDbData));
    global.fetch = f;

    const first = await window.imdbLoadFor([278, 550], [1396]);
    expect(first.ok).toBe(true);
    expect(first.fetched).toBe(3);
    expect(f).toHaveBeenCalledTimes(1);

    const second = await window.imdbLoadFor([278, 550], [1396]);
    expect(f).toHaveBeenCalledTimes(1); // жодного нового запиту
    expect(second.fetched).toBe(0);
    expect(second.missing).toEqual({ movie: [], tv: [] });
    expect(second.data[window.imdbKey('movie', 278)].imdbRating).toBe(9.3);
    expect(second.data[window.imdbKey('tv', 1396)].imdbVotes).toBe(2705323);
  });

  it('imdbLoadFor: ok:false → fallback:true, кешоване не втрачається', async () => {
    global.fetch = vi.fn().mockResolvedValue(okResponse(IMDbData));
    await window.imdbLoadFor([278], [1396]); // прогріли кеш

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, error: 'quota', data: { movie: {}, tv: {} }, missing: { movie: [550], tv: [] }, errors: [] }),
    });
    const res = await window.imdbLoadFor([278, 550], [1396]);
    expect(res.ok).toBe(false);
    expect(res.fallback).toBe(true);
    expect(res.data[window.imdbKey('movie', 278)].imdbRating).toBe(9.3); // з кешу
    expect(res.data[window.imdbKey('movie', 550)]).toBeUndefined();        // немає → TMDB fallback
  });

  it('imdbLookup: прострочений запис не повертається', async () => {
    global.fetch = vi.fn().mockResolvedValue(okResponse(IMDbData));
    await window.imdbLoadFor([278], []);
    expect(window.imdbLookup('movie', 278)).not.toBeNull();

    const key = window.imdbKey('movie', 278);
    const cache = JSON.parse(localStorage.getItem(window.IMDB_CACHE_KEY) || '{}');
    cache[key].ts = Date.now() - window.IMDB_CACHE_TTL - 1000;
    localStorage.setItem(window.IMDB_CACHE_KEY, JSON.stringify(cache));

    expect(window.imdbLookup('movie', 278)).toBeNull();
  });

  it('imdbRef: IMDb має пріоритет, інакше TMDB з явним source', async () => {
    global.fetch = vi.fn().mockResolvedValue(okResponse(IMDbData));
    await window.imdbLoadFor([278], [1396]);

    expect(window.imdbRef({ id: 278, type: 'movie', tmdbRating: 8.6, votes: 1000 })).toEqual({
      rating: 9.3, votes: 3264913, imdbId: 'tt0111161', source: 'imdb',
    });
    expect(window.imdbRef({ id: 999, type: 'movie', tmdbRating: 7.2, votes: 50 })).toEqual({
      rating: 7.2, votes: 50, imdbId: null, source: 'tmdb',
    });
    expect(window.imdbRef({ id: 1396, name: 'Breaking Bad', tmdbRating: 8.9 })).toEqual({
      rating: 9.5, votes: 2705323, imdbId: 'tt0903747', source: 'imdb',
    });
  });

  it('дедуп і кап ID', async () => {
    const f = vi.fn().mockResolvedValue(okResponse({ movie: {}, tv: {} }));
    global.fetch = f;
    const ids = Array.from({ length: 500 }, (_, i) => i + 1).concat([1, 2, -5, 'abc']);
    await window.imdbFetchBatch(ids, []);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.movies.length).toBe(400);
    expect(body.movies[0]).toBe(1);
    expect(body.movies).not.toContain(-5);
  });
});
````

---

## 12. `tests/home-imdb.test.js`

Тести конвеєра: residual, backfill, gT, TMDB-фольбек у WR

````js
import { describe, it, expect, beforeEach, vi } from 'vitest';

function workerResponse(data) {
  return {
    ok: true,
    json: () => Promise.resolve({ ok: true, data, missing: { movie: [], tv: [] }, errors: [], meta: {} }),
  };
}

function makeItem(overrides) {
  return {
    key: 'movie-278',
    id: 278,
    type: 'movie',
    title: 'Test',
    status: 'watched',
    updated: Date.now(),
    tmdbRating: 7.0,
    votes: 40,
    ratings: { plot: 9, cast: 9, style: 9, emotions: 9, overall: 9 },
    ...overrides,
  };
}

describe('Home recommendations на IMDb (big bang)', () => {
  beforeEach(() => {
    window.imdbClearCache();
    vi.restoreAllMocks();
  });

  it('getSeeds: residual рахується від IMDb, а не від tmdbRating', async () => {
    global.fetch = vi.fn().mockResolvedValue(workerResponse({
      movie: { 278: { imdbId: 'tt0111161', imdbRating: 9.3, imdbVotes: 3264913 } },
      tv: {},
    }));
    await window.imdbLoadFor([278], []);

    window.lib = { 'movie-278': makeItem() };
    const seeds = window.getSeeds();
    expect(seeds.length).toBe(1);
    // avg 9.0 - IMDb 9.3 = -0.3 (було б 9.0 - 7.0 = +2.0)
    expect(seeds[0].residual).toBeCloseTo(-0.3, 6);
    expect(seeds[0].resFactor).toBeCloseTo(Math.max(0.3, 1 + (-0.3) / 2), 6);
  });

  it('getSeeds: без IMDb-даних лишається TMDB-фольбек', () => {
    window.lib = { 'movie-278': makeItem() };
    const seeds = window.getSeeds();
    expect(seeds[0].residual).toBeCloseTo(2.0, 6);
  });

  it('ensureLibraryImdb: підтягує всю бібліотеку до сідів', async () => {
    const f = vi.fn().mockResolvedValue(workerResponse({
      movie: { 278: { imdbId: 'tt0111161', imdbRating: 9.3, imdbVotes: 3264913 } },
      tv: {},
    }));
    global.fetch = f;
    window.lib = { 'movie-278': makeItem() };

    const res = await window.ensureLibraryImdb();
    expect(res.ok).toBe(true);
    expect(res.total).toBe(1);
    expect(window.imdbLookup('movie', 278).imdbRating).toBe(9.3);

    const seeds = window.getSeeds();
    expect(seeds[0].residual).toBeCloseTo(-0.3, 6);
  });

  it('buildSmartRecommendations: TMDB-фольбек WR m=200 і balance з log10 голосів', async () => {
    window.loadScript('src/api.js');
    window.imdbClearCache();
    window.lib = { 'movie-278': makeItem() };

    const seedDetail = {
      id: 278,
      credits: { crew: [], cast: [] },
      keywords: { keywords: [] },
      genres: [{ id: 18 }],
      recommendations: {
        results: [{
          id: 999, media_type: 'movie', title: 'Candidate', poster_path: '/x.jpg',
          vote_average: 7.5, vote_count: 30, popularity: 10,
          genre_ids: [18], release_date: '2020-01-01',
        }],
      },
    };
    window.tmdbFetch = vi.fn(async (url) =>
      url.includes('/movie/278') ? seedDetail : { results: [] });
    global.fetch = vi.fn().mockResolvedValue(workerResponse({ movie: {}, tv: {} }));

    const bayesSpy = vi.spyOn(window, 'recBayesRating');
    const balSpy = vi.spyOn(window, 'recBalanceBonus');
    const res = await window.buildSmartRecommendations(window.getSeeds(), null, 'balance');

    const bayesCall = bayesSpy.mock.calls.find(c => c[1] === 30);
    expect(bayesCall).toBeTruthy();
    expect(bayesCall[2]).toBe(0.63); // C movie
    expect(bayesCall[3]).toBe(200);  // m TMDB-фольбеку
    expect(balSpy).toHaveBeenCalled();
    expect(res.items.length).toBeGreaterThan(0);
  });

  it('computeActorProfiles: globalRefAvg береться з IMDb', async () => {
    global.fetch = vi.fn().mockResolvedValue(workerResponse({
      movie: {
        278: { imdbId: 'tt0111161', imdbRating: 9.3, imdbVotes: 1000 },
        550: { imdbId: 'tt0137523', imdbRating: 8.5, imdbVotes: 1000 },
      },
      tv: {},
    }));
    await window.imdbLoadFor([278, 550], []);

    window.lib = {
      'movie-278': makeItem({
        cast: [{ id: 1, name: 'A', profile_path: null }],
        ratings: { plot: 9, cast: 9, style: 9, emotions: 9, overall: 9 },
      }),
      'movie-550': makeItem({
        key: 'movie-550', id: 550,
        cast: [{ id: 1, name: 'A', profile_path: null }],
        ratings: { plot: 8, cast: 8, style: 8, emotions: 8, overall: 8 },
      }),
    };
    const prof = window.computeActorProfiles();
    // (9.3 + 8.5) / 2 = 8.9, а не (7.0 + 7.0) / 2 = 7.0
    expect(prof.globalRefAvg).toBeCloseTo(8.9, 6);
    expect(prof.globalTmdbAvg).toBeCloseTo(8.9, 6); // alias для сумісності
  });
});
````
