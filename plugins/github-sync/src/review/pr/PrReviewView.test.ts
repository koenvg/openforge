import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoredPullRequest, PrFileDiff, PrWalkthrough, ReviewComment, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { TestingOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'

vi.mock('@openforge-app/pr-review-ui/useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
    get virtualItems() {
      const count = opts.getCount()
      return Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 300,
        end: (i + 1) * 300,
        size: 300,
        lane: 0,
      }))
    },
    totalSize: 300,
    scrollToIndex: vi.fn(),
    measureAction: () => ({ destroy() {} }),
  })),
}))

vi.mock('@openforge-app/pr-review-ui/useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn(() => ({
    getDiffFile: () => null,
  })),
}))

vi.mock('../../lib/domUtils', () => ({
  getHTMLElementAt: (items: NodeListOf<Element>, index: number) => items[index] instanceof HTMLElement ? items[index] : null,
  isInputFocused: () => false,
}))

vi.mock('../../lib/useVimNavigation.svelte', () => ({
  useVimNavigation: vi.fn(() => ({
    focusedIndex: 0,
    handleKeydown: vi.fn(),
  })),
}))

vi.mock('../../lib/stores', () => ({
  activeProjectId: writable(null),
  reviewPrs: writable([]),
  authoredPrs: writable([]),
  selectedReviewPr: writable(null),
  pendingReviewPrOpen: writable(null),
  prFileDiffs: writable([]),
  reviewComments: writable([]),
  pendingManualComments: writable([]),
  pendingReplies: writable([]),
  prOverviewComments: writable([]),
  agentReviewComments: writable([]),
  aiThreads: writable([]),
}))

import PrReviewView from './PrReviewView.svelte'
import {
  activeProjectId,
  agentReviewComments,
  aiThreads,
  authoredPrs,
  pendingManualComments,
  pendingReplies,
  pendingReviewPrOpen,
  prFileDiffs,
  prOverviewComments,
  reviewComments,
  reviewPrs,
  selectedReviewPr,
} from '../../lib/stores'

type Constructor<T> = {
  new (...args: never[]): T
  name: string
}

function requireElement<T extends Element>(
  value: Element | null | undefined,
  ctor: Constructor<T>,
  message = `Expected ${ctor.name}`,
): T {
  if (!(value instanceof ctor)) {
    throw new Error(message)
  }

  return value
}

const GLOBAL_VIEW_ID = 'plugin:com.openforge.github-sync:pr_review_global'

const basePr: ReviewPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix authentication middleware',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'fix/auth',
  base_ref: 'main',
  head_sha: 'head-sha',
  additions: 5,
  deletions: 2,
  changed_files: 1,
  mergeable: null,
  mergeable_state: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  viewed_at: null,
  viewed_head_sha: null,
  labels: [],
}

const baseDiff: PrFileDiff = {
  sha: 'file-sha-one',
  filename: 'src/main.rs',
  status: 'modified',
  additions: 5,
  deletions: 2,
  changes: 7,
  patch: '@@ -1,3 +1,4 @@\n line1\n+added\n line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

const secondPr: ReviewPullRequest = {
  ...basePr,
  id: 67890,
  number: 43,
  title: 'Add checkout flow',
  head_sha: 'second-head-sha',
  additions: 3,
  deletions: 1,
}

const secondDiff: PrFileDiff = {
  ...baseDiff,
  sha: 'second-file-sha',
  filename: 'src/checkout.ts',
  additions: 3,
  deletions: 1,
  changes: 4,
  patch: '@@ -1 +1,2 @@\n line1\n+checkout',
}

function resetStores() {
  activeProjectId.set(null)
  reviewPrs.set([])
  authoredPrs.set([])
  selectedReviewPr.set(null)
  pendingReviewPrOpen.set(null)
  prFileDiffs.set([])
  reviewComments.set([])
  pendingManualComments.set([])
  pendingReplies.set([])
  prOverviewComments.set([])
  agentReviewComments.set([])
  aiThreads.set([])
}

function registerPrReviewBackends(
  registry: TestingOpenForgeRegistryFake,
  getDiffs: (request: { prNumber: number }) => PrFileDiff[] | Promise<PrFileDiff[]>,
  prs: ReviewPullRequest[] = [basePr],
  reviewCommentResults: ReviewComment[] | (() => ReviewComment[] | Promise<ReviewComment[]>) = [],
  submitReview: () => Promise<void> = async () => undefined,
  fileContent = '',
  getWalkthrough: () => PrWalkthrough | null | Promise<PrWalkthrough | null> = () => null,
) {
  // Per-repo scope now shows only the project's resolved repo (never all repos), so
  // tests that exercise the repo-scoped view must resolve to the fixtures' repo.
  void registry.frontendApi.projectConfig.set('resolved_repo', `${basePr.repo_owner}/${basePr.repo_name}`, 'project-1')
  const backend = registry.backendApi.backend
  backend.registerMethod('getReviewPrs', { handler: async () => prs })
  backend.registerMethod('fetchReviewPrs', { handler: async () => prs })
  backend.registerMethod('getAuthoredPrs', { handler: async () => [] })
  backend.registerMethod('fetchAuthoredPrs', { handler: async () => [] })
  backend.registerMethod('markReviewPrViewed', { handler: async () => undefined })
  backend.registerMethod('markReviewPrUnviewed', { handler: async () => undefined })
  backend.registerMethod('getPrFileDiffs', { handler: async (payload) => getDiffs(payload as { prNumber: number }) })
  backend.registerMethod('getReviewComments', {
    handler: async () => typeof reviewCommentResults === 'function'
      ? reviewCommentResults()
      : reviewCommentResults,
  })
  backend.registerMethod('getPrOverviewComments', { handler: async () => [] })
  backend.registerMethod('getAgentReviewComments', { handler: async () => [] })
  backend.registerMethod('updateAgentReviewCommentStatus', { handler: async () => undefined })
  backend.registerMethod('getPrAiReviewComments', { handler: async () => [] })
  backend.registerMethod('updatePrAiReviewCommentStatus', { handler: async () => undefined })
  backend.registerMethod('getPrWalkthrough', { handler: async () => getWalkthrough() })
  backend.registerMethod('getPrTicket', { handler: async () => ({ snapshot: null, jiraConfigured: false }) })
  backend.registerMethod('startAgentWalkthrough', { handler: async () => ({ walkthrough_session_key: 'session-key' }) })
  backend.registerMethod('deletePrWalkthrough', { handler: async () => undefined })
  backend.registerMethod('abortAgentWalkthrough', { handler: async () => undefined })
  backend.registerMethod('getAiThreads', { handler: async () => [] })
  backend.registerMethod('saveAiThread', { handler: async () => undefined })
  backend.registerMethod('deleteAiThread', { handler: async () => undefined })
  backend.registerMethod('askAgentQuestions', { handler: async () => undefined })
  backend.registerMethod('getFileContent', { handler: async () => fileContent })
  backend.registerMethod('getFileAtRef', { handler: async () => '' })
  backend.registerMethod('submitPrReview', { handler: submitReview })
}

async function openFilesTab(registry: TestingOpenForgeRegistryFake) {
  render(PrReviewView, {
    props: {
      api: registry.frontendApi,
      context: registry.frontendApi.context.getSnapshot(),
      projectName: 'Demo Project',
      projectId: 'project-1',
    },
  })

  const title = await screen.findByText('Fix authentication middleware')
  await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
  await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))
  return requireElement(await screen.findByLabelText('Mark src/main.rs reviewed'), HTMLInputElement)
}

