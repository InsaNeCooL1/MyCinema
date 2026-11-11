'use strict';

let isCancelled = false;

function cancelLoading() {
  isCancelled = true;
  document.getElementById('loading-modal').style.display = 'none';
}

function savePlayerSettings() {
  const jUrl = document.getElementById('jackett-url').value.trim();
  const jKey = document.getElementById('jackett-key').value.trim();
  const tUrl = document.getElementById('torrserver-url').value.trim();
  const extPlayer = document.getElementById('player-pref').checked;

  localStorage.setItem('mycinema.jackett_url', jUrl);
  localStorage.setItem('mycinema.jackett_key', jKey);
  localStorage.setItem('mycinema.torrserver_url', tUrl);
  localStorage.setItem('mycinema.external_player', extPlayer ? 'true' : 'false');
  
  showCenterToast('💾 Налаштування збережено');
}

function loadPlayerSettings() {
  const jUrl = document.getElementById('jackett-url');
  const jKey = document.getElementById('jackett-key');
  const tUrl = document.getElementById('torrserver-url');
  const extPlayer = document.getElementById('player-pref');

  if (jUrl) jUrl.value = localStorage.getItem('mycinema.jackett_url') || 'https://jac-red.ru';
  if (jKey) jKey.value = localStorage.getItem('mycinema.jackett_key') || 'viewbox';
  if (tUrl) tUrl.value = localStorage.getItem('mycinema.torrserver_url') || 'http://127.0.0.1:8090';
  if (extPlayer) extPlayer.checked = localStorage.getItem('mycinema.external_player') !== 'false';
}

const originalOpenSettings = window.openSettings;
window.openSettings = function() {
  originalOpenSettings();
  loadPlayerSettings();
};

function normalizeUrl(url) {
  if (!url) return '';
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'https://' + u;
  }
  return u.replace(/\/$/, '');
}

