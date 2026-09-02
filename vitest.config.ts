import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { createOpenForgePluginSdkSourceAliasRecord } from './packages/plugin-sdk/src/vite.ts'
import {
  SPECIALIZED_WORKSPACE_TEST_PROJECTS,
  WORKSPACE_TEST_SUITE_EXCLUDES,
  WORKSPACE_TEST_SUITE_GLOB,
} from './scripts/vitest-workspace-policy.ts'


const { pluginSdk, pluginRuntime } = SPECIALIZED_WORKSPACE_TEST_PROJECTS

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
    // Fork workers overlap with thread and build-heavy projects in the full suite.
    // Leave CPU headroom so otherwise-fast jsdom timers are not starved past 5 seconds.
    maxWorkers: '60%',
    projects: [
      {
        plugins: [svelte(), svelteTesting()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          // Threads avoid paying process startup and module import costs for each renderer suite.
          // The global worker cap leaves enough CPU for async jsdom timers.
          pool: 'threads',
          globals: true,
          setupFiles: ['src/test-setup.ts'],
          include: ['src/**/*.test.ts', WORKSPACE_TEST_SUITE_GLOB],
          exclude: [
            'src/lib/terminalSessionService.*.test.ts',
            pluginSdk.suiteGlob,
            pluginRuntime.suiteGlob,
            ...WORKSPACE_TEST_SUITE_EXCLUDES,
          ],
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
          name: 'terminal-session-service',
          environment: 'jsdom',
          pool: 'forks',
          globals: true,
          setupFiles: ['src/test-setup.ts', 'src/lib/terminalSessionService.testSetup.ts'],
          include: ['src/lib/terminalSessionService.*.test.ts'],
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
          name: pluginSdk.name,
          environment: 'jsdom',
          globals: true,
          setupFiles: ['src/test-setup.ts'],
          include: [pluginSdk.suiteGlob],
          exclude: WORKSPACE_TEST_SUITE_EXCLUDES,
          alias: {
            ...pluginSdkAliases,
            ...terminalRuntimeAliases,
          },
        },
      },
      {
        test: {
          name: pluginRuntime.name,
          environment: 'node',
          globals: true,
          include: [pluginRuntime.suiteGlob],
          exclude: WORKSPACE_TEST_SUITE_EXCLUDES,
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
