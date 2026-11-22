// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import nexum from './tools/eslint-plugin-nexum/index.js';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    // lint fixtures fail on purpose; tools/lint-fixtures.test.ts lints them explicitly
    'tools/lint-fixtures/',
    // owner's local files
    '.claude/',
    'loop.*',
    'steer-loop.ps1',
    'nextsessionprompt.md*',
  ]),
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['apps/client/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
  },
  // Owner rule #1: no hard-coded styles outside the theme package.
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    plugins: { nexum },
    rules: { 'nexum/no-raw-colors': 'error' },
  },
  {
    // The theme defines the raw values; the rule's own tests must contain them.
    files: ['packages/theme/**', 'tools/eslint-plugin-nexum/**'],
    rules: { 'nexum/no-raw-colors': 'off' },
  },
  // packages/sim is pure and deterministic (CLAUDE.md rule #3): no wall clock, no
  // ambient randomness, no I/O. Time comes in as an argument; randomness from state.rng.
  {
    files: ['packages/sim/**/*.ts'],
    rules: {
      // Hash and PRNG constants look like colours to the rule; sim has no colours.
      'nexum/no-raw-colors': 'off',
      'no-restricted-globals': [
        'error',
        ...[
          'Date',
          'performance',
          'fetch',
          'process',
          'crypto',
          'setTimeout',
          'setInterval',
          'setImmediate',
          'require',
        ].map((name) => ({ name, message: 'packages/sim must stay pure and deterministic.' })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in state.rng.' },
        { object: 'globalThis', property: 'Date', message: 'No wall clock in packages/sim.' },
        {
          object: 'globalThis',
          property: 'crypto',
          message: 'No ambient randomness in packages/sim.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'os', 'http', 'https', 'crypto'],
              message: 'No I/O in packages/sim.',
            },
          ],
        },
      ],
    },
  },
);