describe('PrReviewView repo scoping', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('shows a not-linked message (and no other repos PRs) when the project has no resolved GitHub repo', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff], [basePr])
    await registry.frontendApi.config.set('github_token', 'ghp_test')
    // A project with no GitHub remote resolves to no repo — the per-repo view must show
    // the not-linked message, never other repos' PRs.
    await registry.frontendApi.projectConfig.set('resolved_repo', '', 'project-1')

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Personal',
        projectId: 'project-1',
      },
    })

    await screen.findByText("This project isn't linked to a GitHub repository")
    expect(screen.queryByText('Fix authentication middleware')).toBeNull()
    expect(screen.queryByText('Review Requests')).toBeNull()
  })
})

describe('PrReviewView host-driven open', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('opens a PR straight into the detail view when the host sets pendingReviewPrOpen', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    // List is up but no PR is selected yet.
    await screen.findByText('Fix authentication middleware')
    expect(get(selectedReviewPr)).toBeNull()

    // The host (attention dialog) requests opening this specific PR.
    pendingReviewPrOpen.set(basePr)

    await waitFor(() => {
      expect(get(selectedReviewPr)?.id).toBe(basePr.id)
      expect(get(prFileDiffs).map((d) => d.filename)).toEqual(['src/main.rs'])
    })
    // The request is consumed so it does not re-fire on later store updates.
    expect(get(pendingReviewPrOpen)).toBeNull()
  })
})

describe('PrReviewView mark as unread', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('optimistically resets a read PR to unread when its Mark as unread control is clicked', async () => {
    const viewedPr: ReviewPullRequest = { ...basePr, viewed_at: 1_700_000_000, viewed_head_sha: basePr.head_sha }
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff], [viewedPr])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    await screen.findByText('Fix authentication middleware')
    await waitFor(() => expect(get(reviewPrs)[0]?.viewed_at).toBe(1_700_000_000))

    await fireEvent.click(await screen.findByRole('button', { name: 'Mark as unread' }))

    await waitFor(() => {
      const stored = get(reviewPrs).find((pr) => pr.id === viewedPr.id)
      expect(stored?.viewed_at).toBeNull()
      expect(stored?.viewed_head_sha).toBeNull()
    })
  })
})

describe('PrReviewView view re-invocation', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('returns to the PR list when its own view is re-invoked (rail icon / Cmd+G)', async () => {
    const REPO_VIEW_ID = 'plugin:com.openforge.github-sync:pr_review'
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1', viewId: REPO_VIEW_ID })
    registerPrReviewBackends(registry, () => [baseDiff])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    await waitFor(() => expect(get(selectedReviewPr)?.id).toBe(basePr.id))

    await registry.frontendApi.events.emitGlobal('openforge.view-invoked', { view: REPO_VIEW_ID })

    await waitFor(() => expect(get(selectedReviewPr)).toBeNull())
    await screen.findByText('Fix authentication middleware')
  })

  it('ignores view-invoked events for a different view (e.g. the sibling all-repos PR view)', async () => {
    const REPO_VIEW_ID = 'plugin:com.openforge.github-sync:pr_review'
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1', viewId: REPO_VIEW_ID })
    registerPrReviewBackends(registry, () => [baseDiff])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    await waitFor(() => expect(get(selectedReviewPr)?.id).toBe(basePr.id))

    await registry.frontendApi.events.emitGlobal('openforge.view-invoked', { view: GLOBAL_VIEW_ID })
    await registry.frontendApi.events.emitGlobal('openforge.view-invoked', { view: 'settings' })

    await Promise.resolve()
    expect(get(selectedReviewPr)?.id).toBe(basePr.id)
  })
})

