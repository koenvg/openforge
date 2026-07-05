import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff, ReviewComment, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { TestingOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import { requireElement } from '../../../../../src/test-utils/dom'

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
  prOverviewComments: writable([]),
  agentReviewComments: writable([]),
}))

import PrReviewView from './PrReviewView.svelte'
import {
  activeProjectId,
  agentReviewComments,
  authoredPrs,
  pendingManualComments,
  pendingReviewPrOpen,
  prFileDiffs,
  prOverviewComments,
  reviewComments,
  reviewPrs,
  selectedReviewPr,
} from '../../lib/stores'

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
  prOverviewComments.set([])
  agentReviewComments.set([])
}

function registerPrReviewBackends(
  registry: TestingOpenForgeRegistryFake,
  getDiffs: (request: { prNumber: number }) => PrFileDiff[] | Promise<PrFileDiff[]>,
  prs: ReviewPullRequest[] = [basePr],
  reviewCommentResults: ReviewComment[] | (() => ReviewComment[] | Promise<ReviewComment[]>) = [],
  submitReview: () => Promise<void> = async () => undefined,
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
  backend.registerMethod('getPrFileDiffs', { handler: async (payload) => getDiffs(payload as { prNumber: number }) })
  backend.registerMethod('getReviewComments', {
    handler: async () => typeof reviewCommentResults === 'function'
      ? reviewCommentResults()
      : reviewCommentResults,
  })
  backend.registerMethod('getPrOverviewComments', { handler: async () => [] })
  backend.registerMethod('getAgentReviewComments', { handler: async () => [] })
  backend.registerMethod('updateAgentReviewCommentStatus', { handler: async () => undefined })
  backend.registerMethod('getFileContent', { handler: async () => '' })
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

    // Cmd+3 → Walkthrough (that button has no role=tab, so verify the other tabs deselect)
    await fireEvent.keyDown(window, { key: '3', metaKey: true })
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('false')
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
    const getFileContentBase64 = vi.fn().mockResolvedValue('new-image-base64')
    const getFileAtRefBase64 = vi.fn().mockResolvedValue('old-image-base64')
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
