'use strict';

// ========== SETTINGS ==========
function openSettings() {
  closeSidebar();
  renderSettingsSwatches();
  document.getElementById('poster-bg-toggle').checked = settings.posterBg;
  /* FIX-RELEASE-HANDLERS */
  var _d = document.getElementById('digital-only-toggle');
  if (_d) _d.checked = !!settings.digitalOnly;
  var _s = document.getElementById('streaming-ua-toggle');
  if (_s) _s.checked = !!settings.streamingOnlyUA;
  var _sb = document.getElementById('status-badge-toggle'); /* FIX-STATUS-TOGGLE */
  if (_sb) _sb.checked = settings.showStatusBadges !== false;
  injectSnowToggle();
  if (typeof injectDismissedReset === 'function') injectDismissedReset();
  document.getElementById('settings-modal').classList.add('open');
}

/* FIX-RELEASE-HANDLERS-2 */
function _clearReleaseCaches() {
  try { localStorage.removeItem(RECS_CACHE); } catch (e) {}
  try { localStorage.removeItem(GEN_CACHE); } catch (e) {}
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
  document.getElementById('settings-modal').classList.remove('open'); 
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
    s.addEventListener('click', () => { applyTheme(key, settings.themeAccent); if (typeof touchAppearance === 'function') touchAppearance(); renderSettingsSwatches(); if (cardStack.length) renderCard(); });
    bgWrap.append(s);
  });
  
  Object.entries(ACCENTS).forEach(([key, a]) => {
    const s = el('div', 'theme-swatch' + (settings.themeAccent === key ? ' active' : ''));
    s.style.cssText = `width:48px;height:48px;border-radius:12px;cursor:pointer;border:3px solid ${settings.themeAccent === key ? 'var(--accent)' : 'transparent'};background:${a.accent};position:relative;transition:transform .15s`;
    s.innerHTML = `<span style="position:absolute;bottom:2px;left:0;right:0;text-align:center;font-size:9px;font-weight:600;color:${a.fg}">${a.name}</span>`;
    s.addEventListener('click', () => { applyTheme(settings.themeBg, key); if (typeof touchAppearance === 'function') touchAppearance(); renderSettingsSwatches(); if (cardStack.length) renderCard(); });
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
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  if (modal.querySelector('#snow-toggle')) return;

  const sections = modal.querySelectorAll('.settings-section');
  let target = null;
  sections.forEach(function (sec) {
    const title = sec.querySelector('.settings-section-title');
    if (title && /Вигляд/i.test(title.textContent)) target = sec;
  });
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
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  const sections = modal.querySelectorAll('.settings-section');
  let target = null;
  sections.forEach((sec) => {
    const title = sec.querySelector('.settings-section-title');
    if (title && /Дані/i.test(title.textContent)) target = sec;
  });
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