describe('PrReviewView tab shortcuts', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('switches PR detail tabs with Cmd+1 / Cmd+2 / Cmd+3', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    // Enter detail mode (defaults to the Overview tab).
    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    expect((await screen.findByRole('tab', { name: 'Overview' })).getAttribute('aria-selected')).toBe('true')

    // Cmd+2 → Files changed
    await fireEvent.keyDown(window, { key: '2', metaKey: true })
    expect(screen.getByRole('tab', { name: /Files changed/i }).getAttribute('aria-selected')).toBe('true')

    // Cmd+1 → Overview
    await fireEvent.keyDown(window, { key: '1', metaKey: true })
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')

    // Cmd+3 targets the Walkthrough tab, but with no ready walkthrough that tab is
    // hidden, so the view falls back to Overview instead of stranding on a hidden tab.
    await fireEvent.keyDown(window, { key: '3', metaKey: true })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('tab', { name: /Files changed/i }).getAttribute('aria-selected')).toBe('false')
  })

  it('does not switch tabs on bare 1 / 2 / 3 (Cmd is required)', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    expect((await screen.findByRole('tab', { name: 'Overview' })).getAttribute('aria-selected')).toBe('true')

    await fireEvent.keyDown(window, { key: '2' })
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Files changed/i }).getAttribute('aria-selected')).toBe('false')
  })
})

describe('PrReviewView reviewed files', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('marks a pull request file reviewed from the diff header while keeping the file tree row in place', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff])

    const checkbox = await openFilesTab(registry)
    expect(checkbox.checked).toBe(false)

    await fireEvent.click(checkbox)

    await waitFor(() => {
      const checked = requireElement(screen.getByLabelText('Mark src/main.rs reviewed'), HTMLInputElement)
      expect(checked.checked).toBe(true)
      expect(screen.getByLabelText('Reviewed file src/main.rs')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Reviewed files (1)' })).toBeNull()
      expect(screen.queryByText('1 reviewed hidden')).toBeNull()
    })
  })

  it('renders changed screenshot files by fetching base64 content for image previews', async () => {
    const imageDiff: PrFileDiff = {
      ...baseDiff,
      sha: 'new-image-sha',
      filename: 'assets/screenshot.png',
      status: 'modified',
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: null,
    }
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [imageDiff])
    const getFileContentBase64 = vi.fn().mockResolvedValue({ content: 'new-image-base64', size: 16, tooLarge: false })
    const getFileAtRefBase64 = vi.fn().mockResolvedValue({ content: 'old-image-base64', size: 16, tooLarge: false })
    registry.backendApi.backend.registerMethod('getFileContentBase64', { handler: getFileContentBase64 })
    registry.backendApi.backend.registerMethod('getFileAtRefBase64', { handler: getFileAtRefBase64 })

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))

    const newPreview = requireElement(await screen.findByRole('img', { name: 'assets/screenshot.png new preview' }), HTMLImageElement)
    const oldPreview = requireElement(await screen.findByRole('img', { name: 'assets/screenshot.png old preview' }), HTMLImageElement)

    expect(newPreview.getAttribute('src')).toBe('data:image/png;base64,new-image-base64')
    expect(oldPreview.getAttribute('src')).toBe('data:image/png;base64,old-image-base64')
    expect(getFileContentBase64).toHaveBeenCalledWith({ owner: 'acme', repo: 'repo', sha: 'new-image-sha' })
    expect(getFileAtRefBase64).toHaveBeenCalledWith({ owner: 'acme', repo: 'repo', path: 'assets/screenshot.png', refSha: 'main' })
  })

  it('uses native controls for GitHub video revisions', async () => {
    const videoDiff: PrFileDiff = {
      ...baseDiff,
      sha: 'new-video-sha',
      filename: 'assets/demo.mp4',
      status: 'modified',
      additions: 0,
      deletions: 0,
      changes: 1,
      patch: null,
    }
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [videoDiff])
    const getFileContentBase64 = vi.fn().mockResolvedValue({ content: 'new-video-base64', size: 16, tooLarge: false })
    const getFileAtRefBase64 = vi.fn().mockResolvedValue({ content: 'old-video-base64', size: 16, tooLarge: false })
    registry.backendApi.backend.registerMethod('getFileContentBase64', { handler: getFileContentBase64 })
    registry.backendApi.backend.registerMethod('getFileAtRefBase64', { handler: getFileAtRefBase64 })

    renderPrReviewView(registry)
    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))

    const video = await screen.findByLabelText('assets/demo.mp4 new preview') as HTMLVideoElement

    expect(screen.queryByRole('button', { name: 'Open assets/demo.mp4 after preview' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Media preview' })).toBeNull()
    expect(video.controls).toBe(true)
    expect(video.autoplay).toBe(false)
    expect(getFileContentBase64).toHaveBeenCalledWith({
      owner: 'acme', repo: 'repo', sha: 'new-video-sha', maxSize: 25 * 1024 * 1024,
    })
    expect(getFileAtRefBase64).toHaveBeenCalledWith({
      owner: 'acme', repo: 'repo', path: 'assets/demo.mp4', refSha: 'main', maxSize: 25 * 1024 * 1024,
    })
  })

  it('does not prune a selected pull request reviewed files against stale diffs from the previous PR', async () => {
    let resolveSecondDiffs: (files: PrFileDiff[]) => void = () => {}
    const secondDiffs = new Promise<PrFileDiff[]>((resolve) => {
      resolveSecondDiffs = resolve
    })
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(
      registry,
      ({ prNumber }) => prNumber === basePr.number ? [baseDiff] : secondDiffs,
      [basePr, secondPr],
    )

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    await registry.frontendApi.storage.project('project-1').set('githubSync.prReview.reviewedFiles.v1', {
      'acme/repo#43': [[secondDiff.filename, secondDiff.sha]],
    })

    const firstTitle = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(firstTitle.closest('button'), HTMLButtonElement))
    await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))
    await screen.findByLabelText('Mark src/main.rs reviewed')

    selectedReviewPr.set(null)
    await screen.findByText('Add checkout flow')

    await fireEvent.click(requireElement(screen.getByText('Add checkout flow').closest('button'), HTMLButtonElement))

    await waitFor(async () => {
      await expect(registry.frontendApi.storage.project('project-1').get('githubSync.prReview.reviewedFiles.v1')).resolves.toEqual({
        'acme/repo#43': [[secondDiff.filename, secondDiff.sha]],
      })
    })

    resolveSecondDiffs([secondDiff])

    await waitFor(() => {
      expect(requireElement(screen.getByLabelText('Mark src/checkout.ts reviewed'), HTMLInputElement).checked).toBe(true)
    })
  })

  it('remembers pull request reviewed files across remounts until their file identity changes', async () => {
    let currentDiff = baseDiff
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [currentDiff])

    const firstRender = render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })
    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))
    await fireEvent.click(await screen.findByLabelText('Mark src/main.rs reviewed'))
    await waitFor(() => {
      expect(requireElement(screen.getByLabelText('Mark src/main.rs reviewed'), HTMLInputElement).checked).toBe(true)
      expect(registry.calls.storageSets.length).toBeGreaterThan(0)
    })
    firstRender.unmount()
    resetStores()

    await openFilesTab(registry)
    await waitFor(() => {
      expect(requireElement(screen.getByLabelText('Mark src/main.rs reviewed'), HTMLInputElement).checked).toBe(true)
      expect(screen.getByLabelText('Reviewed file src/main.rs')).toBeTruthy()
    })

    cleanup()
    currentDiff = { ...baseDiff, sha: 'file-sha-two' }
    resetStores()
    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })
    const changedTitle = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(changedTitle.closest('button'), HTMLButtonElement))
    await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))

    await waitFor(() => {
      const changedCheckbox = requireElement(screen.getByLabelText('Mark src/main.rs reviewed'), HTMLInputElement)
      expect(changedCheckbox.checked).toBe(false)
      expect(screen.queryByLabelText('Reviewed file src/main.rs')).toBeNull()
    })
  })
})

