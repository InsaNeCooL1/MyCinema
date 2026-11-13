'use strict';

function renderStatistics() {
  box.style.padding = '0';
  box.replaceChildren();
  const wrap = el('div', 'home-wrap');
  const head = el('div', 'section-head');
  head.style.marginTop = '20px';
  head.append(el('h1', 'section-title', '📊 Обсерваторія'));
  wrap.append(head);

  const tabs = el('div', 'card-tabs');
  const tabDefs = [
    { id: 'taste', label: '🧬 Смак' },
    { id: 'series', label: '📺 Серіали' },
    { id: 'franchises', label: '🎞️ Франшизи' },
    { id: 'streaming', label: '📡 Стрімінги' },
    { id: 'elo', label: '🏆 Elo' },
    { id: 'actors', label: '🎭 Актори' },
    { id: 'genres', label: '🎬 Жанри' },
    { id: 'detail', label: '📈 Деталі' }
  ];
  for (const t of tabDefs) {
    const btn = el('button', 'card-tab' + (state.stats.tab === t.id ? ' active' : ''), t.label);
    btn.addEventListener('click', () => { if (state.stats.tab === t.id) return; state.stats.tab = t.id; renderStatistics(); });
    tabs.append(btn);
  }
  wrap.append(tabs);

  const content = el('div'); content.style.marginTop = '16px';
  if (state.stats.tab === 'taste') content.append(...renderTasteTab());
  else if (state.stats.tab === 'series') content.append(...renderSeriesTab());
  else if (state.stats.tab === 'franchises') content.append(...renderFranchisesTab());
  else if (state.stats.tab === 'streaming') content.append(...renderStreamingTab());
  else if (state.stats.tab === 'elo') content.append(...renderEloTab());
  else if (state.stats.tab === 'actors') content.append(...renderActorsTab());
  else if (state.stats.tab === 'genres') content.append(...renderGenresTab());
  else if (state.stats.tab === 'detail') content.append(...renderDetailTab());

  wrap.append(content);
  box.append(wrap);
}

function getMissingMetaItems() {
  /* FIX-MISSING-META */
  return Object.values(lib).filter(x => {
    const isActive = hasWatched(x) || x.status === 'planned' || x.favorite === true; /* FIX-MISSING-META-FAV */
    if (!isActive) return false;
    if (!x.cast?.length) return true;
    if (x.type === 'movie' && !x.runtime) return true;
    return false;
  });
}

function buildMetaLoaderBanner() {
  const items = Object.values(lib);
  const missing = getMissingMetaItems();
  if (!missing.length) return null;

  const loader = el('div', 'cast-loader');
  if (state.stats.castLoading) {
    const lt = el('div', 'cast-loader-text', `Оновлюю метадані (актори, час, стрімінги): ${state.stats.castProgress.done}/${state.stats.castProgress.total}...`);
    lt.id = 'meta-loader-progress-text';
    loader.append(lt);
  } else {
    loader.append(el('div', 'cast-loader-text', `Для ${missing.length} з ${items.length} тайтлів ще немає повних метаданих (час, стрімінги або актори)`));
    const btn = el('button', 'cast-loader-btn', '📥 Завантажити метадані з TMDB');
    btn.addEventListener('click', async () => {
      state.stats.castLoading = true;
      state.stats.castProgress = { done: 0, total: missing.length };
      renderStatistics();
      await fetchAllMissingMeta();
      state.stats.castLoading = false;
      renderStatistics();
    });
    loader.append(btn);
  }
  return loader;
}

async function fetchAllMissingMeta() {
  const missing = getMissingMetaItems();
  const batchSize = 5;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    await Promise.all(batch.map(async item => {
      try {
        const d = await tmdbFetch(`/${item.type}/${item.id}?language=uk-UA&append_to_response=credits,watch/providers`);
        if (!lib[item.key]) return;
        const meta = typeof extractItemMeta === 'function' ? extractItemMeta(d, item.type) : {};
        /* FIX-META-SAVE */
        let changed = false;
        if (meta.cast && !lib[item.key].cast?.length) { lib[item.key].cast = meta.cast; changed = true; }
        if (meta.genres && !lib[item.key].genres?.length) { lib[item.key].genres = meta.genres; changed = true; }
        if (meta.runtime && !lib[item.key].runtime) { lib[item.key].runtime = meta.runtime; changed = true; }
        if (meta.episode_count && !lib[item.key].episode_count) { lib[item.key].episode_count = meta.episode_count; changed = true; }
        if (meta.totalSeasons && !lib[item.key].totalSeasons) { lib[item.key].totalSeasons = meta.totalSeasons; changed = true; }
        if (meta.platforms && !lib[item.key].platforms?.length) { lib[item.key].platforms = meta.platforms; changed = true; }
        if (lib[item.key].franchiseKey === undefined && 'franchiseKey' in meta) { lib[item.key].franchiseKey = meta.franchiseKey; changed = true; }
        if (item.type === 'movie' && lib[item.key].collection === undefined && 'collection' in meta) { lib[item.key].collection = meta.collection; changed = true; }
        if (changed) { _dirtyItems.add(item.key); lib[item.key].updated = Date.now(); }
      } catch {}
    }));
    state.stats.castProgress.done = Math.min(missing.length, i + batchSize);
    const lt = document.getElementById('meta-loader-progress-text');
    if (lt) lt.textContent = `Оновлюю метадані (актори, час, стрімінги): ${state.stats.castProgress.done}/${state.stats.castProgress.total}...`;
    save(); /* FIX-META-SAVE-BATCH */
    await new Promise(r => setTimeout(r, 200));
  }
  save();
}

function fmtDuration(totalMin) {
  if (!totalMin || totalMin <= 0) return '0 год';
  const hrs = totalMin / 60;
  if (hrs >= 48) {
    const days = hrs / 24;
    return `${Math.round(hrs)} год (${fmtNum(days)} дн)`;
  }
  return hrs >= 10 ? `${Math.round(hrs)} год` : `${fmtNum(hrs)} год`;
}

function computeWatchTimeStats() {
  let movieMin = 0, movieKnown = 0, movieTotal = 0;
  let tvMin = 0, tvEpsWatched = 0, tvKnown = 0, tvTotal = 0;

  Object.values(lib).forEach(x => {
    if (!hasWatched(x)) return;
    if (x.type === 'movie') {
      movieTotal++;
      if (x.runtime > 0) { movieMin += x.runtime; movieKnown++; }
    } else if (x.type === 'tv') {
      tvTotal++;
      let eps = (x.watchedEpisodes && x.watchedEpisodes.length) || 0;
      if (x.status === 'watched' && (x.episode_count || 0) > eps) eps = x.episode_count;
      tvEpsWatched += eps;
      if (eps > 0 && x.runtime > 0) { tvMin += eps * x.runtime; tvKnown++; }
    }
  });
  return { movieMin, movieKnown, movieTotal, tvMin, tvEpsWatched, tvKnown, tvTotal, totalMin: movieMin + tvMin };
}

