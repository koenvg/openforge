import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { createOpenForgePluginSdkSourceAliases } from '../../packages/plugin-sdk/src/vite.ts'
import { defineConfig } from 'vitest/config'

const repoRoot = new URL('../..', import.meta.url)

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: createOpenForgePluginSdkSourceAliases(repoRoot),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