async function testJackettConn() {
  let jUrl = normalizeUrl(document.getElementById('jackett-url').value);
  const jKey = document.getElementById('jackett-key').value.trim();
  let tUrl = normalizeUrl(document.getElementById('torrserver-url').value);
  
  if (!jUrl || !jKey) return alert('Заповніть Jackett URL та Key');
  
  showSyncToast('⏳ Перевіряю Jackett...');
  let jOk = false;
  try {
    const res = await fetch(`${jUrl}/api/v2.0/indexers/all/results?apikey=${jKey}&Query=test`);
    if (res.ok) jOk = true;
  } catch (e) {}

  if (!tUrl) {
    showSyncToast(jOk ? '✅ Jackett OK' : '❌ Помилка Jackett');
    return;
  }

  showSyncToast('⏳ Перевіряю TorrServer...');
  let tOk = false;
  try {
    const res = await fetch(tUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
    tOk = res.ok; 
  } catch (e) {}

  if (jOk && tOk) showSyncToast('✅ Все OK');
  else showSyncToast('❌ Помилка з\'єднання');
}

async function openTorrentSearch(item) {
  isCancelled = false;
  let jUrl = localStorage.getItem('mycinema.jackett_url') || 'https://jac-red.ru';
  const jKey = localStorage.getItem('mycinema.jackett_key') || 'viewbox';
  jUrl = normalizeUrl(jUrl);

  const lModal = document.getElementById('loading-modal');
  const lPoster = document.getElementById('loading-poster');
  const lStatus = document.getElementById('loading-status');
  const lSub = document.getElementById('loading-substatus');
  
  lPoster.src = TMDB_IMG + 'w500' + (item.poster || item.backdrop || '');
  lPoster.style.filter = 'grayscale(100%)';
  lStatus.textContent = 'Шукаю торенти...';
  lSub.textContent = 'Запит до Jackett';
  lModal.style.display = 'flex';
  
  try {
    const q = encodeURIComponent(item.title + (item.year ? ' ' + item.year : ''));
    const res = await fetch(`${jUrl}/api/v2.0/indexers/all/results?apikey=${jKey}&Query=${q}`);
    const data = await res.json();
    
    if (isCancelled) return;

    let results = (data.Results || []).filter(r => r.MagnetUri);
    results.sort((a, b) => (b.Seeders || 0) - (a.Seeders || 0));
    
    if (results.length === 0) {
      lModal.style.display = 'none';
      alert('Торентів не знайдено.');
      return;
    }

    lPoster.style.filter = 'grayscale(0%)';
    setTimeout(() => {
      if (isCancelled) return;
      lModal.style.display = 'none';
      showTorrentsList(results, item);
    }, 1500);

  } catch (e) {
    lModal.style.display = 'none';
    if (!isCancelled) alert('Помилка пошуку: ' + e.message);
  }
}

function showTorrentsList(results, item) {
  const modal = document.getElementById('torrents-modal');
  const list = document.getElementById('torrents-list');
  list.innerHTML = '';

  results.slice(0, 20).forEach(r => {
    const div = document.createElement('div');
    div.className = 'torrent-item';
    const sizeGB = (r.Size / (1024 * 1024 * 1024)).toFixed(2);
    
    div.innerHTML = `
      <div class="torrent-title">${r.Title}</div>
      <div class="torrent-meta">
        <span>Трекер: ${r.Tracker}</span>
        <span class="torrent-seeds">🟢 ${r.Seeders || 0}</span>
        <span class="torrent-size">${sizeGB} GB</span>
      </div>
    `;
    div.addEventListener('click', () => {
      closeTorrentsModal();
      playTorrent(r.MagnetUri, item);
    });
    list.append(div);
  });

  modal.style.display = 'flex';
}

function closeTorrentsModal() {
  document.getElementById('torrents-modal').style.display = 'none';
}

function parseEpisode(filePath) {
  const m1 = filePath.match(/S(\d+)E(\d+)/i);
  if (m1) return { season: parseInt(m1[1]), episode: parseInt(m1[2]) };
  const m2 = filePath.match(/(\d+)x(\d+)/i);
  if (m2) return { season: parseInt(m2[1]), episode: parseInt(m2[2]) };
  const m3 = filePath.match(/E(\d+)/i);
  if (m3) return { season: 1, episode: parseInt(m3[1]) };
  return { season: 0, episode: 0 };
}

function showFilesList(files, hash, item, tUrl, extPlayer) {
  const modal = document.getElementById('files-modal');
  const list = document.getElementById('files-list');
  
  if (!modal) {
      alert('Помилка: не знайдено вікно files-modal. Перевірте index.html!');
      return;
  }
  
  list.innerHTML = '';

  const sorted = [...files].sort((a, b) => {
    const ea = parseEpisode(a.path);
    const eb = parseEpisode(b.path);
    return (ea.season - eb.season) || (ea.episode - eb.episode);
  });

  const saved = lib[item.key] || {};
  const watchedEps = new Set(saved.watchedEpisodes || []);

  sorted.forEach(f => {
    const ep = parseEpisode(f.path);
    const fileName = f.path.split('/').pop();
    const sizeMB = (f.length / (1024 * 1024)).toFixed(0);
    const isWatched = ep.episode > 0 && watchedEps.has(`${ep.season}-${ep.episode}`);

    let epLabel = '▶';
    if (ep.episode > 0) {
      epLabel = `S${String(ep.season).padStart(2,'0')}E${String(ep.episode).padStart(2,'0')}`;
    }

    const div = document.createElement('div');
    div.className = 'file-item' + (isWatched ? ' watched' : '');

    div.innerHTML = `
      <div class="file-num">${epLabel}</div>
      <div class="file-name">${fileName}</div>
      <div class="file-size">${sizeMB} MB</div>
      ${isWatched ? '<div class="file-check">✓</div>' : ''}
    `;

    div.addEventListener('click', () => {
      closeFilesModal();
      playStream(f, hash, item, tUrl, extPlayer, ep.season, ep.episode);
    });

    list.append(div);
  });

  modal.style.display = 'flex';
}

function closeFilesModal() {
  const modal = document.getElementById('files-modal');
  if (modal) modal.style.display = 'none';
}

function playStream(videoFile, hash, item, tUrl, extPlayer, season, episode) {
  const ext = (videoFile.path.match(/\.\w+$/) || ['.mkv'])[0];
  const streamUrl = `${tUrl}/stream/video${ext}?link=${hash}&index=${videoFile.id}&play`;
  console.log("Stream URL:", streamUrl);

  if (season > 0 && episode > 0) {
    if (!lib[item.key]) {
      lib[item.key] = { ...item, status: 'watching', watchedEpisodes: [], updated: Date.now() };
    }
    if (!lib[item.key].watchedEpisodes) lib[item.key].watchedEpisodes = [];
    
    const epKey = `${season}-${episode}`;
    if (!lib[item.key].watchedEpisodes.includes(epKey)) {
      lib[item.key].watchedEpisodes.push(epKey);
      if (lib[item.key].status !== 'watched') lib[item.key].status = 'watching';
      lib[item.key].updated = Date.now();
      save();
      showSyncToast(`✅ S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')} позначено`);
    }
  }

  if (!extPlayer) {
    window.open(streamUrl, '_blank');
    return;
  }

  if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.ExternalPlayer) {
    alert('Плагін ExternalPlayer не знайдено!');
    return;
  }

  const plugin = window.Capacitor.Plugins.ExternalPlayer;

  plugin.open({
    url: streamUrl,
    title: item.title || 'MyCinema'
  }).then(r => {
    console.log('Відкрито через:', r.via);
  }).catch(err => {
    alert('Помилка плеєра: ' + (err.message || JSON.stringify(err)));
  });
}

