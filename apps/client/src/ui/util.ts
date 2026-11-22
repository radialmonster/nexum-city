import { cssVar, type ColorKey, type FactionRole } from '@nexum/theme';
import type { CSSProperties } from 'react';

/** A faction role (`self`, `raider`, `turtle`, ...). Components never take a raw colour. */
export type Faction = FactionRole;

/** An intent colour from the theme. */
export type Tone = Extract<
  ColorKey,
  'accent' | 'accentAlt' | 'ok' | 'warn' | 'danger' | 'special' | 'news' | 'disabled'
>;

export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ');
}

/** `var(--faction-raider)` for a role. */
export function factionColor(role: Faction): string {
  return cssVar(`faction.${role}`);
}

/** `var(--color-warn)` for a tone. */
export function toneColor(tone: Tone): string {
  return cssVar(`color.${tone}`);
}

/** Pass per-instance custom properties (`--k`, `--p`, ...) to a CSS module. */
export function vars(values: Readonly<Record<`--${string}`, string | number>>): CSSProperties {
  return values as CSSProperties;
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export const pct = (n: number): string => `${String(Math.round(clamp01(n) * 1000) / 10)}%`;
