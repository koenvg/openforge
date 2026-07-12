import { describe, it, expect } from 'vitest'
import { buildAttentionOverview } from './attentionOverview'
import type { BuildAttentionOverviewInput } from './attentionOverview'
import type { AgentSession, Project, ReviewPullRequest, Task, PrLabel } from './types'
import { DO_NOT_REVIEW_LABEL } from './types'

function project(id: string, overrides: Partial<Project> = {}): Project {
  return { id, name: id, path: `/repos/${id}`, created_at: 0, updated_at: 0, ...overrides }
}

function task(id: string, projectId: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    initial_prompt: id,
    status: 'doing',
    prompt: null,
    title: id,
    title_source: null,
    title_generated_at: null,
    summary: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    depends_on: [],
    project_id: projectId,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  } as Task
}

function session(ticketId: string, status: string, updatedAt = 0): AgentSession {
  return {
    id: `s-${ticketId}`,
    ticket_id: ticketId,
    opencode_session_id: null,
    stage: '',
    status,
    checkpoint_data: null,
    pty_instance_id: null,
    error_message: null,
    created_at: 0,
    updated_at: updatedAt,
    provider: 'claude',
    claude_session_id: null,
    pi_session_id: null,
  }
}

function label(name: string): PrLabel {
  return { name, color: '' }
}

function review(id: number, owner: string, name: string, overrides: Partial<ReviewPullRequest> = {}): ReviewPullRequest {
  return {
    id,
    number: id,
    title: `PR ${id}`,
    repo_owner: owner,
    repo_name: name,
    viewed_at: null,
    updated_at: id,
    labels: [],
    ...overrides,
  } as ReviewPullRequest
}

function baseInput(overrides: Partial<BuildAttentionOverviewInput> = {}): BuildAttentionOverviewInput {
  return {
    projects: [],
    allTasks: [],
    sessions: new Map(),
    ticketPrs: new Map(),
    outOfFocusByProject: new Map(),
    focusStatesByProject: new Map(),
    reviewPrs: [],
    excludedRepos: new Set(),
    resolvedRepoByProject: new Map(),
    ...overrides,
  }
}

describe('buildAttentionOverview — focus tasks', () => {
  it('includes doing tasks, excludes backlog/done and manually set-aside tasks', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      allTasks: [
        task('t-doing', 'p1', { status: 'doing' }),
        task('t-backlog', 'p1', { status: 'backlog' }),
        task('t-done', 'p1', { status: 'done' }),
        task('t-set-aside', 'p1', { status: 'doing' }),
      ],
      outOfFocusByProject: new Map([['p1', new Set(['t-set-aside'])]]),
    }))

    const ids = result.groups[0].focusTasks.map((f) => f.task.id)
    expect(ids).toEqual(['t-doing'])
  })

  it('scopes tasks to their own project', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('p2')],
      allTasks: [task('a', 'p1'), task('b', 'p2'), task('c', 'p2')],
    }))
    expect(result.groups.find((g) => g.project.id === 'p1')?.focusTasks.map((f) => f.task.id)).toEqual(['a'])
    expect(result.groups.find((g) => g.project.id === 'p2')?.focusTasks.map((f) => f.task.id).sort()).toEqual(['b', 'c'])
  })

  it('excludes in-flight (running) tasks, keeping only those that need attention', () => {
    // idle task (no session) => needs attention; running task => in-flight (active),
    // which the "Needs your attention" overview must not surface.
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      allTasks: [task('running', 'p1'), task('idle', 'p1')],
      sessions: new Map([['running', session('running', 'running')]]),
    }))
    const focus = result.groups[0].focusTasks
    expect(focus.map((f) => f.task.id)).toEqual(['idle'])
    expect(focus[0].needsAttention).toBe(true)
  })

  it('drops a project whose only doing task is in-flight and has no review PRs', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      allTasks: [task('running', 'p1')],
      sessions: new Map([['running', session('running', 'running')]]),
    }))
    expect(result.groups).toHaveLength(0)
    expect(result.totalFocusTasks).toBe(0)
  })

  it('computes task state from the session', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      allTasks: [task('t', 'p1')],
      sessions: new Map([['t', session('t', 'failed')]]),
    }))
    expect(result.groups[0].focusTasks[0].state).toBe('failed')
  })

  it("honors each project's configured focus states, excluding tasks that no longer need attention", () => {
    // An empty focus-state set means an idle task no longer "needs attention",
    // so the overview drops it (and the now-empty project group).
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      allTasks: [task('idle', 'p1')],
      focusStatesByProject: new Map([['p1', []]]),
    }))
    expect(result.groups).toHaveLength(0)
    expect(result.totalFocusTasks).toBe(0)
  })
})

