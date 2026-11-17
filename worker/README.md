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
