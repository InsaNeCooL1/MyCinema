import { describe, it, expect, beforeEach } from 'vitest';

/* Тести повного циклу reconcileWithCloud без реального Supabase.
   Мок імітуєuser_library + profiles і записує відправлені рядки. */

function makeQuery(result) {
  const q = {};
  q.select = () => q;
  q.eq = () => q;
  q.in = () => q;
  q.single = () => Promise.resolve(result);
  q.then = (ok, err) => Promise.resolve(result).then(ok, err);
  return q;
}

function mockSupabase(opts) {
  const rows = [];
  const deletedKeys = [];
  const profileRows = [];
  const items = opts.items || [];
  const profile = opts.profile || null;

  window.supabase = {
    from(table) {
      if (table === 'user_library') {
        const q = makeQuery({ data: items, error: null });
        q.upsert = (data) => { rows.push(...data); return Promise.resolve({ error: null }); };
        q.delete = () => {
          const dq = makeQuery({ data: null, error: null });
          dq.in = (field, keys) => { deletedKeys.push(...keys); return Promise.resolve({ error: null }); };
          return dq;
        };
        return q;
      }
      if (table === 'profiles') {
        const res = profile
          ? { data: profile, error: null }
          : { data: null, error: { code: 'PGRST116' } };
        const q = makeQuery(res);
        q.upsert = (data) => { profileRows.push(data); return Promise.resolve({ error: null }); };
        return q;
      }
      return makeQuery({ data: null, error: null });
    }
  };
  return { rows, deletedKeys, profileRows };
}

describe('reconcileWithCloud — втрати даних бути не повинно', () => {
  beforeEach(() => {
    window.currentUser = { uid: 'u1', email: 'u@test.dev' };
    window.firebaseReady = true;
    window.lib = {};
    window.libTombstones = {};
    window._dirtyItems = new Set();
  });

  it('воскрешений тайтл потрапляє в хмару, а не видаляється через старий tombstone', async () => {
    const now = Date.now();
    window.lib = { 'movie-r': { key: 'movie-r', title: 'Повернутий', updated: now } };
    window.libTombstones = { 'movie-r': now - 1000 };
    const spy = mockSupabase({ items: [] });

    await window.reconcileWithCloud();

    expect(spy.rows.some(r => r.item_key === 'movie-r')).toBe(true);
    expect(spy.deletedKeys).not.toContain('movie-r');
    expect(window.libTombstones['movie-r']).toBeUndefined();
  });

  it('зберігає локальну оцінку, навіть якщо хмара має новіший updated', async () => {
    const now = Date.now();
    window.lib = {
      'movie-s': {
        key: 'movie-s', updated: now - 5000,
        ratings: { overall: 9 }, ratingUpdated: now - 1000
      }
    };
    const spy = mockSupabase({
      items: [{
        item_key: 'movie-s',
        user_data: { key: 'movie-s', updated: now, status: 'watched', statusDate: now, ratings: null }
      }]
    });

    await window.reconcileWithCloud();

    const sent = spy.rows.find(r => r.item_key === 'movie-s');
    expect(sent).toBeTruthy();
    expect(sent.user_data.ratings.overall).toBe(9);
    expect(sent.user_data.status).toBe('watched');
  });

  it('не знімає прапорець із ключа, зміненого під час відправки', async () => {
    const now = Date.now();
    window.lib = { 'movie-d': { key: 'movie-d', updated: now, notes: 'версія 1' } };
    window._dirtyItems.add('movie-d');

    const spy = mockSupabase({ items: [] });
    const originalFrom = window.supabase.from;
    window.supabase.from = (table) => {
      const q = originalFrom(table);
      if (table === 'user_library' && q.upsert) {
        const upsert = q.upsert;
        q.upsert = (data) => {
          /* імітуємо правку картки, поки запит у польоті */
          window.lib['movie-d'] = { key: 'movie-d', updated: now + 1, notes: 'версія 2' };
          return upsert(data);
        };
      }
      return q;
    };

    await window.reconcileWithCloud();

    expect(window._dirtyItems.has('movie-d')).toBe(true);
  });
});
