import { describe, it, expect, beforeEach } from 'vitest';

window.loadScript('src/player-controls.js');

describe('MCPlayerControls', () => {
  let host, video;

  beforeEach(() => {
    document.querySelectorAll('.mc-pc').forEach(el => el.remove());
    document.querySelectorAll('#mc-player-controls-style').forEach(el => el.remove());
    host = document.createElement('div');
    video = document.createElement('video');
    host.appendChild(video);
    document.body.appendChild(host);
  });

  it('замінює нативні контроли власними', () => {
    video.controls = true;
    const opened = [];
    const c = window.MCPlayerControls.mount({
      host, video, title: 'Тест',
      onMenu: () => opened.push('menu'),
      onFullscreen: () => opened.push('full')
    });
    expect(video.controls).toBe(false);
    expect(host.querySelector('.mc-pc-title').textContent).toBe('Тест');
    expect(host.querySelector('.mc-pc-seek input')).toBeTruthy();

    host.querySelector('[data-a="menu"]').click();
    host.querySelector('[data-a="full"]').click();
    expect(opened).toEqual(['menu', 'full']);

    c.destroy();
    expect(host.querySelector('.mc-pc')).toBeNull();
  });
});
