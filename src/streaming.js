/* [STREAMINGS] Сторінка стрімінгів: картки компаній, клік відкриває картку як таб студій. */

'use strict';

function renderStreamings() {
  box.style.padding = 'var(--mc-home-pad, 0 16px)';
  box.replaceChildren();

  if (typeof MC_STREAMINGS === 'undefined' || !Array.isArray(MC_STREAMINGS)) {
    box.append(el('div', 'avail-empty', 'Дані стрімінгів недоступні.'));
    return;
  }

  const wrap = el('div', 'collections-page');
  const head = el('div', 'section-head');
  head.append(el('h1', 'section-title', '📺 Стріммінги'));
  head.append(el('span', 'section-sub', `${MC_STREAMINGS.length} сервісів`));
  wrap.append(head);

  const grid = el('div', 'collections-masonry streaming-masonry');
  MC_STREAMINGS.forEach(service => {
    const card = el('button', 'collection-card streaming-card');
    card.type = 'button';
    const logoWrap = el('div', 'streaming-logo-wrap');
    if (service.logo) {
      const img = el('img');
      img.src = TMDB_IMG + 'w185' + service.logo;
      img.alt = service.name;
      img.loading = 'lazy';
      logoWrap.append(img);
    } else {
      logoWrap.append(el('div', 'collections-cover-empty', '📺'));
    }
    card.append(logoWrap);
    card.append(el('div', 'collection-card-title', service.name));
    card.addEventListener('click', () => openCompany(service.id));
    grid.append(card);
  });
  wrap.append(grid);

  box.append(wrap);
}
