import { describe, expect, it } from 'vitest'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { BoardCard } from './board'
import {
  DEFAULT_ROADMAP_ACTIONS,
  buildIssueTaskPrompt,
  findRoadmapIssueTaskLinkForTask,
  getEnabledRoadmapActions,
  loadRoadmapActions,
  loadRoadmapIssueTaskLinkForTask,
  loadRoadmapIssueTaskLinks,
  startRoadmapIssueAction,
} from './roadmapActions'

const card: BoardCard = {
  issueNumber: 42,
  title: 'Add repository roadmap',
  body: 'Users need a GitHub issue board inside OpenForge.',
  labels: ['enhancement', 'github'],
  value: 8,
  taskLink: null,
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

  it('creates a backlog task for the issue, starts implementation, stores the issue task link, and navigates to the task', async () => {
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
    await expect(registry.frontendApi.storage.task('mock-task-1').get('roadmapIssueLink')).resolves.toEqual({
      issueNumber: 42,
      link: {
        taskId: 'mock-task-1',
        sessionId: 'mock-session',
        workspacePath: '/mock-workspace',
        repo: 'octo/cat',
        title: 'Add repository roadmap',
      },
    })
    expect(registry.calls.storageSets).toContainEqual(
      expect.objectContaining({
        scope: 'project',
        scopeId: 'P-1',
        key: 'issueTaskLinks',
      }),
    )
    await expect(loadRoadmapIssueTaskLinks(registry.frontendApi, 'P-1')).resolves.toEqual({
      42: {
        taskId: 'mock-task-1',
        sessionId: 'mock-session',
        workspacePath: '/mock-workspace',
        repo: 'octo/cat',
        title: 'Add repository roadmap',
      },
    })
    expect(registry.calls.navigationRequests).toEqual([{ projectId: 'P-1', viewId: 'board', taskId: 'mock-task-1' }])
  })

  it('loads only valid stored issue task links', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.roadmap', projectId: 'P-1' })
    await registry.frontendApi.storage.project('P-1').set('issueTaskLinks', {
      '42': {
        taskId: 'KVG-42',
        sessionId: 'session-42',
        workspacePath: '/tmp/kvg-42',
        repo: 'octo/cat',
        title: 'Linked ticket',
      },
      nope: { taskId: 'KVG-nope', sessionId: 'session-nope', workspacePath: '/tmp/nope' },
      '43': { taskId: 43, sessionId: 'session-43', workspacePath: '/tmp/kvg-43' },
    })

    await expect(loadRoadmapIssueTaskLinks(registry.frontendApi, 'P-1')).resolves.toEqual({
      42: {
        taskId: 'KVG-42',
        sessionId: 'session-42',
        workspacePath: '/tmp/kvg-42',
        repo: 'octo/cat',
        title: 'Linked ticket',
      },
    })
  })

  it('keeps task-side ticket links for multiple tasks started from the same issue', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.roadmap', projectId: 'P-1' })
    await startRoadmapIssueAction(registry.frontendApi, {
      projectId: 'P-1',
      repo: 'octo/cat',
      card,
      actionPrompt: 'Implement this issue',
    })
    await startRoadmapIssueAction(registry.frontendApi, {
      projectId: 'P-1',
      repo: 'octo/cat',
      card,
      actionPrompt: 'Implement this issue',
    })

    await expect(loadRoadmapIssueTaskLinkForTask(registry.frontendApi, 'P-1', 'mock-task-1')).resolves.toMatchObject({
      issueNumber: 42,
      link: { taskId: 'mock-task-1', repo: 'octo/cat', title: 'Add repository roadmap' },
    })
    await expect(loadRoadmapIssueTaskLinkForTask(registry.frontendApi, 'P-1', 'mock-task-2')).resolves.toMatchObject({
      issueNumber: 42,
      link: { taskId: 'mock-task-2', repo: 'octo/cat', title: 'Add repository roadmap' },
    })
  })

  it('reverse-lookups the roadmap issue linked to a task', () => {
    expect(
      findRoadmapIssueTaskLinkForTask(
        {
          41: { taskId: 'KVG-41', sessionId: 'session-41', workspacePath: '/tmp/kvg-41', repo: null, title: null },
          42: { taskId: 'KVG-42', sessionId: 'session-42', workspacePath: '/tmp/kvg-42', repo: 'octo/cat', title: 'Linked ticket' },
        },
        'KVG-42',
      ),
    ).toEqual({
      issueNumber: 42,
      link: { taskId: 'KVG-42', sessionId: 'session-42', workspacePath: '/tmp/kvg-42', repo: 'octo/cat', title: 'Linked ticket' },
    })

    expect(findRoadmapIssueTaskLinkForTask({}, 'KVG-42')).toBeNull()
  })
})
