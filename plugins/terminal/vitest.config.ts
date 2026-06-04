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
      '@openforge/plugin-sdk/testing': new URL('../../packages/plugin-sdk/src/testing.ts', import.meta.url).pathname,
      '@openforge/plugin-sdk': new URL('../../packages/plugin-sdk/src/index.ts', import.meta.url).pathname,
    },
  },
})
