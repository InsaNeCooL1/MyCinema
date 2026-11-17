'use strict';

// ========== SETTINGS ==========
var SETTINGS_GROUPS = {
  view: 'settings-view-modal',
  online: 'settings-online-modal',
  extra: 'settings-extra-modal',
  data: 'settings-data-modal'
};

function openSettings() {
  closeSidebar();
  renderSettingsSwatches();
  injectSnowToggle();
  injectExtraSettings();
  if (typeof injectDismissedReset === 'function') injectDismissedReset();
  if (typeof injectApkUpdateButton === 'function') injectApkUpdateButton();
  openSettingsMenu();
}

function openSettingsMenu() {
  closeAllSettingsModals();
  refreshSettingsControls();
  var menu = document.getElementById('settings-modal');
  if (menu) menu.classList.add('open');
}

function openSettingsGroup(name) {
  var id = SETTINGS_GROUPS[name];
  if (!id) return;
  closeAllSettingsModals();
  refreshSettingsControls();
  var modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

function closeAllSettingsModals() {
  var modals = document.querySelectorAll('.settings-modal');
  for (var i = 0; i < modals.length; i++) modals[i].classList.remove('open');
}

// Повернення назад: з групи → в меню, з меню → закриття. Використовуємо
// і для кнопки «←», і для системної кнопки Back / Escape.
function handleSettingsBack() {
  if (document.querySelector('.settings-group-modal.open')) {
    openSettingsMenu();
    return true;
  }
  var menu = document.getElementById('settings-modal');
  if (menu && menu.classList.contains('open')) {
    closeSettings();
    return true;
  }
  return false;
}

function refreshSettingsControls() {
  var set = function (id, value) {
    var el = document.getElementById(id);
    if (el && el.type === 'checkbox') el.checked = !!value;
  };
  set('poster-bg-toggle', settings.posterBg);
  set('status-badge-toggle', settings.showStatusBadges !== false);
  set('digital-only-toggle', settings.digitalOnly);
  set('streaming-ua-toggle', settings.streamingOnlyUA);
  set('snow-toggle', typeof SnowFeature !== 'undefined' ? SnowFeature.isEnabled() : true);
  set('kbd-nav-toggle', typeof isKbdNavEnabled === 'function' ? isKbdNavEnabled() : false);
  set('streams-enable-toggle', settings.enableStreams !== false);

  // «Дивитись по мережі»: за замовчуванням увімкнено, якщо вже є URL кімнати.
  var online = typeof getOnlineConfig === 'function' ? getOnlineConfig() : {};
  var networkOn = online.networkEnabled !== undefined ? !!online.networkEnabled : !!online.roomUrl;
  set('network-enable-toggle', networkOn);
  var fields = document.getElementById('online-network-fields');
  if (fields) fields.hidden = !networkOn;
  if (typeof syncRoomFields === 'function') syncRoomFields();
}

/* FIX-RELEASE-HANDLERS-2 */
function _clearReleaseCaches() {
  if (typeof mcCacheDel === 'function') { mcCacheDel(RECS_CACHE); mcCacheDel(GEN_CACHE); }
  state.home.sig = null;
  state.home.recs = null;
  state.home.general = null;
}
function onDigitalOnlyToggle(on) {
  settings.digitalOnly = !!on;
  localStorage.setItem('mycinema.digitalOnly', on ? 'true' : 'false');
  _clearReleaseCaches();
  showSyncToast(on ? '💾 Тільки цифра' : '🎬 Всі релізи');
  if (state.tab === 'home') refresh();
}
function onStreamingUAToggle(on) {
  settings.streamingOnlyUA = !!on;
  localStorage.setItem('mycinema.streamingOnlyUA', on ? 'true' : 'false');
  _clearReleaseCaches();
  showSyncToast(on ? '📺 Тільки UA стрімінг' : '📺 Будь-який стрімінг');
  if (state.tab === 'home') refresh();
}

/* FIX-STATUS-TOGGLE */
function onStatusBadgeToggle(on) {
  settings.showStatusBadges = !!on;
  localStorage.setItem('mycinema.showStatusBadges', on ? 'true' : 'false');
  if (typeof touchAppearance === 'function') touchAppearance();
  if (state.tab === 'home') refresh();
}

function closeSettings() {
  closeAllSettingsModals();
}

function onPosterBgToggle(on) {
  settings.posterBg = on;
  localStorage.setItem('mycinema.posterBg', on ? 'true' : 'false');
  if (typeof touchAppearance === 'function') touchAppearance();
  if (cardStack.length) renderCard();
}

function restartOnboardingFromSettings() {
  closeSettings();
  if (confirm('Пройти налаштування знову? Обрані тайтли додадуться з оцінкою 8.')) {
    localStorage.removeItem('onboardingDone');
    startOnboarding();
  }
}

function renderSettingsSwatches() {
  const bgWrap = document.getElementById('bg-swatches');
  const acWrap = document.getElementById('accent-swatches');
  bgWrap.replaceChildren();
  acWrap.replaceChildren();
  
  Object.entries(THEMES).forEach(([key, t]) => {
    const s = el('div', 'theme-swatch' + (settings.themeBg === key ? ' active' : ''));
    s.style.cssText = `width:48px;height:48px;border-radius:12px;cursor:pointer;border:3px solid ${settings.themeBg === key ? 'var(--accent)' : 'transparent'};background:linear-gradient(135deg,${t.bg1} 0%,${t.bg3} 100%);position:relative;transition:transform .15s`;
    s.innerHTML = `<span style="position:absolute;bottom:2px;left:0;right:0;text-align:center;font-size:9px;font-weight:600;color:${t.text}">${t.name}</span>`;
    /* NO-THEME-TOUCH */
    s.addEventListener('click', () => { applyTheme(key, settings.themeAccent); renderSettingsSwatches(); if (cardStack.length) renderCard(); });
    bgWrap.append(s);
  });
  
  Object.entries(ACCENTS).forEach(([key, a]) => {
    const s = el('div', 'theme-swatch' + (settings.themeAccent === key ? ' active' : ''));
    s.style.cssText = `width:48px;height:48px;border-radius:12px;cursor:pointer;border:3px solid ${settings.themeAccent === key ? 'var(--accent)' : 'transparent'};background:${a.accent};position:relative;transition:transform .15s`;
    s.innerHTML = `<span style="position:absolute;bottom:2px;left:0;right:0;text-align:center;font-size:9px;font-weight:600;color:${a.fg}">${a.name}</span>`;
    s.addEventListener('click', () => { applyTheme(settings.themeBg, key); renderSettingsSwatches(); if (cardStack.length) renderCard(); });
    acWrap.append(s);
  });
}

function exportLibrary() {
  closeSettings();
  const data = JSON.stringify(lib, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mycinema-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showSyncToast('💾 Експортовано');
}

function importLibrary() {
  closeSettings();
  const fileInput = document.getElementById('import-file');
  fileInput.value = '';
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      let data = JSON.parse(text);
      if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Невірний формат');
      /* FIX-IMPORT-VALIDATE */
      const cleanData = {};
      let skippedN = 0;
      for (const k of Object.keys(data)) {
        const v = data[k];
        if (!v || typeof v !== 'object' || Array.isArray(v)) { skippedN++; continue; }
        if (!v.key || !v.type || !v.title) { skippedN++; continue; }
        if (v.type !== 'movie' && v.type !== 'tv') { skippedN++; continue; }
        cleanData[k] = v;
      }
      if (Object.keys(cleanData).length === 0) throw new Error('Немає валідних тайтлів у файлі');
      if (skippedN > 0 && !confirm('У файлі ' + skippedN + ' невалідних записів буде пропущено. Продовжити?')) return;
      data = cleanData;
      const count = Object.keys(data).length;
      if (!confirm('Імпортувати ' + count + ' тайтлів? Поточні буде замінено.')) return;
      const nowTs = Date.now();
      for (const k of Object.keys(lib)) if (!(k in data)) libTombstones[k] = nowTs;
      for (const k of Object.keys(data)) {
        delete libTombstones[k];
        if (data[k] && typeof data[k] === 'object' && !data[k].updated) data[k].updated = nowTs; /* FIX-IMPORT-UPDATED */
      }
      lib = data;
      for (const k of Object.keys(data)) _dirtyItems.add(k); /* SYNC-FIX-IMPORT */
      if (typeof logActivity === 'function') logActivity({ cat: 'import', sub: 'import', icon: '📥', text: `Імпортовано тайтлів: ${count}`, title: 'Бібліотека' });
      await saveNow();
      refresh();
      showSyncToast('📥 ' + count);
    } catch (err) { alert('Помилка імпорту: ' + err.message); }
  };
  fileInput.click();
}

