import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { createOpenForgeViteLogger } from './src/lib/viteLogger'

// https://vitejs.dev/config/
export default defineConfig({
  // Temporary workaround for Lightning CSS 1.32.0 false-positive
  // ::highlight(...) warnings until the upstream fix is released through Vite.
  customLogger: createOpenForgeViteLogger(),
  plugins: [tailwindcss(), svelte()],
  // Vite options tailored for Tauri to prevent too much magic
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Using polling since fsEvents doesn't work on all systems
      usePolling: true,
      interval: 100,
    },
  },
  build: {
    target: ['es2021', 'chrome100', 'safari14'],
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
