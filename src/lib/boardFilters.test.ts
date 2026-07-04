import { vi } from 'vitest'

vi.mock('./ipc', () => ({ getProjectConfig: vi.fn(), setProjectConfig: vi.fn() }))

import { describe, it, expect } from 'vitest'
import type { Task, AgentSession, PullRequestInfo } from './types'
import { isFocusTask, filterTasks, getFilterCounts, DEFAULT_FOCUS_STATES, loadFocusFilterStates, saveFocusFilterStates, loadLowFireTaskIds, saveLowFireTaskIds } from './boardFilters'
import { getProjectConfig, setProjectConfig } from './ipc'

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: overrides.id,
    status: 'doing',
    prompt: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    summary: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    depends_on: [],
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeSession(overrides: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    ticket_id: 'T-1',
    opencode_session_id: null,
    stage: 'implement',
    status: 'running',
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
    pi_session_id: null,
    ...overrides,
    pty_instance_id: overrides.pty_instance_id ?? null,
  }
}

function makePr(overrides: Partial<PullRequestInfo> & { id: number }): PullRequestInfo {
  return {
    ticket_id: 'T-1',
    repo_owner: 'test',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/test/repo/pull/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: null,
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 1000,
    updated_at: 1000,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
    pr_number: overrides.id,
    ...overrides,
  }
}

describe('isFocusTask', () => {
  it('returns true for needs-input state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'needs-input', [])
    expect(result).toBe(true)
  })

  it('returns true for ci-failed state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'ci-failed', [])
    expect(result).toBe(true)
  })

  it('returns true for changes-requested state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'changes-requested', [])
    expect(result).toBe(true)
  })

  it('returns true for unaddressed-comments state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'unaddressed-comments', [])
    expect(result).toBe(true)
  })

  it('returns true for failed state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'failed', [])
    expect(result).toBe(true)
  })

  it('returns true for merge-conflict state', () => {
    const task = makeTask({ id: 'T-1' })
    const result = isFocusTask(task, 'merge-conflict', [])
    expect(result).toBe(true)
  })

  it('returns true for idle state (included in defaults)', () => {
    const task = makeTask({ id: 'T-1' })
    const pr = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 0 })
    const result = isFocusTask(task, 'idle', [pr])
    expect(result).toBe(true)
  })

  it('returns true when PR has unaddressed comments', () => {
    const task = makeTask({ id: 'T-1' })
    const pr = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 2 })
    const result = isFocusTask(task, 'idle', [pr])
    expect(result).toBe(true)
  })

  it('returns true when any PR has unaddressed comments (multiple PRs)', () => {
    const task = makeTask({ id: 'T-1' })
    const pr1 = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 0 })
    const pr2 = makePr({ id: 2, ticket_id: 'T-1', unaddressed_comment_count: 1 })
    const result = isFocusTask(task, 'idle', [pr1, pr2])
    expect(result).toBe(true)
  })

  it('returns false for done state even with unaddressed comments', () => {
    const task = makeTask({ id: 'T-1' })
    const pr = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 1 })
    const result = isFocusTask(task, 'done', [pr])
    expect(result).toBe(false)
  })

  it('returns false for active state even with unaddressed comments', () => {
    const task = makeTask({ id: 'T-1' })
    const pr = makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 2 })
    const result = isFocusTask(task, 'active', [pr])
    expect(result).toBe(false)
  })

  it('does not allow custom focus states to put active agents in focus', () => {
    const task = makeTask({ id: 'T-1' })
    expect(isFocusTask(task, 'idle', [], ['idle'])).toBe(true)
    expect(isFocusTask(task, 'idle', [], ['active'])).toBe(false)
    expect(isFocusTask(task, 'active', [], ['active'])).toBe(false)
  })
})

