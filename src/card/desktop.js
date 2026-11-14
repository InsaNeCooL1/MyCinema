/* Desktop UI картки */
(function () {
  'use strict';

  function renderDesktopCard(ctx, scroll) {
    if (!window.MC) {
      scroll.innerHTML = '<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: функції Mobile UI не завантажені.</div>';
      return;
    }

    scroll.innerHTML = '';
    const root = el('div', 'card-desktop-root');

    // ─── ЛІВА КОЛОНКА ───
    const colLeft = el('div', 'card-desktop-left');
    
    // 1. Банер/Трейлер
    colLeft.append(MC.createHero(ctx));
    
    // 2. Блок Деталі (без заголовка)
    const detailsWrap = el('div', 'desktop-details-block');
    if (typeof renderDetailsTab === 'function') {
      const dContent = renderDetailsTab(ctx);
      dContent.forEach(node => detailsWrap.append(node));
    }
    colLeft.append(detailsWrap);

    // ─── ПРАВА КОЛОНКА ───
    const colRight = el('div', 'card-desktop-right');
    
    colRight.append(MC.createTitle(ctx));
    colRight.append(MC.createActions(ctx));
    colRight.append(MC.createStatuses(ctx));
    colRight.append(MC.createOverview(ctx));
    colRight.append(MC.createScoreBlock(ctx));
    colRight.append(MC.createTabs(ctx));

    root.append(colLeft, colRight);
    scroll.append(root);
  }

  window.renderDesktopCard = renderDesktopCard;
})();
