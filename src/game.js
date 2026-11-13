'use strict';

async function renderGame() {
  if (state.tab !== 'game') return;
  box.replaceChildren(); box.style.padding = '0';
  
  if (!state.game.active && !state.game.finished) {
    const c = el('div', 'game-container');
    const h = el('div', 'game-header');
    h.append(el('h1', 'game-title', '👑 Цар гори'));
    h.append(el('p', 'game-subtitle', 'Обери найкращий тайтл. Кожен матч оновлює Elo.'));
    c.append(h);

    const withElo = Object.values(lib).filter(x => x.eloGames && x.eloGames > 0);
    if (withElo.length > 0) {
      const top3 = withElo.sort((a, b) => (b.elo || 1500) - (a.elo || 1500)).slice(0, 3);
      const insight = el('div', 'insight-card');
      insight.append(el('div', 'insight-label', '🏆 поточні чемпіони'));
      const list = top3.map((x, i) => `${i + 1}. ${x.title} (${Math.round(x.elo)})`).join(' • ');
      insight.append(el('div', 'insight-text', list));
      c.append(insight);
    }

    if (!state.gameSource) state.gameSource = 'tmdb';
    const srcSwitch = el('div', 'game-source-switch');
    const srcTmdb = el('button', 'game-source-pill' + (state.gameSource === 'tmdb' ? ' active' : ''), '🌍 Популярне TMDB');
    const srcLib = el('button', 'game-source-pill' + (state.gameSource === 'library' ? ' active' : ''), '📚 Моя бібліотека');
    srcTmdb.type = 'button';
    srcLib.type = 'button';
    srcTmdb.addEventListener('click', () => { state.gameSource = 'tmdb'; renderGame(); });
    srcLib.addEventListener('click', () => { state.gameSource = 'library'; renderGame(); });
    srcSwitch.append(srcTmdb, srcLib);
    c.append(srcSwitch);

    const mCount = Object.values(lib).filter(x => x.type === 'movie' && x.poster && hasWatched(x)).length;
    const tCount = Object.values(lib).filter(x => x.type === 'tv' && x.poster && hasWatched(x)).length;
    const bmLabel = state.gameSource === 'library' ? `🎬 Мої фільми (${mCount})` : '🎬 Грати з фільмами';
    const btLabel = state.gameSource === 'library' ? `📺 Мої серіали (${tCount})` : '📺 Грати з серіалами';

    const bm = el('button', 'game-btn primary', bmLabel);
    bm.addEventListener('click', () => startGame('movie', state.gameSource));
    const bt = el('button', 'game-btn secondary', btLabel);
    bt.addEventListener('click', () => startGame('tv', state.gameSource));
    c.append(bm, bt);

    const hist = JSON.parse(localStorage.getItem('kingOfTheHillHistory') || '[]');
    if (hist.length > 0) {
      const hd = el('div', 'game-history');
      hd.append(el('h3', '', '🏆 Список переможців'));
      hist.slice().reverse().forEach(h => {
        const it = el('div', 'history-item');
        if (h.champion && h.champion.poster) {
          const p = el('img', 'hi-poster'); p.src = TMDB_IMG + 'w92' + h.champion.poster; p.loading = 'lazy';
          it.append(p);
        } else it.append(el('div', 'hi-poster'));
        const inf = el('div', 'hi-info');
        inf.append(el('div', 'hi-title', (h.champion && h.champion.title) || '?'));
        inf.append(el('div', 'hi-meta', `${h.wins} ${plural(h.wins, 'перемога', 'перемоги', 'перемог')} · ${new Date(h.date).toLocaleDateString('uk-UA')}`));
        it.append(inf);
        hd.append(it);
      });
      c.append(hd);
    }
    box.append(c);
    return;
  }
  
  if (state.game.finished) { renderGameOver(); return; }
  
  const c = el('div', 'game-container');
  const stats = el('div', 'game-stats');
  stats.append(el('span', '', `${state.game.round + 1} / ${state.game.totalRounds}`));
  c.append(stats);
  if (state.game.loadError) {
    c.append(el('div', 'avail-empty', 'Не вдалося завантажити тайтли з TMDB.'));
    const backBtn = el('button', 'game-btn secondary', '← Назад');
    backBtn.addEventListener('click', () => { state.game.active = false; state.game.loadError = false; renderGame(); });
    c.append(backBtn);
    box.append(c);
    return;
  }
  if (!state.game.champion || !state.game.challenger) { c.append(el('div', 'avail-empty', 'Завантаження...')); box.append(c); return; }
  const arena = el('div', 'game-arena');

  const cc = el('div', 'game-card');
  const cp = el('img', 'game-card-poster'); cp.src = TMDB_IMG + 'w342' + state.game.champion.poster;
  cc.append(cp);
  const cb = el('div', 'game-card-body');
  cb.append(el('div', 'game-card-title', state.game.champion.title));
  let cm = state.game.champion.year || '';
  if (state.game.champion.tmdbRating) cm += (cm ? ' · ' : '') + state.game.champion.tmdbRating.toFixed(1);
  cb.append(el('div', 'game-card-meta', cm));
  const cElo = getElo(state.game.champion);
  cb.append(el('div', 'game-card-elo', `Elo ${Math.round(cElo)}`));
  cc.append(cb);
  cc.append(el('div', 'game-card-crown', '👑'));
  cc.addEventListener('click', () => makeGameChoice('champion'));
  arena.append(cc, el('div', 'game-vs-label', 'VS'));

  const ch = el('div', 'game-card');
  const chp = el('img', 'game-card-poster'); chp.src = TMDB_IMG + 'w342' + state.game.challenger.poster;
  ch.append(chp);
  const chb = el('div', 'game-card-body');
  chb.append(el('div', 'game-card-title', state.game.challenger.title));
  let chm = state.game.challenger.year || '';
  if (state.game.challenger.tmdbRating) chm += (chm ? ' · ' : '') + state.game.challenger.tmdbRating.toFixed(1);
  chb.append(el('div', 'game-card-meta', chm));
  const chElo = getElo(state.game.challenger);
  chb.append(el('div', 'game-card-elo', `Elo ${Math.round(chElo)}`));
  ch.append(chb);
  ch.addEventListener('click', () => makeGameChoice('challenger'));
  arena.append(ch);
  c.append(arena);

  const sk = el('button', 'game-btn secondary', '🤷 Не дивився (залишити чемпіона)');
  sk.addEventListener('click', () => makeGameChoice('skip'));
  c.append(sk);
  
  const exitBtn = el('button', 'game-btn danger', '🚪 Вийти з гри');
  exitBtn.addEventListener('click', () => {
    if (confirm('Вийти? Прогрес не збережеться.')) {
      state.game.active = false;
      state.game.finished = false;
      state.game.champion = null;
      state.game.challenger = null;
      state.game.history = [];
      state.game.round = 0;
      renderGame();
    }
  });
  c.append(exitBtn);

  if (state.game.history.length > 0) {
    const hd = el('div', 'game-history');
    hd.append(el('h3', '', '📜 Історія'));
    state.game.history.slice(-5).reverse().forEach(h => {
      const it = el('div', 'history-item');
      const p = el('img', 'hi-poster'); p.src = TMDB_IMG + 'w92' + h.winner.poster;
      it.append(p);
      const inf = el('div', 'hi-info');
      inf.append(el('div', 'hi-title', h.winner.title));
      inf.append(el('div', 'hi-meta', `Хід ${h.round + 1} · ${h.result === 'challenger' ? 'претендент' : h.result === 'champion' ? 'чемпіон' : 'пропуск'}`));
      it.append(inf);
      if (h.eloDelta) {
        const delta = el('div', 'elo-delta ' + (h.eloDelta > 0 ? 'up' : 'down'), (h.eloDelta > 0 ? '+' : '') + h.eloDelta);
        it.append(delta);
      }
      hd.append(it);
    });
    c.append(hd);
  }
  box.append(c);
}

