import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'

// Native / ESM-only packages that must not be bundled — Electron loads them from node_modules
const EXTERNAL = [
  'active-win',
  'uiohook-napi',
  'better-sqlite3',
  'electron',
]

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('apexcharts') || id.includes('vue3-apexcharts')) return 'charts'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('lucide-vue-next')) return 'icons'
          if (id.includes('pinia') || id.includes('vue-router') || id.includes('/vue/')) return 'framework'
        },
      },
    },
  },
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main.js',
        vite: {
          build: {
            rollupOptions: {
              external: EXTERNAL,
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.cjs',
        vite: {
          build: {
            rollupOptions: {
              output: {
                entryFileNames: 'preload.cjs',
              },
              external: ['electron'],
            },
          },
        },
      },
    }),
  ],
})
