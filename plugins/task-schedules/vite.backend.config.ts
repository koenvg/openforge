import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    ssr: 'src/backend.ts',
    outDir: 'dist',
    target: 'node20',
    rollupOptions: {
      output: {
        entryFileNames: 'backend.cjs',
        chunkFileNames: '[name]-[hash].cjs',
        format: 'cjs',
      },
    },
  },
  ssr: {
    noExternal: ['@openforge-app/plugin-sdk', 'cronstrue'],
  },
})