describe('PrReviewView empty and recovery states', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('explains that GitHub is not connected instead of presenting a true-zero review state', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [], [])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    expect(await screen.findByText('Connect GitHub to check review requests')).toBeTruthy()
    expect(screen.getAllByText(/No GitHub token is configured/).length).toBeGreaterThan(0)
    expect(screen.queryByText("You're all caught up!")).toBeNull()

    await fireEvent.click(screen.getAllByRole('button', { name: 'Open GitHub settings' })[0])
    expect(registry.calls.navigationRequests).toContainEqual({ viewId: 'global_settings' })
  })

  it('keeps true-zero review requests distinct when GitHub is connected', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    await registry.frontendApi.config.set('github_token', 'ghp_test')
    registerPrReviewBackends(registry, () => [], [])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    expect(await screen.findByText('No PRs requesting your review')).toBeTruthy()
    expect(screen.getByText(/GitHub is connected for Demo Project/)).toBeTruthy()
    expect(screen.queryByText('Connect GitHub to check review requests')).toBeNull()
  })

  it('labels repository filter controls and exposes dropdown expanded state', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1', viewId: GLOBAL_VIEW_ID })
    await registry.frontendApi.config.set('github_token', 'ghp_test')
    registerPrReviewBackends(registry, () => [], [])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    const filterButton = await screen.findByRole('button', { name: 'Filter repositories' })
    expect(filterButton.getAttribute('aria-expanded')).toBe('false')

    await fireEvent.click(filterButton)

    expect(screen.getByRole('button', { name: 'Filter repositories' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('textbox', { name: 'Repository to exclude' })).toBeTruthy()
  })

  it('explains when repository filters hide every review request', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1', viewId: GLOBAL_VIEW_ID })
    await registry.frontendApi.config.set('github_token', 'ghp_test')
    await registry.frontendApi.config.set('pr_excluded_repos', JSON.stringify(['acme/repo']))
    registerPrReviewBackends(registry, () => [baseDiff], [basePr])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    expect(await screen.findByText('All review requests are hidden by filters')).toBeTruthy()
    expect(screen.getByText(/1 PR from acme\/repo is currently unchecked/)).toBeTruthy()

    await fireEvent.click(screen.getAllByRole('button', { name: 'Review repository filters' })[0])
    expect(screen.getByText('Excluded Repositories')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove acme/repo from excluded repositories' })).toBeTruthy()
  })

  it('shows a sync recovery path when review requests cannot be loaded', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    await registry.frontendApi.config.set('github_token', 'ghp_test')
    await registry.frontendApi.projectConfig.set('resolved_repo', `${basePr.repo_owner}/${basePr.repo_name}`, 'project-1')
    const backend = registry.backendApi.backend
    backend.registerMethod('getReviewPrs', { handler: async () => { throw new Error('GitHub API unavailable') } })
    backend.registerMethod('fetchReviewPrs', { handler: async () => [] })
    backend.registerMethod('getAuthoredPrs', { handler: async () => [] })
    backend.registerMethod('fetchAuthoredPrs', { handler: async () => [] })
    backend.registerMethod('forceGithubSync', { handler: async () => ({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
    }) })

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    expect(await screen.findByText('Unable to load review requests')).toBeTruthy()
    expect(screen.getByText(/GitHub API unavailable/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading review requests' }))
    await waitFor(() => expect(screen.getByText('No PRs requesting your review')).toBeTruthy())
  })
})

const baseAuthoredPr: AuthoredPullRequest = {
  id: 900,
  number: 900,
  title: 'Authored PR',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/900',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'feature',
  base_ref: 'main',
  head_sha: 'authored-head-sha',
  additions: 1,
  deletions: 1,
  changed_files: 1,
  ci_status: 'success',
  ci_check_runs: null,
  review_status: 'review_required',
  mergeable: true,
  mergeable_state: 'clean',
  merged_at: null,
  is_queued: false,
  task_id: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  labels: [],
}

