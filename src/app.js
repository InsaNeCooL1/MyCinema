'use strict';

// ========== NAVIGATION ==========
function setTab(t) {
  state.tab = t;
  closeSidebar();
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
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
  else if (state.tab === "top") renderMyTop();
  else if (state.tab === "calendar") renderCalendar();
  else renderLibrary();
}

// ========== INITIALIZATION ==========
window.addEventListener('firebase-ready', syncFromCloud);

history.pushState({ mc: 0 }, '', location.pathname + location.search);
refresh();
routeFromHash();

// ========== CAPACITOR BACK BUTTON ==========
(function () {
  const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (!CapApp || !CapApp.addListener) return;
  CapApp.addListener('backButton', () => {
    if (document.getElementById('poster-zoom').classList.contains('open')) { closeImageZoom(); return; }
    if (document.getElementById('settings-modal').classList.contains('open')) { closeSettings(); return; }
    if (document.getElementById('sidebar').classList.contains('open')) { closeSidebar(); return; }
    if (!autocomplete.classList.contains('hidden') && autocomplete.childElementCount) { hideAutocomplete(); return; }
    if (cardStack.length) { history.back(); return; }
    if (state.tab !== 'home') { setTab('home'); return; }
    CapApp.exitApp();
  });
})();
