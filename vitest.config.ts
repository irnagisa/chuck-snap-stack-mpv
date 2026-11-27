import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // .claude/skills の spec は WebdriverIO で実アプリに対して動かすもの (driver.sh run)
    exclude: ['e2e/**', 'node_modules/**', '.claude/**'],
  },
});
