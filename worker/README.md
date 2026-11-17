# MyCinema Worker — IMDb batch

Локальна база для ендпоїнту `/imdb/batch`. Ендпоїнт **задеплоєно** на
`https://mycinema-proxy.insaneteresh123.workers.dev/imdb/batch` (URL не змінився);
цей файл — вихідник, який вставляється в Cloudflare Worker
(Dashboard → Workers → `mycinema-proxy` → Edit code).

`worker/index.js` — повна заміна поточного воркера: логіка TMDB/OMDb-проксі
не змінилася, додано `POST /imdb/batch`. Усі ключі читаються тільки з CF secrets —
у коді немає жодного ключа.

**AI-помічник через цей воркер більше не працює і не використовується.**
Користувач вставляє власний ключ Gemini API у Налаштування → AI-помічник,
а застосунок звертається до Google Gemini API напряму з пристрою.

## Секрети

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

> 🔑 Старі ключі зі старого файлу вже давно ротовані — нічого відкликати не треба.
> У новому `worker/index.js` ключів немає — тільки `env.*`. Порядок безпечний:
> спочатку виставити секрети, потім задеплоїти код. Якщо задеплоїти без секретів —
> маршрути повертатимуть `500`.

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
    "cache": "d1",
    "requested": { "movie": 2, "tv": 1 },
    "found":     { "movie": 1, "tv": 1 },
    "cached":    { "movie": 0, "tv": 1 },
    "negative":  { "movie": 0, "tv": 0 },
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
  решту — з TMDB);
- `missing` — лише **підтверджені** MDBList промахи. ID з чанка, що впав,
  туди не потрапляють, щоб помилка квоти не отруїла негативний кеш.

### Джерело й кеш

- MDBList: `POST https://api.mdblist.com/tmdb/{movie|show}?apikey=KEY`
  з тілом `{ "ids": [...], "append_to_response": ["ratings"] }`.
- Ключ читається **тільки** як `env.MDBLIST_KEY` (Cloudflare secret).
  Без нього `/imdb/batch` повертає `500 {"ok":false,"error":"MDBLIST_KEY not configured"}`.
- Витрата квоти: 1 запит на кожні 200 ID на тип. Перевірено:
  `X-RateLimit-Remaining` зменшується на 1 за чанк; `/user` можна викликати
  для перевірки квоти без витрати.

#### ⚠️ `caches.default` не працює на `*.workers.dev`

Cache API на доменах `*.workers.dev` — **no-op** (працює лише на прив'язаному
власному домені). Тому `/imdb/batch` **не** покладається на `caches.default`:
без KV/D1binding кожен запит іде прямо в MDBList. Поле `meta.cache` показує
активний бекенд: `d1`, `kv-shards` або `none`.

| Бекенд | Binding | Витрата на 400 холодних ID | Ліміт безкоштовного тарифу |
|---|---|---|---|
| **D1 (рекомендовано)** | `IMDB_DB` | 1 SELECT + 1 batch INSERT | 5 млн читань / 100 тис. записів на добу |
| KV (шарди) | `IMDB_CACHE` | ≤16 get + ≤16 put (16 ключів на тип) | 100 тис. читань / 1 тис. записів на добу |
| немає | — | 0 (кешу немає) | — |

Кеш **7 днів** для позитивних записів і **24 години** для `missing` —
негативний кеш в обох бекендах. Старий формат «1 ключ KV = 1 фільм» більше
не використовується (давав 600 операцій KV за один вхід).

**D1 — схема (Workers → D1 → Create database → console):**

```sql
CREATE TABLE IF NOT EXISTS imdb_cache (
  type TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  miss INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  PRIMARY KEY (type, tmdb_id)
);
```

Потім у `wrangler.toml` (або Settings → Variables → D1 Database Bindings):

```toml
[[d1_databases]]
binding = "IMDB_DB"
database_name = "mycinema-imdb"
database_id = "<з консолі CF>"
```

## Деплой (порядок — важливо)

1. **Виставити три секрети** (не вставляти ключі в код!):
   ```bash
   wrangler secret put MDBLIST_KEY
   wrangler secret put TMDB_KEY
   wrangler secret put OMDB_KEY
   ```
2. Вставити `worker/index.js` у `mycinema-proxy` у Cloudflare Dashboard, Deploy.
   ⚠️ Поки секрети не виставлені — не деплоїти: усі маршрути повертають `500`.
3. **Бажано до деплою**: створити D1-базу `mycinema-imdb` зі схемою вище і
   прив'язати її як `IMDB_DB`. Якщо D1 поки немає — створити KV namespace
   `IMDB_CACHE` (шардований кеш). Без одного з цих біндингів `/imdb/batch`
   працює, але **не кешується** на `workers.dev`.
