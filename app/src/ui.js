'use strict';

function openSidebar() { 
  document.getElementById('sidebar').classList.add('open'); 
  document.getElementById('sidebar-backdrop').classList.add('open'); 
}

function closeSidebar() { 
  document.getElementById('sidebar').classList.remove('open'); 
  document.getElementById('sidebar-backdrop').classList.remove('open'); 
}

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.nav-item, .filter-btn, .home-tab, .card-tab, .btn, .card-x, .filter-actions button, .query-bar button, .trailer-btn, .auth-btn, .onb-btn, .game-btn, .login-btn-side, .logout-btn-side, .season-tab-btn, .settings-btn, .cast-loader-btn, .mood-pill, .taste-summary');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2.2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = size + 'px';
  ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 700);
});

function openImageZoom(path, size) {
  if (!path) return;
  const zoom = document.getElementById('poster-zoom');
  zoom.querySelector('img').src = TMDB_IMG + (size || 'w500') + path;
  zoom.classList.add('open');
}

function closeImageZoom() { 
  document.getElementById('poster-zoom').classList.remove('open'); 
}

document.getElementById('poster-zoom').addEventListener('click', (e) => {
  if (e.target.id === 'poster-zoom' || e.target.classList.contains('zoom-close')) closeImageZoom();
});
