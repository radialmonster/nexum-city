import { toCssRgba } from './color.js';
import type { ShadowLayer, TextShadowLayer, Theme, TokenGroup } from './types.js';

/** CSS variable prefix per token group: `color.textDim` -> `--color-text-dim`. */
const PREFIX = {
  color: 'color',
  faction: 'faction',
  font: 'font',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  letterSpacing: 'letter-spacing',
  lineHeight: 'line-height',
  space: 'space',
  radius: 'radius',
  border: 'border',
  blur: 'blur',
  glow: 'glow',
  textGlow: 'text-glow',
  shadow: 'shadow',
  duration: 'duration',
  easing: 'easing',
  z: 'z',
} as const satisfies Record<TokenGroup, string>;

/** The token groups, in the order they are written to CSS. */
export const TOKEN_GROUPS = Object.keys(PREFIX) as readonly TokenGroup[];

/** A token reference such as `'color.accent'` or `'space.md'`, checked against the theme's keys. */
export type TokenKey = {
  [G in TokenGroup]: `${G}.${Extract<keyof Theme[G], string>}`;
}[TokenGroup];

/** The `--s` scale variables. `--s` = viewport step x user setting. */
export const SCALE_VAR = '--s';
export const SCALE_VIEWPORT_VAR = '--s-viewport';
export const SCALE_USER_VAR = '--s-user';

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** The custom property name for a token: `cssVarName('color.textDim')` -> `'--color-text-dim'`. */
export function cssVarName(key: TokenKey): `--${string}` {
  const dot = key.indexOf('.');
  const group = key.slice(0, dot) as TokenGroup;
  return `--${PREFIX[group]}-${kebab(key.slice(dot + 1))}`;
}

/**
 * A `var()` reference for a token, for use in components and CSS-in-TS:
 * `cssVar('color.accent')` -> `'var(--color-accent)'`.
 */
export function cssVar(key: TokenKey): string {
  return `var(${cssVarName(key)})`;
}

const px = (n: number): string => (n === 0 ? '0' : `${String(n)}px`);
const scaledPx = (n: number): string =>
  n === 0 ? '0' : `calc(${String(n)}px * var(${SCALE_VAR}))`;

function boxShadow(theme: Theme, layers: readonly ShadowLayer[]): string {
  if (layers.length === 0) return 'none';
  return layers
    .map((l) => {
      const parts = [px(l.x ?? 0), px(l.y ?? 0), px(l.blur), px(l.spread ?? 0)];
      const color = toCssRgba(theme.color[l.color], l.alpha);
      return `${l.inset === true ? 'inset ' : ''}${parts.join(' ')} ${color}`;
    })
    .join(', ');
}

function textShadow(theme: Theme, layers: readonly TextShadowLayer[]): string {
  if (layers.length === 0) return 'none';
  return layers
    .map((l) => {
      const color = toCssRgba(theme.color[l.color], l.alpha);
      return `${px(l.x ?? 0)} ${px(l.y ?? 0)} ${px(l.blur)} ${color}`;
    })
    .join(', ');
}

/** The CSS value of every token in a group, keyed by token name. */
function groupValues(theme: Theme, group: TokenGroup): [string, string][] {
  switch (group) {
    case 'color':
    case 'faction':
    case 'font':
    case 'easing':
      return Object.entries(theme[group]);
    case 'fontSize':
    case 'space':
    case 'radius':
      return Object.entries(theme[group]).map(([k, v]) => [k, scaledPx(v)]);
    case 'border':
    case 'blur':
      return Object.entries(theme[group]).map(([k, v]) => [k, px(v)]);
    case 'fontWeight':
    case 'lineHeight':
    case 'z':
      return Object.entries(theme[group]).map(([k, v]) => [k, String(v)]);
    case 'letterSpacing':
      return Object.entries(theme[group]).map(([k, v]) => [k, v === 0 ? '0' : `${String(v)}em`]);
    case 'duration':
      return Object.entries(theme[group]).map(([k, v]) => [k, `${String(v)}ms`]);
    case 'glow':
    case 'shadow':
      return Object.entries(theme[group]).map(([k, v]) => [k, boxShadow(theme, v)]);
    case 'textGlow':
      return Object.entries(theme[group]).map(([k, v]) => [k, textShadow(theme, v)]);
  }
}

/** Every token of a theme as `[custom property name, value]` pairs. */
export function toCssVariableEntries(theme: Theme): [`--${string}`, string][] {
  return TOKEN_GROUPS.flatMap((group) =>
    groupValues(theme, group).map(([key, value]): [`--${string}`, string] => [
      cssVarName(`${group}.${key}` as TokenKey),
      value,
    ]),
  );
}

/**
 * A CSS rule declaring every token of `theme` as a custom property.
 * Swap themes by replacing this block (or by scoping it to another selector).
 */
export function toCssVariables(theme: Theme, selector = ':root'): string {
  const lines = toCssVariableEntries(theme).map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}

/**
 * The `--s` scale rules: the base declarations plus one media query per step.
 * `--s-user` is the player's own setting (set it inline on `<html>`).
 */
export function scaleCss(theme: Theme, selector = ':root'): string {
  const { base, steps } = theme.scale;
  const out = [
    `${selector} {`,
    `  ${SCALE_VIEWPORT_VAR}: ${String(base)};`,
    `  ${SCALE_USER_VAR}: 1;`,
    `  ${SCALE_VAR}: calc(var(${SCALE_VIEWPORT_VAR}) * var(${SCALE_USER_VAR}));`,
    `}`,
  ];
  const sorted = [...steps].sort((a, b) => a.minWidth - b.minWidth);
  for (const step of sorted) {
    out.push(
      `@media (min-width: ${String(step.minWidth)}px) and (min-height: ${String(step.minHeight)}px) {`,
      `  ${selector} {`,
      `    ${SCALE_VIEWPORT_VAR}: ${String(step.value)};`,
      `  }`,
      `}`,
    );
  }
  return `${out.join('\n')}\n`;
}
