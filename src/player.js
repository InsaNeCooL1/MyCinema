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
// Викликаємо при відкритті налаштувань
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
    u = 'https://' + u; // Додаємо https за замовчуванням
  }
  return u.replace(/\/$/, ''); // Прибираємо слеш в кінці, якщо є
}

async function testJackettConn() {
  let jUrl = document.getElementById('jackett-url').value;
  const jKey = document.getElementById('jackett-key').value.trim();
  
  jUrl = normalizeUrl(jUrl);
  
  if (!jUrl || !jKey) return alert('Заповніть Jackett URL та Key');
  
  showSyncToast('⏳ Перевіряю...');
  try {
    const res = await fetch(`${jUrl}/api/v2.0/indexers/all/results?apikey=${jKey}&Query=test`);
    const contentType = res.headers.get("content-type");
    
    if (contentType && contentType.includes("application/json")) {
      if (res.ok) showSyncToast('✅ Jackett OK');
      else showSyncToast('❌ Помилка Jackett');
    } else {
      showSyncToast('❌ Повернулась HTML-сторінка (невірний URL)');
    }
  } catch (e) {
    showSyncToast('❌ Немає зв\'язку з Jackett');
  }
}

async function openTorrentSearch(item) {
  let jUrl = localStorage.getItem('mycinema.jackett_url');
  const jKey = localStorage.getItem('mycinema.jackett_key');
  
  if (!jUrl || !jKey) {
    alert('Спочатку налаштуйте Jackett у розділі Налаштування!');
    openSettings();
    return;
  }
  
  jUrl = normalizeUrl(jUrl); // Очищаємо URL від зайвих слешів

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
      throw new Error('Сервер повернув не JSON. Перевірте правильність URL (можливо, потрібен свій локальний Jackett).');
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

  // Показуємо екран завантаження
  const lModal = document.getElementById('loading-modal');
  const lPoster = document.getElementById('loading-poster');
  const lStatus = document.getElementById('loading-status');
  const lSub = document.getElementById('loading-substatus');
  
  lPoster.src = TMDB_IMG + 'w500' + (item.poster || item.backdrop || '');
  lPoster.style.filter = 'grayscale(100%)'; // Починаємо з ЧБ
  lStatus.textContent = 'Шукаю торенти...';
  lSub.textContent = 'Запит до Jackett';
  lModal.style.display = 'flex';
  
  try {
    // Формуємо запит (використовуємо і назву, і рік)
    const q = encodeURIComponent(item.title + (item.year ? ' ' + item.year : ''));
    const res = await fetch(`${jUrl}/api/v2.0/indexers/all/results?apikey=${jKey}&Query=${q}`);
    const data = await res.json();
    
    // Фільтруємо результати (беремо тільки ті, де є MagnetUri)
    let results = (data.Results || []).filter(r => r.MagnetUri);
    
    // Сортуємо за кількістю сідів
    results.sort((a, b) => (b.Seeders || 0) - (a.Seeders || 0));
    
    if (results.length === 0) {
      lModal.style.display = 'none';
      alert('Торентів не знайдено. Спробуйте інший трекер.');
      return;
    }

    // Постер стає кольоровим (запускаємо CSS-перехід)
    lPoster.style.filter = 'grayscale(0%)';
    
    // Показуємо список через 1.5 секунди (щоб анімація встигла)
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
  list.innerHTML = ''; // Очищаємо

  results.slice(0, 20).forEach(r => { // Беремо топ-20
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
  const tUrl = localStorage.getItem('mycinema.torrserver_url') || 'http://127.0.0.1:8090';
  const extPlayer = localStorage.getItem('mycinema.external_player') !== 'false';
  
  // Показуємо екран завантаження знову
  const lModal = document.getElementById('loading-modal');
  const lPoster = document.getElementById('loading-poster');
  const lStatus = document.getElementById('loading-status');
  const lSub = document.getElementById('loading-substatus');
  
  lPoster.src = TMDB_IMG + 'w500' + (item.poster || item.backdrop || '');
  lPoster.style.filter = 'grayscale(0%)'; // Він вже кольоровий
  lStatus.textContent = 'Підготовка стріму...';
  lSub.textContent = 'TorrServer аналізує файли';
  lModal.style.display = 'flex';

  try {
    // 1. Додаємо торрент у TorrServer
    const addRes = await fetch(`${tUrl}/torrents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', link: magnet, save_to_db: true })
    });
    const addData = await addRes.json();
    const hash = addData.hash;

    if (!hash) throw new Error('Не вдалося отримати хеш торрента');

    // 2. Чекаємо, поки TorrServer підвантажить метадані (файли)
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

    // 3. Обираємо файл (якщо це серіал, вибираємо найбільший файл, або перший)
    // Для простоти беремо перший відеофайл, або найбільший за розміром
    const videoFile = files.sort((a, b) => b.length - a.length)[0];
    
    const streamUrl = `${tUrl}/stream/${hash}/${videoFile.id}`;
    
    lStatus.textContent = 'Запуск плеєра...';
    lSub.textContent = 'Передача потоку...';
    
    // 4. Відкриваємо плеєр
    setTimeout(() => {
      lModal.style.display = 'none';
      
      if (extPlayer) {
        // Відкриваємо у зовнішньому плеєрі (VLC / MX Player)
        const intentUrl = `intent:${streamUrl}#Intent;action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(item.title)};end`;
        window.location.href = intentUrl;
      } else {
        // Відкриваємо у вбудованому браузері (створимо нову вкладку для плеєра)
        window.open(streamUrl, '_blank');
      }
    }, 1000);

  } catch (e) {
    lModal.style.display = 'none';
    alert('Помилка TorrServer: ' + e.message);
  }
}
