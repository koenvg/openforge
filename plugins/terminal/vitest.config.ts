import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { createOpenForgePluginSdkSourceAliases } from '../../packages/plugin-sdk/src/vite.ts'
import { defineConfig } from 'vitest/config'

const repoRoot = new URL('../..', import.meta.url)

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: [
      ...createOpenForgePluginSdkSourceAliases(repoRoot),
      { find: /^@openforge-app\/terminal-runtime$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/index.ts') },
      { find: /^@openforge-app\/terminal-runtime\/shortcuts$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/terminalShortcuts.ts') },
      { find: /^@openforge-app\/terminal-runtime\/shortcutController$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/terminalShortcutController.ts') },
      { find: /^@openforge-app\/terminal-runtime\/TerminalTabsShell$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/TerminalTabsShell.svelte') },
      { find: /^@openforge-app\/terminal-runtime\/TaskTerminalSurface$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/TaskTerminalSurface.svelte') },
      { find: /^@openforge-app\/terminal-runtime\/TerminalTabsSurface$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/TerminalTabsSurface.svelte') },
      { find: /^@openforge-app\/terminal-runtime\/TerminalTaskPaneSurface$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/TerminalTaskPaneSurface.svelte') },
      { find: /^@openforge-app\/terminal-runtime\/terminalOptions$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/terminalOptions.ts') },
      { find: /^@openforge-app\/terminal-runtime\/theme$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/theme.ts') },
      { find: /^@openforge-app\/terminal-runtime\/terminalRuntime$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/terminalRuntime.ts') },
      { find: /^@openforge-app\/terminal-runtime\/xterm\.css$/, replacement: resolve(import.meta.dirname, '../../packages/terminal-runtime/src/xterm.css') },
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
