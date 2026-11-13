'use strict';

function hideAutocomplete() { 
  autocomplete.classList.add("hidden"); 
  autocomplete.replaceChildren(); 
}

function addToHistory(q) {
  let hist = JSON.parse(localStorage.getItem('mycinema.search_history')) || [];
  hist = hist.filter(x => x !== q); // Видаляємо дублікат, якщо вже був
  hist.unshift(q); // Додаємо на початок
  if (hist.length > 10) hist = hist.slice(0, 10); // Обмежуємо 10 записами
  localStorage.setItem('mycinema.search_history', JSON.stringify(hist));
}

function showHistory() {
  const hist = JSON.parse(localStorage.getItem('mycinema.search_history')) || [];
  if (!hist.length) { hideAutocomplete(); return; }
  
  autocomplete.replaceChildren();
  autocomplete.classList.remove("hidden");
  
  autocomplete.append(el("div", "ac-header", "Останні запити"));
  
  hist.forEach(q => {
    const row = el("div", "ac-item ac-history");
    row.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    row.append(el('span', '', q));
    row.addEventListener("click", () => {
      input.value = q;
      performFullSearch();
    });
    autocomplete.append(row);
  });
  
  const clearBtn = el("div", "ac-footer", "Очистити історію");
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    localStorage.removeItem('mycinema.search_history');
    hideAutocomplete();
  });
  autocomplete.append(clearBtn);
}

const filterBtn = document.getElementById("search-filter-btn");
const filterDropdown = document.getElementById("filter-dropdown");

function hasActiveFilters() {
  const f = state.filter;
  return f.type !== 'all' || f.decade !== 'any' || f.genre !== 'any' || f.minRating > 0 || f.streaming !== null || f.sortBy !== 'popularity.desc';
}

function updateFilterBadge() {
  if (filterBtn) filterBtn.classList.toggle("has-filters", hasActiveFilters());
}

function hideFilterDropdown() {
  if (filterDropdown) filterDropdown.classList.add("hidden");
  if (filterBtn) filterBtn.classList.remove("open");
}

function openFilterDropdown() {
  if (!filterDropdown) return;
  hideAutocomplete();
  if (typeof closeNavDropdowns === 'function') closeNavDropdowns();
  if (!filterDropdown.childElementCount && typeof buildFilterPanel === 'function') {
    filterDropdown.append(buildFilterPanel());
  } else if (typeof syncFilterSelects === 'function') {
    syncFilterSelects();
  }
  filterDropdown.classList.remove("hidden");
  if (filterBtn) filterBtn.classList.add("open");
}

function toggleFilterDropdown(e) {
  if (e) e.stopPropagation();
  if (!filterDropdown) return;
  if (filterDropdown.classList.contains("hidden")) openFilterDropdown();
  else hideFilterDropdown();
}

if (filterBtn) {
  filterBtn.addEventListener("click", toggleFilterDropdown);
}

function performFullSearch() {
  const q = input.value.trim();
  if (!q) return;
  addToHistory(q); // <-- Додаємо в історію при пошуку
  hideAutocomplete();
  hideFilterDropdown();
  state.filter.query = q;
  if (state.tab !== "filter") setTab("filter"); else renderFilter();
}

let acTimer;
input.addEventListener("focus", () => {
  hideFilterDropdown();
  if (!input.value.trim()) showHistory();
});

input.addEventListener("input", () => {
  hideFilterDropdown();
  clearTimeout(acTimer);
  const q = input.value.trim();
  if (!q) { showHistory(); return; }
  acTimer = setTimeout(async () => {
    try {
      const data = await tmdbFetch(`/search/multi?language=uk-UA&query=${encodeURIComponent(q)}&include_adult=false`);
      showAutocomplete(data.results, q);
    } catch (e) {}
  }, 300);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); performFullSearch(); }
  if (e.key === "Escape") { hideAutocomplete(); hideFilterDropdown(); }
});

document.addEventListener("click", (e) => { 
  if (!e.target.closest(".search-container")) { hideAutocomplete(); hideFilterDropdown(); }
});

function showAutocomplete(rawResults, query) {
  const people = rawResults.filter(r => r.media_type === 'person').slice(0, 2);
  const media = rawResults.filter(r => r.media_type === 'movie' || r.media_type === 'tv').map(normalizeItem).sort((a, b) => b.popularity - a.popularity).slice(0, 6);
  
  autocomplete.replaceChildren(); 
  autocomplete.classList.remove("hidden");
  
  if (!people.length && !media.length) { 
    autocomplete.append(el("div", "ac-empty", 'Нічого не знайдено')); 
    return; 
  }
  
  for (const p of people) {
    const row = el("div", "ac-item");
    const photo = p.profile_path ? el("img", "ac-poster") : el("div", "ac-poster");
    if (p.profile_path) { photo.src = TMDB_IMG + "w185" + p.profile_path; photo.loading = "lazy"; }
    row.append(photo);
    const info = el("div", "ac-info");
    info.append(el("div", "ac-title", p.name));
    info.append(el("div", "ac-meta ac-type-person", "Актор/Акторка"));
    row.append(info);
    row.addEventListener("click", () => { addToHistory(query); hideAutocomplete(); openPerson(p.id, p); });
    autocomplete.append(row);
  }
  
  for (const item of media) {
    const row = el("div", "ac-item");
    row.append(posterEl(item, "ac-poster"));
    const info = el("div", "ac-info");
    info.append(el("div", "ac-title", item.title));
    let meta = (item.type === "tv" ? "Серіал" : "Фільм") + (item.year ? " · " + item.year : "");
    if (item.tmdbRating) meta += ` · ${item.tmdbRating.toFixed(1)}`;
    info.append(el("div", "ac-meta", meta));
    row.append(info);
    row.addEventListener("click", () => { addToHistory(query); hideAutocomplete(); openCard(item); });
    autocomplete.append(row);
  }
  
  const footer = el("div", "ac-footer", `Показати всі результати для "${query}" ↵`);
  footer.addEventListener("click", performFullSearch);
  autocomplete.append(footer);
}
