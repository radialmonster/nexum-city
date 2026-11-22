import { withAlpha, type ColorValue } from './color.js';
import type { ScaleRules, ShadowLayer, TextShadowLayer } from './types.js';

/*
 * The default "neon" theme. Values are taken from docs/design/rewrite-mockup.html
 * (its :root variables and the colours used inline). This file defines the token
 * *names*: the Theme type is derived from these objects, so adding a key here adds
 * it to every theme, and every other theme must provide (or inherit) it.
 */

// Raw mockup swatches. Private: components use the semantic names below.
const cyan = '#19f0ff';
const magenta = '#ff2bd6';
const amber = '#ffb020';
const lime = '#7dff4a';
const violet = '#b07cff';
const blue = '#5b8cff';
const red = '#ff3b5c';
const orange = '#ff7a3d';
const grey = '#56607a';
const slate = '#8fa3bd';
const ice = '#cfe9ff';

/** Semantic UI and map colours. */
export const neonColor = {
  // backgrounds
  bg: '#04060c',
  bgAlt: '#070c17',
  bgGlow: '#0b1a30',
  surface: '#050912',
  panel: withAlpha('#08101e', 0.82),
  panelSolid: withAlpha('#040a14', 0.94),
  overlay: withAlpha('#000000', 0.5),
  // lines
  line: withAlpha(cyan, 0.28),
  lineSoft: withAlpha(cyan, 0.12),
  lineStrong: cyan,
  // text
  text: ice,
  textDim: '#7590ae',
  textMuted: '#8591ab',
  textBright: '#ffffff',
  textOnAccent: '#001018',
  textOnWarn: '#1a0e00',
  // intent
  accent: cyan,
  accentAlt: magenta,
  danger: red,
  warn: amber,
  ok: lime,
  info: cyan,
  news: blue,
  special: violet,
  disabled: grey,
  dangerSurface: '#28040e',
  // empty bar tracks and timeline grid lines
  track: withAlpha('#ffffff', 0.07),
  trackLine: withAlpha('#6c87a6', 0.14),
  // the map
  street: '#0d2233',
  streetGlow: withAlpha(cyan, 0.2),
  streetPlanned: withAlpha(slate, 0.35),
  water: '#0a2740',
  waterDeep: '#040d18',
  waterEdge: withAlpha(cyan, 0.35),
  waterLabel: '#3b7da6',
  building: withAlpha(ice, 0.03),
  buildingEdge: withAlpha(ice, 0.14),
  plot: slate,
  fog: '#0a0f18',
  fogStatic: withAlpha('#788caa', 0.2),
  labelHalo: withAlpha('#04060c', 0.8),
  // effects
  scanline: withAlpha('#ffffff', 0.022),
  shadow: '#000000',
} satisfies Record<string, ColorValue>;

/**
 * Crew colours, keyed by *role*, never by a specific crew. A new rival or a
 * recoloured faction is a one-line change here.
 */
export const neonFaction = {
  self: cyan,
  raider: magenta,
  turtle: amber,
  merchant: lime,
  hunter: violet,
  newcomer: blue,
  neutral: grey,
  /** other human crews */
  rival: orange,
} satisfies Record<string, ColorValue>;

export const neonFont = {
  head: 'Bahnschrift, "DIN Condensed", "Arial Narrow", "Segoe UI", sans-serif',
  mono: '"Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace',
} satisfies Record<string, string>;

/** Type scale in px at `--s: 1`. The CSS output multiplies by `--s`. */
export const neonFontSize = {
  '2xs': 10,
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 16,
  '2xl': 18,
  '3xl': 20,
  '4xl': 22,
  '5xl': 26,
} satisfies Record<string, number>;

export const neonFontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} satisfies Record<string, number>;

/** Letter spacing in em. */
export const neonLetterSpacing = {
  none: 0,
  tight: 0.05,
  normal: 0.08,
  wide: 0.12,
  wider: 0.16,
  widest: 0.22,
} satisfies Record<string, number>;

