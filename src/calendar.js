'use strict';

function renderCalendar() {
  box.style.padding = '0';
  box.replaceChildren();
  
  const wrap = el('div', 'home-wrap');
  const head = el('div', 'section-head');
  head.style.marginTop = '20px';
  head.append(el('h1', 'section-title', '📅 Календар'));
  wrap.append(head);

  // Отримуємо всі тайтли зі статусами "Дивлюсь" або "Переглянуто"
  const items = Object.values(lib).filter(x => x.status === 'watching' || x.status === 'watched');
  
  if (!items.length) {
    wrap.append(el('div', 'avail-empty', 'Тут поки порожньо. Додай фільми зі статусом "Дивлюсь" або "Переглянуто".'));
    box.append(wrap);
    return;
  }

  // Отримуємо унікальні місяці для фільтра
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

  // Якщо не вибрано місяць - беремо перший (найновіший)
  if (!state.calendarMonth || !monthsSet.has(state.calendarMonth)) {
    state.calendarMonth = months[0];
  }

  // Хедер з фільтром
  const calHeader = el('div', 'calendar-header');
  const mSelect = document.createElement('select');
  mSelect.className = 'calendar-select';
  
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
  wrap.append(calHeader);

  // Фільтруємо по вибраному місяцю
  const filteredItems = items.filter(item => {
    const date = new Date(item.statusDate || item.updated || Date.now());
    return `${date.getFullYear()}-${date.getMonth()}` === state.calendarMonth;
  });

  // Групуємо за днями
  const groups = {};
  filteredItems.forEach(item => {
    const date = new Date(item.statusDate || item.updated || Date.now());
    const dayKey = date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!groups[dayKey]) groups[dayKey] = [];
    groups[dayKey].push(item);
  });

  // Сортуємо дні за спаданням (новіші зверху)
  const sortedDays = Object.keys(groups).sort((a, b) => {
    return new Date(groups[b][0].statusDate || groups[b][0].updated) - new Date(groups[a][0].statusDate || groups[a][0].updated);
  });

  const timeline = el('div', 'timeline');
  
  sortedDays.forEach(day => {
    const dayGroup = el('div', 'timeline-day-group');
    dayGroup.append(el('div', 'timeline-date', day));
    
    const dayItems = el('div', 'timeline-items');
    
    // Сортуємо елементи всередині дня (спочатку ті, що дивишся зараз, потім переглянуті)
    groups[day].sort((a, b) => (b.statusDate || b.updated) - (a.statusDate || a.updated)).forEach(item => {
      const listItem = createListItem(item);
      
      // Додаємо бейджик статусу
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
