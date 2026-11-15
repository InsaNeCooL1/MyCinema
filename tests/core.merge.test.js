import { describe, it, expect } from 'vitest';

describe('mergeLibraries', () => {
  // ВАЖЛИВО: усі timestamp-и мають бути реалістичними (Date.now()-based).
  // Інакше tombstones із "старими" значеннями (наприклад, 100 = 1970 рік)
  // видаляються TTL-очищенням (> 90 днів) ДО того, як вони встигають
  // вплинути на фільтрацію. Це не баг коду — це контракт: tombstones
  // старші за TOMBSTONE_TTL (90 днів) вважаються "протухлими" і ігноруються.

  it('бере новішу версію (за updated) — cloud wins', () => {
    const now = Date.now();
    const local = { 'movie-1': { key: 'movie-1', title: 'A', updated: now - 1000 } };
    const cloud = { 'movie-1': { key: 'movie-1', title: 'B', updated: now } };
    const res = window.mergeLibraries(local, {}, cloud, {});
    expect(res.items['movie-1'].title).toBe('B');
  });

  it('local новіший за cloud → local wins', () => {
    const now = Date.now();
    const local = { 'movie-1': { key: 'movie-1', title: 'A', updated: now } };
    const cloud = { 'movie-1': { key: 'movie-1', title: 'B', updated: now - 1000 } };
    const res = window.mergeLibraries(local, {}, cloud, {});
    expect(res.items['movie-1'].title).toBe('A');
  });

  it('tombstone новіший за updated → видаляє', () => {
    const now = Date.now();
    const local = { 'movie-1': { key: 'movie-1', title: 'A', updated: now - 1000 } };
    const del = { 'movie-1': now };
    const res = window.mergeLibraries(local, del, {}, {});
    expect(res.items['movie-1']).toBeUndefined();
  });

  it('updated новіший за tombstone → зберігає', () => {
    const now = Date.now();
    const local = { 'movie-1': { key: 'movie-1', title: 'A', updated: now } };
    const del = { 'movie-1': now - 1000 };
    const res = window.mergeLibraries(local, del, {}, {});
    expect(res.items['movie-1'].title).toBe('A');
  });

  it('старі tombstones (> 90 днів) видаляються з мапи deleted', () => {
    const now = Date.now();
    const oldTs = now - 91 * 24 * 60 * 60 * 1000;
    const del = { 'movie-1': oldTs };
    const res = window.mergeLibraries({}, del, {}, {});
    expect(res.deleted['movie-1']).toBeUndefined();
  });

  it('свіжий tombstone + свіжий updated → item видаляється, tombstone лишається', () => {
    const now = Date.now();
    const local = { 'movie-1': { key: 'movie-1', title: 'A', updated: now - 1000 } };
    const del = { 'movie-1': now };
    const res = window.mergeLibraries(local, del, {}, {});
    expect(res.items['movie-1']).toBeUndefined();
    expect(res.deleted['movie-1']).toBe(now);
  });

  it('протухлий tombstone не видаляє старий item (TTL) — задокументована поведінка', () => {
    const now = Date.now();
    const ancient = now - 100 * 24 * 60 * 60 * 1000; // 100 днів тому
    const local = { 'movie-1': { key: 'movie-1', title: 'A', updated: ancient + 1000 } };
    const del = { 'movie-1': ancient + 2000 }; // теж стародавній tombstone
    const res = window.mergeLibraries(local, del, {}, {});
    // Обидва протухли; tombstone очищується, item виживає.
    expect(res.items['movie-1']).toBeDefined();
    expect(res.deleted['movie-1']).toBeUndefined();
  });
});
