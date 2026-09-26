import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Both entries are present in the shared baseline, so Laptop A can work on
// the collector without touching Laptop B's App or the frozen main.tsx.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        collector: fileURLToPath(new URL('./collector.html', import.meta.url)),
      },
    },
  },
})
