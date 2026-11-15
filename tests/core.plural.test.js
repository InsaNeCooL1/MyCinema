import { describe, it, expect } from 'vitest';

describe('plural', () => {
  it('1 → one', () => {
    expect(window.plural(1, 'рік', 'роки', 'років')).toBe('рік');
  });
  it('2 → few', () => {
    expect(window.plural(2, 'рік', 'роки', 'років')).toBe('роки');
  });
  it('5 → many', () => {
    expect(window.plural(5, 'рік', 'роки', 'років')).toBe('років');
  });
  it('11 → many (не few)', () => {
    expect(window.plural(11, 'рік', 'роки', 'років')).toBe('років');
  });
  it('21 → one', () => {
    expect(window.plural(21, 'рік', 'роки', 'років')).toBe('рік');
  });
  it('0 → many', () => {
    expect(window.plural(0, 'рік', 'роки', 'років')).toBe('років');
  });
});