function renderTasteTab() {
  const taste = computeTasteVector();
  if (!taste || taste.count < 3) return [el('div', 'avail-empty', 'Потрібно мінімум 3 оцінки, щоб побачити аналіз')];
  const wrap = el('div');

  wrap.append(buildTasteCard(taste));

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = Object.values(lib).filter(x => (x.updated || 0) > cutoff && computeItemRating(x).avg > 0);

  if (recent.length >= 3) {
    const recentTaste = { count: recent.length };
    const sums = {}, weights = {};
    for (const crit of RATING_CRITERIA) { sums[crit.key] = 0; weights[crit.key] = 0; }
    for (const item of recent) {
      const rr = item.type === 'tv' ? averagedSeasonRatings(item) : (item.ratings || {});
      for (const crit of RATING_CRITERIA) {
        if (rr[crit.key]) { sums[crit.key] += rr[crit.key]; weights[crit.key]++; }
      }
    }
    for (const crit of RATING_CRITERIA) recentTaste[crit.key] = weights[crit.key] > 0 ? sums[crit.key] / weights[crit.key] : 0;

    wrap.append(el('h3', 'label', '📈 Еволюція · 30 днів vs весь час'));
    const trend = el('div', 'trend-chart');
    for (const crit of RATING_CRITERIA) {
      const oldV = taste[crit.key] || 0;
      const newV = recentTaste[crit.key] || 0;
      const diff = newV - oldV;
      const row = el('div', 'trend-item');
      const labels = el('div', 'trend-labels');
      labels.append(el('span', '', crit.label));
      const sign = diff > 0.1 ? '↑' : (diff < -0.1 ? '↓' : '→');
      const color = diff > 0.1 ? 'var(--mint)' : (diff < -0.1 ? 'var(--danger)' : 'var(--text-muted)');
      const right = el('span'); right.innerHTML = `${fmtNum(oldV)} → <strong style="color:${color}">${fmtNum(newV)}</strong> ${sign}`;
      labels.append(right);
      row.append(labels);
      const bars = el('div', 'trend-bars');
      const oldBar = el('div', 'trend-bar-old'); oldBar.style.width = (oldV / 10 * 100) + '%';
      const newBar = el('div', 'trend-bar-new'); newBar.style.width = (newV / 10 * 100) + '%';
      bars.append(oldBar, newBar);
      row.append(bars);
      trend.append(row);
    }
    wrap.append(trend);
    const legend = el('div', 'trend-legend');
    legend.innerHTML = '<span class="old">весь час</span><span class="new">30 днів</span>';
    wrap.append(legend);
  }

  wrap.append(el('h3', 'label', '💡 Інсайти'));
  const insights = [];

  // Беремо УСІ оцінені тайтли: і фільми (ratings), і серіали (seasonRatings)
  const rated = Object.values(lib)
    .map(x => ({ item: x, r: computeItemRating(x) }))
    .filter(x => x.r.avg > 0);

  const critsOf = (item) => item.type === 'tv' ? averagedSeasonRatings(item) : (item.ratings || {});
  const withCrits = rated.filter(x => {
    const c = critsOf(x.item);
    return c && Object.values(c).some(v => v > 0);
  });

  // 1. Кореляція сюжету та касту (тепер і для серіалів!)
  if (withCrits.length >= 5) {
    const plotHigh = withCrits.filter(x => (critsOf(x.item).plot || 0) >= 8);
    const castHigh = withCrits.filter(x => (critsOf(x.item).cast || 0) >= 8);
    if (plotHigh.length >= 3 && castHigh.length >= 3) {
      const overlap = plotHigh.filter(x => (critsOf(x.item).cast || 0) >= 8).length;
      if (overlap / plotHigh.length > 0.6) {
        insights.push({ icon: '🎯', text: `Коли тобі заходить сюжет (<strong>8+</strong>), ти майже завжди високо оцінюєш і каст — у <strong>${Math.round(overlap / plotHigh.length * 100)}%</strong> випадків.` });
      }
    }
  }

  // 2. Середня власна оцінка (без дивного "ніж інші")
  if (rated.length >= 5) {
    const avg = rated.reduce((s, x) => s + x.r.avg, 0) / rated.length;
    const strict = avg < 6.5, generous = avg > 7.5;
    insights.push({
      icon: generous ? '🌟' : (strict ? '🔍' : '⚖️'),
      text: `Твоя середня оцінка по всій бібліотеці — <strong>${fmtNum(avg)}/10</strong> (${rated.length} тайтлів). ${generous ? 'Оцінюєш досить щедро — напевно вправно підбираєш кіно під свій смак.' : strict ? 'Тримаєш високу планку — ставиш високі бали лише справді сильному кіно.' : 'Оцінюєш збалансовано й виважено.'}`
    });
  }

  // 3. Найвищий бал (з Elo tie-breaker і всіма типами)
  if (rated.length > 0) {
    const sortedTop = [...rated].sort((a, b) =>
      (b.r.avg - a.r.avg) || ((b.item.elo || ELO_START) - (a.item.elo || ELO_START))
    );
    const bestScore = sortedTop[0].r.avg;
    const tiedCount = sortedTop.filter(x => Math.abs(x.r.avg - bestScore) < 0.05).length;
    const tieNote = tiedCount > 1 ? ` (разом із ще ${tiedCount - 1})` : '';
    insights.push({ icon: '👑', text: `Твій найвищий бал — <strong>${fmtNum(bestScore)}/10</strong> — у «${escapeHtml(sortedTop[0].item.title)}»${tieNote}.` });
  }

  // 4. Фільми vs Серіали (тепер реально працює!)
  const movieRated = rated.filter(x => x.item.type === 'movie');
  const tvRated = rated.filter(x => x.item.type === 'tv');
  if (movieRated.length >= 3 && tvRated.length >= 3) {
    const mAvg = movieRated.reduce((a, b) => a + b.r.avg, 0) / movieRated.length;
    const tAvg = tvRated.reduce((a, b) => a + b.r.avg, 0) / tvRated.length;
    const diff = tAvg - mAvg;
    if (Math.abs(diff) >= 0.4) {
      insights.push({ icon: diff > 0 ? '📺' : '🎬', text: `Ти оцінюєш ${diff > 0 ? 'серіали' : 'фільми'} в середньому на <strong>${fmtNum(Math.abs(diff))}</strong> вище, ніж ${diff > 0 ? 'фільми' : 'серіали'} (${fmtNum(diff > 0 ? tAvg : mAvg)} проти ${fmtNum(diff > 0 ? mAvg : tAvg)}).` });
    }
  }

  // 5. Ти vs TMDB (суворість і найбільший контраст)
  const withTmdb = rated.filter(x => x.item.tmdbRating > 0);
  if (withTmdb.length >= 5) {
    const diffs = withTmdb.map(x => ({ ...x, delta: x.r.avg - x.item.tmdbRating }));
    const avgDelta = diffs.reduce((s, x) => s + x.delta, 0) / diffs.length;
    if (Math.abs(avgDelta) >= 0.3) {
      insights.push({
        icon: '🧪',
        text: `У середньому ти ставиш оцінки на <strong>${fmtNum(Math.abs(avgDelta))}</strong> ${avgDelta > 0 ? 'вище' : 'нижче'}, ніж середній рейтинг TMDB.`
      });
    }
    const over = [...diffs].sort((a, b) => b.delta - a.delta)[0];
    const under = [...diffs].sort((a, b) => a.delta - b.delta)[0];
    if (over && over.delta >= 1.5) {
      insights.push({
        icon: '💎',
        text: `Твій особистий скарб проти натовпу: «${escapeHtml(over.item.title)}» — твоя оцінка <strong>${fmtNum(over.r.avg)}</strong> при TMDB ${over.item.tmdbRating.toFixed(1)}.`
      });
    } else if (under && under.delta <= -1.5) {
      insights.push({
        icon: '🤨',
        text: `Не зайшло попри хайп: «${escapeHtml(under.item.title)}» — ти поставив <strong>${fmtNum(under.r.avg)}</strong> при TMDB ${under.item.tmdbRating.toFixed(1)}.`
      });
    }
  }

  // 6. Золота епоха (десятиліття з найвищою оцінкою)
  const decMap = {};
  rated.forEach(x => {
    const y = parseInt(x.item.year);
    if (!y || y < 1920) return;
    const dec = Math.floor(y / 10) * 10;
    if (!decMap[dec]) decMap[dec] = { sum: 0, cnt: 0 };
    decMap[dec].sum += x.r.avg;
    decMap[dec].cnt++;
  });
  const decList = Object.entries(decMap)
    .filter(([, v]) => v.cnt >= 3)
    .map(([dec, v]) => ({ dec, avg: v.sum / v.cnt, cnt: v.cnt }))
    .sort((a, b) => b.avg - a.avg);
  if (decList.length >= 2) {
    const bestD = decList[0];
    insights.push({
      icon: '🕰️',
      text: `Твоя «золота епоха» — <strong>${bestD.dec}-ті</strong>: середня оцінка <strong>${fmtNum(bestD.avg)}/10</strong> (${bestD.cnt} тайтлів).`
    });
  }

  // 7. Дивишся найчастіше vs Цінуєш найбільше (жанри)
  const gCount = {};
  const gRating = {};
  Object.values(lib).filter(hasWatched).forEach(x => {
    (x.genres || []).forEach(gid => { gCount[gid] = (gCount[gid] || 0) + 1; });
  });
  rated.forEach(x => {
    (x.item.genres || []).forEach(gid => {
      if (!gRating[gid]) gRating[gid] = { sum: 0, cnt: 0 };
      gRating[gid].sum += x.r.avg;
      gRating[gid].cnt++;
    });
  });
  const topWatchG = Object.entries(gCount).sort((a, b) => b[1] - a[1])[0];
  const topRateG = Object.entries(gRating)
    .filter(([, v]) => v.cnt >= 3)
    .map(([gid, v]) => ({ gid: parseInt(gid), avg: v.sum / v.cnt, cnt: v.cnt }))
    .sort((a, b) => b.avg - a.avg)[0];
  if (topWatchG && topRateG) {
    const wGObj = GENRES.find(g => g.id === parseInt(topWatchG[0]));
    const rGObj = GENRES.find(g => g.id === topRateG.gid);
    if (wGObj && rGObj) {
      if (wGObj.id !== rGObj.id) {
        insights.push({
          icon: '🎭',
          text: `Найчастіше ти дивишся <strong>${wGObj.name}</strong> (${topWatchG[1]}), але найвищу середню оцінку отримує <strong>${rGObj.name}</strong> — <strong>${fmtNum(topRateG.avg)}/10</strong>.`
        });
      } else {
        insights.push({
          icon: '❤️',
          text: `Твій беззаперечний фаворит — <strong>${rGObj.name}</strong>: і лідер за кількістю (${topWatchG[1]}), і найвищий середній бал (<strong>${fmtNum(topRateG.avg)}/10</strong>).`
        });
      }
    }
  }

  // 8. Кіно-ритм (день тижня + додивлюваність)
  const finished = Object.values(lib).filter(x => x.status === 'watched' && (x.statusDate || x.updated));
  const droppedCnt = Object.values(lib).filter(x => x.status === 'dropped').length;
  if (finished.length >= 8) {
    const days = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота'];
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    finished.forEach(x => {
      const d = new Date(x.statusDate || x.updated).getDay();
      dayCounts[d]++;
    });
    const bestDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
    let rhythmTxt = `Найчастіше ти завершуєш тайтли у день: <strong>${days[bestDayIdx]}</strong>.`;
    if (droppedCnt > 0) {
      const compRate = Math.round((finished.length / (finished.length + droppedCnt)) * 100);
      rhythmTxt += ` Доводиш до фіналу <strong>${compRate}%</strong> розпочатого (проти ${droppedCnt} закинутих).`;
    }
    insights.push({ icon: '🗓️', text: rhythmTxt });
  }

  for (const ins of insights) {
    const c = el('div', 'insight-card');
    c.append(el('div', 'insight-label', ins.icon + ' інсайт'));
    const t = el('div', 'insight-text'); t.innerHTML = ins.text;
    c.append(t);
    wrap.append(c);
  }
  return [wrap];
}

