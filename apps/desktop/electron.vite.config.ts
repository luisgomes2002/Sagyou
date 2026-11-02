import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Shown in Configurações → Sobre; read at build time so the renderer needs no IPC for it.
const appVersion: string = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version

export default defineConfig({
  main: {
    build: {
      // @sagyou/core is TypeScript source in the workspace: it must be bundled,
      // never left as a require() the packaged app could not resolve. Its own
      // dependencies stay external and ship in this package's dependencies.
      externalizeDeps: { exclude: ['@sagyou/core'] },
      rollupOptions: {
        external: ['better-sqlite3']
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: { exclude: ['@sagyou/core'] }
    }
  },
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