4. Перевірка маршрутів:
   ```bash
   curl -s -X POST https://mycinema-proxy.insaneteresh123.workers.dev/imdb/batch \
     -H 'Content-Type: application/json' \
     -d '{"movies":[278,550],"tv":[1396]}'
   curl -s 'https://mycinema-proxy.insaneteresh123.workers.dev/movie/550?language=uk-UA'
   curl -s 'https://mycinema-proxy.insaneteresh123.workers.dev/omdb?i=tt0903747'
   ```
   Усі мають повернути дані (не `500 ... not configured`).

## AI-помічник — де він тепер

AI-частина винесена **зі воркера в застосунок**: ключ користувача не має
потрапляти на сервер, а всі AI-запити йдуть напряму з пристрою в Google.
У воркері **немає жодного AI-маршруту**, AI-секретів і hardcoded keys.

- Ключ вводиться в **Налаштування → AI-помічник → API-ключ Gemini**
  (`localStorage['mycinema.geminiKey']`, не синхронізується з хмарою).
- Автокаскад тимчасово вимкнено: у Налаштуваннях → AI-помічник можна вибрати
  конкретну модель. Вибір зберігається в `localStorage['mycinema.geminiModel']`,
  усі запити йдуть тільки на неї. Варіанти: `gemini-3.5-flash-lite` (типова)
  і `gemini-3.1-flash-lite`. Важкі `gemini-4-hydrogen`, `gemini-3.8-flash` та
  `gemini-3.6-flash` прибрані — вони надто «розумні» й лагають.
- Ліміти AI Studio → Rate limit (на проєкт, RPD): `500 + 500 = 1000`.
  Gemma 4 31B не використовується — відповідає надто довго.
- Якщо Google повертає `429`, модель ховається локально на `error.details[].retryDelay`
  (або до півночі Pacific, якщо поля немає), але autofallback вимкнено — показується
  дружнє повідомлення з пропозицією вибрати іншу модель. Повторний вибір тієї самої
  моделі знімає її локальне блокування. Лічильник запитів на пристрої не ведеться.
- `404`, `5xx`, порожня thought-only відповідь і мережеві помилки більше не
  перемикають модель: показується одне дружнє повідомлення. Точна остання помилка
  зберігається в `window.mcChat._state.lastApiError` і дублюється в консоль.
- Кнопка «Перевірити ключ» робить `GET /v1beta/models` — перевіряє ключ і доступні
  моделі, не витрачаючи токенів.
- Запит іде на `POST /v1beta/models/{model}:streamGenerateContent?alt=sse`
  з `generationConfig: { thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 8192 }`.
  Один запит на обрану модель: порожня thought-only відповідь не викликає
  повтор до тіє самої моделі.
- У текстовому чаті немає function calling, тому thought-частини й підписи
  не пересилаються назад в `contents`: історія містить тільки чистий текст.
  Відповідь обрізається до 6 речень / 900 символів як страхувальник промту.
- Промт гнучкий (soft constraint, без жорсткого «тільки зі списку»): поточний
  запит і відкрита картка важливіші за `context.recommendations.items`.
  Стрічка — пріоритетне джерело підказок, але перед порадою модель перевіряє
  кандидата за тоном і суттю, уявляє кожен тайтл у коротких тегах
  («медична драма», «цинічний детектив», «фантастичний екшен») і шукає збіг
  лише за релевантними тегами. Для запиту про серіал окремо перевіряються
  елементи з `type: "tv"` — не можна казати «серіалів немає», не переглянувши
  їх усіх. Якщо після чесного перегляду справді нічого не підходить — модель
  може радити з власних знань, прямо зазначивши, що тайтлу немає в стрічці.
  Тайтли з `taste.libraryTitles` (уже в бібліотеці) радити заборонено.
  Кожна порада містить 1–3 конкретні назви з роком — не самого лише вступу.
  Промт не скорочували — лайт-моделі працюють із ним добре.
- Для діагностики швидкості збираються таймінги, `usageMetadata` і `finishReason`:
  `window.mcChat._state.lastTiming` та `.timings` (останні 20 спроб).
- У Cloudflare жодних AI-секретів, KV для ліміту чи додаткових маршрутів не потрібно.

## Наступні кроки (поки не робив)

- [x] `src/imdb-ratings.js` — клієнтський хелпер: виклик батчу, локальний
      кеш на 7 днів (`mcCacheGet/Set`), `ok:false` → fallback на TMDB.
      Покритий `tests/imdb-ratings.test.js` (7 тестів).
- [x] Підключення хелпера в `build.js` **перед** `src/home.js`.
- [x] Big-bang перехід математики на IMDb (residual у сідах і профілях акторів,
      `REC_PRIORS`, `imdbLoadFor()` для бібліотеки й пулу кандидатів).
- [x] Два фікси: насичення `b` режимними бонусами (`recBaseScore`) + mood-витік
      у `_sourceRaw` (`REC_MOOD_SOURCE_CAP`).
- [ ] Виставити CF secret `MDBLIST_KEY`, `TMDB_KEY`, `OMDB_KEY` і задеплоїти
      `worker/index.js` (поза репо). Старі ключі вже ротовані, нічого відкликати не треба.
      Ключ Gemini API вводиться користувачем у застосунку — у воркері його немає.
