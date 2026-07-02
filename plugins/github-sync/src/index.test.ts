import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'

const { mockPrReviewView } = vi.hoisted(() => ({
  mockPrReviewView: { name: 'PrReviewViewComponent' },
}))

vi.mock('./review/pr/PrReviewView.svelte', () => ({
  default: mockPrReviewView,
}))

import packageJson from '../package.json'

const pluginSrcDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(pluginSrcDir, '../../..')

function getPackageMetadata() {
  if (!isOpenForgePackageMetadata(packageJson.openforge)) {
    throw new Error('GitHub Sync package metadata is invalid')
  }
  return packageJson.openforge
}

function makeRuntimeHarness() {
  const packageMetadata = getPackageMetadata()
  const subscriptions = { add: vi.fn() }
  const invokeGlobal = vi.fn(async () => null)
  const backendInvoke = vi.fn(async () => null)
  const backendWhenReady = vi.fn(async () => undefined)
  const onGlobal = vi.fn(() => ({ dispose: vi.fn() }))
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { register: vi.fn(() => ({ dispose: vi.fn() })), invokeGlobal },
    backend: { invoke: backendInvoke, whenReady: backendWhenReady },
    events: { onGlobal },
    navigation: { get: vi.fn(() => ({ activeProjectId: 'project-1', currentView: 'board', selectedTaskId: null })) },
  } as unknown as FrontendOpenForgeAPI
  const context = { pluginId: packageMetadata.id, apiVersion: packageMetadata.apiVersion, packageMetadata, subscriptions } as FrontendPluginContext
  return { api, context, subscriptions, invokeGlobal, backendInvoke, backendWhenReady, onGlobal }
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
    expect(packageJson.openforge.backend).toBe('./dist/backend.js')
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

  it('uses shared PR review UI components instead of plugin-local duplicate leaf components', () => {
    const prReviewSource = readFileSync(join(pluginSrcDir, 'review/pr/PrReviewView.svelte'), 'utf8')

    expect(prReviewSource).toContain('@openforge/pr-review-ui/PrOverviewTab.svelte')
    expect(prReviewSource).toContain('@openforge/pr-review-ui/ReviewSubmitPanel.svelte')
    expect(prReviewSource).toContain('@openforge/pr-review-ui/ReviewPrCard.svelte')
    expect(prReviewSource).toContain('@openforge/pr-review-ui/AuthoredPrCard.svelte')
    expect(prReviewSource).toContain('@openforge/pr-review-ui/FileTree.svelte')
    expect(existsSync(join(pluginSrcDir, 'lib/ipc.ts'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/PrOverviewTab.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/ReviewSubmitPanel.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/ReviewPrCard.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/pr/AuthoredPrCard.svelte'))).toBe(false)
    expect(existsSync(join(pluginSrcDir, 'review/shared/FileTree.svelte'))).toBe(false)
  })

  it('does not keep a legacy host-app PR review UI copy alongside the GitHub Sync plugin view', () => {
    expect(existsSync(join(repoRoot, 'src/components/review/pr'))).toBe(false)
  })

  it('registers PR view and refresh command at runtime through defineFrontendPlugin', async () => {
    const { default: plugin, PrReviewViewComponent } = await import('./index')
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
    await refreshRegistration?.handler(undefined)
    expect(backendWhenReady).toHaveBeenCalled()
    expect(backendInvoke).toHaveBeenCalledWith('forceGithubSync', undefined)
    expect(api.navigation.get).toHaveBeenCalled()
  })

  it('registers GitHub Sync-owned backend methods for PR review operations', async () => {
    const { default: backend } = await import('./backend')
    const subscriptions = { add: vi.fn() }
    const api = {
      backend: { registerMethod: vi.fn(() => ({ dispose: vi.fn() })) },
      commands: { invokeGlobal: vi.fn(async () => null) },
    }

    const packageMetadata = getPackageMetadata()
    await backend.activate(api as never, { pluginId: packageMetadata.id, apiVersion: packageMetadata.apiVersion, packageMetadata, subscriptions })

    expect(api.backend.registerMethod).toHaveBeenCalledWith('forceGithubSync', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('fetchReviewPrs', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getReviewPrs', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getPrFileDiffs', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getFileContentBase64', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getFileAtRefBase64', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getReviewComments', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('submitPrReview', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getAgentReviewComments', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('updateAgentReviewCommentStatus', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('getPrWalkthrough', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('deletePrWalkthrough', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('startAgentWalkthrough', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('abortAgentWalkthrough', expect.objectContaining({ handler: expect.any(Function) }))
    expect(subscriptions.add).toHaveBeenCalledTimes(20)
  })

  it('does not add a GitHub-specific SDK namespace', () => {
    const sdkTypesSource = readFileSync(join(repoRoot, 'packages/plugin-sdk/src/types.ts'), 'utf8')
    const sdkIndexSource = readFileSync(join(repoRoot, 'packages/plugin-sdk/src/index.ts'), 'utf8')

    expect(sdkTypesSource).not.toMatch(/githubReview|prReview|githubSync/i)
    expect(sdkIndexSource).not.toMatch(/githubReview|prReview|githubSync/i)
  })
})
