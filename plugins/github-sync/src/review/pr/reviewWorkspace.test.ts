import { cleanup, render, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { PrFileDiff, ReviewComment, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { ReviewWorkspace } from './reviewWorkspace.svelte'
import Harness from './__fixtures__/ReviewWorkspaceHarness.svelte'

const pr: ReviewPullRequest = {
  id: 1, number: 42, title: 'Fix login', body: null, state: 'open', draft: false,
  html_url: 'https://github.com/acme/app/pull/42', user_login: 'alice', user_avatar_url: null,
  repo_owner: 'acme', repo_name: 'app', head_ref: 'fix', base_ref: 'main', head_sha: 'head',
  additions: 1, deletions: 0, changed_files: 1, mergeable: null, mergeable_state: null,
  created_at: 1, updated_at: 1, viewed_at: null, viewed_head_sha: null, labels: [],
}
const file: PrFileDiff = {
  sha: 'file-sha', filename: 'login.ts', status: 'modified', additions: 1, deletions: 0,
  changes: 1, patch: '@@ -1 +1,2 @@\n context\n+new', previous_filename: null,
  is_truncated: false, patch_line_count: null,
}
const comment: ReviewComment = {
  id: 12, pr_number: 42, repo_owner: 'acme', repo_name: 'app', path: 'login.ts', line: 2,
  side: 'RIGHT', body: 'Check this', author: 'alice', created_at: '2026-01-01', in_reply_to_id: null,
}
const readyWalkthrough = {
  pr_id: pr.id, head_sha: pr.head_sha, status: 'ready', steps_json: '{"steps":[]}',
  walkthrough_session_key: 'session-1', error_message: null, created_at: 1, updated_at: 2,
}
const workspaces: ReviewWorkspace[] = []

async function setup(scope: 'global' | 'repo' = 'global') {
  const registry = createOpenForgeRegistryFake({
    pluginId: 'com.openforge.github-sync', projectId: 'project-1',
    viewId: `plugin:com.openforge.github-sync:pr_review${scope === 'global' ? '_global' : ''}`,
  })
  await registry.frontendApi.config.set('github_token', 'test-token')
  await registry.frontendApi.projectConfig.set('resolved_repo', 'acme/app', 'project-1')
  const responses = new Map<string, unknown>(Object.entries({
    getReviewPrs: [pr], fetchReviewPrs: [{ ...pr, title: 'Updated login' }],
    getAuthoredPrs: [], fetchAuthoredPrs: [], getPrWalkthrough: null,
    markReviewPrViewed: null, markReviewPrUnviewed: null, getPrFileDiffs: [file], getReviewComments: [],
    getPrAiReviewComments: [], getAiThreads: [], saveAiThread: null, askAgentQuestions: null,
    getPrTicket: { snapshot: null, jiraConfigured: false },
    startAgentWalkthrough: { walkthrough_session_key: 'session-1' },
    deletePrWalkthrough: null, abortAgentWalkthrough: null,
    createReviewComment: null, replyToReviewComment: null, submitPrReview: null,
  }))
  const calls = new Map<string, unknown[]>()
  for (const name of responses.keys()) registry.backendApi.backend.registerMethod(name, {
    handler: async (request) => {
      calls.set(name, [...(calls.get(name) ?? []), request])
      const response = responses.get(name)
      return typeof response === 'function' ? response(request) : response
    },
  })
  let workspace!: ReviewWorkspace
  const rendered = render(Harness, { api: registry.frontendApi, onWorkspace: (value: ReviewWorkspace) => { workspace = value } })
  workspaces.push(workspace)
  await waitFor(() => expect(workspace.list.filteredReviewPrs).toHaveLength(1))
  return { workspace, registry, responses, calls, unmount: rendered.unmount }
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) workspace.detail?.onBackToList()
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('review workspace', () => {
  it('loads, filters and refreshes pull requests through the same model used by the view', async () => {
    const { workspace, registry } = await setup()
    expect(workspace.list.filteredReviewPrs[0].title).toBe('Fix login')
    await workspace.list.onAddExcludedRepo(' acme/app ')
    expect(workspace.list.filteredReviewPrs).toEqual([])
    expect(workspace.list.hiddenReviewRepos).toEqual(['acme/app'])
    expect(await registry.frontendApi.config.get('pr_excluded_repos')).toBe('["acme/app"]')
    await workspace.list.onRefreshPrs()
    await workspace.list.onRemoveExcludedRepo('acme/app')
    expect(workspace.list.filteredReviewPrs[0].title).toBe('Updated login')
  })

  it('restricts project reviews to their resolved repository, independently of global exclusions', async () => {
    const { workspace, responses } = await setup('repo')
    responses.set('fetchReviewPrs', [pr, { ...pr, id: 2, repo_name: 'other' }])
    await workspace.list.onAddExcludedRepo('acme/app')
    await workspace.list.onRefreshPrs()
    expect(workspace.list.filteredReviewPrs.map(value => value.repo_name)).toEqual(['app'])
    expect(workspace.list.showFilters).toBe(false)
  })

  it('refreshes from host events and retains the last list when a refresh fails', async () => {
    const { workspace, responses, registry } = await setup()
    responses.set('getReviewPrs', [{ ...pr, title: 'Changed by sync' }])
    await registry.frontendApi.events.emitGlobal('openforge.review-pr-count-changed', {})
    await waitFor(() => expect(workspace.list.filteredReviewPrs[0].title).toBe('Changed by sync'))
    responses.set('fetchReviewPrs', () => { throw new Error('offline') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await workspace.list.onRefreshPrs()
    expect(workspace.list.error).toContain('offline')
    expect(workspace.list.isLoading).toBe(false)
    expect(workspace.list.filteredReviewPrs[0].title).toBe('Changed by sync')
  })

  it('marks selection viewed and ignores a previous selection completing late', async () => {
    const { workspace, responses, calls } = await setup()
    let finish!: (files: PrFileDiff[]) => void
    responses.set('getPrFileDiffs', () => new Promise<PrFileDiff[]>(resolve => { finish = resolve }))
    const first = workspace.list.onSelectPr(pr)
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    responses.set('getPrFileDiffs', [{ ...file, filename: 'other.ts' }])
    await workspace.list.onSelectPr({ ...pr, id: 2, number: 43 })
    finish([file])
    await first
    expect(workspace.detail!.files.map(value => value.filename)).toEqual(['other.ts'])
    expect(workspace.detail!.pr.id).toBe(2)
    expect(calls.get('markReviewPrViewed')).toContainEqual({ prId: 1, headSha: 'head' })
    workspace.detail!.onBackToList()
    expect(workspace.detail).toBeNull()
  })

  it('persists reviewed files when reopening and drops marks for changed file content', async () => {
    const { workspace, responses } = await setup()
    await workspace.list.onSelectPr(pr)
    workspace.detail!.onToggleFileReviewed(file, true)
    expect(workspace.detail!.reviewedFileShas.size).toBe(1)
    workspace.detail!.onBackToList()
    await workspace.list.onSelectPr(pr)
    await waitFor(() => expect(workspace.detail!.reviewedFileShas.size).toBe(1))
    workspace.detail!.onBackToList()
    responses.set('getPrFileDiffs', [{ ...file, sha: 'changed-file' }])
    await workspace.list.onSelectPr({ ...pr, head_sha: 'new-head' })
    await waitFor(() => expect(workspace.detail!.reviewedFileShas.size).toBe(0))
  })

  it('posts immediate comments, queues replies, and submits them with the review', async () => {
    const { workspace, responses, calls } = await setup()
    await workspace.list.onSelectPr(pr)
    responses.set('getReviewComments', [comment])
    await workspace.detail!.onCommentNow('login.ts', 2, 'RIGHT', 'Check this')
    expect(workspace.detail!.reviewComments).toEqual([comment])
    expect(calls.get('createReviewComment')).toContainEqual({
      owner: 'acme', repo: 'app', prNumber: 42, commitId: 'head', path: 'login.ts',
      line: 2, side: 'RIGHT', body: 'Check this',
    })
    await workspace.detail!.onReplyToExistingComment(12, 'Immediate reply')
    workspace.detail!.onAddReplyToReview(12, 'Keep this')
    workspace.detail!.onAddReplyToReview(13, 'Remove this')
    workspace.detail!.onRemovePendingReply(13)
    expect(workspace.detail!.pendingReplies).toEqual([{ commentId: 12, body: 'Keep this' }])
    await workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 42, commitId: 'head',
      event: 'COMMENT', body: 'Reviewed', comments: [],
    })
    expect(calls.get('replyToReviewComment')).toEqual([
      { owner: 'acme', repo: 'app', prNumber: 42, commentId: 12, body: 'Immediate reply' },
      { owner: 'acme', repo: 'app', prNumber: 42, commentId: 12, body: 'Keep this' },
    ])
    expect(workspace.detail!.pendingReplies).toEqual([])
  })

  it('keeps AI questions local and exposes replies through the selected review', async () => {
    const { workspace, calls } = await setup()
    await workspace.list.onSelectPr(pr)
    workspace.detail!.onAskAgent('login.ts', 2, 'RIGHT', 'Why this change?')
    expect(workspace.detail!.aiThreadsPendingCount).toBe(1)
    const threadId = workspace.detail!.aiThreads[0].id
    await workspace.detail!.onReplyToThread(threadId, 'More detail please')
    expect(workspace.detail!.aiThreads[0].messages.map(value => value.body)).toEqual(['Why this change?', 'More detail please'])
    expect(calls.get('createReviewComment')).toBeUndefined()
    expect(calls.get('saveAiThread')).toHaveLength(2)
  })

  it('shares walkthrough generation and polling between the list and selected review', async () => {
    const { workspace, responses } = await setup()
    await workspace.list.onSelectPr(pr)
    const walkthrough = workspace.detail!.walkthrough
    expect(walkthrough.walkthrough).toBeNull()
    vi.useFakeTimers()
    await walkthrough.generate()
    expect(walkthrough.walkthrough?.status).toBe('generating')
    expect(workspace.list.walkthroughByPr.get(pr.id)?.status).toBe('generating')
    responses.set('getPrWalkthrough', readyWalkthrough)
    await vi.advanceTimersByTimeAsync(2500)
    expect(walkthrough.walkthrough?.status).toBe('ready')
    expect(workspace.detail!.walkthroughReady).toBe(true)
    expect(workspace.list.walkthroughByPr.get(pr.id)?.status).toBe('ready')
  })

  it('does not restore a stopped walkthrough from an in-flight poll', async () => {
    const { workspace, responses, calls } = await setup()
    await workspace.list.onSelectPr(pr)
    const walkthrough = workspace.detail!.walkthrough
    vi.useFakeTimers()
    await walkthrough.generate()
    let finish!: (value: unknown) => void
    responses.set('getPrWalkthrough', () => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(2500)
    await walkthrough.stop()
    expect(calls.get('abortAgentWalkthrough')).toEqual([{ walkthroughSessionKey: 'session-1' }])
    finish(readyWalkthrough)
    await vi.advanceTimersByTimeAsync(2500)
    expect(walkthrough.walkthrough).toBeNull()
    expect(workspace.list.walkthroughByPr.get(pr.id)).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases polling on destruction and ignores late results', async () => {
    const { workspace, responses, calls, unmount } = await setup()
    await workspace.list.onSelectPr(pr)
    const walkthrough = workspace.detail!.walkthrough
    vi.useFakeTimers()
    await walkthrough.generate()
    let finish!: (value: unknown) => void
    responses.set('getPrWalkthrough', () => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(2500)
    unmount()
    const requestCount = calls.get('getPrWalkthrough')!.length
    finish(readyWalkthrough)
    await vi.advanceTimersByTimeAsync(10000)
    expect(walkthrough.walkthrough?.status).toBe('generating')
    expect(calls.get('getPrWalkthrough')).toHaveLength(requestCount)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the walkthrough tab available while regenerating an opened walkthrough', async () => {
    const { workspace, responses } = await setup()
    responses.set('getPrWalkthrough', readyWalkthrough)
    await workspace.list.onSelectPr(pr)
    workspace.detail!.onActiveTabChange('walkthrough')
    await waitFor(() => expect(workspace.detail!.walkthroughReady).toBe(true))
    await workspace.detail!.walkthrough.regenerate()
    expect(workspace.detail!.walkthroughReady).toBe(true)
    expect(workspace.detail!.activeTab).toBe('walkthrough')
    expect(workspace.detail!.walkthrough.walkthrough?.status).toBe('generating')
  })

  it('retires an older head poll when a new head of the same PR is opened', async () => {
    const { workspace, responses } = await setup()
    await workspace.list.onSelectPr(pr)
    vi.useFakeTimers()
    await workspace.detail!.walkthrough.generate()
    let finish!: (value: unknown) => void
    responses.set('getPrWalkthrough', () => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(2500)
    responses.set('getPrWalkthrough', { ...readyWalkthrough, head_sha: 'new-head' })
    await workspace.list.onSelectPr({ ...pr, head_sha: 'new-head' })
    finish({ ...readyWalkthrough, status: 'generating' })
    responses.set('getPrWalkthrough', readyWalkthrough)
    await vi.advanceTimersByTimeAsync(5000)
    expect(workspace.list.walkthroughByPr.get(pr.id)?.head_sha).toBe('new-head')
    expect(workspace.detail!.walkthrough.walkthrough?.head_sha).toBe('new-head')
  })

  it('does not show a previous pull request ticket after switching reviews', async () => {
    const { workspace, responses, calls } = await setup()
    let finish!: (value: unknown) => void
    const pending = new Promise(resolve => { finish = resolve })
    responses.set('getPrTicket', () => pending)
    await workspace.list.onSelectPr(pr)
    workspace.detail!.onActiveTabChange('walkthrough')
    await waitFor(() => expect(calls.get('getPrTicket')?.length).toBeGreaterThan(0))
    responses.set('getPrTicket', { snapshot: { issue_key: 'NEW-2', item: null, error: null, fetched_at: 1 }, jiraConfigured: true })
    await workspace.list.onSelectPr({ ...pr, id: 2, number: 43 })
    await waitFor(() => expect(workspace.detail!.walkthrough.ticketCoverage.snapshot?.issue_key).toBe('NEW-2'))
    finish({ snapshot: { issue_key: 'OLD-1', item: null, error: null, fetched_at: 1 }, jiraConfigured: true })
    await pending
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(workspace.detail!.walkthrough.ticketCoverage.snapshot?.issue_key).toBe('NEW-2')
  })
})