/** Titles of the cards rendered under the "My Pull Requests" heading, in display order. */
function authoredColumnHeadings(): string[] {
  const headings = [...document.querySelectorAll('h3')].map((h) => h.textContent?.trim() ?? '')
  const start = headings.indexOf('My Pull Requests')
  return start === -1 ? [] : headings.slice(start + 1)
}

describe('PrReviewView authored PR ordering', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('leads each repo section with PRs needing attention and trails it with drafts', async () => {
    // Seeded in an order that only the attention ranking can produce the expectation from:
    // the healthy draft arrives first and the conflicted PR last.
    const authored: AuthoredPullRequest[] = [
      { ...baseAuthoredPr, id: 1, number: 1, title: 'Plain draft', draft: true },
      { ...baseAuthoredPr, id: 2, number: 2, title: 'Healthy PR' },
      { ...baseAuthoredPr, id: 3, number: 3, title: 'Draft with failing checks', draft: true, ci_status: 'failure' },
      { ...baseAuthoredPr, id: 4, number: 4, title: 'Conflicted PR', mergeable: false, mergeable_state: 'dirty' },
    ]

    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    await registry.frontendApi.config.set('github_token', 'ghp_test')
    await registry.frontendApi.projectConfig.set('resolved_repo', 'acme/repo')
    const backend = registry.backendApi.backend
    backend.registerMethod('getReviewPrs', { handler: async () => [] })
    backend.registerMethod('fetchReviewPrs', { handler: async () => [] })
    backend.registerMethod('getAuthoredPrs', { handler: async () => authored })
    backend.registerMethod('fetchAuthoredPrs', { handler: async () => authored })

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    await screen.findByText('Conflicted PR')
    expect(authoredColumnHeadings()).toEqual([
      'acme/repo',
      'Conflicted PR',
      'Healthy PR',
      'Draft with failing checks',
      'Plain draft',
    ])
  })

  it('does not sink a DO NOT REVIEW labelled PR in the authored column', async () => {
    const authored: AuthoredPullRequest[] = [
      {
        ...baseAuthoredPr,
        id: 1,
        number: 1,
        title: 'Labelled but active',
        labels: [{ name: 'DO NOT REVIEW', color: 'b60205' }],
      },
      { ...baseAuthoredPr, id: 2, number: 2, title: 'Unlabelled draft', draft: true },
    ]

    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    await registry.frontendApi.config.set('github_token', 'ghp_test')
    await registry.frontendApi.projectConfig.set('resolved_repo', 'acme/repo')
    const backend = registry.backendApi.backend
    backend.registerMethod('getReviewPrs', { handler: async () => [] })
    backend.registerMethod('fetchReviewPrs', { handler: async () => [] })
    backend.registerMethod('getAuthoredPrs', { handler: async () => authored })
    backend.registerMethod('fetchAuthoredPrs', { handler: async () => authored })

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    await screen.findByText('Labelled but active')
    expect(authoredColumnHeadings()).toEqual(['acme/repo', 'Labelled but active', 'Unlabelled draft'])
  })
})

describe('PrReviewView start task from authored PR', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  async function renderAuthoredList(
    registry: TestingOpenForgeRegistryFake,
    authored: AuthoredPullRequest[],
    projectId: string | null = 'project-1',
  ) {
    await registry.frontendApi.config.set('github_token', 'ghp_test')
    await registry.frontendApi.projectConfig.set('resolved_repo', 'acme/repo')
    const backend = registry.backendApi.backend
    backend.registerMethod('getReviewPrs', { handler: async () => [] })
    backend.registerMethod('fetchReviewPrs', { handler: async () => [] })
    backend.registerMethod('getAuthoredPrs', { handler: async () => authored })
    backend.registerMethod('fetchAuthoredPrs', { handler: async () => authored })

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId,
      },
    })

    await screen.findByText(authored[0].title)
  }

  it('opens the create-task dialog on the pull request branch', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    await renderAuthoredList(registry, [baseAuthoredPr])

    await fireEvent.click(screen.getByRole('button', { name: 'Start a task from this branch for pull request #900' }))

    expect(registry.frontendApi.__testing.calls.taskComposes).toEqual([{
      projectId: 'project-1',
      initialPrompt: 'Continue work on PR #900: Authored PR',
      title: 'Authored PR',
      sourceTicketUrl: 'https://github.com/acme/repo/pull/900',
      worktreeSource: 'existingBranch',
      worktreeBranch: 'feature',
    }])
    expect(registry.frontendApi.__testing.calls.openUrl).toEqual([])
  })

  it('still opens the pull request in the browser when the card is clicked', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    await renderAuthoredList(registry, [baseAuthoredPr])

    await fireEvent.click(screen.getByText('Authored PR'))

    expect(registry.frontendApi.__testing.calls.openUrl).toEqual([baseAuthoredPr.html_url])
    expect(registry.frontendApi.__testing.calls.taskComposes).toEqual([])
  })

  it('hides the start-task control when no project is selected', async () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'com.openforge.github-sync',
      projectId: null,
      viewId: GLOBAL_VIEW_ID,
    })
    await renderAuthoredList(registry, [baseAuthoredPr], null)

    expect(screen.queryByRole('button', { name: 'Start a task from this branch for pull request #900' })).toBeNull()
  })
})

