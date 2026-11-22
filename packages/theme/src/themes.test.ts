import { describe, expect, it } from 'vitest';
import { isColorValue } from './color.js';
import { highContrast, neon, themes } from './themes.js';
import type { Theme } from './types.js';

/** Every key path in a theme, with arrays treated as leaves. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value)
    .flatMap(([k, v]) => keyPaths(v, prefix === '' ? k : `${prefix}.${k}`))
    .sort();
}

const allThemes: [string, Theme][] = Object.entries(themes);

describe('themes', () => {
  it.each(allThemes)(
    '%s: panelSolid (radial, hub fills) stays dark so white labels read',
    (_n, t) => {
      // regression: the radial menu once rendered as pale discs with unreadable labels
      const hex = t.color.panelSolid.replace('#', '');
      const lum =
        [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0) / 3;
      expect(lum).toBeLessThan(40);
    },
  );

  it('highContrast has exactly the same keys as the default theme', () => {
    expect(keyPaths(highContrast)).toEqual(keyPaths(neon));
  });

  it('really differs from the default theme', () => {
    expect(highContrast.name).toBe('highContrast');
    expect(highContrast.color.bg).not.toBe(neon.color.bg);
    expect(highContrast.faction.raider).not.toBe(neon.faction.raider);
  });

  it('keeps inherited tokens from the default theme', () => {
    expect(highContrast.space).toEqual(neon.space);
    expect(highContrast.font).toEqual(neon.font);
  });

  it.each(allThemes)('%s: every colour and faction token is a valid colour', (_, theme) => {
    for (const value of [...Object.values(theme.color), ...Object.values(theme.faction)]) {
      expect(isColorValue(value), value).toBe(true);
    }
  });

  it.each(allThemes)('%s: glow layers name real colours and use alphas in 0..1', (_, theme) => {
    const layers = [
      ...Object.values(theme.glow),
      ...Object.values(theme.textGlow),
      ...Object.values(theme.shadow),
    ].flat();
    for (const layer of layers) {
      expect(Object.keys(theme.color)).toContain(layer.color);
      expect(layer.alpha).toBeGreaterThanOrEqual(0);
      expect(layer.alpha).toBeLessThanOrEqual(1);
    }
  });

  it.each(allThemes)('%s: numeric tokens are finite', (_, theme) => {
    const groups = [
      theme.fontSize,
      theme.fontWeight,
      theme.letterSpacing,
      theme.lineHeight,
      theme.space,
      theme.size,
      theme.radius,
      theme.border,
      theme.blur,
      theme.duration,
      theme.z,
    ];
    for (const n of groups.flatMap((g) => Object.values(g))) expect(Number.isFinite(n)).toBe(true);
  });

  it('keeps the mockup scale steps, each with a height condition', () => {
    expect(neon.scale.steps.map((s) => [s.minWidth, s.minHeight, s.value])).toEqual([
      [1800, 1150, 1.2],
      [2200, 1300, 1.4],
      [2900, 1550, 1.7],
      [3500, 1900, 2],
    ]);
  });
});
