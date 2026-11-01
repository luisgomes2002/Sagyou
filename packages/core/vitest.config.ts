import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Same pinned zone as the desktop suite: date rules key off the local day.
    env: { TZ: 'America/Sao_Paulo' },
    passWithNoTests: true
  }
})
