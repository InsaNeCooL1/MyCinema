import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';

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

const CHAIN_IDS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => data,
  };
}

function sseChunk(parts) {
  return 'data: ' + JSON.stringify({ candidates: [{ content: { parts } }] }) + '\n\n';
}

function sseResponse(chunks) {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let at = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader: () => ({
        read: async () => (at < encoded.length ? { done: false, value: encoded[at++] } : { done: true }),
      }),
    },
  };
}

function quotaResponse(delay) {
  return {
    ok: false,
    status: 429,
    json: async () => ({
      error: {
        code: 429,
        message: 'free tier exceeded',
        details: delay ? [{ retryDelay: delay }] : [],
      },
    }),
  };
}

function serverResponse(status = 503) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code: status, message: 'temporarily unavailable' } }),
  };
}

function submitChat(text) {
  const root = document.querySelector('.mc-chat-root');
  if (!root || !root.classList.contains('open')) {
    const fab = document.querySelector('.mc-chat-fab');
    if (fab) fab.click();
    else window.mcChat.open();
  }
  const input = document.querySelector('.mc-chat-input');
  input.value = text;
  document.querySelector('.mc-chat-compose').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

function requestBodyAt(index) {
  return JSON.parse(global.fetch.mock.calls[index][1].body);
}

beforeEach(() => {
  window.cardStack = [];
  window.state = { tab: 'home', home: { recs: null } };
  // Кожен тест починається з чистого BYOK-стану: ключ, блокування й історія
  // не повинні витікати з попереднього тесту.
  localStorage.removeItem('mycinema.geminiKey');
  localStorage.removeItem('mycinema.geminiQuota');
  localStorage.removeItem('mycinema.geminiModel');
  window.mcChat.clear(true);
  window.mcChat.setEnabled(true);
  window.mcChat._state.health = null;
  window.mcChat._state.healthTs = 0;
});

afterEach(() => {
  delete window.cardStack;
  window.mcChat.close();
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
    expect(recs.totalByType).toEqual({ movie: 1, tv: 1 });
    expect(recs.shownByType).toEqual({ movie: 1, tv: 1 });
    expect(recs.mode).toBe('general');
    expect(recs.mood).toBe('chill');
    expect(recs.seeds).toBe(5);
    // Компактні рядки: без JSON-ключів, але з рейтингом, жанрами й причинами.
    expect(recs.movies).toEqual(['Прибуття (2020) | ★7.6 | Драма | Як «Дюна», Твій жанр · Драма']);
    expect(recs.tv).toEqual(['Темний (2020) | ★7.6 | Кримінал, Детектив']);
    expect(recs).not.toHaveProperty('items');
  });

  it('порожня стрічка → available:false із поясненням', () => {
    window.state = { tab: 'home', home: { recs: null } };
    const ctx = build();
    expect(ctx.recommendations.available).toBe(false);
    expect(ctx.recommendations.movies).toEqual([]);
    expect(ctx.recommendations.tv).toEqual([]);
    expect(ctx.recommendations.note).toMatch(/не згенеровані/i);
  });

  it('серіали не зникають з контексту, навіть коли фільмів більше за ліміт', () => {
    window.lib = {};
    const movies = Array.from({ length: 40 }, (_, i) => makeRec('movie-' + (100 + i), 'Фільм ' + i));
    const tv = Array.from({ length: 5 }, (_, i) => makeRec('tv-' + (200 + i), 'Серіал ' + i, { type: 'tv' }));
    window.state = {
      tab: 'home',
      home: { recs: { mode: 'balance', mood: null, seeds: 3, items: [...movies, ...tv] } },
    };

    const recs = build().recommendations;

    expect(recs.total).toBe(45);
    expect(recs.totalByType).toEqual({ movie: 40, tv: 5 });
    // Ліміт 22: усі 5 серіалів збережено, решту добирають фільми.
    expect(recs.shownByType).toEqual({ movie: 17, tv: 5 });
    expect(recs.movies.length).toBe(17);
    expect(recs.tv.length).toBe(5);
    tv.forEach((item) => expect(recs.tv.join('\n')).toContain(item.title));
    expect(recs.note).toMatch(/40 фільмів, 5 серіалів/);
  });

  it('бачить усю історію «Переглянутого» і не радить тайтли з бібліотеки', () => {
    const watched = {};
    for (let i = 0; i < 65; i++) {
      watched['movie-' + (300 + i)] = makeLibEntry({
        key: 'movie-' + (300 + i),
        id: 300 + i,
        title: 'Переглянуте ' + i,
        year: '2000',
        status: 'watched',
        updated: NOW - i * 1000,
      });
    }
    watched['tv-777'] = makeLibEntry({
      key: 'tv-777',
      id: 777,
      title: 'Старий серіал',
      year: '1999',
      type: 'tv',
      status: 'watched',
      updated: NOW - 999999,
    });
    watched['movie-empty'] = makeLibEntry({
      key: 'movie-empty',
      id: 888,
      title: 'Без статусу',
      status: null,
      ratings: {},
      favorite: false,
      updated: NOW,
    });
    window.lib = watched;
    window.state = {
      tab: 'home',
      home: {
        recs: {
          items: [
            makeRec('movie-300', 'Переглянуте 0'),
            makeRec('tv-777', 'Старий серіал', { type: 'tv' }),
            makeRec('movie-empty', 'Без статусу'),
            makeRec('movie-999', 'Свіжий фільм'),
          ],
        },
      },
    };

    const ctx = build();

    // seen — один компактний рядок; старі тайтли не загубились.
    expect(typeof ctx.taste.seen).toBe('string');
    expect(ctx.taste.seen).toContain('Старий серіал');
    expect(ctx.taste.seen).toContain('Переглянуте 64');
    // Усе, що є в бібліотеці, відфільтровано з рекомендацій.
    expect(ctx.recommendations.movies.join('\n')).toContain('Свіжий фільм');
    expect(ctx.recommendations.movies.join('\n')).not.toContain('Переглянуте');
    expect(ctx.recommendations.total).toBe(1);
  });

  it('добирає серіали з «Трендів», якщо розумна стрічка їх не дала', () => {
    window.lib = {};
    const generalTv = Array.from({ length: 10 }, (_, i) => makeRec('tv-' + (500 + i), 'Трендовий серіал ' + i, { type: 'tv' }));
    const generalMovies = Array.from({ length: 20 }, (_, i) => makeRec('movie-' + (600 + i), 'Трендовий фільм ' + i));
    window.state = {
      tab: 'home',
      home: {
        view: 'explore',
        tab: 'tv',
        recs: { mode: 'balance', items: [makeRec('movie-700', 'Один фільм')] },
        general: {
          tvStreams: [{ pop: generalTv.slice(0, 6), fresh: generalTv.slice(6) }],
          trMovies: generalMovies,
        },
      },
    };

    const ctx = build();
    const recs = ctx.recommendations;

    expect(recs.available).toBe(true);
    expect(recs.fallbackByType.tv).toBe(8);
    expect(recs.totalByType.tv).toBe(8);
    expect(recs.tv.length).toBe(8);
    expect(recs.tv[0]).toContain('Трендовий серіал 0');
    expect(recs.movies.join('\n')).toContain('Один фільм');

    // Знімок видимого списку Explore для поточного таба.
    expect(ctx.browse.tab).toBe('tv');
    expect(ctx.browse.items.length).toBe(10);
    expect(ctx.browse.items[0]).toContain('Трендовий серіал 0');
  });

  it('для великої бібліотеки seen обмежений 180 найпомітнішими назвами', () => {
    const big = {};
    for (let i = 0; i < 400; i++) {
      big['movie-' + (1000 + i)] = makeLibEntry({
        key: 'movie-' + (1000 + i),
        id: 1000 + i,
        title: 'Тайтл ' + i,
        year: String(1950 + (i % 70)),
        status: 'watched',
        favorite: false,
        ratings: i === 399 ? { plot: 10, cast: 10, style: 10, emotions: 10 } : {},
        // Старі, але популярні хіти — саме їх модель найчастіше радить «з голови».
        tmdbRating: i === 399 ? 9.9 : (i >= 300 && i < 320 ? 9.5 : 6),
        updated: NOW - i * 1000,
      });
    }
    window.lib = big;
    window.state = { tab: 'home', home: { recs: null } };

    const taste = build().taste;
    const names = taste.seen.split(' | ');

    expect(taste.seenTotal).toBe(400);
    expect(names.length).toBe(180);
    // Найкраще оцінений тайтл передається окремо в topRated.
    expect(taste.topRated.join('\n')).toContain('Тайтл 399');
    // Популярні старі тайтли потрапляють у seen першими, а не губляться.
    expect(names).toContain('Тайтл 300');
    expect(names[0]).toBe('Тайтл 300');
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
    expect(taste.topRated[0]).toContain('Дюна (2021)');
    expect(taste.favorites).toEqual(['Дюна (2021) | фільм | ★8.5']);
    expect(taste.statusCounts.watched).toBe(3);
    expect(taste.recent.map(x => x.split(' (')[0])).toEqual(['Дюна', 'Прибуття', 'Без оцінки']);
    expect(taste.recent[0]).toContain('| фільм |');
    expect(taste.recent[2]).toContain('| watched');
    // Усі три тайтли вже в recent, тому seen порожній — без дублювання.
    expect(taste.seen).toBe('');
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
  it('надсилає запит напряму в Gemini API рідним форматом', async () => {
    window.cardStack = [];
    window.state = { tab: 'home', home: { recs: { items: [] } } };
    window.mcChat.setApiKey('AIza-test-key');

    let captured = null;
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ models: [] }) };
      captured = { url: u, headers: init.headers, body: JSON.parse(init.body) };
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Раджу **Прибуття** (2016).' }] } }] }),
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

    expect(captured.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse');
    expect(captured.headers['x-goog-api-key']).toBe('AIza-test-key');
    const system = captured.body.system_instruction.parts[0].text;
    expect(system).toContain('Кіно-помічник');
    expect(system).toContain('CONTEXT_JSON:');
    expect(system).toContain('кінодруг');
    expect(system).toContain('Правила, які не порушуються');
    expect(system).toContain('ДВА РЕЖИМИ РОБОТИ');
    expect(system).toContain('ОБГОВОРЕННЯ (за замовчуванням)');
    expect(system).toContain('У ЦЬОМУ РЕЖИМІ ЗАБОРОНЕНО');
    expect(system).toContain('ПІДБІР (лише за прямим запитом)');
    expect(system).toContain('recommendations.tv');
    expect(system).toContain('context.browse.items');
    expect(system).toContain('медичний процедурал');
    expect(system).toContain('кіберпанк-фантастику');
    expect(system).toContain('Ніколи не радь нічого з taste.seen');
    expect(system).toContain('не керуєш застосунком');
    expect(system).toContain('available: false');
    expect(system).toContain('спочатку коротка жива реакція');
    expect(system).toContain('кожен із нового рядка');
    expect(system).toContain('Назва (рік) — чому саме вона підходить цьому користувачу');
    expect(captured.body.contents[captured.body.contents.length - 1]).toEqual({
      role: 'user',
      parts: [{ text: 'Що подивитись на вечір?' }],
    });
    expect(captured.body.generationConfig).toEqual({
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: 8192,
    });

    const bubble = document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble');
    expect(bubble.querySelector('strong').textContent).toBe('Прибуття');
    expect(document.querySelector('.mc-chat-root').classList.contains('open')).toBe(true);
    // Після надсилання поле вводу має бути порожнім.
    expect(document.querySelector('.mc-chat-input').value).toBe('');

    window.mcChat.clear(true);
    window.mcChat.close();
  });
});

