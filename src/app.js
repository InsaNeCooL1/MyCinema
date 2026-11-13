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
  const moreGroup = document.querySelector('.nav-more-group');
  if (moreGroup) moreGroup.classList.toggle('has-active', !!moreGroup.querySelector('.nav-item.active'));
}

function setTab(t, opts) {
  state.tab = t;
  closeSidebar();
  if (!(opts && opts.keepFilter) && typeof hideFilterDropdown === 'function') hideFilterDropdown();
  if (typeof hideAutocomplete === 'function') hideAutocomplete();
  document.body.classList.toggle('no-search', !(t === 'home' || t === 'filter'));
  syncNavActive();
  typeFilterBar.classList.toggle("hidden", !["watching", "watched", "planned", "dropped", "favorites"].includes(t));
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

// ========== COLD START SPLASH (APK only, 3s) ==========
const SPLASH_POOL_KEY = 'mycinema.splashPool.v1';
const SPLASH_POOL_TTL = 12 * 60 * 60 * 1000;
const SPLASH_DURATION_MS = 3000;

function readSplashPool() {
  try {
    const raw = JSON.parse(localStorage.getItem(SPLASH_POOL_KEY));
    if (raw && Array.isArray(raw.items) && raw.items.length) return raw;
  } catch {}
  return null;
}

function writeSplashPool(items) {
  try {
    localStorage.setItem(SPLASH_POOL_KEY, JSON.stringify({ ts: Date.now(), items }));
  } catch {}
}

function initColdSplash() {
  if (document.getElementById('cold-splash')) return;

  const splash = document.createElement('div');
  splash.id = 'cold-splash';
  splash.className = 'cold-splash';

  const mediaWrap = document.createElement('div');
  mediaWrap.className = 'splash-media';

  const vignette = document.createElement('div');
  vignette.className = 'splash-vignette';

  const content = document.createElement('div');
  content.className = 'splash-content';

  const logo = document.createElement('div');
  logo.className = 'splash-logo';
  logo.textContent = 'MyCinema';

  const status = document.createElement('div');
  status.className = 'splash-status';
  status.append(document.createTextNode('Завантажуємо'));
  const dot = document.createElement('span');
  dot.className = 'splash-dot';
  dot.textContent = '.';
  status.append(dot);

  content.append(logo, status);
  splash.append(mediaWrap, vignette, content);
  document.body.appendChild(splash);

  const applyPick = (pick) => {
    if (!pick || !splash.isConnected) return;
    const desktopPath = pick.backdrop || pick.poster;
    const mobilePath = pick.poster || pick.backdrop;
    if (!desktopPath && !mobilePath) return;

    mediaWrap.replaceChildren();
    const pic = document.createElement('picture');
    pic.className = 'splash-picture';

    if (desktopPath) {
      const srcDesk = document.createElement('source');
      srcDesk.media = '(min-width: 900px) and (min-height: 600px)';
      srcDesk.srcset = TMDB_IMG + 'w1280' + desktopPath;
      pic.append(srcDesk);
    }

    const img = document.createElement('img');
    img.className = 'splash-bg-img';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.src = TMDB_IMG + 'w780' + mobilePath;
    if (img.complete) img.classList.add('loaded');

    pic.append(img);
    mediaWrap.append(pic);
  };

  const cached = readSplashPool();
  if (cached) {
    const pick = cached.items[Math.floor(Math.random() * cached.items.length)];
    applyPick(pick);
  }

  // Оновлення пулу популярних фільмів TMDB (або перше завантаження)
  if (!cached || (Date.now() - (cached.ts || 0)) >= SPLASH_POOL_TTL) {
    tmdbFetch('/movie/popular?language=uk-UA&page=1')
      .then(d => {
        const items = (d.results || [])
          .filter(x => x && x.poster_path && x.backdrop_path)
          .map(x => ({ poster: x.poster_path, backdrop: x.backdrop_path }));
        if (!items.length) return;
        writeSplashPool(items);
        if (!cached) {
          const pick = items[Math.floor(Math.random() * items.length)];
          applyPick(pick);
        }
      })
      .catch(() => {});
  }

  setTimeout(() => {
    splash.classList.add('hiding');
    setTimeout(() => {
      if (splash.isConnected) splash.remove();
    }, 420);
  }, SPLASH_DURATION_MS);
}

if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
  initColdSplash();
}
history.pushState({ mc: 0 }, '', location.pathname + location.search);
refresh();
routeFromHash();

// [GUEST-ONB-FIX] Гість-онбординг при першому запуску
if (!window.currentUser && Object.keys(lib).length === 0 && !localStorage.getItem('onboardingDone')) {
  setTimeout(() => {
    if (typeof startOnboarding === 'function' && !window.currentUser && Object.keys(lib).length === 0 && !localStorage.getItem('onboardingDone')) {
      startOnboarding();
    }
  }, 800);
}

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

function onFirebaseReadyUI() {
  const lb = document.getElementById('sidebar-logout-btn');
  if (lb && window.currentUser) {
    lb.title = (window.currentUser.email || 'Акаунт') + ' · Вийти з акаунту';
  }
}
window.addEventListener('firebase-ready', onFirebaseReadyUI);
if (window.firebaseReady) {
  onFirebaseReadyUI();
  syncFromCloud();
}
syncNavActive();

// Закриття модалок по кліку на темний фон
document.getElementById('settings-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'settings-modal') closeSettings();
});
document.getElementById('auth-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'auth-modal') closeAuthModal();
});
