import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  root: new URL('../..', import.meta.url).pathname,
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'packages/terminal-runtime/src/**/*.test.ts',
      'packages/terminal-runtime/conformance/**/*.test.ts',
      'packages/terminal-runtime/conformance/**/*.test.mjs',
    ],
  },
})
