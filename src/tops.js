/* [TOPS] Окрема сторінка топів. Використовує ті самі плитки й модалку, що й підбірки. */

'use strict';

function renderTops() {
  box.style.padding = 'var(--mc-home-pad, 0 16px)';
  box.replaceChildren();

  if (typeof MC_TOPS === 'undefined' || !Array.isArray(MC_TOPS)) {
    box.append(el('div', 'avail-empty', 'Дані топів недоступні.'));
    return;
  }

  const wrap = el('div', 'collections-page');
  const head = el('div', 'section-head');
  head.append(el('h1', 'section-title', '🏆 Топи'));
  head.append(el('span', 'section-sub', `${MC_TOPS.length} список`));
  wrap.append(head);

  const grid = el('div', 'collections-masonry');
  MC_TOPS.forEach(top => grid.append(buildCollectionCard({
    id: top.id,
    title: top.title,
    emoji: top.source === 'IMDb' ? '🏆' : '🔥',
    description: top.subtitle || '',
    items: top.items || []
  })));
  wrap.append(grid);

  box.append(wrap);
}

/* Клік по підпункту меню відкриває конкретний топ у модалці. */
function openTopById(id) {
  if (typeof MC_TOPS === 'undefined') return;
  const top = MC_TOPS.find(t => t.id === id);
  if (!top) return;
  closeNavDropdowns();
  if (state.tab !== 'tops') setTab('tops');
  openCollectionModal({
    id: top.id,
    title: top.title,
    emoji: top.source === 'IMDb' ? '🏆' : '🔥',
    description: top.subtitle || '',
    items: top.items || []
  });
}

(function initTopsDropdown() {
  const menu = document.getElementById('tops-dropdown');
  if (!menu || typeof MC_TOPS === 'undefined') return;
  MC_TOPS.forEach(top => {
    const item = el('div', 'nav-item', top.title);
    item.addEventListener('click', () => openTopById(top.id));
    menu.append(item);
  });
})();
