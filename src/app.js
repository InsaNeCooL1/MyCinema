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

/* FIX-SETTAB-CLOSE-CARD */
let _pendingSetTab = null;
let _cardClosingForNav = false;

function _flushPendingSetTab() {
  _cardClosingForNav = false;
  if (!_pendingSetTab) return false;
  const p = _pendingSetTab;
  _pendingSetTab = null;
  setTab(p.t, p.opts);
  return true;
}

function setTab(t, opts) {
  if (cardStack.length) {
    _pendingSetTab = { t, opts };
    if (!_cardClosingForNav) {
      _cardClosingForNav = true;
      history.go(-cardStack.length);
    }
    return;
  }
  _cardClosingForNav = false;
  state.tab = t;
  closeSidebar();
  /* FIX-SETTAB-NAV */ if (typeof closeNavDropdowns === 'function') closeNavDropdowns();
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
const SPLASH_DURATION_MS = 1500; /* FIX-SPLASH-SHORT */

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
/* FIX-DEEPLINK */
var _initialHash = /^#\/(movie|tv|person)\/\d+$/.test(location.hash) ? location.hash : '';
history.pushState({ mc: 0 }, '', location.pathname + location.search + _initialHash);
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

/* FIX-ESC-OVERLAY */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') return;
  if (document.getElementById('poster-zoom').classList.contains('open')) { closeImageZoom(); return; }
  if (document.getElementById('settings-modal').classList.contains('open')) { closeSettings(); return; }
  if (document.getElementById('auth-modal').style.display === 'flex') { closeAuthModal(); return; }
  if (overlay.classList.contains('open') && cardStack.length) { history.back(); return; }
});

// Auto-sync when app comes to foreground
let _lastAutoSync = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && window.currentUser && window.firebaseReady) {
    const now = Date.now();
    if (now - _lastAutoSync > 30000) { // не частіше ніж раз на 30 секунд
      _lastAutoSync = now;
      pullFromCloud();
    }
  }
});

// Закриття модалок по кліку на темний фон
document.getElementById('settings-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'settings-modal') closeSettings();
});
document.getElementById('auth-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'auth-modal') closeAuthModal();
});


/* FIX-FOCUS-TRAP — Tab wrap inside open modals */
(function initFocusTrap() {
  function openModals() {
    var ids = ['settings-modal', 'auth-modal', 'onboarding-modal'];
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var m = document.getElementById(ids[i]);
      if (!m) continue;
      if (m.classList.contains('open') || m.style.display === 'flex') out.push(m);
    }
    return out;
  }
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Tab') return;
    var modals = openModals();
    if (!modals.length) return;
    var modal = modals[modals.length - 1];
    var f = modal.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
    var vis = [];
    for (var i = 0; i < f.length; i++) {
      var el = f[i];
      if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) continue;
      vis.push(el);
    }
    if (!vis.length) return;
    var first = vis[0], last = vis[vis.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();


/* FIX-RADIO-ROLE — a11y for rating lights */
(function initRadioRoles() {
  function apply() {
    var groups = document.querySelectorAll('.rating-lights');
    for (var g = 0; g < groups.length; g++) {
      var rg = groups[g];
      if (rg.getAttribute('role') !== 'radiogroup') rg.setAttribute('role', 'radiogroup');
      var lights = rg.querySelectorAll('.light');
      for (var i = 0; i < lights.length; i++) {
        var l = lights[i];
        if (l.getAttribute('role') !== 'radio') {
          l.setAttribute('role', 'radio');
          l.setAttribute('aria-label', 'Оцінка ' + (i + 1));
        }
        l.setAttribute('aria-checked', l.classList.contains('on') ? 'true' : 'false');
      }
    }
  }
  if (document.readyState !== 'loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);
  var obs = new MutationObserver(apply);
  obs.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', function(e) {
    var light = e.target.closest && e.target.closest('.light');
    if (!light) return;
    var rg = light.parentElement;
    if (!rg || !rg.classList.contains('rating-lights')) return;
    setTimeout(function() {
      var all = rg.querySelectorAll('.light');
      for (var i = 0; i < all.length; i++) {
        all[i].setAttribute('aria-checked', all[i].classList.contains('on') ? 'true' : 'false');
      }
    }, 0);
  });
})();


/* ═══════════════════════════════════════════════════════════
   FIX-ACCOUNT-MENU: Account context menu + Lang toggle + Sync
   ═══════════════════════════════════════════════════════════ */

function openAccountMenu(evt) {
  /* FIX-ACCOUNT-MENU-V2 */
  if (evt && evt.stopPropagation) evt.stopPropagation();
  document.querySelectorAll('.account-menu').forEach(function(m) { m.remove(); });
  var btn = document.getElementById('sidebar-logout-btn');
  if (!btn) return;

  var menu = document.createElement('div');
  menu.className = 'account-menu';

  function mkItem(text, cls, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'account-menu-item' + (cls ? ' ' + cls : '');
    b.textContent = text;
    b.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      menu.remove();
      setTimeout(handler, 0);
    });
    return b;
  }

  menu.appendChild(mkItem('Вийти', '', function() {
    if (typeof logoutUser === 'function') logoutUser();
  }));
  menu.appendChild(mkItem('Пройти онбординг знову', '', function() {
    if (typeof closeSidebar === 'function') closeSidebar();
    if (confirm('Пройти налаштування знову? Обрані тайтли додадуться з оцінкою 8.')) {
      try { localStorage.removeItem('onboardingDone'); } catch (e) {}
      if (typeof startOnboarding === 'function') startOnboarding();
    }
  }));
  menu.appendChild(mkItem('Видалити акаунт', 'danger', function() {
    deleteAccount();
  }));

  document.body.appendChild(menu);

  var r = btn.getBoundingClientRect();
  var mRect = menu.getBoundingClientRect();
  var top = r.bottom + 8;
  var left = r.right - mRect.width;
  if (top + mRect.height > window.innerHeight - 10) top = r.top - mRect.height - 8;
  if (top < 10) top = 10;
  if (left < 10) left = 10;
  if (left + mRect.width > window.innerWidth - 10) left = window.innerWidth - mRect.width - 10;
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';

  setTimeout(function() {
    function off(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', off);
      }
    }
    document.addEventListener('click', off);
  }, 100);
}

async function deleteAccount() {
  if (!confirm('Видалити акаунт?\n\nЦе видалить усі дані з хмари (бібліотека, нотатки, оцінки) та локально. Дію не можна скасувати.')) return;
  if (!confirm('Точно видалити? Друге підтвердження.')) return;

  try {
    if (window.currentUser && window.supabase) {
      var uid = window.currentUser.uid;
      await window.supabase.from('user_library').delete().eq('user_id', uid);
      await window.supabase.from('profiles').delete().eq('id', uid);
    }
  } catch (e) {
    console.warn('[deleteAccount]', e);
  }

  try {
    var keys = (window.MC_LOCAL_KEYS || []).concat(['mycinema.lang']);
    keys.forEach(function(k) { try { localStorage.removeItem(k); } catch (e) {} });
  } catch (e) {}

  try { if (window.supabase) await window.supabase.auth.signOut(); } catch (e) {}
  location.reload();
}

/* FIX-LANG-REMOVED — lang toggle прибрано */

function syncFromSettings() {
  if (!window.currentUser) {
    if (typeof showSyncToast === 'function') showSyncToast('❌ Увійдіть в акаунт');
    return;
  }
  if (typeof pullFromCloud === 'function') pullFromCloud();
}

/* FIX-LANG-REMOVED — init онулено (мова завжди UA) */
