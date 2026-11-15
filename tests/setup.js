import fs from 'node:fs';
import { vi, beforeEach } from 'vitest';

// ══════════════════════════════════════════════════════════
// 1. МОКИ — до loadScript
// ══════════════════════════════════════════════════════════
window.matchMedia = function (query) {
  return {
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  };
};

window.supabase = {
  auth: {
    signInWithPassword: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(), onAuthStateChange: vi.fn(), getSession: vi.fn(),
  },
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockResolvedValue({ error: null }),
  })),
};

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(''),
  })
);

window.currentUser = null;
window.firebaseReady = false;

if (!global.localStorage) {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] || null,
  };
  window.localStorage = global.localStorage;
}

if (typeof window.MutationObserver === 'undefined') {
  window.MutationObserver = class {
    observe() {} disconnect() {} takeRecords() { return []; }
  };
}

// ══════════════════════════════════════════════════════════
// 2. DOM
// ══════════════════════════════════════════════════════════
document.body.innerHTML = `
  <input id="q" type="search" placeholder="" />
  <div id="results"></div>
  <div id="overlay"><div id="card"></div></div>
  <div id="autocomplete"></div>
  <div id="type-filter"></div>
  <div id="sync-indicator"></div>
  <div id="poster-zoom"><img alt="" /></div>
  <div id="auth-modal"></div>
  <div id="settings-modal"></div>
  <input type="file" id="import-file" />
  <div id="onboarding-modal">
    <div id="onb-scroll"></div>
    <button id="onb-submit"></button>
  </div>
`;

// ══════════════════════════════════════════════════════════
// 3. LOAD SRC AS CLASSIC SCRIPTS
// ══════════════════════════════════════════════════════════
function loadScript(rel) {
  let code = fs.readFileSync(rel, 'utf-8');
  code = code.replace(/^['"]use strict['"];?\s*/, '');
  code = code.replace(/^(const|let)\s+/gm, 'var ');
  (0, eval)(code);
}
window.loadScript = loadScript;

loadScript('src/config.js');
if (typeof window.LS_VER === 'undefined') {
  throw new Error('Setup FAIL: config.js globals missing. LS_VER = ' + window.LS_VER);
}
loadScript('src/core.js');
loadScript('src/settings.js');
loadScript('src/home.js');

// ══════════════════════════════════════════════════════════
// 4. CLEANUP
// ══════════════════════════════════════════════════════════
beforeEach(() => {
  localStorage.clear();
  window.lib = {};
  window.currentUser = null;
  window.firebaseReady = false;
  if (window.onbSelected instanceof Set) window.onbSelected.clear();
  if (Array.isArray(window.onbCategories)) window.onbCategories.length = 0;
  if (window._dirtyItems instanceof Set) window._dirtyItems.clear();
});
