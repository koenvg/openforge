import { createOpenForgePluginSdkSourceAliasRecord } from './src/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: createOpenForgePluginSdkSourceAliasRecord(new URL('../../', import.meta.url)),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
