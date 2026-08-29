import { describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import backendViteConfig from '../vite.backend.config'

describe('GitHub Sync backend bundle config', () => {
  it('emits a reloadable CommonJS backend artifact', () => {
    const config = backendViteConfig as UserConfig

    expect(config.build?.rollupOptions?.output).toMatchObject({
      entryFileNames: 'backend.cjs',
      chunkFileNames: '[name]-[hash].cjs',
      format: 'cjs',
    })
  })
})
