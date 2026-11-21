/* =====================================================================
   MCPlayerOverlay — спільний оверлей керування відтворенням.
   Використовується і в player.html, і у вбудованому плеєрі streams.js.

   Контракт варіанта (будь-який майбутній джерело просто додає варіанти):
     {
       season: 'Сезон 1', episode: 'Серія 2',
       translation: 'Українська', quality: '1080p',
       url: 'https://…/video.m3u8', subtitle: '…' (опційно),
       audioLang: 'uk' (опційно)
     }
   ===================================================================== */
(function (global) {
  'use strict';

  var STYLE_ID = 'mc-player-overlay-style';
  var CSS = [
    '.mc-po{position:absolute;inset:0;z-index:30;display:flex;justify-content:flex-end;align-items:stretch;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);}',
    '.mc-po[hidden]{display:none;}',
    '.mc-po-panel{width:min(480px,100%);height:100%;overflow-y:auto;padding:calc(21px + env(safe-area-inset-top)) 21px calc(30px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(22,20,27,.98),rgba(8,7,10,.98));border-left:1px solid rgba(255,184,108,.22);box-shadow:-16px 0 50px rgba(0,0,0,.7);font-family:system-ui,-apple-system,sans-serif;color:#f2eee9;}',
    '.mc-po-head{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:24px;font:italic 600 27px Georgia,serif;color:#ffb86c;}',
    '.mc-po-close{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#f2eee9;width:48px;height:48px;border-radius:12px;font-size:22px;cursor:pointer;}',
    '.mc-po-group{margin-bottom:24px;}',
    '.mc-po-label{font:700 16px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#8d877f;margin-bottom:12px;}',
    '.mc-po-chips{display:flex;flex-wrap:wrap;gap:9px;}',
    '.mc-po-chip{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#cfc8c0;border-radius:12px;padding:10px 15px;font-size:18px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.mc-po-chip.active{background:rgba(255,184,108,.18);border-color:#ffb86c;color:#ffb86c;font-weight:700;}',
    '.mc-po-empty{font-size:18px;color:#8d877f;}',
    '.mc-po-current{margin-top:30px;padding-top:21px;border-top:1px solid rgba(255,255,255,.07);font:16px/1.6 ui-monospace,monospace;color:#8d877f;word-break:break-all;}'
  ].join('\n');

  function injectStyle(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function uniq(list) {
    var seen = {}, out = [];
    list.forEach(function (v) {
      var k = String(v || '');
      if (!seen[k]) { seen[k] = 1; out.push(v); }
    });
    return out;
  }

  function mount(opts) {
    opts = opts || {};
    var doc = opts.host ? opts.host.ownerDocument : document;
    injectStyle(doc);

    var variants = (Array.isArray(opts.variants) ? opts.variants : []).filter(function (v) {
      return v && v.url;
    });
    var onSwitch = typeof opts.onSwitch === 'function' ? opts.onSwitch : function () {};
    var state = {
      season: (opts.initial && opts.initial.season) || '',
      episode: (opts.initial && opts.initial.episode) || '',
      translation: (opts.initial && opts.initial.translation) || '',
      quality: (opts.initial && opts.initial.quality) || ''
    };

    var root = doc.createElement('div');
    root.className = 'mc-po';
    root.hidden = true;
    var panel = doc.createElement('div');
    panel.className = 'mc-po-panel';
    var head = doc.createElement('div');
    head.className = 'mc-po-head';
    head.innerHTML = '<span>Керування переглядом</span>';
    var closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mc-po-close';
    closeBtn.setAttribute('aria-label', 'Закрити меню');
    closeBtn.textContent = '✕';
    head.appendChild(closeBtn);
    panel.appendChild(head);
    var groups = doc.createElement('div');
    panel.appendChild(groups);
    var current = doc.createElement('div');
    current.className = 'mc-po-current';
    panel.appendChild(current);
    root.appendChild(panel);
    (opts.host || doc.body).appendChild(root);

    function matches(v, skip) {
      return ['season', 'episode', 'translation', 'quality'].every(function (k) {
        return skip === k || !state[k] || String(v[k] || '') === String(state[k]);
      });
    }

    /* Для кожного рівня фільтруємо за вже вибраними «вищими» рівнями,
       щоб у списку не з'являлись опції, яких немає при поточному виборі. */
    function optionsFor(key) {
      var order = ['season', 'episode', 'translation', 'quality'];
      var idx = order.indexOf(key);
      var pool = variants.filter(function (v) {
        return order.slice(0, idx).every(function (k) {
          return !state[k] || String(v[k] || '') === String(state[k]);
        });
      });
      return uniq(pool.map(function (v) { return v[key] || ''; }));
    }

    function currentVariant() {
      for (var i = 0; i < variants.length; i++) if (matches(variants[i])) return variants[i];
      return variants[0] || null;
    }

    function makeGroup(key, label) {
      var wrap = doc.createElement('div');
      wrap.className = 'mc-po-group';
      var title = doc.createElement('div');
      title.className = 'mc-po-label';
      title.textContent = label;
      wrap.appendChild(title);
      var row = doc.createElement('div');
      row.className = 'mc-po-chips';
      var opts = optionsFor(key);
      var effective = state[key];
      if (!effective) {
        var cv = currentVariant();
        effective = cv ? cv[key] : '';
      }
      if (!opts.length || (opts.length === 1 && !opts[0])) {
        row.innerHTML = '<span class="mc-po-empty">—</span>';
      } else {
        opts.forEach(function (val) {
          var btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'mc-po-chip' + (String(effective || '') === String(val) ? ' active' : '');
          btn.textContent = val || 'За замовчуванням';
          btn.addEventListener('click', function () {
            state[key] = String(val);
            /* Скидаємо нижчі рівні, якщо вибір більше не існує. */
            var order = ['season', 'episode', 'translation', 'quality'];
            order.slice(order.indexOf(key) + 1).forEach(function (lower) {
              var ok = optionsFor(lower).some(function (x) { return String(x) === String(state[lower]); });
              if (!ok) state[lower] = '';
            });
            render();
            var v = currentVariant();
            if (v) onSwitch(v, variants.indexOf(v));
          });
          row.appendChild(btn);
        });
      }
      wrap.appendChild(row);
      return wrap;
    }

    function render() {
      groups.replaceChildren(
        makeGroup('season', 'Сезон'),
        makeGroup('episode', 'Серія'),
        makeGroup('translation', 'Озвучка'),
        makeGroup('quality', 'Якість')
      );
      var v = currentVariant();
      current.textContent = v
        ? [v.season, v.episode, v.translation, v.quality].filter(Boolean).join(' · ')
        : 'Немає доступних варіантів';
    }

    function open() { render(); root.hidden = false; }
    function close() { root.hidden = true; }
    function toggle() { root.hidden ? open() : close(); }
    function destroy() { if (root.parentNode) root.parentNode.removeChild(root); }

    closeBtn.addEventListener('click', close);
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !root.hidden) { e.stopPropagation(); close(); }
    }, true);

    render();
    return {
      root: root,
      open: open,
      close: close,
      toggle: toggle,
      destroy: destroy,
      current: currentVariant,
      state: function () { return Object.assign({}, state); },
      hasOptions: function () { return variants.length > 1; }
    };
  }

  global.MCPlayerOverlay = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