describe('PrReviewView submit review', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('treats a rejected submit as successful when GitHub already has the submitted inline comments', async () => {
    const submittedComment: ReviewSubmissionComment = {
      path: baseDiff.filename,
      line: 2,
      side: 'RIGHT',
      body: 'This was accepted by GitHub before the transport failed',
    }
    const postedComment: ReviewComment = {
      id: 987,
      pr_number: basePr.number,
      repo_owner: basePr.repo_owner,
      repo_name: basePr.repo_name,
      path: submittedComment.path,
      line: submittedComment.line,
      side: submittedComment.side,
      body: submittedComment.body,
      author: 'koenvangeert',
      created_at: '2026-06-11T14:00:00Z',
      in_reply_to_id: null,
    }
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    let reviewCommentResults: ReviewComment[] = []
    const submitPrReview = vi.fn(async () => {
      reviewCommentResults = [postedComment]
      throw new Error('timed out waiting for plugin backend response')
    })
    registerPrReviewBackends(registry, () => [baseDiff], [basePr], () => reviewCommentResults, submitPrReview)

    await openFilesTab(registry)
    pendingManualComments.set([submittedComment])
    await screen.findByText('1 comment will be submitted')
    await fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))

    await waitFor(() => {
      expect(submitPrReview).toHaveBeenCalledOnce()
      expect(get(pendingManualComments)).toEqual([])
      expect(screen.queryByText('Failed to submit review. Please try again.')).toBeNull()
    })
  })

  it('does not treat a rejected submit as successful when the matching inline comment already existed', async () => {
    const submittedComment: ReviewSubmissionComment = {
      path: baseDiff.filename,
      line: 2,
      side: 'RIGHT',
      body: 'This comment was already on GitHub before submit',
    }
    const existingComment: ReviewComment = {
      id: 654,
      pr_number: basePr.number,
      repo_owner: basePr.repo_owner,
      repo_name: basePr.repo_name,
      path: submittedComment.path,
      line: submittedComment.line,
      side: submittedComment.side,
      body: submittedComment.body,
      author: 'koenvangeert',
      created_at: '2026-06-11T13:55:00Z',
      in_reply_to_id: null,
    }
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    const submitPrReview = vi.fn(async () => {
      throw new Error('connection closed before response')
    })
    registerPrReviewBackends(registry, () => [baseDiff], [basePr], [existingComment], submitPrReview)

    await openFilesTab(registry)
    await waitFor(() => {
      expect(get(reviewComments)).toEqual([existingComment])
    })
    pendingManualComments.set([submittedComment])
    await screen.findByText('1 comment will be submitted')
    await fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))

    await waitFor(() => {
      expect(submitPrReview).toHaveBeenCalledOnce()
      expect(get(pendingManualComments)).toEqual([submittedComment])
      expect(screen.getByText('Failed to submit review. Please try again.')).toBeTruthy()
    })
  })
})

function renderPrReviewView(registry: TestingOpenForgeRegistryFake) {
  return render(PrReviewView, {
    props: {
      api: registry.frontendApi,
      context: registry.frontendApi.context.getSnapshot(),
      projectName: 'Demo Project',
      projectId: 'project-1',
    },
  })
}

describe('PrReviewView repository filter scope', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('hides the repository filter control in the repo-scoped view', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff])

    renderPrReviewView(registry)

    await screen.findByText('Fix authentication middleware')
    expect(screen.queryByRole('button', { name: /filter repositories/i })).toBeNull()
  })

  it('shows the repository filter control in the all-repos view', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1', viewId: GLOBAL_VIEW_ID })
    registerPrReviewBackends(registry, () => [baseDiff])

    renderPrReviewView(registry)

    await screen.findByText('Fix authentication middleware')
    expect(screen.getByRole('button', { name: /filter repositories/i })).toBeTruthy()
  })

  it('ignores excluded-repo filters in the repo-scoped view', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    await registry.frontendApi.config.set('pr_excluded_repos', JSON.stringify([`${basePr.repo_owner}/${basePr.repo_name}`]))
    registerPrReviewBackends(registry, () => [baseDiff])

    renderPrReviewView(registry)

    // The PR's repo is on the exclusion list, but exclusions don't apply to the
    // single-repo view, so the PR is still listed.
    expect(await screen.findByText('Fix authentication middleware')).toBeTruthy()
  })

  it('applies excluded-repo filters in the all-repos view', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1', viewId: GLOBAL_VIEW_ID })
    await registry.frontendApi.config.set('pr_excluded_repos', JSON.stringify([`${basePr.repo_owner}/${basePr.repo_name}`]))
    registerPrReviewBackends(registry, () => [baseDiff])

    renderPrReviewView(registry)

    // In the all-repos view the exclusion hides the PR behind the filtered state.
    await screen.findByText(/hidden by filters/i)
    expect(screen.queryByText('Fix authentication middleware')).toBeNull()
  })
})

