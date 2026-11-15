'use strict';

(function () {
  let overlayEl = null;
  let frameEl = null;
  let titleEl = null;
  let loaderEl = null;
  let opened = false;
  let activeUrl = '';
  let frameReady = false;
  let pendingMsg = null;

  function ensureDom() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'lampa-room-overlay';
    overlayEl.className = 'lampa-room-overlay';

    const bar = document.createElement('div');
    bar.className = 'lampa-room-bar';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'lampa-room-back';
    backBtn.textContent = '← Назад до MyCinema';
    backBtn.addEventListener('click', () => closeDom());

    titleEl = document.createElement('div');
    titleEl.className = 'lampa-room-title';

    const actions = document.createElement('div');
    actions.className = 'lampa-room-actions';

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'lampa-room-btn';
    reloadBtn.title = 'Перезавантажити Lampa';
    reloadBtn.textContent = '↻';
    reloadBtn.addEventListener('click', () => {
      if (activeUrl) {
        frameReady = false;
        if (loaderEl) loaderEl.style.display = 'flex';
        frameEl.src = activeUrl;
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lampa-room-btn';
    closeBtn.title = 'Закрити';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => closeDom());

    actions.append(reloadBtn, closeBtn);
    bar.append(backBtn, titleEl, actions);

    loaderEl = document.createElement('div');
    loaderEl.className = 'lampa-room-loader';
    loaderEl.innerHTML = '<div class="lampa-spinner"></div><div style="margin-top:12px;color:#9a9bb5;font-size:14px">Завантаження Lampa...</div>';

    overlayEl.append(bar, loaderEl);
    document.body.appendChild(overlayEl);
  }

  function openOverlay(titleText, url, warmMsg) {
    ensureDom();
    titleEl.textContent = titleText || 'Lampa';
    activeUrl = url;
    pendingMsg = warmMsg;
    frameReady = false;

    if (!opened) {
      opened = true;
      overlayEl.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    if (loaderEl) loaderEl.style.display = 'flex';

    // Створюємо iframe з нуля
    if (frameEl) frameEl.remove();
    
    frameEl = document.createElement('iframe');
    frameEl.id = 'lampa-room-frame';
    frameEl.className = 'lampa-room-frame';
    frameEl.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    
    // Обробник повідомлень від iframe
    window.addEventListener('message', function onMessage(e) {
      if (!frameEl || e.source !== frameEl.contentWindow || !e.data) return;
      
      if (e.data.type === 'mc-ready') {
        frameReady = true;
        if (loaderEl) loaderEl.style.display = 'none';
        
        if (pendingMsg) {
          frameEl.contentWindow.postMessage(pendingMsg, window.location.origin);
          pendingMsg = null;
        }
      }
    });

    overlayEl.appendChild(frameEl);
    frameEl.src = url;
  }

  function closeDom() {
    if (!opened) return;
    opened = false;
    if (frameEl) {
      frameEl.remove();
      frameEl = null;
    }
    if (overlayEl) overlayEl.classList.remove('open');
    document.body.style.overflow = '';
    frameReady = false;
    pendingMsg = null;
  }

  function open(item) {
    if (!item || !item.id) return;
    const media = item.type === 'tv' ? 'tv' : 'movie';
    const url = `./lampa/index.html?mc_room=1`;
    openOverlay(item.title || 'Lampa', url, {
      type: 'mc-open-card', id: item.id, media, title: item.title || '',
      poster: item.poster || '', backdrop: item.backdrop || '', year: item.year || '', card: item
    });
  }

  function openHome() {
    openOverlay('Lampa · Налаштування', './lampa/index.html?mc_room=1', { type: 'mc-open-home' });
  }

  window.LampaRoom = { open, openHome, close: closeDom, handleBack: closeDom, isOpen: () => opened };
})();
