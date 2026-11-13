'use strict';

function renderCalendar() {
  box.style.padding = '0';
  box.replaceChildren();
  
  const wrap = el('div', 'home-wrap');
  const head = el('div', 'section-head');
  head.style.marginTop = '20px';
  head.append(el('h1', 'section-title', '📅 Календар'));
  wrap.append(head);

  // 1. Беремо всі тайтли з потрібними статусами
  let allItems = Object.values(lib).filter(x => x.status === 'watching' || x.status === 'watched');
  
  if (!allItems.length) {
    wrap.append(el('div', 'avail-empty', 'Тут поки порожньо. Додай фільми зі статусом "Дивлюсь" або "Переглянуто".'));
    box.append(wrap);
    return;
  }

  // 2. Фільтруємо за обраним статусом (якщо не 'all')
  let items = allItems;
  if (state.calendarStatus === 'watching') items = items.filter(x => x.status === 'watching');
  else if (state.calendarStatus === 'watched') items = items.filter(x => x.status === 'watched');

  // 3. Збираємо унікальні місяці вже з відфільтрованих елементів
  const monthsSet = new Set();
  items.forEach(item => {
    const date = new Date(item.statusDate || item.updated || Date.now());
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    monthsSet.add(monthKey);
  });
  
  const months = Array.from(monthsSet).sort((a, b) => {
    const [ya, ma] = a.split('-').map(Number);
    const [yb, mb] = b.split('-').map(Number);
    return yb - ya || mb - ma;
  });

  // Якщо поточний вибраний місяць відсутній у новому списку - беремо перший
  if (!state.calendarMonth || !monthsSet.has(state.calendarMonth)) {
    state.calendarMonth = months[0] || null;
  }

  // 4. Малюємо панель з фільтрами (Місяць + Статус)
  const calHeader = el('div', 'calendar-header');
  calHeader.style.display = 'flex';
  calHeader.style.gap = '10px';
  calHeader.style.flexWrap = 'wrap';

  // Селект статусу
  const sSelect = document.createElement('select');
  sSelect.className = 'calendar-select';
  sSelect.style.flex = '1';
  sSelect.style.minWidth = '150px';
  [
    { val: 'all', label: 'Всі статуси' },
    { val: 'watching', label: '▶️ Дивлюсь' },
    { val: 'watched', label: '✅ Переглянуто' }
  ].forEach(optData => {
    const opt = document.createElement('option');
    opt.value = optData.val;
    opt.textContent = optData.label;
    if (state.calendarStatus === optData.val) opt.selected = true;
    sSelect.append(opt);
  });
  sSelect.addEventListener('change', (e) => {
    state.calendarStatus = e.target.value;
    state.calendarMonth = null; // Скидаємо місяць, щоб він обрався автоматично з нового списку
    renderCalendar();
  });
  calHeader.append(sSelect);

  // Селект місяця
  if (months.length > 0) {
    const mSelect = document.createElement('select');
    mSelect.className = 'calendar-select';
    mSelect.style.flex = '1';
    mSelect.style.minWidth = '150px';
    
    const monthNames = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
    
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
    wrap.append(el('div', 'avail-empty', 'Немає записів з таким статусом.'));
    box.append(wrap);
    return;
  }

  // 5. Фільтруємо по вибраному місяцю
  const filteredItems = items.filter(item => {
    const date = new Date(item.statusDate || item.updated || Date.now());
    return `${date.getFullYear()}-${date.getMonth()}` === state.calendarMonth;
  });

  // 5.1 Підсумок місяця
  const monthNames = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
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

  // 6. Групуємо за днями
  const groups = {};
  filteredItems.forEach(item => {
    const date = new Date(item.statusDate || item.updated || Date.now());
    const dayKey = date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!groups[dayKey]) groups[dayKey] = [];
    groups[dayKey].push(item);
  });

  // Сортуємо дні за спаданням
  const sortedDays = Object.keys(groups).sort((a, b) => {
    return new Date(groups[b][0].statusDate || groups[b][0].updated) - new Date(groups[a][0].statusDate || groups[a][0].updated);
  });

  const timeline = el('div', 'timeline');
  
  sortedDays.forEach(day => {
    const dayGroup = el('div', 'timeline-day-group');
    dayGroup.append(el('div', 'timeline-date', day));
    
    const dayItems = el('div', 'timeline-items');
    
    groups[day].sort((a, b) => (b.statusDate || b.updated) - (a.statusDate || a.updated)).forEach(item => {
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
