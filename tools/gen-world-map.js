// Генератор даних для src/world-map-data.js
// Джерело: world-atlas@2 countries-110m.json (Natural Earth, public domain)
//   https://unpkg.com/world-atlas@2/countries-110m.json
// ISO alpha-2 ↔ numeric:
//   https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json
// Запуск: node tools/gen-world-map.js  (потрібен інтернет)
'use strict';
const fs = require('fs');

const ATLAS_URL = 'https://unpkg.com/world-atlas@2/countries-110m.json';
const ISO_URL = 'https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json';

// Natural Earth 110m не включає Крим до України — додаємо контур вручну.
// UA малюється після RU, тож цей субшлях перекриває російський контур.
const CRIMEA_POLY = [
  [33.3, 46.15], [34.5, 46.05], [35.6, 45.95], [36.6, 45.5],
  [36.6, 45.3], [36.0, 45.1], [35.3, 44.9], [34.6, 44.65],
  [33.9, 44.40], [33.5, 44.55], [33.2, 45.0], [32.9, 45.3], [32.5, 45.8]
];

async function main() {
  const [atlasRes, isoRes] = await Promise.all([fetch(ATLAS_URL), fetch(ISO_URL)]);
  if (!atlasRes.ok || !isoRes.ok) throw new Error('Не вдалося завантажити джерела');
  const topo = await atlasRes.json();
  const iso = await isoRes.json();

  const a2ByNum = {};
  iso.forEach(r => {
    if (r['alpha-2'] && r['country-code']) a2ByNum[Number(r['country-code'])] = r['alpha-2'];
  });

  const tr = topo.transform;
  const arcs = topo.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]];
    });
  });

  function ringPoints(arcIdx) {
    const pts = [];
    for (const idx of arcIdx) {
      const rev = idx < 0;
      let a = arcs[rev ? ~idx : idx];
      if (rev) a = [...a].reverse();
      if (pts.length) a = a.slice(1);
      for (const p of a) pts.push(p);
    }
    return pts;
  }

  // Контури, що перетинають 180° довготи (Росія, Фіджі, Антарктида),
  // в сирій проєкції дають сегмент через всю карту — звідси «смуги».
  // Розрізаємо такий контур на антимеридіані й замикаємо кожну частину біля краю.
  function splitAtSeam(xy) {
    const ring = xy.slice(0, -1); // остання точка дублює першу
    const n = ring.length;
    const isJump = (a, b) => Math.abs(b[0] - a[0]) > 500;
    let j0 = -1;
    for (let i = 0; i < n; i++) {
      if (isJump(ring[i], ring[(i + 1) % n])) { j0 = i; break; }
    }
    if (j0 < 0) return [xy];

    // Починаємо одразу після розриву, щоб замикаюче ребро теж було розривом.
    const start = (j0 + 1) % n;
    const rot = [];
    for (let k = 0; k < n; k++) rot.push(ring[(start + k) % n]);

    function edgePoint(a, b, entry) {
      const edge = entry ? (b[0] < 500 ? 0 : 1000) : (a[0] > 500 ? 1000 : 0);
      const t = (edge - a[0]) / (b[0] - a[0]);
      return [edge, a[1] + t * (b[1] - a[1])];
    }

    const runs = [];
    let cur = [rot[0]];
    for (let i = 1; i < n; i++) {
      const a = rot[i - 1], b = rot[i];
      if (isJump(a, b)) {
        cur.push(edgePoint(a, b, false));
        runs.push(cur);
        cur = [edgePoint(a, b, true)];
      } else {
        cur.push(b);
      }
    }
    // Останнє ребро (остання → перша точка) — теж розрив.
    // Замикаємо по вихідному краю: цей шлях уже на протилежній стороні,
    // а західний шлях замикається сам на собі на початку цілого кола.
    cur.push(edgePoint(rot[n - 1], rot[0], false));
    runs.push(cur);
    return runs.filter(r => r.length >= 3);
  }

  function toPath(geom) {
    const polys = geom.type === 'Polygon' ? [geom.arcs] : geom.type === 'MultiPolygon' ? geom.arcs : [];
    const parts = [];
    for (const poly of polys) for (const ring of poly) {
      const pts = ringPoints(ring);
      if (pts.length < 3) continue;
      const xy = pts.map(([lon, lat]) => [
        (lon + 180) * (1000 / 360),
        (90 - lat) * (500 / 180)
      ]);
      for (const run of splitAtSeam(xy)) {
        let d = 'M';
        for (let i = 0; i < run.length; i++) {
          d += (i ? 'L' : '') + run[i][0].toFixed(1) + ',' + run[i][1].toFixed(1);
        }
        parts.push(d + 'Z');
      }
    }
    return parts.join('');
  }

  function polyToPath(poly) {
    let d = 'M';
    for (let i = 0; i < poly.length; i++) {
      const [lon, lat] = poly[i];
      d += (i ? 'L' : '') + ((lon + 180) * (1000 / 360)).toFixed(1) + ',' + ((90 - lat) * (500 / 180)).toFixed(1);
    }
    return d + 'Z';
  }

  const paths = topo.objects.countries.geometries
    .filter(g => Number(g.id) !== 10) // Антарктида обрізана viewBox — не возимо її в бандлі
    .map(g => {
      const n = Number(g.id);
      let d = toPath(g);
      if (n === 804 && d) d += ' ' + polyToPath(CRIMEA_POLY); // Україна + Крим
      return d ? { n, a2: a2ByNum[n] || null, name: g.properties.name, d } : null;
    })
    .filter(Boolean);

  // Гонконг відсутній у 110m through detail — додаємо маленький клікабельний маркер
  if (!paths.some(p => p.a2 === 'HK')) {
    const cx = ((114.2 + 180) * (1000 / 360)).toFixed(1);
    const cy = ((90 - 22.3) * (500 / 180)).toFixed(1);
    paths.push({ n: 344, a2: 'HK', name: 'Hong Kong',
      d: `M${(+cx - 1.2).toFixed(1)},${(+cy - 0.9).toFixed(1)}L${(+cx + 1.2).toFixed(1)},${(+cy - 0.9).toFixed(1)}L${(+cx + 1.2).toFixed(1)},${(+cy + 0.9).toFixed(1)}L${(+cx - 1.2).toFixed(1)},${(+cy + 0.9).toFixed(1)}Z` });
  }

  const header = [
    '/* Auto-generated by tools/gen-world-map.js — Do not edit by hand. */',
    '/* Natural Earth 110m via world-atlas@2 (public domain). Equirectangular 1000x500. */',
    '/* n = ISO 3166-1 numeric, a2 = ISO alpha-2, d = SVG path. */',
  ].join('\n') + '\n';
  fs.writeFileSync('src/world-map-data.js', header + 'const MC_WORLD_PATHS = ' + JSON.stringify(paths) + ';\n');
  console.log(`OK: ${paths.length} paths → src/world-map-data.js (${fs.statSync('src/world-map-data.js').size} bytes)`);
}
main().catch(e => { console.error(e); process.exit(1); });
