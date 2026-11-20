/* ROOM-v1 — зовнішня «кімната»: URL, оверлей, міст postMessage */
(function () {
  var LS = 'mycinema.room';
  var DEFAULT_ROOM_URL = 'https://super-daifuku-28fbcd.netlify.app';
  var overlay = null, frame = null, card = null, roomOrigin = null, loadTimer = null, escHandler = null;

  function toast(m) {
    if (typeof showSyncToast === 'function') showSyncToast(m);
    else console.log('[room]', m);
  }

  /* ---------- URL: нормалізація, сховище, перевірка ---------- */
  function isPrivateHost(h) {
    return h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
      /\.local$/.test(h);
  }
  function normalizeUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      var host = s.split(/[\/:?#]/)[0].toLowerCase();
      s = (isPrivateHost(host) ? 'http://' : 'https://') + s;
    }
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  }
  function getOnline() {
    if (typeof getOnlineConfig === 'function') return getOnlineConfig() || {};
    try { return JSON.parse(localStorage.getItem('mycinema.online') || '{}') || {}; } catch (e) { return {}; }
  }
  function setOnline(patch) {
    if (typeof setOnlineConfig === 'function') return setOnlineConfig(patch);
    var cur = getOnline();
    var next = Object.assign({}, cur, patch || {}, { ts: Date.now() });
    try { localStorage.setItem('mycinema.online', JSON.stringify(next)); } catch (e) {}
    try { localStorage.setItem('mycinema.room', JSON.stringify({ url: String(next.roomUrl || '') })); } catch (e) {}
    return next;
  }
  function getUrl() { return String(getOnline().roomUrl || DEFAULT_ROOM_URL); }
  function enabled() { return !!getUrl() && isNetworkEnabled(); }
  function serviceConfig() {
    var o = getOnline();
    var proxy = '';
    try { proxy = (typeof PROXY_URL !== 'undefined' && PROXY_URL) || ''; } catch (e) {}
    return { parserUrl: o.parserUrl || '', parserApi: o.parserApi || '', serverUrl: o.serverUrl || '', tmdbProxy: proxy };
  }

  // no-cors: читати відповідь не можна, але видно, чи хост взагалі відповів
  function check(url) {
    var ctl = new AbortController();
    var tm = setTimeout(function () { ctl.abort(); }, 6000);
    return fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
      .then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'таймаут' : 'недоступно' }; })
      .finally(function () { clearTimeout(tm); });
  }

  /* ---------- Налаштування (Онлайн) ---------- */
  // Прапорець лежить у загальному онлайн-конфігу (синхронізується з хмарою).
  // Для старих профілів, де його немає, вважаємо мережу увімкненою, якщо є URL кімнати.
  function isNetworkEnabled() {
    var o = getOnline();
    return o.networkEnabled !== undefined ? !!o.networkEnabled : !!o.roomUrl;
  }

  function syncRoomFields() {
    var inpUrl = document.getElementById('room-url');
    if (!inpUrl) return;
    var o = getOnline();
    inpUrl.value = o.roomUrl || DEFAULT_ROOM_URL;
    var p = document.getElementById('room-parser-url');
    var a = document.getElementById('room-parser-api');
    var s = document.getElementById('room-server-url');
    if (p) p.value = o.parserUrl || '';
    if (a) a.value = o.parserApi || '';
    if (s) s.value = o.serverUrl || '';
    var fields = document.getElementById('online-network-fields');
    if (fields) fields.hidden = !isNetworkEnabled();
  }

  function buildOnlineSettings() {
    var stInp = document.getElementById('streams-enable-toggle');
    var netInp = document.getElementById('network-enable-toggle');
    var inpUrl = document.getElementById('room-url');
    if (!stInp || !netInp || !inpUrl || inpUrl.dataset.bound) return;
    inpUrl.dataset.bound = '1';

    stInp.checked = settings.enableStreams !== false;
    stInp.addEventListener('change', function () {
      settings.enableStreams = !!this.checked;
      localStorage.setItem('mycinema.enableStreams', this.checked ? 'true' : 'false');
      if (typeof cardStack !== 'undefined' && cardStack.length && typeof renderCard === 'function') renderCard(true);
      toast(this.checked ? '▶️ UA KINO увімкнено' : '🙈 UA KINO вимкнено');
    });

    netInp.checked = isNetworkEnabled();
    netInp.addEventListener('change', function () {
      setOnline({ networkEnabled: !!this.checked });
      var fields = document.getElementById('online-network-fields');
      if (fields) fields.hidden = !this.checked;
      if (typeof cardStack !== 'undefined' && cardStack.length && typeof renderCard === 'function') renderCard(true);
      toast(this.checked ? '🌐 Перегляд по мережі увімкнено' : '🙈 Перегляд по мережі вимкнено');
    });

    syncRoomFields();

    var inpP = document.getElementById('room-parser-url');
    var inpA = document.getElementById('room-parser-api');
    var inpS = document.getElementById('room-server-url');
    var st = document.getElementById('room-status');

    document.getElementById('room-save').onclick = function () {
      var raw = inpUrl.value.trim();
      var n = raw ? normalizeUrl(raw) : DEFAULT_ROOM_URL;
      if (!n) { st.textContent = '❌ Некоректний URL кімнати'; return; }
      inpUrl.value = n;
      setOnline({ roomUrl: n, parserUrl: inpP.value.trim(), parserApi: inpA.value.trim(), serverUrl: inpS.value.trim() });
      st.textContent = '✅ Збережено';
    };
    document.getElementById('room-default').onclick = function () {
      inpUrl.value = DEFAULT_ROOM_URL;
      st.textContent = 'Підставлено стандартну адресу — натисніть «Зберегти»';
    };
    document.getElementById('room-check').onclick = function () {
      var raw = inpUrl.value.trim();
      var n = raw ? normalizeUrl(raw) : '';
      if (!n) { st.textContent = 'URL кімнати порожній'; return; }
      inpUrl.value = n;
      st.textContent = 'Перевіряю кімнату...';
      check(n).then(function (r) { st.textContent = r.ok ? '✅ Кімната відповідає' : '⚠️ Не відповідає (' + (r.error || '?') + ')'; });
    };
  }
  function injectSettings() { buildOnlineSettings(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectSettings);
  else injectSettings();

  /* ---------- Оверлей кімнати ---------- */
  var BTN = 'background:transparent;color:inherit;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:6px 12px;font:inherit;cursor:pointer';

  function open(c) {
    var url = getUrl();
    if (!url) { toast('Спершу вкажіть URL кімнати в Налаштуваннях'); return; }
    close();
    var li = null;
    try { if (c && c.key && typeof lib !== 'undefined' && lib) li = lib[c.key] || null; } catch (e) {}
    card = c ? {
      key: c.key || '',
      tmdbId: c.tmdbId != null ? c.tmdbId : (c.id != null ? c.id : ''),
      type: c.type === 'tv' ? 'tv' : 'movie',
      title: c.title || '',
      origTitle: c.origTitle || c.title || '',
      year: c.year || '',
      imdbId: c.imdbId || '',
      season: c.season || '',
      episode: c.episode || '',
      status: (li && li.status) || null,
      watchedEpisodes: (li && Array.isArray(li.watchedEpisodes)) ? li.watchedEpisodes.slice() : []
    } : null;
    roomOrigin = new URL(url).origin;

    overlay = document.createElement('div');
    overlay.id = 'room-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;background:var(--bg-0,#0e0d12);color:var(--text,#e8e6ee);' +
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';

    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex:none';
    var back = document.createElement('button');
    back.textContent = '←'; back.style.cssText = BTN; back.onclick = function () { close(); };
    var ttl = document.createElement('div');
    ttl.textContent = (card && card.title) || 'Кімната';
    ttl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600';
    bar.append(back, ttl);

    var body = document.createElement('div');
    body.style.cssText = 'position:relative;flex:1;min-height:0';
    var msg = document.createElement('div');
    msg.textContent = 'Завантаження…';
    msg.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;opacity:.8;text-align:center;padding:20px';

    frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent';
    frame.setAttribute('allow', 'fullscreen; local-network-access');
    frame.onload = function () { clearTimeout(loadTimer); msg.style.display = 'none'; };
    loadTimer = setTimeout(function () {
      msg.style.display = 'flex';
      msg.textContent = 'Кімната не відповідає.';
      var retry = document.createElement('button');
      retry.textContent = 'Повторити'; retry.style.cssText = BTN;
      retry.onclick = function () { msg.textContent = 'Завантаження…'; frame.src = url; };
      msg.append(retry);
    }, 12000);

    body.append(msg, frame);
    overlay.append(bar, body);
    document.body.append(overlay);
    frame.src = url;

    escHandler = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
  }

  function close() {
    clearTimeout(loadTimer);
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    if (overlay) overlay.remove();
    overlay = null; frame = null; card = null; roomOrigin = null;
  }

  function handleBack() {
    if (overlay) { close(); return true; }
    return false;
  }

  /* ---------- Міст ---------- */
  function post(type, data) {
    if (frame && frame.contentWindow && roomOrigin) {
      frame.contentWindow.postMessage(Object.assign({ mc: 'core', type: type }, data || {}), roomOrigin);
    }
  }

  function extPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ExternalPlayer) || null; } catch (e) { return null; }
  }
  function getPlayers() {
    var P = extPlugin();
    if (!P || typeof P.listPlayers !== 'function') return Promise.resolve([]);
    return P.listPlayers().then(function (r) { return (r && r.players) || []; }).catch(function () { return []; });
  }
  function copyText(t) {
    try {
      if (navigator.clipboard) { navigator.clipboard.writeText(t).catch(function () {}); return true; }
    } catch (e) {}
    return false;
  }
  function playExternal(m) {
    var u = String(m.url || '');
    if (!/^https?:\/\//i.test(u)) return; // лише http(s), нічого іншого від кімнати не приймаємо
    var title = String(m.title || (card && card.title) || '');
    var player = String(m.player || '');
    var P = extPlugin();
    if (P && typeof P.open === 'function') {
      P.open({ url: u, title: title, player: player }).then(function (r) {
        toast(r && r.via === 'chooser' ? '▶️ Вибір плеєра' : '▶️ Відкрито в плеєрі');
      }).catch(function () {
        if (copyText(u)) toast('Плеєр не знайдено — URL скопійовано');
        else toast('Плеєр не знайдено');
      });
      return;
    }
    // У звичайному браузері Capacitor-моста немає — граємо вбудованим плеєром
    // замість того, щоб лише копіювати URL у буфер.
    // У браузері відкриваємо окрему вкладку з плеєром — кімната лишається видною.
    try {
      var page = new URL('player.html?src=' + encodeURIComponent(u) +
        '&title=' + encodeURIComponent(title || 'Кімната'), location.href).href;
      var popup = window.open(page, '_blank');
      if (popup) return;
    } catch (e) {}
    // Якщо браузер заблокував popup — граємо убудованим оверлеєм.
    if (typeof window.mcStreamsOpen === 'function') {
      window.mcStreamsOpen(u, title || 'Кімната');
      return;
    }
    if (copyText(u)) toast('URL потоку скопійовано');
    else toast('Плеєр недоступний');
  }

  function libItem(key) {
    if (!key) return null;
    try { return (typeof lib !== 'undefined' && lib) ? (lib[key] || null) : null; } catch (e) { return null; }
  }

  // Позначка серії переглянутою/непереглянутою (повний список приходить з кімнати)
  function setEpisodeWatched(m, watched) {
    var key = String(m.key || (card && card.key) || '');
    var season = parseInt(m.season, 10), episode = parseInt(m.episode, 10);
    if (!key || !isFinite(season) || !isFinite(episode)) return;
    var item = libItem(key);
    if (!item) {
      item = {
        key: key,
        type: (card && card.type) || 'tv',
        title: (card && card.title) || '',
        status: null,
        watchedEpisodes: []
      };
    }
    var arr;
    if (Array.isArray(m.watchedEpisodes)) {
      arr = m.watchedEpisodes.map(function (x) { return String(x); });
    } else {
      arr = Array.isArray(item.watchedEpisodes) ? item.watchedEpisodes.slice() : [];
      var epKey = season + '-' + episode;
      if (watched) { if (arr.indexOf(epKey) < 0) arr.push(epKey); }
      else { arr = arr.filter(function (k) { return k !== epKey; }); }
    }
    var status = item.status || null;
    if (watched) { if (status !== 'watched') status = 'watching'; }
    else if (arr.length === 0 && status === 'watching') status = 'planned';
    var patch = { watchedEpisodes: arr };
    if (status !== item.status) patch.status = status;
    if (card && card.key === key) {
      card.watchedEpisodes = arr.slice();
      if (status !== item.status) card.status = status;
    }
    if (typeof update === 'function') update(item, patch);
    else if (typeof updateNoRender === 'function') updateNoRender(item, patch);
  }

  window.addEventListener('message', function (e) {
    if (!overlay || !frame || e.source !== frame.contentWindow || e.origin !== roomOrigin) return;
    var m = e.data;
    if (!m || m.mc !== 'room') return;
    if (m.type === 'ready') {
      post('config', { config: serviceConfig() });
      getPlayers().then(function (list) { post('players', { players: list }); });
      post('open', { card: card });
    }
    else if (m.type === 'playExternal') playExternal(m);
    else if (m.type === 'watched') setEpisodeWatched(m, true);
    else if (m.type === 'unwatched') setEpisodeWatched(m, false);
    else if (m.type === 'progress') document.dispatchEvent(new CustomEvent('mcroom', { detail: m }));
    else if (m.type === 'close') close();
  });

  window.mcRoom = {
    open: open, close: close, handleBack: handleBack, enabled: enabled,
    getUrl: getUrl, normalizeUrl: normalizeUrl, check: check,
    isNetworkEnabled: isNetworkEnabled, syncRoomFields: syncRoomFields,
    injectSettings: injectSettings
  };
})();
