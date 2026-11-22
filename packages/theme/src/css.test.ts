import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  TOKEN_GROUPS,
  cssVar,
  cssVarName,
  scaleCss,
  toCssVariableEntries,
  toCssVariables,
  type TokenKey,
} from './css.js';
import { highContrast, neon, themes } from './themes.js';

/** Count the tokens in every CSS group of a theme. */
function tokenCount(theme: typeof neon): number {
  return TOKEN_GROUPS.reduce((n, g) => n + Object.keys(theme[g]).length, 0);
}

describe('toCssVariables', () => {
  it.each(Object.entries(themes))('%s: turns every token into a CSS variable', (_, theme) => {
    const css = toCssVariables(theme);
    const declared = [...css.matchAll(/^ {2}(--[a-z0-9-]+): (.+);$/gm)];
    expect(declared).toHaveLength(tokenCount(theme));
    const names = declared.map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    for (const group of TOKEN_GROUPS) {
      for (const key of Object.keys(theme[group])) {
        expect(names).toContain(cssVarName(`${group}.${key}` as TokenKey));
      }
    }
  });

  it('uses kebab-case names and the expected value formats', () => {
    const vars = Object.fromEntries(toCssVariableEntries(neon));
    expect(vars['--color-accent']).toBe('#19f0ff');
    expect(vars['--color-text-dim']).toBe('#7590ae');
    expect(vars['--faction-raider']).toBe('#ff2bd6');
    expect(vars['--font-size-md']).toBe('calc(13px * var(--s))');
    expect(vars['--space-none']).toBe('0');
    expect(vars['--border-thin']).toBe('1px');
    expect(vars['--letter-spacing-wide']).toBe('0.12em');
    expect(vars['--duration-pulse']).toBe('1600ms');
    expect(vars['--z-crt']).toBe('100');
    expect(vars['--glow-panel']).toBe(
      '0 0 24px 0 rgba(25, 240, 255, 0.06), inset 0 0 30px 0 rgba(25, 240, 255, 0.04)',
    );
    expect(vars['--text-glow-accent']).toBe('0 0 8px rgba(25, 240, 255, 1)');
  });

  it('writes "none" for an empty glow', () => {
    const vars = Object.fromEntries(toCssVariableEntries(highContrast));
    expect(vars['--glow-panel']).toBe('none');
    expect(vars['--text-glow-accent']).toBe('none');
  });

  it('scopes to a selector', () => {
    expect(toCssVariables(highContrast, '[data-theme="highContrast"]')).toMatch(
      /^\[data-theme="highContrast"\] \{\n/,
    );
  });
});

describe('cssVar', () => {
  it('references a token by key', () => {
    expect(cssVar('color.accent')).toBe('var(--color-accent)');
    expect(cssVar('fontSize.2xl')).toBe('var(--font-size-2xl)');
    expect(cssVar('textGlow.accentStrong')).toBe('var(--text-glow-accent-strong)');
  });

  it('only accepts real token keys', () => {
    expectTypeOf(cssVar).parameter(0).toEqualTypeOf<TokenKey>();
    // @ts-expect-error: not a token
    cssVar('color.notAColour');
    // @ts-expect-error: scale is not a CSS token group
    cssVar('scale.base');
  });
});

describe('scaleCss', () => {
  it('declares --s and one media query per mockup step', () => {
    const css = scaleCss(neon);
    expect(css).toContain('--s: calc(var(--s-viewport) * var(--s-user));');
    expect(css).toContain('--s-user: 1;');
    const steps = [
      ...css.matchAll(
        /@media \(min-width: (\d+)px\) and \(min-height: (\d+)px\) \{\n {2}:root \{\n {4}--s-viewport: ([\d.]+);/g,
      ),
    ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(steps).toEqual([
      [1800, 1150, 1.2],
      [2200, 1300, 1.4],
      [2900, 1550, 1.7],
      [3500, 1900, 2],
    ]);
  });
});
