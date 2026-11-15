'use strict';

// ============ OBSERVATORY SHARE CARD GENERATOR (PURE CANVAS 2D) ============
function shareRoundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function shareFitText(ctx, text, maxW) {
  const str = String(text || '');
  if (ctx.measureText(str).width <= maxW) return str;
  let out = str;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxW) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

function shareWrapLines(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (maxLines && lines.length >= maxLines) break;
    }
  }
  if (cur && (!maxLines || lines.length < maxLines)) lines.push(cur);
  if (maxLines && lines.length === maxLines && words.length) {
    lines[maxLines - 1] = shareFitText(ctx, lines[maxLines - 1], maxW);
  }
  return lines;
}

function drawCanvasTempAvatar(ctx, data, cx, cy, r) {
  const palettes = {
    hot:  ['#ffd166', '#ff7b5c', '#fff3c4'],
    warm: ['#ffb86c', '#9de5c3', '#f2eee9'],
    mild: ['#c5a3ff', '#6b6485', '#e5dcff'],
    cold: ['#60a5fa', '#334155', '#bfdbfe']
  };
  const pal = palettes[data?.tempLevel || 'mild'];
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, pal[0]);
  g.addColorStop(1, pal[1]);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.06);
  ctx.strokeStyle = pal[2];
  ctx.globalAlpha = 0.65;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const ink = data?.tempLevel === 'cold' ? '#0f172a' : '#1a1207';
  const s = r / 30;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.6 * s;

  if (!data || data.empty) {
    ctx.beginPath();
    ctx.moveTo(cx - 12 * s, cy - 3 * s); ctx.quadraticCurveTo(cx - 8 * s, cy + 1 * s, cx - 4 * s, cy - 3 * s);
    ctx.moveTo(cx + 4 * s, cy - 3 * s);  ctx.quadraticCurveTo(cx + 8 * s, cy + 1 * s, cx + 12 * s, cy - 3 * s);
    ctx.moveTo(cx - 5 * s, cy + 10 * s); ctx.lineTo(cx + 5 * s, cy + 10 * s);
    ctx.stroke();
  } else if (data.tempLevel === 'cold') {
    ctx.beginPath();
    ctx.moveTo(cx - 14 * s, cy - 7 * s); ctx.lineTo(cx - 5 * s, cy - 4 * s);
    ctx.moveTo(cx + 14 * s, cy - 7 * s); ctx.lineTo(cx + 5 * s, cy - 4 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - 9 * s, cy - 1 * s, 2.5 * s, 0, Math.PI * 2);
    ctx.arc(cx + 9 * s, cy - 1 * s, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 9 * s, cy + 12 * s);
    ctx.quadraticCurveTo(cx, cy + 6 * s, cx + 9 * s, cy + 12 * s);
    ctx.stroke();
  } else if (data.mood === 'intense') {
    shareRoundRect(ctx, cx - 17 * s, cy - 8 * s, 14 * s, 8.5 * s, 2.5 * s); ctx.fill();
    shareRoundRect(ctx, cx + 3 * s, cy - 8 * s, 14 * s, 8.5 * s, 2.5 * s); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 3 * s, cy - 4.5 * s); ctx.lineTo(cx + 3 * s, cy - 4.5 * s);
    ctx.moveTo(cx - 9 * s, cy + 9 * s); ctx.quadraticCurveTo(cx + 1 * s, cy + 15 * s, cx + 11 * s, cy + 6 * s);
    ctx.stroke();
  } else if (data.mood === 'thoughtful') {
    ctx.beginPath();
    ctx.arc(cx - 9.5 * s, cy - 3 * s, 6 * s, 0, Math.PI * 2);
    ctx.arc(cx + 9.5 * s, cy - 3 * s, 6 * s, 0, Math.PI * 2);
    ctx.moveTo(cx - 3.5 * s, cy - 3 * s); ctx.lineTo(cx + 3.5 * s, cy - 3 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - 9.5 * s, cy - 3 * s, 2.3 * s, 0, Math.PI * 2);
    ctx.arc(cx + 9.5 * s, cy - 3 * s, 2.3 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 9 * s, cy + 9 * s); ctx.quadraticCurveTo(cx, cy + 15 * s, cx + 9 * s, cy + 9 * s);
    ctx.stroke();
  } else if (data.mood === 'epic') {
    const drawStar = (sx, sy, sr) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? sr : sr * 0.45;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = sx + Math.cos(a) * rad, py = sy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    };
    drawStar(cx - 9 * s, cy - 3 * s, 6.2 * s);
    drawStar(cx + 9 * s, cy - 3 * s, 6.2 * s);
    ctx.beginPath();
    ctx.moveTo(cx - 10 * s, cy + 8 * s); ctx.quadraticCurveTo(cx, cy + 16 * s, cx + 10 * s, cy + 8 * s);
    ctx.stroke();
  } else if (data.tempLevel === 'hot') {
    ctx.beginPath();
    ctx.moveTo(cx - 14 * s, cy - 2 * s); ctx.quadraticCurveTo(cx - 9 * s, cy - 9 * s, cx - 4 * s, cy - 2 * s);
    ctx.moveTo(cx + 4 * s, cy - 2 * s);  ctx.quadraticCurveTo(cx + 9 * s, cy - 9 * s, cx + 14 * s, cy - 2 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 11 * s, cy + 6 * s); ctx.quadraticCurveTo(cx, cy + 18 * s, cx + 11 * s, cy + 6 * s);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx - 9 * s, cy - 3 * s, 3 * s, 0, Math.PI * 2);
    ctx.arc(cx + 9 * s, cy - 3 * s, 3 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 9 * s, cy + 8 * s); ctx.quadraticCurveTo(cx, cy + 14 * s, cx + 9 * s, cy + 8 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShareStatBox(ctx, x, y, w, h, value, label, theme, accent, rgb) {
  shareRoundRect(ctx, x, y, w, h, 24);
  ctx.fillStyle = theme.bg1;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(${rgb}, 0.25)`;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = '800 50px ui-monospace, "SF Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(shareFitText(ctx, String(value), w - 36), x + w / 2, y + h * 0.50);

  ctx.fillStyle = theme.textMuted;
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillText(shareFitText(ctx, label, w - 36), x + w / 2, y + h * 0.78);
  ctx.textAlign = 'left';
}

function drawShareRankRows(ctx, rows, x, startY, w, rowH, gap, theme, accent, rgb, opts = {}) {
  const titlePx = opts.titlePx || 28;
  const subPx = opts.subPx || 21;
  const rankPx = opts.rankPx || 28;
  const rightPx = opts.rightPx || 30;
  const rad = opts.radius || 20;
  rows.forEach((r, idx) => {
    const ry = startY + idx * (rowH + gap);
    shareRoundRect(ctx, x, ry, w, rowH, rad);
    ctx.fillStyle = theme.bg1;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.stroke();

    // Rank / Icon
    ctx.fillStyle = idx < 3 ? accent : theme.textMuted;
    ctx.font = `800 ${rankPx}px ui-monospace, "SF Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(r.left || String(idx + 1), x + 44, ry + rowH * 0.60);

    // Title
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.text;
    ctx.font = `700 ${titlePx}px system-ui, -apple-system, sans-serif`;
    const titleX = x + 84;
    const rightSpace = 165;
    ctx.fillText(shareFitText(ctx, r.title, w - 84 - rightSpace), titleX, ry + (r.sub ? rowH * 0.44 : rowH * 0.59));

    if (r.sub) {
      ctx.fillStyle = theme.textMuted;
      ctx.font = `500 ${subPx}px ui-monospace, "SF Mono", monospace`;
      ctx.fillText(shareFitText(ctx, r.sub, w - 84 - rightSpace), titleX, ry + rowH * 0.76);
    }

    // Progress bar (optional)
    if (typeof r.pct === 'number') {
      const bw = w - 84 - rightSpace;
      const by = ry + rowH - 16;
      shareRoundRect(ctx, titleX, by, bw, 6, 3);
      ctx.fillStyle = theme.bg3;
      ctx.fill();
      if (r.pct > 0) {
        const g = ctx.createLinearGradient(titleX, by, titleX + bw, by);
        g.addColorStop(0, accent);
        g.addColorStop(1, '#9de5c3');
        shareRoundRect(ctx, titleX, by, Math.max(8, bw * Math.min(1, r.pct)), 6, 3);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }

    // Right value
    ctx.textAlign = 'right';
    ctx.fillStyle = r.rightColor || accent;
    ctx.font = `800 ${rightPx}px ui-monospace, "SF Mono", monospace`;
    ctx.fillText(String(r.right || ''), x + w - 28, ry + rowH * 0.57);
    ctx.textAlign = 'left';
  });
}

