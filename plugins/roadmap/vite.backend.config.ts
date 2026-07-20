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
    // SSR externalizes dependencies by default, which would leave these as bare
    // imports in dist/backend.js for the plugin host to resolve at runtime. Bundle
    // them in so the built backend is self-contained.
    noExternal: ['@openforge-app/plugin-sdk', '@anthropic-ai/sdk'],
  },
})
