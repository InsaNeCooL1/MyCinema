import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// chat.js — класичний скрипт; підвантажуємо його так само, як решта src.
window.loadScript('src/chat.js');

const NOW = Date.now();

function makeLibEntry(overrides = {}) {
  return {
    key: 'movie-1',
    type: 'movie',
    id: 1,
    title: 'Дюна',
    year: '2021',
    genres: [878, 12],
    tmdbRating: 8.2,
    status: 'watched',
    favorite: true,
    ratings: { plot: 9, cast: 8, style: 10, emotions: 7 },
    updated: NOW,
    ...overrides,
  };
}

function makeRec(key, title, overrides = {}) {
  return {
    key,
    type: 'movie',
    title,
    year: '2020',
    tmdbRating: 7.6,
    genres: [18],
    _reasons: ['Твій жанр · Драма'],
    ...overrides,
  };
}

function build() {
  return window.mcChatBuildContext();
}

beforeEach(() => {
  window.cardStack = [];
  window.state = { tab: 'home', home: { recs: null } };
});

afterEach(() => {
  delete window.cardStack;
});

describe('chat context — поточна картка', () => {
  it('фільм: назва, жанри, режисери, актори, IMDb id, провайдери, оцінка користувача', () => {
    window.lib = { 'movie-1': makeLibEntry() };
    window.cardStack = [{
      type: 'media',
      item: { key: 'movie-1', type: 'movie', id: 1, title: 'Дюна', year: '2021', genres: [878, 12], tmdbRating: 8.2 },
      details: {
        title: 'Дюна',
        runtime: 155,
        overview: 'Пол Атрейдес вирушає на Арракіс.',
        production_countries: [{ iso_3166_1: 'US' }],
        genres: [{ id: 878 }, { id: 12 }],
        credits: {
          crew: [{ job: 'Director', name: 'Denis Villeneuve' }],
          cast: [{ name: 'Timothée Chalamet' }, { name: 'Rebecca Ferguson' }],
        },
        external_ids: { imdb_id: 'tt1160419' },
      },
      genres: [878, 12],
      directors: [{ name: 'Denis Villeneuve' }],
      cast: [{ name: 'Timothée Chalamet' }, { name: 'Rebecca Ferguson' }],
      countries: ['US'],
      watchProviders: { flatrate: [{ provider_name: 'Netflix' }] },
      seasonState: {},
    }];

    const ctx = build();
    const card = ctx.currentCard;

    expect(card.kind).toBe('media');
    expect(card.key).toBe('movie-1');
    expect(card.title).toBe('Дюна');
    expect(card.year).toBe('2021');
    expect(card.type).toBe('movie');
    expect(card.genres).toEqual(['Фантастика', 'Пригоди']);
    expect(card.directors).toEqual(['Denis Villeneuve']);
    expect(card.cast).toContain('Timothée Chalamet');
    expect(card.imdb.id).toBe('tt1160419');
    expect(card.providersUA).toEqual(['Netflix']);
    expect(card.user.inLibrary).toBe(true);
    expect(card.user.status).toBe('watched');
    expect(card.user.favorite).toBe(true);
    expect(card.user.rating).toBeGreaterThan(0);
    expect(card.user.criteria.plot).toBe(9);
    expect(ctx.screen.cardOpen).toBe(true);
  });

  it('серіал: сезони, прогрес перегляду, обраний сезон із епізодами', () => {
    window.lib = {
      'tv-7': {
        key: 'tv-7',
        type: 'tv',
        id: 7,
        title: 'Серіал',
        year: '2019',
        totalSeasons: 3,
        episode_count: 24,
        watchedEpisodes: ['1-1', '1-2', '2-1'],
        seasonRatings: { 1: { plot: 8, cast: 9 }, 2: { plot: 7, cast: 8 } },
        updated: NOW,
      },
    };
    window.cardStack = [{
      type: 'media',
      item: { key: 'tv-7', type: 'tv', id: 7, title: 'Серіал', year: '2019', genres: [18] },
      details: {
        name: 'Серіал',
        status: 'Returning Series',
        first_air_date: '2019-01-01',
        number_of_seasons: 3,
        number_of_episodes: 24,
        seasons: [
          { season_number: 1, name: 'Сезон 1', episode_count: 8, episodes: [{ episode_number: 1, name: 'Пілот', overview: 'Початок' }] },
          { season_number: 2, name: 'Сезон 2', episode_count: 8 },
          { season_number: 3, name: 'Сезон 3', episode_count: 8 },
        ],
        next_episode_to_air: { season_number: 3, episode_number: 8, name: 'Фінал' },
      },
      genres: [18],
      seasonState: { selectedSeason: 1 },
    }];

    const ctx = build();
    const card = ctx.currentCard;

    expect(card.type).toBe('tv');
    expect(card.tv.totalSeasons).toBe(3);
    expect(card.tv.totalEpisodes).toBe(24);
    expect(card.tv.watchedEpisodes).toBe(3);
    expect(card.tv.watchedBySeason).toEqual({ '1': 2, '2': 1 });
    expect(card.tv.seasonRatings).toEqual([
      { season: 1, rating: 8.5 },
      { season: 2, rating: 7.5 },
    ]);
    expect(card.tv.nextEpisode.name).toBe('Фінал');
    expect(card.tv.viewingSeason.season).toBe(1);
    expect(card.tv.viewingSeason.episodeList[0].name).toBe('Пілот');
  });

  it('персона та студія', () => {
    window.cardStack = [{
      type: 'person',
      id: 42,
      details: { name: 'Актор', known_for_department: 'Acting', biography: 'Біографія' },
      bioMeta: { text: 'Стисла біографія' },
    }];
    let ctx = build();
    expect(ctx.currentCard.kind).toBe('person');
    expect(ctx.currentCard.name).toBe('Актор');
    expect(ctx.currentCard.biography).toBe('Стисла біографія');

    window.cardStack = [{
      type: 'company',
      id: 420,
      details: { name: 'Marvel Studios', description: 'Студія', origin_country: 'US' },
    }];
    ctx = build();
    expect(ctx.currentCard.kind).toBe('company');
    expect(ctx.currentCard.name).toBe('Marvel Studios');
  });

  it('без відкритої картки currentCard = null, screen.cardOpen = false', () => {
    window.cardStack = [];
    const ctx = build();
    expect(ctx.currentCard).toBeNull();
    expect(ctx.screen.cardOpen).toBe(false);
  });
});

