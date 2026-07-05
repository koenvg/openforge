import { describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import backendViteConfig from '../vite.backend.config'

describe('Task Schedules backend bundle config', () => {
  it('bundles cronstrue into the backend artifact for packaged apps', () => {
    const config = backendViteConfig as UserConfig

    expect(config.ssr?.noExternal).toEqual(expect.arrayContaining(['@openforge-app/plugin-sdk', 'cronstrue']))
  })
})