function renderSeriesTab() {
  const wrap = el('div');
  const loader = buildMetaLoaderBanner();
  if (loader) wrap.append(loader);

  const allTv = Object.values(lib).filter(x => x.type === 'tv');
  if (!allTv.length) {
    wrap.append(el('div', 'avail-empty', 'Поки немає серіалів у бібліотеці'));
    return [wrap];
  }

  const watching = allTv.filter(x => x.status === 'watching');
  const watched = allTv.filter(x => x.status === 'watched');
  const dropped = allTv.filter(x => x.status === 'dropped');
  const wt = computeWatchTimeStats();

  let totalSeasonsWatched = 0;
  allTv.forEach(x => {
    if (x.status === 'watched') totalSeasonsWatched += (x.totalSeasons || Object.keys(x.seasonRatings || {}).length || 1);
    else if (x.status === 'watching' && x.watchedEpisodes?.length) {
      const sSet = new Set(x.watchedEpisodes.map(k => k.split('-')[0]));
      totalSeasonsWatched += sSet.size;
    }
  });

  const sg = el('div', 'stats-grid');
  const addStat = (l, v) => {
    const s = el('div', 'stat-card');
    s.append(el('div', 'stat-value', String(v)), el('div', 'stat-label', l));
    sg.append(s);
  };
  addStat('Переглянуто серій', wt.tvEpsWatched);
  addStat('Час на серіали', fmtDuration(wt.tvMin).split(' ')[0] + ' год');
  addStat('Завершено / В процесі', `${watched.length} / ${watching.length}`);
  addStat('Сезонів · Закинуто', `${totalSeasonsWatched} · ${dropped.length}`);
  wrap.append(sg);

  if (wt.tvTotal > 0 && wt.tvKnown < wt.tvTotal) {
    const note = el('div', 'notes-hint', `⏱ Точний хронометраж відомий для ${wt.tvKnown} з ${wt.tvTotal} переглянутих/активних серіалів.`);
    note.style.marginBottom = '16px';
    wrap.append(note);
  }

  // Прогрес поточних серіалів ("Дивлюсь")
  if (watching.length) {
    wrap.append(el('h3', 'label', `▶️ Прогрес по серіалах у процесі (${watching.length})`));
    const list = el('div', 'series-progress-list');
    watching
      .slice()
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .forEach(s => {
        const done = (s.watchedEpisodes || []).length;
        const tot = s.episode_count || 0;
        const pct = tot > 0 ? Math.min(100, Math.round((done / tot) * 100)) : 0;
        const row = el('div', 'series-prog-row');
        if (s.poster) {
          const p = el('img', 'elo-poster'); p.src = TMDB_IMG + 'w92' + s.poster; p.loading = 'lazy';
          row.append(p);
        }
        const body = el('div', 'series-prog-body');
        const top = el('div', 'series-prog-top');
        top.append(el('span', 'elo-title', s.title));
        const valTxt = tot > 0 ? `${done}/${tot} (${pct}%)` : `${done} сер.`;
        top.append(el('span', 'series-prog-val', valTxt));
        body.append(top);

        const bar = el('div', 'item-progress');
        const fill = el('div', 'item-progress-fill');
        fill.style.width = (tot > 0 ? pct : (done > 0 ? 15 : 0)) + '%';
        bar.append(fill);
        body.append(bar);

        if (tot > done && s.runtime > 0) {
          const remHrs = ((tot - done) * s.runtime) / 60;
          body.append(el('div', 'elo-games', `залишилось ~${remHrs >= 10 ? Math.round(remHrs) : fmtNum(remHrs)} год`));
        }
        row.append(body);
        row.addEventListener('click', () => openCard(s));
        list.append(row);
      });
    wrap.append(list);
  }

  // Топ за часом / кількістю переглянутих серій
  const byTime = allTv
    .map(x => {
      let eps = (x.watchedEpisodes && x.watchedEpisodes.length) || 0;
      if (x.status === 'watched' && (x.episode_count || 0) > eps) eps = x.episode_count;
      const mins = x.runtime > 0 ? eps * x.runtime : 0;
      return { item: x, eps, mins };
    })
    .filter(x => x.eps > 0)
    .sort((a, b) => b.mins - a.mins || b.eps - a.eps)
    .slice(0, 10);

  if (byTime.length) {
    wrap.append(el('h3', 'label', '⏱️ Найбільше часу проведено за серіалами'));
    const lb = el('div', 'elo-lb');
    byTime.forEach((x, idx) => {
      const row = el('div', 'elo-row');
      row.append(el('div', 'elo-rank', String(idx + 1)));
      if (x.item.poster) {
        const p = el('img', 'elo-poster'); p.src = TMDB_IMG + 'w92' + x.item.poster; p.loading = 'lazy';
        row.append(p);
      }
      const info = el('div', 'elo-info');
      info.append(el('div', 'elo-title', x.item.title));
      info.append(el('div', 'elo-games', `${x.eps} ${plural(x.eps, 'серія', 'серії', 'серій')}`));
      row.append(info);
      row.append(el('div', 'elo-value', x.mins > 0 ? fmtDuration(x.mins) : `${x.eps} с.`));
      row.addEventListener('click', () => openCard(x.item));
      lb.append(row);
    });
    wrap.append(lb);
  }

  return [wrap];
}