describe('chat context — рекомендації та смак', () => {
  it('бере рекомендації зі state.home.recs, фільтрує бібліотеку, зберігає причини', () => {
    window.lib = { 'movie-1': makeLibEntry() };
    window.state = {
      tab: 'home',
      home: {
        recs: {
          mode: 'general',
          mood: 'chill',
          seeds: 5,
          items: [
            makeRec('movie-1', 'Дюна'),
            makeRec('movie-2', 'Прибуття', { _reasons: [{ priority: 10, text: 'Як «Дюна»' }, 'Твій жанр · Драма'] }),
            makeRec('tv-3', 'Темний', { type: 'tv', genres: [80, 9648], _reasons: [] }),
          ],
        },
      },
    };

    const ctx = build();
    const recs = ctx.recommendations;

    expect(recs.available).toBe(true);
    expect(recs.total).toBe(2);
    expect(recs.mode).toBe('general');
    expect(recs.mood).toBe('chill');
    expect(recs.seeds).toBe(5);
    expect(recs.items.map(x => x.key)).toEqual(['movie-2', 'tv-3']);
    expect(recs.items[0].why).toEqual(['Як «Дюна»', 'Твій жанр · Драма']);
    expect(recs.items[1].why).toEqual([]);
    expect(recs.items[1].genres).toEqual(['Кримінал', 'Детектив']);
    expect(recs.items[0].rank).toBe(1);
  });

  it('порожня стрічка → available:false із поясненням', () => {
    window.state = { tab: 'home', home: { recs: null } };
    const ctx = build();
    expect(ctx.recommendations.available).toBe(false);
    expect(ctx.recommendations.items).toEqual([]);
    expect(ctx.recommendations.note).toMatch(/не згенеровані/i);
  });

  it('профіль смаку: критерії, топ-жанри, улюблені, топ оцінок', () => {
    window.lib = {
      'movie-1': makeLibEntry(),
      'movie-2': makeLibEntry({ key: 'movie-2', id: 2, title: 'Прибуття', genres: [878], ratings: { plot: 7, cast: 6, style: 7, emotions: 8 }, favorite: false }),
      'movie-3': makeLibEntry({ key: 'movie-3', id: 3, title: 'Без оцінки', ratings: {}, favorite: false }),
    };

    const ctx = build();
    const taste = ctx.taste;

    expect(taste.libraryCount).toBe(3);
    expect(taste.ratedCount).toBe(2);
    expect(taste.criteria.ratedTitles).toBe(2);
    expect(taste.criteria.plot).toBe(8);
    expect(taste.topGenres[0]).toBe('Фантастика');
    expect(taste.topRated[0].title).toBe('Дюна');
    expect(taste.favorites.map(x => x.title)).toEqual(['Дюна']);
    expect(taste.statusCounts.watched).toBe(3);
  });

  it('не надсилає нотатки, email, uid та інші приватні поля', () => {
    window.currentUser = { uid: 'uid-secret', email: 'a@b.c' };
    window.lib = {
      'movie-1': makeLibEntry({
        notes: 'дуже особиста нотатка',
        notesHistory: [{ text: 'історія нотаток' }],
        email: 'a@b.c',
        uid: 'uid-secret',
      }),
    };
    window.cardStack = [];

    const json = JSON.stringify(build());
    expect(json).not.toContain('дуже особиста нотатка');
    expect(json).not.toContain('історія нотаток');
    expect(json).not.toContain('uid-secret');
    expect(json).not.toContain('a@b.c');
    expect(json).not.toMatch(/"notes"/);
    expect(json).not.toMatch(/"email"/);
    expect(json).not.toMatch(/"uid"/);
  });
});

