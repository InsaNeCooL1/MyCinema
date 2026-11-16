'use strict';

const RELEASE_CACHE_KEY = 'mycinema.releaseCache.v1';
const RELEASE_CACHE_TTL = 6 * 60 * 60 * 1000;
let _releaseFetchRunning = false;

function readReleaseCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(RELEASE_CACHE_KEY) || '{}');
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch { return {}; }
}

function writeReleaseCache(cache) {
  try { localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

function collectCachedReleaseEvents(cache) {
  const events = [];
  const candidates = Object.values(lib).filter(x => x.status === 'watching' || x.status === 'planned');

  candidates.forEach(item => {
    const c = cache[item.key];
    if (c && Array.isArray(c.events) && c.events.length) {
      c.events.forEach(ev => {
        if (ev && ev.date) events.push({ ...ev, item });
      });
      return;
    }
    // Фолбек з уже відомих полів бібліотеки до довантаження
    if (item.releaseDate) {
      events.push({ date: item.releaseDate.slice(0, 10), kind: 'premiere', label: '🎬 Премʼєра', item });
    }
    if (item.digitalReleaseDate && item.digitalReleaseDate !== item.releaseDate) {
      events.push({ date: item.digitalReleaseDate.slice(0, 10), kind: 'digital', label: '💾 Вихід у цифрі', item });
    }
  });
  return events;
}

async function refreshReleaseScheduleCache() {
  if (_releaseFetchRunning) return;
  _releaseFetchRunning = true;
  const cache = readReleaseCache();
  const now = Date.now();
  const candidates = Object.values(lib).filter(x => x.id && (x.status === 'watching' || x.status === 'planned'));
  const todo = candidates.filter(x => !cache[x.key] || (now - (cache[x.key].ts || 0)) > RELEASE_CACHE_TTL);

  if (!todo.length) {
    _releaseFetchRunning = false;
    return;
  }

  let updatedAny = false;
  try {
    for (let i = 0; i < todo.length; i += 4) {
      const batch = todo.slice(i, i + 4);
      await Promise.all(batch.map(async item => {
        try {
          const evs = [];
          if (item.type === 'tv') {
            const d = await tmdbFetch(`/tv/${item.id}?language=uk-UA`);
            const nextEp = d.next_episode_to_air;
            const lastEp = d.last_episode_to_air;
            const seasonNums = new Set();
            if (nextEp && nextEp.season_number > 0) seasonNums.add(nextEp.season_number);
            if (!seasonNums.size && lastEp && lastEp.season_number > 0 && d.status !== 'Ended') {
              seasonNums.add(lastEp.season_number);
            }
            if (!seasonNums.size && d.first_air_date) {
              evs.push({ date: d.first_air_date.slice(0, 10), kind: 'premiere', label: '📺 Премʼєра серіалу' });
            }
            for (const sNum of seasonNums) {
              try {
                const sd = await tmdbFetch(`/tv/${item.id}/season/${sNum}?language=uk-UA`);
                (sd.episodes || []).forEach(ep => {
                  if (!ep.air_date) return;
                  const code = `S${sNum}E${String(ep.episode_number).padStart(2, '0')}`;
                  evs.push({
                    date: ep.air_date.slice(0, 10),
                    kind: 'ep',
                    label: `📺 ${code}${ep.name ? ' · ' + ep.name : ''}`
                  });
                });
              } catch {}
            }
            if (!evs.length && nextEp && nextEp.air_date) {
              const code = `S${nextEp.season_number}E${String(nextEp.episode_number).padStart(2, '0')}`;
              evs.push({
                date: nextEp.air_date.slice(0, 10),
                kind: 'ep',
                label: `📺 ${code}${nextEp.name ? ' · ' + nextEp.name : ''}`
              });
            }
          } else {
            const d = await tmdbFetch(`/movie/${item.id}?language=uk-UA&append_to_response=release_dates`);
            if (d.release_date) {
              evs.push({ date: d.release_date.slice(0, 10), kind: 'premiere', label: '🎬 Премʼєра' });
            }
            const dig = typeof extractDigitalDate === 'function' ? extractDigitalDate(d) : null;
            if (dig && dig !== d.release_date) {
              evs.push({ date: dig, kind: 'digital', label: '💾 Вихід у цифрі' });
            }
          }
          cache[item.key] = { ts: Date.now(), events: evs };
          updatedAny = true;
        } catch {}
      }));
    }
    if (updatedAny) writeReleaseCache(cache);
  } finally {
    _releaseFetchRunning = false;
    if (updatedAny && state.tab === 'calendar' && state.calendarStatus === 'releases') {
      renderCalendar();
    }
  }
}

function renderCalendar() {
  box.style.padding = '0';
  box.replaceChildren();

  const wrap = el('div', 'home-wrap');
  const head = el('div', 'section-head');
  head.style.marginTop = '20px';
  head.append(el('h1', 'section-title', '📅 Календар'));
  wrap.append(head);

  const monthNames = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];

  // Режим «Графік релізів»
  if (state.calendarStatus === 'releases') {
    const cache = readReleaseCache();
    const candidates = Object.values(lib).filter(x => x.id && (x.status === 'watching' || x.status === 'planned'));
    const now = Date.now();
    const needFetch = candidates.some(x => !cache[x.key] || (now - (cache[x.key].ts || 0)) > RELEASE_CACHE_TTL);
    if (needFetch && !_releaseFetchRunning) {
      setTimeout(refreshReleaseScheduleCache, 20);
    }

    const events = collectCachedReleaseEvents(cache);
    const monthsSet = new Set();
    events.forEach(ev => {
      const p = String(ev.date || '').split('-');
      if (p.length >= 2) monthsSet.add(`${parseInt(p[0], 10)}-${parseInt(p[1], 10) - 1}`);
    });
    const months = Array.from(monthsSet).sort((a, b) => {
      const [ya, ma] = a.split('-').map(Number);
      const [yb, mb] = b.split('-').map(Number);
      return ya - yb || ma - mb;
    });

    const curD = new Date();
    const curKey = `${curD.getFullYear()}-${curD.getMonth()}`;
    if (!state.calendarMonth || !monthsSet.has(state.calendarMonth)) {
      const upcoming = months.find(m => {
        const [y, mo] = m.split('-').map(Number);
        return y > curD.getFullYear() || (y === curD.getFullYear() && mo >= curD.getMonth());
      });
      state.calendarMonth = monthsSet.has(curKey) ? curKey : (upcoming || months[months.length - 1] || null);
    }

    const calHeader = el('div', 'calendar-header');
    calHeader.style.display = 'flex';
    calHeader.style.gap = '10px';
    calHeader.style.flexWrap = 'wrap';

    const sSelect = document.createElement('select');
    sSelect.className = 'calendar-select';
    sSelect.style.flex = '1';
    sSelect.style.minWidth = '150px';
    [
      { val: 'all', label: 'Всі статуси' },
      { val: 'watching', label: '▶️ Дивлюсь' },
      { val: 'watched', label: '✅ Переглянуто' },
      { val: 'releases', label: '🗓️ Графік релізів' }
    ].forEach(optData => {
      const opt = document.createElement('option');
      opt.value = optData.val;
      opt.textContent = optData.label;
      if (state.calendarStatus === optData.val) opt.selected = true;
      sSelect.append(opt);
    });
    sSelect.addEventListener('change', (e) => {
      state.calendarStatus = e.target.value;
      state.calendarMonth = null;
      renderCalendar();
    });
    calHeader.append(sSelect);

    if (months.length > 0) {
      const mSelect = document.createElement('select');
      mSelect.className = 'calendar-select';
      mSelect.style.flex = '1';
      mSelect.style.minWidth = '150px';
      months.forEach(m => {
        const [y, monthIdx] = m.split('-').map(Number);
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${monthNames[monthIdx]} ${y}`;
        if (m === state.calendarMonth) opt.selected = true;
        mSelect.append(opt);
      });
      mSelect.addEventListener('change', (e) => {
        state.calendarMonth = e.target.value;
        renderCalendar();
      });
      calHeader.append(mSelect);
    }
    wrap.append(calHeader);

    if (_releaseFetchRunning) {
      wrap.append(el('div', 'notes-hint', '🔄 Оновлюємо дати виходу серій та премʼєр з TMDB...'));
    }

    if (!events.length) {
      wrap.append(el('div', 'avail-empty', candidates.length ? 'Немає відомих дат релізів для твоїх серіалів «Дивлюсь» і тайтлів «Планую».' : 'Додай серіали в «Дивлюсь» або фільми в «Планую», щоб бачити графік релізів.'));
      box.append(wrap);
      return;
    }

    const filteredEvents = events.filter(ev => {
      const p = String(ev.date || '').split('-');
      if (p.length < 2) return false;
      return `${parseInt(p[0], 10)}-${parseInt(p[1], 10) - 1}` === state.calendarMonth;
    });

    const todayIso = new Date().toISOString().slice(0, 10);
    const groups = {};
    filteredEvents.forEach(ev => {
      if (!groups[ev.date]) groups[ev.date] = [];
      groups[ev.date].push(ev);
    });

    const sortedDays = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    const timeline = el('div', 'timeline');

    sortedDays.forEach(dk => {
      const dayGroup = el('div', 'timeline-day-group');
      const d = new Date(dk + 'T12:00:00');
      let lbl = isNaN(d) ? dk : d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short' });
      if (dk === todayIso) lbl = 'Сьогодні · ' + lbl;
      dayGroup.append(el('div', 'timeline-date', lbl));

      const dayItems = el('div', 'timeline-items');
      groups[dk].forEach(ev => {
        const listItem = createListItem(ev.item);
        const info = listItem.querySelector('.info');
        if (info) {
          const tagCls = ev.kind === 'digital' ? 'digital' : (ev.kind === 'premiere' ? 'premiere' : 'ep');
          info.insertBefore(el('span', 'release-tag ' + tagCls, ev.label), info.firstChild);
        }
        dayItems.append(listItem);
      });
      dayGroup.append(dayItems);
      timeline.append(dayGroup);
    });

    wrap.append(timeline);
    box.append(wrap);
    return;
  }

  const itemTs = (x) => {
    if (x.statusDate) return x.statusDate;
    if (x.eloUpdated && x.updated === x.eloUpdated) return x.createdAt || 0;
    if (x.eloGames > 0 && x.createdAt) return x.createdAt;
    return x.updated || x.createdAt || 0;
  };
  let allItems = Object.values(lib).filter(x => (x.status === 'watching' || x.status === 'watched') && itemTs(x) > 0);

  // Навіть якщо переглядів ще нема — даємо можливість переключитись на Графік релізів
  let items = allItems;
  if (state.calendarStatus === 'watching') items = items.filter(x => x.status === 'watching');
  else if (state.calendarStatus === 'watched') items = items.filter(x => x.status === 'watched');

  const monthsSet = new Set();
  items.forEach(item => {
    const date = new Date(itemTs(item));
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    monthsSet.add(monthKey);
  });

  const months = Array.from(monthsSet).sort((a, b) => {
    const [ya, ma] = a.split('-').map(Number);
    const [yb, mb] = b.split('-').map(Number);
    return yb - ya || mb - ma;
  });

  if (!state.calendarMonth || !monthsSet.has(state.calendarMonth)) {
    state.calendarMonth = months[0] || null;
  }

  const calHeader = el('div', 'calendar-header');
  calHeader.style.display = 'flex';
  calHeader.style.gap = '10px';
  calHeader.style.flexWrap = 'wrap';

  const sSelect = document.createElement('select');
  sSelect.className = 'calendar-select';
  sSelect.style.flex = '1';
  sSelect.style.minWidth = '150px';
  [
    { val: 'all', label: 'Всі статуси' },
    { val: 'watching', label: '▶️ Дивлюсь' },
    { val: 'watched', label: '✅ Переглянуто' },
    { val: 'releases', label: '🗓️ Графік релізів' }
  ].forEach(optData => {
    const opt = document.createElement('option');
    opt.value = optData.val;
    opt.textContent = optData.label;
    if (state.calendarStatus === optData.val) opt.selected = true;
    sSelect.append(opt);
  });
  sSelect.addEventListener('change', (e) => {
    state.calendarStatus = e.target.value;
    state.calendarMonth = null;
    renderCalendar();
  });
  calHeader.append(sSelect);

  if (months.length > 0) {
    const mSelect = document.createElement('select');
    mSelect.className = 'calendar-select';
    mSelect.style.flex = '1';
    mSelect.style.minWidth = '150px';
    months.forEach(m => {
      const [y, monthIdx] = m.split('-').map(Number);
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = `${monthNames[monthIdx]} ${y}`;
      if (m === state.calendarMonth) opt.selected = true;
      mSelect.append(opt);
    });
    mSelect.addEventListener('change', (e) => {
      state.calendarMonth = e.target.value;
      renderCalendar();
    });
    calHeader.append(mSelect);
  }

  wrap.append(calHeader);

  if (!items.length) {
    wrap.append(el('div', 'avail-empty', 'Тут поки порожньо. Додай фільми зі статусом "Дивлюсь" / "Переглянуто" або обери "Графік релізів".'));
    box.append(wrap);
    return;
  }

  const filteredItems = items.filter(item => {
    const date = new Date(itemTs(item));
    return `${date.getFullYear()}-${date.getMonth()}` === state.calendarMonth;
  });

  const [cy, cm] = (state.calendarMonth || '').split('-').map(Number);
  let monthMins = 0;
  const monthRated = [];
  filteredItems.forEach(item => {
    if (item.type === 'movie' && item.runtime > 0) monthMins += item.runtime;
    else if (item.type === 'tv' && item.runtime > 0) {
      let eps = (item.watchedEpisodes && item.watchedEpisodes.length) || 0;
      if (item.status === 'watched' && (item.episode_count || 0) > eps) eps = item.episode_count;
      monthMins += eps * item.runtime;
    }
    const r = computeItemRating(item).avg;
    if (r > 0) monthRated.push({ item, avg: r });
  });
  const monthAvg = monthRated.length ? (monthRated.reduce((s, x) => s + x.avg, 0) / monthRated.length) : 0;
  const bestOfMonth = monthRated.length ? [...monthRated].sort((a, b) => b.avg - a.avg)[0] : null;

  const sumCard = el('div', 'insight-card cal-summary');
  sumCard.append(el('div', 'insight-label', `📊 Підсумок · ${monthNames[cm] || ''} ${cy || ''}`));
  const parts = [`<strong>${filteredItems.length}</strong> ${plural(filteredItems.length, 'тайтл', 'тайтли', 'тайтлів')}`];
  if (monthMins > 0) {
    const hrs = monthMins / 60;
    parts.push(`<strong>~${hrs >= 10 ? Math.round(hrs) : fmtNum(hrs)} год</strong>`);
  }
  if (monthAvg > 0) parts.push(`сер. оцінка <strong>${fmtNum(monthAvg)}</strong>`);
  const line = el('div', 'insight-text');
  line.innerHTML = parts.join(' · ');
  sumCard.append(line);
  if (bestOfMonth) {
    const bestBtn = el('button', 'cal-best-btn', `👑 Найкраще за місяць: ${bestOfMonth.item.title} (${fmtNum(bestOfMonth.avg)})`);
    bestBtn.type = 'button';
    bestBtn.addEventListener('click', () => openCard(bestOfMonth.item));
    sumCard.append(bestBtn);
  }
  wrap.append(sumCard);

  const toDayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const groups = {};
  filteredItems.forEach(item => {
    const date = new Date(itemTs(item));
    const dk = toDayKey(date);
    if (!groups[dk]) groups[dk] = { label: date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }), items: [] };
    groups[dk].items.push(item);
  });

  const sortedDays = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const timeline = el('div', 'timeline');

  sortedDays.forEach(dk => {
    const grp = groups[dk];
    const dayGroup = el('div', 'timeline-day-group');
    dayGroup.append(el('div', 'timeline-date', grp.label));

    const dayItems = el('div', 'timeline-items');
    grp.items.sort((a, b) => itemTs(b) - itemTs(a)).forEach(item => {
      const listItem = createListItem(item);
      const statusBadge = item.status === 'watching' ? '▶️ Дивлюсь' : '✅ Переглянуто';
      const info = listItem.querySelector('.info');
      if (info) {
        const badge = el('span', 'badge', statusBadge);
        badge.style.background = item.status === 'watching' ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(157, 229, 195, 0.15)';
        badge.style.color = item.status === 'watching' ? 'var(--accent)' : 'var(--mint)';
        info.insertBefore(badge, info.firstChild);
      }
      dayItems.append(listItem);
    });

    dayGroup.append(dayItems);
    timeline.append(dayGroup);
  });

  wrap.append(timeline);
  box.append(wrap);
}

// ============ ACTIVITY LOG (ЖУРНАЛ ДІЙ) ============
function formatActivityTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
    return 'Вчора';
  }
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function renderActivityLog() {
  box.style.padding = '0';
  box.replaceChildren();

  const wrap = el('div', 'home-wrap');
  const head = el('div', 'section-head');
  head.style.marginTop = '20px';
  head.style.alignItems = 'center';
  head.append(el('h1', 'section-title', '📜 Журнал дій'));

  const clearBtn = el('button', 'activity-clear-btn', 'Очистити');
  clearBtn.type = 'button';
  clearBtn.addEventListener('click', () => {
    if (!readActivityLog().length) return;
    if (confirm('Очистити всю історію журналу дій?')) {
      clearActivityLog();
      renderActivityLog();
    }
  });
  head.append(clearBtn);
  wrap.append(head);

  const controls = el('div', 'activity-controls');

  const fSel = document.createElement('select');
  fSel.className = 'calendar-select';
  [
    ['all', 'Усі дії'],
    ['status', '📌 Усі зміни статусів'],
    ['status:watching', '▶️ Дивлюсь'],
    ['status:watched', '✅ Переглянуто'],
    ['status:planned', '📅 Планую'],
    ['status:dropped', '🕸️ Закинуто'],
    ['rating', '⭐ Оцінки'],
    ['episode', '📺 Серії'],
    ['dismiss', '🙈 Сховані з рекомендацій'],
    ['favorite', '❤️ Улюблене'],
    ['note', '📝 Нотатки'],
    ['elo', '👑 Цар гори'],
    ['remove', '🗑️ Видалення']
  ].forEach(([val, lbl]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = lbl;
    if (state.activityFilter === val) opt.selected = true;
    fSel.append(opt);
  });
  fSel.addEventListener('change', (e) => {
    state.activityFilter = e.target.value;
    renderActivityLog();
  });

  const sortSel = document.createElement('select');
  sortSel.className = 'calendar-select';
  [
    ['newest', 'Спочатку нові'],
    ['oldest', 'Спочатку старі'],
    ['type', 'Ранжування по статусу']
  ].forEach(([val, lbl]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = lbl;
    if (state.activitySort === val) opt.selected = true;
    sortSel.append(opt);
  });
  sortSel.addEventListener('change', (e) => {
    state.activitySort = e.target.value;
    renderActivityLog();
  });

  controls.append(fSel, sortSel);
  wrap.append(controls);

  let entries = readActivityLog();
  const f = state.activityFilter || 'all';
  if (f !== 'all') {
    if (f.indexOf(':') !== -1) {
      const [c, sub] = f.split(':');
      entries = entries.filter(x => x.cat === c && x.sub === sub);
    } else {
      entries = entries.filter(x => x.cat === f);
    }
  }

  if (state.activitySort === 'oldest') {
    entries = entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  } else if (state.activitySort === 'type') {
    const rankOrder = {
      'status:watching': 1, 'status:planned': 2, 'status:watched': 3, 'status:dropped': 4, 'status:none': 5,
      'rating': 6, 'episode': 7, 'favorite': 8, 'note': 9, 'elo': 10, 'dismiss': 11, 'remove': 12, 'import': 13
    };
    const getRank = (x) => rankOrder[x.cat + ':' + x.sub] || rankOrder[x.cat] || 99;
    entries = entries.slice().sort((a, b) => getRank(a) - getRank(b) || (b.ts || 0) - (a.ts || 0));
  }

  if (!entries.length) {
    wrap.append(el('div', 'avail-empty', 'Поки немає зафіксованих дій за цим фільтром.'));
    box.append(wrap);
    return;
  }

  const list = el('div', 'activity-list');
  entries.slice(0, 200).forEach(act => {
    const canOpen = !!(act.key && (act.type === 'movie' || act.type === 'tv'));
    const row = el('div', 'activity-row' + (canOpen ? ' clickable' : ''));

    if (act.poster) {
      const img = el('img', 'activity-thumb');
      img.src = TMDB_IMG + 'w92' + act.poster;
      img.loading = 'lazy';
      img.alt = '';
      row.append(img);
    } else {
      row.append(el('div', 'activity-thumb-icon', act.icon || '•'));
    }

    const main = el('div', 'activity-main');
    main.append(el('div', 'activity-title', act.title || 'MyCinema'));
    main.append(el('div', 'activity-desc cat-' + (act.cat || ''), `${act.icon || ''} ${act.text || ''}`.trim()));
    row.append(main);

    const tm = el('div', 'activity-time', formatActivityTime(act.ts));
    tm.title = new Date(act.ts).toLocaleString('uk-UA');
    row.append(tm);

    if (canOpen) {
      row.addEventListener('click', () => {
        const saved = lib[act.key];
        if (saved) { openCard(saved); return; }
        const parts = String(act.key).split('-');
        const id = parseInt(parts[1], 10);
        if (id) {
          openCard({
            key: act.key, id, type: act.type,
            title: act.title || '', year: '', poster: act.poster || null,
            backdrop: null, overview: '', tmdbRating: 0, votes: 0, popularity: 0
          });
        }
      });
    }
    list.append(row);
  });

  wrap.append(list);
  box.append(wrap);
}