const COL_CACHE_KEY = 'mycinema.colCache.v1';
const COL_CACHE_TTL = 24 * 60 * 60 * 1000; /* FIX-COL-TTL */

function readColCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(COL_CACHE_KEY)) || {};
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch { return {}; }
}

function writeColCache(cache) {
  try { localStorage.setItem(COL_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

async function fetchMissingCollections(colIds) {
  if (state.stats.colLoading) return;
  state.stats.colLoading = true;
  const cache = readColCache();
  const now = Date.now();
  const todo = colIds.filter(id => !cache[id] || (now - (cache[id].ts || 0)) > COL_CACHE_TTL).slice(0, 15);
  try {
    for (let i = 0; i < todo.length; i += 4) {
      const batch = todo.slice(i, i + 4);
      await Promise.all(batch.map(async id => {
        try {
          const d = await tmdbFetch(`/collection/${id}?language=uk-UA`);
          const parts = (d.parts || [])
            .map(p => ({
              id: p.id,
              title: p.title || '',
              poster: p.poster_path || null,
              backdrop: p.backdrop_path || null,
              release_date: p.release_date || '',
              year: (p.release_date || '').slice(0, 4),
              vote_average: p.vote_average || 0,
              overview: p.overview || ''
            }))
            .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'));
          cache[id] = { ts: Date.now(), name: d.name || '', poster: d.poster_path || null, parts };
        } catch {}
      }));
    }
    writeColCache(cache);
  } finally {
    state.stats.colLoading = false;
    if (state.tab === 'statistics' && state.stats.tab === 'franchises') renderStatistics();
  }
}

function renderFranchisesTab() {
  const wrap = el('div');
  const loader = buildMetaLoaderBanner();
  if (loader) wrap.append(loader);

  const moviesWithCol = Object.values(lib).filter(x => x.type === 'movie' && x.collection && x.collection.id);
  if (!moviesWithCol.length) {
    wrap.append(el('div', 'avail-empty', 'Поки немає даних про франшизи. Натисни «Завантажити метадані з TMDB» вище або відкрий картки фільмів.'));
    return [wrap];
  }

  const colMap = new Map();
  moviesWithCol.forEach(m => {
    const cid = m.collection.id;
    if (!colMap.has(cid)) {
      colMap.set(cid, {
        id: cid,
        name: m.collection.name || 'Франшиза',
        poster: m.collection.poster || m.poster || null,
        inLib: []
      });
    }
    const entry = colMap.get(cid);
    if (!entry.poster && m.poster) entry.poster = m.poster;
    entry.inLib.push(m);
  });

  const colCache = readColCache();
  const now = Date.now();
  const colIds = [...colMap.keys()];
  const needFetchIds = colIds.filter(id => !colCache[id] || (now - (colCache[id].ts || 0)) > COL_CACHE_TTL);
  if (needFetchIds.length && !state.stats.colLoading) {
    setTimeout(() => fetchMissingCollections(needFetchIds), 50);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const franchises = [...colMap.values()].map(c => {
    const cached = colCache[c.id];
    const parts = cached?.parts?.length ? cached.parts : null;
    const releasedParts = parts
      ? parts.filter(p => p.release_date && p.release_date <= todayIso)
      : c.inLib;
    const totalParts = releasedParts.length || (parts ? parts.length : c.inLib.length);
    const watchedInLib = c.inLib.filter(hasWatched);
    const watchedSet = new Set(watchedInLib.map(x => x.id));
    const watchedCount = parts
      ? releasedParts.filter(p => watchedSet.has(p.id)).length
      : watchedInLib.length;
    const rated = c.inLib.map(x => ({ item: x, avg: computeItemRating(x).avg })).filter(x => x.avg > 0);
    const avgRating = rated.length ? rated.reduce((s, x) => s + x.avg, 0) / rated.length : 0;
    const mins = watchedInLib.reduce((s, x) => s + (x.runtime || 0), 0);
    const pct = totalParts > 0 ? Math.min(100, Math.round((watchedCount / totalParts) * 100)) : 0;
    const completed = totalParts >= 2 && watchedCount >= totalParts;
    return {
      ...c,
      name: (cached?.name || c.name).replace(/\s*\(Колекція\)\s*$/i, '').replace(/\s*Collection\s*$/i, ''),
      poster: cached?.poster || c.poster,
      parts,
      totalParts,
      watchedCount,
      ratedCount: rated.length,
      avgRating,
      mins,
      pct,
      completed
    };
  }).sort((a, b) => b.watchedCount - a.watchedCount || b.avgRating - a.avgRating || b.inLib.length - a.inLib.length);

  const totalWatchedInFr = franchises.reduce((s, f) => s + f.watchedCount, 0);
  const totalPartsKnown = franchises.reduce((s, f) => s + f.totalParts, 0);
  const completedCount = franchises.filter(f => f.completed).length;
  const totalMins = franchises.reduce((s, f) => s + f.mins, 0);

  const sg = el('div', 'stats-grid');
  const addS = (l, v) => { const s = el('div', 'stat-card'); s.append(el('div', 'stat-value', String(v)), el('div', 'stat-label', l)); sg.append(s); };
  addS('Франшиз', franchises.length);
  addS('Завершено повністю', completedCount);
  addS('Переглянуто частин', `${totalWatchedInFr}/${totalPartsKnown}`);
  addS('Час у франшизах', totalMins > 0 ? fmtDuration(totalMins).split(' ')[0] + ' год' : '—');
  wrap.append(sg);

  const favFr = [...franchises].filter(f => f.ratedCount >= 2).sort((a, b) => b.avgRating - a.avgRating || b.watchedCount - a.watchedCount)[0];
  if (favFr) {
    const ins = el('div', 'insight-card');
    ins.append(el('div', 'insight-label', '🏆 Улюблена франшиза'));
    const txt = el('div', 'insight-text');
    // [XSS-FRANCHISE-FIX]
    txt.append(document.createTextNode('Найвище ти оцінив серію «'));
    const b1 = el('strong'); b1.textContent = favFr.name; txt.append(b1);
    txt.append(document.createTextNode('» — середня оцінка '));
    const b2 = el('strong'); b2.textContent = fmtNum(favFr.avgRating) + '/10'; txt.append(b2);
    txt.append(document.createTextNode(` (${favFr.watchedCount}/${favFr.totalParts} переглянуто).`));
    ins.append(txt);
    wrap.append(ins);
  }

  if (!state.stats.openFranchises) state.stats.openFranchises = {};

  wrap.append(el('h3', 'label', `Усі франшизи (${franchises.length})${state.stats.colLoading ? ' · оновлюю частини...' : ''}`));

  const list = el('div', 'franchise-list');
  franchises.forEach(fr => {
    const isOpen = !!state.stats.openFranchises[fr.id];
    const cardWrap = el('div', 'franchise-card' + (isOpen ? ' open' : ''));

    const row = el('div', 'franchise-head');
    if (fr.poster) {
      const p = el('img', 'elo-poster'); p.src = TMDB_IMG + 'w92' + fr.poster; p.loading = 'lazy';
      row.append(p);
    } else {
      row.append(el('div', 'actor-rank-photo-empty', '🎞️'));
    }

    const body = el('div', 'franchise-body');
    const top = el('div', 'series-prog-top');
    top.append(el('span', 'elo-title', fr.name));
    const rightVal = fr.avgRating > 0
      ? `⭐ ${fmtNum(fr.avgRating)}`
      : (fr.completed ? '✓ 100%' : `${fr.pct}%`);
    const valEl = el('span', 'series-prog-val' + (fr.avgRating > 0 ? ' ' + ratingClass(fr.avgRating) : ''), rightVal);
    top.append(valEl);
    body.append(top);

    let subTxt = `${fr.watchedCount} з ${fr.totalParts} ${plural(fr.totalParts, 'фільм', 'фільми', 'фільмів')}`;
    if (fr.completed) subTxt += ' · Завершено';
    if (fr.mins > 0) subTxt += ` · ~${fmtDuration(fr.mins)}`;
    body.append(el('div', 'elo-games', subTxt));

    const bar = el('div', 'item-progress');
    const fill = el('div', 'item-progress-fill');
    fill.style.width = fr.pct + '%';
    bar.append(fill);
    body.append(bar);

    row.append(body);
    row.append(el('span', 'franchise-chev', isOpen ? '▴' : '▾'));

    const partsBox = el('div', 'franchise-parts');
    partsBox.style.display = isOpen ? 'flex' : 'none';

    const renderParts = () => {
      partsBox.replaceChildren();
      const rawParts = fr.parts || fr.inLib.slice().sort((a, b) => (a.year || '9999').localeCompare(b.year || '9999'));
      rawParts.forEach(p => {
        const saved = lib['movie-' + p.id];
        const partItem = saved || normalizeItem({ ...p, media_type: 'movie', poster_path: p.poster });
        const pr = el('div', 'franchise-part-row');
        if (partItem.poster) {
          const pp = el('img', 'franchise-part-poster'); pp.src = TMDB_IMG + 'w92' + partItem.poster; pp.loading = 'lazy';
          pr.append(pp);
        } else {
          pr.append(el('div', 'franchise-part-poster poster-empty'));
        }
        const pi = el('div', 'elo-info');
        pi.append(el('div', 'elo-title', partItem.title || p.title));
        const isFuture = p.release_date && p.release_date > todayIso;
        let meta = partItem.year || (isFuture ? 'Анонс' : '—');
        if (saved?.status === 'watched') meta += ' · ✅ Переглянуто';
        else if (saved?.status === 'planned') meta += ' · 📅 Планую';
        else if (saved?.status === 'dropped') meta += ' · 🕸️ Закинуто';
        else if (isFuture) meta += ' · 🗓️ Незабаром';
        else meta += ' · Ще не в бібліотеці';
        pi.append(el('div', 'elo-games', meta));
        pr.append(pi);

        const sAvg = saved ? computeItemRating(saved).avg : 0;
        if (sAvg > 0) {
          pr.append(el('span', 'badge rated ' + ratingClass(sAvg), fmtNum(sAvg)));
        }
        pr.addEventListener('click', (e) => { e.stopPropagation(); openCard(partItem); });
        partsBox.append(pr);
      });
    };

    if (isOpen) renderParts();

    row.addEventListener('click', () => {
      const next = !state.stats.openFranchises[fr.id];
      state.stats.openFranchises[fr.id] = next;
      cardWrap.classList.toggle('open', next);
      row.querySelector('.franchise-chev').textContent = next ? '▴' : '▾';
      if (next && !partsBox.childElementCount) renderParts();
      partsBox.style.display = next ? 'flex' : 'none';
    });

    cardWrap.append(row, partsBox);
    list.append(cardWrap);
  });

  wrap.append(list);
  return [wrap];
}

function renderStreamingTab() {
  const wrap = el('div');
  const loader = buildMetaLoaderBanner();
  if (loader) wrap.append(loader);

  const items = Object.values(lib).filter(x => (hasWatched(x) || x.status === 'planned') && x.platforms?.length);
  if (!items.length) {
    wrap.append(el('div', 'avail-empty', 'Поки немає даних про стрімінги. Натисни «Завантажити метадані з TMDB» вище або відкрий кілька карток.'));
    return [wrap];
  }

  const platMap = new Map();
  items.forEach(item => {
    const watched = hasWatched(item);
    const avg = computeItemRating(item).avg;
    item.platforms.forEach(p => {
      if (!platMap.has(p.key)) {
        platMap.set(p.key, { key: p.key, name: p.name, logo: p.logo, total: 0, watched: 0, ratedSum: 0, ratedCnt: 0, movies: 0, tv: 0 });
      }
      const st = platMap.get(p.key);
      if (!st.logo && p.logo) st.logo = p.logo;
      st.total++;
      if (watched) {
        st.watched++;
        if (item.type === 'movie') st.movies++;
        else st.tv++;
      }
      if (avg > 0) { st.ratedSum += avg; st.ratedCnt++; }
    });
  });

  const list = [...platMap.values()]
    .filter(p => p.watched > 0)
    .sort((a, b) => b.watched - a.watched || (b.ratedCnt ? b.ratedSum / b.ratedCnt : 0) - (a.ratedCnt ? a.ratedSum / a.ratedCnt : 0));

  if (!list.length) {
    wrap.append(el('div', 'avail-empty', 'Немає переглянутих тайтлів із визначеним стрімінгом'));
    return [wrap];
  }

  const topByCount = list[0];
  const topByQuality = [...list].filter(p => p.ratedCnt >= 3).sort((a, b) => (b.ratedSum / b.ratedCnt) - (a.ratedSum / a.ratedCnt))[0];
  if (topByCount) {
    const ins = el('div', 'insight-card');
    ins.append(el('div', 'insight-label', '📡 Стрімінг-профіль'));
    // [XSS-STREAMING-FIX] Безпечна побудова без innerHTML
    const t = el('div', 'insight-text');
    t.append(document.createTextNode('Найчастіше ти дивишся проєкти з '));
    const sb1 = el('strong'); sb1.textContent = topByCount.name; t.append(sb1);
    t.append(document.createTextNode(` (${topByCount.watched} тайтлів).`));
    if (topByQuality) {
      t.append(document.createTextNode(' Найвищу середню оцінку від тебе отримує '));
      const sb2 = el('strong'); sb2.textContent = topByQuality.name; t.append(sb2);
      t.append(document.createTextNode(' — '));
      const sb3 = el('strong'); sb3.textContent = fmtNum(topByQuality.ratedSum / topByQuality.ratedCnt) + '/10'; t.append(sb3);
      t.append(document.createTextNode('.'));
    }
    ins.append(t);
    wrap.append(ins);
  }

  const maxWatched = list[0].watched;
  wrap.append(el('h3', 'label', `Топ платформ і мереж (${list.length})`));
  const rowsWrap = el('div', 'actor-rank-list');
  list.forEach((p, idx) => {
    const row = el('div', 'actor-rank-item');
    row.style.cursor = 'default';
    row.append(el('div', 'actor-rank-num', String(idx + 1)));
    if (p.logo) {
      const img = el('img', 'platform-rank-logo'); img.src = TMDB_IMG + 'w92' + p.logo; img.loading = 'lazy';
      row.append(img);
    } else {
      row.append(el('div', 'actor-rank-photo-empty', p.name.charAt(0).toUpperCase()));
    }
    const info = el('div', 'actor-rank-info');
    info.append(el('div', 'actor-rank-name', p.name));
    const avgTxt = p.ratedCnt ? ` · ⭐ ${fmtNum(p.ratedSum / p.ratedCnt)}` : '';
    info.append(el('div', 'actor-rank-meta', `${p.movies} ф. · ${p.tv} с.${avgTxt}`));
    const bar = el('div', 'item-progress');
    const fill = el('div', 'item-progress-fill');
    fill.style.width = Math.round((p.watched / maxWatched) * 100) + '%';
    bar.append(fill);
    info.append(bar);
    row.append(info);
    row.append(el('div', 'actor-rank-value', String(p.watched)));
    rowsWrap.append(row);
  });
  wrap.append(rowsWrap);
  return [wrap];
}

function renderEloTab() {
  const wrap = el('div');
  const withElo = Object.values(lib).filter(x => x.eloGames && x.eloGames > 0).sort((a, b) => (b.elo || ELO_START) - (a.elo || ELO_START));
  if (!withElo.length) {
    wrap.append(el('div', 'avail-empty', 'Пограй у «Цар гори», щоб побудувати Elo-рейтинг своїх тайтлів'));
    return [wrap];
  }
  const card = el('div', 'insight-card');
  card.append(el('div', 'insight-label', '🏆 Elo-рейтинг'));
  const topTitles = withElo.slice(0, 3).map((x, i) => `${i + 1}. ${x.title}`).join(' · ');
  card.append(el('div', 'insight-text', 'Топ: ' + topTitles));
  wrap.append(card);

  wrap.append(el('h3', 'label', `Топ за Elo (${withElo.length})`));
  const lb = el('div', 'elo-lb');
  withElo.slice(0, 30).forEach((x, i) => {
    const row = el('div', 'elo-row');
    row.append(el('div', 'elo-rank', String(i + 1)));
    if (x.poster) {
      const p = el('img', 'elo-poster'); p.src = TMDB_IMG + 'w92' + x.poster; p.loading = 'lazy';
      row.append(p);
    } else row.append(el('div', 'elo-poster'));
    const info = el('div', 'elo-info');
    info.append(el('div', 'elo-title', x.title));
    info.append(el('div', 'elo-games', `${x.eloGames} ${plural(x.eloGames, 'матч', 'матчі', 'матчів')}`));
    row.append(info);
    row.append(el('div', 'elo-value' + (i < 3 ? ' top' : ''), String(Math.round(x.elo))));
    row.addEventListener('click', () => openCard(x));
    lb.append(row);
  });
  wrap.append(lb);
  return [wrap];
}

function renderActorsTab() {
  const wrap = el('div');
  const subTabs = el('div', 'card-tabs');
  const rTab = el('button', 'card-tab' + (state.stats.actorTab === 'rating' ? ' active' : ''), '⭐ За оцінкою');
  const cTab = el('button', 'card-tab' + (state.stats.actorTab === 'count' ? ' active' : ''), '👁️ За переглядами');
  rTab.addEventListener('click', () => { if (state.stats.actorTab === 'rating') return; state.stats.actorTab = 'rating'; renderStatistics(); });
  cTab.addEventListener('click', () => { if (state.stats.actorTab === 'count') return; state.stats.actorTab = 'count'; renderStatistics(); });
  subTabs.append(rTab, cTab);
  wrap.append(subTabs);
  const content = el('div'); content.style.marginTop = '16px';

  const loader = buildMetaLoaderBanner();
  if (loader) wrap.append(loader);

  const { globalCastAvg, actors: actorMap } = computeActorProfiles();
  const actors = [...actorMap.values()];

  let display, valueFn;
  if (state.stats.actorTab === 'rating') {
    display = actors
      .filter(a => a.ratedCount >= 1)
      .sort((x, y) => y.score - x.score || y.effCount - x.effCount || x.name.localeCompare(y.name));
    valueFn = a => ({ text: fmtNum(a.score), cls: ratingClass(a.score) });
  } else {
    display = actors
      .filter(a => a.watchedCount >= 1)
      .sort((x, y) => y.watchedCount - x.watchedCount || y.score - x.score || x.name.localeCompare(y.name));
    valueFn = a => ({ text: String(a.watchedCount), cls: '' });
  }

  if (!display.length) {
    content.append(el('div', 'avail-empty', state.stats.actorTab === 'rating' ? 'Немає проєктів з оцінкою «Персонажі і каст»' : 'Немає переглянутих проєктів з акторами'));
    wrap.append(content);
    return [wrap];
  }

  if (state.stats.actorTab === 'rating' && display.length > 0) {
    const hint = el('div');
    hint.style.cssText = 'padding:10px 14px;background:rgba(var(--accent-rgb),.06);border-left:3px solid var(--accent);border-radius:8px;font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:12px';
    hint.innerHTML = `Критерій <strong style="color:var(--accent)">«Персонажі і каст»</strong> відносно твоєї середньої (<strong style="color:var(--accent)">${fmtNum(globalCastAvg)}</strong>): головні ролі (0–3), бонус за хіти, % штраф нижче (-10% на -0,85; -20% на -1,5), база ${ACTOR_REF_PROJECTS} проєктів і згортання повторів франшиз (вкл. MCU).`;
    content.append(hint);
  }

  const list = el('div', 'actor-rank-list');
  display.slice(0, 50).forEach((a, idx) => {
    const it = el('div', 'actor-rank-item');
    it.append(el('div', 'actor-rank-num', String(idx + 1)));
    if (a.profile_path) {
      const ph = el('img', 'actor-rank-photo'); ph.src = TMDB_IMG + 'w185' + a.profile_path; ph.loading = 'lazy';
      it.append(ph);
    } else {
      it.append(el('div', 'actor-rank-photo-empty', (a.name || '?').charAt(0).toUpperCase()));
    }
    const info = el('div', 'actor-rank-info');
    info.append(el('div', 'actor-rank-name', a.name));
    let meta;
    if (state.stats.actorTab === 'rating') {
      const parts = [`${a.ratedCount} ${plural(a.ratedCount, 'проєкт', 'проєкти', 'проєктів')}`, `каст ${fmtNum(a.rawAvg)}`];
      if (a.leadCount > 0) parts.push(`${a.leadCount} гол.`);
      if (a.hitCount > 0) parts.push(`${a.hitCount} хіт.`);
      if (a.missCount > 0) parts.push(`${a.missCount} низьк.`);
      meta = parts.join(' · ');
    } else {
      meta = `${a.watchedCount} ${plural(a.watchedCount, 'перегляд', 'перегляди', 'переглядів')}`;
    }
    const metaRow = el('div', 'actor-rank-meta-row');
    metaRow.append(el('div', 'actor-rank-meta', meta));
    if (typeof setActorAdj === 'function') {
      const adjBtns = el('div', 'actor-adjust-btns');
      const fireBtn = el('button', 'actor-adjust-btn fire' + (a.adj > 0 ? ' active' : ''), '🔥');
      fireBtn.type = 'button';
      fireBtn.title = 'Підняти у рекомендаціях';
      fireBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setActorAdj(a.id, a.adj > 0 ? 0 : 1);
        try { localStorage.removeItem(RECS_CACHE); } catch {}
        state.home.sig = null;
        renderStatistics();
      });
      const sadBtn = el('button', 'actor-adjust-btn sad' + (a.adj < 0 ? ' active' : ''), '😞');
      sadBtn.type = 'button';
      sadBtn.title = 'Знизити у рекомендаціях';
      sadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setActorAdj(a.id, a.adj < 0 ? 0 : -1);
        try { localStorage.removeItem(RECS_CACHE); } catch {}
        state.home.sig = null;
        renderStatistics();
      });
      adjBtns.append(fireBtn, sadBtn);
      metaRow.append(adjBtns);
    }
    info.append(metaRow);
    it.append(info);
    const v = valueFn(a);
    it.append(el('div', 'actor-rank-value ' + v.cls, v.text));
    it.addEventListener('click', () => openPerson(a.id));
    list.append(it);
  });
  content.append(list);
  wrap.append(content);
  return [wrap];
}

