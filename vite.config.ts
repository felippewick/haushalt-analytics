import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { jsonStorePlugin } from './vite-plugin-json-store.ts'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), jsonStorePlugin('./data/store.json')],
  // Tauri expects a fixed port and clear terminal output
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
