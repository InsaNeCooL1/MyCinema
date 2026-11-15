import { describe, it, expect } from 'vitest';

describe('escapeHtml', () => {
  it('екранує <script>', () => {
    expect(window.escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('екранує лапки', () => {
    expect(window.escapeHtml('"it\'s"')).toBe('&quot;it&#39;s&quot;');
  });

  it('null/undefined → порожній рядок', () => {
    expect(window.escapeHtml(null)).toBe('');
    expect(window.escapeHtml(undefined)).toBe('');
  });
});
