'use strict';

// Карта будується з даних MC_WORLD_PATHS (tools/gen-world-map.js).
// Кожен шлях = реальний контур країни з Natural Earth 110m + ISO alpha-2 код.
function buildWorldMapWidget(countryStatsMap, onSelectCountry) {
  const wrap = el('div', 'world-map-card');
  const head = el('div', 'world-map-head');
  head.append(el('span', 'world-map-title', '🗺️ Мапа переглядів'));
  const tip = el('span', 'world-map-tip', 'Торкнися країни');
  head.append(tip);
  wrap.append(head);

  let maxCount = 1;
  for (const st of countryStatsMap.values()) {
    if (st.watched > maxCount) maxCount = st.watched;
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 40 1000 382'); // без Антарктиди (y ≥ 425.8)
  svg.setAttribute('class', 'world-map-svg');

  MC_WORLD_PATHS.forEach(p => {
    const a2 = p.a2;
    const st = a2 ? countryStatsMap.get(a2) : null;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('data-code', a2 || String(p.n));
    path.setAttribute('class', 'world-map-country' + (st ? ' visited' : ''));
    if (st) {
      const ratio = 0.32 + 0.68 * Math.sqrt(st.watched / maxCount);
      path.style.fillOpacity = ratio.toFixed(2);
    }
    path.addEventListener('click', () => {
      svg.querySelectorAll('.world-map-country.selected').forEach(n => n.classList.remove('selected'));
      path.classList.add('selected');
      let meta;
      if (a2 && typeof getCountryMeta === 'function') {
        meta = getCountryMeta(a2);
      } else {
        const flag = a2 && /^[A-Z]{2}$/.test(a2)
          ? String.fromCodePoint(...a2.split('').map(ch => 127397 + ch.charCodeAt(0)))
          : '🌐';
        meta = { flag, name: p.name };
      }
      if (st) {
        const avgStr = st.avg > 0 ? ` · ⭐ ${fmtNum(st.avg)}` : '';
        tip.textContent = `${meta.flag} ${meta.name}: ${st.watched}${avgStr}`;
        tip.classList.add('has-data');
        if (typeof onSelectCountry === 'function') onSelectCountry(a2);
      } else {
        tip.textContent = `${meta.flag} ${meta.name} · ще не відкрито`;
        tip.classList.remove('has-data');
      }
    });
    svg.appendChild(path);
  });

  wrap.append(svg);
  return wrap;
}