// ========== ONBOARDING ==========
let onbSelected = new Set();
let onbCategories = [];

async function startOnboarding() {
  document.getElementById('onboarding-modal').style.display = 'flex';
  const sc = document.getElementById('onb-scroll');
  sc.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Завантаження...</div>';
  onbSelected.clear();
  
  try {
    const [trM, popM, topM, trT, popT, topT] = await Promise.all([
      tmdbFetch('/trending/movie/week?language=uk-UA').catch(() => ({ results: [] })),
      tmdbFetch('/discover/movie?language=uk-UA&sort_by=popularity.desc&vote_count.gte=100&page=1').catch(() => ({ results: [] })),
      tmdbFetch('/discover/movie?language=uk-UA&sort_by=vote_average.desc&vote_count.gte=1000&page=1').catch(() => ({ results: [] })),
      tmdbFetch('/trending/tv/week?language=uk-UA').catch(() => ({ results: [] })),
      tmdbFetch('/discover/tv?language=uk-UA&sort_by=popularity.desc&vote_count.gte=100&page=1').catch(() => ({ results: [] })),
      tmdbFetch('/discover/tv?language=uk-UA&sort_by=vote_average.desc&vote_count.gte=500&page=1').catch(() => ({ results: [] }))
    ]);
    
    const dedup = (items, seen) => items.filter(x => { if (seen.has(x.key) || !x.poster) return false; seen.add(x.key); return true; });
    const seenM = new Set();
    const seenT = new Set();
    
    onbCategories = [
      { title: '🔥 Фільми · Тренди тижня', items: dedup(trM.results.map(r => normalizeItem({...r, media_type: 'movie'})), seenM).slice(0, 15) },
      { title: '⭐ Фільми · Популярне', items: dedup(popM.results.map(r => normalizeItem({...r, media_type: 'movie'})), seenM).slice(0, 20) },
      { title: '🏆 Фільми · Найкращі', items: dedup(topM.results.map(r => normalizeItem({...r, media_type: 'movie'})), seenM).slice(0, 15) },
      { title: '🔥 Серіали · Тренди тижня', items: dedup(trT.results.map(r => normalizeItem({...r, media_type: 'tv'})), seenT).slice(0, 15) },
      { title: '⭐ Серіали · Популярне', items: dedup(popT.results.map(r => normalizeItem({...r, media_type: 'tv'})), seenT).slice(0, 20) },
      { title: '🏆 Серіали · Найкращі', items: dedup(topT.results.map(r => normalizeItem({...r, media_type: 'tv'})), seenT).slice(0, 15) }
    ].filter(c => c.items.length > 0);
    
    renderOnbGrids();
  } catch (e) { sc.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger);">Помилка: ${escapeHtml(e.message)}</div>`; } /* FIX-ONB-ERR-ESC */
}

