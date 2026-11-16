/* Spatial Navigation for Desktop & Android TV Remote (v6) */
(function () {
  'use strict';

  const focusableSelectors = 'a[href], button, input, select, textarea, [tabindex="0"]';

  const IGNORE_SELECTORS = [
    '.light', '.btn-del', '.note-del-btn', '.note-edit-btn', '.item-delete', '.item-fav',
    '.ep-reaction-opt', '.ep-reaction-selected', '.rec-dismiss',
    '.settings-close', '.tags-modal-close', '.quick-note-close',
    '.filter-dropdown-close', '.zoom-close', '.cw-next-btn'
  ].join(', ');

  const CARD_ALLOWED = [
    '.btn-uakino', '.btn-watched', '.card-x', '.btn-play', '.btn-stop',
    '.hero-fav-btn', '.title-watch-btn', '.card-tab', '.season-tab-btn',
    '.episode-body', '.episode-poster-wrap', '.actor-tile', '.similar-card',
    '.studio-chip', '.btn-read', '.quick-rate-pill', '.quick-rate-copy',
    '.status-btn:not(.btn-del)'
  ].join(', ');

  function getActiveScope() {
    const exitDlg = document.getElementById('exit-confirm-modal');
    if (exitDlg) return { el: exitDlg, mode: 'modal' };

    const vidOv = document.getElementById('streams-video');
    if (vidOv) return { el: vidOv, mode: 'modal' };

    const stOv = document.getElementById('streams-overlay');
    if (stOv) return { el: stOv, mode: 'modal' };

    const setModal = document.getElementById('settings-modal');
    if (setModal && setModal.classList.contains('open')) return { el: setModal, mode: 'modal' };

    const authModal = document.getElementById('auth-modal');
    if (authModal && authModal.style.display === 'flex') return { el: authModal, mode: 'modal' };

    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('open')) return { el: sidebar, mode: 'modal' };

    const overlay = document.getElementById('overlay');
    if (overlay && overlay.classList.contains('open')) {
      return { el: document.getElementById('card') || overlay, mode: 'card' };
    }
    return { el: document, mode: 'page' };
  }

  function getVisibleElements() {
    const scope = getActiveScope();
    const all = Array.from(scope.el.querySelectorAll(focusableSelectors));
    if (scope.mode === 'modal' && scope.el.id === 'streams-video') {
      const vid = scope.el.querySelector('video');
      if (vid && !all.includes(vid)) all.push(vid);
    }
    return all.filter(el => {
      if (el.disabled || el.tabIndex === -1) return false;
      if (scope.mode === 'card' && !el.matches(CARD_ALLOWED)) return false;
      if (scope.mode === 'page' && el.matches(IGNORE_SELECTORS)) return false;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      if (rect.bottom < -40 || rect.top > window.innerHeight + 40 || rect.right < -40 || rect.left > window.innerWidth + 40) return false;
      return true;
    });
  }

  document.addEventListener('keydown', (e) => {
    if (typeof isKbdNavEnabled === 'function' && !isKbdNavEnabled()) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    const active = document.activeElement;

    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
      if (active.id === 'q' && e.key === 'ArrowDown') {
        const acItems = document.querySelectorAll('#autocomplete .ac-item');
        if (acItems.length > 0) { e.preventDefault(); acItems[0].focus(); return; }
        const firstCard = document.querySelector('#results .rec-card, #results .item');
        if (firstCard) { e.preventDefault(); firstCard.focus(); return; }
      }
      if (active.id === 'q' && e.key === 'ArrowUp') {
        const headerBtn = document.querySelector('body > header button, .nav-item');
        if (headerBtn) { e.preventDefault(); headerBtn.focus(); return; }
      }
      return;
    }

    const candidates = getVisibleElements().filter(el => el !== active);
    const scope = getActiveScope();
    const activeOutsideScope = !active || active.tagName === 'BODY' || active.tagName === 'IFRAME' || (scope.el !== document && !scope.el.contains(active));

    if (activeOutsideScope) {
      if (candidates.length > 0) {
        e.preventDefault();
        candidates.sort((a, b) => {
          const rA = a.getBoundingClientRect();
          const rB = b.getBoundingClientRect();
          return (rA.top - rB.top) || (rA.left - rB.left);
        });
        candidates[0].focus();
      }
      return;
    }

    const rectA = active.getBoundingClientRect();
    const cxA = rectA.left + rectA.width / 2;
    const cyA = rectA.top + rectA.height / 2;

    let bestEl = null;
    let minDist = Infinity;

    for (const el of candidates) {
      const rectB = el.getBoundingClientRect();
      const cxB = rectB.left + rectB.width / 2;
      const cyB = rectB.top + rectB.height / 2;
      const dx = cxB - cxA;
      const dy = cyB - cyA;

      let isInDirection = false;
      let dist = 0;
      if (e.key === 'ArrowUp' && dy < -5) { isInDirection = true; dist = Math.abs(dy) + Math.abs(dx) * 3; }
      else if (e.key === 'ArrowDown' && dy > 5) { isInDirection = true; dist = Math.abs(dy) + Math.abs(dx) * 3; }
      else if (e.key === 'ArrowLeft' && dx < -5) { isInDirection = true; dist = Math.abs(dx) + Math.abs(dy) * 3; }
      else if (e.key === 'ArrowRight' && dx > 5) { isInDirection = true; dist = Math.abs(dx) + Math.abs(dy) * 3; }

      if (isInDirection && dist < minDist) {
        minDist = dist;
        bestEl = el;
      }
    }

    if (bestEl) {
      e.preventDefault();
      bestEl.focus();
      bestEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  });
})();
