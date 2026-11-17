import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Діагностичний набір: НЕ змінює поведінку застосунку, лише фіксує
// механізми, через які відповідь може бути повільною і довгою.
window.loadScript('src/chat.js');

const CHAIN_IDS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => data,
  };
}

function sseChunk(parts, extra, finishReason) {
  const candidate = { content: { parts } };
  if (finishReason) candidate.finishReason = finishReason;
  return 'data: ' + JSON.stringify(Object.assign({
    candidates: [candidate]
  }, extra || {})) + '\n\n';
}

function sseResponse(chunks) {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let at = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader: () => ({
        read: async () => (at < encoded.length ? { done: false, value: encoded[at++] } : { done: true }),
      }),
    },
  };
}

function submitChat(text) {
  const root = document.querySelector('.mc-chat-root');
  if (!root || !root.classList.contains('open')) {
    const fab = document.querySelector('.mc-chat-fab');
    if (fab) fab.click();
    else window.mcChat.open();
  }
  const input = document.querySelector('.mc-chat-input');
  input.value = text;
  document.querySelector('.mc-chat-compose').dispatchEvent(
    new Event('submit', { cancelable: true, bubbles: true })
  );
}

function requestBodyAt(index) {
  return JSON.parse(global.fetch.mock.calls[index][1].body);
}

async function waitDone(timeout = 3000) {
  await vi.waitFor(() => {
    expect(document.querySelector('.mc-chat-send')).toBeTruthy();
    expect(document.querySelector('.mc-chat-send').textContent).toBe('→');
  }, { timeout });
}

beforeEach(() => {
  window.cardStack = [];
  window.state = { tab: 'home', home: { recs: null } };
  localStorage.removeItem('mycinema.geminiKey');
  localStorage.removeItem('mycinema.geminiQuota');
  localStorage.removeItem('mycinema.geminiModel');
  window.mcChat.clear(true);
  window.mcChat.setEnabled(true);
  window.mcChat._state.health = null;
  window.mcChat._state.healthTs = 0;
});

afterEach(() => {
  window.mcChat.close();
});