describe('chat UI', () => {
  it('FAB відкриває панель, показує контекст картки, back закриває', () => {
    window.lib = { 'movie-1': makeLibEntry() };
    window.cardStack = [{
      type: 'media',
      item: { key: 'movie-1', type: 'movie', id: 1, title: 'Дюна', year: '2021', genres: [878] },
      details: { title: 'Дюна' },
    }];

    const root = document.querySelector('.mc-chat-root');
    const fab = document.querySelector('.mc-chat-fab');
    const panel = document.querySelector('.mc-chat-panel');

    expect(root).toBeTruthy();
    expect(fab).toBeTruthy();
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');

    fab.click();
    expect(root.classList.contains('open')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(document.querySelector('.mc-chat-context-btn').textContent).toBe('Контекст: Дюна');

    expect(window.mcChat.handleBack()).toBe(true);
    expect(root.classList.contains('open')).toBe(false);
    expect(window.mcChat.handleBack()).toBe(false);
  });
  it('надсилає запит напряму в OpenRouter із власним ключем', async () => {
    window.cardStack = [];
    window.state = { tab: 'home', home: { recs: { items: [] } } };
    window.mcChat.setApiKey('sk-or-v1-test-key');

    let captured = null;
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith('/key')) return { ok: true, status: 200 };
      captured = { url: u, headers: init.headers, body: JSON.parse(init.body) };
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ choices: [{ message: { content: 'Раджу **Прибуття** (2016).' } }] }),
      };
    });

    if (!document.querySelector('.mc-chat-root').classList.contains('open')) {
      document.querySelector('.mc-chat-fab').click();
    }
    const input = document.querySelector('.mc-chat-input');
    input.value = 'Що подивитись на вечір?';
    document.querySelector('.mc-chat-compose').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-messages').textContent).toContain('Прибуття');
      expect(document.querySelector('.mc-chat-send').textContent).toBe('→');
    }, { timeout: 3000 });

    expect(captured.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(captured.headers.Authorization).toBe('Bearer sk-or-v1-test-key');
    expect(captured.body.model).toBe('google/gemini-2.5-flash');
    expect(captured.body.stream).toBe(true);
    expect(captured.body.messages[0].role).toBe('system');
    expect(captured.body.messages[0].content).toContain('Кіно-помічник');
    expect(captured.body.messages[0].content).toContain('CONTEXT_JSON:');
    expect(captured.body.messages[captured.body.messages.length - 1]).toEqual({
      role: 'user',
      content: 'Що подивитись на вечір?',
    });

    const bubble = document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble');
    expect(bubble.querySelector('strong').textContent).toBe('Прибуття');
    expect(document.querySelector('.mc-chat-root').classList.contains('open')).toBe(true);

    window.mcChat.clear(true);
    window.mcChat.close();
  });
});

