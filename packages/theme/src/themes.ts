import {
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
  neonScale,
  neonShadow,
  neonSpace,
  neonTextGlow,
  neonZ,
} from './neon.js';
import { withAlpha } from './color.js';
import type { Theme, ThemeOverrides } from './types.js';

/** The default theme: the mockup's cyan and magenta neon on near-black. */
export const neon: Theme = {
  name: 'neon',
  color: neonColor,
  faction: neonFaction,
  font: neonFont,
  fontSize: neonFontSize,
  fontWeight: neonFontWeight,
  letterSpacing: neonLetterSpacing,
  lineHeight: neonLineHeight,
  space: neonSpace,
  radius: neonRadius,
  border: neonBorder,
  blur: neonBlur,
  glow: neonGlow,
  textGlow: neonTextGlow,
  shadow: neonShadow,
  duration: neonDuration,
  easing: neonEasing,
  z: neonZ,
  scale: neonScale,
};

/**
 * Build a theme from `base` with some tokens replaced. Only existing keys can be
 * overridden (the type forbids new ones), so every theme keeps the same shape.
 */
export function createTheme(base: Theme, name: string, overrides: ThemeOverrides): Theme {
  return {
    name,
    color: { ...base.color, ...overrides.color },
    faction: { ...base.faction, ...overrides.faction },
    font: { ...base.font, ...overrides.font },
    fontSize: { ...base.fontSize, ...overrides.fontSize },
    fontWeight: { ...base.fontWeight, ...overrides.fontWeight },
    letterSpacing: { ...base.letterSpacing, ...overrides.letterSpacing },
    lineHeight: { ...base.lineHeight, ...overrides.lineHeight },
    space: { ...base.space, ...overrides.space },
    radius: { ...base.radius, ...overrides.radius },
    border: { ...base.border, ...overrides.border },
    blur: { ...base.blur, ...overrides.blur },
    glow: { ...base.glow, ...overrides.glow },
    textGlow: { ...base.textGlow, ...overrides.textGlow },
    shadow: { ...base.shadow, ...overrides.shadow },
    duration: { ...base.duration, ...overrides.duration },
    easing: { ...base.easing, ...overrides.easing },
    z: { ...base.z, ...overrides.z },
    scale: { ...base.scale, ...overrides.scale },
  };
}

/**
 * High contrast: opaque black panels, brighter text and lines, faction colours
 * pushed apart, and softer glows so edges stay sharp.
 */
export const highContrast: Theme = createTheme(neon, 'highContrast', {
  color: {
    bg: '#000000',
    bgAlt: '#000000',
    bgGlow: '#000000',
    surface: '#000000',
    panel: withAlpha('#000000', 0.96),
    panelSolid: '#000000',
    overlay: withAlpha('#000000', 0.75),
    line: withAlpha('#00ffff', 0.85),
    lineSoft: withAlpha('#00ffff', 0.5),
    lineStrong: '#00ffff',
    text: '#ffffff',
    textDim: '#c8d6e5',
    textMuted: '#b4c2d4',
    textBright: '#ffffff',
    textOnAccent: '#000000',
    textOnWarn: '#000000',
    accent: '#00ffff',
    accentAlt: '#ff4fe0',
    danger: '#ff5c74',
    warn: '#ffc400',
    ok: '#9dff00',
    info: '#00ffff',
    news: '#80a8ff',
    special: '#c9a3ff',
    disabled: '#8a93a8',
    street: '#1b3a52',
    streetGlow: withAlpha('#00ffff', 0.45),
    plot: '#c0ccda',
    fog: '#000000',
    fogStatic: withAlpha('#a0b4d0', 0.35),
    labelHalo: '#000000',
    scanline: withAlpha('#ffffff', 0),
  },
  faction: {
    self: '#00ffff',
    raider: '#ff4fe0',
    turtle: '#ffc400',
    merchant: '#9dff00',
    hunter: '#c9a3ff',
    newcomer: '#80a8ff',
    neutral: '#8a93a8',
    rival: '#ff8c40',
  },
  glow: {
    panel: [],
    accent: [{ blur: 6, color: 'accent', alpha: 1 }],
    accentSoft: [{ blur: 3, color: 'accent', alpha: 1 }],
  },
  textGlow: {
    accent: [],
    accentStrong: [{ blur: 4, color: 'accent', alpha: 1 }],
    accentAlt: [],
    warn: [],
  },
  fontWeight: { regular: 500, medium: 600 },
});

/** Every built-in theme, by name. */
export const themes = { neon, highContrast } as const satisfies Record<string, Theme>;
export type ThemeName = keyof typeof themes;
