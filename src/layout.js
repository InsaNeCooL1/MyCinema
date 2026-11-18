/* [LAYOUT] Єдина точка істини для десктоп/мобайл розкладки.
   CSS працює з html[data-layout], JS — через isDesktopLayout().
   Усі десктоп-стилі мають бути scopes через html[data-layout="desktop"],
   мобільні — через html[data-layout="mobile"], щоб вони не перетиналися. */

'use strict';

const DESKTOP_MQ = window.matchMedia('(min-width: 900px) and (min-height: 600px)');

function isDesktopLayout() {
  return DESKTOP_MQ.matches;
}

function applyLayoutAttr() {
  const root = document.documentElement;
  if (!root) return;
  const layout = isDesktopLayout() ? 'desktop' : 'mobile';
  if (root.dataset.layout !== layout) root.dataset.layout = layout;
}

applyLayoutAttr();

if (typeof DESKTOP_MQ.addEventListener === 'function') {
  DESKTOP_MQ.addEventListener('change', applyLayoutAttr);
} else if (typeof DESKTOP_MQ.addListener === 'function') {
  DESKTOP_MQ.addListener(applyLayoutAttr);
}
