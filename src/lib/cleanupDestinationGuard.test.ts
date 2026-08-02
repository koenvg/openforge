import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({ checkGithubIssuesReady: vi.fn() }))

import { checkGithubIssuesReady } from './ipc'
import { validateDestinationChange } from './cleanupDestinationGuard'

describe('validateDestinationChange', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts openforge without a readiness check', async () => {
    const result = await validateDestinationChange('openforge', null)
    expect(result.accepted).toBe(true)
    expect(result.reason).toBeNull()
    expect(checkGithubIssuesReady).not.toHaveBeenCalled()
  })

  it('accepts github_issues when the check reports ready, passing the projectId', async () => {
    vi.mocked(checkGithubIssuesReady).mockResolvedValue({ ready: true, reason: null })
    const result = await validateDestinationChange('github_issues', 'P1')
    expect(result.accepted).toBe(true)
    expect(checkGithubIssuesReady).toHaveBeenCalledWith('P1')
  })

  it('rejects github_issues with the reason when not ready', async () => {
    vi.mocked(checkGithubIssuesReady).mockResolvedValue({
      ready: false,
      reason: 'No GitHub token configured. Add one in Credentials.',
    })
    const result = await validateDestinationChange('github_issues', null)
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('token')
  })
})