function renderOnbGrids() {
  const sc = document.getElementById('onb-scroll');
  sc.innerHTML = '';
  sc.scrollTop = 0; /* FIX-ONB-SCROLL */
  onbCategories.forEach(cat => {
    const catEl = el('div', 'onb-category');
    catEl.append(el('div', 'onb-category-title', cat.title));
    const gridEl = el('div', 'onb-grid');
    cat.items.forEach(item => {
      const c = el('div', 'onb-card' + (onbSelected.has(item.key) ? ' selected' : ''));
      const p = el('img', 'onb-poster'); p.src = TMDB_IMG + 'w185' + item.poster; p.loading = 'lazy';
      c.append(p, el('div', 'onb-title', item.title));
      c.addEventListener('click', () => {
        if (onbSelected.has(item.key)) onbSelected.delete(item.key); else onbSelected.add(item.key);
        c.classList.toggle('selected'); updateOnbSubmit();
      });
      gridEl.append(c);
    });
    catEl.append(gridEl); sc.append(catEl);
  });
  updateOnbSubmit();
}

function updateOnbSubmit() {
  const btn = document.getElementById('onb-submit');
  if (onbSelected.size >= 5) { btn.classList.add('active'); btn.disabled = false; }
  else { btn.classList.remove('active'); btn.disabled = true; }
}

