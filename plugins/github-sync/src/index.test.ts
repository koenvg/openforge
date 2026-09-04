import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge-app/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import { createMockPluginContext } from '@openforge-app/plugin-sdk/testing'
import type { PluginCommandInvocationContext } from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge-app/plugin-sdk/frontend'

const { mockPrReviewView, mockTaskPullRequestStatus } = vi.hoisted(() => ({
  mockPrReviewView: { name: 'PrReviewViewComponent' },
  mockTaskPullRequestStatus: { name: 'TaskPullRequestStatusComponent' },
}))

vi.mock('./review/pr/PrReviewView.svelte', () => ({
  default: mockPrReviewView,
}))

vi.mock('./task/TaskPullRequestStatus.svelte', () => ({
  default: mockTaskPullRequestStatus,
}))

import plugin, { PrReviewRowActionComponent, PrReviewViewComponent, TaskPullRequestStatusComponent } from './index'
import packageJson from '../package.json'

const pluginSrcDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(pluginSrcDir, '../../..')

function getPackageMetadata() {
  if (!isOpenForgePackageMetadata(packageJson.openforge)) {
    throw new Error('GitHub Sync package metadata is invalid')
  }
  return packageJson.openforge
}

function makePluginContext(subscriptions: FrontendPluginContext['subscriptions']): FrontendPluginContext {
  const packageMetadata = getPackageMetadata()
  return {
    ...createMockPluginContext({ pluginId: packageMetadata.id, packageMetadata }),
    subscriptions,
  }
}

function makeRuntimeHarness() {
  const sectionDisposable = { dispose: vi.fn() }
  const rowActionDisposable = { dispose: vi.fn() }
  const subscriptions = { add: vi.fn() }
  const invokeGlobal = vi.fn(async () => null)
  const backendInvoke = vi.fn(async () => null)
  const backendWhenReady = vi.fn(async () => undefined)
  const onGlobal = vi.fn(() => ({ dispose: vi.fn() }))
  const navigate = vi.fn(async (_request: Parameters<FrontendOpenForgeAPI['navigation']['navigate']>[0]) => ({
    activeProjectId: 'project-1',
    currentView: 'board',
    selectedTaskId: null,
  }))
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    taskUI: { registerSection: vi.fn(() => sectionDisposable) },
    reviewUI: { registerRowAction: vi.fn(() => rowActionDisposable) },
    settings: { registerSection: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { register: vi.fn(() => ({ dispose: vi.fn() })), invokeGlobal },
    backend: { invoke: backendInvoke, whenReady: backendWhenReady },
    events: { onGlobal },
    navigation: {
      get: vi.fn(() => ({ activeProjectId: 'project-1', currentView: 'board', selectedTaskId: null })),
      navigate,
    },
  } as unknown as FrontendOpenForgeAPI
  const context = makePluginContext(subscriptions)
  return { api, context, subscriptions, sectionDisposable, rowActionDisposable, invokeGlobal, backendInvoke, backendWhenReady, onGlobal, navigate }
}
const commandInvocationContext: PluginCommandInvocationContext = {
  taskId: null,
  projectId: null,
  source: 'plugin',
}

function findCommandHandler(api: FrontendOpenForgeAPI, id: string) {
  const call = vi.mocked(api.commands.register).mock.calls.find((c) => (c[0] as { id: string }).id === id)
  return (call?.[0] as { handler: (payload: unknown, context: PluginCommandInvocationContext) => Promise<unknown> } | undefined)?.handler
}

