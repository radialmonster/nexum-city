import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      // the client has its own config: jsdom, React, CSS modules
      'apps/client',
    ],
  },
});
