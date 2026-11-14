'use strict';

// ============ API ============
const PROXY_URL = "https://mycinema-proxy.insaneteresh123.workers.dev";
const TMDB_IMG = "https://image.tmdb.org/t/p/";

// ============ CONSTANTS ============
const LS = "mycinema.library";
const LS_VER = "mycinema.library.v";
const RECS_CACHE = "mycinema.recs.v4";
const EXCLUDED_TV_GENRES = [10763, 10764, 10767];
const ANIMATION_GENRE_ID = 16;
const CAST_LIMIT = 10;
const ELO_START = 1500;
const ELO_K = 32;
const TASTE_HALFLIFE_DAYS = 180;
const ACTOR_ADJUST_STEP = 0.35;
const ACTOR_ADJUST_KEY = 'mycinema.actorAdjustments';
const ACTOR_REF_PROJECTS = 6;
const ACTOR_LEAD_MAX_INDEX = 3;
const ACTOR_PENALTY_START = -0.35;
const ACTOR_PENALTY_10_DELTA = -0.85;
const ACTOR_PENALTY_CAP = 0.25;
const ACTOR_FRANCHISE_CAP = 0.09;
const MCU_COMPANY_IDS = [420, 38679];
/* FIX-LOCAL-KEYS */
window.MC_LOCAL_KEYS = ['mycinema.library','mycinema.library.v','mycinema.deleted','mycinema.dismissed','mycinema.dismissedClearedAt','mycinema.actorAdjustments','mycinema.actorAdjustTs','mycinema.search_history','kingOfTheHillHistory','mycinema.recs.v4','mycinema.home.general.v6','mycinema.metaCache.v1','mycinema.colCache.v1','mycinema.appearance.ts','mycinema.splashPool.v1','mycinema.factDismissedDate','onboardingDone','mycinema.librarySort','mycinema.home.tab','mycinema.home.mode']; /* FIX-PERSIST-KEYS */ // Marvel Studios (420), Marvel Television (38679) // Marvel Studios (420), Marvel Television (38679)

// ============ MOODS ============
/* FIX-MOOD-WEIGHT-CFG
   weight — наскільки сильно настрій впливає на рекомендації.
   1.0 = нейтрально. 1.5 = сильно тягне вгору. 0.5 = слабкий біас.
   Зміна weight інвалідовує кеш (потрібен reload + клік mood-pill). */
const MOODS = {
  chill:      { label: 'Спокій',  emoji: '🌊', genres: [35, 10749, 16], tvGenres: [35, 16, 18], weight: 3.0 },
  intense:    { label: 'Напруга', emoji: '⚡', genres: [53, 80, 28], tvGenres: [80, 9648, 10768], weight: 3.0 },
  thoughtful: { label: 'Роздуми', emoji: '🕯️', genres: [18, 99, 9648], tvGenres: [18, 99, 9648], weight: 3.0 },
  fun:        { label: 'Розвага', emoji: '🎈', genres: [12, 35, 16], tvGenres: [35, 16, 10751, 10762], weight: 3.0 },
  dark:       { label: 'Похмуре', emoji: '🌑', genres: [80, 27, 53], tvGenres: [80, 9648, 18], weight: 3.0 },
  epic:       { label: 'Епічне',  emoji: '🌋', genres: [12, 14, 10752], tvGenres: [10765, 10768, 18], weight: 3.0 } /* FIX-MOOD-WEIGHT-23 */
};

// ============ STREAMING ============
const STREAMING_PROVIDERS = [
  { id: 8, name: 'Netflix' }, { id: 1899, name: 'Max / HBO' }, { id: 9, name: 'Prime Video' },
  { id: 350, name: 'Apple TV+' }, { id: 15, name: 'Hulu' }, { id: 386, name: 'Peacock' }, { id: 29, name: 'Sky' }
];

// ============ RATING CRITERIA ============
const RATING_CRITERIA = [
  { key: 'plot', label: 'Сюжет' }, { key: 'cast', label: 'Персонажі і каст' },
  { key: 'style', label: 'Стилістика і картинка' }, { key: 'emotions', label: 'Емоції' },
  { key: 'overall', label: 'Загальне враження' }
];

