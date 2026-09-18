import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    ssr: 'src/backend.ts',
    outDir: 'dist',
    target: 'node20',
    rollupOptions: {
      output: {
        entryFileNames: 'backend.mjs',
        chunkFileNames: '[name]-[hash].mjs',
        format: 'es',
      },
    },
  },
  // Packaged apps copy dist/ without this package's node_modules, so runtime
  // dependencies must live inside backend.mjs.
  ssr: {
    noExternal: ['@openforge-app/plugin-sdk', '@openforge-app/pr-review-ui', 'zod'],
  },
})
