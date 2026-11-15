/* Eneyida + UASerials + UACDN provider — IIFE для MyCinema */
(function () {
  'use strict';

  var PROXY_DEFAULT = 'https://mycinema-proxy-base.insaneteresh123.workers.dev';
  function getProxy() {
    try { return localStorage.getItem('mycinema.proxy') || PROXY_DEFAULT; }
    catch (e) { return PROXY_DEFAULT; }
  }
  function px(url, opts) {
    opts = opts || {};
    var parts = ['url=' + encodeURIComponent(url)];
    if (opts.referer) parts.push('referer=' + encodeURIComponent(opts.referer));
    var init = { method: opts.method || 'GET', headers: opts.headers || {} };
    if (opts.body) init.body = opts.body;
    return fetch(getProxy() + '?' + parts.join('&'), init).then(function (r) {
      if (!r.ok) throw new Error('Проксі HTTP ' + r.status);
      return r.text();
    });
  }

  // ─── Quality cache ───
  var qualCache = {};
  function parseMaster(text, baseUrl) {
    var lines = text.split(/\r?\n/);
    var variants = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
      var res = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      var next = (lines[i + 1] || '').trim();
      if (!res || !next || next.indexOf('#') === 0) continue;
      var w = parseInt(res[1], 10), h = parseInt(res[2], 10);
      var label = w >= 3000 ? '4K' : (w >= 1900 ? '1080p' : (h >= 700 ? '720p' : h + 'p'));
      var vurl = next.indexOf('http') === 0 ? next : baseUrl + next.replace(/^\.?\//, '');
      variants.push({ width: w, height: h, label: label, url: vurl });
    }
    variants.sort(function (a, b) { return b.width - a.width; });
    return variants;
  }
  function fetchQualities(m3u8Url) {
    if (qualCache[m3u8Url]) return Promise.resolve(qualCache[m3u8Url]);
    var base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    return fetch(m3u8Url).then(function (r) {
      if (!r.ok) return [];
      return r.text();
    }).then(function (text) {
      var v = parseMaster(text, base);
      qualCache[m3u8Url] = v;
      return v;
    }).catch(function () {
      qualCache[m3u8Url] = [];
      return [];
    });
  }

  // ─── Search ───
  function searchEneyida(query) {
    return px('https://eneyida.tv/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'do=search&subaction=search&story=' + encodeURIComponent(query)
    }).then(function (html) {
      var results = [], seen = {};
      [
        /<a[^>]+class="short_title"[^>]+href="([^"]+)"[^>]*>([^<]*)</gi,
        /<a[^>]+href="([^"]+)"[^>]+class="short_title"[^>]*>([^<]*)</gi
      ].forEach(function (re) {
        var m;
        while ((m = re.exec(html)) !== null) {
          if (!seen[m[1]]) { seen[m[1]] = 1; results.push({ href: m[1], title: m[2].trim(), provider: 'eneyida' }); }
        }
      });
      return results;
    });
  }

  function searchUASerials(query) {
    return px('https://uaserials.my/index.php?do=search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'do=search&subaction=search&story=' + encodeURIComponent(query) + '&search_start=0&full_search=0&result_from=1'
    }).then(function (html) {
      var results = [], seen = {};
      var blocks = html.split('class="short-item');
      for (var i = 1; i < blocks.length; i++) {
        var block = blocks[i];
        var hrefMatch = block.match(/href="((?:https?:\/\/uaserials\.my)?\/\d+-[^"]+\.html)"/);
        if (!hrefMatch) continue;
        var href = hrefMatch[1];
        if (href.indexOf('http') !== 0) href = 'https://uaserials.my' + href;
        if (seen[href]) continue;
        seen[href] = 1;
        var titleMatch = block.match(/class="th-title truncate"[^>]*>([^<]*)</);
        var title = titleMatch ? titleMatch[1].trim() : '';
        if (!title || title.length < 2) {
          var altMatch = block.match(/alt="([^"]+)"/);
          title = altMatch ? altMatch[1].trim() : 'UASerials';
        }
        results.push({ href: href, title: title, provider: 'uaserials' });
      }
      return results;
    });
  }

  // ─── Resolvers ───
  function resolveDetail(url) {
    return px(url).then(function (html) {
      var m = html.match(/class="[^"]*tabs_b[^"]*visible[^"]*"[^>]*>[\s\S]{0,3000}?<iframe[^>]+(?:data-)?src="([^"]+)"/)
        || html.match(/<iframe[^>]+(?:data-)?src="(https?:\/\/[^"]*hdvbua[^"]+)"/)
        || html.match(/<iframe[^>]+(?:data-)?src="(https?:\/\/[^"]+)"/);
      if (!m) throw new Error('Player iframe не знайдено');
      var u = m[1];
      if (u.indexOf('//') === 0) u = 'https:' + u;
      return u;
    });
  }
  function fetchEmbedJson(embedUrl) {
    return px(embedUrl, { referer: 'https://eneyida.tv/' }).then(function (html) {
      var m = html.match(/file\s*:\s*'([^']+)'/) || html.match(/file\s*:\s*"([^"]+)"/);
      if (!m) throw new Error('Поле "file" відсутнє');
      var raw = m[1];
      if (raw.indexOf('http') === 0) return [{ title: 'HD', file: raw }];
      try { return JSON.parse(raw); }
      catch (e) { throw new Error('JSON parse: ' + e.message); }
    });
  }
  function resolveUASerialsDetail(url) {
    return px(url).then(function (html) {
      var m = html.match(/<iframe[^>]+(?:data-)?src="([^"]+)"/);
      if (!m) throw new Error('UASerials: iframe не знайдено');
      var u = m[1];
      if (u.indexOf('//') === 0) u = 'https:' + u;
      return u;
    });
  }
  function fetchUASerialsEmbed(embedUrl) {
    return px(embedUrl, { referer: 'https://uaserials.my/' }).then(function (html) {
      var m = html.match(/file\s*:\s*'([^']+)'/) || html.match(/file\s*:\s*"([^"]+)"/);
      if (!m) throw new Error('UASerials: поле "file" відсутнє');
      var raw = m[1];
      if (raw.indexOf('http') === 0) return [{ title: 'HD', file: raw }];
      try { return JSON.parse(raw); }
      catch (e) { throw new Error('UASerials JSON parse: ' + e.message); }
    });
  }

  function flatten(tree, path) {
    path = path || {};
    var out = [];
    if (!Array.isArray(tree)) tree = [tree];
    tree.forEach(function (n) {
      var t = n.title || '';
      var np = {
        season: /сезон/i.test(t) ? t : path.season,
        translation: t && !/сезон|серія|серия/i.test(t) ? t : path.translation,
        episode: /серія|серия/i.test(t) ? t : path.episode
      };
      if (n.file) out.push({
        season: np.season || '', translation: np.translation || '', episode: np.episode || '',
        url: n.file, subtitle: n.subtitle || ''
      });
      if (n.folder) out = out.concat(flatten(n.folder, np));
    });
    return out;
  }

  // ─── UI helpers ───
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function closeModal() {
    var el = document.getElementById('streams-overlay');
    if (el) el.remove();
    var v = document.getElementById('streams-video');
    if (v) { var vid = v.querySelector('video'); if (vid) vid.pause(); v.remove(); }
  }
  function showModal(inner) {
    closeModal();
    var ov = document.createElement('div');
    ov.id = 'streams-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML = '<style>' +
      '.streams-back-btn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:#ffb86c;font-size:12px;cursor:pointer;padding:6px 12px;margin:0 0 10px 6px;font-family:inherit;border-radius:6px;transition:background 0.15s;display:inline-block;}' +
      '.streams-back-btn:hover{background:rgba(255,255,255,0.1);}' +
    '</style>' +
    '<div style="background:#16141b;border-radius:16px;max-width:640px;width:100%;max-height:80vh;display:flex;flex-direction:column;color:#f2eee9;font-family:system-ui,sans-serif;border:1px solid rgba(255,255,255,0.08);">' +
      '<div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;">' +
        '<b style="font-size:15px;font-weight:600;">Джерело UA</b>' +
        '<button data-act="close" style="background:none;border:0;color:#cfc8c0;font-size:20px;cursor:pointer;">✕</button>' +
      '</div>' +
      '<div id="streams-body" style="padding:16px 20px;overflow-y:auto;">' + inner + '</div>' +
    '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    var cb = ov.querySelector('button[data-act="close"]');
    if (cb) cb.addEventListener('click', closeModal);
    var ek = function (e) { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', ek); } };
    document.addEventListener('keydown', ek);
  }
  function status(t) { return '<div style="text-align:center;color:#8d877f;padding:24px;font-size:14px;">' + esc(t) + '</div>'; }
  function errStatus(t) { return '<div style="color:#ff5c5c;padding:24px;text-align:center;font-size:14px;line-height:1.5;">' + esc(t) + '</div>'; }
  function backBtnHtml(text) {
    return '<button class="streams-back-btn" data-role="back">' + esc(text) + '</button>';
  }
  function bindBack(callback) {
    var b = document.querySelector('#streams-body [data-role="back"]');
    if (b) b.addEventListener('click', callback);
  }
  function renderList(items) {
    var html = '<div style="display:flex;flex-direction:column;gap:6px;">';
    items.forEach(function (it, i) {
      html += '<button data-idx="' + i + '" style="background:#201d28;color:#f2eee9;border:1px solid rgba(255,255,255,0.05);padding:10px 14px;border-radius:8px;text-align:left;cursor:pointer;font-size:13px;font-family:inherit;line-height:1.35;display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
        '<span>' + esc(it.label) + '</span>' +
        '<span data-qual="' + i + '" style="color:#ffb86c;font-size:11px;font-weight:600;flex-shrink:0;"></span>' +
      '</button>';
    });
    html += '</div>';
    return html;
  }
  function bindList(handler) {
    var body = document.getElementById('streams-body');
    if (!body) return;
    body.querySelectorAll('button[data-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () { handler(parseInt(btn.getAttribute('data-idx'), 10)); });
    });
  }

  // ─── hls.js loader ───
  var hlsLoading = null;
  function ensureHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
      s.onload = function () { resolve(window.Hls); };
      s.onerror = function () { hlsLoading = null; reject(new Error('Не вдалось завантажити hls.js')); };
      document.head.appendChild(s);
    });
    return hlsLoading;
  }

  function openVideo(url, subtitle) {
    var ov = document.createElement('div');
    ov.id = 'streams-video';
    ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;height:100dvh;width:100vw;background:#000;z-index:10000;display:flex;flex-direction:column;overflow:hidden;';

    var bar = document.createElement('div');
    bar.style.cssText = 'padding:calc(8px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) 8px calc(14px + env(safe-area-inset-left));background:#0f0e13;display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.title = 'До картки';
    backBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    backBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:0;color:#fff;width:36px;height:36px;border-radius:8px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
    backBtn.addEventListener('click', function () {
      if (video) video.pause();
      if (hlsInstance) { try { hlsInstance.destroy(); } catch (e) {} }
      ov.remove();
    });
    bar.appendChild(backBtn);

    var cb = document.createElement('button');
    cb.type = 'button'; cb.textContent = '✕';
    cb.style.cssText = 'background:rgba(255,255,255,0.08);border:0;color:#fff;width:36px;height:36px;border-radius:8px;font-size:16px;cursor:pointer;flex-shrink:0;';
    bar.appendChild(cb);

    var videoWrap = document.createElement('div');
    videoWrap.style.cssText = 'flex:1;position:relative;min-height:0;min-width:0;background:#000;overflow:hidden;';

    var video = document.createElement('video');
    video.controls = true; video.autoplay = true; video.playsInline = true;
    video.setAttribute('playsinline', ''); video.setAttribute('crossorigin', 'anonymous');
    video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000;object-fit:contain;';

    if (subtitle) {
      var sm = subtitle.match(/https?:\/\/\S+\.(vtt|srt)/);
      if (sm) {
        var tr = document.createElement('track');
        tr.kind = 'subtitles'; tr.label = 'Українські'; tr.srclang = 'uk'; tr.src = sm[0]; tr.default = true;
        video.appendChild(tr);
      }
    }

    videoWrap.appendChild(video);
    ov.appendChild(bar); ov.appendChild(videoWrap);
    document.body.appendChild(ov);

    var isHls = /\.m3u8(\?|$)/i.test(url);
    var hlsInstance = null;

    cb.addEventListener('click', function () {
      if (video) video.pause();
      if (hlsInstance) { try { hlsInstance.destroy(); } catch (e) {} }
      closeModal();
    });

    if (isHls) {
      var canNative = video.canPlayType('application/vnd.apple.mpegurl');
      if (canNative) {
        video.src = url;
      } else {
        ensureHls().then(function (Hls) {
          if (Hls && Hls.isSupported()) {
            hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: false });
            hlsInstance.loadSource(url);
            hlsInstance.attachMedia(video);
            hlsInstance.on(Hls.Events.ERROR, function (evt, data) {
              if (data.fatal) console.error('HLS fatal:', data.type, data.details);
            });
          } else {
            video.src = url;
          }
        }).catch(function () { video.src = url; });
      }
    } else {
      video.src = url;
    }

    var ek = function (e) {
      if (e.key === 'Escape') {
        video.pause();
        if (hlsInstance) { try { hlsInstance.destroy(); } catch (err) {} }
        ov.remove();
        document.removeEventListener('keydown', ek);
      }
    };
    document.addEventListener('keydown', ek);
  }

  function openIframeOverlay(url, title) {
    var ov = document.createElement('div');
    ov.id = 'streams-video';
    ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;height:100dvh;width:100vw;background:#000;z-index:10000;display:flex;flex-direction:column;overflow:hidden;';

    var bar = document.createElement('div');
    bar.style.cssText = 'padding:calc(8px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) 8px calc(14px + env(safe-area-inset-left));background:#0f0e13;display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.title = 'До картки';
    backBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    backBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:0;color:#fff;width:36px;height:36px;border-radius:8px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
    backBtn.addEventListener('click', function () { ov.remove(); });
    bar.appendChild(backBtn);

    var titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'color:#cfc8c0;font-size:13px;font-family:system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;text-align:center;';
    titleSpan.textContent = title || 'UACDN';
    bar.appendChild(titleSpan);

    var cb = document.createElement('button');
    cb.type = 'button'; cb.textContent = '✕';
    cb.style.cssText = 'background:rgba(255,255,255,0.08);border:0;color:#fff;width:36px;height:36px;border-radius:8px;font-size:16px;cursor:pointer;flex-shrink:0;';
    cb.addEventListener('click', function () { ov.remove(); closeModal(); });
    bar.appendChild(cb);

    var iframeWrap = document.createElement('div');
    iframeWrap.style.cssText = 'flex:1;position:relative;min-height:0;min-width:0;background:#000;overflow:hidden;';

    var iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0;background:#000;';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');

    iframeWrap.appendChild(iframe);
    ov.appendChild(bar);
    ov.appendChild(iframeWrap);
    document.body.appendChild(ov);

    var ek = function (e) { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', ek); } };
    document.addEventListener('keydown', ek);
  }

  // ═══════════════════════════════════════════
  //  ЕКРАН 1: Вибір балансера
  // ═══════════════════════════════════════════
  function showProviderList(providers, title) {
    var body = document.getElementById('streams-body');
    var items = providers.map(function (p) {
      return { label: p.label + ' · ' + p.count, provider: p.id };
    });
    body.innerHTML =
      '<div style="margin-bottom:10px;color:#8d877f;font-size:12px;">Обери балансер:</div>' +
      renderList(items);

    bindList(function (idx) {
      var picked = providers[idx];
      if (picked.id === 'uacdn') {
        openIframeOverlay(picked.url, title);
        return;
      }
      if (picked.results.length === 1) {
        loadAndShowPlayer(picked.results[0], picked.provider, function () {
          showProviderList(providers, title);
        });
      } else {
        showTitleList(picked, function () {
          showProviderList(providers, title);
        });
      }
    });
  }

  // ═══════════════════════════════════════════
  //  ЕКРАН 2: Вибір тайтлу
  // ═══════════════════════════════════════════
  function showTitleList(provider, onBack) {
    var body = document.getElementById('streams-body');
    var items = provider.results.map(function (r) {
      return { label: r.title, href: r.href, provider: r.provider };
    });
    body.innerHTML =
      backBtnHtml('← Назад до балансерів') +
      '<div style="margin-bottom:10px;color:#8d877f;font-size:12px;">' + esc(provider.label) + ' · ' + provider.results.length + ' результатів:</div>' +
      renderList(items);

    bindBack(onBack);

    bindList(function (idx) {
      loadAndShowPlayer(provider.results[idx], provider.provider, function () {
        showTitleList(provider, onBack);
      });
    });
  }

  // ─── Завантажити деталі й показати плеєр ───
  function loadAndShowPlayer(picked, providerId, onBack) {
    var body = document.getElementById('streams-body');
    body.innerHTML = status('Завантаження «' + picked.label + '»…');

    var detailUrl = picked.href;
    var resolveP, fetchP;

    if (providerId === 'uaserials') {
      if (detailUrl.indexOf('http') !== 0) detailUrl = 'https://uaserials.my' + detailUrl;
      resolveP = resolveUASerialsDetail(detailUrl);
      fetchP = fetchUASerialsEmbed;
    } else {
      if (detailUrl.indexOf('http') !== 0) detailUrl = 'https://eneyida.tv' + detailUrl;
      resolveP = resolveDetail(detailUrl);
      fetchP = fetchEmbedJson;
    }

    resolveP.then(function (embedUrl) {
      body.innerHTML = status('Парсинг плеєра…');
      return fetchP(embedUrl);
    }).then(function (tree) {
      var flat = flatten(tree);
      if (!flat.length) throw new Error('Немає доступних джерел');
      showPlayerScreen(flat, picked.label, onBack);
    }).catch(function (e) {
      body.innerHTML = backBtnHtml('← Назад') + errStatus('Помилка: ' + e.message);
      bindBack(onBack);
    });
  }

  // ═══════════════════════════════════════════
  //  ЕКРАН 3: Інтерактивний плеєр
  // ═══════════════════════════════════════════
  function showPlayerScreen(rawItems, label, onBack) {
    var body = document.getElementById('streams-body');

    var hasSeasons = rawItems.some(function (x) { return x.season; });

    var translations = [];
    var seenT = {};
    rawItems.forEach(function (x) {
      var t = x.translation || 'За замовчуванням';
      if (!seenT[t]) { seenT[t] = 1; translations.push(t); }
    });

    var state = {
      translation: translations[0] || '',
      season: null,
      quality: ''
    };

    function filterByTranslation() {
      return rawItems.filter(function (x) {
        var t = x.translation || 'За замовчуванням';
        return t === state.translation;
      });
    }
    function getSeasons(items) {
      var seasons = [], seen = {};
      items.forEach(function (x) {
        var s = x.season || '';
        if (s && !seen[s]) { seen[s] = 1; seasons.push(s); }
      });
      return seasons;
    }

    function playWithQuality(url, subtitle) {
      fetchQualities(url).then(function (vars) {
        var chosen = null;
        if (state.quality && vars.length > 0) {
          for (var i = 0; i < vars.length; i++) {
            if (vars[i].label === state.quality) { chosen = vars[i]; break; }
          }
        }
        if (!chosen && vars.length > 0) chosen = vars[0];
        if (chosen) openVideo(chosen.url, subtitle);
        else openVideo(url, subtitle);
      });
    }

    function render() {
      var items = filterByTranslation();
      var seasons = getSeasons(items);
      if (seasons.length > 0 && (!state.season || seasons.indexOf(state.season) < 0)) {
        state.season = seasons[0];
      }

      var html = backBtnHtml('← Назад');
      var showT = translations.length > 1;
      var showS = hasSeasons && seasons.length > 1;

      html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">';
      if (showT) {
        html += '<select data-role="translation" style="flex:1;min-width:120px;background:#201d28;color:#f2eee9;border:1px solid rgba(255,255,255,0.1);padding:8px 12px;border-radius:8px;font-size:13px;font-family:inherit;cursor:pointer;">';
        translations.forEach(function (t) {
          html += '<option value="' + esc(t) + '"' + (t === state.translation ? ' selected' : '') + '>' + esc(t) + '</option>';
        });
        html += '</select>';
      }
      if (showS) {
        html += '<select data-role="season" style="flex:1;min-width:120px;background:#201d28;color:#f2eee9;border:1px solid rgba(255,255,255,0.1);padding:8px 12px;border-radius:8px;font-size:13px;font-family:inherit;cursor:pointer;">';
        seasons.forEach(function (s) {
          html += '<option value="' + esc(s) + '"' + (s === state.season ? ' selected' : '') + '>' + esc(s) + '</option>';
        });
        html += '</select>';
      }
      html += '<select data-role="quality" style="flex:1;min-width:120px;background:#201d28;color:#f2eee9;border:1px solid rgba(255,255,255,0.1);padding:8px 12px;border-radius:8px;font-size:13px;font-family:inherit;cursor:pointer;">';
      html += '<option value="">Якість: …</option>';
      html += '</select>';
      html += '</div>';

      if (!hasSeasons) {
        var item = items[0];
        if (!item) {
          body.innerHTML = html + errStatus('Немає джерел для цієї озвучки');
          bindAll();
          return;
        }
        html += '<button data-role="play" style="width:100%;padding:16px;background:linear-gradient(135deg,#ffb86c,#ffc98a);color:#1a1207;border:0;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;">▶ Грати</button>';
        body.innerHTML = html;
        bindAll();
        body.querySelector('[data-role="play"]').addEventListener('click', function () {
          playWithQuality(item.url, item.subtitle);
        });
      } else {
        var episodes = items.filter(function (x) { return (x.season || '') === state.season; });
        if (episodes.length === 0) {
          body.innerHTML = html + errStatus('Немає серій для цього сезону');
          bindAll();
          return;
        }
        if (episodes.length === 1) {
          html += '<button data-role="play" style="width:100%;padding:16px;background:linear-gradient(135deg,#ffb86c,#ffc98a);color:#1a1207;border:0;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;">▶ ' + esc(episodes[0].episode || 'Грати') + '</button>';
          body.innerHTML = html;
          bindAll();
          body.querySelector('[data-role="play"]').addEventListener('click', function () {
            playWithQuality(episodes[0].url, episodes[0].subtitle);
          });
        } else {
          html += '<div style="display:flex;flex-direction:column;gap:6px;">';
          episodes.forEach(function (ep, i) {
            var lbl = ep.episode || ('Серія ' + (i + 1));
            html += '<button data-ep="' + i + '" style="background:#201d28;color:#f2eee9;border:1px solid rgba(255,255,255,0.05);padding:10px 14px;border-radius:8px;text-align:left;cursor:pointer;font-size:13px;font-family:inherit;line-height:1.35;display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
              '<span>' + esc(lbl) + '</span>' +
              '<span data-qual="' + i + '" style="color:#ffb86c;font-size:11px;font-weight:600;flex-shrink:0;"></span>' +
            '</button>';
          });
          html += '</div>';
          body.innerHTML = html;
          bindAll();
          body.querySelectorAll('[data-ep]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var idx = parseInt(this.getAttribute('data-ep'), 10);
              playWithQuality(episodes[idx].url, episodes[idx].subtitle);
            });
          });
        }
      }

      var viewItems = hasSeasons
        ? items.filter(function (x) { return (x.season || '') === state.season; })
        : items;

      Promise.all(viewItems.map(function (ep) {
        return fetchQualities(ep.url).catch(function () { return []; });
      })).then(function (allQuals) {
        var qualitySet = {};
        allQuals.forEach(function (vars) {
          vars.forEach(function (v) {
            if (v.label && v.label !== 'DIRECT') qualitySet[v.label] = v;
          });
        });
        var qualityLabels = Object.keys(qualitySet).sort(function (a, b) {
          return qualitySet[b].width - qualitySet[a].width;
        });
        if (state.quality && qualityLabels.indexOf(state.quality) < 0) {
          state.quality = '';
        }
        var qSel = body.querySelector('[data-role="quality"]');
        if (qSel) {
          qSel.innerHTML = '<option value="">Якість: Найкраща</option>';
          qualityLabels.forEach(function (q) {
            var opt = document.createElement('option');
            opt.value = q;
            opt.textContent = q;
            if (q === state.quality) opt.selected = true;
            qSel.appendChild(opt);
          });
          qSel.onchange = function () { state.quality = this.value; };
        }
        if (hasSeasons) {
          viewItems.forEach(function (ep, i) {
            fetchQualities(ep.url).then(function (vars) {
              if (vars.length) {
                var badge = body.querySelector('[data-qual="' + i + '"]');
                if (badge) badge.textContent = vars[0].label;
              }
            }).catch(function () {});
          });
        }
      });
    }

    function bindAll() {
      bindBack(onBack);
      var tSel = body.querySelector('[data-role="translation"]');
      if (tSel) tSel.addEventListener('change', function () { state.translation = this.value; state.season = null; render(); });
      var sSel = body.querySelector('[data-role="season"]');
      if (sSel) sSel.addEventListener('change', function () { state.season = this.value; render(); });
    }

    render();
  }

  // ═══════════════════════════════════════════
  //  Main: пошук + збір провайдерів
  // ═══════════════════════════════════════════
  function openStreamPicker(title, year, type, imdbId) {
    var q = String(title || '').trim();
    showModal(status('Пошук «' + q + '»…'));
    if (!q) { document.getElementById('streams-body').innerHTML = errStatus('Порожня назва'); return; }

    var uacdnP = imdbId
      ? fetch('https://franko.uacdn.online/show/imdb/' + imdbId, { method: 'HEAD' })
          .then(function (r) { return r.ok ? 'https://franko.uacdn.online/show/imdb/' + imdbId : null; })
          .catch(function () { return null; })
      : Promise.resolve(null);

    Promise.allSettled([
      uacdnP,
      searchEneyida(q).catch(function () { return []; }),
      searchUASerials(q).catch(function () { return []; })
    ]).then(function (results) {
      var uacdnUrl = results[0].status === 'fulfilled' ? results[0].value : null;
      var eneyida = results[1].status === 'fulfilled' ? results[1].value : [];
      var uas = results[2].status === 'fulfilled' ? results[2].value : [];

      var providers = [];
      if (uacdnUrl) providers.push({ id: 'uacdn', label: 'UACDN (Iframe)', count: 'доступно', url: uacdnUrl });
      if (eneyida.length) providers.push({ id: 'eneyida', label: 'Eneyida', count: eneyida.length + ' шт', provider: 'eneyida', results: eneyida });
      if (uas.length) providers.push({ id: 'uaserials', label: 'UASerials', count: uas.length + ' шт', provider: 'uaserials', results: uas });

      if (!providers.length) throw new Error('Нічого не знайдено');

      if (providers.length === 1 && providers[0].id === 'uacdn') {
        openIframeOverlay(providers[0].url, title);
        return;
      }

      showProviderList(providers, title);
    }).catch(function (e) {
      document.getElementById('streams-body').innerHTML = errStatus('Помилка: ' + e.message);
    });
  }

  window.openStreamPicker = openStreamPicker;
  window.closeStreamPicker = closeModal;
})();
