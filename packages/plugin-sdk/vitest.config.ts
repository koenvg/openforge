import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { createOpenForgePluginSdkSourceAliasRecord } from './src/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: createOpenForgePluginSdkSourceAliasRecord(new URL('../../', import.meta.url)),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
