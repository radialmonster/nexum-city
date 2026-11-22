/**
 * Proves owner rule #1 is enforced by the real lint configs: the fixtures in
 * tools/lint-fixtures/ must fail ESLint and stylelint, and the same code is
 * allowed only inside packages/theme.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string): string =>
  readFileSync(new URL(`./lint-fixtures/${name}`, import.meta.url), 'utf8');

describe('ESLint: nexum/no-raw-colors', () => {
  const eslint = new ESLint({ cwd: root });
  const code = fixture('raw-styles.tsx');

  it('fails the fixture as an app file', async () => {
    const [result] = await eslint.lintText(code, { filePath: 'apps/client/src/raw-styles.tsx' });
    const hits = result?.messages.filter((m) => m.ruleId === 'nexum/no-raw-colors') ?? [];
    expect(hits.map((m) => m.messageId).sort()).toEqual([
      'rawColor',
      'rawColor',
      'rawColor',
      'rawFontSize',
      'rawHexNumber',
    ]);
  });

  it('allows the same code inside packages/theme', async () => {
    const [result] = await eslint.lintText(code, { filePath: 'packages/theme/src/raw-styles.tsx' });
    expect(result?.messages.filter((m) => m.ruleId === 'nexum/no-raw-colors')).toEqual([]);
  });
});

describe('stylelint: token-only CSS', () => {
  const lint = async (name: string, codeFilename: string) => {
    const { results } = await stylelint.lint({
      code: fixture(name),
      codeFilename,
      cwd: root,
      configBasedir: root,
    });
    return results[0];
  };

  it('fails the raw fixture as an app file', async () => {
    const result = await lint('raw-styles.css', `${root}apps/client/src/raw-styles.css`);
    const rules = result?.warnings.map((w) => w.rule).sort();
    expect(rules).toEqual([
      'color-named',
      'color-no-hex',
      'declaration-property-unit-disallowed-list',
      'declaration-property-value-allowed-list',
      'function-disallowed-list',
      'function-disallowed-list',
    ]);
  });

  it('passes the token-only fixture', async () => {
    const result = await lint('tokens-only.css', `${root}apps/client/src/tokens-only.css`);
    expect(result?.warnings).toEqual([]);
  });

  it('ignores packages/theme', async () => {
    const result = await lint('raw-styles.css', `${root}packages/theme/src/raw-styles.css`);
    expect(result?.ignored).toBe(true);
  });
});
