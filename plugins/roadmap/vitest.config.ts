import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'
import { createOpenForgePluginSdkSourceAliases } from '../../packages/plugin-sdk/src/vite'

const repoRoot = new URL('../..', import.meta.url)
const sourcePath = (path: string) => new URL(path, repoRoot).pathname

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: [
      { find: '@openforge-app/plugin-runtime/commandValidation', replacement: sourcePath('packages/plugin-runtime/src/commandValidation.ts') },
      { find: '@openforge-app/plugin-runtime', replacement: sourcePath('packages/plugin-runtime/src/index.ts') },
      ...createOpenForgePluginSdkSourceAliases(repoRoot),
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