async function submitOnboarding() {
  const btn = document.getElementById('onb-submit');
  btn.textContent = 'Збереження...'; btn.disabled = true;
  const items = [];
  onbCategories.forEach(cat => cat.items.forEach(it => { if (onbSelected.has(it.key)) items.push(it); }));
  // [ONB-TV-FIX] Для TV — сезонні оцінки, інакше computeItemRating().avg = 0
  items.forEach(it => {
    const isTv = it.type === 'tv';
    lib[it.key] = {
      ...it,
      status: 'watched',
      ...(isTv
        ? { seasonRatings: { 1: { overall: 8 } }, totalSeasons: 1 }
        : { ratings: { overall: 8 } }),
      updated: Date.now(),
      createdAt: Date.now()
    };
    _dirtyItems.add(it.key); /* SYNC-FIX-ONB */
  });
  localStorage.setItem('onboardingDone', 'true');
  document.getElementById('onboarding-modal').style.display = 'none';
  btn.textContent = 'Продовжити';
  await saveNow(); refresh();
}

function skipOnboarding() {
  if (confirm('Пропустити налаштування?')) {
    localStorage.setItem('onboardingDone', 'true');
    document.getElementById('onboarding-modal').style.display = 'none';
  }
}


// ========== SNOW TOGGLE (injected dynamically, no HTML in index.html) ==========
function injectSnowToggle() {
  const modal = document.getElementById('settings-view-modal');
  if (!modal) return;
  if (modal.querySelector('#snow-toggle')) return;

  const target = modal.querySelector('.settings-box');
  if (!target) return;

  const label = document.createElement('label');
  label.className = 'settings-toggle';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = 'snow-toggle';
  input.checked = (typeof SnowFeature !== 'undefined') ? SnowFeature.isEnabled() : true;
  input.addEventListener('change', function () {
    if (typeof SnowFeature !== 'undefined') SnowFeature.setEnabled(this.checked);
  });

  const span = document.createElement('span');
  span.textContent = 'Сніг на фоні';

  label.appendChild(input);
  label.appendChild(span);
  target.appendChild(label);
}

// ========== RESET DISMISSED ==========
function injectDismissedReset() {
  const modal = document.getElementById('settings-data-modal');
  if (!modal) return;
  const target = modal.querySelector('.settings-box');
  if (!target) return;

  const getCount = () => (typeof dismissedRecs === 'object' && dismissedRecs) ? Object.keys(dismissedRecs).length : 0;
  let btn = modal.querySelector('#reset-dismissed-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'reset-dismissed-btn';
    btn.className = 'settings-btn';
    btn.addEventListener('click', () => {
      const cnt = getCount();
      if (!cnt) { showSyncToast('Немає схованих рекомендацій'); return; }
      if (!confirm(`Повернути всі сховані рекомендації (${cnt})?`)) return;
      if (typeof clearDismissed === 'function') clearDismissed();
      state.home.sig = null;
      try { localStorage.removeItem(RECS_CACHE); } catch {}
      btn.textContent = 'Повернути сховані рекомендації (0)';
      showSyncToast('✅ Сховані рекомендації повернуто');
      if (state.tab === 'home') refresh();
    });
    target.appendChild(btn);
  }
  btn.textContent = `Повернути сховані рекомендації (${getCount()})`;
}


