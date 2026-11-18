'use strict';

function openSidebar() { 
  document.getElementById('sidebar').classList.add('open'); 
  document.getElementById('sidebar-backdrop').classList.add('open'); 
}

function closeSidebar() { 
  document.getElementById('sidebar').classList.remove('open'); 
  document.getElementById('sidebar-backdrop').classList.remove('open'); 
}

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.nav-item, .nav-group-btn, .search-filter-btn, .filter-btn, .home-tab, .card-tab, .btn, .card-x, .filter-actions button, .query-bar button, .trailer-btn, .auth-btn, .onb-btn, .game-btn, .login-btn-side, .logout-btn-side, .season-tab-btn, .settings-btn, .cast-loader-btn, .mood-pill, .taste-summary');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2.2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = size + 'px';
  ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 700);
});

function openImageZoom(path, size) {
  if (!path) return;
  const zoom = document.getElementById('poster-zoom');
  zoom.querySelector('img').src = TMDB_IMG + (size || 'w500') + path;
  zoom.classList.add('open');
}

function closeImageZoom() { 
  document.getElementById('poster-zoom').classList.remove('open'); 
}

document.getElementById('poster-zoom').addEventListener('click', (e) => {
  if (e.target.id === 'poster-zoom' || e.target.classList.contains('zoom-close')) closeImageZoom();
});

// ========== NAV DROPDOWNS & PRIORITY+ ==========
/* [LAYOUT][DESKTOP] Іконка на верхній панелі відкриває/закриває рядок пошуку. */
function toggleDesktopSearch() {
  if (typeof isDesktopLayout === 'function' && !isDesktopLayout()) return;
  const open = document.body.classList.toggle('mc-search-open');
  if (open) {
    const input = document.getElementById('q');
    if (input) { input.focus(); input.select(); }
  }
}

function closeNavDropdowns() {
  if (isDesktopLayout()) {
    document.querySelectorAll('.nav-group.open').forEach(g => g.classList.remove('open'));
  }
}

function toggleNavGroup(groupName, e) {
  if (e) e.stopPropagation();
  const group = document.querySelector(`.nav-group[data-group="${groupName}"]`);
  if (!group) return;
  const isOpen = group.classList.contains('open');
  const isDesktop = isDesktopLayout();
  if (isDesktop) {
    document.querySelectorAll('.nav-group.open').forEach(g => {
      if (g !== group) g.classList.remove('open');
    });
    if (typeof hideFilterDropdown === 'function') hideFilterDropdown();
    if (typeof hideAutocomplete === 'function') hideAutocomplete();
  }
  /* [LAYOUT] Клік по кнопці «Топи» веде на сторінку топів; підпункти відкривають конкретний топ. */
  if (groupName === 'tops' && isDesktop && typeof setTab === 'function') setTab('tops');
  /* [LAYOUT] На десктопі група вже відкривається по наведенню — клік не закриває її. */
  if (isDesktop) { group.classList.add('open'); return; }
  group.classList.toggle('open', !isOpen);
}

/* [LAYOUT] Десктоп: підменю «Списки», «Огляд» тощо розкриваються по наведенню. */
(function initNavHover() {
  document.querySelectorAll('#sidebar .nav-group').forEach(group => {
    let closeTimer = null;
    group.addEventListener('mouseenter', () => {
      if (!isDesktopLayout()) return;
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      closeNavDropdowns();
      group.classList.add('open');
    });
    group.addEventListener('mouseleave', () => {
      if (!isDesktopLayout()) return;
      /* Невелика затримка: місток між кнопкою й меню + повернення курсору не закривають список. */
      closeTimer = setTimeout(() => group.classList.remove('open'), 180);
    });
  });
})();

(function initPriorityNav() {
  const nav = document.getElementById('sidebar-nav');
  const sidebar = document.getElementById('sidebar');
  const moreGroup = document.querySelector('.nav-more-group');
  const moreMenu = document.getElementById('nav-more-menu');
  if (!nav || !sidebar || !moreGroup || !moreMenu) return;

  const topItems = Array.from(nav.querySelectorAll(':scope > .nav-top-item'));
  const desktopMQ = DESKTOP_MQ;
  let hasMoved = false;

  function updatePriorityNav() {
    if (!desktopMQ.matches) {
      if (hasMoved) {
        topItems.forEach(item => nav.insertBefore(item, moreGroup));
        moreGroup.style.display = 'none';
        moreGroup.classList.remove('open', 'has-active');
        hasMoved = false;
      }
      return;
    }

    if (hasMoved) {
      topItems.forEach(item => nav.insertBefore(item, moreGroup));
      hasMoved = false;
    }
    moreGroup.style.display = 'none';
    moreGroup.classList.remove('open', 'has-active');

    const avail = nav.clientWidth;
    if (!avail) return;

    const widths = topItems.map(el => el.getBoundingClientRect().width);
    const gap = 4;
    const total = widths.reduce((s, w) => s + w, 0) + Math.max(0, topItems.length - 1) * gap;

    if (total <= avail - 2) return;

    // Показуємо кнопку "Ще ▾" і ховаємо все, що не влазить
    moreGroup.style.display = 'flex';
    const moreW = moreGroup.getBoundingClientRect().width + gap + 4;
    const budget = Math.max(0, avail - moreW);

    let used = 0;
    let overflowStart = topItems.length;
    for (let i = 0; i < topItems.length; i++) {
      const w = widths[i] + (i > 0 ? gap : 0);
      if (used + w <= budget) {
        used += w;
      } else {
        overflowStart = i;
        break;
      }
    }

    for (let i = overflowStart; i < topItems.length; i++) {
      moreMenu.appendChild(topItems[i]); hasMoved = true;
    }

    if (moreMenu.querySelector('.nav-item.active')) {
      moreGroup.classList.add('has-active');
    }
  }

  let rafId = null;
  const schedule = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { rafId = null; updatePriorityNav(); });
  };

  window.updatePriorityNav = updatePriorityNav;
  window.addEventListener('resize', schedule);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(schedule).observe(sidebar);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(schedule);
  }
  schedule();

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-group')) closeNavDropdowns();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNavDropdowns();
  });
})();
