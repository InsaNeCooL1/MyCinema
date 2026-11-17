import { describe, it, expect, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
  window.loadScript('src/card/mobile.js');
});

function ratingsRow(omdb, type = 'movie') {
  const wrap = window.MC.createTitle({
    details: { title: 'Test', vote_average: 7.5, genres: [] },
    item: { key: 'movie-1', type },
    omdb,
  });
  return wrap.querySelector('.meta-ratings-wrap');
}

describe('Metacritic badge на картці фільму', () => {
  it('рендериться одразу після Rotten Tomatoes', () => {
    const row = ratingsRow({
      imdbRating: '8.1',
      Ratings: [
        { Source: 'Rotten Tomatoes', Value: '92%' },
        { Source: 'Metacritic', Value: '81/100' },
      ],
    });
    expect([...row.children].map(x => x.className)).toEqual([
      'rating-tmdb', 'rating-imdb', 'rating-rt', 'rating-mc',
    ]);
    const mc = row.querySelector('.rating-mc');
    expect(mc.textContent).toBe('Meta:81');
    expect(mc.querySelector('span').className).toBe('temp-green');
  });

  it('падає назад на Metascore і пропускає N/A', () => {
    const row = ratingsRow({ Metascore: '58' });
    const mc = row.querySelector('.rating-mc');
    expect(mc).not.toBeNull();
    expect(mc.textContent).toBe('Meta:58');
    expect(mc.querySelector('span').className).toBe('temp-orange');

    const na = ratingsRow({ Ratings: [{ Source: 'Metacritic', Value: 'N/A' }] });
    expect(na.querySelector('.rating-mc')).toBeNull();
  });

  it('не рендериться для серіалів', () => {
    const row = ratingsRow({ Ratings: [{ Source: 'Metacritic', Value: '81/100' }] }, 'tv');
    expect(row.querySelector('.rating-mc')).toBeNull();
    expect(row.querySelector('.rating-rt')).toBeNull();
  });
});

describe('AI-значок на картці', () => {
  afterEach(() => { delete window.mcChat; });

  function actions(item = { key: 'movie-1', type: 'movie' }) {
    return window.MC.createActions({ item, details: { title: 'Test' } });
  }

  it('з’являється, коли помічник увімкнено, і відкриває його', () => {
    let opened = 0;
    window.mcChat = { enabled: () => true, open: () => { opened++; } };
    const btn = actions().querySelector('.btn-ai');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('AI');
    btn.click();
    expect(opened).toBe(1);
  });

  it('не з’являється, коли помічник вимкнено', () => {
    window.mcChat = { enabled: () => false, open: () => {} };
    expect(actions({ key: 'tv-1', type: 'tv' }).querySelector('.btn-ai')).toBeFalsy();
  });
});