async function startGame(type, source) {
  source = source || state.gameSource || 'tmdb';
  if (source === 'library') {
    const items = Object.values(lib).filter(x => x.type === type && x.poster && hasWatched(x));
    if (items.length < 2) {
      showCenterToast('❌ Потрібно мінімум 2 переглянуті тайтли цього типу');
      return;
    }
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    const champion = items.shift();
    const challenger = items.shift();
    state.game = {
      active: true, type, source: 'library',
      round: 0, totalRounds: Math.min(20, items.length + 1),
      champion, challenger, history: [], finished: false,
      pool: items, seen: new Set([champion.key, challenger.key]),
      usedPages: new Set(), loadingNext: false, loadError: false
    };
    renderGame();
    return;
  }

  state.game = { active: true, type, source: 'tmdb', round: 0, totalRounds: 20, champion: null, challenger: null, history: [], finished: false, pool: [], seen: new Set(), usedPages: new Set(), loadingNext: false, loadError: false };
  renderGame();
  try {
    await loadGameChampion();
    await loadGameChallenger();
    if (!state.game.champion || !state.game.challenger) state.game.loadError = true;
  } catch (e) {
    console.error(e);
    state.game.loadError = true;
  }
  renderGame();
}

async function refillGamePool() {
  const g = state.game;
  const path = g.type === 'movie' ? '/discover/movie' : '/discover/tv';
  for (let a = 0; a < 6 && g.pool.length < 6; a++) {
    let page;
    do { page = Math.floor(Math.random() * 15) + 1; } while (g.usedPages.has(page) && g.usedPages.size < 15);
    g.usedPages.add(page);
    try {
      const d = await tmdbFetch(`${path}?language=uk-UA&sort_by=popularity.desc&vote_count.gte=300&include_adult=false&page=${page}`);
      d.results.map(r => normalizeItem({ ...r, media_type: g.type }))
        .filter(r => r.poster && !g.seen.has(r.key) && !g.pool.some(x => x.key === r.key))
        .forEach(r => g.pool.push(r));
    } catch (e) { console.error(e); }
  }
}