async function playTorrent(magnet, item) {
  isCancelled = false;
  const tUrl = normalizeUrl(localStorage.getItem('mycinema.torrserver_url') || 'http://127.0.0.1:8090');
  const extPlayer = localStorage.getItem('mycinema.external_player') !== 'false';
  
  const lModal = document.getElementById('loading-modal');
  const lPoster = document.getElementById('loading-poster');
  const lStatus = document.getElementById('loading-status');
  const lSub = document.getElementById('loading-substatus');
  
  lPoster.src = TMDB_IMG + 'w500' + (item.poster || item.backdrop || '');
  lPoster.style.filter = 'grayscale(0%)';
  lStatus.textContent = 'Підготовка стріму...';
  lSub.textContent = 'TorrServer аналізує файли';
  lModal.style.display = 'flex';

  try {
    lSub.textContent = 'Додаю торрент...';
    const addRes = await fetch(`${tUrl}/torrents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', link: magnet, save_to_db: true })
    });

    if (isCancelled) return;

    const addText = await addRes.text();
    let hash = null;
    let files = [];

    try {
        const data = JSON.parse(addText);
        if (data && data.hash) {
            hash = data.hash;
            if (data.file_stats && Array.isArray(data.file_stats)) {
                files = data.file_stats.filter(f => f.path && f.path.match(/\.(mkv|mp4|avi)$/i));
            }
        }
    } catch (e) {}

    if (!hash) {
        const hashMatch = magnet.match(/btih:([a-f0-9]{40})/i);
        if (hashMatch) hash = hashMatch[1];
    }

    if (!hash) throw new Error('Не вдалося отримати хеш');

    let attempts = 0;
    while (files.length === 0 && attempts < 15) { 
      if (isCancelled) return;
      
      lSub.textContent = `Отримую файли... (спроба ${attempts + 1})`;
      const statRes = await fetch(`${tUrl}/torrents/${hash}`);
      if (statRes.ok) {
          const statText = await statRes.text();
          try {
              const statData = JSON.parse(statText);
              if (statData && statData.file_stats) {
                  files = statData.file_stats.filter(f => f.path && f.path.match(/\.(mkv|mp4|avi)$/i));
              }
          } catch (e) {}
      }
      if (files.length === 0) {
          await new Promise(r => setTimeout(r, 2000));
          attempts++;
      }
    }

    if (isCancelled) return;
    if (files.length === 0) throw new Error('Відеофайлів не знайдено');

    lModal.style.display = 'none';

    files.sort((a, b) => b.length - a.length);

    const hasEpisodes = files.some(f => /S\d+E\d+/i.test(f.path));
    const isTV = item.type === 'tv';

    if (files.length > 1 && (isTV || hasEpisodes)) {
      showFilesList(files, hash, item, tUrl, extPlayer);
    } else {
      playStream(files[0], hash, item, tUrl, extPlayer, 0, 0);
    }

  } catch (e) {
    lModal.style.display = 'none';
    if (!isCancelled) alert('Помилка TorrServer: ' + e.message);
  }
}
