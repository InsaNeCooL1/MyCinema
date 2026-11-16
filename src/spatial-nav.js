/* Spatial Navigation for Desktop / Keyboard Users (v5) */
(function () {
  'use strict';

  const focusableSelectors = 'a[href], button, input, select, textarea, [tabindex="0"]';
  
  // Загальний чорний список (для головної сторінки, бібліотеки тощо)
  const IGNORE_SELECTORS = [
    '.light', '.btn-del', '.note-del-btn', '.item-delete', '.item-fav', 
    '.ep-reaction-opt', '.ep-reaction-selected', '.rec-dismiss', 
    '.settings-close', '.tags-modal-close', '.quick-note-close', 
    '.filter-dropdown-close', '.zoom-close'
  ].join(', ');

  // Білий список (тільки ці елементи будуть доступні всередині картки)
  const CARD_ALLOWED = '.btn-uakino, .btn-watched, .card-x';

  function getVisibleElements() {
    let scope = document;
    const overlay = document.getElementById('overlay');
    const isCardOpen = overlay && overlay.classList.contains('open');
    
    if (isCardOpen) {
      scope = document.getElementById('card');
    }

    const all = Array.from(scope.querySelectorAll(focusableSelectors));
    return all.filter(el => {
      if (el.disabled || el.tabIndex === -1) return false;
      
      // Якщо відкрита картка — дозволяємо ТІЛЬКИ дії та кнопку "Назад"
      if (isCardOpen) {
        if (!el.matches(CARD_ALLOWED)) return false;
      } else {
        // На головній сторінці — ігноруємо непотрібне
        if (el.matches(IGNORE_SELECTORS)) return false;
      }
      
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      
      if (rect.bottom < -20 || rect.top > window.innerHeight + 20 || rect.right < -20 || rect.left > window.innerWidth + 20) return false;
      return true;
    });
  }

  document.addEventListener('keydown', (e) => {
    if (typeof isKbdNavEnabled === 'function' && !isKbdNavEnabled()) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    const active = document.activeElement;
    
    // ─── ОБРОБКА ПОЛЯ ВВОДУ ───
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return; // Для редагування тексту
      
      if (active.id === 'q' && e.key === 'ArrowDown') {
        const acItems = document.querySelectorAll('#autocomplete .ac-item');
        if (acItems.length > 0) {
          e.preventDefault(); acItems[0].focus(); return;
        } else {
          const firstCard = document.querySelector('#results .rec-card, #results .item');
          if (firstCard) { e.preventDefault(); firstCard.focus(); return; }
        }
      }
      if (active.id === 'q' && e.key === 'ArrowUp') {
        const headerBtn = document.querySelector('body > header button, .nav-item');
        if (headerBtn) { e.preventDefault(); headerBtn.focus(); return; }
      }
      return; 
    }

    // ─── SPATIAL NAVIGATION ───
    const candidates = getVisibleElements().filter(el => el !== active);
    
    if (!active || active.tagName === 'BODY' || active.tagName === 'IFRAME') {
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

      if (e.key === 'ArrowUp' && dy < -5) {
        isInDirection = true; dist = Math.abs(dy) + Math.abs(dx) * 3;
      } else if (e.key === 'ArrowDown' && dy > 5) {
        isInDirection = true; dist = Math.abs(dy) + Math.abs(dx) * 3;
      } else if (e.key === 'ArrowLeft' && dx < -5) {
        isInDirection = true; dist = Math.abs(dx) + Math.abs(dy) * 3;
      } else if (e.key === 'ArrowRight' && dx > 5) {
        isInDirection = true; dist = Math.abs(dx) + Math.abs(dy) * 3;
      }

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