function renderGenresTab() {
  const all = Object.values(lib);
  const genreCount = {};
  all.forEach(x => (x.genres || []).forEach(gid => {
    const g = GENRES.find(g => g.id === gid); if (g) genreCount[g.name] = (genreCount[g.name] || 0) + 1;
  }));
  const topGenres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]);
  if (!topGenres.length) return [el('div', 'avail-empty', 'Немає даних про жанри')];
  const wrap = el('div');
  const maxCount = topGenres[0][1];
  const list = el('div', 'stats-list');
  topGenres.forEach(([name, count]) => {
    const row = el('div', 'stats-list-row');
    const left = el('div'); left.style.flex = '1';
    left.append(el('span', '', name));
    const bar = el('div'); bar.style.cssText = `height:5px;background:linear-gradient(90deg,var(--accent),var(--coral));border-radius:3px;margin-top:5px;width:${(count / maxCount) * 100}%`;
    left.append(bar);
    row.append(left, el('span', '', String(count)));
    list.append(row);
  });
  wrap.append(list);
  return [wrap];
}

function buildActivityHeatmap() {
  const counts = {};
  Object.values(lib).forEach(item => {
    const ts = item.statusDate || item.updated || item.createdAt;
    if (!ts) return;
    const d = new Date(ts);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    counts[k] = (counts[k] || 0) + 1;
  });

  const sec = el('div', 'pie-section');
  sec.append(el('div', 'pie-title', '🗓️ Ритм активності · останні 26 тижнів'));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = (today.getDay() + 6) % 7; // 0=Пн .. 6=Нд
  const start = new Date(today);
  start.setDate(today.getDate() - (25 * 7 + dayOfWeek));

  const grid = el('div', 'heatmap-grid');
  let activeDays = 0;
  for (let w = 0; w < 26; w++) {
    const col = el('div', 'heatmap-col');
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w * 7 + d);
      const cell = el('div', 'heatmap-cell');
      if (cur > today) {
        cell.classList.add('future');
      } else {
        const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
        const n = counts[k] || 0;
        if (n > 0) activeDays++;
        const lvl = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
        cell.classList.add('lvl-' + lvl);
        cell.title = `${cur.toLocaleDateString('uk-UA')}: ${n} ${plural(n, 'дія', 'дії', 'дій')}`;
      }
      col.append(cell);
    }
    grid.append(col);
  }
  const scrollWrap = el('div', 'heatmap-scroll');
  scrollWrap.append(grid);
  sec.append(scrollWrap);
  sec.append(el('div', 'notes-hint', `Активних днів за півроку: ${activeDays}`));
  return sec;
}