describe('github-sync plugin', () => {
  it('does not retain stale host PluginContext state in the GitHub sync plugin entry', () => {
    const indexSource = readFileSync(join(pluginSrcDir, 'index.ts'), 'utf8')

    expect(indexSource).not.toContain('./pluginContext')
    expect(indexSource).not.toContain('setPluginContext')
    expect(existsSync(join(pluginSrcDir, 'pluginContext.ts'))).toBe(false)
  })

  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
    expect(packageJson.openforge.backend).toBe('./dist/backend.mjs')
    expect(packageJson.openforge.requires).toEqual(expect.arrayContaining(['backend']))
  })

  it('keeps GitHub PR review host command strings out of plugin UI and activation code', () => {
    const indexSource = readFileSync(join(pluginSrcDir, 'index.ts'), 'utf8')
    const prReviewSource = readFileSync(join(pluginSrcDir, 'review/pr/PrReviewView.svelte'), 'utf8')

    expect(indexSource).not.toMatch(/["'`]openforge\./)
    expect(prReviewSource).not.toMatch(/["'`]openforge\./)
    expect(prReviewSource).toContain('createGithubSyncPrReviewClient(api)')
    expect(prReviewSource).toContain('api.navigation.navigate')
  })
  it('keeps the Task pull request contribution behind public plugin boundaries', () => {
    const taskSources = [
      readFileSync(join(pluginSrcDir, 'task/TaskPullRequestStatus.svelte'), 'utf8'),
      readFileSync(join(pluginSrcDir, 'task/githubTaskClient.ts'), 'utf8'),
      readFileSync(join(pluginSrcDir, 'task/useMergeOrchestration.svelte.ts'), 'utf8'),
    ].join('\n')

    expect(taskSources).not.toMatch(/(?:\.\.\/)+\.\.\/src\//)
    expect(taskSources).not.toContain('/lib/ipc')
    expect(taskSources).not.toMatch(/electron|preload|src-tauri/)
    expect(taskSources).toContain("@openforge-app/plugin-sdk")
  })

  it('uses shared PR review UI components instead of plugin-local duplicate leaf components', () => {
    const prReviewSource = readFileSync(join(pluginSrcDir, 'review/pr/PrReviewView.svelte'), 'utf8')
    const prReviewListSource = readFileSync(join(pluginSrcDir, 'review/pr/PrReviewListSection.svelte'), 'utf8')
    const prReviewDetailSource = readFileSync(join(pluginSrcDir, 'review/pr/PrReviewDetailSection.svelte'), 'utf8')
    const combinedReviewSource = `${prReviewSource}\n${prReviewListSource}\n${prReviewDetailSource}`

    expect(combinedReviewSource).toContain('@openforge-app/pr-review-ui/PrOverviewTab.svelte')
    expect(combinedReviewSource).toContain('@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte')
    expect(combinedReviewSource).toContain('@openforge-app/pr-review-ui/ReviewPrCard.svelte')
    expect(combinedReviewSource).toContain('@openforge-app/pr-review-ui/AuthoredPrCard.svelte')
    expect(combinedReviewSource).toContain('@openforge-app/pr-review-ui/FileTree.svelte')
    expect(existsSync(join(pluginSrcDir, 'lib/ipc.ts'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/PrOverviewTab.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/ReviewSubmitPanel.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/ReviewPrCard.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/AuthoredPrCard.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/shared/FileTree.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'shared/ui/Modal.svelte'))).toBe(false)
  })

  it('does not keep a legacy host-app PR review UI copy alongside the GitHub Sync plugin view', () => {
    expect(existsSync(join(repoRoot, 'src/components/review/pr'))).toBe(false)
  })

  it('registers and disposes the plugin-owned Task pull request section', async () => {
    const { api, context, subscriptions, sectionDisposable } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(api.taskUI.registerSection).toHaveBeenCalledWith({
      id: 'task_pull_request_status',
      // Past the host's Changes card, so the section reads after the local changes.
      order: 60,
      component: TaskPullRequestStatusComponent,
    })
    expect(TaskPullRequestStatusComponent).toBe(mockTaskPullRequestStatus)
    expect(subscriptions.add).toHaveBeenCalledWith(sectionDisposable)

    const registered = vi.mocked(subscriptions.add).mock.calls.map(([subscription]) => subscription)
    await Promise.all(registered.map(async (subscription) => {
      if (typeof subscription === 'function') await subscription()
      else await subscription.dispose()
    }))
    expect(sectionDisposable.dispose).toHaveBeenCalledOnce()
  })

  it('registers and disposes the walkthrough control shown on every review row', async () => {
    const { api, context, subscriptions, rowActionDisposable } = makeRuntimeHarness()

    await plugin.activate(api, context)

    // The host renders this on each review-requested pull-request row (the attention
    // overview today), so the same control the PR list shows follows the pull request.
    expect(api.reviewUI.registerRowAction).toHaveBeenCalledWith({
      id: 'pr_walkthrough',
      order: 10,
      component: PrReviewRowActionComponent,
    })
    expect(subscriptions.add).toHaveBeenCalledWith(rowActionDisposable)

    const registered = vi.mocked(subscriptions.add).mock.calls.map(([subscription]) => subscription)
    await Promise.all(registered.map(async (subscription) => {
      if (typeof subscription === 'function') await subscription()
      else await subscription.dispose()
    }))
    expect(rowActionDisposable.dispose).toHaveBeenCalledOnce()
  })

  it('registers PR view and refresh command at runtime through defineFrontendPlugin', async () => {
    const { api, context, subscriptions, backendInvoke, backendWhenReady } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pr_review',
      title: 'Pull Requests',
      icon: 'git-pull-request',
      placement: 'rail',
      order: 20,
      component: PrReviewViewComponent,
    }))
    // The all-repos view lives in the left projects sidebar, not the icon rail.
    // It carries Cmd+Shift+G, the logical sibling of the project view's Cmd+G.
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pr_review_global',
      title: 'All Pull Requests',
      icon: 'boxes',
      placement: 'sidebar',
      shortcut: 'Cmd+Shift+G',
      component: PrReviewViewComponent,
    }))
    expect(api.commands.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'refresh',
      title: 'Refresh Pull Requests',
      handler: expect.any(Function),
    }))
    expect(PrReviewViewComponent).toBe(mockPrReviewView)
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))

    const refreshRegistration = vi.mocked(api.commands.register).mock.calls[0]?.[0]
    await refreshRegistration?.handler(undefined, commandInvocationContext)
    expect(backendWhenReady).toHaveBeenCalled()
    expect(backendInvoke).toHaveBeenCalledWith('forceGithubSync', undefined)
    expect(api.navigation.get).toHaveBeenCalled()
  })

  it('registers an open_review_pr command that opens a PR under its project view', async () => {
    const { pendingReviewPrOpen } = await import('./lib/stores')
    const { get } = await import('svelte/store')
    const { api, context, navigate } = makeRuntimeHarness()

    pendingReviewPrOpen.set(null)
    await plugin.activate(api, context)

    expect(api.commands.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'open_review_pr',
      handler: expect.any(Function),
    }))

    const handler = findCommandHandler(api, 'open_review_pr')
    expect(handler).toBeDefined()

    const pr = { id: 42, number: 7, repo_owner: 'me', repo_name: 'app' } as unknown
    await handler?.({ pr, projectId: 'project-9' }, commandInvocationContext)

    // A PR nested under a project opens the per-project PR review view for that project.
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      viewId: `plugin:${context.pluginId}:pr_review`,
      projectId: 'project-9',
    }))
    expect(get(pendingReviewPrOpen)).toBe(pr)
  })

  it('open_review_pr opens an "other repositories" PR in the global view without switching project', async () => {
    const { pendingReviewPrOpen } = await import('./lib/stores')
    const { get } = await import('svelte/store')
    const { api, context, navigate } = makeRuntimeHarness()

    pendingReviewPrOpen.set(null)
    await plugin.activate(api, context)

    const handler = findCommandHandler(api, 'open_review_pr')
    const pr = { id: 99, number: 3, repo_owner: 'someone', repo_name: 'other' } as unknown
    await handler?.({ pr, projectId: null }, commandInvocationContext)

    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      viewId: `plugin:${context.pluginId}:pr_review_global`,
    }))
    // A null section must not clobber the active project (undefined = leave as-is).
    expect(vi.mocked(navigate).mock.calls.at(-1)?.[0]).not.toHaveProperty('projectId', null)
    expect(get(pendingReviewPrOpen)).toBe(pr)
  })

  it('registers GitHub Sync-owned backend methods for PR review operations', async () => {
    const { default: backend } = await import('./backend')
    const subscriptions = { add: vi.fn() }
    const api = {
      backend: { registerMethod: vi.fn(() => ({ dispose: vi.fn() })) },
      commands: { invokeGlobal: vi.fn(async () => null) },
    }

    await backend.activate(api as never, makePluginContext(subscriptions))

    expect(api.backend.registerMethod).toHaveBeenCalledWith('forceGithubSync', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('fetchReviewPrs', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getReviewPrs', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getPrFileDiffs', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getFileContentBase64', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getFileAtRefBase64', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('resolveGithubAsset', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getReviewComments', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('submitPrReview', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getAgentReviewComments', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('updateAgentReviewCommentStatus', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getPrAiReviewComments', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('updatePrAiReviewCommentStatus', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getPrWalkthrough', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('deletePrWalkthrough', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('startAgentWalkthrough', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('abortAgentWalkthrough', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('markReviewPrUnviewed', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('listTaskPullRequests', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('refreshTaskGithubStatus', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('linkTaskPullRequest', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getTaskPrComments', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('markTaskPrCommentAddressed', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('mergeTaskPullRequest', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('enqueueTaskPullRequest', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getAiThreads', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('saveAiThread', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('deleteAiThread', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('askAgentQuestions', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('replyToReviewComment', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('createReviewComment', expect.objectContaining({ handler: expect.any(Function) }))
    // Jira ticket gap analysis.
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getJiraSettings', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('saveJiraSettings', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('testJiraConnection', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getPrTicket', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('setPrJiraKey', expect.objectContaining({ handler: expect.any(Function) }))
    expect(subscriptions.add).toHaveBeenCalledTimes(42)
  })

  it('passes the requested Task through to the local pull-request query', async () => {
    const { default: backend } = await import('./backend')
    const subscriptions = { add: vi.fn() }
    const invokeGlobal = vi.fn(async () => [{ id: 42, ticket_id: 'T-42' }])
    let listTaskPullRequests: ((request: { taskId: string }) => Promise<unknown>) | undefined
    const registerMethod = vi.fn((method: string, registration: { handler: (request: { taskId: string }) => Promise<unknown> }) => {
      if (method === 'listTaskPullRequests') listTaskPullRequests = registration.handler
      return { dispose: vi.fn() }
    })
    const api = { backend: { registerMethod }, commands: { invokeGlobal } }
    await backend.activate(api as never, makePluginContext(subscriptions))
    await listTaskPullRequests?.({ taskId: 'T-42' })

    expect(invokeGlobal).toHaveBeenCalledWith('openforge.getPullRequests', { taskId: 'T-42' })
  })

  it('does not add a GitHub-specific SDK namespace', () => {
    const sdkTypesSource = readFileSync(join(repoRoot, 'packages/plugin-sdk/src/types.ts'), 'utf8')
    const sdkIndexSource = readFileSync(join(repoRoot, 'packages/plugin-sdk/src/index.ts'), 'utf8')

    expect(sdkTypesSource).not.toMatch(/githubReview|prReview|githubSync/i)
    expect(sdkIndexSource).not.toMatch(/githubReview|prReview|githubSync/i)
  })
})
