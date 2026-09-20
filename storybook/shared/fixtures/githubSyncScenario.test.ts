import { afterEach, describe, expect, it } from 'vitest'
import { createStoryPluginAdapter } from '../environment/storyPluginAdapter'
import { githubSyncScenario } from './githubSyncScenario'

const adapters: Array<{ dispose(): void | Promise<void> }> = []

afterEach(async () => {
  for (const adapter of adapters.splice(0).reverse()) await adapter.dispose()
})

describe('GitHub Sync story scenario', () => {
  it('serves mutable Jira settings through local backend methods and resets them', async () => {
    const definition = githubSyncScenario('connected').plugin!
    const adapter = createStoryPluginAdapter(definition)
    adapters.push(adapter)
    adapter.install()

    await expect(adapter.api.backend.invoke('getJiraSettings')).resolves.toMatchObject({
      config: { baseUrl: 'https://openforge.atlassian.net', projectKeys: 'KVG' },
      tokenConfigured: true,
    })
    await adapter.api.backend.invoke('saveJiraSettings', {
      config: { baseUrl: 'https://other.atlassian.net', email: 'team@example.com', projectKeys: 'TEAM', acFieldId: '' },
      clearToken: true,
    })
    await expect(adapter.api.backend.invoke('getJiraSettings')).resolves.toMatchObject({
      config: { baseUrl: 'https://other.atlassian.net' },
      tokenConfigured: false,
    })

    await adapter.reset()
    await expect(adapter.api.backend.invoke('getJiraSettings')).resolves.toMatchObject({
      config: { baseUrl: 'https://openforge.atlassian.net' },
      tokenConfigured: true,
    })
  })

  it('keeps Task pull request actions local and updates the next read', async () => {
    const definition = githubSyncScenario('populated').plugin!
    const adapter = createStoryPluginAdapter(definition)
    adapters.push(adapter)
    adapter.install()

    const before = await adapter.api.backend.invoke<Array<{ id: number; unaddressed_comment_count: number }>>(
      'listTaskPullRequests',
      { taskId: 'T-42' },
    )
    expect(before).toHaveLength(2)
    expect(before[0]?.unaddressed_comment_count).toBe(1)

    await adapter.api.backend.invoke('markTaskPrCommentAddressed', { commentId: 101 })

    const comments = await adapter.api.backend.invoke<Array<{ id: number }>>('getTaskPrComments', { prId: 42 })
    expect(comments).toEqual([])
    const after = await adapter.api.backend.invoke<Array<{ id: number; unaddressed_comment_count: number }>>(
      'listTaskPullRequests',
      { taskId: 'T-42' },
    )
    expect(after[0]?.unaddressed_comment_count).toBe(0)
    expect(adapter.calls.backendInvocations.map(call => call.method)).toEqual([
      'listTaskPullRequests',
      'markTaskPrCommentAddressed',
      'getTaskPrComments',
      'listTaskPullRequests',
    ])
  })

  it('models unavailable integration responses without external services', async () => {
    const definition = githubSyncScenario('failure').plugin!
    const adapter = createStoryPluginAdapter(definition)
    adapters.push(adapter)
    adapter.install()

    await expect(adapter.api.backend.invoke('getJiraSettings')).rejects.toThrow('Jira settings are unavailable.')
    await expect(adapter.api.backend.invoke('listTaskPullRequests', { taskId: 'T-42' }))
      .rejects.toThrow('GitHub status is unavailable.')
  })
})
