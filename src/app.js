'use strict';

function syncNavActive() {
  const t = state.tab;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".nav-group").forEach(g => {
    const hasActive = !!g.querySelector('.nav-item.active');
    g.classList.toggle('has-active', hasActive);
    if (window.matchMedia('(min-width: 900px) and (min-height: 600px)').matches) {
      g.classList.remove('open');
    } else if (hasActive) {
      g.classList.add('open');
    }
  });
}

function setTab(t) {
  state.tab = t;
  closeSidebar();
  if (typeof hideFilterDropdown === 'function') hideFilterDropdown();
  if (typeof hideAutocomplete === 'function') hideAutocomplete();
  document.body.classList.toggle('no-search', !(t === 'home' || t === 'filter'));
  syncNavActive();
  typeFilterBar.classList.toggle("hidden", !["recent", "watching", "watched", "planned", "dropped", "favorites"].includes(t));
  if (t === 'game') { box.style.padding = '0'; renderGame(); return; }
  if (t === 'top') { box.style.padding = '0 16px 16px'; renderMyTop(); return; }
  refresh();
}

document.querySelectorAll(".filter-btn").forEach(b => b.addEventListener("click", () => setTypeFilter(b.dataset.filter)));

function setTypeFilter(f) {
  state.typeFilter = f;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b.dataset.filter === f));
  if (state.tab === "filter") renderFilter(); else renderLibrary();
}

function refresh() {
  if (state.tab === "home") loadHome();
  else if (state.tab === "filter") renderFilter();
  else if (state.tab === "game") renderGame();
  else if (state.tab === "statistics") renderStatistics();
  else if (state.tab === "notes") renderNotesList();
  else if (state.tab === "calendar") renderCalendar();
  else if (state.tab === "top") renderMyTop();
  else renderLibrary();
}

window.addEventListener('firebase-ready', syncFromCloud);

history.pushState({ mc: 0 }, '', location.pathname + location.search);
refresh();
routeFromHash();

// ========== CAPACITOR BACK BUTTON (FIXED) ==========
(function () {
  const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (!CapApp || !CapApp.addListener) {
    console.warn('Capacitor App plugin not found. Back button handling disabled.');
    return;
  }
  
  CapApp.addListener('backButton', () => {
    // 1. Модальні вікна та оверлеї
    if (document.getElementById('poster-zoom').classList.contains('open')) { closeImageZoom(); return; }
    if (document.getElementById('settings-modal').classList.contains('open')) { closeSettings(); return; }
    if (document.getElementById('auth-modal').style.display === 'flex') { closeAuthModal(); return; }
    

    // 2. Бокове меню
    if (document.getElementById('sidebar').classList.contains('open')) { closeSidebar(); return; }
    
    // 3. Автокомпліт та дропдаун фільтрів
    if (typeof filterDropdown !== 'undefined' && filterDropdown && !filterDropdown.classList.contains('hidden')) { hideFilterDropdown(); return; }
    if (document.querySelector('.nav-group.open')) { closeNavDropdowns(); return; }
    if (!autocomplete.classList.contains('hidden') && autocomplete.childElementCount) { hideAutocomplete(); return; }
    
    // 4. Стек карток (модалка тайтлу/актора)
    if (cardStack.length) { history.back(); return; }
    
    // 5. Таби (якщо не на головній)
    if (state.tab !== 'home') { setTab('home'); return; }
    
    // 6. Вихід з додатку (тільки з головної)
    CapApp.exitApp();
  });
})();

// Ініціалізація видимості пошуку
document.body.classList.toggle('no-search', !(state.tab === 'home' || state.tab === 'filter'));

window.addEventListener('firebase-ready', () => {
  const lb = document.getElementById('sidebar-logout-btn');
  if (lb && window.currentUser) {
    lb.title = (window.currentUser.email || 'Акаунт') + ' · Вийти з акаунту';
  }
});
syncNavActive();
