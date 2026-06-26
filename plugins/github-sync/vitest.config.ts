import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { createOpenForgePluginSdkSourceAliases } from '../../packages/plugin-sdk/src/vite'
import { defineConfig } from 'vitest/config'

const repoRoot = new URL('../..', import.meta.url)
const sourcePath = (path: string) => new URL(path, repoRoot).pathname

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: [
      ...createOpenForgePluginSdkSourceAliases(repoRoot),
      { find: '@openforge/plugin-runtime/commandValidation', replacement: sourcePath('packages/plugin-runtime/src/commandValidation.ts') },
      { find: '@openforge/plugin-runtime', replacement: sourcePath('packages/plugin-runtime/src/index.ts') },
      { find: /^@openforge\/pr-review-ui\/(.*)$/, replacement: `${sourcePath('packages/pr-review-ui/src')}/$1` },
      { find: '@openforge/pr-review-ui', replacement: sourcePath('packages/pr-review-ui/src/index.ts') },
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
