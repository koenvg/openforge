import { cleanup, render, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import type { PrFileDiff, ReviewComment, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { ReviewWorkspace } from './reviewWorkspace.svelte'
import { WALKTHROUGH_INVALIDATED_EVENT } from '../../lib/walkthroughEvents'
import type { WalkthroughRecordV1 } from '../../lib/walkthroughRecord'
import Harness from './__fixtures__/ReviewWorkspaceHarness.svelte'

const pr: ReviewPullRequest = {
  id: 1, number: 42, title: 'Fix login', body: null, state: 'open', draft: false,
  html_url: 'https://github.com/acme/app/pull/42', user_login: 'alice', user_avatar_url: null,
  repo_owner: 'acme', repo_name: 'app', head_ref: 'fix', base_ref: 'main', head_sha: 'head',
  additions: 1, deletions: 0, changed_files: 1, ci_status: null, mergeable: null, mergeable_state: null, merged_at: null,
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
const readyWalkthrough: WalkthroughRecordV1 = {
  version: 1,
  prId: pr.id,
  scope: { namespace: 'github', targetKey: 'gh:acme/app#42', revision: pr.head_sha },
  attemptId: 'attempt-1',
  state: 'ready',
  steps: [],
  error: null,
  createdAt: 1,
  updatedAt: 2,
}
const workspaces: ReviewWorkspace[] = []

async function setup(
  scope: 'global' | 'repo' = 'global',
  projectRepos: Record<string, string> = { 'project-1': 'acme/app' },
) {
  const registry = createOpenForgeRegistryFake({
    pluginId: 'com.openforge.github-sync', projectId: 'project-1',
    viewId: `plugin:com.openforge.github-sync:pr_review${scope === 'global' ? '_global' : ''}`,
  })
  await registry.frontendApi.config.set('github_token', 'test-token')
  registry.frontendApi.projects.list = vi.fn(async () => Object.keys(projectRepos).map((id) => ({
    id, name: id, path: `/${id}`, created_at: 1, updated_at: 1,
  })))
  for (const [projectId, repo] of Object.entries(projectRepos)) {
    await registry.frontendApi.projectConfig.set('resolved_repo', repo, projectId)
  }
  const responses = new Map<string, unknown>(Object.entries({
    resolveProjectIdsByRepo: Object.fromEntries(Object.entries(projectRepos).map(([id, repo]) => [repo.toLowerCase(), id])),
    getReviewPrs: [pr], fetchReviewPrs: [{ ...pr, title: 'Updated login' }],
    getAuthoredPrs: [], fetchAuthoredPrs: [], getPrWalkthrough: null,
    markReviewPrViewed: null, markReviewPrUnviewed: null, dismissReviewPr: null, getPrFileDiffs: [file], getReviewComments: [],
    getPrTicket: { snapshot: null, jiraConfigured: false },
    startAgentWalkthrough: { attemptId: 'attempt-1' },
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
  await waitFor(() => expect(workspace.list.reviewRequests.filtered).toHaveLength(1))
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
    expect(workspace.list.reviewRequests.filtered[0].title).toBe('Fix login')
    await workspace.list.onAddExcludedRepo(' acme/app ')
    expect(workspace.list.reviewRequests.filtered).toEqual([])
    expect(workspace.list.hiddenReviewRepos).toEqual(['acme/app'])
    expect(await registry.frontendApi.config.get('pr_excluded_repos')).toBe('["acme/app"]')
    await workspace.list.onRefreshPrs()
    await workspace.list.onRemoveExcludedRepo('acme/app')
    expect(workspace.list.reviewRequests.filtered[0].title).toBe('Updated login')
  })

  it('restricts project reviews to their resolved repository, independently of global exclusions', async () => {
    const { workspace, responses } = await setup('repo')
    responses.set('fetchReviewPrs', [pr, { ...pr, id: 2, repo_name: 'other' }])
    await workspace.list.onAddExcludedRepo('acme/app')
    await workspace.list.onRefreshPrs()
    expect(workspace.list.reviewRequests.filtered.map(value => value.repo_name)).toEqual(['app'])
    expect(workspace.list.showFilters).toBe(false)
  })

  it('refreshes from host events and retains the last list when a refresh fails', async () => {
    const { workspace, responses, registry } = await setup()
    responses.set('getReviewPrs', [{ ...pr, title: 'Changed by sync' }])
    await registry.frontendApi.events.emitGlobal('openforge.review-pr-count-changed', {})
    await waitFor(() => expect(workspace.list.reviewRequests.filtered[0].title).toBe('Changed by sync'))
    responses.set('fetchReviewPrs', () => { throw new Error('offline') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await workspace.list.onRefreshPrs()
    expect(workspace.list.error).toContain('offline')
    expect(workspace.list.isLoading).toBe(false)
    expect(workspace.list.reviewRequests.filtered[0].title).toBe('Changed by sync')
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

  it.each(['comment', 'reply'] as const)('reports immediate %s posting failures to the caller without refreshing', async (kind) => {
    const { workspace, responses, calls } = await setup()
    responses.set('getReviewComments', [comment])
    await workspace.list.onSelectPr(pr)
    const failure = new Error('GitHub token needs permission to post comments')
    const method = kind === 'comment' ? 'createReviewComment' : 'replyToReviewComment'
    responses.set(method, () => { throw failure })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const readsBefore = calls.get('getReviewComments')!.length

    const posting = kind === 'comment'
      ? workspace.detail!.onCommentNow('login.ts', 2, 'RIGHT', 'Keep my draft')
      : workspace.detail!.onReplyToExistingComment(12, 'Keep my draft')

    await expect(posting).rejects.toThrow('GitHub token needs permission to post comments')
    expect(calls.get(method)).toHaveLength(1)
    expect(calls.get('getReviewComments')).toHaveLength(readsBefore)
    expect(workspace.detail!.reviewComments).toEqual([comment])
    expect(workspace.detail!.replyPostingError).toBeNull()
  })

  it.each(['comment', 'reply'] as const)('keeps immediate %s posting successful when the subsequent refresh fails', async (kind) => {
    const { workspace, responses, calls } = await setup()
    responses.set('getReviewComments', [comment])
    await workspace.list.onSelectPr(pr)
    const refreshFailure = new Error('Comment refresh offline')
    responses.set('getReviewComments', () => { throw refreshFailure })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const readsBefore = calls.get('getReviewComments')!.length

    const posting = kind === 'comment'
      ? workspace.detail!.onCommentNow('login.ts', 2, 'RIGHT', 'Posted once')
      : workspace.detail!.onReplyToExistingComment(12, 'Posted once')

    await expect(posting).resolves.toBeUndefined()
    expect(calls.get(kind === 'comment' ? 'createReviewComment' : 'replyToReviewComment')).toHaveLength(1)
    expect(calls.get('getReviewComments')).toHaveLength(readsBefore + 1)
    expect(workspace.detail!.reviewComments).toEqual([comment])
    expect(workspace.detail!.replyPostingError).toBeNull()
    expect(log).toHaveBeenCalledWith(`Failed to refresh comments after posting ${kind}:`, refreshFailure)
  })

  it('retains failed replies and retries them without submitting the review again', async () => {
    const { workspace, responses, calls } = await setup()
    await workspace.list.onSelectPr(pr)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    workspace.detail!.onAddReplyToReview(12, 'Posted')
    workspace.detail!.onAddReplyToReview(12, 'Retry this')
    workspace.detail!.onAddReplyToReview(13, 'Also posted')
    responses.set('replyToReviewComment', ({ body }: { body: string }) => {
      if (body === 'Retry this') throw new Error('offline')
    })
    await expect(workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 42, commitId: 'head',
      event: 'APPROVE', body: 'Reviewed', comments: [],
    })).resolves.toBeUndefined()
    expect(workspace.detail!.pendingReplies).toEqual([{ commentId: 12, body: 'Retry this' }])
    expect(workspace.detail!.replyPostingError).toContain('Retry replies')
    expect(calls.get('replyToReviewComment')).toHaveLength(3)
    await workspace.detail!.onRetryReplies()
    expect(workspace.detail!.pendingReplies).toEqual([{ commentId: 12, body: 'Retry this' }])
    expect(workspace.detail!.replyPostingError).toContain('Retry replies')
    responses.set('replyToReviewComment', null)
    await workspace.detail!.onRetryReplies()
    expect(workspace.detail!.pendingReplies).toEqual([])
    expect(workspace.detail!.replyPostingError).toBeNull()
    expect(calls.get('submitPrReview')).toHaveLength(1)
    expect(calls.get('replyToReviewComment')).toHaveLength(5)
    expect(calls.get('replyToReviewComment')!.at(-1)).toMatchObject({ body: 'Retry this' })
  })

  it('keeps replies queued during posting and prevents overlapping reply retries', async () => {
    const { workspace, responses, calls } = await setup()
    await workspace.list.onSelectPr(pr)
    workspace.detail!.onAddReplyToReview(12, 'First')
    let finish!: () => void
    responses.set('replyToReviewComment', () => new Promise<void>(resolve => { finish = resolve }))
    const posting = workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 42, commitId: 'head',
      event: 'COMMENT', body: 'Reviewed', comments: [],
    })
    await waitFor(() => expect(workspace.detail!.isPostingReplies).toBe(true))
    workspace.detail!.onAddReplyToReview(12, 'Later')
    await workspace.detail!.onRetryReplies()
    expect(calls.get('replyToReviewComment')).toHaveLength(1)
    finish()
    await posting
    expect(workspace.detail!.pendingReplies).toEqual([{ commentId: 12, body: 'Later' }])
    expect(workspace.detail!.isPostingReplies).toBe(false)
  })

  it('keeps failed replies when an already-posted review is recovered and comment refresh fails', async () => {
    const { workspace, responses, calls } = await setup()
    await workspace.list.onSelectPr(pr)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    workspace.detail!.onAddReplyToReview(12, 'Retry this')
    responses.set('submitPrReview', () => { throw new Error('response lost') })
    let reads = 0
    responses.set('getReviewComments', () => {
      if (reads++ === 0) return [comment]
      throw new Error('refresh offline')
    })
    responses.set('replyToReviewComment', () => { throw new Error('offline') })
    await expect(workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 42, commitId: 'head',
      event: 'COMMENT', body: '',
      comments: [{ path: 'login.ts', line: 2, side: 'RIGHT', body: 'Check this' }],
    })).resolves.toBeUndefined()
    expect(workspace.detail!.pendingReplies).toEqual([{ commentId: 12, body: 'Retry this' }])
    expect(workspace.detail!.replyPostingError).toContain('Your review was submitted')
    responses.set('replyToReviewComment', null)
    await workspace.detail!.onRetryReplies()
    expect(workspace.detail!.pendingReplies).toEqual([])
    expect(workspace.detail!.replyPostingError).toBeNull()
    expect(calls.get('submitPrReview')).toHaveLength(1)
  })

  it('does not let posting on a previous PR block or clear the current PR posting state', async () => {
    const { workspace, responses, calls } = await setup()
    await workspace.list.onSelectPr(pr)
    workspace.detail!.onAddReplyToReview(12, 'Previous PR')
    const finishes: (() => void)[] = []
    responses.set('replyToReviewComment', () => new Promise<void>(resolve => { finishes.push(resolve) }))
    const first = workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 42, commitId: 'head',
      event: 'COMMENT', body: 'Reviewed', comments: [],
    })
    await waitFor(() => expect(finishes).toHaveLength(1))
    workspace.detail!.onBackToList()
    await workspace.list.onSelectPr({ ...pr, id: 2, number: 43 })
    workspace.detail!.onAddReplyToReview(13, 'Current PR')
    const second = workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 43, commitId: 'head',
      event: 'COMMENT', body: 'Reviewed', comments: [],
    })
    await waitFor(() => expect(finishes).toHaveLength(2))
    finishes[0]()
    await first
    expect(workspace.detail!.isPostingReplies).toBe(true)
    expect(workspace.detail!.pendingReplies).toEqual([{ commentId: 13, body: 'Current PR' }])
    await workspace.detail!.onRetryReplies()
    expect(calls.get('replyToReviewComment')).toHaveLength(2)
    finishes[1]()
    await second
    expect(workspace.detail!.isPostingReplies).toBe(false)
    expect(workspace.detail!.pendingReplies).toEqual([])
    expect(workspace.detail!.replyPostingError).toBeNull()
    expect(calls.get('replyToReviewComment')!.at(-1)).toMatchObject({ prNumber: 43, body: 'Current PR' })
  })

  it('removes a PR from the list and persists the removal', async () => {
    const { workspace, calls } = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    workspace.list.onRemove(pr)

    expect(workspace.list.reviewRequests.filtered).toEqual([])
    await waitFor(() => expect(calls.get('dismissReviewPr')).toContainEqual({ prId: 1 }))
  })

  it('releases an active review Agent Session when its pull request is removed', async () => {
    const { workspace, registry } = await setup()
    await workspace.list.onSelectPr(pr)
    await waitFor(() => expect(workspace.detail!.agentSession.projectId).toBe('project-1'))
    await registry.frontendApi.agentSessions.start({
      scope: { namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head' },
      projectId: 'project-1',
      checkoutRevision: 'head',
      initialInput: 'Review this pull request',
      toolPolicy: 'review-read-only',
    })

    workspace.list.onRemove(pr)

    const scope = { namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head' }
    await waitFor(() => {
      expect(registry.calls.scopedAgentSessionAborts).toContainEqual(scope)
      expect(registry.calls.scopedAgentSessionReleases).toContainEqual(scope)
    })
  })

  it('offers keep/remove after an in-app review, keeping the PR on keep', async () => {
    const { workspace, calls } = await setup()
    await workspace.list.onSelectPr(pr)

    await workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 42, commitId: 'head',
      event: 'APPROVE', body: 'LGTM', comments: [],
    })

    expect(workspace.postReview?.pr.id).toBe(1)
    workspace.postReview!.onKeep()
    expect(workspace.postReview).toBeNull()
    expect(workspace.detail).toBeNull()
    expect(workspace.list.reviewRequests.filtered).toHaveLength(1)
    expect(calls.get('dismissReviewPr')).toBeUndefined()
  })

  it('removes the PR when the post-review prompt is answered with remove', async () => {
    const { workspace, calls } = await setup()
    await workspace.list.onSelectPr(pr)

    await workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 42, commitId: 'head',
      event: 'REQUEST_CHANGES', body: 'Please fix', comments: [],
    })

    expect(workspace.postReview?.pr.id).toBe(1)
    workspace.postReview!.onRemove()
    expect(workspace.postReview).toBeNull()
    expect(workspace.detail).toBeNull()
    expect(workspace.list.reviewRequests.filtered).toEqual([])
    await waitFor(() => expect(calls.get('dismissReviewPr')).toContainEqual({ prId: 1 }))
  })

  it('stores an inline follow-up and sends it immediately through the existing review session', async () => {
    const { workspace, calls, registry } = await setup()
    await workspace.list.onSelectPr(pr)
    await registry.frontendApi.agentSessions.start({
      scope: { namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head' },
      projectId: 'project-1',
      checkoutRevision: 'head',
      initialInput: 'Review this pull request.',
      toolPolicy: 'review-read-only',
    })
    await waitFor(() => expect(workspace.detail!.reviewFollowUpUnavailableReason).toBeNull())

    workspace.detail!.onCreateReviewThread!('login.ts', 2, 'RIGHT', 'Why this change?')

    await waitFor(() => expect(workspace.detail!.reviewThreads).toHaveLength(1))
    expect(workspace.detail!.reviewThreads[0].messages.map(value => value.body)).toEqual(['Why this change?'])
    expect(registry.calls.scopedAgentSessionInputs[0]?.input).toContain(`Review Thread ${workspace.detail!.reviewThreads[0].id}`)
    expect(calls.get('createReviewComment')).toBeUndefined()
    expect(calls.get('askAgentQuestions')).toBeUndefined()
  })

  it('renders live agent findings from the exact pull request Review Thread scope', async () => {
    const { workspace, registry } = await setup()
    const thread = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head',
      anchor: { kind: 'line', filePath: 'login.ts', line: 2, side: 'RIGHT' },
      origin: 'agent', body: 'Needs a null check',
    })
    await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'other-head',
      anchor: { kind: 'line', filePath: 'login.ts', line: 2, side: 'RIGHT' },
      origin: 'agent', body: 'Unrelated revision',
    })
    await workspace.list.onSelectPr(pr)

    await waitFor(() => expect(workspace.detail!.reviewThreads).toHaveLength(1))
    expect(workspace.detail!.reviewThreads[0].id).toBe(thread.id)
    expect(workspace.detail!.reviewThreads[0].messages.map(message => message.body)).toEqual(['Needs a null check'])
  })

  it('replies to an agent finding in the same Review Thread and conversation', async () => {
    const { workspace, registry } = await setup()
    const thread = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head',
      anchor: { kind: 'line', filePath: 'login.ts', line: 2, side: 'RIGHT' },
      origin: 'agent', body: 'Needs a null check',
    })
    await workspace.list.onSelectPr(pr)
    await waitFor(() => expect(workspace.detail!.reviewThreads).toHaveLength(1))
    await registry.frontendApi.agentSessions.start({
      scope: { namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head' },
      projectId: 'project-1',
      checkoutRevision: 'head',
      initialInput: 'Review this pull request.',
      toolPolicy: 'review-read-only',
    })
    await waitFor(() => expect(workspace.detail!.reviewFollowUpUnavailableReason).toBeNull())

    workspace.detail!.onReplyToReviewThread!(thread.id, 'Why is that unsafe?')
    await waitFor(() => expect(workspace.detail!.reviewThreads[0].messages).toHaveLength(2))

    expect(workspace.detail!.reviewThreads[0].messages.map(message => message.body)).toEqual([
      'Needs a null check',
      'Why is that unsafe?',
    ])
    expect(registry.calls.scopedAgentSessionInputs.at(-1)?.input).toContain(`Review Thread ${thread.id}`)
  })

  it('records a reviewer decision directly on the Review Thread', async () => {
    const { workspace, registry } = await setup()
    const thread = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head',
      anchor: { kind: 'line', filePath: 'login.ts', line: 2, side: 'RIGHT' },
      origin: 'agent', body: 'Needs a null check',
    })
    await workspace.list.onSelectPr(pr)
    await waitFor(() => expect(workspace.detail!.reviewThreads).toHaveLength(1))

    workspace.detail!.onSetReviewThreadStatus(thread.id, 'resolved')

    await waitFor(() => expect(workspace.detail!.reviewThreads[0].status).toBe('resolved'))
  })

  it('dismisses exactly the resolved agent threads included in a successful GitHub review', async () => {
    const { workspace, registry, calls } = await setup()
    const submitted = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head',
      anchor: { kind: 'line', filePath: 'login.ts', line: 2, side: 'RIGHT' },
      origin: 'agent', body: 'Needs a null check',
    })
    const retained = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head',
      anchor: { kind: 'line', filePath: 'login.ts', line: 1, side: 'RIGHT' },
      origin: 'agent', body: 'Keep this open',
    })
    await registry.frontendApi.reviewThreads.setStatus({ threadId: submitted.id, status: 'resolved' })
    await workspace.list.onSelectPr(pr)

    await workspace.detail!.onSubmitReview({
      repoOwner: 'acme', repoName: 'app', prNumber: 42, commitId: 'head',
      event: 'COMMENT', body: 'Reviewed',
      comments: [{ path: 'login.ts', line: 2, side: 'RIGHT', body: 'Needs a null check' }],
    }, [submitted.id])

    expect(calls.get('submitPrReview')).toContainEqual(expect.objectContaining({
      comments: [{ path: 'login.ts', line: 2, side: 'RIGHT', body: 'Needs a null check' }],
    }))
    const listed = await registry.frontendApi.reviewThreads.list({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head',
    })
    expect(listed.find(thread => thread.id === submitted.id)?.status).toBe('dismissed')
    expect(listed.find(thread => thread.id === retained.id)?.status).toBe('open')
  })

  it('renders stored core question threads through the review-thread input', async () => {
    const { workspace, registry } = await setup()
    const created = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head',
      anchor: { kind: 'line', filePath: 'login.ts', line: 2, side: 'RIGHT' },
      origin: 'human', body: 'Why this change?',
    })
    await registry.frontendApi.reviewThreads.setAwaiting({ threadId: created.id, awaiting: 'agent' })
    await workspace.list.onSelectPr(pr)

    const [thread] = workspace.detail!.reviewThreads
    expect(thread.origin).toBe('human')
    expect(thread.anchor).toEqual({ kind: 'line', filePath: 'login.ts', line: 2, side: 'RIGHT' })
    expect(thread.awaiting).toBe('agent')
    expect(thread.messages.map(message => message.body)).toEqual(['Why this change?'])
  })

  it('records a reviewer decision on a core question thread', async () => {
    const { workspace, registry } = await setup()
    const created = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head',
      anchor: { kind: 'line', filePath: 'login.ts', line: 2, side: 'RIGHT' },
      origin: 'human', body: 'Why this change?',
    })
    await workspace.list.onSelectPr(pr)

    workspace.detail!.onSetReviewThreadStatus(created.id, 'resolved')

    await waitFor(() => expect(workspace.detail!.reviewThreads[0].status).toBe('resolved'))
  })

  it('keeps walkthrough generation and polling on the selected review', async () => {
    const { workspace, responses } = await setup()
    await workspace.list.onSelectPr(pr)
    const walkthrough = workspace.detail!.walkthrough
    expect(walkthrough.walkthrough).toBeNull()
    vi.useFakeTimers()
    await walkthrough.generate()
    expect(walkthrough.walkthrough?.state).toBe('generating')
    responses.set('getPrWalkthrough', readyWalkthrough)
    await vi.advanceTimersByTimeAsync(2500)
    expect(walkthrough.walkthrough?.state).toBe('ready')
    expect(workspace.detail!.walkthroughReady).toBe(true)
  })

  it('re-reads an active walkthrough immediately after a submitted step is persisted', async () => {
    const { workspace, registry, responses, calls } = await setup()
    await workspace.list.onSelectPr(pr)
    const readsBefore = calls.get('getPrWalkthrough')!.length
    responses.set('getPrWalkthrough', readyWalkthrough)

    await registry.frontendApi.events.emitGlobal(WALKTHROUGH_INVALIDATED_EVENT, {
      prId: pr.id,
      scope: { namespace: 'github', targetKey: 'gh:acme/app#42', revision: pr.head_sha },
    })

    await waitFor(() => expect(calls.get('getPrWalkthrough')).toHaveLength(readsBefore + 1))
    await waitFor(() => expect(workspace.detail!.walkthrough.walkthrough?.state).toBe('ready'))
  })

  it('does not offer a batching path or start a fresh session for a follow-up', async () => {
    const { workspace, calls, registry } = await setup('global', {
      'project-1': 'acme/other',
      'project-2': 'acme/app',
    })
    await workspace.list.onSelectPr(pr)
    await registry.frontendApi.agentSessions.start({
      scope: { namespace: 'github', targetKey: 'gh:acme/app#42', revision: 'head' },
      projectId: 'project-2',
      checkoutRevision: 'head',
      initialInput: 'Review this pull request.',
      toolPolicy: 'review-read-only',
    })
    await waitFor(() => expect(workspace.detail!.reviewFollowUpUnavailableReason).toBeNull())
    workspace.detail!.onCreateReviewThread!('login.ts', 2, 'RIGHT', 'Why this change?')

    await waitFor(() => expect(registry.calls.scopedAgentSessionInputs).toHaveLength(1))
    expect(registry.calls.scopedAgentSessionStarts).toHaveLength(1)
    expect(calls.get('askAgentQuestions')).toBeUndefined()
  })

  it('explains why follow-up questions are unavailable without a matching local project', async () => {
    const { workspace } = await setup('global', { 'project-1': 'acme/other' })

    await workspace.list.onSelectPr(pr)

    await waitFor(() => expect(workspace.detail!.reviewFollowUpUnavailableReason)
      .toBe('A local OpenForge Project linked to this repository is required for follow-up questions.'))
    expect(workspace.detail!.onCreateReviewThread).toBeUndefined()
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
    expect(calls.get('abortAgentWalkthrough')).toEqual([{ attemptId: 'attempt-1' }])
    finish(readyWalkthrough)
    await vi.advanceTimersByTimeAsync(2500)
    expect(walkthrough.walkthrough?.state).toBe('aborted')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a walkthrough generating and reports an actionable error when stop fails', async () => {
    const { workspace, responses } = await setup()
    await workspace.list.onSelectPr(pr)
    const walkthrough = workspace.detail!.walkthrough
    await walkthrough.generate()
    responses.set('abortAgentWalkthrough', () => { throw new Error('abort unavailable') })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await walkthrough.stop()

    expect(walkthrough.walkthrough?.state).toBe('generating')
    expect(walkthrough.loadError).toBe('Could not stop walkthrough generation. Try stopping it again.')
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
    expect(walkthrough.walkthrough?.state).toBe('generating')
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
    expect(workspace.detail!.walkthrough.walkthrough?.state).toBe('generating')
  })

  it('retires an older head poll when a new head of the same PR is opened', async () => {
    const { workspace, responses } = await setup()
    await workspace.list.onSelectPr(pr)
    vi.useFakeTimers()
    await workspace.detail!.walkthrough.generate()
    let finish!: (value: unknown) => void
    responses.set('getPrWalkthrough', () => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(2500)
    responses.set('getPrWalkthrough', { ...readyWalkthrough, scope: { ...readyWalkthrough.scope, revision: 'new-head' } })
    await workspace.list.onSelectPr({ ...pr, head_sha: 'new-head' })
    finish({ ...readyWalkthrough, state: 'generating' })
    responses.set('getPrWalkthrough', readyWalkthrough)
    await vi.advanceTimersByTimeAsync(5000)
    expect(workspace.detail!.walkthrough.walkthrough?.scope.revision).toBe('new-head')
  })

  it('does not show a previous pull request ticket after switching reviews', async () => {
    const { workspace, responses, calls } = await setup()
    responses.set('getPrWalkthrough', readyWalkthrough)
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