describe('chat BYOK — ключ у налаштуваннях', () => {
  it('ключ і модель зберігаються локально, без ключа модель не пускає', async () => {
    expect(window.mcChat.hasKey()).toBe(false);
    global.fetch = vi.fn();
    window.mcChat.open();
    document.querySelector('.mc-chat-input').value = 'Привіт';
    document.querySelector('.mc-chat-compose').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.querySelector('.mc-chat-messages').textContent).toContain('вставте ключ');

    window.mcChat.setApiKey('  sk-or-v1-abc  ');
    expect(localStorage.getItem('mycinema.openrouterKey')).toBe('sk-or-v1-abc');
    expect(window.mcChat.hasKey()).toBe(true);
    window.mcChat.setModel('meta-llama/llama-3.3-70b-instruct');
    expect(localStorage.getItem('mycinema.openrouterModel')).toBe('meta-llama/llama-3.3-70b-instruct');
    window.mcChat.close();
  });

  it('перевірка ключа ходить на /key і не витрачає токени', async () => {
    let called = '';
    global.fetch = vi.fn(async (url) => {
      called = String(url);
      return { ok: true, status: 200 };
    });
    window.mcChat.setApiKey('sk-or-v1-abc');
    const result = await window.mcChat.checkKey(true);
    expect(result.ok).toBe(true);
    expect(called).toBe('https://openrouter.ai/api/v1/key');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-or-v1-abc');
  });

  it('помилка 401 пояснює, що ключ треба замінити', () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    window.mcChat.setApiKey('bad');
    return window.mcChat.checkKey(true).then((h) => {
      expect(h.status).toBe(401);
      expect(document.querySelector('#mc-chat-model-status').textContent).toMatch(/401/);
    });
  });

  it('поле API-ключа з’являється в Налаштуваннях і працює через кнопку', async () => {
    const box = document.querySelector('#settings-extra-modal .settings-box');
    const section = box.querySelector('#mc-chat-settings');
    expect(section).toBeTruthy();
    expect(section.querySelector('.settings-section-title').textContent).toBe('AI-помічник');

    const keyInput = section.querySelector('#mc-chat-api-key');
    expect(keyInput).toBeTruthy();
    expect(keyInput.type).toBe('password');
    expect(keyInput.placeholder).toMatch(/sk-or/);
    expect(section.querySelector('.mc-chat-api-link').getAttribute('href')).toBe('https://openrouter.ai/keys');

    const show = section.querySelector('.mc-chat-api-show');
    show.click();
    expect(keyInput.type).toBe('text');
    show.click();
    expect(keyInput.type).toBe('password');

    const modelSelect = section.querySelector('#mc-chat-api-model');
    expect(modelSelect.tagName).toBe('SELECT');
    expect(section.querySelector('input[type="text"]')).toBeFalsy();
    expect(modelSelect.options.length).toBeGreaterThan(10);
    const ids = Array.from(modelSelect.options).map((o) => o.value);
    expect(ids).toContain('google/gemini-2.5-flash');
    expect(ids).toContain('deepseek/deepseek-v4.1-flash-1017');
    expect(ids).toContain('openai/gpt-6-luna');
    expect(ids).toContain('nvidia/nemotron-3-ultra-550b-a55b:free');

    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    keyInput.value = '  sk-or-v1-from-ui  ';
    section.querySelector('.mc-chat-api-save').click();
    expect(localStorage.getItem('mycinema.openrouterKey')).toBe('sk-or-v1-from-ui');
    await vi.waitFor(() => {
      expect(document.querySelector('#mc-chat-model-status').textContent).toMatch(/Ключ працює/);
    }, { timeout: 2000 });
  });

  it('вибір моделі зі списку зберігається одразу', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    window.mcChat.setApiKey('sk-or-v1-abc');
    const select = document.querySelector('#mc-chat-api-model');
    select.value = 'z-ai/glm-5.3-flash';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('mycinema.openrouterModel')).toBe('z-ai/glm-5.3-flash');
    await vi.waitFor(() => {
      expect(document.querySelector('#mc-chat-model-status').textContent).toContain('z-ai/glm-5.3-flash');
    }, { timeout: 2000 });
  });

  it('раніше вписана своя модель не губиться у списку', () => {
    window.mcChat.setModel('my-provider/my-model');
    const select = document.querySelector('#mc-chat-api-model');
    expect(select.value).toBe('my-provider/my-model');
    expect(Array.from(select.options).some((o) => o.value === 'my-provider/my-model')).toBe(true);
  });

  it('поле API ховається, коли бота вимкнено, і з’являється при увімкненні', () => {
    const block = document.querySelector('#mc-chat-api-block');
    const toggle = document.querySelector('#mc-chat-toggle');
    window.mcChat.setEnabled(false);
    expect(block.hidden).toBe(true);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(block.hidden).toBe(false);
    expect(window.mcChat.enabled()).toBe(true);
  });
});

describe('chat markdown', () => {
  it('екранує HTML і рендерить списки, жирний та код', () => {
    const html = window.mcChat.markdown('Привіт <script>alert(1)</script>\n**Дюна** — *епік*\n- пункт\n1. перший');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>Дюна</strong>');
    expect(html).toContain('<em>епік</em>');
    expect(html).toContain('<ul><li>пункт</li></ul>');
    expect(html).toContain('<ol><li>перший</li></ol>');
  });
});
