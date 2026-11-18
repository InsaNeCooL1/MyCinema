/* [COLLECTIONS] Сторінка підбірок: masonry-сітка тем + модалка зі стрічкою фільмів.
   Дані — статичні з src/collections-data.js (MC_COLLECTIONS). */

'use strict';

function renderCollections() {
  box.style.padding = 'var(--mc-home-pad, 0 16px)';
  box.replaceChildren();

  if (typeof MC_COLLECTIONS === 'undefined' || !Array.isArray(MC_COLLECTIONS)) {
    box.append(el('div', 'avail-empty', 'Дані підбірок недоступні.'));
    return;
  }

  const wrap = el('div', 'collections-page');
  const head = el('div', 'section-head');
  head.append(el('h1', 'section-title', '🎞️ Підбірки'));
  head.append(el('span', 'section-sub', `${MC_COLLECTIONS.length} тем`));
  wrap.append(head);

  const grid = el('div', 'collections-masonry');
  MC_COLLECTIONS.forEach(col => grid.append(buildCollectionCard(col)));
  wrap.append(grid);

  box.append(wrap);
}

function buildCollectionCard(col) {
  const card = el('div', 'collection-card');
  card.tabIndex = 0;

  /* Колаж із 2–3 постерів, як у першому варіанті. */
  const covers = (col.items || []).filter(item => item.poster).slice(0, 3);
  const cover = el('div', 'collections-cover');
  cover.style.gridTemplateColumns = `repeat(${Math.max(1, covers.length)}, minmax(0, 1fr))`;
  covers.forEach(item => {
    const img = el('img');
    img.src = TMDB_IMG + 'w185' + item.poster;
    img.alt = '';
    img.loading = 'lazy';
    cover.append(img);
  });
  if (!cover.children.length) cover.append(el('div', 'collections-cover-empty', col.emoji || '🎬'));
  card.append(cover);

  const title = el('div', 'collection-card-title');
  title.append(el('span', 'collection-card-emoji', col.emoji || '🎬'), document.createTextNode(col.title));
  card.append(title);
  if (col.description) card.append(el('div', 'collection-card-desc', col.description));
  card.append(el('div', 'collection-card-count', `${(col.items || []).length} тайтлів`));

  const open = () => openCollectionModal(col);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return card;
}

function openCollectionModal(col) {
  document.querySelectorAll('.collection-modal-overlay').forEach(o => o.remove());

  const overlay = el('div', 'collection-modal-overlay');
  const modal = el('div', 'collection-modal');

  const head = el('div', 'collection-modal-head');
  head.append(el('h2', 'section-title', `${col.emoji ? col.emoji + ' ' : ''}${col.title}`));
  const close = el('button', 'collection-modal-close', '✕');
  close.type = 'button';
  close.title = 'Закрити';
  close.addEventListener('click', () => overlay.remove());
  head.append(close);
  modal.append(head);

  if (col.description) modal.append(el('div', 'collection-modal-desc', col.description));

  /* Усередині — плитки постерів із назвами, як тренди на головній. */
  const grid = el('div', 'collections-modal-grid');
  (col.items || []).forEach(item => {
    grid.append(recCard({ ...item, tmdbRating: item.rating || 0 }, false));
  });
  /* Картка фільму має відкриватись поверх, а не позаду модалки добірки. */
  grid.addEventListener('click', (e) => {
    if (e.target.closest('.rec-card')) overlay.remove();
  });
  modal.append(grid);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.append(modal);
  document.body.append(overlay);
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const modal = document.querySelector('.collection-modal-overlay');
  if (modal) modal.remove();
});
