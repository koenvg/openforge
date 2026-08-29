import { describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import backendViteConfig from '../vite.backend.config'

describe('GitHub Sync backend bundle config', () => {
  it('emits an isolated ESM backend artifact', () => {
    const config = backendViteConfig as UserConfig

    expect(config.build?.rollupOptions?.output).toMatchObject({
      entryFileNames: 'backend.mjs',
      chunkFileNames: '[name]-[hash].mjs',
      format: 'es',
    })
  })
})
