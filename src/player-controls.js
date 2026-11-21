/* =====================================================================
   MCPlayerControls — сучасні контроли поверх відео (стиль YouTube).
   Використовується в player.html і у вбудованому плеєрі streams.js.
   ===================================================================== */
(function (global) {
  'use strict';

  var STYLE_ID = 'mc-player-controls-style';
  var CSS = [
    '.mc-pc{position:absolute;inset:0;z-index:20;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;color:#fff;--mc-accent:#ffb86c;}',
    '.mc-pc-top,.mc-pc-bottom{position:absolute;left:0;right:0;display:flex;align-items:center;gap:15px;padding:15px 21px;pointer-events:auto;transition:opacity .25s ease,transform .25s ease;}',
    '.mc-pc-top{top:0;background:linear-gradient(180deg,rgba(0,0,0,.72),transparent);}',
    '.mc-pc-bottom{bottom:0;flex-direction:column;align-items:stretch;gap:9px;background:linear-gradient(0deg,rgba(0,0,0,.82),transparent);padding-bottom:calc(15px + env(safe-area-inset-bottom));}',
    '.mc-pc.idle .mc-pc-top{opacity:0;transform:translateY(-12px);pointer-events:none;}',
    '.mc-pc.idle .mc-pc-bottom{opacity:0;transform:translateY(12px);pointer-events:none;}',
    '.mc-pc-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:italic 600 24px Georgia,serif;color:var(--mc-accent);}',
    '.mc-pc-btn{background:transparent;border:0;color:#fff;width:54px;height:54px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background .18s,color .18s;}',
    '.mc-pc-btn:hover{background:rgba(255,255,255,.14);color:var(--mc-accent);}',
    '.mc-pc-btn svg{width:30px;height:30px;fill:currentColor;}',
    '.mc-pc-row{display:flex;align-items:center;gap:6px;}',
    '.mc-pc-time{font:18px/1 ui-monospace,monospace;color:rgba(255,255,255,.9);padding:0 9px;white-space:nowrap;}',
    '.mc-pc-spacer{flex:1;}',
    '.mc-pc-seek{position:relative;height:27px;display:flex;align-items:center;cursor:pointer;}',
    '.mc-pc-track{position:absolute;left:0;right:0;height:6px;border-radius:99px;background:rgba(255,255,255,.25);overflow:hidden;}',
    '.mc-pc-buffered,.mc-pc-played{position:absolute;inset:0 auto 0 0;width:0;border-radius:99px;}',
    '.mc-pc-buffered{background:rgba(255,255,255,.4);}',
    '.mc-pc-played{background:var(--mc-accent);z-index:1;}',
    '.mc-pc-seek input{position:relative;z-index:2;width:100%;margin:0;height:27px;opacity:0;cursor:pointer;}',
    '.mc-pc-vol{display:flex;align-items:center;gap:3px;}',
    '.mc-pc-vol input{width:108px;accent-color:var(--mc-accent);cursor:pointer;}',
    '.mc-pc-vol input[hidden]{display:none;}',
    '.mc-pc[hidden]{display:none;}'
  ].join('\n');

  function injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }
  var ICON = {
    play: svg('M8 5v14l11-7z'),
    pause: svg('M6 5h4v14H6zm8 0h4v14h-4z'),
    back: svg('M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z'),
    menu: svg('M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'),
    full: svg('M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm14 8h-5v2h5v-5h-2zm0-14h-5v2h3v3h2z'),
    vol: svg('M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z'),
    mute: svg('M3 9v6h4l5 5V4L7 9zm13.6 3 2.2-2.2-1.4-1.4-2.2 2.2L12.9 8.4 11.5 9.8l2.2 2.2-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4z')
  };

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
  }

  function mount(opts) {
    opts = opts || {};
    var host = opts.host;
    var video = opts.video;
    if (!host || !video) return null;
    var doc = host.ownerDocument;
    injectStyle(doc);
    video.controls = false;

    var root = doc.createElement('div');
    root.className = 'mc-pc';
    root.innerHTML =
      '<div class="mc-pc-top">' +
        (opts.onBack ? '<button type="button" class="mc-pc-btn" data-a="back" title="Назад" aria-label="Назад">' + ICON.back + '</button>' : '') +
        '<div class="mc-pc-title"></div>' +
        (opts.onExternal ? '<button type="button" class="mc-pc-btn" data-a="external" title="Відкрити в зовнішньому плеєрі">VLC</button>' : '') +
        (opts.onMenu ? '<button type="button" class="mc-pc-btn" data-a="menu" title="Керування (☰)" aria-label="Керування">' + ICON.menu + '</button>' : '') +
        (opts.onFullscreen ? '<button type="button" class="mc-pc-btn" data-a="full" title="На весь екран" aria-label="На весь екран">' + ICON.full + '</button>' : '') +
      '</div>' +
      '<div class="mc-pc-bottom">' +
        '<div class="mc-pc-seek"><div class="mc-pc-track"><i class="mc-pc-buffered"></i><i class="mc-pc-played"></i></div><input type="range" min="0" max="1000" value="0" aria-label="Перемотка"></div>' +
        '<div class="mc-pc-row">' +
          '<button type="button" class="mc-pc-btn" data-a="play" title="Відтворити/Пауза" aria-label="Відтворити">' + ICON.play + '</button>' +
          '<span class="mc-pc-time">0:00 / 0:00</span>' +
          '<span class="mc-pc-spacer"></span>' +
          '<span class="mc-pc-vol"><button type="button" class="mc-pc-btn" data-a="vol" title="Звук" aria-label="Звук">' + ICON.vol + '</button>' +
            '<input type="range" min="0" max="1" step="0.05" value="1" aria-label="Гучність"></span>' +
        '</div>' +
      '</div>';
    host.appendChild(root);

    var playBtn = root.querySelector('[data-a="play"]');
    var timeEl = root.querySelector('.mc-pc-time');
    var seek = root.querySelector('.mc-pc-seek input');
    var played = root.querySelector('.mc-pc-played');
    var buffered = root.querySelector('.mc-pc-buffered');
    var volBtn = root.querySelector('[data-a="vol"]');
    var volInput = root.querySelector('.mc-pc-vol input');
    var titleEl = root.querySelector('.mc-pc-title');
    var idleTimer = null;
    var destroyed = false;

    function setTitle(t) { titleEl.textContent = t || ''; }

    function show() {
      root.classList.remove('idle');
      clearTimeout(idleTimer);
      if (!video.paused) {
        idleTimer = setTimeout(function () { root.classList.add('idle'); }, 3000);
      }
    }
    function hide() { root.classList.add('idle'); }

    function syncPlay() {
      playBtn.innerHTML = video.paused ? ICON.play : ICON.pause;
      playBtn.setAttribute('aria-label', video.paused ? 'Відтворити' : 'Пауза');
      show();
    }
    function syncTime() {
      var d = video.duration || 0, t = video.currentTime || 0;
      timeEl.textContent = fmtTime(t) + ' / ' + (d ? fmtTime(d) : '—:——');
      if (d > 0) {
        seek.value = String(Math.round(t / d * 1000));
        played.style.width = (t / d * 100).toFixed(2) + '%';
      } else { seek.value = '0'; played.style.width = '0'; }
      if (d > 0 && video.buffered && video.buffered.length) {
        var end = video.buffered.end(video.buffered.length - 1);
        buffered.style.width = Math.min(100, end / d * 100).toFixed(2) + '%';
      }
    }
    function syncVol() {
      volInput.value = String(video.volume);
      volBtn.innerHTML = video.muted || video.volume === 0 ? ICON.mute : ICON.vol;
    }

    function togglePlay() {
      if (video.paused) video.play().catch(function () {});
      else video.pause();
      show();
    }

    playBtn.addEventListener('click', togglePlay);
    seek.addEventListener('input', function () {
      var d = video.duration || 0;
      if (d > 0) { try { video.currentTime = Number(seek.value) / 1000 * d; } catch (e) {} }
      show();
    });
    volInput.addEventListener('input', function () {
      video.volume = Number(volInput.value);
      video.muted = video.volume === 0;
      syncVol(); show();
    });
    volBtn.addEventListener('click', function () { video.muted = !video.muted; syncVol(); show(); });

    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'back' && opts.onBack) opts.onBack();
      else if (a === 'menu' && opts.onMenu) opts.onMenu();
      else if (a === 'full' && opts.onFullscreen) opts.onFullscreen();
      else if (a === 'external' && opts.onExternal) opts.onExternal();
    });

    ['mousemove', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) {
      doc.addEventListener(ev, show, { passive: true });
    });
    video.addEventListener('play', syncPlay);
    video.addEventListener('pause', syncPlay);
    video.addEventListener('timeupdate', syncTime);
    video.addEventListener('progress', syncTime);
    video.addEventListener('loadedmetadata', syncTime);
    video.addEventListener('volumechange', syncVol);

    doc.addEventListener('keydown', function (e) {
      if (destroyed) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); try { video.currentTime += 5; } catch (er) {} show(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); try { video.currentTime -= 5; } catch (er) {} show(); }
      else if (e.key.toLowerCase() === 'f' && opts.onFullscreen) { e.preventDefault(); opts.onFullscreen(); }
      else if (e.key.toLowerCase() === 'm' && opts.onMenu) { e.preventDefault(); opts.onMenu(); }
    });

    setTitle(opts.title);
    syncPlay(); syncTime(); syncVol(); show();

    return {
      root: root,
      setTitle: setTitle,
      show: show,
      hide: hide,
      destroy: function () {
        destroyed = true;
        clearTimeout(idleTimer);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  global.MCPlayerControls = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
