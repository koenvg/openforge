import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { createOpenForgePluginSdkSourceAliasRecord } from './packages/plugin-sdk/src/vite.ts'

const pluginRuntimeAliases = {
  '@openforge-app/plugin-runtime/commandValidation': new URL('./packages/plugin-runtime/src/commandValidation.ts', import.meta.url).pathname,
  '@openforge-app/plugin-runtime': new URL('./packages/plugin-runtime/src/index.ts', import.meta.url).pathname,
}

const terminalRuntimeAliases = {
  '@openforge-app/terminal-runtime/terminalRuntime': new URL('./packages/terminal-runtime/src/terminalRuntime.ts', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/terminalOptions': new URL('./packages/terminal-runtime/src/terminalOptions.ts', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/theme': new URL('./packages/terminal-runtime/src/theme.ts', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/shortcuts': new URL('./packages/terminal-runtime/src/terminalShortcuts.ts', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/shortcutController': new URL('./packages/terminal-runtime/src/terminalShortcutController.ts', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/TerminalTabsShell': new URL('./packages/terminal-runtime/src/TerminalTabsShell.svelte', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/TaskTerminalSurface': new URL('./packages/terminal-runtime/src/TaskTerminalSurface.svelte', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/TerminalTabsSurface': new URL('./packages/terminal-runtime/src/TerminalTabsSurface.svelte', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/TerminalTaskPaneSurface': new URL('./packages/terminal-runtime/src/TerminalTaskPaneSurface.svelte', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/xterm.css': new URL('./packages/terminal-runtime/src/xterm.css', import.meta.url).pathname,
  '@openforge-app/terminal-runtime/testUtils': new URL('./packages/terminal-runtime/src/terminalView.testUtils.ts', import.meta.url).pathname,
  '@openforge-app/terminal-runtime': new URL('./packages/terminal-runtime/src/index.ts', import.meta.url).pathname,
}

const pluginSdkAliases = createOpenForgePluginSdkSourceAliasRecord(new URL('./', import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [svelte(), svelteTesting()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          // The task-detail/SelfReviewView Svelte/jsdom suites can leave the default
          // worker pool waiting on teardown in some local runs. Forked workers finish
          // these suites reliably and keep `pnpm test` aligned with the known-good
          // `pnpm exec vitest --pool=forks` path.
          pool: 'forks',
          globals: true,
          setupFiles: ['src/test-setup.ts'],
          include: [
            'src/**/*.test.ts',
            'plugins/file-viewer/src/**/*.test.ts',
            'plugins/github-sync/src/**/*.test.ts',
            'plugins/task-browser/src/**/*.test.ts',
            'plugins/task-schedules/src/**/*.test.ts',
            'plugins/terminal/src/**/*.test.ts',
            'packages/pr-review-ui/src/**/*.test.ts',
            'packages/terminal-runtime/src/**/*.test.ts',
          ],
          exclude: ['src/lib/terminalPool.*.test.ts'],
          alias: {
            ...pluginRuntimeAliases,
            ...pluginSdkAliases,
            ...terminalRuntimeAliases,
          },
        },
      },
      {
        plugins: [svelte(), svelteTesting()],
        test: {
          name: 'terminal-pool',
          environment: 'jsdom',
          pool: 'forks',
          globals: true,
          setupFiles: ['src/test-setup.ts', 'src/lib/terminalPool.testSetup.ts'],
          include: ['src/lib/terminalPool.*.test.ts'],
          alias: {
            ...pluginRuntimeAliases,
            ...pluginSdkAliases,
            ...terminalRuntimeAliases,
          },
        },
      },
      {
        plugins: [svelte(), svelteTesting()],
        test: {
          name: 'plugin-sdk',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['src/test-setup.ts'],
          include: ['packages/plugin-sdk/src/**/*.test.ts'],
          alias: {
            ...pluginSdkAliases,
            ...terminalRuntimeAliases,
          },
        },
      },
      {
        test: {
          name: 'plugin-runtime',
          environment: 'node',
          globals: true,
          include: ['packages/plugin-runtime/src/**/*.test.ts'],
          alias: {
            ...pluginRuntimeAliases,
            ...pluginSdkAliases,
          },
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: [
            'scripts/**/*.test.mjs',
            'src-tauri/src/openforge-cli/**/*.test.js',
            'src-tauri/plugin-host/**/*.test.ts',
          ],
          alias: {
            ...pluginRuntimeAliases,
            ...pluginSdkAliases,
          },
        },
      },
    ],
  },
})
