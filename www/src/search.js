'use strict';

function hideAutocomplete() { 
  autocomplete.classList.add("hidden"); 
  autocomplete.replaceChildren(); 
}

function performFullSearch() {
  const q = input.value.trim();
  if (!q) return;
  hideAutocomplete();
  state.filter.query = q;
  if (state.tab !== "filter") setTab("filter"); else renderFilter();
}

let acTimer;
input.addEventListener("input", () => {
  clearTimeout(acTimer);
  const q = input.value.trim();
  if (!q) { hideAutocomplete(); return; }
  acTimer = setTimeout(async () => {
    try {
      const data = await tmdbFetch(`/search/multi?language=uk-UA&query=${encodeURIComponent(q)}&include_adult=false`);
      showAutocomplete(data.results, q);
    } catch (e) {}
  }, 300);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); performFullSearch(); }
  if (e.key === "Escape") hideAutocomplete();
});

document.addEventListener("click", (e) => { 
  if (!e.target.closest(".search-container")) hideAutocomplete(); 
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
    row.addEventListener("click", () => { hideAutocomplete(); openPerson(p.id, p); });
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
    row.addEventListener("click", () => { hideAutocomplete(); openCard(item); });
    autocomplete.append(row);
  }
  
  const footer = el("div", "ac-footer", `Показати всі результати для "${query}" ↵`);
  footer.addEventListener("click", performFullSearch);
  autocomplete.append(footer);
}