// ============ GENRES ============
const GENRES = [
  { id: 28, name: 'Бойовик' }, { id: 12, name: 'Пригоди' }, { id: 16, name: 'Анімація' },
  { id: 35, name: 'Комедія' }, { id: 80, name: 'Кримінал' }, { id: 99, name: 'Документальне' },
  { id: 18, name: 'Драма' }, { id: 10751, name: 'Сімейне' }, { id: 14, name: 'Фентезі' },
  { id: 36, name: 'Історія' }, { id: 27, name: 'Жахи' }, { id: 10402, name: 'Музика' },
  { id: 9648, name: 'Детектив' }, { id: 10749, name: 'Романтика' }, { id: 878, name: 'Фантастика' },
  { id: 53, name: 'Трилер' }, { id: 10752, name: 'Війна' }, { id: 37, name: 'Вестерн' }
];

// ============ PLACEHOLDERS ============
const PLACEHOLDERS = [
  'Від чого кайфонем сьогодні?', 'Що дивимось сьогодні?', 'Знайди свій наступний улюблений фільм',
  'Серіал на вечір?', 'Шукаєш щось конкретне?', 'Ну що, кіно?',
  'Який настрій сьогодні?', 'Знайти щось нове?', 'Твій наступний улюблений серіал?',
  'Хочу щось атмосферне…', 'Що глянемо на вихідних?'
];

// ============ THEMES ============
const THEMES = {
  navy:  { name: 'Navy',  bg0:'#08070a', bg1:'#0f0e13', bg2:'#16141b', bg3:'#201d28', bg4:'#2a2635', sidebar:'#06050a', query:'#040308', text:'#f2eee9', textSecondary:'#cfc8c0', textMuted:'#8d877f', textDim:'#575349' },
  black: { name: 'Black', bg0:'#000000', bg1:'#0a0a0a', bg2:'#141414', bg3:'#1e1e1e', bg4:'#2a2a2a', sidebar:'#050505', query:'#000000', text:'#f0f0f0', textSecondary:'#c0c0c0', textMuted:'#888', textDim:'#444' },
  plum:  { name: 'Plum',  bg0:'#0c0512', bg1:'#150a20', bg2:'#1f0e2f', bg3:'#301848', bg4:'#422458', sidebar:'#0a0410', query:'#070310', text:'#f0e8f5', textSecondary:'#d8cfe6', textMuted:'#9a8fb5', textDim:'#5a4f7a' },
  forest:{ name: 'Forest',light: false, bg0:'#030b06', bg1:'#0a1510', bg2:'#0f2018', bg3:'#183020', bg4:'#22432f', sidebar:'#050d08', query:'#020705', text:'#e8f2ec', textSecondary:'#cfe6d8', textMuted:'#8fb5a0', textDim:'#4f7a5a' },
  mocha: { name: 'Mocha', bg0:'#0b0805', bg1:'#150f0a', bg2:'#1f1710', bg3:'#2f2618', bg4:'#403522', sidebar:'#0a0705', query:'#060403', text:'#f2ebe0', textSecondary:'#e6d8c7', textMuted:'#b5a08f', textDim:'#7a5f4a' }
};

// ============ ACCENTS ============
const ACCENTS = {
  amber:  { name: 'Amber',  accent:'#ffb86c', hover:'#ffc98a', fg:'#1a1207' },
  lime:   { name: 'Lime',   accent:'#c6f432', hover:'#d6ff42', fg:'#111' },
  cyan:   { name: 'Cyan',   accent:'#22d3ee', hover:'#3ddcf5', fg:'#0a1a1e' },
  coral:  { name: 'Coral',  accent:'#ff7b5c', hover:'#ff9578', fg:'#1a0703' },
  violet: { name: 'Violet', accent:'#c5a3ff', hover:'#d4b8ff', fg:'#1a0a3a' },
  emerald:{ name: 'Emerald',accent:'#10b981', hover:'#22c997', fg:'#ffffff' },
  rose:   { name: 'Rose',   accent:'#ff6b9d', hover:'#ff85ad', fg:'#2a0520' }
};

/* FIX-MOOD-WEIGHT-30 */
