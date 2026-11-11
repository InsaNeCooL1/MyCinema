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
  else if (state.stats.tab === 'elo') content.append(...renderEloTab());
  else if (state.stats.tab === 'actors') content.append(...renderActorsTab());
  else if (state.stats.tab === 'genres') content.append(...renderGenresTab());
  else if (state.stats.tab === 'detail') content.append(...renderDetailTab());
  
  wrap.append(content);
  box.append(wrap);
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

  const rated = Object.values(lib).map(x => ({ item: x, r: computeItemRating(x) })).filter(x => x.r.avg > 0 && x.item.ratings);
  if (rated.length >= 5) {
    const plotHigh = rated.filter(x => (x.item.ratings?.plot || 0) >= 8);
    const castHigh = rated.filter(x => (x.item.ratings?.cast || 0) >= 8);
    if (plotHigh.length >= 3 && castHigh.length >= 3) {
      const overlap = plotHigh.filter(x => (x.item.ratings?.cast || 0) >= 8).length;
      if (overlap / plotHigh.length > 0.6) {
        insights.push({ icon: '🎯', text: `Коли тобі подобається сюжет (<strong>8+</strong>), ти майже завжди високо оцінюєш і каст. У <strong>${Math.round(overlap / plotHigh.length * 100)}%</strong> випадків.` });
      }
    }
  }

  const allRated = rated.map(x => x.r.avg);
  if (allRated.length >= 5) {
    const avg = allRated.reduce((a, b) => a + b, 0) / allRated.length;
    const strict = avg < 6.5, generous = avg > 7.5;
    insights.push({ icon: generous ? '🌟' : (strict ? '🔍' : '⚖️'), text: `Твоя середня оцінка — <strong>${fmtNum(avg)}/10</strong>. ${generous ? 'Ти щедрий на оцінки — ставиш високі бали частіше, ніж інші.' : strict ? 'Ти вимогливий — не роздаєш високі оцінки просто так.' : 'Ти ставишся до оцінювання виважено.'}` });
  }

  if (rated.length > 0) {
    const top = rated.sort((a, b) => b.r.avg - a.r.avg)[0];
    insights.push({ icon: '👑', text: `Твій найвищий бал — <strong>${fmtNum(top.r.avg)}/10</strong> — у «${top.item.title}».` });
  }

  const movieRated = rated.filter(x => x.item.type === 'movie');
  const tvRated = rated.filter(x => x.item.type === 'tv');
  if (movieRated.length >= 3 && tvRated.length >= 3) {
    const mAvg = movieRated.reduce((a, b) => a + b.r.avg, 0) / movieRated.length;
    const tAvg = tvRated.reduce((a, b) => a + b.r.avg, 0) / tvRated.length;
    const diff = tAvg - mAvg;
    if (Math.abs(diff) > 0.5) {
      insights.push({ icon: diff > 0 ? '📺' : '🎬', text: `Ти оцінюєш ${diff > 0 ? 'серіали' : 'фільми'} у середньому на <strong>${fmtNum(Math.abs(diff))}</strong> вище, ніж ${diff > 0 ? 'фільми' : 'серіали'}.` });
    }
  }

  if (insights.length) {
    for (const ins of insights) {
      const c = el('div', 'insight-card');
      c.append(el('div', 'insight-label', ins.icon + ' інсайт'));
      const t = el('div', 'insight-text');
      t.innerHTML = ins.text;
      c.append(t);
      wrap.append(c);
    }
  }

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
  const items = Object.values(lib);
  const missing = items.filter(x => !x.cast || !x.cast.length);
  
  if (missing.length > 0) {
    const loader = el('div', 'cast-loader');
    if (state.stats.castLoading) {
      loader.append(el('div', 'cast-loader-text', `Завантажую акторів: ${state.stats.castProgress.done}/${state.stats.castProgress.total}...`));
    } else {
      loader.append(el('div', 'cast-loader-text', `Даних про акторів немає для ${missing.length} з ${items.length} тайтлів`));
      const btn = el('button', 'cast-loader-btn', '📥 Завантажити дані акторів');
      btn.addEventListener('click', async () => {
        state.stats.castLoading = true;
        state.stats.castProgress = { done: 0, total: missing.length };
        renderStatistics();
        await fetchAllMissingCasts();
        state.stats.castLoading = false;
        renderStatistics();
      });
      loader.append(btn);
    }
    wrap.append(loader);
  }
  
  const actorMap = new Map();
  items.forEach(item => {
    (item.cast || []).forEach(a => {
      if (!actorMap.has(a.id)) actorMap.set(a.id, { id: a.id, name: a.name, profile_path: a.profile_path, projects: [] });
      actorMap.get(a.id).projects.push(item);
    });
  });

  const allRatedAvgs = Object.values(lib).map(x => computeItemRating(x).avg).filter(v => v > 0);
  const globalAvg = allRatedAvgs.length ? allRatedAvgs.reduce((a, b) => a + b, 0) / allRatedAvgs.length : 7;

  const actors = [...actorMap.values()].map(a => {
    const watched = a.projects.filter(hasWatched);
    const rated = watched.filter(p => computeItemRating(p).avg > 0);
    const avgRating = rated.length ? rated.reduce((s, p) => s + computeItemRating(p).avg, 0) / rated.length : 0;
    const v = rated.length;
    const weightedRating = v > 0 ? (v * avgRating + ACTOR_MIN_VOTES * globalAvg) / (v + ACTOR_MIN_VOTES) : 0;
    return { ...a, watchedCount: watched.length, ratedCount: v, avgRating, weightedRating };
  });

  let display, valueFn;
  if (state.stats.actorTab === 'rating') {
    display = actors.filter(a => a.ratedCount >= 1).sort((x, y) => y.weightedRating - x.weightedRating || y.ratedCount - x.ratedCount || x.name.localeCompare(y.name));
    valueFn = a => ({ text: fmtNum(a.weightedRating), cls: ratingClass(a.weightedRating) });
  } else {
    display = actors.filter(a => a.watchedCount >= 1).sort((x, y) => y.watchedCount - x.watchedCount || y.weightedRating - x.weightedRating || x.name.localeCompare(y.name));
    valueFn = a => ({ text: String(a.watchedCount), cls: '' });
  }

  if (!display.length) {
    content.append(el('div', 'avail-empty', state.stats.actorTab === 'rating' ? 'Немає оцінених проєктів з акторами' : 'Немає переглянутих проєктів з акторами'));
    wrap.append(content);
    return [wrap];
  }

  if (state.stats.actorTab === 'rating' && display.length > 0) {
    const hint = el('div');
    hint.style.cssText = 'padding:10px 14px;background:rgba(255,184,108,.06);border-left:3px solid var(--accent);border-radius:8px;font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:12px';
    hint.innerHTML = `Оцінка зважена за кількістю проєктів (мін. вага: <strong style="color:var(--accent)">${ACTOR_MIN_VOTES}</strong>). Актори з малою кількістю оцінок тягнуться до середнього (<strong style="color:var(--accent)">${fmtNum(globalAvg)}</strong>), тому не "висять" у топі випадково.`;
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
      meta = `${a.ratedCount} ${plural(a.ratedCount, 'проєкт', 'проєкти', 'проєктів')} · сира ${fmtNum(a.avgRating)}`;
    } else {
      meta = `${a.watchedCount} ${plural(a.watchedCount, 'перегляд', 'перегляди', 'переглядів')}`;
    }
    info.append(el('div', 'actor-rank-meta', meta));
    it.append(info);
    const v = valueFn(a);
    it.append(el('div', 'actor-rank-value ' + v.cls, v.text));
    it.addEventListener('click', () => openPerson(a.id, { name: a.name }));
    list.append(it);
  });
  content.append(list);
  wrap.append(content);
  return [wrap];
}

async function fetchAllMissingCasts() {
  const missing = Object.values(lib).filter(x => !x.cast || !x.cast.length);
  const batchSize = 5;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    await Promise.all(batch.map(async item => {
      try {
        const d = await tmdbFetch(`/${item.type}/${item.id}/credits?language=uk-UA`);
        if (lib[item.key] && d.cast) lib[item.key].cast = d.cast.slice(0, CAST_LIMIT).map(a => ({ id: a.id, name: a.name, profile_path: a.profile_path }));
      } catch {}
    }));
    state.stats.castProgress.done = Math.min(missing.length, i + batchSize);
    if (state.stats.tab === 'actors') renderStatistics();
    await new Promise(r => setTimeout(r, 200));
  }
  save();
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

function renderDetailTab() {
  const all = Object.values(lib);
  if (!all.length) return [el('div', 'avail-empty', 'Бібліотека порожня')];
  const wrap = el('div');

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
