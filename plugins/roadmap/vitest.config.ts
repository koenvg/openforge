import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

const repoRoot = new URL('../..', import.meta.url)
const sourcePath = (path: string) => new URL(path, repoRoot).pathname

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: [
      { find: '@openforge-app/plugin-runtime/commandValidation', replacement: sourcePath('packages/plugin-runtime/src/commandValidation.ts') },
      { find: '@openforge-app/plugin-runtime', replacement: sourcePath('packages/plugin-runtime/src/index.ts') },
      { find: '@openforge-app/plugin-sdk/frontend', replacement: sourcePath('packages/plugin-sdk/src/frontend.ts') },
      { find: '@openforge-app/plugin-sdk/backend', replacement: sourcePath('packages/plugin-sdk/src/backend.ts') },
      { find: '@openforge-app/plugin-sdk/domain', replacement: sourcePath('packages/plugin-sdk/src/domain.ts') },
      { find: '@openforge-app/plugin-sdk/testing', replacement: sourcePath('packages/plugin-sdk/src/testing.ts') },
      { find: '@openforge-app/plugin-sdk/vite', replacement: sourcePath('packages/plugin-sdk/src/vite.ts') },
      { find: '@openforge-app/plugin-sdk/markdown', replacement: sourcePath('packages/plugin-sdk/src/markdown.ts') },
      { find: '@openforge-app/plugin-sdk/sanitize', replacement: sourcePath('packages/plugin-sdk/src/sanitize.ts') },
      { find: '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte', replacement: sourcePath('packages/plugin-sdk/src/ui/MarkdownContent.svelte') },
      { find: '@openforge-app/plugin-sdk/ui/Modal.svelte', replacement: sourcePath('packages/plugin-sdk/src/ui/Modal.svelte') },
      { find: '@openforge-app/plugin-sdk', replacement: sourcePath('packages/plugin-sdk/src/index.ts') },
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
