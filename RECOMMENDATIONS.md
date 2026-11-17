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
R=\frac{r_{\text{IMDb}}}{10},\qquad v=v_{\text{IMDb}},\qquad
\text{WR}=\frac{vR+mC}{v+m}
\]

| тип | `C` | `m` |
|---|---:|---:|
| movie | 0.63 | 2000 |
| tv | 0.72 | 800 |

Режимний бонус:

\[
\text{modeBonus}=
\begin{cases}
0.25\,g_v\,g_{\text{zone}} & \text{gems (IMDb), див. нижче}\\
\mathrm{clamp}\!\left(\frac{2500-v_{\text{TMDB}}}{2500},0,0.3\right) & \text{gems (TMDB-фольбек)}\\
\mathrm{clamp}\!\left(0.15\,(y-(Y-2)),0,0.3\right) & \text{fresh}\\
\min(\text{popularity}/250,\,0.2) & \text{balance}
\end{cases}
\]

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
v14-imdb | дата | nonce | сіди(strength,resFactor) | антисіди | виключення |
акторські корекції | сума акторських оцінок | настрій(weight) | режим |
digitalOnly | streamingOnlyUA
```

Офлайн-режим продовжує термін дії кешу recommendation і general.

---

## 11. Практичний приклад

Кандидат (movie): IMDb `8.8` при `15 000` голосах, популярність `120`, 2 recommendation-сіди, `genreMatch = 0.80`, актор `0.30`, режисер `0.20`, keyword `0.12`, `eloRaw = 0.7`, `moodBoost = 0.18`, `antiPenalty = 0.05`.

1. **Байєс:** `WR = (15000·0.88 + 2000·0.63)/17000 ≈ 0.8506`.
2. **balance:** `modeBonus = min(120/250, 0.2) = 0.20`, `baseRaw = 1.0506`.
3. **База:** `b = 0.82·σ(0.8506; 0.71, 7.5) + 0.18·(0.20/0.30) ≈ 0.7281`.
4. **Ознаки:** `s = σ(2.65; 1.40, 1.6) ≈ 0.8808`, `p = σ(1.42; 1.00, 2.5) ≈ 0.7408`, `e = σ(0.70; 0.50, 6) ≈ 0.7685`, `m = 0.18/0.60 = 0.30`.
5. **Скор:** `0.32·0.7281 + 0.26·0.8808 + 0.22·0.7408 + 0.08·0.7685 + 0.12·0.30 − 0.05 ≈ 0.6725`.
6. **Jitter:** `0.6325 … 0.7125`. Третій фільм тієї самої франшизи: `−0.08 → ≈ 0.5925`.

---

## 12. Де крутити ручки

| Хочеш… | Де міняти |
|---|---|
| вплив настрою | `MOODS.weight`, `REC_MOOD_FULL`, `REC_MOOD_SOURCE_CAP` |
| баланс ознак | `REC_WEIGHTS` у `src/recs-math.js` (сума = 1.0) |
| різкість ознак | `REC_SLOPES`, `REC_CENTERS` у `src/recs-math.js` |
| апріори IMDb | `REC_PRIORS` (окремо movie/tv) у `src/recs-math.js` |
| силу режиму в `b` | `REC_BASE_CENTER`, `REC_BASE_SLOPE`, `REC_MODE_SHARE` |
| планку перлин | `recGemBonus()` у `src/recs-math.js` |
| затухання смаку | `TASTE_HALFLIFE_DAYS` у `src/config.js` |
| число/вагу сідів | `getSeeds()` у `src/home.js` |
| різноманіття | блок `Diversity` у `src/home.js` |
| TTL IMDb-кешу | `IMDB_CACHE_TTL`, `IMDB_CACHE_MAX` у `src/imdb-ratings.js` |
| воркер/key | `PROXY_URL` у `src/config.js`, CF secret `MDBLIST_KEY` на воркері |

Чисті функції й IMDb-шар покриті тестами `tests/recs-math.test.js`, `tests/imdb-ratings.test.js`, `tests/home-imdb.test.js`.
