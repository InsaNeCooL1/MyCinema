# MyCinema Worker — IMDb batch

Локальна база для ендпоїнту `/imdb/batch`. **Не задеплоєно** — це файл, який ти
вставляєш у Cloudflare Worker (Dashboard → Workers → `mycinema-proxy` → Edit code).

`worker/index.js` — повна заміна поточного воркера: старий TMDB/OMDb-проксі
залишився недоторканим, додано лише `POST /imdb/batch`.

> ⚠️ `worker/index.js` **не комітиться** (див. `.gitignore`) — усередині API-ключ
> MDBList. Репо на GitHub, тому ключ має лишитися тільки на воркері.

## Що додано

| Метод | Шлях | Що робить |
|---|---|---|
| `POST` | `/imdb/batch` | `tmdb_id → { imdbId, imdbRating, imdbVotes }` пачкою |
| `OPTIONS` | будь-який | CORSpreflight (додано `POST` до `Allow-Methods`) |

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
- Ключ читається як `env.MDBLIST_KEY`, інакше береться з константи у файлі.
- Кеш **7 днів**: якщо є KV-бinding `IMDB_CACHE` — використовується він;
  інакше — `caches.default` з синтетичним GET-ключем (працює одразу, без KV).
- Витрата квоти: 1 запит на кожні 200 ID на тип. Перевірено:
  `X-RateLimit-Remaining` зменшується на 1 за чанк; `/user` можна викликати
  для перевірки квоти без витрати.

## Деплой (порядок)

1. Вставити `worker/index.js` у `mycinema-proxy` у Cloudflare Dashboard, Deploy.
2. **Бажано** замість константи зробити секрет:
   ```bash
   wrangler secret put MDBLIST_KEY
   # ввести: l3p9jo493pa2i7phupvh5cm8k
   ```
   і видалити рядок `const MDBLIST_KEY = '...'` — лишиться `env.MDBLIST_KEY`.
3. Опційно створити KV namespace `IMDB_CACHE` і прив'язати його в налаштуваннях
   воркера (інакше працює Cache API).
4. Перевірка:
   ```bash
   curl -X POST https://mycinema-proxy.insaneteresh123.workers.dev/imdb/batch \
     -H 'Content-Type: application/json' \
     -d '{"movies":[278,550],"tv":[1396]}'
   ```

## Наступні кроки (поки не робив)

- [x] `src/imdb-ratings.js` — клієнтський хелпер: виклик батчу, локальний
      кеш на 7 днів (`mcCacheGet/Set`), `ok:false` → fallback на TMDB.
      Покритий `tests/imdb-ratings.test.js` (7 тестів).
- [x] Підключення хелпера в `build.js` **перед** `src/home.js`.
- [ ] Big-bang перехід математики на IMDb (residual у сідах і профілях акторів).
- [ ] Два фікси: насичення `b` режимними бонусами + mood-витік у `_sourceRaw`.
