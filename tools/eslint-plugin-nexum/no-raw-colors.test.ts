import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-raw-colors.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });

tester.run('no-raw-colors', rule, {
  valid: [
    "const c = cssVar('color.accent');",
    "const s = { color: 'var(--color-accent)', fontSize: 'var(--font-size-md)' };",
    "const s = { fontSize: cssVar('fontSize.md') };",
    "const label = 'Rank #4 of 11';",
    "const href = '/kit#panel';",
    "const entity = '&#123;';",
    'const n = 0xff;',
    'const mask = 0x7fff;',
    'const big = 1677215;',
    "const mix = 'color-mix(in srgb, var(--color-accent) 10%, transparent)';",
    'const t = `${cssVar("color.ok")} solid`;',
  ],
  invalid: [
    { code: "const c = '#fff';", errors: [{ messageId: 'rawColor' }] },
    { code: "const c = '#19F0FF';", errors: [{ messageId: 'rawColor' }] },
    { code: "const c = '#19f0ff80';", errors: [{ messageId: 'rawColor' }] },
    { code: "const s = { border: '1px solid #ff2bd6' };", errors: [{ messageId: 'rawColor' }] },
    { code: "const c = 'rgb(25, 240, 255)';", errors: [{ messageId: 'rawColor' }] },
    { code: "const c = 'rgba(25,240,255,.28)';", errors: [{ messageId: 'rawColor' }] },
    { code: "const c = 'hsl(180 100% 50%)';", errors: [{ messageId: 'rawColor' }] },
    { code: "const c = 'oklch(0.9 0.2 200)';", errors: [{ messageId: 'rawColor' }] },
    { code: 'const g = `0 0 8px #19f0ff`;', errors: [{ messageId: 'rawColor' }] },
    { code: 'const g = `0 0 ${n}px rgba(0,0,0,.5)`;', errors: [{ messageId: 'rawColor' }] },
    { code: 'g.fill({ color: 0x19f0ff });', errors: [{ messageId: 'rawHexNumber' }] },
    { code: 'g.fill(0xFF2BD6CC);', errors: [{ messageId: 'rawHexNumber' }] },
    { code: 'const s = { fontSize: 12 };', errors: [{ messageId: 'rawFontSize' }] },
    { code: "const s = { fontSize: '12px' };", errors: [{ messageId: 'rawFontSize' }] },
    { code: "const s = { 'font-size': '12.5px' };", errors: [{ messageId: 'rawFontSize' }] },
  ],
});
