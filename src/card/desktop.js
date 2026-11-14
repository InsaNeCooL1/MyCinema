/* FIX-CARD-DESKTOP
   ─────────────────────────────────────────────────────────────
   Desktop UI картки (ширина >= 900px).
   Поки що — заглушка. Реальна верстка — наступний крок.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function renderDesktopCard(ctx, scroll) {
    const r = ctx.item || {};
    const d = ctx.details || {};
    const title = r.title || d.title || d.name || 'Без назви';

    scroll.innerHTML = `
      <div style="padding: 80px 20px; text-align: center;">
        <div style="font-size: 28px; font-weight: 700; color: var(--text); margin-bottom: 8px;">${title}</div>
        <div style="font-size: 13px; color: var(--text-muted); font-family: var(--mono);">DESKTOP · UI в розробці</div>
      </div>
    `;
  }

  window.renderDesktopCard = renderDesktopCard;
})();