describe('filterTasks', () => {
  it('filters Focus to started/current attention tasks outside Out of Focus', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'paused', checkpoint_data: null })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'running' })],
      ['T-4', makeSession({ id: 's-4', ticket_id: 'T-4', status: 'failed' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3' }),
      makeTask({ id: 'T-4' }),
      makeTask({ id: 'T-5', status: 'backlog' }),
    ]

    const filtered = filterTasks(tasks, 'focus', sessions, prs, ['paused', 'failed'], new Set(['T-4']))
    expect(filtered.map((t: Task) => t.id)).toEqual(['T-1'])
  })

  it('filters In Flight to all started/current non-attention tasks after focus-state settings, not just active sessions', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'paused', checkpoint_data: null })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'running' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3' }),
      makeTask({ id: 'T-4', status: 'backlog' }),
      makeTask({ id: 'T-5', status: 'done' }),
      makeTask({ id: 'T-6' }),
    ]

    const filtered = filterTasks(tasks, 'in-flight', sessions, prs, ['paused'], new Set(['T-6']))
    expect(filtered.map((t: Task) => t.id)).toEqual(['T-2', 'T-3'])
  })

  it('filters Out of Focus to manually set-aside started/current tasks only', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running' })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'paused', checkpoint_data: '{}' })],
      ['T-3', makeSession({ id: 's-3', ticket_id: 'T-3', status: 'running' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'doing' }),
      makeTask({ id: 'T-3', status: 'done' }),
      makeTask({ id: 'T-4', status: 'backlog' }),
    ]

    const filtered = filterTasks(tasks, 'out-of-focus', sessions, prs, DEFAULT_FOCUS_STATES, new Set(['T-1', 'T-2', 'T-3', 'T-4']))
    expect(filtered.map((t: Task) => t.id)).toEqual(['T-1', 'T-2'])
  })

  it('filters backlog tasks (status === backlog)', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'backlog' }),
      makeTask({ id: 'T-3', status: 'backlog' }),
    ]

    const filtered = filterTasks(tasks, 'backlog', sessions, prs)
    expect(filtered.map((t: Task) => t.id)).toEqual(['T-2', 'T-3'])
  })

  it('excludes legacy done tasks from Focus, In Flight, and Out of Focus filters', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'done' }),
    ]

    expect(filterTasks(tasks, 'focus', sessions, prs).map((t: Task) => t.id)).toEqual(['T-1'])
    expect(filterTasks(tasks, 'in-flight', sessions, prs, [], new Set(['T-2'])).map((t: Task) => t.id)).toEqual(['T-1'])
    expect(filterTasks(tasks, 'out-of-focus', sessions, prs, DEFAULT_FOCUS_STATES, new Set(['T-1', 'T-2'])).map((t: Task) => t.id)).toEqual(['T-1'])
  })

  it('returns empty array for empty task list', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const filtered = filterTasks([], 'focus', sessions, prs)
    expect(filtered).toEqual([])
  })

  it('does not mutate original array', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()
    const tasks = [makeTask({ id: 'T-1' })]

    const filtered = filterTasks(tasks, 'focus', sessions, prs)
    expect(filtered).not.toBe(tasks as Task[])
  })
})

describe('getFilterCounts', () => {
  it('returns correct counts for all filters', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'paused', checkpoint_data: '{}' })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'running' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3', status: 'backlog' }),
    ]

    const counts = getFilterCounts(tasks, sessions, prs)
    expect(counts).toEqual({
      focus: 1,
      'in-flight': 1,
      'out-of-focus': 0,
      backlog: 1,
    })
  })

  it('returns zero counts for empty task list', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const counts = getFilterCounts([], sessions, prs)
    expect(counts).toEqual({
      focus: 0,
      'in-flight': 0,
      'out-of-focus': 0,
      backlog: 0,
    })
  })

  it('counts backlog tasks correctly', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'backlog' }),
      makeTask({ id: 'T-2', status: 'backlog' }),
    ]

    const counts = getFilterCounts(tasks, sessions, prs)
    expect(counts).toEqual({
      focus: 0,
      'in-flight': 0,
      'out-of-focus': 0,
      backlog: 2,
    })
  })

  it('counts all visible items for Focus, In Flight, and Out of Focus tab chips', () => {
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession({ id: 's-1', ticket_id: 'T-1', status: 'running' })],
      ['T-2', makeSession({ id: 's-2', ticket_id: 'T-2', status: 'failed' })],
      ['T-3', makeSession({ id: 's-3', ticket_id: 'T-3', status: 'paused', checkpoint_data: '{}' })],
      ['T-4', makeSession({ id: 's-4', ticket_id: 'T-4', status: 'running' })],
    ])
    const prs = new Map<string, PullRequestInfo[]>([
      ['T-1', [makePr({ id: 1, ticket_id: 'T-1', unaddressed_comment_count: 2 })]],
    ])

    const tasks = [
      makeTask({ id: 'T-1' }),
      makeTask({ id: 'T-2' }),
      makeTask({ id: 'T-3' }),
      makeTask({ id: 'T-4' }),
      makeTask({ id: 'T-5', status: 'backlog' }),
    ]

    const counts = getFilterCounts(tasks, sessions, prs, DEFAULT_FOCUS_STATES, new Set(['T-3', 'T-4']))
    expect(counts).toEqual({
      focus: 1,
      'in-flight': 1,
      'out-of-focus': 2,
      backlog: 1,
    })
  })

  it('handles tasks with no sessions', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'backlog' }),
    ]

    const counts = getFilterCounts(tasks, sessions, prs, [])
    expect(counts).toEqual({
      focus: 0,
      'in-flight': 1,
      'out-of-focus': 0,
      backlog: 1,
    })
  })

  it('does not count legacy done tasks in any lane chip', () => {
    const sessions = new Map<string, AgentSession>()
    const prs = new Map<string, PullRequestInfo[]>()

    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'done' }),
      makeTask({ id: 'T-3', status: 'done' }),
      makeTask({ id: 'T-4', status: 'backlog' }),
    ]

    const counts = getFilterCounts(tasks, sessions, prs)
    expect(counts).toEqual({
      focus: 1,
      'in-flight': 0,
      'out-of-focus': 0,
      backlog: 1,
    })
  })

  it('includes merge-conflict', () => {
    expect(DEFAULT_FOCUS_STATES).toContain('merge-conflict')
  })

  it('includes ready-to-enqueue for actionable merge queue readiness', () => {
    expect(DEFAULT_FOCUS_STATES).toContain('ready-to-enqueue')
    const task = makeTask({ id: 'T-queue' })
    expect(isFocusTask(task, 'ready-to-enqueue', [])).toBe(true)
  })

  it('includes pr-closed for closed-but-unmerged pull requests needing attention', () => {
    expect(DEFAULT_FOCUS_STATES).toContain('pr-closed')
  })

  it('counts ready-to-enqueue pull requests as default focus attention', () => {
    const task = makeTask({ id: 'T-enqueue' })
    const prs = new Map<string, PullRequestInfo[]>([
      ['T-enqueue', [makePr({ id: 1, ticket_id: 'T-enqueue', merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'abc123', readiness_updated_at: 1000 })]],
    ])

    expect(getFilterCounts([task], new Map(), prs)).toMatchObject({ focus: 1 })
  })
})

