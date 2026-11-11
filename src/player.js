'use strict';

// ============ SETTINGS ============
function savePlayerSettings() {
  const jUrl = document.getElementById('jackett-url').value.trim();
  const jKey = document.getElementById('jackett-key').value.trim();
  const tUrl = document.getElementById('torrserver-url').value.trim();
  const extPlayer = document.getElementById('player-pref').checked;

  localStorage.setItem('mycinema.jackett_url', jUrl);
  localStorage.setItem('mycinema.jackett_key', jKey);
  localStorage.setItem('mycinema.torrserver_url', tUrl);
  localStorage.setItem('mycinema.external_player', extPlayer ? 'true' : 'false');
  
  showSyncToast('💾 Налаштування збережено');
}

function loadPlayerSettings() {
  document.getElementById('jackett-url').value = localStorage.getItem('mycinema.jackett_url') || '';
  document.getElementById('jackett-key').value = localStorage.getItem('mycinema.jackett_key') || '';
  document.getElementById('torrserver-url').value = localStorage.getItem('mycinema.torrserver_url') || 'http://127.0.0.1:8090';
  document.getElementById('player-pref').checked = localStorage.getItem('mycinema.external_player') !== 'false';
}

// Перехоплюємо відкриття налаштувань, щоб підтягнути збережені дані
const originalOpenSettings = window.openSettings;
window.openSettings = function() {
  originalOpenSettings();
  loadPlayerSettings();
};

// Допоміжна функція для нормалізації URL
function normalizeUrl(url) {
  if (!url) return '';
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'https://' + u;
  }
  return u.replace(/\/$/, '');
}

// ============ TEST CONNECTION ============
async function testJackettConn() {
  let jUrl = normalizeUrl(document.getElementById('jackett-url').value);
  const jKey = document.getElementById('jackett-key').value.trim();
  let tUrl = normalizeUrl(document.getElementById('torrserver-url').value);
  
  if (!jUrl || !jKey) return alert('Заповніть Jackett URL та Key');
  
  showSyncToast('⏳ Перевіряю Jackett...');
  let jOk = false;
  try {
    const res = await fetch(`${jUrl}/api/v2.0/indexers/all/results?apikey=${jKey}&Query=test`);
    const contentType = res.headers.get("content-type");
    if (res.ok && contentType && contentType.includes("application/json")) {
      jOk = true;
    }
  } catch (e) {}

  if (!tUrl) {
    showSyncToast(jOk ? '✅ Jackett OK (TorrServer не вказано)' : '❌ Помилка Jackett');
    return;
  }

  showSyncToast('⏳ Перевіряю TorrServer...');
  let tOk = false;
  try {
    const res = await fetch(tUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
    tOk = res.ok || res.status === 200; 
  } catch (e) {}

  if (jOk && tOk) showSyncToast('✅ Jackett та TorrServer OK');
  else if (jOk && !tOk) showSyncToast('❌ TorrServer не відповідає (або CORS)');
  else if (!jOk && tOk) showSyncToast('❌ Jackett не відповідає');
  else showSyncToast('❌ Помилка з\'єднання');
}

// ============ TORRENT SEARCH (JACKETT) ============
async function openTorrentSearch(item) {
  let jUrl = localStorage.getItem('mycinema.jackett_url');
  const jKey = localStorage.getItem('mycinema.jackett_key');
  
  if (!jUrl || !jKey) {
    alert('Спочатку налаштуйте Jackett у розділі Налаштування!');
    openSettings();
    return;
  }
  
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
    
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error('Сервер повернув не JSON. Перевірте правильність URL.');
    }

    const data = await res.json();
    
    let results = (data.Results || []).filter(r => r.MagnetUri);
    results.sort((a, b) => (b.Seeders || 0) - (a.Seeders || 0));
    
    if (results.length === 0) {
      lModal.style.display = 'none';
      alert('Торентів не знайдено. Спробуйте інший трекер.');
      return;
    }

    lPoster.style.filter = 'grayscale(0%)';
    
    setTimeout(() => {
      lModal.style.display = 'none';
      showTorrentsList(results, item);
    }, 1500);

  } catch (e) {
    lModal.style.display = 'none';
    alert('Помилка пошуку: ' + e.message);
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

// ============ PLAY TORRENT (TORRSERVER) ============
async function playTorrent(magnet, item) {
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
    const addRes = await fetch(`${tUrl}/torrents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', link: magnet, save_to_db: true })
    });
    
    if (!addRes.ok) throw new Error('Не вдалося підключитися до TorrServer');
    const addData = await addRes.json();
    const hash = addData.hash;

    if (!hash) throw new Error('Не вдалося отримати хеш торрента');

    let files = [];
    let attempts = 0;
    
    while (attempts < 10) {
      lSub.textContent = `Отримую список файлів... (спроба ${attempts + 1})`;
      const statRes = await fetch(`${tUrl}/torrents/${hash}`);
      const statData = await statRes.json();
      
      if (statData.file_stats && statData.file_stats.length > 0) {
        files = statData.file_stats.filter(f => f.path.match(/\.(mkv|mp4|avi)$/i));
        if (files.length > 0) break;
      }
      
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
    }

    if (files.length === 0) throw new Error('Відеофайлів не знайдено в торренті');

    const videoFile = files.sort((a, b) => b.length - a.length)[0];
    const streamUrl = `${tUrl}/stream/${hash}/${videoFile.id}`;
    
    lStatus.textContent = 'Запуск плеєра...';
    lSub.textContent = 'Передача потоку...';
    
    setTimeout(() => {
      lModal.style.display = 'none';
      
      if (extPlayer) {
        const intentUrl = `intent:${streamUrl}#Intent;action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(item.title)};end`;
        window.location.href = intentUrl;
      } else {
        window.open(streamUrl, '_blank');
      }
    }, 1000);

  } catch (e) {
    lModal.style.display = 'none';
    let msg = e.message;
    if (msg === 'Failed to fetch') {
      msg = 'Не вдалося підключитися до TorrServer.\n\nЯкщо ви на сайті (HTTPS), браузер блокує HTTP-запити (Mixed Content).\nСпробуйте запустити сайт локально (http://localhost) або перевірте в APK.';
    }
    alert('Помилка TorrServer: ' + msg);
  }
}