describe('chat BYOK — ключ, ручний вибір моделі, локальні обмеження', () => {
  it('ключ зберігається локально, без ключа не пускає, новий ключ скидає блокування', () => {
    localStorage.setItem('mycinema.geminiQuota', JSON.stringify({ 'gemini-3.5-flash-lite': Date.now() + 60000 }));
    global.fetch = vi.fn();
    submitChat('Привіт');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.querySelector('.mc-chat-messages').textContent).toContain('вставте ключ');

    window.mcChat.setApiKey('  AIza-abc  ');
    expect(localStorage.getItem('mycinema.geminiKey')).toBe('AIza-abc');
    expect(window.mcChat.hasKey()).toBe(true);
    expect(localStorage.getItem('mycinema.geminiQuota')).toBeNull();
    window.mcChat.close();
  });

  it('ключ Gemini готується до хмари й приймається з профілю за часом зміни', () => {
    window.mcChat.setApiKey('AIza-sync');
    const payload = window.mcChat.getCloudKey();
    expect(payload.key).toBe('AIza-sync');
    expect(payload.ts).toBeGreaterThan(0);
    expect(Number(localStorage.getItem('mycinema.geminiKeyTs'))).toBe(payload.ts);
    expect(window.getGeminiCloudPayload()).toEqual(payload);

    window.applyCloudGemini({ key: 'AIza-cloud', ts: payload.ts + 1000 });
    expect(window.mcChat.getCloudKey()).toEqual({ key: 'AIza-cloud', ts: payload.ts + 1000 });

    // Старіший ключ з іншого пристрою не перезаписує новіший.
    window.applyCloudGemini({ key: 'AIza-old', ts: payload.ts - 1000 });
    expect(window.mcChat.getCloudKey().key).toBe('AIza-cloud');
  });

  it('перевірка ключа ходить на /models без витрати токенів і показує обрану модель', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: CHAIN_IDS.map((id) => ({ name: 'models/' + id })) }),
    }));
    window.mcChat.setApiKey('AIza-abc');
    const result = await window.mcChat.checkKey(true);

    expect(result.ok).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(global.fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('AIza-abc');
    expect(result.models).toEqual(CHAIN_IDS);
    await vi.waitFor(() => {
      expect(document.querySelector('#mc-chat-model-status').textContent).toMatch(/Модель: Gemini 3\.5 Flash-Lite/);
    }, { timeout: 2000 });
  });

  it('помилка 401 пояснює, що ключ треба замінити', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    window.mcChat.setApiKey('bad');
    const health = await window.mcChat.checkKey(true);
    expect(health.status).toBe(401);
    expect(document.querySelector('#mc-chat-model-status').textContent).toMatch(/401/);
  });

  it('у налаштуваннях можна вибрати конкретну модель для тестування', () => {
    const box = document.querySelector('#settings-extra-modal .settings-box');
    const section = box.querySelector('#mc-chat-settings');
    expect(section.querySelector('.settings-section-title').textContent).toBe('AI-помічник');

    const keyInput = section.querySelector('#mc-chat-api-key');
    expect(keyInput.type).toBe('password');
    expect(keyInput.placeholder).toMatch(/AIza/);
    expect(section.querySelector('.mc-chat-api-link').getAttribute('href')).toBe('https://aistudio.google.com/apikey');
    expect(section.querySelector('.mc-chat-settings-hint').textContent).toContain('Gemini API');
    const select = section.querySelector('#mc-chat-api-model');
    expect(select).toBeTruthy();
    expect(Array.from(select.options).map((o) => o.value)).toEqual(CHAIN_IDS);
    expect(select.value).toBe('gemini-3.5-flash-lite');
    expect(window.mcChat.getModel()).toBe('gemini-3.5-flash-lite');

    const note = section.querySelector('.mc-chat-model-note').textContent;
    CHAIN_IDS.forEach((id) => expect(note).toContain(id));
    expect(note).toMatch(/mycinema\.geminiModel/);

    const show = section.querySelector('.mc-chat-api-show');
    expect(show.classList.contains('settings-btn')).toBe(false);
    const css = fs.readFileSync('styles/85-chat.css', 'utf-8');
    expect(css).toMatch(/\.mc-chat-api-show\s*\{[^}]*width:\s*40px/);
    show.click();
    expect(keyInput.type).toBe('text');
    show.click();
    expect(keyInput.type).toBe('password');
  });

  it('кнопка збереження ключа запускає перевірку без вибору моделі', async () => {
    const section = document.querySelector('#mc-chat-settings');
    const keyInput = section.querySelector('#mc-chat-api-key');
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: CHAIN_IDS.map((id) => ({ name: 'models/' + id })) }),
    }));
    keyInput.value = '  AIza-from-ui  ';
    section.querySelector('.mc-chat-api-save').click();
    expect(localStorage.getItem('mycinema.geminiKey')).toBe('AIza-from-ui');
    await vi.waitFor(() => {
      expect(document.querySelector('#mc-chat-model-status').textContent).toMatch(/Ключ працює/);
    }, { timeout: 2000 });
  });

  it('вибрана модель зберігається локально і знімає її блокування', () => {
    expect(window.mcChat.setModel('gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite');
    expect(localStorage.getItem('mycinema.geminiModel')).toBe('gemini-3.5-flash-lite');
    expect(window.mcChat._debug.requestModels()).toEqual(CHAIN_IDS);

    window.mcChat._debug.blockModel('gemini-3.5-flash-lite', 60000);
    expect(window.mcChat._debug.buildChain()).not.toContain('gemini-3.5-flash-lite');
    window.mcChat.setModel('gemini-3.5-flash-lite');
    expect(window.mcChat._debug.buildChain()).toContain('gemini-3.5-flash-lite');

    const select = document.querySelector('#mc-chat-api-model');
    select.value = 'gemini-3.1-flash-lite';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(window.mcChat.getModel()).toBe('gemini-3.1-flash-lite');
  });

  it('список моделей побудовано від 3.5 до 3.1 Flash-Lite', () => {
    expect(window.mcChat._debug.chain()).toEqual(CHAIN_IDS);
    expect(window.mcChat._debug.buildChain()).toEqual(CHAIN_IDS);
  });

  it('429 на обраній моделі блокує її, але резервна рятує відповідь у тому ж запиті', async () => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(quotaResponse('43s'))
      .mockResolvedValueOnce(jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Раджу «Дюну»' }] } }],
      }));

    submitChat('Що подивитись?');
    await vi.waitFor(() => {
      const bubble = document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble');
      expect(bubble && bubble.textContent).toContain('Раджу «Дюну»');
    }, { timeout: 3000 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('gemini-3.5-flash-lite');
    expect(global.fetch.mock.calls[1][0]).toContain('gemini-3.1-flash-lite');
    expect(document.querySelector('.mc-chat-error')).toBeNull();

    const quota = JSON.parse(localStorage.getItem('mycinema.geminiQuota'));
    expect(Number(quota['gemini-3.5-flash-lite'])).toBeGreaterThan(Date.now());
  });

  it('503 на обох моделях перемикає на резервну й показує дружнє повідомлення', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    global.fetch = vi.fn(async () => serverResponse(503));

    submitChat('Порадь серіал на кілька вечорів');
    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-error')).toBeTruthy();
    }, { timeout: 3000 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('gemini-3.5-flash-lite');
    expect(global.fetch.mock.calls[1][0]).toContain('gemini-3.1-flash-lite');
    expect(document.querySelector('.mc-chat-error-text').textContent).toMatch(/тимчасово недоступний/);
    expect(window.mcChat._state.lastApiError).toMatchObject({ model: 'gemini-3.1-flash-lite', status: 503 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([500, 502, 503])('%i на обраній моделі перемикає на 3.1-flash-lite', async (status) => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(serverResponse(status))
      .mockResolvedValueOnce(jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Раджу «Прибуття»' }] } }],
      }));

    submitChat('Порадь фільм');
    await vi.waitFor(() => {
      const bubble = document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble');
      expect(bubble && bubble.textContent).toContain('Прибуття');
    }, { timeout: 3000 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toContain('gemini-3.1-flash-lite');
    expect(document.querySelector('.mc-chat-error')).toBeNull();
  });

  it('якщо обрана модель недоступна для ключа — запит не йде', async () => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat.setModel('gemini-3.5-flash-lite');
    window.mcChat._state.health = { ok: true, status: 200, models: ['gemini-3.1-flash-lite'] };
    global.fetch = vi.fn();

    submitChat('Що подивитись?');
    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-error')).toBeTruthy();
    }, { timeout: 2000 });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.querySelector('.mc-chat-error-text').textContent).toMatch(/Обрана модель недоступна/);
  });

  it('локальне блокування не заважає ручному запиту до обраної моделі', async () => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    window.mcChat._debug.blockModel('gemini-3.5-flash-lite', 60000);
    global.fetch = vi.fn(async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: 'Раджу «Дюну»' }] } }],
    }));

    submitChat('Що подивитись?');
    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble').textContent).toContain('Раджу «Дюну»');
    }, { timeout: 3000 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('gemini-3.5-flash-lite');
    expect(document.querySelector('.mc-chat-error')).toBeNull();
  });

  it('retryDelay з Google розбирається в мілісекунди, а без нього — до півночі PT', () => {
    expect(window.mcChat._debug.retryDelayMs({ error: { details: [{ retryDelay: '43s' }] } })).toBe(43000);
    expect(window.mcChat._debug.retryDelayMs({ error: { details: [{ retryDelay: '2m30s' }] } })).toBe(150000);
    expect(window.mcChat._debug.retryDelayMs({ error: { details: [{ retryDelay: '1h' }] } })).toBe(3600000);
    expect(window.mcChat._debug.retryDelayMs({ error: { details: [] } })).toBeGreaterThan(0);
  });

  it('запит іде з thinkingLevel low і без temperature/topP', async () => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    global.fetch = vi.fn(async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: 'Раджу «Дюну»' }] } }],
    }));

    submitChat('Порадь фільм');
    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble')).toBeTruthy();
    }, { timeout: 3000 });

    const body = requestBodyAt(0);
    expect(body.generationConfig).toEqual({
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: 8192,
    });
    expect(body.generationConfig).not.toHaveProperty('thinkingLevel');
    expect(body.generationConfig).not.toHaveProperty('temperature');
    expect(body.generationConfig).not.toHaveProperty('topP');
    expect(global.fetch.mock.calls[0][0]).toContain('gemini-3.5-flash-lite');
  });

  it('порожня thought-only відповідь не повторює обрану модель', async () => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Міркую…', thought: true }] } }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Раджу «Дюну»' }] } }],
      }));

    submitChat('Порадь серіал на кілька вечорів');
    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-error')).toBeTruthy();
    }, { timeout: 3000 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('gemini-3.5-flash-lite');
    expect(requestBodyAt(0).generationConfig.maxOutputTokens).toBe(8192);
  });

  it('не показує thought і не пересилає thoughtSignature у наступному запиті', async () => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return sseResponse([
          sseChunk([
            { text: 'Внутрішній ланцюг', thought: true, thoughtSignature: 'sig-123' },
            { text: 'Раджу ' },
            { text: '«Дюну»' },
          ]),
        ]);
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'Так, ще «Прибуття»' }] } }] });
    });

    submitChat('Що подивитись?');
    await vi.waitFor(() => {
      const bubble = document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble');
      expect(bubble.textContent).toContain('Раджу «Дюну»');
      expect(bubble.textContent).not.toContain('Внутрішній ланцюг');
    }, { timeout: 3000 });

    const stored = window.mcChat._state.messages.filter((m) => m.role === 'assistant').pop();
    expect(stored.parts).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain('sig-123');

    submitChat('А ще?');
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const secondBody = requestBodyAt(1);
    expect(JSON.stringify(secondBody.contents)).not.toContain('sig-123');
    expect(JSON.stringify(secondBody.contents)).not.toContain('Внутрішній ланцюг');
  });

  it('SSE-чанки без candidates і без parts ігноруються, а не ламають стрім', async () => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';
    global.fetch = vi.fn(async () => sseResponse([
      sse({}),                                          // зовсім порожній чанк
      sse({ usageMetadata: { totalTokenCount: 12 } }),  // тільки метадані
      sse({ candidates: [] }),                          // candidates порожній
      sse({ candidates: [{ finishReason: 'STOP' }] }),  // немає parts
      sse({ candidates: [{ content: { parts: [null, { text: 42 }, { text: 'Раджу ' }, { text: '«Дюну»', thought: false }] } }] }),
    ]));

    submitChat('Що подивитись?');
    await vi.waitFor(() => {
      const bubble = document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble');
      expect(bubble && bubble.textContent).toContain('Раджу «Дюну»');
    }, { timeout: 3000 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.mc-chat-error')).toBeNull();
    expect(window.mcChat._state.lastTiming.usage.totalTokenCount).toBe(12);
  });

  it('finishReason SAFETY віддає зрозуміле повідомлення без каскаду й падіння', async () => {
    window.mcChat.setApiKey('AIza-abc');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    global.fetch = vi.fn(async () => sseResponse([
      'data: ' + JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Не можу' }] }, finishReason: 'SAFETY' }],
      }) + '\n\n',
    ]));

    submitChat('Що подивитись?');
    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-error')).toBeTruthy();
    }, { timeout: 3000 });

    expect(global.fetch).toHaveBeenCalledTimes(1); // каскад тут не викликаємо
    expect(document.querySelector('.mc-chat-error-text').textContent).toMatch(/правила безпеки/);
    expect(window.mcChat._state.lastTiming.finishReason).toBe('SAFETY');
  });

  it('таймаут Gemini-запиту — щонайменше 25 с (low thinking думає 4–8 с до першої літери)', () => {
    expect(window.mcChat._debug.timeoutMs()).toBeGreaterThanOrEqual(25000);
  });

  it('у клієнті не лишилося OpenRouter і Gemma 4', () => {
    const src = fs.readFileSync('src/chat.js', 'utf-8');
    const cfg = fs.readFileSync('src/config.js', 'utf-8');
    expect(src).not.toMatch(/openrouter/i);
    expect(src).not.toMatch(/gemma/i);
    expect(cfg).not.toMatch(/openrouter/i);
    expect(cfg).toContain('mycinema.geminiQuota');
  });

  it('вікно чату лежить поверх картки на десктопі', () => {
    const css = fs.readFileSync('styles/85-chat.css', 'utf-8');
    const m = css.match(/\.mc-chat-root\s*\{[^}]*z-index:\s*(\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(1100);
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