describe('PrReviewView non-application file filter', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  const docDiff: PrFileDiff = { ...baseDiff, sha: 'doc-sha', filename: 'README.md' }
  const mdxDiff: PrFileDiff = { ...baseDiff, sha: 'mdx-sha', filename: 'docs/guide.mdx' }

  it('shows every file by default and hides non-application files when the toggle is deselected', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff, docDiff])

    await openFilesTab(registry)

    // Both files are shown by default; the file-tree toggle is selected.
    expect(screen.getByLabelText('Mark src/main.rs reviewed')).toBeTruthy()
    expect(screen.getByLabelText('Mark README.md reviewed')).toBeTruthy()

    const toggle = requireElement(
      screen.getByRole('checkbox', { name: /Also include non-application files/i }),
      HTMLInputElement,
    )
    expect(toggle.checked).toBe(true)

    await fireEvent.click(toggle)

    await waitFor(() => {
      expect(screen.queryByLabelText('Mark README.md reviewed')).toBeNull()
    })
    expect(screen.getByText('(1 hidden)')).toBeTruthy()
  })

  it('resets to showing all files when a different PR is opened', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(
      registry,
      ({ prNumber }) => prNumber === basePr.number ? [baseDiff, docDiff] : [secondDiff, docDiff],
      [basePr, secondPr],
    )

    // Open the first PR and deselect the toggle to hide the non-application file.
    await openFilesTab(registry)
    await fireEvent.click(requireElement(
      screen.getByRole('checkbox', { name: /Also include non-application files/i }),
      HTMLInputElement,
    ))
    await waitFor(() => {
      expect(screen.queryByLabelText('Mark README.md reviewed')).toBeNull()
    })

    // Switch to the second PR — the same component instance is reused.
    selectedReviewPr.set(null)
    await fireEvent.click(requireElement((await screen.findByText('Add checkout flow')).closest('button'), HTMLButtonElement))
    await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))
    await screen.findByLabelText('Mark src/checkout.ts reviewed')

    // The filter is back to showing everything, including the non-application file.
    expect(screen.getByLabelText('Mark README.md reviewed')).toBeTruthy()
    expect(requireElement(
      screen.getByRole('checkbox', { name: /Also include non-application files/i }),
      HTMLInputElement,
    ).checked).toBe(true)
  })

  it('keeps the sidebar toggle reachable after deselecting hides every file', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [docDiff, mdxDiff])

    render(PrReviewView, {
      props: {
        api: registry.frontendApi,
        context: registry.frontendApi.context.getSnapshot(),
        projectName: 'Demo Project',
        projectId: 'project-1',
      },
    })

    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))

    // Both non-application files show by default.
    await screen.findByLabelText('Mark README.md reviewed')

    // Deselecting hides everything, but the sidebar toggle stays present so the reviewer
    // can bring the files back.
    await fireEvent.click(requireElement(
      screen.getByRole('checkbox', { name: /Also include non-application files/i }),
      HTMLInputElement,
    ))
    await waitFor(() => {
      expect(screen.queryByLabelText('Mark README.md reviewed')).toBeNull()
    })

    const toggleAfter = requireElement(
      screen.getByRole('checkbox', { name: /Also include non-application files/i }),
      HTMLInputElement,
    )
    expect(toggleAfter.checked).toBe(false)

    await fireEvent.click(toggleAfter)
    await waitFor(() => {
      expect(screen.getByLabelText('Mark README.md reviewed')).toBeTruthy()
    })
  })
})

describe('PrReviewView walkthrough generation', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('starts a background generation from the card without opening or marking the PR read', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff], [basePr])

    renderPrReviewView(registry)

    await screen.findByText('Fix authentication middleware')
    await fireEvent.click(await screen.findByRole('button', { name: 'Generate walkthrough and AI review' }))

    await waitFor(() =>
      expect(registry.calls.backendInvocations.some((c) => c.method === 'startAgentWalkthrough')).toBe(true),
    )

    const call = registry.calls.backendInvocations.find((c) => c.method === 'startAgentWalkthrough')
    expect(call?.payload).toMatchObject({
      repoOwner: 'acme',
      repoName: 'repo',
      prNumber: 42,
      headRef: 'fix/auth',
      baseRef: 'main',
      headSha: 'head-sha',
      reviewPrId: 12345,
    })
    // Plan 2 compiles the combined prompt server-side, so the caller sends none.
    expect((call?.payload as Record<string, unknown>).prompt).toBeUndefined()

    // Generation is a background action: the PR stays on the list and unread.
    expect(get(selectedReviewPr)).toBeNull()
    expect(registry.calls.backendInvocations.some((c) => c.method === 'markReviewPrViewed')).toBe(false)
  })

  it('stops an in-flight generation from the card, aborting and clearing it', async () => {
    const generating: PrWalkthrough = {
      pr_id: basePr.id,
      head_sha: basePr.head_sha,
      walkthrough_session_key: 'session-key',
      status: 'generating',
      steps_json: null,
      error_message: null,
      created_at: 0,
      updated_at: 0,
    }
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff], [basePr], [], async () => undefined, '', () => generating)

    renderPrReviewView(registry)

    await screen.findByText('Fix authentication middleware')
    await fireEvent.click(await screen.findByRole('button', { name: 'Stop walkthrough generation' }))

    await waitFor(() =>
      expect(registry.calls.backendInvocations.some((c) => c.method === 'abortAgentWalkthrough')).toBe(true),
    )
    const abortCall = registry.calls.backendInvocations.find((c) => c.method === 'abortAgentWalkthrough')
    expect(abortCall?.payload).toMatchObject({ walkthroughSessionKey: 'session-key' })
    expect(registry.calls.backendInvocations.some((c) => c.method === 'deletePrWalkthrough')).toBe(true)
  })

  it('reveals the Walkthrough tab only for a PR whose walkthrough is ready for the current head sha', async () => {
    const readyWalkthrough: PrWalkthrough = {
      pr_id: basePr.id,
      head_sha: basePr.head_sha,
      walkthrough_session_key: 'k',
      status: 'ready',
      steps_json: JSON.stringify({
        steps: [{ id: 's1', title: 'Step one', summary: 'x', files: [{ filename: 'src/main.rs', hunk_indexes: null }] }],
      }),
      error_message: null,
      created_at: 0,
      updated_at: 0,
    }
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff], [basePr], [], async () => undefined, '', () => readyWalkthrough)

    renderPrReviewView(registry)

    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))

    // The tab appears once the open PR's status resolves to ready.
    expect(await screen.findByRole('tab', { name: 'Walkthrough' })).toBeTruthy()
  })

  it('does not initialize an inactive walkthrough tab', async () => {
    const readyWalkthrough: PrWalkthrough = {
      pr_id: basePr.id,
      head_sha: basePr.head_sha,
      walkthrough_session_key: 'k',
      status: 'ready',
      steps_json: JSON.stringify({ steps: [] }),
      error_message: null,
      created_at: 0,
      updated_at: 0,
    }
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff], [basePr], [], async () => undefined, '', () => readyWalkthrough)

    renderPrReviewView(registry)

    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    const walkthroughTab = await screen.findByRole('tab', { name: 'Walkthrough' })

    expect(registry.calls.backendInvocations.some((call) => call.method === 'getPrTicket')).toBe(false)

    await fireEvent.click(walkthroughTab)
    await waitFor(() =>
      expect(registry.calls.backendInvocations.some((call) => call.method === 'getPrTicket')).toBe(true),
    )
  })

  it('hides the Walkthrough tab when the open PR has no ready walkthrough', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff], [basePr])

    renderPrReviewView(registry)

    const title = await screen.findByText('Fix authentication middleware')
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    await screen.findByRole('tab', { name: 'Overview' })

    expect(screen.queryByRole('tab', { name: 'Walkthrough' })).toBeNull()
  })
})

