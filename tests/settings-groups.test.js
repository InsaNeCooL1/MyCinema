import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';

describe('Налаштування — меню з 4 груп', () => {
  beforeEach(() => {
    closeSettings();
    // room.js вішає обробники онлайн-полів при старті; у jsdom викликаємо явно.
    if (window.mcRoom && typeof window.mcRoom.injectSettings === 'function') window.mcRoom.injectSettings();
  });

  it('меню має 4 пункти й кожен відкриває свою окрему модалку', () => {
    const buttons = document.querySelectorAll('#settings-modal .settings-group-btn');
    expect(buttons.length).toBe(4);
    expect(Array.from(buttons).map((b) => b.dataset.group)).toEqual(['view', 'online', 'extra', 'data']);

    const ids = ['settings-view-modal', 'settings-online-modal', 'settings-extra-modal', 'settings-data-modal'];
    buttons.forEach((btn, i) => {
      btn.addEventListener('click', () => openSettingsGroup(btn.dataset.group));
      btn.click();
      expect(document.getElementById(ids[i]).classList.contains('open')).toBe(true);
      expect(document.getElementById('settings-modal').classList.contains('open')).toBe(false);
      const others = ids.filter((id) => id !== ids[i]);
      others.forEach((id) => expect(document.getElementById(id).classList.contains('open')).toBe(false));
    });
  });

  it('кнопка «назад» повертає в меню, а потім закриває все', () => {
    expect(typeof handleSettingsBack).toBe('function');
    openSettingsGroup('extra');
    expect(handleSettingsBack()).toBe(true);
    expect(document.getElementById('settings-extra-modal').classList.contains('open')).toBe(false);
    expect(document.getElementById('settings-modal').classList.contains('open')).toBe(true);

    expect(handleSettingsBack()).toBe(true);
    expect(document.querySelectorAll('.settings-modal.open').length).toBe(0);
    expect(handleSettingsBack()).toBe(false);
  });

  it('всі групові модалки мають базовий оверлейний стиль (приховані до відкриття)', () => {
    const css = fs.readFileSync('styles/20-desktop-stats.css', 'utf-8');
    expect(css).toMatch(/#auth-modal,\s*\.settings-modal\s*\{[^}]*position:\s*fixed[^}]*display:\s*none/);
    expect(css).toMatch(/\.settings-modal\.open\s*\{\s*display:\s*flex/);
  });

  it('перемикач «по мережі» показує й ховає поля парсеру та сервера', () => {
    openSettingsGroup('online');
    const toggle = document.getElementById('network-enable-toggle');
    const fields = document.getElementById('online-network-fields');
    expect(toggle).toBeTruthy();
    expect(fields.hidden).toBe(true);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fields.hidden).toBe(false);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fields.hidden).toBe(true);
  });
});
