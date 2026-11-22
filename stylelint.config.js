// @ts-check
/**
 * Owner rule #1 for stylesheets: outside packages/theme, colours and font sizes
 * must come from theme custom properties, e.g. `color: var(--color-accent)` and
 * `font-size: var(--font-size-md)`.
 *
 * @type {import('stylelint').Config}
 */
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    'docs/**',
    'packages/theme/**',
    // fail on purpose; tools/lint-fixtures.test.ts lints them explicitly
    'tools/lint-fixtures/**',
  ],
  rules: {
    'color-no-hex': [true, { message: 'Raw hex colour: use a theme token, var(--color-…).' }],
    'color-named': ['never', { message: 'Named colour: use a theme token, var(--color-…).' }],
    'function-disallowed-list': [
      ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'],
      { message: 'Raw colour function: use a theme token, var(--color-…).' },
    ],
    'declaration-property-unit-disallowed-list': [
      { '/^font(-size)?$/': ['px', 'pt', 'pc', 'cm', 'mm', 'in', 'q'] },
      { message: 'Raw font size: use var(--font-size-…).' },
    ],
    'declaration-property-value-allowed-list': [
      { 'font-size': ['/var\\(--font-size-/', 'inherit'] },
      { message: 'Font sizes must use var(--font-size-…).' },
    ],
  },
};
