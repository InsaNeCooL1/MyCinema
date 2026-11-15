(function () {
  'use strict';
  if (window === window.parent) return;

  var origin = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : '*';

  // Чекаємо, поки Lampa повністю ініціалізується
  function checkReady() {
    try {
      if (window.Lampa && Lampa.Activity && typeof Lampa.Activity.active === 'function') {
        var act = Lampa.Activity.active();
        if (act) {
          window.parent.postMessage({ type: 'mc-ready' }, origin);
          initMouseNav(); // Ініціалізуємо мишу після готовності Lampa
          return;
        }
      }
    } catch (e) {}
    setTimeout(checkReady, 100);
  }
  checkReady();

  function stopMedia() {
    try {
      if (window.Lampa && Lampa.Player && typeof Lampa.Player.opened === 'function' && Lampa.Player.opened()) {
        if (typeof Lampa.Player.close === 'function') Lampa.Player.close();
      }
    } catch (e) {}
    try {
      document.querySelectorAll('video, audio').forEach(function (m) {
        try { m.pause(); m.removeAttribute('src'); m.load(); } catch (e) {}
      });
    } catch (e) {}
  }

  // --- Підтримка миші / тачпаду ---
  function initMouseNav() {
    if (window._mcMouseNavInitialized) return;
    window._mcMouseNavInitialized = true;

    var lastHovered = null;

    // Рух миші -> фокус
    document.addEventListener('mousemove', function(e) {
      var target = e.target;
      while (target && target !== document) {
        if (target.classList && target.classList.contains('selector')) {
          if (target !== lastHovered) {
            lastHovered = target;
            if (window.$) {
              window.$(target).trigger('hover:focus');
            }
          }
          return;
        }
        target = target.parentNode;
      }
    });

    // Клік -> enter
    document.addEventListener('click', function(e) {
      var target = e.target;
      while (target && target !== document) {
        if (target.classList && target.classList.contains('selector')) {
          // Не заважаємо нативним елементам керування (посилання, інпути)
          if (target.tagName === 'A' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return;
          }
          
          if (window.$) {
            window.$(target).trigger('hover:enter');
          }
          e.preventDefault();
          return;
        }
        target = target.parentNode;
      }
    });
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data || !e.data.type) return;
    var msg = e.data;

    if (msg.type === 'mc-stop') {
      stopMedia();
      return;
    }

    if (msg.type === 'mc-open-card') {
      stopMedia();
      
      var tries = 0;
      function tryPush() {
        tries++;
        try {
          if (window.Lampa && Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active()) {
            var c = msg.card || {};
            var cardObj = {
              id: msg.id, title: msg.title || '', name: msg.title || '',
              poster_path: msg.poster || '', backdrop_path: msg.backdrop || '',
              release_date: msg.year ? (msg.year + '-01-01') : '',
              first_air_date: msg.year ? (msg.year + '-01-01') : '',
              vote_average: c.tmdbRating || 0, overview: c.overview || '', genres: c.genres || []
            };
            Lampa.Activity.push({
              url: '', title: msg.title || '', component: 'full', id: msg.id,
              method: msg.media || 'movie', card: cardObj, source: 'tmdb'
            });
            return;
          }
        } catch (err) {
          console.warn('[mc-bridge] Push error:', err);
        }
        if (tries < 20) setTimeout(tryPush, 500);
      }
      tryPush();
      return;
    }
  });
})();
