/**
 * Colour values used by every theme.
 *
 * A token colour is always a lowercase hex string: `#rrggbb` when opaque, or
 * `#rrggbbaa` when it carries its own alpha. One format keeps the CSS output
 * and the numeric PixiJS palette trivially in step.
 */
export type ColorValue = `#${string}`;

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;

/** True when `value` is a valid token colour (`#rrggbb` or `#rrggbbaa`, lowercase). */
export function isColorValue(value: string): value is ColorValue {
  return HEX_COLOR.test(value);
}

/** A colour split into its numeric parts. `rgb` is `0xRRGGBB`; `alpha` is 0–1. */
export interface ParsedColor {
  readonly rgb: number;
  readonly alpha: number;
}

/** Parse a token colour. Throws on anything that is not `#rrggbb` or `#rrggbbaa`. */
export function parseColor(value: string): ParsedColor {
  if (!isColorValue(value)) {
    throw new Error(`Invalid theme colour "${value}": expected #rrggbb or #rrggbbaa`);
  }
  const rgb = Number.parseInt(value.slice(1, 7), 16);
  const alpha = value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) / 255 : 1;
  return { rgb, alpha: roundAlpha(alpha) };
}

/**
 * Return `color` with its alpha set to `alpha` (0–1), as `#rrggbbaa`.
 * Use it inside theme definitions, e.g. `withAlpha(cyan, 0.28)` for a line colour.
 */
export function withAlpha(color: ColorValue, alpha: number): ColorValue {
  if (alpha < 0 || alpha > 1 || Number.isNaN(alpha)) {
    throw new Error(`Alpha must be between 0 and 1, got ${String(alpha)}`);
  }
  const { rgb } = parseColor(color);
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${rgb.toString(16).padStart(6, '0')}${a}`;
}

/** CSS `rgba()` text for a token colour, with an extra alpha multiplier (default 1). */
export function toCssRgba(value: ColorValue, alphaMultiplier = 1): string {
  const { rgb, alpha } = parseColor(value);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(roundAlpha(alpha * alphaMultiplier))})`;
}

function roundAlpha(alpha: number): number {
  return Math.round(alpha * 1000) / 1000;
}