function takeFromPool() {
  const g = state.game;
  if (!g.pool.length) return null;
  const item = g.pool.splice(Math.floor(Math.random() * g.pool.length), 1)[0];
  g.seen.add(item.key);
  return item;
}

async function loadGameChampion() { state.game.pool = []; await refillGamePool(); state.game.champion = takeFromPool(); }
async function loadGameChallenger() {
  if (state.game.source === 'library') {
    state.game.challenger = state.game.pool.shift() || null;
    if (!state.game.challenger) finishGame();
    return;
  }
  if (state.game.pool.length < 3) await refillGamePool();
  state.game.challenger = takeFromPool();
}

function makeGameChoice(choice) {
  if (!state.game.champion || !state.game.challenger || state.game.loadingNext) return;
  let winner, result, eloDelta = 0;
  if (choice === 'challenger') {
    winner = state.game.challenger;
    const eloResult = recordEloMatch(state.game.challenger, state.game.champion);
    if (eloResult) eloDelta = eloResult.delta;
    state.game.champion = winner;
    result = 'challenger';
  } else if (choice === 'champion') {
    winner = state.game.champion;
    const eloResult = recordEloMatch(state.game.champion, state.game.challenger);
    if (eloResult) eloDelta = eloResult.delta;
    result = 'champion';
  } else {
    winner = state.game.champion;
    result = 'skip';
  }
  state.game.history.push({ round: state.game.round, winner, result, eloDelta, champion: state.game.champion, challenger: state.game.challenger });
  state.game.round++;
  if (state.game.round >= state.game.totalRounds) { finishGame(); return; }
  state.game.loadingNext = true;
  loadGameChallenger()
    .then(() => { if (!state.game.challenger) state.game.loadError = true; })
    .catch((e) => { console.error(e); state.game.loadError = true; })
    .finally(() => { state.game.loadingNext = false; renderGame(); });
}

function finishGame() {
  state.game.finished = true;
  state.game.active = false;
  const hist = JSON.parse(localStorage.getItem('kingOfTheHillHistory') || '[]');
  hist.push({ date: new Date().toISOString(), wins: state.game.history.filter(h => h.result !== 'skip').length, total: state.game.totalRounds, type: state.game.type, champion: state.game.champion });
  localStorage.setItem('kingOfTheHillHistory', JSON.stringify(hist));
  renderGame();
}

function renderGameOver() {
  box.replaceChildren();
  const c = el('div', 'game-container game-over');
  c.append(el('h2', '', '🎉 Гра завершена!'));
  c.append(el('p', '', 'Твій фінальний чемпіон:'));
  if (state.game.champion) {
    const cd = el('div', 'game-card');
    cd.style.maxWidth = '300px';
    cd.style.margin = '0 auto 20px';
    const p = el('img', 'game-card-poster'); p.src = TMDB_IMG + 'w342' + state.game.champion.poster;
    cd.append(p);
    const body = el('div', 'game-card-body');
    body.append(el('div', 'game-card-title', state.game.champion.title));
    body.append(el('div', 'game-card-elo', `Elo ${Math.round(getElo(state.game.champion))}`));
    cd.append(body);
    c.append(cd);
  }
  const ba = el('button', 'game-btn primary', 'Грати знову');
  ba.addEventListener('click', () => { state.game.finished = false; state.game.active = false; renderGame(); });
  const bh = el('button', 'game-btn secondary', 'На головну');
  bh.addEventListener('click', () => setTab('home'));
  c.append(ba, bh);
  box.append(c);
}
