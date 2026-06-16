import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

const pluginRuntimeAliases = {
  '@openforge/plugin-runtime/commandValidation': new URL('./packages/plugin-runtime/src/commandValidation.ts', import.meta.url).pathname,
  '@openforge/plugin-runtime': new URL('./packages/plugin-runtime/src/index.ts', import.meta.url).pathname,
}

const terminalRuntimeAliases = {
  '@openforge/terminal-runtime/terminalRuntime': new URL('./packages/terminal-runtime/src/terminalRuntime.ts', import.meta.url).pathname,
  '@openforge/terminal-runtime/terminalOptions': new URL('./packages/terminal-runtime/src/terminalOptions.ts', import.meta.url).pathname,
  '@openforge/terminal-runtime/theme': new URL('./packages/terminal-runtime/src/theme.ts', import.meta.url).pathname,
  '@openforge/terminal-runtime/shortcuts': new URL('./packages/terminal-runtime/src/terminalShortcuts.ts', import.meta.url).pathname,
  '@openforge/terminal-runtime/shortcutController': new URL('./packages/terminal-runtime/src/terminalShortcutController.ts', import.meta.url).pathname,
  '@openforge/terminal-runtime/xterm.css': new URL('./packages/terminal-runtime/src/xterm.css', import.meta.url).pathname,
  '@openforge/terminal-runtime': new URL('./packages/terminal-runtime/src/index.ts', import.meta.url).pathname,
}

const pluginSdkAliases = {
  '@openforge/plugin-sdk/frontend': new URL('./packages/plugin-sdk/src/frontend.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/backend': new URL('./packages/plugin-sdk/src/backend.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/domain': new URL('./packages/plugin-sdk/src/domain.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/prStatusPresentation': new URL('./packages/plugin-sdk/src/prStatusPresentation.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/testing': new URL('./packages/plugin-sdk/src/testing.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/vite': new URL('./packages/plugin-sdk/src/vite.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/markdown': new URL('./packages/plugin-sdk/src/markdown.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/numberParsing': new URL('./packages/plugin-sdk/src/numberParsing.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/sanitize': new URL('./packages/plugin-sdk/src/sanitize.ts', import.meta.url).pathname,
  '@openforge/plugin-sdk/ui/MarkdownContent.svelte': new URL('./packages/plugin-sdk/src/ui/MarkdownContent.svelte', import.meta.url).pathname,
  '@openforge/plugin-sdk/ui/ResizablePanel.svelte': new URL('./packages/plugin-sdk/src/ui/ResizablePanel.svelte', import.meta.url).pathname,
  '@openforge/plugin-sdk': new URL('./packages/plugin-sdk/src/index.ts', import.meta.url).pathname,
}

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
            'plugins/skills-viewer/src/**/*.test.ts',
            'packages/pr-review-ui/src/**/*.test.ts',
            'packages/terminal-runtime/src/**/*.test.ts',
          ],
          alias: {
            ...pluginRuntimeAliases,
            ...pluginSdkAliases,
            ...terminalRuntimeAliases,
          },
        },
      },
      {
        test: {
          name: 'plugin-sdk',
          environment: 'jsdom',
          globals: true,
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
