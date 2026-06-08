import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: [
      { find: /^@openforge\/terminal-runtime$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/index.ts') },
      { find: /^@openforge\/terminal-runtime\/shortcuts$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/terminalShortcuts.ts') },
      { find: /^@openforge\/terminal-runtime\/shortcutController$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/terminalShortcutController.ts') },
      { find: /^@openforge\/terminal-runtime\/terminalOptions$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/terminalOptions.ts') },
      { find: /^@openforge\/terminal-runtime\/theme$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/theme.ts') },
      { find: /^@openforge\/terminal-runtime\/terminalRuntime$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/terminalRuntime.ts') },
    ],
  },
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
  },
})
