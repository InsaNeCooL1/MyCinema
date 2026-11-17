# MyCinema Worker — IMDb batch

Локальна база для ендпоїнту `/imdb/batch`. Ендпоїнт **задеплоєно** на
`https://mycinema-proxy.insaneteresh123.workers.dev/imdb/batch` (URL не змінився);
цей файл — вихідник, який вставляється в Cloudflare Worker
(Dashboard → Workers → `mycinema-proxy` → Edit code).

`worker/index.js` — повна заміна поточного воркера: старий TMDB/OMDb-проксі
залишився недоторканим, додано лише `POST /imdb/batch`.

> ⚠️ **Ключів у коді немає.** MDBList-ключ читається тільки з CF secret
> `MDBLIST_KEY` (`env.MDBLIST_KEY`). `worker/index.js` не комітиться (див.
> `.gitignore`), але навіть у ньому ключ не зберігається — репо публічне.
>
> 🔑 Ключ, який використовувався раніше, потрапив у публічний коміт і в чат —
> **його треба ротувати** в кабінеті MDBList, після чого оновити CF secret:
> `wrangler secret put MDBLIST_KEY` і перезадеплоїти цю версію файлу.
> Живий воркер зараз ще працює на старому ключі з константи (у задеплоєному
> коді), тому після ротації його треба оновити — інакше `/imdb/batch` почне
> повертати помилку, а клієнт тихо впаде на TMDB.

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
- Ключ читається **тільки** як `env.MDBLIST_KEY` (Cloudflare secret).
  Без нього `/imdb/batch` повертає `500 {"ok":false,"error":"MDBLIST_KEY not configured"}`.
- Кеш **7 днів**: якщо є KV-бinding `IMDB_CACHE` — використовується він;
  інакше — `caches.default` з синтетичним GET-ключем (працює одразу, без KV).
- Витрата квоти: 1 запит на кожні 200 ID на тип. Перевірено:
  `X-RateLimit-Remaining` зменшується на 1 за чанк; `/user` можна викликати
  для перевірки квоти без витрати.

## Деплой (порядок)

1. **Спочатку ротувати MDBList-ключ** (кабінет MDBList → API keys → regenerate)
   й зберегти нове значення:
   ```bash
   wrangler secret put MDBLIST_KEY
   # ввести НОВИЙ ключ (не той, що був у чаті/коміті)
   ```
2. Вставити `worker/index.js` у `mycinema-proxy` у Cloudflare Dashboard, Deploy.
   Код очікує секрет `MDBLIST_KEY`; константи з ключем у файлі немає.
   ⚠️ Якщо задеплоїти до того, як виставити секрет, `/imdb/batch` відповість `500`.
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
- [x] Big-bang перехід математики на IMDb (residual у сідах і профілях акторів,
      `REC_PRIORS`, `imdbLoadFor()` для бібліотеки й пулу кандидатів).
- [x] Два фікси: насичення `b` режимними бонусами (`recBaseScore`) + mood-витік
      у `_sourceRaw` (`REC_MOOD_SOURCE_CAP`).
- [ ] Ротація MDBList-ключа й оновлення CF secret `MDBLIST_KEY` (поза репо).