describe('PrReviewView header title', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('titles the repo-scoped view with the active project name', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    registerPrReviewBackends(registry, () => [baseDiff])

    renderPrReviewView(registry)

    expect(await screen.findByText('Demo Project — Pull Requests')).toBeTruthy()
  })

  it('titles the all-repos view independently of the active project', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1', viewId: GLOBAL_VIEW_ID })
    registerPrReviewBackends(registry, () => [baseDiff])

    renderPrReviewView(registry)

    expect(await screen.findByText('All Pull Requests')).toBeTruthy()
    expect(screen.queryByText('Demo Project — Pull Requests')).toBeNull()
  })
})

describe('PrReviewView Overview images', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('shows PR body uploads through a signed URL from the sidecar', async () => {
    const uploadUrl = 'https://github.com/user-attachments/assets/971f5efc-5e71-4d11-a2b5-daecad5323f3'
    const signedUrl = 'https://private-user-images.githubusercontent.com/1/shot.png?jwt=signed'
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    const prWithUpload: ReviewPullRequest = { ...basePr, body: `![image](${uploadUrl})` }
    registerPrReviewBackends(registry, () => [baseDiff], [prWithUpload])
    const resolveGithubAsset = vi.fn().mockResolvedValue({ url: signedUrl, kind: 'image' })
    registry.backendApi.backend.registerMethod('resolveGithubAsset', { handler: resolveGithubAsset })

    renderPrReviewView(registry)
    const title = await screen.findByText(prWithUpload.title)
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'image' }).getAttribute('src')).toBe(signedUrl)
    })
    expect(resolveGithubAsset).toHaveBeenCalledWith({
      owner: basePr.repo_owner,
      repo: basePr.repo_name,
      url: uploadUrl,
    })
  })

  it('plays an uploaded screen recording linked in the PR body', async () => {
    const uploadUrl = 'https://github.com/user-attachments/assets/a1ffcc8c-9060-458f-b61b-8f70a26ea646'
    const signedUrl = 'https://private-user-images.githubusercontent.com/1/clip.mp4?jwt=signed'
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    const prWithRecording: ReviewPullRequest = { ...basePr, body: `Recorded it:\n\n${uploadUrl}` }
    registerPrReviewBackends(registry, () => [baseDiff], [prWithRecording])
    registry.backendApi.backend.registerMethod('resolveGithubAsset', {
      handler: async () => ({ url: signedUrl, kind: 'video' }),
    })

    const { container } = renderPrReviewView(registry)
    const title = await screen.findByText(prWithRecording.title)
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))

    await waitFor(() => {
      expect(container.querySelector('video')?.getAttribute('src')).toBe(signedUrl)
    })
  })

  it('leaves images the sidecar cannot resolve on their original URL', async () => {
    const badgeUrl = 'https://img.shields.io/badge.svg'
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    const prWithBadge: ReviewPullRequest = { ...basePr, body: `![Badge](${badgeUrl})` }
    registerPrReviewBackends(registry, () => [baseDiff], [prWithBadge])
    const resolveGithubAsset = vi.fn().mockResolvedValue(null)
    registry.backendApi.backend.registerMethod('resolveGithubAsset', { handler: resolveGithubAsset })

    renderPrReviewView(registry)
    const title = await screen.findByText(prWithBadge.title)
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Badge' }).getAttribute('src')).toBe(badgeUrl)
    })
    expect(resolveGithubAsset).not.toHaveBeenCalled()
  })
})

describe('PrReviewView Rich Diff repository paths', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('resolves nested Markdown images and links at the pull request head', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync', projectId: 'project-1' })
    const markdownFile: PrFileDiff = { ...baseDiff, filename: 'docs/guides/README.md', sha: 'markdown-sha' }
    registerPrReviewBackends(
      registry,
      () => [markdownFile],
      [basePr],
      [],
      async () => undefined,
      '![Diagram](../assets/diagram.png)\n\n[Setup](../SETUP.md#installation)',
    )
    const getFileAtRefBase64 = vi.fn().mockResolvedValue({ content: 'base64-diagram', size: 14, tooLarge: false })
    registry.backendApi.backend.registerMethod('getFileAtRefBase64', { handler: getFileAtRefBase64 })

    renderPrReviewView(registry)
    const title = await screen.findByText(basePr.title)
    await fireEvent.click(requireElement(title.closest('button'), HTMLButtonElement))
    await fireEvent.click(await screen.findByRole('tab', { name: /Files changed/i }))
    await fireEvent.click(await screen.findByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }))

    await waitFor(() => {
      expect(screen.getByAltText('Diagram').getAttribute('src'))
        .toBe('data:image/png;base64,base64-diagram')
    })
    expect(getFileAtRefBase64).toHaveBeenCalledWith({
      owner: basePr.repo_owner,
      repo: basePr.repo_name,
      path: 'docs/assets/diagram.png',
      refSha: basePr.head_sha,
    })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(registry.frontendApi.__testing.calls.openUrl)
      .toContain(`https://github.com/acme/repo/blob/${basePr.head_sha}/docs/SETUP.md#installation`)
  })
})
