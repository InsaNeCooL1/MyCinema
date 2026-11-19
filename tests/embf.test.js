import { beforeAll, describe, expect, it, vi } from 'vitest';

const SEARCH_HTML = `
<a href="https://uakinogo.is/4850-chelovek-pauk-novyj-den.html">Человек-паук: Новый день (2026)</a>`;
const PAGE_HTML = `<div><iframe src="https://api.embf.net/embed/movie/90039"></iframe></div>`;
const EMBED_HTML = `
makePlayer({
  source: {
    hls: "https://cdn.interkh.com/x/CYVNV5TP.mp4/master.m3u8?t=1",
    audio: {"names":["MovieDalen","LeDoyen (укр)","Eng.Original"],"order":[0,1,2]},
    cc: [{"url":"https://cdn.interkh.com/x/uk.vtt","name":"Укр. повні - 2"}]
  }
});`;
const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="rus0",LANGUAGE="ru",URI="a1.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="ukr5",LANGUAGE="uk",URI="a6.m3u8"`;

beforeAll(() => {
  window.loadScript('src/streams.js');
});

describe('EmbF provider', () => {
  it('searches the source site', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(SEARCH_HTML) }));
    const res = await window._streamsUtil.searchEmbf('Человек-паук');
    expect(res.length).toBe(1);
    expect(res[0].provider).toBe('embf');
    expect(res[0].href).toContain('4850-chelovek-pauk-novyj-den.html');
  });

  it('uses uaserials.pro as the primary UASerials source', async () => {
    const urls = [];
    global.fetch = vi.fn((u) => {
      const url = String(u);
      urls.push(url);
      const body = url.includes('uaserials.pro')
        ? '<a href="https://uaserials.pro/123-test.html">Test</a>'
        : '<html></html>';
      return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
    });
    await window._streamsUtil.searchUASerialsMirror('test');
    expect(urls.some((u) => u.includes('uaserials.pro'))).toBe(true);
    expect(urls.some((u) => u.includes('uaserials.my'))).toBe(false);
  });

  it('resolves to the native EmbF iframe player', async () => {
    global.fetch = vi.fn((u) => {
      const url = String(u);
      const body = url.includes('r.jina.ai') ? PAGE_HTML : '';
      return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
    });
    const out = await window._streamsUtil.resolveEmbf({
      href: 'https://uakinogo.is/4850-chelovek-pauk-novyj-den.html'
    });
    expect(out).toHaveLength(1);
    expect(out[0].iframeUrl).toContain('api.embf.net/embed/movie/90039');
    expect(out[0].url).toBeUndefined();
  });
});
