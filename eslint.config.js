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
);
