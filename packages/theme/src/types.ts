import type { ColorValue } from './color.js';
import type {
  neonBlur,
  neonBorder,
  neonColor,
  neonDuration,
  neonEasing,
  neonFaction,
  neonFont,
  neonFontSize,
  neonFontWeight,
  neonGlow,
  neonLetterSpacing,
  neonLineHeight,
  neonRadius,
  neonShadow,
  neonSize,
  neonSpace,
  neonTextGlow,
  neonZ,
} from './neon.js';

/** Token names come from the default theme (`neon.ts`); every theme has the same keys. */
export type ColorKey = keyof typeof neonColor;
export type FactionRole = keyof typeof neonFaction;
export type FontKey = keyof typeof neonFont;
export type FontSizeKey = keyof typeof neonFontSize;
export type FontWeightKey = keyof typeof neonFontWeight;
export type LetterSpacingKey = keyof typeof neonLetterSpacing;
export type LineHeightKey = keyof typeof neonLineHeight;
export type SpaceKey = keyof typeof neonSpace;
export type SizeKey = keyof typeof neonSize;
export type RadiusKey = keyof typeof neonRadius;
export type BorderKey = keyof typeof neonBorder;
export type BlurKey = keyof typeof neonBlur;
export type GlowKey = keyof typeof neonGlow;
export type TextGlowKey = keyof typeof neonTextGlow;
export type ShadowKey = keyof typeof neonShadow;
export type DurationKey = keyof typeof neonDuration;
export type EasingKey = keyof typeof neonEasing;
export type ZKey = keyof typeof neonZ;

/** One box-shadow layer. Lengths are px; `color` names a colour token. */
export interface ShadowLayer {
  readonly x?: number;
  readonly y?: number;
  readonly blur: number;
  readonly spread?: number;
  readonly color: ColorKey;
  /** Multiplied with the colour token's own alpha. */
  readonly alpha: number;
  readonly inset?: boolean;
}

/** One text-shadow layer (no spread, no inset). */
export interface TextShadowLayer {
  readonly x?: number;
  readonly y?: number;
  readonly blur: number;
  readonly color: ColorKey;
  readonly alpha: number;
}

export interface ScaleStep {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly value: number;
}

/** Rules for the `--s` HUD scale: a base value and viewport steps, smallest first. */
export interface ScaleRules {
  readonly base: number;
  readonly steps: readonly ScaleStep[];
}

/** A complete theme. Every group except `name` and `scale` becomes CSS custom properties. */
export interface Theme {
  readonly name: string;
  readonly color: Readonly<Record<ColorKey, ColorValue>>;
  readonly faction: Readonly<Record<FactionRole, ColorValue>>;
  readonly font: Readonly<Record<FontKey, string>>;
  /** px at `--s: 1` */
  readonly fontSize: Readonly<Record<FontSizeKey, number>>;
  readonly fontWeight: Readonly<Record<FontWeightKey, number>>;
  /** em */
  readonly letterSpacing: Readonly<Record<LetterSpacingKey, number>>;
  readonly lineHeight: Readonly<Record<LineHeightKey, number>>;
  /** px at `--s: 1` */
  readonly space: Readonly<Record<SpaceKey, number>>;
  /** px at `--s: 1` */
  readonly size: Readonly<Record<SizeKey, number>>;
  /** px at `--s: 1` */
  readonly radius: Readonly<Record<RadiusKey, number>>;
  /** px, not scaled */
  readonly border: Readonly<Record<BorderKey, number>>;
  /** px */
  readonly blur: Readonly<Record<BlurKey, number>>;
  readonly glow: Readonly<Record<GlowKey, readonly ShadowLayer[]>>;
  readonly textGlow: Readonly<Record<TextGlowKey, readonly TextShadowLayer[]>>;
  readonly shadow: Readonly<Record<ShadowKey, readonly ShadowLayer[]>>;
  /** ms */
  readonly duration: Readonly<Record<DurationKey, number>>;
  readonly easing: Readonly<Record<EasingKey, string>>;
  readonly z: Readonly<Record<ZKey, number>>;
  readonly scale: ScaleRules;
}

/** The theme groups that are emitted as CSS custom properties. */
export type TokenGroup = Exclude<keyof Theme, 'name' | 'scale'>;

/** Overrides for `createTheme`: any subset of tokens. Arrays (glow layers, scale steps) are replaced whole. */
export type ThemeOverrides = {
  readonly [G in Exclude<keyof Theme, 'name'>]?: Theme[G] extends ScaleRules
    ? Partial<ScaleRules>
    : Partial<Theme[G]>;
};
