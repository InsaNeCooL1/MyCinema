'use strict';

// Snow layer — safe: no DOM element in wheel/touch event path.
// Implementation: background-image on a pointer-events:none div.
(function () {
  const KEY = 'mycinema.snowEnabled';

  function isEnabled() {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === 'true';  // default ON
  }

  function apply() {
    const existing = document.getElementById('snow-layer');
    if (isEnabled()) {
      if (!existing) {
        const layer = document.createElement('div');
        layer.id = 'snow-layer';
        layer.className = 'mcm-snow';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  function setEnabled(on) {
    localStorage.setItem(KEY, on ? 'true' : 'false');
    apply();
    if (typeof touchAppearance === 'function') touchAppearance();
  }

  window.SnowFeature = { isEnabled: isEnabled, setEnabled: setEnabled, apply: apply };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
