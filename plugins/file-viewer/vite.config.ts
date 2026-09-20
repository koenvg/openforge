import { svelte } from '@sveltejs/vite-plugin-svelte'
import { openforgePluginViteExternals } from '@openforge-app/plugin-sdk/vite'
import { defineConfig } from 'vite'
import { pdfAssets } from './pdfAssets.ts'

export default defineConfig({
  plugins: [svelte(), pdfAssets()],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'frontend.js',
      cssFileName: 'file-viewer',
    },
    rollupOptions: {
      external: openforgePluginViteExternals,
      output: { chunkFileNames: '[name]-[hash].js' },
    },
  },
})
