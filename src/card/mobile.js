/* Mobile UI картки */
(function () {
  'use strict';

  // Допоміжні функції для кольорів та віку
  function getTempClass(val) {
    if (val >= 80) return 'temp-green';
    if (val >= 66) return 'temp-yellow';
    if (val >= 55) return 'temp-orange';
    return 'temp-red';
  }

  function getAgeRating(d, r) {
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
    return ageRating;
  }

  function getAgeClass(ageRating) {
    if (!ageRating) return 'age-default';
    const num = parseInt(ageRating) || 0;
    if (num >= 18) return 'age-red';
    if (num >= 13) return 'age-yellow';
    return 'age-green';
  }

  function renderMobileCard(ctx, scroll) {
    const r = ctx.item;
    scroll.innerHTML = '';
    const root = el('div', 'card-mobile-root');

    root.append(createHero(ctx));
    root.append(createTitle(ctx));
    root.append(createActions(ctx));
    root.append(createStatuses(ctx));
    root.append(createOverview(ctx));
    root.append(createScoreBlock(ctx));
    root.append(createTabs(ctx));

    scroll.append(root);
  }

  function createHero(ctx) {
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
      iframe.className = 'card-hero-video';
      wrap.append(iframe);
      
      const stopBtn = el('button', 'btn-stop', 'Зупинити трейлер');
      stopBtn.onclick = (e) => { e.stopPropagation(); ctx.playingTrailer = false; if (typeof refreshHeroInPlace === 'function') refreshHeroInPlace(ctx); else renderCard(); };
      wrap.append(stopBtn);
    } else {
      if (backdropPath) {
        const img = el('img', 'hero-img');
        img.src = TMDB_IMG + 'w1280' + backdropPath;
        wrap.append(img);
      }
      if (trailerList.length > 0) {
        const playBtn = el('button', 'btn-play', '▶ Дивитись трейлер');
        playBtn.onclick = () => { ctx.playingTrailer = true; if (typeof refreshHeroInPlace === 'function') refreshHeroInPlace(ctx); else renderCard(); };
        wrap.append(playBtn);
      }
      
      const userRating = computeItemRating(s);
      if (userRating.avg > 0) {
        const badgeCls = getTempClass(userRating.avg * 10);
        wrap.append(el('div', 'hero-badge ' + badgeCls, fmtNum(userRating.avg)));
      }
    }

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
    const d = ctx.details;
    const r = ctx.item;
    const s = lib[r.key] || {};
    const wrap = el('div', 'mobile-title');
    
    const titleRow = el('div', 'title-header-row');
    if (r.type === 'tv') {
      let _tvBadge;
      if (ctx.providerPick) {
        _tvBadge = el('div', 'tv-icon-badge tv-icon-badge-logo');
        if (ctx.providerPick.logo) {
          const _img = document.createElement('img');
          _img.src = `https://image.tmdb.org/t/p/w92${ctx.providerPick.logo}`;
          _img.alt = ctx.providerPick.name || '';
          _img.title = ctx.providerPick.name || '';
          _img.referrerPolicy = 'no-referrer';
          _img.loading = 'lazy';
          _img.className = 'tv-icon-img';
          _tvBadge.append(_img);
        } else {
          // name може бути null/порожнім у часткових відповідях TMDB.
          var _letter = String(ctx.providerPick.name || '').trim().charAt(0).toUpperCase();
          _tvBadge.textContent = _letter || '?';
          _tvBadge.classList.add('tv-icon-badge-letter');
        }
      } else {
        _tvBadge = el('div', 'tv-icon-badge', 'TV');
      }
      titleRow.append(_tvBadge);
    }
    titleRow.append(el('h1', 'title-main', d.title || d.name));
    wrap.append(titleRow);

    const ageRating = getAgeRating(d, r);

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
      const ageRight = el('div', 'genres-right');
      ageRight.append(el('span', 'age-badge ' + getAgeClass(ageRating), ageRating));
      genresRow.append(ageRight);
    }
    wrap.append(genresRow);

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

    const metaRow2 = el('div', 'title-meta-row');
    const ratingsWrap = el('div', 'meta-ratings-wrap');
    
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
      if (r.type === 'movie') {
        const omdbRatings = Array.isArray(ctx.omdb.Ratings) ? ctx.omdb.Ratings : [];
        const rt = omdbRatings.find(x => x.Source === 'Rotten Tomatoes');
        if (rt && rt.Value !== 'N/A') {
          const val = parseInt(rt.Value.replace('%', '')) || 0;
          const b = el('span', 'rating-rt');
          b.innerHTML = `RTom:<span class="${getTempClass(val)}">${val}</span>`;
          ratingsWrap.append(b);
        }
        // Metacritic: у OMDb буває або в Ratings ("81/100"), або полем Metascore.
        const mc = omdbRatings.find(x => x.Source === 'Metacritic');
        const mcRaw = (mc && mc.Value !== 'N/A') ? mc.Value : ctx.omdb.Metascore;
        const mcVal = parseInt(mcRaw, 10) || 0;
        if (mcVal > 0) {
          const b = el('span', 'rating-mc');
          b.innerHTML = `Meta:<span class="${getTempClass(mcVal)}">${mcVal}</span>`;
          ratingsWrap.append(b);
        }
      }
    }
    if (ratingsWrap.children.length > 0) metaRow2.append(ratingsWrap);

    if (r.type === 'tv') {
      const isWatching = s.status === 'watching';
      const watchBtn = el('button', 'title-watch-btn' + (isWatching ? ' active' : ''), 'Дивлюсь');
      watchBtn.onclick = () => { update(r, { status: isWatching ? null : 'watching' }); };
      metaRow2.append(watchBtn);
    }
    if (metaRow2.children.length > 0) wrap.append(metaRow2);

    return wrap;
  }

  function openTagsModal(ctx) {
    const d = ctx.details;
    const kw = (d.keywords && (d.keywords.keywords || d.keywords.results)) || [];
    if (kw.length === 0) { alert('Теги для цього тайтлу відсутні.'); return; }

    const overlay = el('div', 'tags-modal-overlay');
    const content = el('div', 'tags-modal-content');
    const header = el('div', 'tags-modal-header');
    header.append(el('h3', '', 'Теги'));
    const closeBtn = el('button', 'tags-modal-close', '✕');
    closeBtn.onclick = () => overlay.remove();
    header.append(closeBtn);
    content.append(header);

    const body = el('div', 'tags-modal-body');
    kw.forEach(t => body.append(el('span', 'tag-item', t.name)));
    content.append(body);

    overlay.append(content);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.append(overlay);
  }

  function createActions(ctx) {
    const r = ctx.item;
    const d = ctx.details;
    const s = lib[r.key] || {};
    const wrap = el('div', 'mobile-actions');

    /* LAMPA-STUB-REMOVED */
    const uaTitle = d.title || d.name || r.title || '';
    const uaOrigTitle = d.original_title || d.original_name || '';
    const uaYear = (d.release_date || d.first_air_date || '').slice(0, 4) || String(r.year || '');
    const uaType = d.media_type || r.type || (d.name ? 'tv' : 'movie');
    const uaImdb = d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || null;
    if (settings.enableStreams !== false) {
      const uakinoBtn = el('button', 'btn-uakino');
      uakinoBtn.innerHTML = '<span class="uakino-grad-text">UA KINO</span>';
      uakinoBtn.onclick = () => {
        if (typeof window.openStreamPicker === 'function') {
          window.openStreamPicker(uaTitle, uaYear, uaType, uaImdb, uaOrigTitle, { key: r.key });
        } else {
          alert('Плеєр не завантажено. Онови сторінку (Ctrl+Shift+R).');
        }
      };
      wrap.append(uakinoBtn);
    }
    // Кнопку AI лишаємо лише плаваючу внизу екрана — тут вона дублювала її
    // й стояла між UA KINO та Онлайн.
    if (window.mcRoom && window.mcRoom.enabled()) {
      const roomBtn = el('button', 'btn-uakino');
      roomBtn.innerHTML = '<span class="uakino-grad-text">Онлайн</span>';
      roomBtn.onclick = () => {
        const tvSeasons = (d.seasons || []).filter(x => x.season_number !== 0);
        const selSeason = (ctx.seasonState && ctx.seasonState.selectedSeason) ||
          (tvSeasons[0] && tvSeasons[0].season_number) || '';
        window.mcRoom.open({
          key: r.key, tmdbId: r.id, type: uaType, title: uaTitle, origTitle: uaOrigTitle,
          year: uaYear, imdbId: uaImdb,
          season: uaType === 'tv' ? selSeason : '',
          episode: ''
        });
      };
      wrap.append(roomBtn);
    }

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
              const cnt = (season.episodes && season.episodes.length) ? season.episodes.length : (season.episode_count || 0);
              for (let i = 1; i <= cnt; i++) newEps.push(season.season_number + '-' + i);
            }
          });
        } else if (newStatus === null) {
          // [FIX-BUG-2] Не втрачаємо прогрес: питаємо, чи очистити відмітки
          if (newEps.length > 0 && !confirm('Залишити відмічені серії як прогрес перегляду?\n\nOK — залишити, Скасувати — очистити всі відмітки.')) {
            newEps = [];
          }
        }
      }
      update(r, { status: newStatus, watchedEpisodes: newEps });
    };
    wrap.append(watchedBtn);

    return wrap;
  }

  function createStatuses(ctx) {
    const r = ctx.item;
    const s = lib[r.key] || {};
    const wrap = el('div', 'mobile-statuses');

    const ICONS = {
      planned: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      dropped: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      notes: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
      trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
    };

    const others = [['planned', 'Планую', ICONS.planned], ['dropped', 'Закинуто', ICONS.dropped]];

    others.forEach(([val, text, iconSvg]) => {
      const b = el('button', 'status-btn' + (s.status === val ? ' active' : ''));
      b.innerHTML = `${iconSvg} <span>${text}</span>`;
      b.onclick = () => {
        const newStatus = s.status === val ? null : val;
        let newEps = s.watchedEpisodes || [];
        if (r.type === 'tv' && (newStatus === 'planned' || newStatus === 'dropped' || newStatus === null)) { newEps = []; }
        update(r, { status: newStatus, watchedEpisodes: newEps });
      };
      wrap.append(b);
    });

    const notesBtn = el('button', 'status-btn btn-notes');
    notesBtn.innerHTML = `${ICONS.notes} <span>Нотатки</span>`;
    notesBtn.onclick = () => { window.openQuickNoteModal(ctx); };
    wrap.append(notesBtn);

    if (s.status === 'watched') {
      const rwCnt = s.rewatches || 0;
      const rwBtn = el('button', 'status-btn btn-rewatch' + (rwCnt > 0 ? ' has-rw' : ''));
      rwBtn.title = 'Зафіксувати повторний перегляд';
      rwBtn.innerHTML = `<span>🔁</span>${rwCnt > 0 ? `<span class="rw-cnt">×${rwCnt + 1}</span>` : ''}`;
      rwBtn.onclick = () => {
        const latest = lib[r.key] || s;
        const nextRw = (latest.rewatches || 0) + 1;
        const dates = [...(latest.rewatchDates || []), Date.now()];
        update(r, { rewatches: nextRw, rewatchDates: dates, statusDate: Date.now() });
        if (typeof showSyncToast === 'function') showSyncToast(`🔁 Перегляд №${nextRw + 1}`);
      };
      wrap.append(rwBtn);
    }

    if (lib[r.key]) {
      const delBtn = el('button', 'status-btn btn-del');
      delBtn.innerHTML = ICONS.trash;
      delBtn.title = 'Видалити';
      delBtn.onclick = () => {
        if (confirm('Видалити тайтл?')) {
          const snap = lib[r.key] || r;
          removeLibItem(r.key);
          if (typeof logActivity === 'function') logActivity({ cat: 'remove', sub: 'delete', icon: '🗑️', text: 'Видалено з бібліотеки', item: snap });
          saveNow(); closeCard();
        }
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
      wBtn.onclick = () => { ctx.overviewSource = 'wiki'; if (typeof refreshCardOverviewInPlace === 'function') refreshCardOverviewInPlace(ctx); else renderCard(); };
      const tBtn = el('button', !useWiki ? 'active' : '', 'TMDB');
      tBtn.onclick = () => { ctx.overviewSource = 'tmdb'; if (typeof refreshCardOverviewInPlace === 'function') refreshCardOverviewInPlace(ctx); else renderCard(); };
      srcBar.append(wBtn, tBtn);
      wrap.append(srcBar);
    }

    const text = el('div', 'overview-text' + (ctx.overviewExpanded ? ' expanded' : ''), activeText);
    wrap.append(text);

    if (activeText.length > 180) {
      const readBtn = el('button', 'btn-read', ctx.overviewExpanded ? 'Згорнути' : 'Читати далі');
      readBtn.onclick = () => {
        ctx.overviewExpanded = !ctx.overviewExpanded;
        text.classList.toggle('expanded', ctx.overviewExpanded);
        readBtn.textContent = ctx.overviewExpanded ? 'Згорнути' : 'Читати далі';
      };
      wrap.append(readBtn);
    }
    return wrap;
  }

  function createScoreBlock(ctx) {
    const r = ctx.item;
    const s = lib[r.key] || {};
    const wrap = el('div', 'mobile-score');

    if (r.type === 'tv') {
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
      clearBtn.onclick = () => { if (Object.keys(s.ratings || {}).length > 0) update(r, { ratings: {}, status: null }); };
      header.append(clearBtn);
      wrap.append(header);

      const syncMovieTotalAndShell = (curR) => {
        const avgVal = computeAverage(curR);
        const tvEl = wrap.querySelector('.score-total-val');
        if (tvEl) {
          let cls = 'score-total-val';
          if (avgVal > 0) cls += ' ' + getTempClass(avgVal * 10);
          tvEl.className = cls;
          tvEl.textContent = avgVal > 0 ? fmtNum(avgVal) : '—';
        }
        const curS = lib[r.key] || {};
        const hero = card.querySelector('.mobile-hero');
        if (hero && !ctx.playingTrailer) {
          let badge = hero.querySelector('.hero-badge');
          if (avgVal > 0) {
            const bCls = 'hero-badge ' + getTempClass(avgVal * 10);
            if (!badge) { badge = el('div', bCls, fmtNum(avgVal)); hero.append(badge); }
            else { badge.className = bCls; badge.textContent = fmtNum(avgVal); }
          } else if (badge) badge.remove();
        }
        const watchedBtn = card.querySelector('.mobile-actions .btn-watched');
        if (watchedBtn) {
          const isW = curS.status === 'watched', isD = curS.status === 'dropped';
          watchedBtn.className = 'btn-watched' + (isW ? ' active' : (isD ? ' dropped' : ''));
          watchedBtn.innerHTML = isW
            ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
            : (isD ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'
              : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>');
        }
        const stWrap = card.querySelector('.mobile-statuses');
        if (stWrap) {
          const hasLib = !!lib[r.key];
          const hasDel = !!stWrap.querySelector('.btn-del');
          if (hasLib !== hasDel) stWrap.replaceWith(createStatuses(ctx));
          else stWrap.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
          if (curS.status === 'planned') card.querySelectorAll('.mobile-statuses .status-btn')[0]?.classList.add('active');
          if (curS.status === 'dropped') card.querySelectorAll('.mobile-statuses .status-btn')[1]?.classList.add('active');
        }
      };

      const refreshMovieRatingUIInPlace = () => {
        const latest = lib[r.key] || {};
        const curR = latest.ratings || {};
        wrap.querySelectorAll('.score-row').forEach((rowEl, rIdx) => {
          const crit = RATING_CRITERIA[rIdx];
          if (!crit) return;
          const v = curR[crit.key] || 0;
          rowEl.querySelectorAll('.light').forEach((lEl, i) => {
            const on = (i + 1) <= v;
            lEl.classList.toggle('on', on);
            lEl.setAttribute('aria-checked', on ? 'true' : 'false');
          });
          const sv = rowEl.querySelector('.score-val');
          if (sv) sv.textContent = `${v ? v : '0'}/10`;
        });
        syncMovieTotalAndShell(curR);
      };

      clearBtn.onclick = () => {
        const latest = lib[r.key] || {};
        if (Object.keys(latest.ratings || {}).length > 0) {
          updateNoRender(r, { ratings: {}, status: latest.status === 'watched' ? null : latest.status });
          refreshMovieRatingUIInPlace();
        }
      };

      const cur = s.ratings || {};
      RATING_CRITERIA.forEach(crit => {
        const row = el('div', 'score-row');
        row.append(el('span', 'score-label', crit.label));
        const bottomRow = el('div', 'score-bottom-row');
        const lights = el('div', 'score-lights');
        const initVal = cur[crit.key] || 0;
        for (let i = 1; i <= 10; i++) {
          const light = el('button', 'light' + (i <= initVal ? ' on' : ''));
          light.onclick = () => {
            const latest = lib[r.key] || {};
            const curR = { ...(latest.ratings || {}) };
            const curVal = curR[crit.key] || 0;
            if (curVal === i) delete curR[crit.key]; else curR[crit.key] = i;
            let newStatus = latest.status;
            const nextAvg = computeAverage(curR);
            if (nextAvg > 0) newStatus = 'watched'; else if (nextAvg === 0 && latest.status === 'watched') newStatus = null;
            updateNoRender(r, { ratings: curR, status: newStatus, ratingUpdated: Date.now() });
            refreshMovieRatingUIInPlace();
          };
          lights.append(light);
        }
        bottomRow.append(lights);
        bottomRow.append(el('span', 'score-val', `${initVal ? initVal : '0'}/10`));
        row.append(bottomRow);
        wrap.append(row);
      });

      const avg = computeAverage(cur);
      const totalRow = el('div', 'score-total');
      totalRow.append(el('span', 'score-total-label', 'Загальна'));
      let avgCls = 'score-total-val';
      if (avg > 0) avgCls += ' ' + getTempClass(avg * 10);
      totalRow.append(el('span', avgCls, avg > 0 ? fmtNum(avg) : '—'));
      wrap.append(totalRow);
    }
    return wrap;
  }

  function createTabs(ctx) {
    const wrap = el('div', 'mobile-tabs-wrap');
    if (typeof buildCardTabs === 'function') wrap.append(buildCardTabs(ctx));
    if (typeof buildCardTabContent === 'function') wrap.append(buildCardTabContent(ctx));
    else wrap.append(el('div', 'tabs-placeholder', 'Таби в розробці'));
    return wrap;
  }


  function openQuickNoteModal(ctx, editNote) {
    const r = ctx.item;
    const s = lib[r.key] || {};
    
    const overlay = el('div', 'quick-note-overlay');
    const content = el('div', 'quick-note-content');
    
    const header = el('div', 'quick-note-header');
    header.append(el('h3', '', editNote ? 'Редагувати думку' : 'Нова думка'));
    const closeBtn = el('button', 'quick-note-close', '✕');
    header.append(closeBtn);
    
    const textarea = document.createElement('textarea');
    textarea.className = 'quick-note-textarea';
    textarea.placeholder = 'Що думаєш з цього приводу?..';
    textarea.value = editNote ? (editNote.text || '') : '';
    
    const footer = el('div', 'quick-note-footer');
    const cancelBtn = el('button', 'quick-note-btn cancel', 'Скасувати');
    const saveBtn = el('button', 'quick-note-btn save', 'Зберегти');
    footer.append(cancelBtn, saveBtn);
    
    content.append(header, textarea, footer);
    overlay.append(content);
    
    const close = () => overlay.remove();
    closeBtn.onclick = close;
    cancelBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    
    saveBtn.onclick = () => {
      const val = textarea.value.trim();
      if (!val) { close(); return; }
      
      const hist = [...(s.notesHistory || [])];
      if (s.notes && s.notes.trim() && !hist.some(n => n.text === s.notes)) {
        hist.push({ text: s.notes, ts: s.updated || Date.now() });
      }
      if (editNote) {
        const idx = hist.findIndex(n => n.ts === editNote.ts && n.text === editNote.text);
        if (idx >= 0) hist[idx] = { ...hist[idx], text: val, editedTs: Date.now() };
        else hist.unshift({ text: val, ts: Date.now() });
      } else {
        hist.unshift({ text: val, ts: Date.now() });
      }
      
      update(r, { notesHistory: hist, notes: null });
      saveNow();
      close();
    };
    
    document.body.append(overlay);
    setTimeout(() => textarea.focus(), 50);
  }

  window.openQuickNoteModal = openQuickNoteModal;

  window.renderMobileCard = renderMobileCard;
  
  // Експорт для Desktop UI
  window.MC = {
    createHero, createTitle, createActions, createStatuses, 
    createOverview, createScoreBlock, createTabs, openTagsModal
  };
})();