describe('loadFocusFilterStates', () => {
  it('returns DEFAULT_FOCUS_STATES when no config stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    const result = await loadFocusFilterStates('proj-1')
    expect(result).toEqual(DEFAULT_FOCUS_STATES)
  })

  it('returns parsed states when valid config stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['idle', 'needs-input']))
    const result = await loadFocusFilterStates('proj-1')
    expect(result).toEqual(['idle', 'needs-input'])
  })

  it('strips active from stored focus filter states because running agents are not focusable', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['idle', 'active', 'needs-input']))
    const result = await loadFocusFilterStates('proj-1')
    expect(result).toEqual(['idle', 'needs-input'])
  })

  it('migrates legacy default stored states to include merge-conflict, pr-closed, and ready-to-enqueue', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify([
      'idle',
      'needs-input',
      'paused',
      'agent-done',
      'failed',
      'interrupted',
      'pr-draft',
      'pr-open',
      'ci-failed',
      'changes-requested',
      'unaddressed-comments',
      'ready-to-merge',
      'pr-merged',
    ]))

    const result = await loadFocusFilterStates('proj-1')

    expect(result).toEqual(DEFAULT_FOCUS_STATES)
    expect(result).toContain('merge-conflict')
    expect(result).toContain('pr-closed')
    expect(result).toContain('ready-to-enqueue')
  })

  it('loads pr-closed as a valid custom focus filter state', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['pr-closed']))
    const result = await loadFocusFilterStates('proj-1')
    expect(result).toEqual(['pr-closed'])
  })

  it('returns defaults when invalid JSON stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue('not-json')
    const result = await loadFocusFilterStates('proj-1')
    expect(result).toEqual(DEFAULT_FOCUS_STATES)
  })
})

describe('saveFocusFilterStates', () => {
  it('strips active before saving focus filter states because running agents are not focusable', async () => {
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
    await saveFocusFilterStates('proj-1', ['idle', 'active'])
    expect(setProjectConfig).toHaveBeenCalledWith('proj-1', 'focus_filter_states', JSON.stringify(['idle']))
  })
})

describe('loadLowFireTaskIds', () => {
  it('returns an empty set when no config stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    const result = await loadLowFireTaskIds('proj-1')
    expect(result).toEqual(new Set())
  })

  it('returns parsed task ids when valid config stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(['T-1', 'T-2']))
    const result = await loadLowFireTaskIds('proj-1')
    expect(result).toEqual(new Set(['T-1', 'T-2']))
  })

  it('returns an empty set when invalid JSON stored', async () => {
    vi.mocked(getProjectConfig).mockResolvedValue('not-json')
    const result = await loadLowFireTaskIds('proj-1')
    expect(result).toEqual(new Set())
  })
})

describe('saveLowFireTaskIds', () => {
  it('saves task ids as a JSON array', async () => {
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
    await saveLowFireTaskIds('proj-1', new Set(['T-2', 'T-1']))
    expect(setProjectConfig).toHaveBeenCalledWith('proj-1', 'low_fire_task_ids', JSON.stringify(['T-2', 'T-1']))
  })
})

describe('DEFAULT_FOCUS_STATES', () => {
  it('includes unaddressed-comments', () => {
    expect(DEFAULT_FOCUS_STATES).toContain('unaddressed-comments')
  })
})