function renderDetailTab() {
  const all = Object.values(lib);
  if (!all.length) return [el('div', 'avail-empty', 'Бібліотека порожня')];
  const wrap = el('div');

  const loader = buildMetaLoaderBanner();
  if (loader) wrap.append(loader);

  // Час у кіно
  const wt = computeWatchTimeStats();
  const timeGrid = el('div', 'stats-grid');
  const addT = (l, v) => { const s = el('div', 'stat-card'); s.append(el('div', 'stat-value', v), el('div', 'stat-label', l)); timeGrid.append(s); };
  addT('Усього в кіно', fmtDuration(wt.totalMin));
  addT(`Фільми (${wt.movieKnown}/${wt.movieTotal})`, fmtDuration(wt.movieMin));
  addT(`Серіали (${wt.tvKnown}/${wt.tvTotal})`, fmtDuration(wt.tvMin));
  addT('Серій переглянуто', String(wt.tvEpsWatched));
  wrap.append(timeGrid);

  wrap.append(buildActivityHeatmap());

  const movies = all.filter(x => x.type === 'movie').length;
  const tvShows = all.filter(x => x.type === 'tv').length;
  const typeData = [
    { label: 'Фільми', value: movies, color: 'var(--accent)' },
    { label: 'Серіали', value: tvShows, color: 'var(--violet)' }
  ].filter(d => d.value > 0);
  wrap.append(renderPieSection('🎬 Тип контенту', typeData));

  const statuses = ['watched', 'watching', 'planned', 'dropped'];
  const labels = { watched: 'Переглянуто', watching: 'Дивлюсь', planned: 'Планую', dropped: 'Закинуто' };
  const colors = { watched: 'var(--mint)', watching: 'var(--accent)', planned: 'var(--violet)', dropped: 'var(--text-muted)' };
  const statusData = statuses.map(s => ({ label: labels[s], value: all.filter(x => x.status === s).length, color: colors[s] })).filter(d => d.value > 0);
  wrap.append(renderPieSection('📌 Статуси', statusData));

  const ratedMovies = all.filter(x => x.type === 'movie' && computeItemRating(x).avg > 0);
  const ratedTV = all.filter(x => x.type === 'tv' && computeItemRating(x).avg > 0);
  const avgMovie = ratedMovies.length ? ratedMovies.reduce((s, x) => s + computeItemRating(x).avg, 0) / ratedMovies.length : 0;
  const avgTV = ratedTV.length ? ratedTV.reduce((s, x) => s + computeItemRating(x).avg, 0) / ratedTV.length : 0;

  const sg = el('div', 'stats-grid');
  const addStat = (l, v) => { const s = el('div', 'stat-card'); s.append(el('div', 'stat-value', String(v))); s.append(el('div', 'stat-label', l)); sg.append(s); };
  addStat('Всього', all.length);
  addStat('Оцінено', ratedMovies.length + ratedTV.length);
  addStat('Сер. фільми', avgMovie > 0 ? fmtNum(avgMovie) : '—');
  addStat('Сер. серіали', avgTV > 0 ? fmtNum(avgTV) : '—');
  wrap.append(sg);

  const dist = {};
  for (let i = 1; i <= 10; i++) dist[i] = 0;
  [...ratedMovies, ...ratedTV].forEach(x => {
    const val = Math.round(computeItemRating(x).avg);
    if (val >= 1 && val <= 10) dist[val]++;
  });
  const maxDist = Math.max(...Object.values(dist), 1);
  const hist = el('div', 'histogram');
  for (let i = 10; i >= 1; i--) {
    if (dist[i] === 0) continue;
    const row = el('div', 'histogram-row');
    row.append(el('div', 'histogram-label', i + '/10'));
    const barBg = el('div', 'histogram-bar-bg');
    const bar = el('div', 'histogram-bar');
    bar.style.width = ((dist[i] / maxDist) * 100) + '%';
    bar.textContent = dist[i];
    barBg.append(bar);
    row.append(barBg);
    hist.append(row);
  }
  if (hist.children.length) {
    wrap.append(el('h3', 'label', '📈 Розподіл оцінок'));
    wrap.append(hist);
  }
  return [wrap];
}