function renderObservatoryShareCanvas(tabId, format) {
  const W = 1080;
  const H = format === 'story' ? 1920 : 1350;
  const isStory = format === 'story';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const theme = THEMES[settings.themeBg] || THEMES.navy;
  const ac = ACCENTS[settings.themeAccent] || ACCENTS.amber;
  const accent = ac.accent;
  const rgb = typeof hexToRgb === 'function' ? hexToRgb(accent) : '255,184,108';

  // Background
  ctx.fillStyle = theme.bg0;
  ctx.fillRect(0, 0, W, H);

  const g1 = ctx.createRadialGradient(W * 0.14, H * 0.08, 40, W * 0.14, H * 0.08, W * 0.85);
  g1.addColorStop(0, `rgba(${rgb}, 0.20)`);
  g1.addColorStop(1, 'transparent');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(W * 0.88, H * 0.92, 30, W * 0.88, H * 0.92, W * 0.75);
  g2.addColorStop(0, 'rgba(197, 163, 255, 0.14)');
  g2.addColorStop(1, 'transparent');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // Outer card frame
  const pad = 64;
  shareRoundRect(ctx, 28, 28, W - 56, H - 56, 36);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(${rgb}, 0.22)`;
  ctx.stroke();

  const topFilter = state.topTypeFilter || 'all';
  const topTitle = topFilter === 'movie'
    ? 'Мій топ-10 фільмів'
    : (topFilter === 'tv' ? 'Мій топ-10 серіалів' : 'Мій топ-10');
  const topSub = topFilter === 'movie'
    ? 'MY TOP 10 · MOVIES'
    : (topFilter === 'tv' ? 'MY TOP 10 · TV SERIES' : 'MY TOP 10 · ALL');

  const TAB_TITLES = {
    mytop:      [topTitle, topSub],
    taste:      ['ДНК мого смаку', 'TASTE OBSERVATORY'],
    series:     ['Серіальний марафон', 'SERIES PROGRESS'],
    franchises: ['Мої франшизи', 'FRANCHISES'],
    countries:  ['Кіно-мандрівка', 'COUNTRIES'],
    streaming:  ['Де я дивлюсь', 'STREAMING PLATFORMS'],
    elo:        ['Цар гори · Elo', 'ELO LEADERBOARD'],
    actors:     [state.stats.actorTab === 'count' ? 'Улюблені за переглядами' : 'Топ акторів за оцінкою', 'ACTORS RANKING'],
    genres:     ['Мої жанри', 'TOP GENRES'],
    detail:     ['Мій кінощоденник', 'LIBRARY SUMMARY']
  };
  const [heading, subLabel] = TAB_TITLES[tabId] || ['Обсерваторія', 'OBSERVATORY'];

  // Header
  ctx.fillStyle = accent;
  ctx.font = 'italic 800 44px Georgia, serif';
  ctx.fillText('MyCinema', pad, isStory ? 128 : 110);

  ctx.textAlign = 'right';
  ctx.fillStyle = theme.textMuted;
  ctx.font = '700 22px ui-monospace, "SF Mono", monospace';
  ctx.fillText(new Date().toLocaleDateString('uk-UA'), W - pad, isStory ? 124 : 106);
  ctx.textAlign = 'left';

  ctx.fillStyle = accent;
  ctx.font = '700 21px ui-monospace, "SF Mono", monospace';
  ctx.fillText(subLabel, pad, isStory ? 196 : 168);

  ctx.fillStyle = theme.text;
  ctx.font = '800 58px Georgia, serif';
  ctx.fillText(shareFitText(ctx, heading, W - pad * 2), pad, isStory ? 268 : 234);

  const bodyTop = isStory ? 320 : 276;
  const bodyW = W - pad * 2;
  const footerY = H - 84;
  const maxBodyH = footerY - 36 - bodyTop;

  // Content per tab
  if (tabId === 'mytop') {
    let rated = Object.values(lib).map(x => ({ item: x, r: computeItemRating(x) })).filter(x => x.r.avg > 0);
    if (topFilter !== 'all') rated = rated.filter(x => x.item.type === topFilter);
    rated.sort((a, b) => {
      const diff = b.r.avg - a.r.avg;
      if (Math.abs(diff) > 0.001) return diff;
      const eloDiff = (b.item.elo || ELO_START) - (a.item.elo || ELO_START);
      if (eloDiff !== 0) return eloDiff;
      return (b.item.updated || 0) - (a.item.updated || 0);
    });
    const rows = rated.slice(0, 10).map(({ item, r }) => {
      const typeLbl = item.type === 'tv' ? 'Серіал' : 'Фільм';
      const subParts = [typeLbl];
      if (item.year) subParts.push(item.year);
      if (item.eloGames > 1) subParts.push(`Elo ${Math.round(item.elo || ELO_START)}`);
      const scoreColor = r.avg >= 8 ? '#9de5c3' : (r.avg >= 6 ? accent : '#ff5c5c');
      return {
        title: item.title || '',
        sub: subParts.join(' · '),
        right: fmtNum(r.avg) + (r.complete ? '' : '…'),
        rightColor: scoreColor
      };
    });
    if (isStory) {
      // 10 рядків у 9:16: 10*124 + 9*16 = 1384px (влазить із запасом у 1444px)
      drawShareRankRows(ctx, rows, pad, bodyTop, bodyW, 124, 16, theme, accent, rgb, {
        titlePx: 28, subPx: 20, rankPx: 28, rightPx: 30, radius: 20
      });
    } else {
      // 10 рядків у 4:5: 10*80 + 9*10 = 890px (влазить із запасом у 922px)
      drawShareRankRows(ctx, rows, pad, bodyTop, bodyW, 80, 10, theme, accent, rgb, {
        titlePx: 25, subPx: 18, rankPx: 24, rightPx: 27, radius: 16
      });
    }
  } else if (tabId === 'taste') {
    const taste = computeTasteVector();
    const avatar = typeof computeTempAvatarData === 'function' ? computeTempAvatarData() : null;

    let cy = bodyTop;
    if (avatar && !avatar.empty) {
      const avH = isStory ? 210 : 178;
      shareRoundRect(ctx, pad, cy, bodyW, avH, 28);
      ctx.fillStyle = theme.bg1;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(${rgb}, 0.25)`;
      ctx.stroke();

      drawCanvasTempAvatar(ctx, avatar, pad + 92, cy + avH / 2, isStory ? 56 : 48);

      ctx.fillStyle = theme.text;
      ctx.font = 'italic 700 36px Georgia, serif';
      ctx.fillText(shareFitText(ctx, avatar.title, bodyW - 200), pad + 172, cy + avH * 0.42);

      const sign = avatar.delta >= 0 ? '+' : '−';
      ctx.fillStyle = accent;
      ctx.font = '800 24px ui-monospace, "SF Mono", monospace';
      ctx.fillText(`${fmtNum(avatar.avg)}/10 (${sign}${fmtNum(Math.abs(avatar.delta))}) · ${avatar.moodLabel}`, pad + 172, cy + avH * 0.68);
      cy += avH + (isStory ? 44 : 26);
    }

    if (taste && taste.count >= 3) {
      const radSize = isStory ? 460 : 350;
      const rcx = W / 2;
      const rcy = cy + radSize * 0.50;
      const rMax = radSize * 0.34;
      const n = RATING_CRITERIA.length;

      // Grid rings
      for (let lv = 1; lv <= 4; lv++) {
        const lr = (rMax * lv) / 4;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          const px = rcx + lr * Math.cos(a), py = rcy + lr * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // Axes + labels
      RATING_CRITERIA.forEach((c, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        ctx.beginPath();
        ctx.moveTo(rcx, rcy);
        ctx.lineTo(rcx + rMax * Math.cos(a), rcy + rMax * Math.sin(a));
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.stroke();

        const lx = rcx + (rMax + 46) * Math.cos(a);
        const ly = rcy + (rMax + 46) * Math.sin(a);
        ctx.fillStyle = theme.textSecondary;
        ctx.font = '700 24px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${c.label} · ${fmtNum(taste[c.key] || 0)}`, lx, ly + 8);
      });
      ctx.textAlign = 'left';

      // Polygon
      ctx.beginPath();
      RATING_CRITERIA.forEach((c, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const v = (taste[c.key] || 0) / 10;
        const px = rcx + rMax * v * Math.cos(a), py = rcy + rMax * v * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = `rgba(${rgb}, 0.24)`;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = accent;
      ctx.stroke();

      RATING_CRITERIA.forEach((c, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const v = (taste[c.key] || 0) / 10;
        ctx.beginPath();
        ctx.arc(rcx + rMax * v * Math.cos(a), rcy + rMax * v * Math.sin(a), 7, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      });

      const insY = cy + radSize + 18;
      const ins = typeof renderTasteInsight === 'function' ? renderTasteInsight(taste) : null;
      if (ins && ins.desc && insY + 130 < footerY) {
        const cleanDesc = ins.desc.replace(/<[^>]+>/g, '');
        shareRoundRect(ctx, pad, insY, bodyW, 130, 22);
        ctx.fillStyle = `rgba(${rgb}, 0.10)`;
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.fillRect(pad, insY + 18, 6, 94);

        ctx.fillStyle = theme.textSecondary;
        ctx.font = '600 26px system-ui, sans-serif';
        const lines = shareWrapLines(ctx, cleanDesc, bodyW - 64, 3);
        lines.forEach((ln, i) => ctx.fillText(ln, pad + 30, insY + 46 + i * 36));
      }
    }
  } else if (tabId === 'series') {
    const allTv = Object.values(lib).filter(x => x.type === 'tv');
    const wt = computeWatchTimeStats();
    const watching = allTv.filter(x => x.status === 'watching').length;
    const watched = allTv.filter(x => x.status === 'watched').length;

    const cardW = (bodyW - 24) / 2;
    const cardH = isStory ? 170 : 142;
    drawShareStatBox(ctx, pad, bodyTop, cardW, cardH, wt.tvEpsWatched, 'Переглянуто серій', theme, accent, rgb);
    drawShareStatBox(ctx, pad + cardW + 24, bodyTop, cardW, cardH, fmtDuration(wt.tvMin).split(' ')[0] + ' год', 'Час у серіалах', theme, accent, rgb);
    drawShareStatBox(ctx, pad, bodyTop + cardH + 20, cardW, cardH, watched, 'Завершено', theme, accent, rgb);
    drawShareStatBox(ctx, pad + cardW + 24, bodyTop + cardH + 20, cardW, cardH, watching, 'У процесі зараз', theme, accent, rgb);

    const byTime = allTv.map(x => {
      let eps = (x.watchedEpisodes && x.watchedEpisodes.length) || 0;
      if (x.status === 'watched' && (x.episode_count || 0) > eps) eps = x.episode_count;
      return { item: x, eps, mins: x.runtime > 0 ? eps * x.runtime : 0 };
    }).filter(x => x.eps > 0).sort((a, b) => b.mins - a.mins || b.eps - a.eps);

    const maxV = byTime[0]?.mins || byTime[0]?.eps || 1;
    const rowsStart = bodyTop + cardH * 2 + 56;
    const maxRows = isStory ? 6 : 4;
    const rows = byTime.slice(0, maxRows).map(x => ({
      title: x.item.title,
      sub: `${x.eps} ${plural(x.eps, 'серія', 'серії', 'серій')}`,
      right: x.mins > 0 ? fmtDuration(x.mins) : `${x.eps} с.`,
      pct: (x.mins || x.eps) / maxV
    }));
    drawShareRankRows(ctx, rows, pad, rowsStart, bodyW, isStory ? 116 : 96, 16, theme, accent, rgb);
  } else if (tabId === 'franchises') {
    const movies = Object.values(lib).filter(x => x.type === 'movie' && x.collection && x.collection.id);
    const colCache = typeof readColCache === 'function' ? readColCache() : {};
    const colMap = new Map();
    movies.forEach(m => {
      const cid = m.collection.id;
      if (!colMap.has(cid)) colMap.set(cid, { id: cid, name: m.collection.name || 'Франшиза', inLib: [] });
      colMap.get(cid).inLib.push(m);
    });
    const frs = [...colMap.values()].map(c => {
      const cached = colCache[c.id];
      const parts = cached?.parts?.length || c.inLib.length;
      const watched = c.inLib.filter(hasWatched).length;
      const rated = c.inLib.map(x => computeItemRating(x).avg).filter(v => v > 0);
      const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
      return {
        name: (cached?.name || c.name).replace(/\s*\(Колекція\)\s*$/i, '').replace(/\s*Collection\s*$/i, ''),
        watched,
        total: Math.max(parts, watched),
        avg,
        pct: Math.min(1, watched / Math.max(parts, watched, 1))
      };
    }).sort((a, b) => b.watched - a.watched || b.avg - a.avg);

    const cardW = (bodyW - 24) / 2;
    const cardH = isStory ? 160 : 138;
    const doneAll = frs.filter(f => f.total >= 2 && f.watched >= f.total).length;
    drawShareStatBox(ctx, pad, bodyTop, cardW, cardH, frs.length, 'Франшиз усього', theme, accent, rgb);
    drawShareStatBox(ctx, pad + cardW + 24, bodyTop, cardW, cardH, doneAll, 'Завершено повністю', theme, accent, rgb);

    const rowsStart = bodyTop + cardH + 34;
    const maxRows = isStory ? 8 : 5;
    const rows = frs.slice(0, maxRows).map(f => ({
      title: f.name,
      sub: `${f.watched} з ${f.total} фільмів`,
      right: f.avg > 0 ? `★ ${fmtNum(f.avg)}` : `${Math.round(f.pct * 100)}%`,
      pct: f.pct
    }));
    drawShareRankRows(ctx, rows, pad, rowsStart, bodyW, isStory ? 114 : 96, 16, theme, accent, rgb);
  } else if (tabId === 'countries') {
    const items = Object.values(lib).filter(x => hasWatched(x) && Array.isArray(x.countries) && x.countries.length > 0);
    const cMap = new Map();
    let nonUs = 0;
    items.forEach(it => {
      const avg = computeItemRating(it).avg;
      if (!(it.countries.length === 1 && it.countries[0] === 'US')) nonUs++;
      it.countries.forEach(code => {
        const m = typeof getCountryMeta === 'function' ? getCountryMeta(code) : { code, flag: '🌐', name: code };
        if (!cMap.has(m.code)) cMap.set(m.code, { ...m, watched: 0, mCnt: 0, tCnt: 0, sum: 0, cnt: 0 });
        const st = cMap.get(m.code);
        st.watched++;
        if (it.type === 'movie') st.mCnt++; else st.tCnt++;
        if (avg > 0) { st.sum += avg; st.cnt++; }
      });
    });
    const list = [...cMap.values()].map(c => ({ ...c, avg: c.cnt ? c.sum / c.cnt : 0 })).sort((a, b) => b.watched - a.watched || b.avg - a.avg);
    const cardW = (bodyW - 24) / 2;
    const cardH = isStory ? 160 : 138;
    const nonUsPct = items.length ? Math.round((nonUs / items.length) * 100) : 0;
    drawShareStatBox(ctx, pad, bodyTop, cardW, cardH, list.length, 'Країн відкрито', theme, accent, rgb);
    drawShareStatBox(ctx, pad + cardW + 24, bodyTop, cardW, cardH, `${nonUsPct}%`, 'Не-американське кіно', theme, accent, rgb);

    const maxW = list[0]?.watched || 1;
    const rowsStart = bodyTop + cardH + 34;
    const maxRows = isStory ? 8 : 5;
    const rows = list.slice(0, maxRows).map(c => ({
      left: c.flag,
      title: c.name,
      sub: `${c.watched} ${plural(c.watched, 'тайтл', 'тайтли', 'тайтлів')} · ${c.mCnt} ф. · ${c.tCnt} с.`,
      right: c.avg > 0 ? `★ ${fmtNum(c.avg)}` : String(c.watched),
      pct: c.watched / maxW
    }));
    drawShareRankRows(ctx, rows, pad, rowsStart, bodyW, isStory ? 114 : 96, 16, theme, accent, rgb);
  } else if (tabId === 'streaming') {
    const items = Object.values(lib).filter(x => hasWatched(x) && x.platforms?.length);
    const pMap = new Map();
    items.forEach(it => {
      const avg = computeItemRating(it).avg;
      it.platforms.forEach(p => {
        if (!pMap.has(p.key)) pMap.set(p.key, { name: p.name, watched: 0, sum: 0, cnt: 0 });
        const st = pMap.get(p.key);
        st.watched++;
        if (avg > 0) { st.sum += avg; st.cnt++; }
      });
    });
    const list = [...pMap.values()].sort((a, b) => b.watched - a.watched);
    const maxW = list[0]?.watched || 1;
    const maxRows = isStory ? 9 : 6;
    const rows = list.slice(0, maxRows).map(p => ({
      title: p.name,
      sub: p.cnt ? `сер. оцінка ★ ${fmtNum(p.sum / p.cnt)}` : '',
      right: String(p.watched),
      pct: p.watched / maxW
    }));
    drawShareRankRows(ctx, rows, pad, bodyTop, bodyW, isStory ? 120 : 102, 18, theme, accent, rgb);
  } else if (tabId === 'elo') {
    const list = Object.values(lib).filter(x => x.eloGames && x.eloGames > 0).sort((a, b) => (b.elo || ELO_START) - (a.elo || ELO_START));
    const maxRows = isStory ? 10 : 7;
    const rows = list.slice(0, maxRows).map(x => ({
      title: x.title,
      sub: `${x.eloGames} ${plural(x.eloGames, 'матч', 'матчі', 'матчів')}`,
      right: String(Math.round(x.elo || ELO_START))
    }));
    drawShareRankRows(ctx, rows, pad, bodyTop, bodyW, isStory ? 110 : 94, 16, theme, accent, rgb);
  } else if (tabId === 'actors') {
    const { actors: actorMap } = computeActorProfiles();
    const byCount = state.stats.actorTab === 'count';
    const list = [...actorMap.values()]
      .filter(a => byCount ? a.watchedCount >= 1 : a.ratedCount >= 1)
      .sort((a, b) => byCount ? (b.watchedCount - a.watchedCount || b.score - a.score) : (b.score - a.score || b.effCount - a.effCount));
    const maxRows = isStory ? 10 : 7;
    const rows = list.slice(0, maxRows).map(a => ({
      title: a.name,
      sub: byCount ? `${a.watchedCount} переглядів` : `${a.ratedCount} проєктів · каст ${fmtNum(a.rawAvg)}`,
      right: byCount ? String(a.watchedCount) : fmtNum(a.score)
    }));
    drawShareRankRows(ctx, rows, pad, bodyTop, bodyW, isStory ? 110 : 94, 16, theme, accent, rgb);
  } else if (tabId === 'genres') {
    const gc = {};
    Object.values(lib).forEach(x => (x.genres || []).forEach(gid => {
      const g = GENRES.find(gg => gg.id === gid);
      if (g) gc[g.name] = (gc[g.name] || 0) + 1;
    }));
    const list = Object.entries(gc).sort((a, b) => b[1] - a[1]);
    const maxG = list[0]?.[1] || 1;
    const maxRows = isStory ? 10 : 7;
    const rows = list.slice(0, maxRows).map(([name, cnt]) => ({
      title: name,
      right: String(cnt),
      pct: cnt / maxG
    }));
    drawShareRankRows(ctx, rows, pad, bodyTop, bodyW, isStory ? 110 : 94, 16, theme, accent, rgb);
  } else {
    // detail
    const all = Object.values(lib);
    const wt = computeWatchTimeStats();
    const rated = all.map(x => computeItemRating(x).avg).filter(v => v > 0);
    const avgAll = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
    const movies = all.filter(x => x.type === 'movie').length;
    const tvs = all.filter(x => x.type === 'tv').length;

    const cardW = (bodyW - 24) / 2;
    const cardH = isStory ? 175 : 145;
    drawShareStatBox(ctx, pad, bodyTop, cardW, cardH, fmtDuration(wt.totalMin).split(' ')[0] + ' год', 'Усього в кіно', theme, accent, rgb);
    drawShareStatBox(ctx, pad + cardW + 24, bodyTop, cardW, cardH, all.length, 'Усього в бібліотеці', theme, accent, rgb);
    drawShareStatBox(ctx, pad, bodyTop + cardH + 22, cardW, cardH, `${movies} / ${tvs}`, 'Фільми / Серіали', theme, accent, rgb);
    drawShareStatBox(ctx, pad + cardW + 24, bodyTop + cardH + 22, cardW, cardH, avgAll > 0 ? fmtNum(avgAll) : '—', 'Середня оцінка', theme, accent, rgb);

    // Mini rating histogram
    const dist = {};
    for (let i = 1; i <= 10; i++) dist[i] = 0;
    rated.forEach(v => { const r = Math.round(v); if (r >= 1 && r <= 10) dist[r]++; });
    const maxD = Math.max(...Object.values(dist), 1);
    const histY = bodyTop + cardH * 2 + 76;
    const availH = footerY - 60 - histY;
    const barRowH = Math.min(48, Math.floor(availH / 10));

    for (let s = 10; s >= 1; s--) {
      const idx = 10 - s;
      const ry = histY + idx * barRowH;
      if (ry + 28 > footerY - 40) break;
      ctx.fillStyle = theme.textMuted;
      ctx.font = '700 21px ui-monospace, "SF Mono", monospace';
      ctx.fillText(String(s).padStart(2, ' '), pad, ry + 22);

      const bx = pad + 54;
      const bw = bodyW - 120;
      shareRoundRect(ctx, bx, ry + 5, bw, 20, 10);
      ctx.fillStyle = theme.bg3;
      ctx.fill();
      if (dist[s] > 0) {
        const fw = Math.max(18, (dist[s] / maxD) * bw);
        const g = ctx.createLinearGradient(bx, ry, bx + bw, ry);
        g.addColorStop(0, accent);
        g.addColorStop(1, '#ff7b5c');
        shareRoundRect(ctx, bx, ry + 5, fw, 20, 10);
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = theme.textSecondary;
      ctx.fillText(String(dist[s]), W - pad, ry + 22);
      ctx.textAlign = 'left';
    }
  }

  // Footer
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, footerY - 48);
  ctx.lineTo(W - pad, footerY - 48);
  ctx.stroke();

  const totalAll = Object.keys(lib).length;
  const totalWatched = Object.values(lib).filter(hasWatched).length;
  ctx.fillStyle = theme.textMuted;
  ctx.font = '600 22px ui-monospace, "SF Mono", monospace';
  ctx.fillText('mycinema · особистий кінощоденник', pad, footerY);
  ctx.textAlign = 'right';
  ctx.fillStyle = accent;
  ctx.fillText(`${totalWatched} переглянуто · ${totalAll} усього`, W - pad, footerY);
  ctx.textAlign = 'left';

  return canvas;
}

function openObservatoryShare(tabId) {
  document.querySelectorAll('.share-modal-overlay').forEach(x => x.remove());
  let currentFormat = 'story';
  let currentBlob = null;
  let currentUrl = null;

  const modal = el('div', 'share-modal-overlay');
  const boxEl = el('div', 'share-modal-box');

  const head = el('div', 'share-modal-head');
  const fileTag = tabId === 'mytop' ? ('top10-' + (state.topTypeFilter || 'all')) : tabId;
  head.append(el('h3', '', '📤 Поділитися'));
  const closeBtn = el('button', 'settings-close', '✕');
  const cleanup = () => {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    modal.remove();
  };
  closeBtn.onclick = cleanup;
  head.append(closeBtn);
  boxEl.append(head);

  const fmtBar = el('div', 'share-fmt-bar');
  const btnStory = el('button', 'recs-mode-pill active', '📱 Stories 9:16');
  const btnPost = el('button', 'recs-mode-pill', '💬 Пост 4:5');
  fmtBar.append(btnStory, btnPost);
  boxEl.append(fmtBar);

  const imgWrap = el('div', 'share-preview-wrap');
  const previewImg = el('img', 'share-preview-img');
  previewImg.alt = 'MyCinema Share Card';
  imgWrap.append(previewImg);
  boxEl.append(imgWrap);

  const actions = el('div', 'share-modal-actions');
  const shareBtn = el('button', 'auth-btn primary', '📤 Поділитися');
  const copyBtn = el('button', 'settings-btn', '📋 Копіювати');
  const saveBtn = el('button', 'settings-btn', '💾 Зберегти PNG');

  const canNativeFileShare = () => {
    try {
      if (!navigator.share || !navigator.canShare) return false;
      const testFile = new File([new Blob(['a'], { type: 'image/png' })], 'test.png', { type: 'image/png' });
      return navigator.canShare({ files: [testFile] });
    } catch { return false; }
  };
  if (!canNativeFileShare()) shareBtn.style.display = 'none';

  const renderPreview = () => {
    const canvas = renderObservatoryShareCanvas(tabId, currentFormat);
    canvas.toBlob((blob) => {
      if (!blob) return;
      currentBlob = blob;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = URL.createObjectURL(blob);
      previewImg.src = currentUrl;
    }, 'image/png');
  };

  btnStory.onclick = () => {
    if (currentFormat === 'story') return;
    currentFormat = 'story';
    btnStory.classList.add('active');
    btnPost.classList.remove('active');
    renderPreview();
  };
  btnPost.onclick = () => {
    if (currentFormat === 'post') return;
    currentFormat = 'post';
    btnPost.classList.add('active');
    btnStory.classList.remove('active');
    renderPreview();
  };

  shareBtn.onclick = async () => {
    if (!currentBlob) return;
    try {
      const file = new File([currentBlob], `mycinema-${tabId}-${currentFormat}.png`, { type: 'image/png' });
      await navigator.share({ files: [file], title: 'MyCinema · Обсерваторія' });
    } catch (e) {
      if (e && e.name !== 'AbortError') showSyncToast('⚠️ Не вдалося поділитися');
    }
  };

  copyBtn.onclick = async () => {
    if (!currentBlob) return;
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('no-clip');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': currentBlob })]);
      showSyncToast('📋 Скопійовано в буфер');
    } catch {
      showSyncToast('ℹ️ Натисни «Зберегти» або затисни фото');
    }
  };

  saveBtn.onclick = () => {
    if (!currentUrl) return;
    const a = document.createElement('a');
    a.href = currentUrl;
    a.download = `mycinema-${tabId}-${currentFormat}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showSyncToast('💾 Збережено PNG');
  };

  actions.append(shareBtn, copyBtn, saveBtn);
  boxEl.append(actions);
  modal.append(boxEl);
  modal.onclick = (e) => { if (e.target === modal) cleanup(); };
  document.body.append(modal);
  renderPreview();
}
