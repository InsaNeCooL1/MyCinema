/* FIX-MOBILE-SKELETON
   ─────────────────────────────────────────────────────────────
   Скелет мобільної картки (без CSS, без стилів).
   Тільки логіка побудови DOM та обробники подій.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function renderMobileCard(ctx, scroll) {
    /* FIX-RETURN-TABS */
    const r = ctx.item;
    const d = ctx.details;
    const s = lib[r.key] || {};

    scroll.innerHTML = '';
    const root = el('div', 'card-mobile-root');

    root.append(createHero(ctx));
    root.append(createTitle(ctx));
    root.append(createActions(ctx));
    root.append(createStatuses(ctx));
    root.append(createOverview(ctx));
    root.append(createScoreBlock(ctx));
    
    // Повертаємо таби
    root.append(createTabs(ctx));

    scroll.append(root);
  }

  function createHero(ctx) {
    /* FIX-ACTIONS-REWORK-HERO */
    const r = ctx.item;
    const d = ctx.details;
    const s = lib[r.key] || {};
    const wrap = el('div', 'mobile-hero');

    const backdropPath = r.backdrop || d.backdrop_path || r.poster;
    const trailerList = findAllTrailers(d.videos, d.original_language);

    if (ctx.playingTrailer && trailerList.length > 0) {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube.com/embed/${trailerList[0].key}?autoplay=1`;
      iframe.allow = "autoplay; encrypted-media";
      iframe.allowFullscreen = true;
      iframe.className = 'card-hero-video'; /* FIX-TRAILER-BG — додаємо клас, щоб engine.js міг його зупинити */
      wrap.append(iframe);
      
      const stopBtn = el('button', 'btn-stop', 'Зупинити трейлер');
      stopBtn.onclick = (e) => { e.stopPropagation(); ctx.playingTrailer = false; renderCard(); };
      wrap.append(stopBtn);
    } else {
      if (backdropPath) {
        const img = el('img', 'hero-img');
        img.src = TMDB_IMG + 'w1280' + backdropPath;
        wrap.append(img);
      }
      if (trailerList.length > 0) {
        const playBtn = el('button', 'btn-play', '▶ Дивитись трейлер');
        playBtn.onclick = () => { ctx.playingTrailer = true; renderCard(); };
        wrap.append(playBtn);
      }
      /* FIX-HERO-BADGE-TEMP */
    const userRating = computeItemRating(s);
      if (userRating.avg > 0) {
        const val = userRating.avg * 10;
        let badgeCls = 'temp-red';
        if (val >= 80) badgeCls = 'temp-green';
        else if (val >= 66) badgeCls = 'temp-yellow';
        else if (val >= 55) badgeCls = 'temp-orange';
        
        wrap.append(el('div', 'hero-badge ' + badgeCls, fmtNum(userRating.avg)));
      }
    }

    // Кнопка Улюблене (правий верхній кут)
    /* FIX-HIDE-FAV-TRAILER */
    if (!ctx.playingTrailer) {
      const favBtn = el('button', 'hero-fav-btn' + (s.favorite ? ' active' : ''));
      favBtn.innerHTML = s.favorite
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
      favBtn.onclick = (e) => { e.stopPropagation(); update(r, { favorite: !s.favorite }); };
      wrap.append(favBtn);
    }

    return wrap;
  }

  function createTitle(ctx) {
    /* FIX-AGE-RIGHT */
    const d = ctx.details;
    const r = ctx.item;
    const wrap = el('div', 'mobile-title');
    
    // 1. Головна назва
    const titleRow = el('div', 'title-header-row');
    if (r.type === 'tv') {
      titleRow.append(el('div', 'tv-icon-badge', 'TV'));
    }
    titleRow.append(el('h1', 'title-main', d.title || d.name));
    wrap.append(titleRow);

    // Попередній розрахунок вікового рейтингу
    let ageRating = null;
    if (r.type === 'movie' && d.release_dates && d.release_dates.results) {
      const regions = ['UA', 'US', 'GB'];
      for (const reg of regions) {
        const regData = d.release_dates.results.find(x => x.iso_3166_1 === reg);
        if (regData && regData.release_dates) {
          const certObj = regData.release_dates.find(x => x.certification);
          if (certObj) { ageRating = certObj.certification; break; }
        }
      }
      if (ageRating) {
        const map = { 'G': '0+', 'PG': '12+', 'PG-13': '13+', 'R': '17+', 'NC-17': '18+', 'NR': '—' };
        ageRating = map[ageRating] || ageRating;
      }
    } else if (r.type === 'tv' && d.content_ratings && d.content_ratings.results) {
      const uaRating = d.content_ratings.results.find(x => x.iso_3166_1 === 'UA');
      const usRating = d.content_ratings.results.find(x => x.iso_3166_1 === 'US');
      let rawRating = uaRating && uaRating.rating ? uaRating.rating : (usRating && usRating.rating ? usRating.rating : null);
      if (rawRating) {
        const map = { 'TV-Y': '0+', 'TV-Y7': '6+', 'TV-G': '0+', 'TV-PG': '12+', 'TV-14': '14+', 'TV-MA': '18+', 'G': '0+', 'PG': '12+', 'PG-13': '13+', 'R': '17+', 'NC-17': '18+', 'NR': '—' };
        ageRating = map[rawRating] || rawRating;
      }
    }

    // 2. Жанри + Теги (ліворуч) + Вік (праворуч)
    const genresRow = el('div', 'title-genres-row');
    
    const genresLeft = el('div', 'genres-left');
    if (d.genres && d.genres.length > 0) {
      d.genres.slice(0, 3).forEach(g => genresLeft.append(el('span', 'genre-tag', g.name)));
    }
    
    const tagsBtn = el('button', 'btn-tags', 'Теги');
    tagsBtn.onclick = () => openTagsModal(ctx);
    genresLeft.append(tagsBtn);
    genresRow.append(genresLeft);

    if (ageRating) {
      let ageCls = 'age-default';
      const num = parseInt(ageRating) || 0;
      if (num >= 18) ageCls = 'age-red';
      else if (num >= 13) ageCls = 'age-yellow';
      else ageCls = 'age-green';
      
      const ageRight = el('div', 'genres-right');
      ageRight.append(el('span', 'age-badge ' + ageCls, ageRating));
      genresRow.append(ageRight);
    }
    wrap.append(genresRow);

    // 3. Мета-рядок 1 (Рік · Сезони · Статус)
    const metaRow1 = el('div', 'title-meta-row');
    
    if (r.type === 'movie') {
      let metaStr = d.release_date ? d.release_date.slice(0, 4) : "";
      if (d.runtime) metaStr += ` · ${d.runtime} хв`;
      
      const director = (d.credits && d.credits.crew) ? d.credits.crew.find(c => c.job === 'Director') : null;
      if (director) metaStr += ` · ${director.name}`;
      
      if (metaStr) metaRow1.append(el('span', 'title-meta-text', metaStr));

    } else if (r.type === 'tv') {
      let metaStr = "";
      if (d.first_air_date) metaStr += d.first_air_date.slice(0, 4);
      if (d.number_of_seasons) {
        if (metaStr) metaStr += ` · `;
        metaStr += `${d.number_of_seasons} ${plural(d.number_of_seasons, 'сезон', 'сезони', 'сезонів')}`;
      }
      if (d.number_of_episodes) {
        if (metaStr) metaStr += ` · `;
        metaStr += `${d.number_of_episodes} ${plural(d.number_of_episodes, 'серія', 'серії', 'серій')}`;
      }
      if (metaStr) metaRow1.append(el('span', 'title-meta-text', metaStr));

      if (d.status === 'Ended') {
        metaRow1.append(el('span', 'tv-status ended', 'Завершено'));
      } else if (d.next_episode_to_air && d.next_episode_to_air.air_date) {
        const nextDate = new Date(d.next_episode_to_air.air_date);
        const dateStr = nextDate.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
        metaRow1.append(el('span', 'tv-status upcoming', `Наступна: ${dateStr}`));
      } else if (d.status === 'Returning Series') {
        metaRow1.append(el('span', 'tv-status ongoing', 'Триває'));
      }
    }
    if (metaRow1.children.length > 0) wrap.append(metaRow1);

    // 4. Мета-рядок 2 (Оцінки)
    const metaRow2 = el('div', 'title-meta-row');
    const ratingsWrap = el('div', 'meta-ratings-wrap');
    
    const getTempClass = (val) => {
      if (val >= 80) return 'temp-green';
      if (val >= 66) return 'temp-yellow';
      if (val >= 55) return 'temp-orange';
      return 'temp-red';
    };

    if (d.vote_average) {
      const val = d.vote_average * 10;
      const b = el('span', 'rating-tmdb');
      b.innerHTML = `TMDB:<span class="${getTempClass(val)}">${d.vote_average.toFixed(1)}</span>`;
      ratingsWrap.append(b);
    }
    
    if (ctx.omdb) {
      if (ctx.omdb.imdbRating && ctx.omdb.imdbRating !== 'N/A') {
        const val = parseFloat(ctx.omdb.imdbRating) * 10;
        const b = el('span', 'rating-imdb');
        b.innerHTML = `IMDb:<span class="${getTempClass(val)}">${ctx.omdb.imdbRating}</span>`;
        ratingsWrap.append(b);
      }
      
      if (r.type === 'movie' && ctx.omdb.Ratings) {
        const rt = ctx.omdb.Ratings.find(x => x.Source === 'Rotten Tomatoes');
        if (rt && rt.Value !== 'N/A') {
          const val = parseInt(rt.Value.replace('%', '')) || 0;
          const b = el('span', 'rating-rt');
          b.innerHTML = `RTom:<span class="${getTempClass(val)}">${val}</span>`;
          ratingsWrap.append(b);
        }
      }
    }

    if (ratingsWrap.children.length > 0) metaRow2.append(ratingsWrap);
    if (metaRow2.children.length > 0) wrap.append(metaRow2);

    return wrap;
  }

  function openTagsModal(ctx) {
    const d = ctx.details;
    const kw = (d.keywords && (d.keywords.keywords || d.keywords.results)) || [];
    
    if (kw.length === 0) {
      alert('Теги для цього тайтлу відсутні.');
      return;
    }

    const overlay = el('div', 'tags-modal-overlay');
    const content = el('div', 'tags-modal-content');
    
    // Header
    const header = el('div', 'tags-modal-header');
    header.append(el('h3', '', 'Теги'));
    const closeBtn = el('button', 'tags-modal-close', '✕');
    closeBtn.onclick = () => overlay.remove();
    header.append(closeBtn);
    content.append(header);

    // Body
    const body = el('div', 'tags-modal-body');
    kw.forEach(t => body.append(el('span', 'tag-item', t.name)));
    content.append(body);

    overlay.append(content);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.append(overlay);
  }

  function createActions(ctx) {
    /* FIX-ACTIONS-DROPPED-V2 */
    const r = ctx.item;
    const d = ctx.details;
    const s = lib[r.key] || {};
    const wrap = el('div', 'mobile-actions');

    const watchBtn = el('button', 'btn-lampa', 'LAMPA');
    watchBtn.onclick = () => openInLampa(r);
    wrap.append(watchBtn);

    const cleanTitle = String(d.title || d.name || r.title || '').replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9\s]/g, ' ').trim();
    const uakinoBtn = el('button', 'btn-uakino', 'UA KINO');
    uakinoBtn.onclick = () => window.open('https://uakino.best/index.php?do=search&subaction=search&story=' + encodeURIComponent(cleanTitle), '_blank');
    wrap.append(uakinoBtn);

    const isWatched = s.status === 'watched';
    const isDropped = s.status === 'dropped';
    
    let btnClass = 'btn-watched';
    let svgHtml = '';
    
    if (isWatched) {
      btnClass += ' active';
      svgHtml = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    } else if (isDropped) {
      btnClass += ' dropped';
      svgHtml = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    } else {
      svgHtml = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    }
    
    const watchedBtn = el('button', btnClass);
    watchedBtn.innerHTML = svgHtml;
    
    watchedBtn.onclick = () => {
      const newStatus = isWatched ? null : 'watched';
      let newEps = s.watchedEpisodes || [];
      if (r.type === 'tv') {
        if (newStatus === 'watched') {
          newEps = [];
          d.seasons.forEach(season => {
            if (season.season_number !== 0) {
              const cnt = season.episodes ? season.episodes.length : season.episode_count;
              for (let i = 1; i <= cnt; i++) newEps.push(season.season_number + '-' + i);
            }
          });
        } else if (newStatus === null) {
          newEps = [];
        }
      }
      update(r, { status: newStatus, watchedEpisodes: newEps });
    };
    wrap.append(watchedBtn);

    return wrap;
  }

  function createStatuses(ctx) {
    /* FIX-STATUS-ROW-ICONS */
    const r = ctx.item;
    const s = lib[r.key] || {};
    const wrap = el('div', 'mobile-statuses');

    const ICONS = {
      watching: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
      planned: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      dropped: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      notes: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
      trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
    };

    const others = r.type === 'tv' 
      ? [['watching', 'Дивлюсь', ICONS.watching], ['planned', 'Планую', ICONS.planned], ['dropped', 'Закинуто', ICONS.dropped]]
      : [['planned', 'Планую', ICONS.planned], ['dropped', 'Закинуто', ICONS.dropped]];

    others.forEach(([val, text, iconSvg]) => {
      const b = el('button', 'status-btn' + (s.status === val ? ' active' : ''));
      b.innerHTML = `${iconSvg} <span>${text}</span>`;
      b.onclick = () => {
        const newStatus = s.status === val ? null : val;
        let newEps = s.watchedEpisodes || [];
        if (r.type === 'tv' && (newStatus === 'planned' || newStatus === 'dropped' || newStatus === null)) {
          newEps = [];
        }
        update(r, { status: newStatus, watchedEpisodes: newEps });
      };
      wrap.append(b);
    });

    const notesBtn = el('button', 'status-btn btn-notes');
    notesBtn.innerHTML = `${ICONS.notes} <span>Нотатки</span>`;
    notesBtn.onclick = () => { ctx.activeTab = 'notes'; renderCard(); };
    wrap.append(notesBtn);

    if (lib[r.key]) {
      const delBtn = el('button', 'status-btn btn-del');
      delBtn.innerHTML = ICONS.trash;
      delBtn.title = 'Видалити';
      delBtn.onclick = () => {
        if (confirm('Видалити тайтл?')) { removeLibItem(r.key); saveNow(); refresh(); closeCard(); }
      };
      wrap.append(delBtn);
    }

    return wrap;
  }

  function createOverview(ctx) {
    const d = ctx.details;
    const hasWiki = !!(ctx.wikiOverview && ctx.wikiOverview.trim());
    const hasTmdb = !!(d.overview && d.overview.trim());
    if (!hasWiki && !hasTmdb) return el('div', 'mobile-overview empty');

    const useWiki = hasWiki && ctx.overviewSource !== 'tmdb';
    const activeText = useWiki ? ctx.wikiOverview : d.overview;

    const wrap = el('div', 'mobile-overview');
    
    if (hasWiki && hasTmdb) {
      const srcBar = el('div', 'overview-src');
      const wBtn = el('button', useWiki ? 'active' : '', 'Вікі');
      wBtn.onclick = () => { ctx.overviewSource = 'wiki'; renderCard(); };
      const tBtn = el('button', !useWiki ? 'active' : '', 'TMDB');
      tBtn.onclick = () => { ctx.overviewSource = 'tmdb'; renderCard(); };
      srcBar.append(wBtn, tBtn);
      wrap.append(srcBar);
    }

    const text = el('div', 'overview-text', activeText);
    // Тут буде CSS для line-clamp, поки що без стилів
    wrap.append(text);

    if (activeText.length > 180) {
      const readBtn = el('button', 'btn-read', ctx.overviewExpanded ? 'Згорнути' : 'Читати далі');
      readBtn.onclick = () => { ctx.overviewExpanded = !ctx.overviewExpanded; renderCard(); };
      wrap.append(readBtn);
    }
    return wrap;
  }

  function createScoreBlock(ctx) {
    /* FIX-SCORE-LIGHTS-FINAL */
    const r = ctx.item;
    const s = lib[r.key] || {};
    const wrap = el('div', 'mobile-score');

    if (r.type === 'tv') {
      /* FIX-TV-MAIN-SCORE */
      const ir = computeItemRating(s);
      
      const totalRow = el('div', 'score-total tv-score-total');
      totalRow.append(el('span', 'score-total-label tv-score-label', 'Загальна'));
      
      if (ir.avg > 0) {
        let avgCls = 'score-total-val tv-score-val';
        const v100 = ir.avg * 10;
        if (v100 >= 80) avgCls += ' temp-green';
        else if (v100 >= 66) avgCls += ' temp-yellow';
        else if (v100 >= 55) avgCls += ' temp-orange';
        else avgCls += ' temp-red';
        
        totalRow.append(el('span', avgCls, fmtNum(ir.avg)));
      } else {
        totalRow.append(el('span', 'score-empty-text', 'Оцінок ще немає'));
      }
      
      wrap.append(totalRow);
    } else {
      const header = el('div', 'score-header');
      header.append(el('div', 'score-title', 'Моя оцінка'));
      
      const clearBtn = el('button', 'btn-clear-ratings', 'Очистити');
      clearBtn.onclick = () => {
        if (Object.keys(s.ratings || {}).length > 0) {
          update(r, { ratings: {}, status: null });
        }
      };
      header.append(clearBtn);
      wrap.append(header);

      const cur = s.ratings || {};
      
      RATING_CRITERIA.forEach(crit => {
        const row = el('div', 'score-row');
        
        row.append(el('span', 'score-label', crit.label));
        
        const bottomRow = el('div', 'score-bottom-row');
        
        const lights = el('div', 'score-lights');
        const val = cur[crit.key] || 0;
        for (let i = 1; i <= 10; i++) {
          const light = el('button', 'light' + (i <= val ? ' on' : ''));
          light.onclick = () => {
            const newR = { ...(s.ratings || {}) };
            if (val === i) delete newR[crit.key]; else newR[crit.key] = i;
            let newStatus = s.status;
            const avg = computeAverage(newR);
            if (avg > 0) newStatus = 'watched'; else if (avg === 0 && s.status === 'watched') newStatus = null;
            update(r, { ratings: newR, status: newStatus });
          };
          lights.append(light);
        }
        bottomRow.append(lights);
        
        bottomRow.append(el('span', 'score-val', `${val ? val : '0'}/10`));
        
        row.append(bottomRow);
        wrap.append(row);
      });

      const avg = computeAverage(cur);
      const totalRow = el('div', 'score-total');
      totalRow.append(el('span', 'score-total-label', 'Загальна'));
      
      let avgCls = 'score-total-val';
      if (avg > 0) {
        const v100 = avg * 10;
        if (v100 >= 80) avgCls += ' temp-green';
        else if (v100 >= 66) avgCls += ' temp-yellow';
        else if (v100 >= 55) avgCls += ' temp-orange';
        else avgCls += ' temp-red';
      }
      
      totalRow.append(el('span', avgCls, avg > 0 ? fmtNum(avg) : '—'));
      wrap.append(totalRow);
    }

    return wrap;
  }

  function createTabs(ctx) {
    const wrap = el('div', 'mobile-tabs-wrap');
    if (typeof buildCardTabs === 'function') {
      wrap.append(buildCardTabs(ctx));
    }
    if (typeof buildCardTabContent === 'function') {
      wrap.append(buildCardTabContent(ctx));
    } else {
      wrap.append(el('div', 'tabs-placeholder', 'Таби в розробці'));
    }
    return wrap;
  }

  window.renderMobileCard = renderMobileCard;
})();