describe('buildAttentionOverview — review PRs', () => {
  it('includes only unopened, non-DO-NOT-REVIEW, non-excluded PRs for the matching project', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [
        review(1, 'me', 'app'), // included
        review(2, 'me', 'app', { viewed_at: 123 }), // viewed — excluded
        review(3, 'me', 'app', { labels: [label(DO_NOT_REVIEW_LABEL)] }), // do not review — excluded
      ],
    }))
    expect(result.groups[0].reviewPrs.map((p) => p.id)).toEqual([1])
  })

  it('honors the global excluded-repos set', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [review(1, 'me', 'app')],
      excludedRepos: new Set(['me/app']),
    }))
    expect(result.groups).toHaveLength(0)
  })

  it('maps a PR to the first project (sidebar order) that owns its repo', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('p2')],
      resolvedRepoByProject: new Map([['p1', 'me/shared'], ['p2', 'me/shared']]),
      reviewPrs: [review(1, 'me', 'shared')],
    }))
    expect(result.groups.map((g) => g.project.id)).toEqual(['p1'])
    expect(result.groups[0].reviewPrs.map((p) => p.id)).toEqual([1])
  })

  it('puts PRs with no matching project in otherReviewPrs', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [review(9, 'someone', 'unknown')],
    }))
    expect(result.groups).toHaveLength(0)
    expect(result.otherReviewPrs.map((p) => p.id)).toEqual([9])
  })
})

describe('buildAttentionOverview — hidden projects', () => {
  it('excludes a hidden project from the groups and its focus tasks from the totals', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('p2')],
      allTasks: [task('a', 'p1'), task('b', 'p2')],
      hiddenProjectIds: new Set(['p2']),
    }))
    expect(result.groups.map((g) => g.project.id)).toEqual(['p1'])
    expect(result.totalFocusTasks).toBe(1)
  })

  it('drops a review PR whose repo is owned only by a hidden project (not surfaced under Other)', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [review(1, 'me', 'app')],
      hiddenProjectIds: new Set(['p1']),
    }))
    expect(result.groups).toHaveLength(0)
    expect(result.otherReviewPrs).toHaveLength(0)
    expect(result.totalReviewPrs).toBe(0)
  })

  it('still surfaces a shared-repo PR under a visible project even if a hidden project owns the same repo', () => {
    const result = buildAttentionOverview(baseInput({
      // p-hidden appears first in order but is hidden; p-visible owns the same repo.
      projects: [project('p-hidden'), project('p-visible')],
      resolvedRepoByProject: new Map([['p-hidden', 'me/shared'], ['p-visible', 'me/shared']]),
      reviewPrs: [review(1, 'me', 'shared')],
      hiddenProjectIds: new Set(['p-hidden']),
    }))
    expect(result.groups.map((g) => g.project.id)).toEqual(['p-visible'])
    expect(result.groups[0].reviewPrs.map((p) => p.id)).toEqual([1])
  })

  it('still routes a PR with no local project to otherReviewPrs', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [review(9, 'someone', 'unknown')],
      hiddenProjectIds: new Set(['p1']),
    }))
    expect(result.otherReviewPrs.map((p) => p.id)).toEqual([9])
  })
})

describe('buildAttentionOverview — grouping, order, totals', () => {
  it('preserves sidebar project order and hides empty projects', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('p2'), project('p3')],
      allTasks: [task('t3', 'p3'), task('t1', 'p1')],
      // p2 has nothing
    }))
    expect(result.groups.map((g) => g.project.id)).toEqual(['p1', 'p3'])
  })

  it('computes totals across all groups plus the other bucket', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('p2')],
      allTasks: [task('t1', 'p1'), task('t2', 'p1'), task('t3', 'p2')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [
        review(1, 'me', 'app'), // -> p1
        review(2, 'x', 'y'), // -> other
      ],
    }))
    expect(result.totalFocusTasks).toBe(3)
    expect(result.totalReviewPrs).toBe(2)
  })

  it('returns no groups when nothing needs attention', () => {
    const result = buildAttentionOverview(baseInput({ projects: [project('p1')] }))
    expect(result.groups).toHaveLength(0)
    expect(result.otherReviewPrs).toHaveLength(0)
    expect(result.totalFocusTasks).toBe(0)
    expect(result.totalReviewPrs).toBe(0)
  })
})