function renderPieSection(title, data) {
  const section = el('div', 'pie-section');
  section.append(el('div', 'pie-title', title));
  const content = el('div', 'pie-content');
  content.append(renderPieChart(data));
  const legend = el('div', 'pie-legend');
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) { section.append(el('div', 'avail-empty', 'Немає даних')); return section; }
  data.forEach(d => {
    const row = el('div', 'pie-legend-row');
    const dot = el('div', 'pie-legend-dot'); dot.style.background = d.color;
    row.append(dot, el('span', 'pie-legend-label', d.label));
    row.append(el('span', 'pie-legend-value', `${d.value} · ${Math.round(d.value / total * 100)}%`));
    legend.append(row);
  });
  content.append(legend);
  section.append(content);
  return section;
}

function renderPieChart(data, size = 160) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return el('div');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'pie-svg');
  let angle = -Math.PI / 2;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  data.forEach(d => {
    if (d.value === 0) return;
    const sweep = (d.value / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sweep);
    const y2 = cy + r * Math.sin(angle + sweep);
    const largeArc = sweep > Math.PI ? 1 : 0;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`);
    path.setAttribute('fill', d.color);
    path.setAttribute('stroke', 'var(--bg-0)');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
    angle += sweep;
  });
  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('cx', cx); circle.setAttribute('cy', cy);
  circle.setAttribute('r', r * 0.55);
  circle.setAttribute('fill', 'var(--bg-1)');
  svg.appendChild(circle);
  const text = document.createElementNS(svgNS, 'text');
  text.setAttribute('x', cx); text.setAttribute('y', cy + 6);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', 'var(--text)');
  text.setAttribute('font-size', '18');
  text.setAttribute('font-weight', '800');
  text.setAttribute('font-family', 'var(--mono)');
  text.textContent = String(total);
  svg.appendChild(text);
  return svg;
}
