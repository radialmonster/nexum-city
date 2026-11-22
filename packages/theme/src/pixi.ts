import { parseColor } from './color.js';
import type {
  ColorKey,
  FactionRole,
  FontKey,
  FontSizeKey,
  GlowKey,
  MapKey,
  ShadowLayer,
  Theme,
} from './types.js';

/** A colour as PixiJS takes it, e.g. `graphics.fill({ color, alpha })`. */
export interface PixiColor {
  /** `0xRRGGBB` */
  readonly color: number;
  /** 0–1 */
  readonly alpha: number;
}

/** A glow layer for a map filter: blur radius in px, colour and final alpha. */
export interface PixiGlowLayer extends PixiColor {
  readonly blur: number;
  readonly inset: boolean;
}

/** Everything the PixiJS map renderer reads from a theme. */
export interface PixiPalette {
  readonly color: Readonly<Record<ColorKey, PixiColor>>;
  readonly faction: Readonly<Record<FactionRole, PixiColor>>;
  readonly glow: Readonly<Record<GlowKey, readonly PixiGlowLayer[]>>;
  readonly font: Readonly<Record<FontKey, string>>;
  /** px at `--s: 1`; the map scales them by the HUD scale. */
  readonly fontSize: Readonly<Record<FontSizeKey, number>>;
  /** Map geometry and camera numbers. */
  readonly map: Readonly<Record<MapKey, number>>;
}

function toPixiColor(value: string): PixiColor {
  const { rgb, alpha } = parseColor(value);
  return { color: rgb, alpha };
}

function mapValues<K extends string, V, R>(
  record: Readonly<Record<K, V>>,
  fn: (v: V) => R,
): Record<K, R> {
  const out: Partial<Record<K, R>> = {};
  for (const key of Object.keys(record) as K[]) out[key] = fn(record[key]);
  return out as Record<K, R>;
}

/**
 * The numeric palette for the PixiJS map, so the map and the HUD never drift
 * apart. Rebuild it when the theme changes.
 */
export function toPixiPalette(theme: Theme): PixiPalette {
  const glowLayer = (l: ShadowLayer): PixiGlowLayer => {
    const base = toPixiColor(theme.color[l.color]);
    return {
      color: base.color,
      alpha: Math.round(base.alpha * l.alpha * 1000) / 1000,
      blur: l.blur,
      inset: l.inset === true,
    };
  };
  return {
    color: mapValues(theme.color, toPixiColor),
    faction: mapValues(theme.faction, toPixiColor),
    glow: mapValues(theme.glow, (layers) => layers.map(glowLayer)),
    font: { ...theme.font },
    fontSize: { ...theme.fontSize },
    map: { ...theme.map },
  };
}
