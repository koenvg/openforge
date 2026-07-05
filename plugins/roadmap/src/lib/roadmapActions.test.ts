import { describe, expect, it } from 'vitest'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { BoardCard } from './board'
import {
  DEFAULT_ROADMAP_ACTIONS,
  buildIssueTaskPrompt,
  getEnabledRoadmapActions,
  loadRoadmapActions,
  startRoadmapIssueAction,
} from './roadmapActions'

const card: BoardCard = {
  issueNumber: 42,
  title: 'Add repository roadmap',
  body: 'Users need a GitHub issue board inside OpenForge.',
  labels: ['enhancement', 'github'],
  value: 8,
}

describe('roadmap actions', () => {
  it('falls back to the default action when project config is missing or invalid', () => {
    expect(getEnabledRoadmapActions(null)).toEqual(DEFAULT_ROADMAP_ACTIONS)
    expect(getEnabledRoadmapActions('not-json')).toEqual(DEFAULT_ROADMAP_ACTIONS)
    expect(getEnabledRoadmapActions('[]')).toEqual(DEFAULT_ROADMAP_ACTIONS)
  })

  it('parses stored project actions, removes legacy agent fields, filters disabled actions, and sorts by name', () => {
    const stored = JSON.stringify([
      { id: 'review', name: 'Review', prompt: 'Review the issue', builtin: false, enabled: false },
      { id: 'fix', name: 'Fix', prompt: 'Fix this issue', builtin: false, enabled: true, agent: 'legacy' },
      { id: 'audit', name: 'Audit', prompt: 'Audit this issue', builtin: false, enabled: true },
    ])

    expect(getEnabledRoadmapActions(stored)).toEqual([
      { id: 'audit', name: 'Audit', prompt: 'Audit this issue', builtin: false, enabled: true },
      { id: 'fix', name: 'Fix', prompt: 'Fix this issue', builtin: false, enabled: true },
    ])
  })

  it('loads enabled actions from the plugin project config API', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.roadmap', projectId: 'P-1' })
    await registry.frontendApi.projectConfig.set(
      'actions',
      JSON.stringify([
        { id: 'go', name: 'Go', prompt: '', builtin: true, enabled: true },
        { id: 'disabled', name: 'Disabled', prompt: 'Do not show', builtin: false, enabled: false },
      ]),
      'P-1',
    )

    await expect(loadRoadmapActions(registry.frontendApi, 'P-1')).resolves.toEqual([
      { id: 'go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])
  })

  it('builds a task prompt from the selected action and GitHub issue context', () => {
    const prompt = buildIssueTaskPrompt({
      card,
      repo: 'octo/cat',
      actionPrompt: 'Implement this issue',
    })

    expect(prompt).toContain('Implement this issue GitHub issue #42: Add repository roadmap')
    expect(prompt).toContain('Repository: octo/cat')
    expect(prompt).toContain('Issue URL: https://github.com/octo/cat/issues/42')
    expect(prompt).toContain('Labels: enhancement, github')
    expect(prompt).toContain('Users need a GitHub issue board inside OpenForge.')
  })

  it('creates a backlog task for the issue, starts implementation, and navigates to the task', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.roadmap', projectId: 'P-1' })

    const run = await startRoadmapIssueAction(registry.frontendApi, {
      projectId: 'P-1',
      repo: 'octo/cat',
      card,
      actionPrompt: 'Implement this issue',
    })

    expect(run.taskId).toBe('mock-task-1')
    expect(registry.calls.taskCreations).toEqual([
      {
        initialPrompt: expect.stringContaining('GitHub issue #42: Add repository roadmap'),
        projectId: 'P-1',
      },
    ])
    expect(registry.calls.taskImplementationStarts).toEqual([{ taskId: 'mock-task-1' }])
    expect(registry.calls.navigationRequests).toEqual([{ projectId: 'P-1', viewId: 'board', taskId: 'mock-task-1' }])
  })
})
