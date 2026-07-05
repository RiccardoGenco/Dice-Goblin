import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@graphics': fileURLToPath(new URL('./src/graphics', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url))
    }
  },
  // Vitest legge la configurazione direttamente da qui
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
} as never);
