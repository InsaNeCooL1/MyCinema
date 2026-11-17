# План рефакторингу `styles.css`

> Робочий документ-памʼять. Спирається на `CSS-AUDIT.md`.
> Головне правило: **спочатку механічний поділ без зміни порядку**, і лише потім — смислова чистка.

## Чому не «розкласти за модулями» одразу

У файлі багато пізніх override-блоків (`FIX-…`, `STAGE…`). Якщо перенести, наприклад, усі стилі картки в один `card.css`, а потім усі `@media` в кінець, каскад зміниться: правило, яке раніше програвало через порядок, почне вигравати. Візуально це виглядає як «рефакторинг нічого не зламав», а насправді ламає окремі екрани.

Тому етап A — **розрізати файл на послідовні шматки в тому самому порядку**. Це вже дає файли по 100–480 рядків замість 3351, але не чіпає каскад.

## Етап A — поділ зі збереженням порядку

| Файл | Рядки `styles.css` | Що всередині |
|---|---:|---|
| `styles/00-foundation.css` | 1–137 | reset, `:root`, typography, header/search, sidebar, auth/filters |
| `styles/01-home-intro.css` | 138–242 | home page, taste summary, початкові відступи/плитки |
| `styles/10-card.css` | 243–722 | card mobile UI, hero/title/actions/statuses/tabs, streams, desktop card |
| `styles/20-desktop-stats.css` | 723–947 | desktop shell, person card, stats/game/modals/zoom, onboarding |
| `styles/30-effects-misc.css` | 948–1193 | desktop media, calendar, ripple, toast, continue/history, snow |
| `styles/40-nav.css` | 1194–1524 | top menu groups v3, dropdowns, mobile accordion, desktop nav overrides |
| `styles/50-home-stats.css` | 1525–1752 | recs v2, modes, progress, streaming, heatmap, calendar summary |
| `styles/60-perf-home.css` | 1753–1972 | perf/FPS, search cancel, taste expand, mood overflow |
| `styles/70-fixes-settings.css` | 1973–2144 | card hero stop, actor button, search glass, release badge, settings |
| `styles/80-notes-card.css` | 2145–2407 | quick note, notes timeline/feed, card back button |
| `styles/90-layout-safe.css` | 2408–2538 | safe-area, desktop grid, studios |
| `styles/95-layout-a11y.css` | 2539–2707 | desktop layout restore, focus ring, no-touch-highlight |
| `styles/97-modals.css` | 2708–2966 | reactions modal, missing UI CSS |
| `styles/99-final.css` | 2967–3351 | company/obs, skeleton avatar, countries, transitions, obs share |

Межі — це початки top-level коментарів; жоден блок не розрізається посередині правила.

### Як збирати

- `styles/*.css` — джерело, `styles.css` — **генерований** файл (у шапці писати `GENERATED — edit styles/*.css`).
- `build.js` перед копіюванням у `www/` конкатенує файли в порядку імен.
- Порядок фіксується явним списком у `build.js`, а не `readdir` (щоб `10-` не опинився після `2-`).
- Перший прогін: конкатенація має дати **байт-у-байт** той самий `styles.css`, крім доданої шапки. Це головна перевірка етапу A.

### Перевірка після кожного кроку

1. `node build.js` — без помилок.
2. Різниця: `diff` старого і нового `styles.css` показує лише очікувані зміни.
3. `npm test` — 64 тести.
4. Візуально: головна, бібліотека, картка фільму, картка серіалу, статистика, налаштування, нотатки, календар (APK/WebView).

## Етап B — смислова чистка (окремими маленькими кроками)

Порядок безпеки:

1. **Токени**: `rgba(255,255,255,.04)` та подібні білі overlay-и → `--white-04`, `--white-08`; literal `#ff5c5c` → `var(--danger)`.
2. **Мертві CSS-змінні**: `--rose`, `--tmdb`, `--imdb`, `--rt`, `--shadow`, `--r-full` — видалити після повторної перевірки JS.
3. **Дрібні структурні**: 3 повторні декларації, порожніх правил немає.
4. **`!important`**: починати з найгарячішого блоку `@media (min-width: 900px) and (min-height: 600px)` (там 14×`display`, 12×`height`, 12×`padding`). По одній властивості за крок.
5. **Класи-кандидати**: `mood-section`, `card-hero-stop`, `desktop-block-title`, `desktop-similar-block` — перевірити, чи не залишилися в старій розмітці; `lvl-1…4` не чіпати (будуються в `stats.js`).
6. **Breakpoints**: 900/899 — це пара mobile-first/desktop, залишити; 520 і 1200 — точкові, обʼєднати лише за потреби.

## Стоп-точки для контексту

Після кожного файлу зі `styles/` або кожного пункту етапу B стан фіксується тут: що зроблено, що перевірено, що лишилось. Нову сесію можна починати з `CSS-AUDIT.md` + цього файлу, не читаючи весь CSS.

## Поточний стан

- [x] Аудит `styles.css` → `CSS-AUDIT.md`
- [x] Етап A: створено `styles/*.css` (14 файлів), `build.js` конкатенує їх у `styles.css`
  - Конкатенація до рефакторингу збіглася з оригіналом **байт-у-байт** (SHA-256 `72b2f0d6…`).
  - `npm run build` — OK, `lightningcss` — 0 warnings, `npm test` — 64 passed.
  - `styles.css` тепер генерований: у шапці є попередження `Do not edit`.
- [x] Етап B, крок 1: прибрано 6 невикористаних токенів (`--rose`, `--tmdb`, `--imdb`, `--rt`, `--shadow`, `--r-full`) і замінено literal `#ff5c5c` на `var(--danger)` у 3 місцях
  - `npm run build` — OK, `lightningcss` — 0 warnings, `npm test` — 64 passed.
  - Візуальних змін немає: `--danger` має те саме значення.
- [ ] Етап B, крок 2: білі overlay-кольори → токени (`--white-04`, `--white-08` тощо)
- [ ] Етап B, крок 3: `!important` у desktop-media
- [ ] Етап B, крок 4: мертві класи (`mood-section`, `card-hero-stop`, `desktop-block-title`, `desktop-similar-block`)
