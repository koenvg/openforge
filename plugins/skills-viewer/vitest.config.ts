import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    alias: {
      '@openforge/plugin-sdk/frontend': new URL('../../packages/plugin-sdk/src/frontend.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/backend': new URL('../../packages/plugin-sdk/src/backend.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk/ui/MarkdownContent.svelte': new URL('../../packages/plugin-sdk/src/ui/MarkdownContent.svelte', import.meta.url).pathname,
      '@openforge/plugin-sdk': new URL('../../packages/plugin-sdk/src/index.ts', import.meta.url).pathname,
    },
  },
})
