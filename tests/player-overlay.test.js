import { describe, it, expect, beforeEach } from 'vitest';

window.loadScript('src/player-overlay.js');

function v(season, episode, translation, quality, url) {
  return { season: season, episode: episode, translation: translation, quality: quality, url: url };
}

describe('MCPlayerOverlay', () => {
  let host;

  beforeEach(() => {
    document.querySelectorAll('.mc-po').forEach(el => el.remove());
    document.querySelectorAll('#mc-player-overlay-style').forEach(el => el.remove());
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('будує чотири групи та перемикає варіант', () => {
    const variants = [
      v('Сезон 1', 'Серія 1', 'Українська', '1080p', 'u1-1080'),
      v('Сезон 1', 'Серія 1', 'Українська', '720p', 'u1-720'),
      v('Сезон 1', 'Серія 2', 'Українська', '1080p', 'u2-1080'),
      v('Сезон 2', 'Серія 1', 'Російська', '720p', 'ru-s2-720')
    ];
    const switched = [];
    const overlay = window.MCPlayerOverlay.mount({
      host, variants, onSwitch: (x) => switched.push(x)
    });

    const groups = host.querySelectorAll('.mc-po-group');
    expect(groups.length).toBe(4);
    expect([...groups].map(g => g.querySelector('.mc-po-label').textContent))
      .toEqual(['Сезон', 'Серія', 'Озвучка', 'Якість']);
    expect(overlay.current().url).toBe('u1-1080');

    /* вибираємо другий сезон */
    const seasonBtns = groups[0].querySelectorAll('.mc-po-chip');
    [...seasonBtns].find(b => b.textContent === 'Сезон 2').click();
    expect(switched.length).toBe(1);
    expect(switched[0].url).toBe('ru-s2-720');
    expect(overlay.state().season).toBe('Сезон 2');
    expect(overlay.state().translation).toBe('');
    expect(overlay.current().url).toBe('ru-s2-720');

    overlay.destroy();
    expect(host.querySelector('.mc-po')).toBeNull();
  });

  it('закривається по хрестку та повторному натисненню', () => {
    const overlay = window.MCPlayerOverlay.mount({
      host,
      variants: [v('', '', '', '', 'a'), v('', '', '', '', 'b')],
      onSwitch: () => {}
    });
    overlay.open();
    expect(host.querySelector('.mc-po').hidden).toBe(false);

    host.querySelector('.mc-po-close').click();
    expect(host.querySelector('.mc-po').hidden).toBe(true);

    overlay.toggle();
    expect(host.querySelector('.mc-po').hidden).toBe(false);
    overlay.toggle();
    expect(host.querySelector('.mc-po').hidden).toBe(true);

    overlay.destroy();
  });

  it('приховує меню, якщо варіант один', () => {
    const overlay = window.MCPlayerOverlay.mount({
      host, variants: [v('', '', '', '', 'only')], onSwitch: () => {}
    });
    expect(overlay.hasOptions()).toBe(false);
    overlay.destroy();
  });
});
