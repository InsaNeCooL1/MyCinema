/* Eneyida + UASerials + UACDN provider — Unified Search & Themed UI */
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function normStr(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[’ʼ'`"«»“”]/g, '')
      .replace(/[:;,.!?()[\]{}—–\-/\\]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractSnippetMeta(snippet) {
    var clean = String(snippet || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    var ym = clean.match(/\b(19\d{2}|20[0-3]\d)\b/);
    var isTvHint = null;
    if (/(сезон|серіал|мультсеріал|серія|\bseries\b|\/serial)/i.test(clean)) isTvHint = true;
    else if (/(фільм|повнометраж)/i.test(clean)) isTvHint = false;
    return { year: ym ? ym[1] : '', isTvHint: isTvHint };
  }

  function scoreCandidate(cand, title, origTitle, year, type) {
    var ct = normStr(cand.title);
    var nt = normStr(title);
    var no = normStr(origTitle);
    var score = 0;

    function titleMatchScore(target) {
      if (!target || !ct) return 0;
      if (ct === target) return 60;
      if (ct.indexOf(target) === 0 || target.indexOf(ct) === 0) return 46;
      if (ct.indexOf(target) !== -1 || target.indexOf(ct) !== -1) return 34;
      var tw = target.split(' ').filter(function (w) { return w.length >= 2; });
      var cw = ct.split(' ').filter(function (w) { return w.length >= 2; });
      if (!tw.length || !cw.length) return 0;
      var hits = 0;
      tw.forEach(function (w) { if (cw.indexOf(w) !== -1) hits++; });
      return Math.round((hits / Math.max(tw.length, cw.length)) * 32);
    }

    score += Math.max(titleMatchScore(nt), titleMatchScore(no));

    var yTarget = parseInt(year, 10) || 0;
    var yCand = parseInt(cand.year, 10) || 0;
    if (yTarget && yCand) {
      var diff = Math.abs(yTarget - yCand);
      if (diff === 0) score += 30;
      else if (diff === 1) score += 12;
      else score -= 25;
    }

    if (cand.isTvHint !== null && type) {
      var wantTv = (type === 'tv');
      if (cand.isTvHint === wantTv) score += 10;
      else score -= 18;
    }

    if (cand.provider === 'uaserials' && type === 'tv') score += 4;
    if (cand.provider === 'eneyida' && type === 'movie') score += 3;
    return score;
  }

  // ─── Quality cache & detail cache ───
  var qualCache = {};
  var detailCache = {};

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

  // ─── Search providers ───
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
          var href = m[1];
          if (href.indexOf('http') !== 0) href = 'https://eneyida.tv' + (href.charAt(0) === '/' ? '' : '/') + href;
          if (seen[href]) continue;
          seen[href] = 1;
          var win = html.slice(Math.max(0, m.index - 350), Math.min(html.length, m.index + 650));
          var meta = extractSnippetMeta(win + ' ' + href);
          results.push({
            href: href,
            title: m[2].trim(),
            year: meta.year,
            isTvHint: meta.isTvHint,
            provider: 'eneyida'
          });
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
        var meta = extractSnippetMeta(block);
        results.push({
          href: href,
          title: title,
          year: meta.year,
          isTvHint: meta.isTvHint !== null ? meta.isTvHint : true,
          provider: 'uaserials'
        });
      }
      return results;
    });
  }

  function searchProviderSmart(searchFn, title, origTitle, year, type) {
    var q1 = String(title || '').replace(/[«»"“”]/g, '').trim();
    var q2 = String(origTitle || '').replace(/[«»"“”]/g, '').trim();
    return searchFn(q1).catch(function () { return []; }).then(function (res1) {
      var scored1 = res1.map(function (c) {
        c.score = scoreCandidate(c, title, origTitle, year, type);
        return c;
      }).sort(function (a, b) { return b.score - a.score; });

      var bestScore = scored1.length ? scored1[0].score : -1;
      var needOrig = q2 && normStr(q2) !== normStr(q1) && (!scored1.length || bestScore < 65);
      if (!needOrig) return scored1;

      return searchFn(q2).catch(function () { return []; }).then(function (res2) {
        var byHref = {};
        scored1.forEach(function (c) { byHref[c.href] = c; });
        res2.forEach(function (c) {
          if (!byHref[c.href]) {
            c.score = scoreCandidate(c, title, origTitle, year, type);
            byHref[c.href] = c;
          }
        });
        return Object.keys(byHref).map(function (k) { return byHref[k]; })
          .sort(function (a, b) { return b.score - a.score; });
      });
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

  function loadFlatForResult(cand) {
    if (detailCache[cand.href]) return Promise.resolve(detailCache[cand.href]);
    var resolveP = cand.provider === 'uaserials'
      ? resolveUASerialsDetail(cand.href).then(fetchUASerialsEmbed)
      : resolveDetail(cand.href).then(fetchEmbedJson);
    return resolveP.then(function (tree) {
      var flat = flatten(tree);
      if (!flat.length) throw new Error('Немає доступних джерел');
      detailCache[cand.href] = flat;
      return flat;
    });
  }

  // ─── Fullscreen & Back helpers ───
  function setNativeFullscreen(enabled) {
    document.body.classList.toggle('mc-fs', !!enabled);
    try {
      var ep = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ExternalPlayer;
      if (ep && typeof ep.setFullscreen === 'function') ep.setFullscreen({ enabled: !!enabled }).catch(function () {});
    } catch (e) {}
    try {
      if (enabled && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
      else if (!enabled && screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (e) {}
  }

  function toggleElementFullscreen(targetEl) {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      setNativeFullscreen(false);
    } else if (targetEl) {
      var req = targetEl.requestFullscreen || targetEl.webkitRequestFullscreen;
      if (req) {
        Promise.resolve(req.call(targetEl)).then(function () { setNativeFullscreen(true); }).catch(function () { setNativeFullscreen(true); });
      } else {
        setNativeFullscreen(true);
      }
    }
  }

  function syncFsBar() {
    var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    var vidOv = document.getElementById('streams-video');
    if (vidOv) {
      var bar = vidOv.querySelector('[data-role="video-bar"]');
      if (bar) bar.style.display = isFs ? 'none' : 'flex';
    }
    setNativeFullscreen(isFs);
  }
  document.addEventListener('fullscreenchange', syncFsBar);
  document.addEventListener('webkitfullscreenchange', syncFsBar);

  function closeVideoOverlay() {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      try { if (document.exitFullscreen) document.exitFullscreen().catch(function () {}); } catch (e) {}
    }
    setNativeFullscreen(false);
    var v = document.getElementById('streams-video');
    if (v) {
      var vid = v.querySelector('video');
      if (vid) vid.pause();
      if (v._hls) { try { v._hls.destroy(); } catch (e) {} }
      v.remove();
    }
  }

  var _streamsHistoryActive = false;
  function ensureStreamsHistoryGuard() {
    var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative || _streamsHistoryActive) return;
    _streamsHistoryActive = true;
    var curMc = (history.state && history.state.mc) || 0;
    history.pushState({ mc: curMc, mcStreams: 1 }, '', location.href);
  }

  function closeModal(fromPopstate) {
    closeVideoOverlay();
    var el = document.getElementById('streams-overlay');
    if (el) el.remove();
    document.documentElement.classList.remove('streams-lock');
    document.body.classList.remove('streams-lock');
    if (!fromPopstate && _streamsHistoryActive) {
      _streamsHistoryActive = false;
      try { history.back(); } catch (e) {}
    } else if (fromPopstate) {
      _streamsHistoryActive = false;
    }
  }

  function handleStreamsBack() {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    var v = document.getElementById('streams-video');
    if (fsEl) {
      try { if (document.exitFullscreen) document.exitFullscreen().catch(function () {}); } catch (e) {}
      setNativeFullscreen(false);
      return true;
    }
    if (v) {
      closeVideoOverlay();
      return true;
    }
    var ov = document.getElementById('streams-overlay');
    if (ov) {
      var matchesOpen = ov.querySelector('.streams-matches-list');
      if (matchesOpen && matchesOpen.style.display !== 'none') {
        matchesOpen.style.display = 'none';
        return true;
      }
      closeModal(false);
      return true;
    }
    return false;
  }
  window.handleStreamsBack = handleStreamsBack;

  window.addEventListener('popstate', function () {
    var v = document.getElementById('streams-video');
    var ov = document.getElementById('streams-overlay');
    if (!v && !ov) { _streamsHistoryActive = false; return; }
    if (v) {
      closeVideoOverlay();
      var curMc = (history.state && history.state.mc) || 0;
      history.pushState({ mc: curMc, mcStreams: 1 }, '', location.href);
      return;
    }
    closeModal(true);
  });

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
    closeVideoOverlay();
    var ov = document.createElement('div');
    ov.id = 'streams-video';
    ov.style.cssText = 'position:fixed;inset:0;height:100dvh;width:100vw;background:#000;z-index:10000;display:flex;flex-direction:column;overflow:hidden;';

    var bar = document.createElement('div');
    bar.setAttribute('data-role', 'video-bar');
    bar.style.cssText = 'padding:calc(8px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) 8px calc(14px + env(safe-area-inset-left));background:var(--bg-1);display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.title = 'До списку';
    backBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    backBtn.style.cssText = 'background:var(--bg-2);border:1px solid rgba(255,255,255,0.08);color:var(--text);width:36px;height:36px;border-radius:8px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
    backBtn.addEventListener('click', closeVideoOverlay);
    bar.appendChild(backBtn);

    var rightBtns = document.createElement('div');
    rightBtns.style.cssText = 'display:flex;gap:8px;align-items:center;margin-left:auto;';

    var fsBtn = document.createElement('button');
    fsBtn.type = 'button'; fsBtn.title = 'На весь екран';
    fsBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    fsBtn.style.cssText = 'background:var(--bg-2);border:1px solid rgba(255,255,255,0.08);color:var(--text);width:36px;height:36px;border-radius:8px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
    fsBtn.addEventListener('click', function () { toggleElementFullscreen(ov); });
    rightBtns.appendChild(fsBtn);

    var cb = document.createElement('button');
    cb.type = 'button'; cb.textContent = '✕';
    cb.style.cssText = 'background:var(--bg-2);border:1px solid rgba(255,255,255,0.08);color:var(--text);width:36px;height:36px;border-radius:8px;font-size:16px;cursor:pointer;flex-shrink:0;';
    cb.addEventListener('click', function () { closeModal(false); });
    rightBtns.appendChild(cb);
    bar.appendChild(rightBtns);

    var videoWrap = document.createElement('div');
    videoWrap.style.cssText = 'flex:1;position:relative;min-height:0;min-width:0;background:#000;overflow:hidden;';

    var video = document.createElement('video');
    video.controls = true; video.autoplay = true; video.playsInline = true;
    video.setAttribute('playsinline', ''); video.setAttribute('crossorigin', 'anonymous');
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#000;object-fit:contain;';

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

    video.addEventListener('webkitbeginfullscreen', function () { setNativeFullscreen(true); });
    video.addEventListener('webkitendfullscreen', function () { setNativeFullscreen(false); });

    var isHls = /\.m3u8(\?|$)/i.test(url);
    if (isHls) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else {
        ensureHls().then(function (Hls) {
          if (Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            ov._hls = hls;
            hls.loadSource(url);
            hls.attachMedia(video);
          } else {
            video.src = url;
          }
        }).catch(function () { video.src = url; });
      }
    } else {
      video.src = url;
    }
  }

  function openIframeOverlay(url, title) {
    closeVideoOverlay();
    ensureStreamsHistoryGuard();
    var ov = document.createElement('div');
    ov.id = 'streams-video';
    ov.style.cssText = 'position:fixed;inset:0;height:100dvh;width:100vw;background:#000;z-index:10000;display:flex;flex-direction:column;overflow:hidden;';

    var bar = document.createElement('div');
    bar.setAttribute('data-role', 'video-bar');
    bar.style.cssText = 'padding:calc(8px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) 8px calc(14px + env(safe-area-inset-left));background:var(--bg-1);display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.title = 'До списку';
    backBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    backBtn.style.cssText = 'background:var(--bg-2);border:1px solid rgba(255,255,255,0.08);color:var(--text);width:36px;height:36px;border-radius:8px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
    backBtn.addEventListener('click', closeVideoOverlay);
    bar.appendChild(backBtn);

    var titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'color:var(--text-secondary);font-size:13px;font-family:var(--sans);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;text-align:center;';
    titleSpan.textContent = title || 'UACDN';
    bar.appendChild(titleSpan);

    var fsBtn = document.createElement('button');
    fsBtn.type = 'button'; fsBtn.title = 'На весь екран';
    fsBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    fsBtn.style.cssText = 'background:var(--bg-2);border:1px solid rgba(255,255,255,0.08);color:var(--text);width:36px;height:36px;border-radius:8px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
    fsBtn.addEventListener('click', function () { toggleElementFullscreen(ov); });
    bar.appendChild(fsBtn);

    var cb = document.createElement('button');
    cb.type = 'button'; cb.textContent = '✕';
    cb.style.cssText = 'background:var(--bg-2);border:1px solid rgba(255,255,255,0.08);color:var(--text);width:36px;height:36px;border-radius:8px;font-size:16px;cursor:pointer;flex-shrink:0;';
    cb.addEventListener('click', function () { closeModal(false); });
    bar.appendChild(cb);

    var iframeWrap = document.createElement('div');
    iframeWrap.style.cssText = 'flex:1;position:relative;min-height:0;min-width:0;background:#000;overflow:hidden;';

    var iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');

    iframeWrap.appendChild(iframe);
    ov.appendChild(bar);
    ov.appendChild(iframeWrap);
    document.body.appendChild(ov);
  }

  // ─── Unified Themed Modal ───
  function createShell(headerText) {
    closeModal(false);
    ensureStreamsHistoryGuard();
    document.documentElement.classList.add('streams-lock');
    document.body.classList.add('streams-lock');

    var ov = document.createElement('div');
    ov.id = 'streams-overlay';
    ov.innerHTML =
      '<div class="streams-modal">' +
        '<div class="streams-head">' +
          '<div class="streams-head-title">' + esc(headerText) + '</div>' +
          '<button type="button" class="streams-close-btn" data-act="close" aria-label="Закрити">✕</button>' +
        '</div>' +
        '<div class="streams-providers" id="streams-providers" style="display:none;"></div>' +
        '<div id="streams-body"><div class="streams-status">Пошук…</div></div>' +
      '</div>';

    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(false); });
    ov.querySelector('[data-act="close"]').addEventListener('click', function () { closeModal(false); });
    return ov;
  }

  function renderUnifiedPicker(providers, mediaTitle) {
    var ov = document.getElementById('streams-overlay');
    if (!ov) return;
    var provBar = ov.querySelector('#streams-providers');
    var body = ov.querySelector('#streams-body');
    var reqSeq = 0;

    var ui = {
      provIdx: 0,
      matchIdxByProv: {},
      matchesOpen: false,
      translation: '',
      season: '',
      quality: ''
    };

    function renderProvidersBar() {
      provBar.style.display = 'flex';
      provBar.innerHTML = '';
      providers.forEach(function (p, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'streams-prov-btn' + (i === ui.provIdx ? ' active' : '');
        var cnt = p.id === 'uacdn' ? 'HD' : String(p.results.length);
        btn.innerHTML = '<span>' + esc(p.label) + '</span><span class="streams-prov-cnt">' + esc(cnt) + '</span>';
        btn.addEventListener('click', function () {
          if (ui.provIdx === i) return;
          ui.provIdx = i;
          ui.matchesOpen = false;
          ui.translation = '';
          ui.season = '';
          renderProvidersBar();
          loadCurrentProvider();
        });
        provBar.appendChild(btn);
      });
    }

    function playWithQuality(url, subtitle) {
      fetchQualities(url).then(function (vars) {
        var chosen = null;
        if (ui.quality && vars.length > 0) {
          for (var i = 0; i < vars.length; i++) {
            if (vars[i].label === ui.quality) { chosen = vars[i]; break; }
          }
        }
        if (!chosen && vars.length > 0) chosen = vars[0];
        openVideo(chosen ? chosen.url : url, subtitle);
      });
    }

    function renderMatchSelector(prov, activeIdx) {
      var cur = prov.results[activeIdx];
      var wrap = document.createElement('div');
      var bar = document.createElement('div');
      bar.className = 'streams-match-bar';

      var curSpan = document.createElement('div');
      curSpan.className = 'streams-match-cur';
      curSpan.innerHTML = '✓ ' + esc(cur.title) + (cur.year ? '<span class="streams-match-yr">(' + esc(cur.year) + ')</span>' : '');
      bar.appendChild(curSpan);

      if (prov.results.length > 1) {
        var altBtn = document.createElement('button');
        altBtn.type = 'button';
        altBtn.className = 'streams-alt-toggle';
        altBtn.textContent = ui.matchesOpen ? 'Згорнути ▴' : 'Інші збіги (' + (prov.results.length - 1) + ') ▾';
        altBtn.addEventListener('click', function () {
          ui.matchesOpen = !ui.matchesOpen;
          altBtn.textContent = ui.matchesOpen ? 'Згорнути ▴' : 'Інші збіги (' + (prov.results.length - 1) + ') ▾';
          listEl.style.display = ui.matchesOpen ? 'flex' : 'none';
        });
        bar.appendChild(altBtn);
      }
      wrap.appendChild(bar);

      var listEl = document.createElement('div');
      listEl.className = 'streams-matches-list';
      listEl.style.display = ui.matchesOpen ? 'flex' : 'none';
      if (prov.results.length > 1) {
        prov.results.forEach(function (res, idx) {
          var itemBtn = document.createElement('button');
          itemBtn.type = 'button';
          itemBtn.className = 'streams-alt-item' + (idx === activeIdx ? ' active' : '');
          itemBtn.innerHTML = '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(res.title) + '</span>' +
            (res.year ? '<span class="streams-prov-cnt">' + esc(res.year) + '</span>' : '');
          itemBtn.addEventListener('click', function () {
            ui.matchIdxByProv[prov.id] = idx;
            ui.matchesOpen = false;
            ui.translation = '';
            ui.season = '';
            loadCurrentProvider();
          });
          listEl.appendChild(itemBtn);
        });
        wrap.appendChild(listEl);
      }
      return wrap;
    }

    function renderPlayerControls(rawItems, prov, activeIdx) {
      var hasSeasons = rawItems.some(function (x) { return x.season; });
      var translations = [], seenT = {};
      rawItems.forEach(function (x) {
        var t = x.translation || 'За замовчуванням';
        if (!seenT[t]) { seenT[t] = 1; translations.push(t); }
      });
      if (!ui.translation || translations.indexOf(ui.translation) < 0) ui.translation = translations[0] || '';

      var filtered = rawItems.filter(function (x) {
        return (x.translation || 'За замовчуванням') === ui.translation;
      });
      var seasons = [], seenS = {};
      filtered.forEach(function (x) {
        if (x.season && !seenS[x.season]) { seenS[x.season] = 1; seasons.push(x.season); }
      });
      if (seasons.length && (!ui.season || seasons.indexOf(ui.season) < 0)) ui.season = seasons[0];

      body.innerHTML = '';
      body.appendChild(renderMatchSelector(prov, activeIdx));

      // Озвучка
      if (translations.length > 1) {
        var tGrp = document.createElement('div');
        tGrp.className = 'streams-ctrl-group';
        tGrp.innerHTML = '<div class="streams-ctrl-label">Озвучка</div>';
        if (translations.length <= 4) {
          var tRow = document.createElement('div');
          tRow.className = 'streams-chips-row';
          translations.forEach(function (t) {
            var ch = document.createElement('button');
            ch.type = 'button';
            ch.className = 'streams-chip' + (t === ui.translation ? ' active' : '');
            ch.textContent = t;
            ch.addEventListener('click', function () {
              ui.translation = t;
              ui.season = '';
              renderPlayerControls(rawItems, prov, activeIdx);
            });
            tRow.appendChild(ch);
          });
          tGrp.appendChild(tRow);
        } else {
          var tSel = document.createElement('select');
          tSel.className = 'streams-select';
          translations.forEach(function (t) {
            var opt = document.createElement('option');
            opt.value = t; opt.textContent = t;
            if (t === ui.translation) opt.selected = true;
            tSel.appendChild(opt);
          });
          tSel.addEventListener('change', function () {
            ui.translation = this.value;
            ui.season = '';
            renderPlayerControls(rawItems, prov, activeIdx);
          });
          tGrp.appendChild(tSel);
        }
        body.appendChild(tGrp);
      }

      // Сезони
      if (hasSeasons && seasons.length > 1) {
        var sGrp = document.createElement('div');
        sGrp.className = 'streams-ctrl-group';
        sGrp.innerHTML = '<div class="streams-ctrl-label">Сезон</div>';
        var sRow = document.createElement('div');
        sRow.className = 'streams-chips-row';
        seasons.forEach(function (s) {
          var ch = document.createElement('button');
          ch.type = 'button';
          ch.className = 'streams-chip' + (s === ui.season ? ' active' : '');
          ch.textContent = s;
          ch.addEventListener('click', function () {
            ui.season = s;
            renderPlayerControls(rawItems, prov, activeIdx);
          });
          sRow.appendChild(ch);
        });
        sGrp.appendChild(sRow);
        body.appendChild(sGrp);
      }

      // Якість (чіпи)
      var qGrp = document.createElement('div');
      qGrp.className = 'streams-ctrl-group';
      qGrp.innerHTML = '<div class="streams-ctrl-label">Якість</div>';
      var qRow = document.createElement('div');
      qRow.className = 'streams-chips-row';
      qRow.innerHTML = '<button type="button" class="streams-chip active">Найкраща</button>';
      qGrp.appendChild(qRow);
      body.appendChild(qGrp);

      var viewItems = hasSeasons
        ? filtered.filter(function (x) { return (x.season || '') === ui.season; })
        : filtered;

      // Кнопка Грати або список серій
      if (!viewItems.length) {
        var errEl = document.createElement('div');
        errEl.className = 'streams-error';
        errEl.textContent = 'Немає джерел для обраних параметрів';
        body.appendChild(errEl);
      } else if (!hasSeasons || viewItems.length === 1) {
        var target = viewItems[0];
        var playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'streams-play-btn';
        playBtn.textContent = '▶ ' + (hasSeasons && target.episode ? target.episode : 'Дивитись');
        playBtn.addEventListener('click', function () { playWithQuality(target.url, target.subtitle); });
        body.appendChild(playBtn);
      } else {
        var epList = document.createElement('div');
        epList.className = 'streams-ep-list';
        viewItems.forEach(function (ep, idx) {
          var eb = document.createElement('button');
          eb.type = 'button';
          eb.className = 'streams-ep-btn';
          eb.innerHTML = '<span class="streams-ep-title">' + esc(ep.episode || ('Серія ' + (idx + 1))) + '</span>' +
            '<span class="streams-ep-qual" data-qual="' + idx + '"></span>';
          eb.addEventListener('click', function () { playWithQuality(ep.url, ep.subtitle); });
          epList.appendChild(eb);
        });
        body.appendChild(epList);
      }

      // Підтягуємо якості без зміни висоти кнопок
      var localSeq = reqSeq;
      Promise.all(viewItems.map(function (ep) {
        return fetchQualities(ep.url).catch(function () { return []; });
      })).then(function (allQ) {
        if (localSeq !== reqSeq || !body.isConnected) return;
        var qMap = {};
        allQ.forEach(function (vars, idx) {
          if (vars.length && hasSeasons && viewItems.length > 1) {
            var badge = body.querySelector('[data-qual="' + idx + '"]');
            if (badge) badge.textContent = vars[0].label;
          }
          vars.forEach(function (v) {
            if (v.label && v.label !== 'DIRECT') qMap[v.label] = v.width;
          });
        });
        var labels = Object.keys(qMap).sort(function (a, b) { return qMap[b] - qMap[a]; });
        if (ui.quality && labels.indexOf(ui.quality) < 0) ui.quality = '';
        qRow.innerHTML = '';
        var opts = [''].concat(labels);
        opts.forEach(function (q) {
          var ch = document.createElement('button');
          ch.type = 'button';
          ch.className = 'streams-chip' + (ui.quality === q ? ' active' : '');
          ch.textContent = q || 'Найкраща';
          ch.addEventListener('click', function () {
            ui.quality = q;
            qRow.querySelectorAll('.streams-chip').forEach(function (b) { b.classList.remove('active'); });
            ch.classList.add('active');
          });
          qRow.appendChild(ch);
        });
      });
    }

    function loadCurrentProvider() {
      var seq = ++reqSeq;
      var prov = providers[ui.provIdx];
      if (!prov) return;

      if (prov.id === 'uacdn') {
        body.innerHTML = '';
        var note = document.createElement('div');
        note.className = 'streams-status';
        note.style.padding = '12px 8px 4px';
        note.textContent = 'Знайдено за точним IMDb ID у базі UACDN';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'streams-play-btn';
        btn.textContent = '▶ Відкрити UACDN плеєр';
        btn.addEventListener('click', function () { openIframeOverlay(prov.url, mediaTitle); });
        body.appendChild(note);
        body.appendChild(btn);
        return;
      }

      var idx = ui.matchIdxByProv[prov.id] || 0;
      if (idx >= prov.results.length) idx = 0;
      ui.matchIdxByProv[prov.id] = idx;

      body.innerHTML = '';
      body.appendChild(renderMatchSelector(prov, idx));
      var stEl = document.createElement('div');
      stEl.className = 'streams-status';
      stEl.textContent = 'Завантаження плеєра «' + prov.results[idx].title + '»…';
      body.appendChild(stEl);

      loadFlatForResult(prov.results[idx]).then(function (flat) {
        if (seq !== reqSeq || !body.isConnected) return;
        renderPlayerControls(flat, prov, idx);
      }).catch(function (err) {
        if (seq !== reqSeq || !body.isConnected) return;
        // Автофолбек на 2-й результат, якщо перший виявився битим і юзер сам не обирав конкретний індекс
        if (idx === 0 && prov.results.length > 1) {
          ui.matchIdxByProv[prov.id] = 1;
          loadFlatForResult(prov.results[1]).then(function (flat2) {
            if (seq !== reqSeq || !body.isConnected) return;
            renderPlayerControls(flat2, prov, 1);
          }).catch(function (err2) {
            if (seq !== reqSeq || !body.isConnected) return;
            body.innerHTML = '';
            body.appendChild(renderMatchSelector(prov, idx));
            var er = document.createElement('div');
            er.className = 'streams-error';
            er.textContent = 'Помилка: ' + err2.message;
            body.appendChild(er);
          });
          return;
        }
        body.innerHTML = '';
        body.appendChild(renderMatchSelector(prov, idx));
        var er = document.createElement('div');
        er.className = 'streams-error';
        er.textContent = 'Помилка: ' + err.message;
        body.appendChild(er);
      });
    }

    renderProvidersBar();
    loadCurrentProvider();
  }

  // ═══════════════════════════════════════════
  //  Main: пошук + збір провайдерів
  // ═══════════════════════════════════════════
  function openStreamPicker(title, year, type, imdbId, origTitle) {
    var q = String(title || '').trim();
    var headerTitle = q + (year ? ' (' + year + ')' : '');
    createShell(headerTitle || 'Джерело UA');

    var body = document.getElementById('streams-body');
    if (!q && !origTitle) {
      body.innerHTML = '<div class="streams-error">Порожня назва</div>';
      return;
    }
    body.innerHTML = '<div class="streams-status">Пошук «' + esc(q || origTitle) + '»…</div>';

    var uacdnP = imdbId
      ? fetch('https://franko.uacdn.online/show/imdb/' + imdbId, { method: 'HEAD' })
          .then(function (r) { return r.ok ? 'https://franko.uacdn.online/show/imdb/' + imdbId : null; })
          .catch(function () { return null; })
      : Promise.resolve(null);

    Promise.allSettled([
      uacdnP,
      searchProviderSmart(searchEneyida, q, origTitle, year, type),
      searchProviderSmart(searchUASerials, q, origTitle, year, type)
    ]).then(function (results) {
      if (!document.getElementById('streams-overlay')) return;
      var uacdnUrl = results[0].status === 'fulfilled' ? results[0].value : null;
      var eneyida = results[1].status === 'fulfilled' ? results[1].value : [];
      var uas = results[2].status === 'fulfilled' ? results[2].value : [];

      var providers = [];
      if (uacdnUrl) providers.push({ id: 'uacdn', label: 'UACDN', url: uacdnUrl });
      if (type === 'tv') {
        if (uas.length) providers.push({ id: 'uaserials', label: 'UASerials', results: uas });
        if (eneyida.length) providers.push({ id: 'eneyida', label: 'Eneyida', results: eneyida });
      } else {
        if (eneyida.length) providers.push({ id: 'eneyida', label: 'Eneyida', results: eneyida });
        if (uas.length) providers.push({ id: 'uaserials', label: 'UASerials', results: uas });
      }

      if (!providers.length) {
        body.innerHTML = '<div class="streams-error">Нічого не знайдено на балансерах</div>';
        return;
      }

      renderUnifiedPicker(providers, q || origTitle);
    }).catch(function (e) {
      var b = document.getElementById('streams-body');
      if (b) b.innerHTML = '<div class="streams-error">Помилка: ' + esc(e.message) + '</div>';
    });
  }

  window.openStreamPicker = openStreamPicker;
  window.closeStreamPicker = function () { closeModal(false); };
  window._streamsUtil = { scoreCandidate: scoreCandidate, extractSnippetMeta: extractSnippetMeta, normStr: normStr };
})();
