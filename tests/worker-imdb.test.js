import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../worker/index.js';

function makeKV() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null)),
    put: vi.fn(async (k, v) => { store.set(k, v); }),
  };
}

function makeD1() {
  const store = new Map();
  const calls = { selects: [], batches: [] };
  return {
    calls,
    prepare(sql) {
      const stmt = {
        sql,
        params: [],
        bind(...params) { stmt.params = params; return stmt; },
        async all() {
          calls.selects.push({ sql: stmt.sql, params: [...stmt.params] });
          const type = stmt.params[0];
          return {
            results: stmt.params.slice(1)
              .map(id => store.get(`${type}|${Number(id)}`))
              .filter(Boolean),
          };
        },
      };
      return stmt;
    },
    async batch(stmts) {
      calls.batches.push(stmts.map(s => ({ sql: s.sql, params: [...s.params] })));
      for (const s of stmts) {
        const [type, id, miss, payload, ts] = s.params;
        store.set(`${type}|${id}`, { tmdb_id: Number(id), miss, payload, ts });
      }
    },
  };
}

function mockMdb({ movie = [], show = [] } = {}) {
  return vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).includes('/tmdb/show') ? show : movie),
  }));
}

async function post(env, body) {
  const req = new Request('https://example.com/imdb/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, { waitUntil() {} });
  return { status: res.status, json: await res.json() };
}

const HIT = {
  ids: { tmdb: 278, imdb: 'tt0111161' },
  ratings: [{ source: 'imdb', value: 9.3, votes: 3264913 }],
};

describe('worker /imdb/batch — D1 + KV-шарди + негативний кеш', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('KV: ≤16 ключів замість 1 ключа на ID, а missing і hit переживають другий запит', async () => {
    const env = { MDBLIST_KEY: 'k', IMDB_CACHE: makeKV() };
    global.fetch = mockMdb({ movie: [HIT] });

    const first = await post(env, { movies: [278, 999], tv: [] });
    expect(first.status).toBe(200);
    expect(first.json.meta.cache).toBe('kv-shards');
    expect(first.json.data.movie['278'].imdbRating).toBe(9.3);
    expect(first.json.missing.movie).toEqual([999]);

    const puts = env.IMDB_CACHE.put.mock.calls;
    expect(puts.length).toBeGreaterThan(0);
    expect(puts.length).toBeLessThanOrEqual(16);
    expect(puts.every(c => /^imdb:v2:movie:s\d+$/.test(c[0]))).toBe(true);

    const callsBefore = global.fetch.mock.calls.length;
    const second = await post(env, { movies: [278, 999], tv: [] });
    expect(global.fetch.mock.calls.length).toBe(callsBefore); // MDBList не дергаємо
    expect(second.json.meta.cached.movie).toBe(1);
    expect(second.json.meta.negative.movie).toBe(1);
    expect(second.json.missing.movie).toEqual([999]);
    expect(second.json.data.movie['278'].imdbRating).toBe(9.3);
  });

  it('D1: один SELECT + один batch INSERT, включно з негативним записом', async () => {
    const db = makeD1();
    const env = { MDBLIST_KEY: 'k', IMDB_DB: db };
    global.fetch = mockMdb({ movie: [HIT] });

    const first = await post(env, { movies: [278, 999], tv: [] });
    expect(first.json.meta.cache).toBe('d1');
    expect(db.calls.selects).toHaveLength(1);
    expect(db.calls.selects[0].sql).toMatch(/SELECT tmdb_id, miss, payload, ts FROM imdb_cache WHERE type = \?/);
    expect(db.calls.batches).toHaveLength(1);
    const rows = db.calls.batches[0];
    expect(rows).toHaveLength(2); // 278 + 999
    expect(rows.some(r => r.params[1] === 278 && r.params[2] === 0)).toBe(true);
    expect(rows.some(r => r.params[1] === 999 && r.params[2] === 1)).toBe(true);

    const callsBefore = global.fetch.mock.calls.length;
    const second = await post(env, { movies: [278, 999], tv: [] });
    expect(global.fetch.mock.calls.length).toBe(callsBefore);
    expect(second.json.meta.cached.movie).toBe(1);
    expect(second.json.meta.negative.movie).toBe(1);
    expect(second.json.missing.movie).toEqual([999]);
  });

  it('без KV/D1: працює, але чесно показує cache:none і ходить у MDBList щоразу', async () => {
    const env = { MDBLIST_KEY: 'k' };
    global.fetch = mockMdb({ movie: [HIT] });
    const first = await post(env, { movies: [278], tv: [] });
    const second = await post(env, { movies: [278], tv: [] });
    expect(first.json.meta.cache).toBe('none');
    expect(global.fetch.mock.calls.length).toBe(2);
    expect(second.json.meta.cached.movie).toBe(0);
  });

  it('(ID з чанка, що впав) НЕ потрапляє в missing і не отрулює негативний кеш', async () => {
    const env = { MDBLIST_KEY: 'k', IMDB_CACHE: makeKV() };
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));
    const res = await post(env, { movies: [278], tv: [] });
    expect(res.json.ok).toBe(false);
    expect(res.json.errors).toHaveLength(1);
    expect(res.json.missing.movie).toEqual([]);
    expect(env.IMDB_CACHE.put).not.toHaveBeenCalled();
  });

  it('негативний запис зістарюється через 24 год', async () => {
    const env = { MDBLIST_KEY: 'k', IMDB_CACHE: makeKV() };
    global.fetch = mockMdb({ movie: [] });
    const first = await post(env, { movies: [999], tv: [] });
    expect(first.json.missing.movie).toEqual([999]);

    const shardKey = env.IMDB_CACHE.put.mock.calls[0][0];
    const shard = JSON.parse(env.IMDB_CACHE.store.get(shardKey));
    shard.entries['999'].ts -= (7 * 24 * 60 * 60) + 1; // старше за miss TTL
    env.IMDB_CACHE.store.set(shardKey, JSON.stringify(shard));

    const callsBefore = global.fetch.mock.calls.length;
    await post(env, { movies: [999], tv: [] });
    expect(global.fetch.mock.calls.length).toBe(callsBefore + 1);
  });
});
