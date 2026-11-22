import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` runs the game server alongside; forward API calls to it.
    proxy: { '/api': `http://localhost:${process.env['PORT'] ?? '8080'}` },
  },
  test: {
    name: 'client',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
