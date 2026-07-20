import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The frontend talks ONLY to the local FastAPI backend (never to Parallel
// directly — the API key stays server-side). In dev we proxy /api to :8000 so
// the browser never needs a cross-origin call and there's no CORS surprise.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