/** Unitless line heights. */
export const neonLineHeight = {
  none: 1,
  tight: 1.15,
  normal: 1.4,
} satisfies Record<string, number>;

/** Spacing in px at `--s: 1`. The CSS output multiplies by `--s`. */
export const neonSpace = {
  none: 0,
  '3xs': 2,
  '2xs': 4,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  '2xl': 18,
  '3xl': 24,
  '4xl': 32,
} satisfies Record<string, number>;

/**
 * Fixed component dimensions in px at `--s: 1` (the CSS output multiplies by
 * `--s`): bar thicknesses, row heights, minimum column widths, icon boxes.
 */
export const neonSize = {
  hairline: 2,
  bar: 8,
  barThick: 14,
  stack: 10,
  row: 18,
  control: 30,
  /** The smallest comfortable touch target: phone buttons and tabs are at least this tall. */
  touch: 44,
  icon: 26,
  gauge: 120,
  spark: 90,
  radial: 380,
  toggle: 160,
  column: 380,
  page: 2400,
} satisfies Record<string, number>;

/** Corner radii in px at `--s: 1`. Panels use angled corners (clip-path), not radii. */
export const neonRadius = {
  none: 0,
  xs: 2,
  sm: 8,
  md: 14,
  lg: 27,
  pill: 9999,
} satisfies Record<string, number>;

/** Border widths in px. Not scaled: hairlines stay crisp on any screen. */
export const neonBorder = {
  thin: 1,
  medium: 2,
  thick: 3,
  heavy: 4,
} satisfies Record<string, number>;

/** Backdrop blur radii in px. */
export const neonBlur = {
  panel: 6,
} satisfies Record<string, number>;

/** Coloured glows (box-shadow layers). Shared by the HUD and the map renderer. */
export const neonGlow = {
  panel: [
    { blur: 24, color: 'accent', alpha: 0.06 },
    { blur: 30, color: 'accent', alpha: 0.04, inset: true },
  ],
  accent: [{ blur: 14, color: 'accent', alpha: 1 }],
  accentSoft: [{ blur: 6, color: 'accent', alpha: 1 }],
  accentAlt: [{ blur: 16, color: 'accentAlt', alpha: 0.35 }],
  danger: [{ blur: 14, color: 'danger', alpha: 0.35 }],
  dangerStrong: [{ blur: 26, color: 'danger', alpha: 0.55 }],
  warn: [{ blur: 14, color: 'warn', alpha: 0.3 }],
  ok: [{ blur: 12, color: 'ok', alpha: 0.12, inset: true }],
} satisfies Record<string, readonly ShadowLayer[]>;

/** Glows for text (text-shadow layers). */
export const neonTextGlow = {
  accent: [{ blur: 8, color: 'accent', alpha: 1 }],
  accentStrong: [{ blur: 14, color: 'accent', alpha: 1 }],
  accentAlt: [{ blur: 8, color: 'accentAlt', alpha: 1 }],
  warn: [{ blur: 8, color: 'warn', alpha: 1 }],
} satisfies Record<string, readonly TextShadowLayer[]>;

/** Dark drop shadows and the screen vignette. */
export const neonShadow = {
  raised: [{ y: 4, blur: 18, color: 'shadow', alpha: 0.6 }],
  vignette: [{ blur: 120, spread: 40, color: 'shadow', alpha: 0.5, inset: true }],
} satisfies Record<string, readonly ShadowLayer[]>;

/** Durations in ms, taken from the mockup's transitions and animations. */
export const neonDuration = {
  instant: 0,
  fast: 120,
  base: 200,
  slow: 500,
  pipe: 1200,
  pulse: 1600,
  blink: 1800,
  urgent: 2400,
  flow: 2500,
  sweep: 9000,
  spin: 24000,
} satisfies Record<string, number>;

export const neonEasing = {
  linear: 'linear',
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  inOut: 'ease-in-out',
} satisfies Record<string, string>;

