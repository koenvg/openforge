import { describe, expect, it } from 'vitest'
import type { PullRequestInfo } from './types'
import {
  buildTicketPullRequestMap,
  updateTaskPullRequestsInMap,
} from './pullRequestStore'

function createPullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    pr_number: 42,
    ticket_id: 'T-42',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'PR',
    url: 'https://example.com/pr',
    state: 'open',
    merged_at: null,
    head_sha: 'abc',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    created_at: 0,
    updated_at: 0,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}

describe('buildTicketPullRequestMap', () => {
  it('groups fetched pull requests by ticket while preserving prior definitive PR state', () => {
    const locallyMerged = createPullRequest({ id: 1, ticket_id: 'T-1', state: 'merged', merged_at: 1234 })
    const locallyDirty = createPullRequest({ id: 2, ticket_id: 'T-2', mergeable: false, mergeable_state: 'dirty' })
    const previous = new Map<string, PullRequestInfo[]>([
      ['T-1', [locallyMerged]],
      ['T-2', [locallyDirty]],
    ])

    const next = buildTicketPullRequestMap([
      { ...locallyMerged, state: 'open', merged_at: null },
      { ...locallyDirty, mergeable: null, mergeable_state: 'unknown' },
      createPullRequest({ id: 3, ticket_id: 'T-2', title: 'Second PR for T-2' }),
    ], previous)

    expect(next).not.toBe(previous)
    expect(next.get('T-1')).toHaveLength(1)
    expect(next.get('T-1')?.[0]).toMatchObject({ state: 'merged', merged_at: 1234 })
    expect(next.get('T-2')).toHaveLength(2)
    expect(next.get('T-2')?.[0]).toMatchObject({ mergeable: false, mergeable_state: 'dirty' })
    expect(next.get('T-2')?.[1].title).toBe('Second PR for T-2')
  })

  it('does not mutate previous pull request arrays while rebuilding the map', () => {
    const previousList = [createPullRequest({ id: 1, ticket_id: 'T-1' })]
    const previous = new Map<string, PullRequestInfo[]>([['T-1', previousList]])

    const next = buildTicketPullRequestMap([
      createPullRequest({ id: 1, ticket_id: 'T-1', title: 'Updated title' }),
      createPullRequest({ id: 2, ticket_id: 'T-1', title: 'New sibling' }),
    ], previous)

    expect(previous.get('T-1')).toBe(previousList)
    expect(previousList).toHaveLength(1)
    expect(next.get('T-1')).not.toBe(previousList)
    expect(next.get('T-1')?.map((pr) => pr.title)).toEqual(['Updated title', 'New sibling'])
  })
})

describe('updateTaskPullRequestsInMap', () => {
  it('replaces only the requested task group with fetched PRs that preserve current task state', () => {
    const currentTaskPr = createPullRequest({ id: 1, ticket_id: 'T-1', state: 'merged', merged_at: 999 })
    const siblingTaskPr = createPullRequest({ id: 2, ticket_id: 'T-2', title: 'Keep sibling task untouched' })
    const previous = new Map<string, PullRequestInfo[]>([
      ['T-1', [currentTaskPr]],
      ['T-2', [siblingTaskPr]],
    ])

    const next = updateTaskPullRequestsInMap(previous, 'T-1', [
      { ...currentTaskPr, state: 'open', merged_at: null },
      createPullRequest({ id: 3, ticket_id: 'T-1', title: 'New same-task PR' }),
      createPullRequest({ id: 4, ticket_id: 'T-2', title: 'Fetched other task should be ignored' }),
    ])

    expect(next).not.toBe(previous)
    expect(next.get('T-2')).toBe(previous.get('T-2'))
    expect(next.get('T-1')).not.toBe(previous.get('T-1'))
    expect(next.get('T-1')).toHaveLength(2)
    expect(next.get('T-1')?.[0]).toMatchObject({ state: 'merged', merged_at: 999 })
    expect(next.get('T-1')?.[1].title).toBe('New same-task PR')
  })
})
