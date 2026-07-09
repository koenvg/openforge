import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import RoadmapTaskPane from './RoadmapTaskPane.svelte'

function boardResponse() {
  return {
    repo: { owner: 'owner', name: 'repo' },
    issues: [
      {
        number: 42,
        title: 'Improve roadmap sync',
        body: 'Keep GitHub issues and local values aligned.',
        state: 'open',
        html_url: 'https://github.com/owner/repo/issues/42',
        labels: [],
      },
    ],
    labels: [],
    values: {},
    columnLabels: [],
  }
}

describe('RoadmapTaskPane', () => {
  it('shows and opens the roadmap ticket linked to the selected task', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.roadmap', projectId: 'P-1', taskId: 'KVG-42' })
    const api = registry.frontendApi
    vi.spyOn(api.backend, 'invoke').mockResolvedValue(boardResponse())
    await api.storage.task('KVG-42').set('roadmapIssueLink', {
      issueNumber: 42,
      link: {
        taskId: 'KVG-42',
        sessionId: 'session-42',
        workspacePath: '/tmp/kvg-42',
        repo: 'owner/repo',
        title: 'Stored title',
      },
    })

    render(RoadmapTaskPane, {
      props: { api, context: api.context.getSnapshot(), taskId: 'KVG-42', projectId: 'P-1' },
    })

    expect(await screen.findByText('Improve roadmap sync')).toBeTruthy()
    expect(screen.getByText('#42')).toBeTruthy()
    expect(screen.getByText('owner/repo')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Open GitHub issue' }))

    expect(registry.calls.openUrl).toEqual(['https://github.com/owner/repo/issues/42'])
  })

  it('shows an empty state when the selected task has no roadmap ticket link', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.roadmap', projectId: 'P-1', taskId: 'KVG-99' })
    const api = registry.frontendApi

    render(RoadmapTaskPane, {
      props: { api, context: api.context.getSnapshot(), taskId: 'KVG-99', projectId: 'P-1' },
    })

    expect(await screen.findByText('No roadmap ticket is linked to this task.')).toBeTruthy()
  })
})
