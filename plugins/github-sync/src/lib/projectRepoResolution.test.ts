import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { resolveProjectIdForRepo } from './projectRepoResolution'

describe('resolveProjectIdForRepo', () => {
  function apiWithResolvedProjects(projectIdsByRepo: Record<string, string>) {
    const api = {
      backend: {
        whenReady: vi.fn(async () => {}),
        invoke: vi.fn(async () => projectIdsByRepo),
      },
    } as unknown as FrontendOpenForgeAPI
    return api
  }

  it('selects the live project whose repository matches the pull request', async () => {
    const api = apiWithResolvedProjects({ 'acme/other': 'active-project', 'acme/app': 'matching-project' })

    await expect(resolveProjectIdForRepo(api, 'acme', 'app')).resolves.toBe('matching-project')
    expect(api.backend.invoke).toHaveBeenCalledWith('resolveProjectIdsByRepo', null)
  })

  it('returns null when no local project matches the pull request repository', async () => {
    const api = apiWithResolvedProjects({ 'acme/other': 'other-project' })

    await expect(resolveProjectIdForRepo(api, 'acme', 'app')).resolves.toBeNull()
  })

  it('matches GitHub repository names without case sensitivity', async () => {
    const api = apiWithResolvedProjects({ 'acme/app': 'matching-project' })

    await expect(resolveProjectIdForRepo(api, 'Acme', 'App')).resolves.toBe('matching-project')
  })

  it('propagates resolver errors and allows a later retry', async () => {
    const api = apiWithResolvedProjects({ 'acme/app': 'matching-project' })
    vi.mocked(api.backend.invoke).mockRejectedValueOnce(new Error('origin resolution failed'))

    await expect(resolveProjectIdForRepo(api, 'acme', 'app')).rejects.toThrow('origin resolution failed')
    await expect(resolveProjectIdForRepo(api, 'acme', 'app')).resolves.toBe('matching-project')
  })
})