// ========== APK UPDATE CHECKER (GitHub Releases) ==========
function injectApkUpdateButton() {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!isNative) return;
  const modal = document.getElementById('settings-data-modal');
  if (!modal || modal.querySelector('#apk-update-btn')) return;
  const target = modal.querySelector('.settings-box');
  if (!target) return;
  const btn = document.createElement('button');
  btn.id = 'apk-update-btn';
  btn.className = 'settings-btn';
  btn.textContent = '🔄 Перевірити оновлення APK';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⏳ Перевірка...';
    try {
      const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      const info = CapApp && CapApp.getInfo ? await CapApp.getInfo() : { version: '?', build: '0' };
      const curBuild = parseInt(info.build, 10) || 0;
      const ep = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ExternalPlayer;
      const openExt = (u) => {
        if (ep && typeof ep.openUrl === 'function') return ep.openUrl({ url: u }).catch(() => window.open(u, '_system'));
        return window.open(u, '_blank');
      };
      const res = await fetch('https://api.github.com/repos/InsaNeCooL1/MyCinema/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      if (res.status === 404) {
        if (confirm('GitHub API повернув 404 (репо приватний або ще без релізу).\n\nВідкрити сторінку релізів у браузері?')) {
          openExt('https://github.com/InsaNeCooL1/MyCinema/releases/latest');
        }
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rel = await res.json();
      const tagNum = parseInt(String(rel.tag_name || '').replace(/\D+/g, ''), 10) || 0;
      const curNum = curBuild > 101 ? (curBuild - 100) : 0;
      const apkAsset = (rel.assets || []).find(a => /\.apk$/i.test(a.name || ''));
      const dlUrl = (apkAsset && apkAsset.browser_download_url) || rel.html_url;
      const seenTag = localStorage.getItem('mycinema.seenReleaseTag') || '';
      const isNew = curNum > 0 ? (tagNum > curNum) : (rel.tag_name && rel.tag_name !== seenTag);
      if (isNew) {
        if (confirm(`Доступна версія ${rel.name || rel.tag_name} (поточна: ${info.version || curBuild}).\n\nВідкрити завантаження APK?`)) {
          if (rel.tag_name) localStorage.setItem('mycinema.seenReleaseTag', rel.tag_name);
          openExt(dlUrl);
        }
      } else {
        showSyncToast(`✅ Актуальна збірка (${rel.tag_name || info.version})`);
      }
    } catch (e) {
      showSyncToast('⚠ Не вдалося перевірити оновлення');
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 Перевірити оновлення APK';
    }
  });
  target.appendChild(btn);
}

// ========== ДОДАТКОВІ ФУНКЦІЇ (local-only, без хмарної синхронізації) ==========
function injectExtraSettings() {
  const modal = document.getElementById('settings-extra-modal');
  if (!modal) return;
  const box = modal.querySelector('.settings-box');
  if (!box || box.querySelector('#kbd-nav-toggle')) return;

  // Керування клавіатурою
  const sec = document.createElement('div');
  sec.className = 'settings-section';
  sec.appendChild(el('div', 'settings-section-title', 'Керування'));

  const label = document.createElement('label');
  label.className = 'settings-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = 'kbd-nav-toggle';
  input.checked = typeof isKbdNavEnabled === 'function' ? isKbdNavEnabled() : false;
  input.addEventListener('change', function () {
    if (typeof setKbdNavEnabled === 'function') setKbdNavEnabled(this.checked);
    showSyncToast(this.checked ? '⌨️ Клавіатура увімкнена' : '👆 Сенсорне керування');
  });
  label.append(input, el('span', '', 'Керування клавіатурою (стрілки / Tab)'));
  sec.append(label, el('div', 'notes-hint', 'Локальне налаштування тільки для цього пристрою.'));
  box.appendChild(sec);

  // Проксі — звичайні поля замість prompt()
  const proxySec = document.createElement('div');
  proxySec.className = 'settings-section';
  proxySec.appendChild(el('div', 'settings-section-title', 'Проксі'));

  function proxyField(id, storageKey, text, placeholder) {
    proxySec.appendChild(el('label', 'settings-field-label', text));
    const inp = document.createElement('input');
    inp.id = id;
    inp.className = 'settings-field';
    inp.placeholder = placeholder || 'https://…';
    inp.autocomplete = 'off';
    inp.value = localStorage.getItem(storageKey) || '';
    inp.addEventListener('change', function () {
      var v = inp.value.trim().replace(/\/+$/, '');
      if (v && !/^https?:\/\//i.test(v)) {
        alert('Невірний URL');
        inp.value = localStorage.getItem(storageKey) || '';
        return;
      }
      if (v) localStorage.setItem(storageKey, v);
      else localStorage.removeItem(storageKey);
      if (storageKey === 'mycinema.tmdbProxy' && typeof DEFAULT_PROXY_URL !== 'undefined') {
        PROXY_URL = v || DEFAULT_PROXY_URL;
      }
      showSyncToast('✅ ' + text + ' збережено');
    });
    proxySec.appendChild(inp);
  }

  proxyField('tmdb-proxy-input', 'mycinema.tmdbProxy', 'TMDB проксі', 'порожньо = стандартний');
  proxyField('stream-proxy-input', 'mycinema.proxy', 'Проксі балансерів', 'порожньо = стандартний');
  proxySec.appendChild(el('div', 'notes-hint', 'Порожнє поле = стандартний адрес. Зміни застосовуються після втрати фокусу.'));
  box.appendChild(proxySec);
}


