import { defineConfig } from 'vitest/config'

export default defineConfig({
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
