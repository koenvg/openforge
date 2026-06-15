import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff, ReviewPullRequest } from '@openforge/plugin-sdk/domain'
import { createOpenForgeRegistryFake } from '@openforge/plugin-sdk/testing'
import type { TestingOpenForgeRegistryFake } from '@openforge/plugin-sdk/testing'
import { requireElement } from '../../../../../src/test-utils/dom'

vi.mock('@openforge/pr-review-ui/useVirtualizer.svelte', () => ({
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

vi.mock('@openforge/pr-review-ui/useDiffWorker.svelte', () => ({
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
  prFileDiffs: writable([]),
  reviewRequestCount: writable(0),
  authoredPrCount: writable(0),
  reviewComments: writable([]),
  pendingManualComments: writable([]),
  prOverviewComments: writable([]),
  agentReviewComments: writable([]),
}))

import PrReviewView from './PrReviewView.svelte'
import {
  activeProjectId,
  agentReviewComments,
  authoredPrCount,
  authoredPrs,
  pendingManualComments,
  prFileDiffs,
  prOverviewComments,
  reviewComments,
  reviewPrs,
  reviewRequestCount,
  selectedReviewPr,
} from '../../lib/stores'

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
  prFileDiffs.set([])
  reviewRequestCount.set(0)
  authoredPrCount.set(0)
  reviewComments.set([])
  pendingManualComments.set([])
  prOverviewComments.set([])
  agentReviewComments.set([])
}

function registerPrReviewBackends(
  registry: TestingOpenForgeRegistryFake,
  getDiffs: (request: { prNumber: number }) => PrFileDiff[] | Promise<PrFileDiff[]>,
  prs: ReviewPullRequest[] = [basePr],
) {
  const backend = registry.backendApi.backend
  backend.registerMethod('getReviewPrs', { handler: async () => prs })
  backend.registerMethod('fetchReviewPrs', { handler: async () => prs })
  backend.registerMethod('getAuthoredPrs', { handler: async () => [] })
  backend.registerMethod('fetchAuthoredPrs', { handler: async () => [] })
  backend.registerMethod('markReviewPrViewed', { handler: async () => undefined })
  backend.registerMethod('getPrFileDiffs', { handler: async (payload) => getDiffs(payload as { prNumber: number }) })
  backend.registerMethod('getReviewComments', { handler: async () => [] })
  backend.registerMethod('getPrOverviewComments', { handler: async () => [] })
  backend.registerMethod('getAgentReviewComments', { handler: async () => [] })
  backend.registerMethod('updateAgentReviewCommentStatus', { handler: async () => undefined })
  backend.registerMethod('getFileContent', { handler: async () => '' })
  backend.registerMethod('getFileAtRef', { handler: async () => '' })
  backend.registerMethod('submitPrReview', { handler: async () => undefined })
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
  await fireEvent.click(await screen.findByRole('button', { name: /Files changed/i }))
  return requireElement(await screen.findByLabelText('Mark src/main.rs reviewed'), HTMLInputElement)
}

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
    await fireEvent.click(await screen.findByRole('button', { name: /Files changed/i }))

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
    await fireEvent.click(await screen.findByRole('button', { name: /Files changed/i }))
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
    await fireEvent.click(await screen.findByRole('button', { name: /Files changed/i }))
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
    await fireEvent.click(await screen.findByRole('button', { name: /Files changed/i }))

    await waitFor(() => {
      const changedCheckbox = requireElement(screen.getByLabelText('Mark src/main.rs reviewed'), HTMLInputElement)
      expect(changedCheckbox.checked).toBe(false)
      expect(screen.queryByLabelText('Reviewed file src/main.rs')).toBeNull()
    })
  })
})
