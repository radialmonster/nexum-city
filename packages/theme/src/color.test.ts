import { describe, expect, it } from 'vitest';
import { isColorValue, parseColor, toCssRgba, withAlpha } from './color.js';

describe('colour helpers', () => {
  it('accepts only lowercase #rrggbb and #rrggbbaa', () => {
    expect(isColorValue('#19f0ff')).toBe(true);
    expect(isColorValue('#19f0ff80')).toBe(true);
    for (const bad of ['#fff', '#19F0FF', '19f0ff', '#19f0f', 'rgb(0,0,0)', 'red', '']) {
      expect(isColorValue(bad), bad).toBe(false);
    }
  });

  it('parses hex into a number and alpha', () => {
    expect(parseColor('#19f0ff')).toEqual({ rgb: 0x19f0ff, alpha: 1 });
    expect(parseColor('#00000080')).toEqual({ rgb: 0, alpha: 0.502 });
    expect(() => parseColor('#fff')).toThrow(/Invalid theme colour/);
  });

  it('withAlpha writes #rrggbbaa', () => {
    expect(withAlpha('#19f0ff', 0.28)).toBe('#19f0ff47');
    expect(withAlpha('#000000', 0)).toBe('#00000000');
    expect(() => withAlpha('#000000', 2)).toThrow();
  });

  it('toCssRgba multiplies alphas', () => {
    expect(toCssRgba('#19f0ff', 0.06)).toBe('rgba(25, 240, 255, 0.06)');
    expect(toCssRgba('#ff000080', 0.5)).toBe('rgba(255, 0, 0, 0.251)');
  });
});
