import { describe, expect, it } from 'vitest';
import { toPixiPalette, type PixiColor } from './pixi.js';
import { themes } from './themes.js';

describe.each(Object.entries(themes))('toPixiPalette(%s)', (_, theme) => {
  const palette = toPixiPalette(theme);

  it('matches every colour and faction hex value', () => {
    for (const group of ['color', 'faction'] as const) {
      for (const [key, hex] of Object.entries(theme[group])) {
        const colors: Readonly<Record<string, PixiColor | undefined>> = palette[group];
        const entry = colors[key];
        if (entry === undefined) throw new Error(`missing ${group}.${key}`);
        expect(entry.color, `${group}.${key}`).toBe(Number.parseInt(hex.slice(1, 7), 16));
        const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
        expect(entry.alpha, `${group}.${key}`).toBeCloseTo(alpha, 3);
        expect(Number.isInteger(entry.color) && entry.color >= 0 && entry.color <= 0xffffff).toBe(
          true,
        );
      }
    }
  });

  it('passes font sizes and map numbers through', () => {
    expect(palette.fontSize).toEqual(theme.fontSize);
    expect(palette.map).toEqual(theme.map);
    expect(palette.map.pitchX).toBeGreaterThan(palette.map.street);
    expect(palette.map.acrossMin).toBeLessThan(palette.map.acrossDistrict);
    expect(palette.map.acrossDistrict).toBeLessThan(palette.map.acrossTactical);
    expect(palette.map.acrossTactical).toBeLessThan(palette.map.acrossCity);
  });

  it('resolves glow layers to numbers', () => {
    for (const [key, layers] of Object.entries(theme.glow)) {
      const out = palette.glow[key as keyof typeof palette.glow];
      expect(out).toHaveLength(layers.length);
      layers.forEach((layer, i) => {
        expect(out[i]?.color).toBe(palette.color[layer.color].color);
        expect(out[i]?.alpha).toBeCloseTo(palette.color[layer.color].alpha * layer.alpha, 3);
        expect(out[i]?.blur).toBe(layer.blur);
      });
    }
  });
});
