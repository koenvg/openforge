import { describe, expect, it } from 'vitest'
import type { JsonValue, PluginStorage } from '@openforge-app/plugin-sdk'
import { createMemoryPluginStorage, createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { BoardCard } from './board'
import {
  buildIssueTaskPrompt,
  findRoadmapIssueTaskLinkForTask,
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

function withFailingNextIssueTaskLinksGet(storage: PluginStorage): PluginStorage {
  let shouldFail = true
  return {
    global: storage.global,
    project(projectId) {
      const scope = storage.project(projectId)
      return {
        async get<T extends JsonValue = JsonValue>(key: string): Promise<T | null> {
          if (key === 'issueTaskLinks' && shouldFail) {
            shouldFail = false
            throw new Error('transient project storage read failure')
          }
          return scope.get<T>(key)
        },
        async set<T extends JsonValue = JsonValue>(key: string, value: T): Promise<void> {
          await scope.set(key, value)
        },
        async delete(key: string): Promise<void> {
          await scope.delete(key)
        },
      }
    },
    task: (taskId) => storage.task(taskId),
  }
}

describe('roadmap actions', () => {
  it('builds a task prompt from the GitHub issue context', () => {
    const prompt = buildIssueTaskPrompt({
      card,
      repo: 'octo/cat',
    })

    expect(prompt).toContain('Implement this GitHub issue #42: Add repository roadmap')
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

  it('keeps both issue links available for RoadmapView hydration after concurrent starts', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.roadmap', projectId: 'P-1' })
    const secondCard: BoardCard = { ...card, issueNumber: 43, title: 'Fix concurrent roadmap starts' }

    await Promise.all([
      startRoadmapIssueAction(registry.frontendApi, {
        projectId: 'P-1',
        repo: 'octo/cat',
        card,
      }),
      startRoadmapIssueAction(registry.frontendApi, {
        projectId: 'P-1',
        repo: 'octo/cat',
        card: secondCard,
      }),
    ])

    await expect(loadRoadmapIssueTaskLinks(registry.frontendApi, 'P-1')).resolves.toMatchObject({
      42: { taskId: 'mock-task-1', title: 'Add repository roadmap' },
      43: { taskId: 'mock-task-2', title: 'Fix concurrent roadmap starts' },
    })
  })

  it('preserves stored links when one queued read fails and continues the next update', async () => {
    const storage = createMemoryPluginStorage()
    await storage.project('P-1').set('issueTaskLinks', {
      41: {
        taskId: 'KVG-41',
        sessionId: 'session-41',
        workspacePath: '/tmp/kvg-41',
        repo: 'octo/cat',
        title: 'Existing roadmap task',
      },
    })
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.roadmap',
      projectId: 'P-1',
      storage: withFailingNextIssueTaskLinksGet(storage),
    })
    const secondCard: BoardCard = { ...card, issueNumber: 43, title: 'Continue after storage failure' }

    const [failedStart, successfulStart] = await Promise.allSettled([
      startRoadmapIssueAction(registry.frontendApi, {
        projectId: 'P-1',
        repo: 'octo/cat',
        card,
      }),
      startRoadmapIssueAction(registry.frontendApi, {
        projectId: 'P-1',
        repo: 'octo/cat',
        card: secondCard,
      }),
    ])

    expect(failedStart).toMatchObject({ status: 'rejected' })
    expect(successfulStart).toMatchObject({ status: 'fulfilled' })
    await expect(loadRoadmapIssueTaskLinks(registry.frontendApi, 'P-1')).resolves.toMatchObject({
      41: { taskId: 'KVG-41', title: 'Existing roadmap task' },
      43: { taskId: 'mock-task-2', title: 'Continue after storage failure' },
    })
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
    })
    await startRoadmapIssueAction(registry.frontendApi, {
      projectId: 'P-1',
      repo: 'octo/cat',
      card,
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
