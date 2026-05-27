import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    ssr: 'src/backend.ts',
    outDir: 'dist',
    target: 'node20',
    rollupOptions: {
      output: {
        entryFileNames: 'backend.js',
        chunkFileNames: '[name]-[hash].js',
        format: 'es',
      },
    },
  },
  ssr: {
    noExternal: ['@openforge/plugin-sdk'],
  },
})