describe('діагностика повільного Gemini 4 — тільки тести', () => {
  it('1. обидві моделі мають thinkingLevel: low', async () => {
    window.mcChat.setApiKey('AIza-diag');
    const seen = [];

    for (const id of CHAIN_IDS) {
      window.mcChat.clear(true);
      window.mcChat.setModel(id);
      window.mcChat._state.health = { ok: true, status: 200, models: [id] };
      global.fetch = vi.fn(async () => jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Ок' }] } }],
      }));

      submitChat('Тест ' + id);
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1), { timeout: 2000 });
      await waitDone();

      const url = String(global.fetch.mock.calls[0][0]);
      const body = requestBodyAt(0);
      expect(url).toContain(id);
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
      seen.push(id + ' → ' + body.generationConfig.thinkingConfig.thinkingLevel);
    }

    console.info('[diag][thinking]', seen.join(' | '));
    expect(seen).toHaveLength(CHAIN_IDS.length);
  });

  it('2. історія з thought-частин роздуває тіло запиту в рази', async () => {
    window.mcChat.setApiKey('AIza-diag');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    window.mcChat.clear(true);

    const thought = 'Міркую над відповіддю дуже довго. '.repeat(80); // ~2.7 KB
    for (let i = 0; i < 6; i++) {
      window.mcChat._state.messages.push({
        role: 'user',
        content: 'Питання ' + i,
        ts: Date.now(),
      });
      window.mcChat._state.messages.push({
        role: 'assistant',
        content: 'Коротка відповідь ' + i,
        parts: [
          { text: thought, thought: true, thoughtSignature: 'sig-diag-' + i },
          { text: 'Коротка відповідь ' + i },
        ],
        ts: Date.now(),
      });
    }

    global.fetch = vi.fn(async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: 'Ок' }] } }],
    }));

    submitChat('Останнє питання');
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitDone();

    const raw = JSON.stringify(requestBodyAt(0));
    const contentsSize = JSON.stringify(requestBodyAt(0).contents).length;
    const plainContents = requestBodyAt(0).contents.map((m) => ({
      role: m.role,
      parts: [{ text: m.parts.map((p) => p.text || '').join(' ').slice(0, 60) }],
    }));
    const plainSize = JSON.stringify(plainContents).length;

    // Після виправлення історія не несе міркувань і підписів.
    expect(raw).not.toContain('sig-diag-5');
    expect(raw).not.toContain(thought.slice(0, 25));
    expect(contentsSize).toBeLessThan(plainSize * 2);

    console.info('[diag][history] contents:', contentsSize, 'символів; еталон чистої історії:', plainSize, 'символів; усе тіло:', raw.length);
  });

  it('3. thought-only відповідь не повторює обрану модель', async () => {
    window.mcChat.setApiKey('AIza-diag');
    window.mcChat._state.health = { ok: true, status: 200, models: CHAIN_IDS };
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Міркую…', thought: true }] } }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Раджу «Дюну»' }] } }],
      }));

    submitChat('Порадь серіал на кілька вечорів');
    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-error')).toBeTruthy();
    }, { timeout: 3000 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('gemini-3.5-flash-lite');
    expect(requestBodyAt(0).generationConfig.maxOutputTokens).toBe(8192);

    console.info('[diag][retry] запитів:', global.fetch.mock.calls.length, 'ліміт:', 8192);
  });

  it('4. телеметрія збирає usageMetadata, finishReason і таймінги', async () => {
    window.mcChat.setApiKey('AIza-diag');
    window.mcChat._state.health = { ok: true, status: 200, models: ['gemini-3.5-flash-lite'] };
    global.fetch = vi.fn(async () => sseResponse([
      sseChunk(
        [{ text: 'Міркую…', thought: true }, { text: 'Раджу «Дюну»' }],
        {
          usageMetadata: {
            promptTokenCount: 1200,
            thoughtsTokenCount: 3400,
            candidatesTokenCount: 90,
            totalTokenCount: 4690,
          },
        },
        'MAX_TOKENS'
      ),
    ]));

    submitChat('Порадь серіал');
    await vi.waitFor(() => {
      expect(document.querySelector('.mc-chat-msg.assistant .mc-chat-bubble').textContent).toContain('Раджу «Дюну»');
    }, { timeout: 3000 });

    const t = window.mcChat._state.lastTiming;
    expect(t).toBeTruthy();
    expect(t.model).toBe('gemini-3.5-flash-lite');
    expect(t.status).toBe(200);
    expect(t.maxOutputTokens).toBe(8192);
    expect(t.usage).toMatchObject({
      promptTokenCount: 1200,
      thoughtsTokenCount: 3400,
      candidatesTokenCount: 90,
      totalTokenCount: 4690,
    });
    expect(t.finishReason).toBe('MAX_TOKENS');
    expect(t.totalMs).toBeGreaterThanOrEqual(0);
    expect(window.mcChat._state.timings).toContain(t);
    expect(window.mcChat._debug.lastTiming()).toBe(t);

    console.info('[diag][timing]', JSON.stringify({
      totalMs: t.totalMs,
      usage: t.usage,
      finishReason: t.finishReason,
    }));
  });

  it('5. довгу відповідь обрізаємо до 6 речень і 900 символів', () => {
    const long = Array.from({ length: 10 }, (_, i) => `Речення номер ${i + 1} з порадою.`).join(' ');
    const trimmed = window.mcChat._debug.trimAnswer(long);
    expect(trimmed.match(/[.!?…]+/g).length).toBeLessThanOrEqual(6);
    expect(trimmed.length).toBeLessThanOrEqual(900);
    expect(trimmed).not.toContain('Речення номер 7');
  });
});
