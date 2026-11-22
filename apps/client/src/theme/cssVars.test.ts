import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  SCALE_USER_VAR,
  SCALE_VAR,
  SCALE_VIEWPORT_VAR,
  themes,
  toCssVariableEntries,
} from '@nexum/theme';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(css|tsx?)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')
      ? [path]
      : [];
  });
}

describe('theme variables', () => {
  it('every var(--x) in the client is a theme token or declared by a component', () => {
    const known = new Set<string>([SCALE_VAR, SCALE_VIEWPORT_VAR, SCALE_USER_VAR]);
    for (const theme of Object.values(themes)) {
      for (const [name] of toCssVariableEntries(theme)) known.add(name);
    }
    const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    // component-local variables: `--x: value` in CSS, or `'--x': value` / setProperty('--x') in TSX
    for (const { text } of files) {
      for (const m of text.matchAll(/['"]?(--[a-z0-9-]+)['"]?\s*:/g)) known.add(m[1] as string);
      for (const m of text.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/g)) {
        known.add(m[1] as string);
      }
    }
    const unknown: string[] = [];
    for (const { path, text } of files) {
      for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        if (!known.has(m[1] as string)) unknown.push(`${path}: ${m[1] as string}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
