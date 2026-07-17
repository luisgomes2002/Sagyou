import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Habits, goals and reports key off the LOCAL calendar day, so a suite run
    // in UTC can't tell a local-date bug from a correct one. Pin a non-UTC zone
    // (UTC-3, no DST) to keep those tests meaningful on any machine.
    env: { TZ: 'America/Sao_Paulo' },
    setupFiles: ['./src/renderer/src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      exclude: ['src/renderer/src/__tests__/**', 'src/renderer/src/main.tsx']
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
