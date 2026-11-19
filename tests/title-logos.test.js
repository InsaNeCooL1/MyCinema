import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  window.loadScript('src/title-logos.js');
});

describe('Ukrainian title logos', () => {
  it('picks only Ukrainian logos', () => {
    const { pickUkrainianLogo } = window._titleLogos;
    const list = [
      { iso_639_1: 'en', file_path: '/en.png' },
      { iso_639_1: 'uk', file_path: '/uk.png' }
    ];
    expect(pickUkrainianLogo(list)).toBe('/uk.png');
    expect(pickUkrainianLogo([{ iso_639_1: 'en', file_path: '/en.png' }])).toBeNull();
    expect(pickUkrainianLogo(null)).toBeNull();
  });

  it('fetches and caches a Ukrainian logo, falls back to null', async () => {
    const mock = vi.fn().mockResolvedValueOnce({
      logos: [{ iso_639_1: 'uk', file_path: '/uk.png' }]
    });
    window.tmdbFetch = mock;
    const item = { type: 'movie', id: 999001, title: 'Тест' };
    expect(await window._titleLogos.fetchTitleLogo(item)).toBe('/uk.png');
    expect(mock).toHaveBeenCalledTimes(1);
    // друге звернення має йти з кешу
    expect(await window._titleLogos.fetchTitleLogo(item)).toBe('/uk.png');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('leaves plain text when the setting is off', async () => {
    window.settings.titleLogos = false;
    const el = document.createElement('div');
    el.textContent = 'Звичайна назва';
    document.body.append(el);
    window._titleLogos.applyTitleLogo({ type: 'movie', id: 1, title: 'X' }, el);
    await Promise.resolve();
    expect(el.textContent).toBe('Звичайна назва');
    el.remove();
  });
});