/** Stacking layers. */
export const neonZ = {
  below: -1,
  base: 0,
  raised: 2,
  overlay: 3,
  hud: 10,
  menu: 20,
  modal: 50,
  toast: 60,
  crt: 100,
} satisfies Record<string, number>;

/**
 * The `--s` HUD scale. The mockup steps it up on big screens, and each step also
 * needs enough height so a short or ultrawide window keeps smaller panels.
 */
export const neonScale: ScaleRules = {
  base: 1,
  steps: [
    { minWidth: 1800, minHeight: 1150, value: 1.2 },
    { minWidth: 2200, minHeight: 1300, value: 1.4 },
    { minWidth: 2900, minHeight: 1550, value: 1.7 },
    { minWidth: 3500, minHeight: 1900, value: 2 },
  ],
};

/**
 * Map geometry and behaviour, in world units (one plot is `pitchX` by `pitchY`)
 * or plain numbers. The PixiJS map reads these through `toPixiPalette`; nothing in
 * the renderer hard-codes a size, width, alpha or threshold.
 */
export const neonMap = {
  // layout: plot pitch and the street gap between plots (world units)
  pitchX: 210,
  pitchY: 220,
  street: 20,
  // outlines and fills
  chamfer: 28,
  edgeWidth: 2,
  edgeWidthSelected: 4,
  fillAlpha: 0.2,
  fillAlphaNeutral: 0.1,
  fillAlphaCity: 0.7,
  streetCoreWidth: 1.2,
  streetDash: 6,
  streetDashGap: 8,
  frontierDash: 10,
  frontierDashGap: 7,
  // the Sound: how much water shows below the plots (in plot heights) when panning, at city zoom, and where its label sits
  soundPan: 0.22,
  soundCity: 0.7,
  soundLabel: 0.11,
  // fog of war
  fogDim: 0.4,
  fogCover: 0.72,
  fogLine: 6,
  // hubs, rings, carriers, price bars
  hubRadius: 88,
  ringWidth: 4,
  ringGap: 10,
  carrierScale: 1.15,
  priceBarWidth: 9,
  priceBarHeight: 40,
  priceBarGap: 5,
  slotSize: 22,
  // level of detail by on-screen plot width (px, before the HUD scale)
  lodNameMinPx: 90,
  lodSubMinPx: 150,
  lodDetailMinPx: 110,
  lodRichMinPx: 330,
  // inner texture and glow
  detailLine: 1.4,
  detailAlpha: 0.38,
  detailFillAlpha: 0.12,
  innerGlowAlpha: 0.12,
  innerGlowSteps: 4,
  innerGlowInset: 0.035,
  labelFit: 0.86,
  labelMinScale: 0.62,
  cityLabelScale: 1.6,
  /** Viewports narrower than this (px) get the compact phone HUD. */
  compactBelowPx: 720,
  // camera: how many plots fit across the viewport
  acrossCity: 16,
  acrossTactical: 8,
  acrossDistrict: 2.2,
  acrossMin: 1.4,
  acrossMax: 40,
  /** Smallest on-screen plot width in px per level, so a narrow screen shows fewer plots. */
  minPlotPxCity: 30,
  minPlotPxTactical: 120,
  minPlotPxDistrict: 150,
  panMarginPlots: 0.4,
  inertiaFriction: 0.92,
  inertiaStop: 0.02,
  wheelSensitivity: 0.0015,
  pickRadiusPx: 6,
  arrowInset: 34,
  /** Demo only: how long one looped carrier trip takes on screen, in ms. */
  demoLoopMs: 14000,
  /** One pulse of an ambush street, in ms. */
  ambushPulseMs: 1800,
  /** How long a raid-hit flash and its callout stay on the street, in ms. */
  flashMs: 2600,
  /** Minimum drag distance in px before a press becomes a pan instead of a click. */
  dragSlop: 5,
} satisfies Record<string, number>;
