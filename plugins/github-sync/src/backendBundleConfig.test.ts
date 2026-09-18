import { describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import backendViteConfig from '../vite.backend.config'

describe('GitHub Sync backend bundle config', () => {
  it('bundles zod into the backend artifact for packaged apps', () => {
    const config = backendViteConfig as UserConfig

    expect(config.ssr?.noExternal).toEqual(
      expect.arrayContaining(['@openforge-app/plugin-sdk', '@openforge-app/pr-review-ui', 'zod']),
    )
    expect(config.build?.rollupOptions?.output).toMatchObject({
      entryFileNames: 'backend.mjs',
      chunkFileNames: '[name]-[hash].mjs',
      format: 'es',
    })
  })
})
